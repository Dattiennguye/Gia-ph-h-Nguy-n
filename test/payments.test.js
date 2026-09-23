import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { useTempDb, startServer, makeUser } from './helpers.js';

useTempDb('payments');

let api, config, vnpay, momo, db, user;

before(async () => {
  api = await startServer();
  ({ config } = await import('../src/config.js'));
  vnpay = await import('../src/lib/payments/vnpay.js');
  momo = await import('../src/lib/payments/momo.js');
  db = await import('../src/db/index.js');
  user = await makeUser(api, { display_name: 'Người mua' });
});
after(async () => { await api.close(); });

const isPremium = (id) => db.get(
  `SELECT 1 AS x FROM subscriptions WHERE user_id = ? AND plan='premium' AND status='active'`, [id]
);
const paymentOf = (ref) => db.get('SELECT * FROM payments WHERE provider_ref = ?', [ref]);

/* ================================================================ VNPAY === */

describe('VNPay — tạo giao dịch', () => {
  before(() => {
    config.payment.provider = 'vnpay';
    Object.assign(config.payment.vnpay, {
      tmnCode: 'TMNTEST', hashSecret: 'hash-secret-abc',
      payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', encodeHash: true,
    });
    config.payment.publicUrl = 'https://vigomatch.test';
  });

  test('trả về URL thanh toán đã ký đúng', async () => {
    const r = await api.post('/billing/checkout', { product: 'premium_1m' }, { token: user.token });
    assert.equal(r.status, 201);
    assert.ok(r.data.pay_url?.startsWith('https://sandbox.vnpayment.vn'));

    const url = new URL(r.data.pay_url);
    const q = Object.fromEntries(url.searchParams);

    // Số tiền gửi sang VNPay phải nhân 100.
    assert.equal(q.vnp_Amount, '7900000', '79.000đ phải thành 7.900.000');
    assert.equal(q.vnp_TmnCode, 'TMNTEST');
    assert.equal(q.vnp_Version, '2.1.0');
    assert.equal(q.vnp_CurrCode, 'VND');
    assert.match(q.vnp_TxnRef, /^VIGO/);
    assert.match(q.vnp_CreateDate, /^\d{14}$/);

    // Chữ ký trên URL phải kiểm tra lại được.
    assert.equal(vnpay.verifyCallback(q).valid, true, 'URL tự sinh phải tự kiểm tra được');
  });

  test('giao dịch được ghi ở trạng thái chờ, chưa cộng quyền lợi', async () => {
    assert.equal(isPremium(user.id), null, 'chưa thanh toán thì chưa có Premium');
  });
});

describe('VNPay — IPN', () => {
  const ipn = async (overrides = {}, { resign = true } = {}) => {
    const payment = db.get(
      "SELECT * FROM payments WHERE user_id = ? AND status='pending' ORDER BY id DESC LIMIT 1", [user.id]
    );
    const params = {
      vnp_Amount: String(payment.amount_vnd * 100),
      vnp_TxnRef: payment.provider_ref,
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TransactionNo: '14200001',
      vnp_BankCode: 'NCB',
      vnp_TmnCode: 'TMNTEST',
      ...overrides,
    };
    if (resign) params.vnp_SecureHash = vnpay.sign(params);
    const qs = new URLSearchParams(params);
    return { res: await api.get(`/billing/vnpay/ipn?${qs}`), ref: params.vnp_TxnRef };
  };

  test('TỪ CHỐI chữ ký giả', async () => {
    const { res } = await ipn({ vnp_SecureHash: 'a'.repeat(128) }, { resign: false });
    assert.equal(res.data.RspCode, '97');
    assert.equal(isPremium(user.id), null, 'chữ ký sai thì tuyệt đối không cộng quyền lợi');
  });

  test('TỪ CHỐI khi số tiền bị sửa — chống trả 1.000đ mua gói 79.000đ', async () => {
    const { res, ref } = await ipn({ vnp_Amount: '100000' }); // 1.000đ, ký lại hợp lệ
    assert.equal(res.data.RspCode, '04');
    assert.equal(isPremium(user.id), null);
    assert.equal(paymentOf(ref).status, 'failed');

    const logged = db.all("SELECT * FROM audit_logs WHERE action = 'billing.amount_mismatch'");
    assert.ok(logged.length >= 1, 'phải ghi vào nhật ký kiểm toán');
  });

  test('giao dịch đúng thì cộng quyền lợi', async () => {
    const r = await api.post('/billing/checkout', { product: 'premium_1m' }, { token: user.token });
    const ref = new URL(r.data.pay_url).searchParams.get('vnp_TxnRef');
    const { res } = await ipn();
    assert.equal(res.data.RspCode, '00');
    assert.ok(isPremium(user.id), 'thanh toán thành công phải kích hoạt Premium');
    assert.equal(paymentOf(ref).status, 'paid');
  });

  test('IPN gửi lặp KHÔNG cộng quyền lợi hai lần', async () => {
    const before = db.get(
      `SELECT expires_at FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`, [user.id]
    ).expires_at;

    const payment = db.get("SELECT * FROM payments WHERE user_id=? AND status='paid' ORDER BY id DESC LIMIT 1", [user.id]);
    const params = {
      vnp_Amount: String(payment.amount_vnd * 100),
      vnp_TxnRef: payment.provider_ref,
      vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TmnCode: 'TMNTEST',
    };
    params.vnp_SecureHash = vnpay.sign(params);
    const res = await api.get(`/billing/vnpay/ipn?${new URLSearchParams(params)}`);

    assert.equal(res.data.RspCode, '02', 'phải báo đã xác nhận trước đó');
    const after = db.get(
      `SELECT expires_at FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`, [user.id]
    ).expires_at;
    assert.equal(after, before, 'ngày hết hạn không được cộng thêm lần nữa');
  });

  test('giao dịch bị huỷ thì không cộng quyền lợi', async () => {
    const fresh = await makeUser(api, { display_name: 'Người huỷ' });
    const r = await api.post('/billing/checkout', { product: 'premium_1m' }, { token: fresh.token });
    const ref = new URL(r.data.pay_url).searchParams.get('vnp_TxnRef');
    const params = {
      vnp_Amount: '7900000', vnp_TxnRef: ref,
      vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_TmnCode: 'TMNTEST',
    };
    params.vnp_SecureHash = vnpay.sign(params);
    await api.get(`/billing/vnpay/ipn?${new URLSearchParams(params)}`);
    assert.equal(isPremium(fresh.id), null);
    assert.equal(paymentOf(ref).status, 'failed');
  });

  test('mã đúng nhưng trạng thái giao dịch sai vẫn là thất bại', () => {
    const params = { vnp_TxnRef: 'X', vnp_ResponseCode: '00', vnp_TransactionStatus: '02' };
    params.vnp_SecureHash = vnpay.sign(params);
    const out = vnpay.verifyCallback(params);
    assert.equal(out.valid, true);
    assert.equal(out.success, false, 'phải xét CẢ HAI mã');
  });

  test('trang quay về chỉ điều hướng, không tự cộng quyền lợi', async () => {
    const fresh = await makeUser(api, { display_name: 'Người quay về' });
    const r = await api.post('/billing/checkout', { product: 'premium_1m' }, { token: fresh.token });
    const ref = new URL(r.data.pay_url).searchParams.get('vnp_TxnRef');
    const params = {
      vnp_Amount: '7900000', vnp_TxnRef: ref,
      vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TmnCode: 'TMNTEST',
    };
    params.vnp_SecureHash = vnpay.sign(params);

    const res = await fetch(`${api.base}/api/billing/vnpay/return?${new URLSearchParams(params)}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(isPremium(fresh.id), null, 'trang quay về không được kích hoạt quyền lợi');
  });
});

/* ================================================================= MOMO === */

describe('MoMo', () => {
  let mock, received;
  before(async () => {
    received = [];
    mock = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ path: req.url, body: JSON.parse(body) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          resultCode: 0, message: 'Successful.',
          payUrl: 'https://test-payment.momo.vn/pay/abc123',
          deeplink: 'momo://app?action=payWithApp',
        }));
      });
    });
    await new Promise((r) => mock.listen(0, r));

    config.payment.provider = 'momo';
    Object.assign(config.payment.momo, {
      partnerCode: 'MOMOTEST', accessKey: 'access-key-1', secretKey: 'secret-key-1',
      endpoint: `http://127.0.0.1:${mock.address().port}`, requestType: 'captureWallet',
    });
  });
  after(() => new Promise((r) => mock.close(r)));

  test('gọi đúng endpoint với chữ ký kiểm tra lại được', async () => {
    const buyer = await makeUser(api, { display_name: 'Người MoMo' });
    const r = await api.post('/billing/checkout', { product: 'premium_3m' }, { token: buyer.token });
    assert.equal(r.status, 201);
    assert.equal(r.data.pay_url, 'https://test-payment.momo.vn/pay/abc123');
    assert.ok(r.data.deeplink);

    const sent = received[0];
    assert.equal(sent.path, '/v2/gateway/api/create');
    assert.equal(sent.body.partnerCode, 'MOMOTEST');
    assert.equal(sent.body.amount, '199000');
    assert.match(sent.body.ipnUrl, /\/api\/billing\/momo\/ipn$/);

    // Ký lại đúng tập trường phải ra cùng chữ ký.
    const fields = ['accessKey', 'amount', 'extraData', 'ipnUrl', 'orderId',
      'orderInfo', 'partnerCode', 'redirectUrl', 'requestId', 'requestType'];
    const expected = momo.sign(
      Object.fromEntries(fields.map((k) => [k, sent.body[k] ?? ''])),
      'secret-key-1'
    );
    assert.equal(sent.body.signature, expected);
  });

  test('IPN chữ ký giả bị từ chối', async () => {
    const r = await api.post('/billing/momo/ipn', {
      partnerCode: 'MOMOTEST', orderId: 'VIGOFAKE', amount: '199000',
      resultCode: 0, signature: 'giả-mạo',
    });
    assert.equal(r.status, 400);
  });

  test('IPN hợp lệ kích hoạt quyền lợi', async () => {
    const buyer = await makeUser(api, { display_name: 'Người MoMo 2' });
    await api.post('/billing/checkout', { product: 'premium_1m' }, { token: buyer.token });
    const payment = db.get("SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 1", [buyer.id]);

    const payload = {
      partnerCode: 'MOMOTEST', orderId: payment.provider_ref,
      requestId: `${payment.provider_ref}-1`, amount: String(payment.amount_vnd),
      orderInfo: 'Vigo Match', orderType: 'momo_wallet', transId: 987654321,
      resultCode: 0, message: 'Successful.', payType: 'qr', responseTime: Date.now(), extraData: '',
    };
    const fields = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo',
      'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
    payload.signature = momo.sign(
      Object.fromEntries(fields.map((k) => [k, k === 'accessKey' ? 'access-key-1' : payload[k] ?? ''])),
      'secret-key-1'
    );

    const r = await api.post('/billing/momo/ipn', payload);
    assert.equal(r.status, 204);
    assert.ok(isPremium(buyer.id));
  });

  test('IPN số tiền sai không cộng quyền lợi', async () => {
    const buyer = await makeUser(api, { display_name: 'Người MoMo 3' });
    await api.post('/billing/checkout', { product: 'premium_12m' }, { token: buyer.token });
    const payment = db.get("SELECT * FROM payments WHERE user_id=? ORDER BY id DESC LIMIT 1", [buyer.id]);

    const payload = {
      partnerCode: 'MOMOTEST', orderId: payment.provider_ref,
      requestId: 'r1', amount: '1000', orderInfo: 'x', orderType: 'momo_wallet',
      transId: 1, resultCode: 0, message: 'ok', payType: 'qr', responseTime: Date.now(), extraData: '',
    };
    const fields = ['accessKey', 'amount', 'extraData', 'message', 'orderId', 'orderInfo',
      'orderType', 'partnerCode', 'payType', 'requestId', 'responseTime', 'resultCode', 'transId'];
    payload.signature = momo.sign(
      Object.fromEntries(fields.map((k) => [k, k === 'accessKey' ? 'access-key-1' : payload[k] ?? ''])),
      'secret-key-1'
    );

    await api.post('/billing/momo/ipn', payload);
    assert.equal(isPremium(buyer.id), null, 'trả 1.000đ không được mở gói 699.000đ');
  });
});

describe('Chữ ký — tính chất chung', () => {
  test('VNPay: đổi bất kỳ tham số nào cũng làm chữ ký sai', () => {
    const p = { vnp_Amount: '7900000', vnp_TxnRef: 'ABC', vnp_ResponseCode: '00' };
    const good = { ...p, vnp_SecureHash: vnpay.sign(p) };
    assert.equal(vnpay.verifyCallback(good).valid, true);
    assert.equal(vnpay.verifyCallback({ ...good, vnp_Amount: '100' }).valid, false);
    assert.equal(vnpay.verifyCallback({ ...good, vnp_TxnRef: 'XYZ' }).valid, false);
  });

  test('VNPay: thứ tự tham số không ảnh hưởng tới chữ ký', () => {
    const a = vnpay.sign({ b: '2', a: '1', c: '3' });
    const b = vnpay.sign({ c: '3', a: '1', b: '2' });
    assert.equal(a, b);
  });

  test('MoMo: chuỗi ký xếp theo bảng chữ cái', () => {
    assert.equal(
      momo.rawSignature({ orderId: 'B', accessKey: 'A', partnerCode: 'C' }),
      'accessKey=A&orderId=B&partnerCode=C'
    );
  });
});
