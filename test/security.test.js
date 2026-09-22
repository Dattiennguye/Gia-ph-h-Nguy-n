import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeUser, regionIdByCode } from './helpers.js';

useTempDb('security');
let api, dat, linh, admin;

before(async () => {
  api = await startServer();
  const hn = await regionIdByCode('viet-nam.ha-noi.thanh-oai');
  dat = await makeUser(api, { display_name: 'Tiến Đạt', gender: 'male', region_id: hn, interested_in: ['female'] });
  linh = await makeUser(api, { display_name: 'Khánh Linh', gender: 'female', birth_date: '1999-02-02', region_id: hn, interested_in: ['male'] });

  const { run } = await import('../src/db/index.js');
  admin = await makeUser(api, { display_name: 'Quản trị' });
  run("UPDATE users SET role = 'admin' WHERE id = ?", [admin.id]);
});
after(async () => { await api.close(); });

const setVisibility = async (userId, v) => {
  const { run } = await import('../src/db/index.js');
  run('UPDATE profiles SET visibility = ? WHERE user_id = ?', [v, userId]);
};
const setStatus = async (userId, s) => {
  const { run } = await import('../src/db/index.js');
  run('UPDATE users SET status = ? WHERE id = ?', [s, userId]);
};

describe('Quyền xem hồ sơ', () => {
  test('hồ sơ công khai thì xem được', async () => {
    const r = await api.get(`/discovery/profile/${linh.id}`, { token: dat.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.profile.display_name, 'Khánh Linh');
  });

  test('hồ sơ đang ẩn thì KHÔNG xem được, kể cả khi biết chính xác id', async () => {
    await setVisibility(linh.id, 'hidden');
    const r = await api.get(`/discovery/profile/${linh.id}`, { token: dat.token });
    assert.equal(r.status, 404);
    await setVisibility(linh.id, 'public');
  });

  test('tài khoản bị khoá thì không xem được hồ sơ', async () => {
    await setStatus(linh.id, 'banned');
    const r = await api.get(`/discovery/profile/${linh.id}`, { token: dat.token });
    assert.equal(r.status, 404);
    await setStatus(linh.id, 'active');
  });

  test('người đã kết đôi vẫn xem được nhau dù một bên ẩn hồ sơ', async () => {
    await api.post('/discovery/react', { user_id: linh.id, action: 'like' }, { token: dat.token });
    await api.post('/discovery/react', { user_id: dat.id, action: 'like' }, { token: linh.token });

    await setVisibility(linh.id, 'hidden');
    const r = await api.get(`/discovery/profile/${linh.id}`, { token: dat.token });
    assert.equal(r.status, 200, 'đã match thì cuộc trò chuyện vẫn mở, phải xem được hồ sơ nhau');
    await setVisibility(linh.id, 'public');
  });

  test('người bị chặn nhận cùng một lỗi "không tìm thấy" — không xác nhận tài khoản có tồn tại', async () => {
    const ke3 = await makeUser(api, { display_name: 'Người thứ ba' });
    await api.post('/social/block', { user_id: ke3.id }, { token: dat.token });

    const biChan = await api.get(`/discovery/profile/${ke3.id}`, { token: dat.token });
    const khongCo = await api.get('/discovery/profile/999999', { token: dat.token });
    assert.equal(biChan.status, 404);
    assert.equal(khongCo.status, 404);
    assert.equal(biChan.data.message, khongCo.data.message, 'hai trường hợp phải không phân biệt được');
  });
});

describe('Token không được nằm trong URL', () => {
  test('?token= KHÔNG dùng được cho API thường', async () => {
    const res = await fetch(`${api.base}/api/profile?token=${encodeURIComponent(dat.token)}`);
    assert.equal(res.status, 401, 'token trong URL sẽ lọt vào log và lịch sử trình duyệt');
  });

  test('?token= vẫn dùng được cho luồng sự kiện SSE', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${api.base}/api/social/stream?token=${encodeURIComponent(dat.token)}`, {
      signal: ctrl.signal,
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    ctrl.abort();
  });
});

describe('Ảnh tải lên', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  test('ảnh hợp lệ được ghi ra TỆP, cơ sở dữ liệu chỉ giữ đường dẫn', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const r = await api.post('/profile/photos', { url: png }, { token: dat.token });
    assert.equal(r.status, 201);
    assert.match(r.data.photo.url, /^\/uploads\/.+\.png$/, 'phải trả về đường dẫn tệp');
    assert.ok(!r.data.photo.url.startsWith('data:'), 'không được nhét data URI vào DB');

    const file = path.join(process.env.UPLOAD_DIR, path.basename(r.data.photo.url));
    assert.ok(fs.existsSync(file), 'tệp ảnh phải tồn tại trên đĩa');

    // Gỡ ảnh thì tệp cũng phải biến mất — không để rác tích lại.
    await api.del(`/profile/photos/${r.data.photo.id}`, { token: dat.token });
    assert.ok(!fs.existsSync(file), 'xoá ảnh phải xoá cả tệp');
  });

  test('từ chối tệp giả dạng ảnh PNG', async () => {
    const fake = `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script></html>').toString('base64')}`;
    const r = await api.post('/profile/photos', { url: fake }, { token: dat.token });
    assert.equal(r.status, 400, 'phần mở rộng do client khai không đáng tin — phải soi byte đầu tệp');
  });

  test('từ chối SVG — là tài liệu chạy được script', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    const r = await api.post('/profile/photos', { url: svg }, { token: dat.token });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /SVG/);
  });

  test('từ chối ảnh trỏ sang tên miền khác — tránh lộ IP người xem', async () => {
    const r = await api.post('/profile/photos', { url: 'https://attacker.example/pixel.png' }, { token: dat.token });
    assert.equal(r.status, 400);
  });

  test('từ chối ảnh quá lớn kèm thông báo rõ ràng', async () => {
    const big = `data:image/png;base64,${'A'.repeat(2_200_000)}`;
    const r = await api.post('/profile/photos', { url: big }, { token: dat.token });
    assert.ok([400, 413].includes(r.status), `nhận được ${r.status}`);
    assert.ok(!/lỗi.*máy chủ/i.test(r.data.message ?? ''), 'không được báo là lỗi máy chủ');
  });

  test('ảnh xác minh khuôn mặt cũng đi qua cùng bộ luật', async () => {
    await api.post('/verification/photo/challenge', {}, { token: dat.token });
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`;
    const r = await api.post('/verification/photo', { photo_url: svg }, { token: dat.token });
    assert.equal(r.status, 400);
  });
});

describe('Tiêu đề bảo mật', () => {
  test('có CSP khoá script về cùng nguồn', async () => {
    const res = await fetch(`${api.base}/api/meta/health`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'phải có Content-Security-Policy');
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  test('có các tiêu đề chống sniff và chống nhúng iframe', async () => {
    const res = await fetch(`${api.base}/api/meta/health`);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
  });
});

describe('Dữ liệu nhạy cảm với quản trị viên', () => {
  test('trang quản trị KHÔNG trả về toạ độ chính xác của người dùng', async () => {
    const r = await api.get(`/admin/users/${linh.id}`, { token: admin.token });
    assert.equal(r.status, 200);
    const raw = JSON.stringify(r.data.profile);
    assert.ok(!/"lat":/.test(raw), 'toạ độ phải bị loại bỏ');
    assert.ok(!/"lng":/.test(raw), 'toạ độ phải bị loại bỏ');
    assert.ok(r.data.profile.area, 'vẫn phải biết khu vực để kiểm duyệt');
  });

  test('không bao giờ trả về mã băm mật khẩu', async () => {
    const r = await api.get(`/admin/users/${linh.id}`, { token: admin.token });
    assert.ok(!JSON.stringify(r.data).includes('password_hash'));
  });
});

describe('Chống cào dữ liệu và request dị dạng', () => {
  test('JSON sai cú pháp trả 400, không phải 500', async () => {
    const res = await fetch(`${api.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{khong-phai-json}',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'bad_json');
  });

  test('mảng id thông báo quá dài không làm sập máy chủ', async () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => i);
    const r = await api.post('/social/notifications/read', { ids }, { token: dat.token });
    assert.equal(r.status, 200);
  });
});
