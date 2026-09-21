import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer } from './helpers.js';

useTempDb('auth');
let api;

before(async () => { api = await startServer(); });
after(async () => { await api.close(); });

describe('Đăng ký & đăng nhập', () => {
  test('đăng ký bằng email rồi đăng nhập lại được', async () => {
    const r = await api.post('/auth/register', {
      method: 'email', email: 'a@test.vn', password: 'matkhau123', display_name: 'An',
    });
    assert.equal(r.status, 201);
    assert.ok(r.data.token);
    assert.equal(r.data.next, 'verify_phone');

    const login = await api.post('/auth/login', { identifier: 'a@test.vn', password: 'matkhau123' });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
  });

  test('từ chối mật khẩu yếu', async () => {
    const r = await api.post('/auth/register', {
      method: 'email', email: 'weak@test.vn', password: 'abc', display_name: 'Yếu',
    });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /8 ký tự/);
  });

  test('từ chối email trùng', async () => {
    const r = await api.post('/auth/register', {
      method: 'email', email: 'a@test.vn', password: 'matkhau123', display_name: 'An 2',
    });
    assert.equal(r.status, 409);
  });

  test('từ chối sai mật khẩu, không tiết lộ tài khoản có tồn tại hay không', async () => {
    const wrong = await api.post('/auth/login', { identifier: 'a@test.vn', password: 'saibet123' });
    const missing = await api.post('/auth/login', { identifier: 'khong-co@test.vn', password: 'saibet123' });
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.data.message, missing.data.message);
  });

  test('chuẩn hoá số điện thoại Việt Nam', async () => {
    const r = await api.post('/auth/register', {
      method: 'phone', phone: '0912 345 678', password: 'matkhau123', display_name: 'Số',
    });
    assert.equal(r.status, 201);
    const again = await api.post('/auth/register', {
      method: 'phone', phone: '+84912345678', password: 'matkhau123', display_name: 'Trùng',
    });
    assert.equal(again.status, 409, 'cùng một số ở hai định dạng phải bị coi là trùng');
  });

  test('xác minh OTP: sai mã thì báo lỗi, đúng mã thì kích hoạt tài khoản', async () => {
    const reg = await api.post('/auth/register', {
      method: 'email', email: 'otp@test.vn', password: 'matkhau123', display_name: 'OTP',
    });
    const token = reg.data.token;
    const sent = await api.post('/auth/phone/send-otp', { phone: '0933333333' }, { token });
    assert.ok(sent.data.code);

    const bad = await api.post('/auth/phone/verify', { phone: '0933333333', code: '000000' }, { token });
    assert.equal(bad.status, 400);

    const ok = await api.post('/auth/phone/verify', { phone: '0933333333', code: sent.data.code }, { token });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.phone_verified, true);
    assert.equal(ok.data.user.status, 'active');
  });

  test('token bị thu hồi thì không dùng được nữa', async () => {
    const login = await api.post('/auth/login', { identifier: 'a@test.vn', password: 'matkhau123' });
    const token = login.data.token;
    assert.equal((await api.get('/auth/me', { token })).status, 200);
    await api.post('/auth/logout', {}, { token });
    assert.equal((await api.get('/auth/me', { token })).status, 401);
  });

  test('chặn người dưới 18 tuổi', async () => {
    const reg = await api.post('/auth/register', {
      method: 'email', email: 'tre@test.vn', password: 'matkhau123', display_name: 'Trẻ',
    });
    const r = await api.patch('/profile', { birth_date: '2015-01-01' }, { token: reg.data.token });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /18 tuổi/);
  });

  test('không có token thì không vào được API riêng tư', async () => {
    assert.equal((await api.get('/profile')).status, 401);
    assert.equal((await api.get('/discovery/feed')).status, 401);
    assert.equal((await api.get('/admin/dashboard')).status, 401);
  });
});
