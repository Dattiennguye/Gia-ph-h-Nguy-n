import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { useTempDb } from './helpers.js';

useTempDb('sms');

/** Máy chủ giả lập để bắt đúng request mà nhà cung cấp thật sẽ nhận được. */
function mockProvider(handler) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
      });
      handler(req, res, body, received.length);
    });
  });
  return { server, received, listen: () => new Promise((r) => server.listen(0, r)),
    url: () => `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)) };
}

let sendSms, db;
before(async () => {
  const dbm = await import('../src/db/index.js');
  dbm.migrate();
  db = dbm;
  ({ sendSms } = await import('../src/lib/sms.js'));
});

const lastLog = () => db.get('SELECT * FROM sms_messages ORDER BY id DESC LIMIT 1');

describe('Twilio', () => {
  test('gửi đúng endpoint, xác thực Basic và thân tin form', async () => {
    const mock = mockProvider((req, res) => {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sid: 'SM123abc', status: 'queued' }));
    });
    await mock.listen();

    const { config } = await import('../src/config.js');
    config.sms.provider = 'twilio';
    Object.assign(config.sms.twilio, {
      accountSid: 'AC_test', authToken: 'secret_token', from: '+15550001111', baseUrl: mock.url(),
    });

    const r = await sendSms({ to: '+84912345678', text: 'Ma xac minh 123456', purpose: 'verify_phone' });
    assert.equal(r.ok, true);
    assert.equal(r.ref, 'SM123abc');

    const req = mock.received[0];
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/2010-04-01/Accounts/AC_test/Messages.json');
    assert.match(req.headers['content-type'], /application\/x-www-form-urlencoded/);

    const auth = Buffer.from(req.headers.authorization.replace('Basic ', ''), 'base64').toString();
    assert.equal(auth, 'AC_test:secret_token');

    const form = new URLSearchParams(req.body);
    assert.equal(form.get('To'), '+84912345678');
    assert.equal(form.get('From'), '+15550001111');
    assert.equal(form.get('Body'), 'Ma xac minh 123456');

    assert.equal(lastLog().status, 'sent');
    assert.equal(lastLog().provider_ref, 'SM123abc');
    await mock.close();
  });

  test('lỗi từ Twilio được ghi lại, không ném ra ngoài', async () => {
    const mock = mockProvider((req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Authenticate' }));
    });
    await mock.listen();
    const { config } = await import('../src/config.js');
    config.sms.twilio.baseUrl = mock.url();

    const r = await sendSms({ to: '+84912345678', text: 'test' });
    assert.equal(r.ok, false, 'không được ném lỗi ra ngoài');
    assert.match(r.error, /401/);
    assert.equal(lastLog().status, 'failed');
    await mock.close();
  });
});

describe('eSMS.vn', () => {
  test('gửi đúng định dạng JSON và chuyển số về dạng nội địa', async () => {
    const mock = mockProvider((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CodeResult: '100', SMSID: 'esms-999' }));
    });
    await mock.listen();

    const { config } = await import('../src/config.js');
    config.sms.provider = 'esms';
    Object.assign(config.sms.esms, {
      apiKey: 'key123', secretKey: 'secret456', brandname: 'VIGOMATCH',
      smsType: '2', baseUrl: mock.url(),
    });

    const r = await sendSms({ to: '+84912345678', text: 'Ma xac minh 654321' });
    assert.equal(r.ok, true);
    assert.equal(r.ref, 'esms-999');

    const req = mock.received[0];
    assert.equal(req.path, '/MainService.svc/json/SendMultipleMessage_V4_post_json/');
    const sent = JSON.parse(req.body);
    assert.equal(sent.ApiKey, 'key123');
    assert.equal(sent.SecretKey, 'secret456');
    assert.equal(sent.Phone, '0912345678', 'eSMS nhận số nội địa, không nhận +84');
    assert.equal(sent.Content, 'Ma xac minh 654321');
    assert.equal(sent.Brandname, 'VIGOMATCH');
    await mock.close();
  });

  test('CodeResult khác 100 là thất bại, dù HTTP vẫn 200', async () => {
    const mock = mockProvider((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ CodeResult: '104', ErrorMessage: 'ApiKey khong dung' }));
    });
    await mock.listen();
    const { config } = await import('../src/config.js');
    config.sms.esms.baseUrl = mock.url();

    const r = await sendSms({ to: '+84912345678', text: 'test' });
    assert.equal(r.ok, false, 'HTTP 200 nhưng CodeResult lỗi vẫn phải tính là thất bại');
    assert.match(r.error, /104/);
    await mock.close();
  });
});

describe('Webhook tự dựng', () => {
  test('gửi kèm token xác thực', async () => {
    const mock = mockProvider((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'hook-1' }));
    });
    await mock.listen();
    const { config } = await import('../src/config.js');
    config.sms.provider = 'http';
    config.sms.webhookUrl = mock.url();
    config.sms.webhookToken = 'hook-secret';

    const r = await sendSms({ to: '+84912345678', text: 'xin chao', purpose: 'login' });
    assert.equal(r.ok, true);
    assert.equal(mock.received[0].headers.authorization, 'Bearer hook-secret');
    const sent = JSON.parse(mock.received[0].body);
    assert.equal(sent.purpose, 'login');
    await mock.close();
  });
});

describe('Độ bền', () => {
  test('lỗi tạm thời được thử lại một lần rồi mới bỏ cuộc', async () => {
    let calls = 0;
    const mock = mockProvider((req, res, body, n) => {
      calls = n;
      if (n === 1) {
        res.writeHead(503);
        res.end(JSON.stringify({ message: 'tam thoi qua tai' }));
      } else {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sid: 'SM_retry_ok' }));
      }
    });
    await mock.listen();
    const { config } = await import('../src/config.js');
    config.sms.provider = 'twilio';
    config.sms.twilio.baseUrl = mock.url();

    const r = await sendSms({ to: '+84912345678', text: 'test' });
    assert.equal(r.ok, true, 'lần thử thứ hai phải thành công');
    assert.equal(calls, 2, 'phải gọi đúng hai lần');
    await mock.close();
  });

  test('nhà cung cấp sai tên thì báo rõ, không làm sập luồng đăng ký', async () => {
    const { config } = await import('../src/config.js');
    config.sms.provider = 'khong-ton-tai';
    const r = await sendSms({ to: '+84912345678', text: 'test' });
    assert.equal(r.ok, false);
    assert.match(r.error, /console, twilio, esms, http/);
    config.sms.provider = 'console';
  });

  test('nhật ký KHÔNG lưu nội dung tin nhắn — nội dung chứa mã OTP', async () => {
    await sendSms({ to: '+84999888777', text: 'Ma xac minh cua ban la 424242', purpose: 'verify_phone' });
    const log = lastLog();
    assert.equal(log.status, 'sent');
    assert.equal(log.destination, '+84999888777');
    const columns = Object.keys(log).join(' ');
    assert.ok(!columns.includes('text') && !columns.includes('content'), 'bảng không được có cột nội dung');
    assert.ok(!JSON.stringify(log).includes('424242'), 'mã OTP không được xuất hiện trong nhật ký');
  });
});
