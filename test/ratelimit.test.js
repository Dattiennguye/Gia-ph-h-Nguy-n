import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './helpers.js';

useTempDb('ratelimit');
// Tệp này kiểm tra chính bộ giới hạn, nên dùng hệ số thật.
process.env.RATE_LIMIT_FACTOR = '1';

let api;
before(async () => { api = await startServer(); });
after(async () => { await api.close(); });

describe('Giới hạn tần suất', () => {
  test('chặn thử mật khẩu hàng loạt', async () => {
    await api.post('/auth/register', {
      method: 'email', email: 'nan@test.vn', password: 'matkhau123', display_name: 'Nạn nhân',
    });

    let blocked = false;
    for (let i = 0; i < 40; i += 1) {
      const r = await api.post('/auth/login', { identifier: 'nan@test.vn', password: `sai${i}12345` });
      if (r.status === 429) { blocked = true; break; }
    }
    assert.ok(blocked, 'phải chặn sau một số lần thử sai');
  });

  test('chặn gửi OTP liên tục từ cùng một địa chỉ', async () => {
    let blocked = false;
    let attempts = 0;
    for (let i = 0; i < 30; i += 1) {
      attempts += 1;
      const r = await api.post('/auth/login/otp/send', { phone: '0955555555' });
      if (r.status === 429) { blocked = true; break; }
    }
    assert.ok(blocked, `phải chặn khi gửi OTP quá nhiều (đã thử ${attempts} lần)`);
  });

  test('không tiết lộ số điện thoại nào đã đăng ký', async () => {
    const daDangKy = await api.post('/auth/login/otp/send', { phone: '0912121212' });
    const chuaDangKy = await api.post('/auth/login/otp/send', { phone: '0913131313' });
    assert.equal(daDangKy.status, chuaDangKy.status);
    assert.equal(daDangKy.data.message, chuaDangKy.data.message);
  });

  test('nhập sai OTP quá số lần thì phải xin mã mới', async () => {
    const reg = await api.post('/auth/register', {
      method: 'email', email: 'otp2@test.vn', password: 'matkhau123', display_name: 'OTP Hai',
    });
    const token = reg.data.token;
    const sent = await api.post('/auth/phone/send-otp', { phone: '0966666666' }, { token });
    assert.ok(sent.data.code);

    let exhausted = false;
    for (let i = 0; i < 8; i += 1) {
      const r = await api.post('/auth/phone/verify', { phone: '0966666666', code: '111111' }, { token });
      if (r.status === 429) { exhausted = true; break; }
    }
    assert.ok(exhausted, 'phải khoá sau quá nhiều lần nhập sai');

    // Mã đúng cũng không dùng được nữa — buộc phải xin mã mới.
    const withRealCode = await api.post('/auth/phone/verify', { phone: '0966666666', code: sent.data.code }, { token });
    assert.equal(withRealCode.status, 429);
  });
});
