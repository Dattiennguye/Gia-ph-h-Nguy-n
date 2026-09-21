import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeUser, regionIdByCode } from './helpers.js';

useTempDb('moderation');
let api, a, b, admin;

before(async () => {
  api = await startServer();
  const hn = await regionIdByCode('viet-nam.ha-noi.thanh-oai');
  a = await makeUser(api, { display_name: 'Anh Tuấn', gender: 'male', region_id: hn, interested_in: ['female'] });
  b = await makeUser(api, { display_name: 'Bảo Ngọc', gender: 'female', birth_date: '1999-02-02', region_id: hn, interested_in: ['male'] });

  // Nâng quyền một tài khoản lên admin, trực tiếp trong DB (như khi khởi tạo hệ thống).
  const { run } = await import('../src/db/index.js');
  admin = await makeUser(api, { display_name: 'Quản trị' });
  run("UPDATE users SET role = 'admin' WHERE id = ?", [admin.id]);

  // Tạo match để có chỗ nhắn tin.
  await api.post('/discovery/react', { user_id: b.id, action: 'like' }, { token: a.token });
  await api.post('/discovery/react', { user_id: a.id, action: 'like' }, { token: b.token });
});
after(async () => { await api.close(); });

const convOf = async (token) =>
  (await api.get('/social/matches', { token })).data.matches[0].conversation_id;

describe('Quét an toàn tin nhắn', () => {
  test('tin nhắn bình thường gửi được', async () => {
    const conv = await convOf(a.token);
    const r = await api.post(`/social/conversations/${conv}/messages`,
      { body: 'Chào bạn, cuối tuần này bạn có rảnh không?' }, { token: a.token });
    assert.equal(r.status, 201);
    assert.equal(r.data.message.warning, null);
  });

  test('tin nhắn đáng ngờ vẫn gửi nhưng người NHẬN thấy cảnh báo', async () => {
    const conv = await convOf(a.token);
    const r = await api.post(`/social/conversations/${conv}/messages`,
      { body: 'Kết bạn zalo với mình nhé 0987654321' }, { token: a.token });
    assert.equal(r.status, 201);
    assert.equal(r.data.message.warning, null, 'người gửi không thấy cảnh báo về chính mình');

    const received = await api.get(`/social/conversations/${conv}/messages`, { token: b.token });
    const last = received.data.messages.at(-1);
    assert.ok(last.warning, 'người nhận phải thấy cảnh báo');
  });

  test('tin nhắn lừa đảo bị chặn VÀ để lại hồ sơ kiểm duyệt', async () => {
    const conv = await convOf(a.token);
    const before = (await api.get('/admin/cases?status=all', { token: admin.token })).data.cases.length;

    const r = await api.post(`/social/conversations/${conv}/messages`,
      { body: 'Em ơi anh kẹt tiền gấp, chuyển giúp anh 5 triệu vào STK 0123456789 Vietcombank nhé' },
      { token: a.token });
    assert.equal(r.status, 400);
    assert.match(r.data.message, /lừa đảo|vi phạm/);

    // Tin nhắn không được lưu...
    const msgs = (await api.get(`/social/conversations/${conv}/messages`, { token: b.token })).data.messages;
    assert.ok(!msgs.some((m) => /5 triệu/.test(m.body)), 'tin bị chặn không được lưu');

    // ...nhưng dấu vết kiểm duyệt thì phải còn.
    const cases = (await api.get('/admin/cases?status=all', { token: admin.token })).data.cases;
    assert.ok(cases.length >= before, 'phải có ca kiểm duyệt');
    const mine = cases.find((c) => c.target_id === a.id);
    assert.ok(mine, 'phải có ca cho người gửi');
    assert.equal(mine.risk, 'high');
  });

  test('rủi ro cao thì tạm khoá tài khoản ngay', async () => {
    const detail = await api.get(`/admin/users/${a.id}`, { token: admin.token });
    assert.equal(detail.data.user.status, 'suspended');

    const blocked = await api.get('/discovery/feed', { token: a.token });
    assert.equal(blocked.status, 403);
  });

  test('quản trị viên khôi phục được tài khoản', async () => {
    const cases = (await api.get('/admin/cases?status=all', { token: admin.token })).data.cases;
    const mine = cases.find((c) => c.target_id === a.id);
    const r = await api.post(`/admin/cases/${mine.id}/resolve`,
      { action: 'reinstate', note: 'Đã xem xét lại.' }, { token: admin.token });
    assert.equal(r.status, 200);

    const detail = await api.get(`/admin/users/${a.id}`, { token: admin.token });
    assert.equal(detail.data.user.status, 'active');
    assert.equal(detail.data.user.risk_score, 0);
    assert.equal((await api.get('/discovery/feed', { token: a.token })).status, 200);
  });
});

describe('Báo cáo', () => {
  test('người dùng báo cáo được, và báo cáo tạo ca kiểm duyệt', async () => {
    const r = await api.post('/social/report',
      { user_id: b.id, category: 'fake_profile', detail: 'Ảnh có vẻ lấy từ nơi khác.' },
      { token: a.token });
    assert.equal(r.status, 200);
    assert.ok(r.data.report_id);

    const reports = await api.get('/admin/reports?status=all', { token: admin.token });
    assert.ok(reports.data.reports.some((x) => x.target_id === b.id));
  });

  test('báo cáo trùng trong 24h được gộp lại', async () => {
    const r = await api.post('/social/report', { user_id: b.id, category: 'spam' }, { token: a.token });
    assert.equal(r.data.duplicate, true);
  });

  test('không tự báo cáo chính mình được', async () => {
    const r = await api.post('/social/report', { user_id: a.id, category: 'spam' }, { token: a.token });
    assert.equal(r.status, 400);
  });
});

describe('Phân quyền quản trị', () => {
  test('người dùng thường không vào được API quản trị', async () => {
    assert.equal((await api.get('/admin/dashboard', { token: b.token })).status, 403);
    assert.equal((await api.get('/admin/users', { token: b.token })).status, 403);
    assert.equal((await api.get('/admin/audit', { token: b.token })).status, 403);
  });

  test('mọi hành động quản trị đều vào nhật ký kiểm toán', async () => {
    const logs = (await api.get('/admin/audit?limit=200', { token: admin.token })).data.logs;
    assert.ok(logs.some((l) => l.action === 'moderation.reinstate'));
    assert.ok(logs.some((l) => l.action === 'moderation.auto_suspend'));
    assert.ok(logs.some((l) => l.action === 'report.create'));
  });

  test('quản trị viên khoá và mở lại được tài khoản', async () => {
    await api.post(`/admin/users/${b.id}/status`, { status: 'suspended', reason: 'Thử nghiệm' }, { token: admin.token });
    // Tạm khoá: phiên vẫn còn, nhưng mọi thao tác bị chặn kèm lý do rõ ràng.
    const denied = await api.get('/profile', { token: b.token });
    assert.equal(denied.status, 403);
    assert.match(denied.data.message, /Thử nghiệm/);

    const relogin = await api.post('/auth/login', { identifier: b.email, password: 'matkhau123' });
    assert.equal(relogin.status, 403, 'đăng nhập lại cũng bị chặn kèm lý do');

    await api.post(`/admin/users/${b.id}/status`, { status: 'active' }, { token: admin.token });
    assert.equal((await api.get('/profile', { token: b.token })).status, 200, 'mở lại thì dùng được ngay');
  });

  test('khoá vĩnh viễn thì thu hồi toàn bộ phiên đăng nhập', async () => {
    const victim = await makeUser(api, { display_name: 'Người vi phạm' });
    assert.equal((await api.get('/profile', { token: victim.token })).status, 200);
    await api.post(`/admin/users/${victim.id}/status`, { status: 'banned', reason: 'Vi phạm nghiêm trọng' }, { token: admin.token });
    assert.equal((await api.get('/profile', { token: victim.token })).status, 401, 'phiên phải bị thu hồi');
    const login = await api.post('/auth/login', { identifier: victim.email, password: 'matkhau123' });
    assert.equal(login.status, 403);
    assert.match(login.data.message, /vĩnh viễn/);
  });

  test('không khoá được tài khoản quản trị', async () => {
    const r = await api.post(`/admin/users/${admin.id}/status`, { status: 'banned' }, { token: admin.token });
    assert.equal(r.status, 400);
  });
});
