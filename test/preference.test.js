import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeUser, regionIdByCode } from './helpers.js';

useTempDb('pref');
let api, dat, huts = [], khongHuts = [];

before(async () => {
  api = await startServer();
  const thuongTin = await regionIdByCode('viet-nam.ha-noi.thuong-tin');
  const thanhOai = await regionIdByCode('viet-nam.ha-noi.thanh-oai');

  dat = await makeUser(api, {
    display_name: 'Tiến Đạt', gender: 'male', region_id: thuongTin,
    interested_in: ['female'], age_min: 20, age_max: 35, max_distance_km: 30,
  });

  // 4 người không hút thuốc, 4 người hút thuốc — để đo được tác động của tiêu chí.
  for (let i = 0; i < 4; i += 1) {
    khongHuts.push(await makeUser(api, {
      display_name: `Không hút ${i + 1}`, gender: 'female', birth_date: '1998-01-01',
      region_id: thanhOai, smoking: 'never', interested_in: ['male'], age_min: 20, age_max: 40,
    }));
    huts.push(await makeUser(api, {
      display_name: `Có hút ${i + 1}`, gender: 'female', birth_date: '1998-01-01',
      region_id: thanhOai, smoking: 'regularly', interested_in: ['male'], age_min: 20, age_max: 40,
    }));
  }
});
after(async () => { await api.close(); });

describe('Tiêu chí bắt buộc và ưu tiên', () => {
  test('chưa có tiêu chí thì thấy tất cả', async () => {
    const feed = await api.get('/discovery/feed?limit=50', { token: dat.token });
    assert.equal(feed.data.total, 8);
  });

  test('tiêu chí BẮT BUỘC loại hẳn người không đáp ứng', async () => {
    const r = await api.post('/profile/preference/rules',
      { kind: 'must', field: 'smoking', operator: 'eq', value: 'never', weight: 5 },
      { token: dat.token });
    assert.equal(r.status, 201);

    const feed = await api.get('/discovery/feed?limit=50', { token: dat.token });
    assert.equal(feed.data.total, 4, 'chỉ còn 4 người không hút thuốc');
    const ids = feed.data.items.map((i) => i.profile.user_id);
    assert.ok(huts.every((h) => !ids.includes(h.id)));
  });

  test('AI Matchmaker đo đúng tác động của tiêu chí', async () => {
    const mm = await api.get('/discovery/matchmaker', { token: dat.token });
    assert.equal(mm.data.ready, true);
    assert.equal(mm.data.pool.matching_your_filters, 4);

    const impact = mm.data.rule_impact.find((x) => x.field === 'smoking');
    assert.ok(impact, 'phải nêu tiêu chí hút thuốc');
    assert.equal(impact.excluded, 4, 'tiêu chí này đang loại đúng 4 hồ sơ');
  });

  test('thử nghiệm thay đổi không làm đổi dữ liệu thật', async () => {
    const before = (await api.get('/profile/preference', { token: dat.token })).data.preference;
    const sim = await api.post('/discovery/matchmaker/simulate', { max_distance_km: 5 }, { token: dat.token });
    assert.equal(sim.status, 200);
    assert.ok(sim.data.after <= sim.data.before);

    const after = (await api.get('/profile/preference', { token: dat.token })).data.preference;
    assert.equal(after.max_distance_km, before.max_distance_km, 'nhu cầu thật không được đổi');
  });

  test('gỡ tiêu chí thì kho hồ sơ mở lại', async () => {
    const { rules } = (await api.get('/profile/preference', { token: dat.token })).data;
    const rule = rules.find((r) => r.field === 'smoking');
    await api.del(`/profile/preference/rules/${rule.id}`, { token: dat.token });

    const feed = await api.get('/discovery/feed?limit=50', { token: dat.token });
    assert.equal(feed.data.total, 8);
  });

  test('tiêu chí ƯU TIÊN không loại ai, chỉ đổi thứ tự', async () => {
    await api.post('/profile/preference/rules',
      { kind: 'prefer', field: 'smoking', operator: 'eq', value: 'never', weight: 5 },
      { token: dat.token });

    const feed = await api.get('/discovery/feed?limit=50', { token: dat.token });
    assert.equal(feed.data.total, 8, 'không ai bị loại');

    const top = feed.data.items[0];
    const bottom = feed.data.items.at(-1);
    assert.ok(top.compatibility.score >= bottom.compatibility.score);
    const topIsNonSmoker = khongHuts.some((k) => k.id === top.profile.user_id);
    assert.ok(topIsNonSmoker, 'người đáp ứng tiêu chí ưu tiên phải xếp trên');
  });

  test('từ chối tiêu chí không hợp lệ', async () => {
    const bad1 = await api.post('/profile/preference/rules',
      { kind: 'must', field: 'khong_ton_tai', operator: 'eq', value: 'x' }, { token: dat.token });
    assert.equal(bad1.status, 400);

    const bad2 = await api.post('/profile/preference/rules',
      { kind: 'must', field: 'smoking', operator: 'contains_any', value: ['never'] }, { token: dat.token });
    assert.equal(bad2.status, 400, 'phép so sánh không dùng được với trường này');

    const bad3 = await api.post('/profile/preference/rules',
      { kind: 'must', field: 'smoking', operator: 'eq', value: 'gia_tri_bay' }, { token: dat.token });
    assert.equal(bad3.status, 400);
  });

  test('kiểm tra giá trị nhu cầu', async () => {
    const bad = await api.patch('/profile/preference', { age_min: 40, age_max: 25 }, { token: dat.token });
    assert.equal(bad.status, 400);

    const tooYoung = await api.patch('/profile/preference', { age_min: 15 }, { token: dat.token });
    assert.equal(tooYoung.status, 400);

    const tooFar = await api.patch('/profile/preference', { max_distance_km: 500 }, { token: dat.token });
    assert.equal(tooFar.status, 400);
  });

  test('bán kính bị giới hạn theo gói dịch vụ', async () => {
    const ent = await api.get('/billing/entitlements', { token: dat.token });
    assert.equal(ent.data.plan, 'free');
    const feed = await api.get(`/discovery/feed?radius_km=200`, { token: dat.token });
    assert.equal(feed.data.radius_km, ent.data.max_radius_km, 'không vượt được giới hạn gói free');
  });
});

describe('Gói dịch vụ', () => {
  test('mua Premium kích hoạt quyền lợi', async () => {
    const before = await api.get('/billing/entitlements', { token: dat.token });
    assert.equal(before.data.premium, false);
    assert.equal(before.data.see_who_liked_you, false);

    const pay = await api.post('/billing/checkout', { product: 'premium_1m' }, { token: dat.token });
    assert.equal(pay.status, 201);
    assert.equal(pay.data.status, 'paid');

    const after = await api.get('/billing/entitlements', { token: dat.token });
    assert.equal(after.data.premium, true);
    assert.equal(after.data.see_who_liked_you, true);
    assert.ok(after.data.max_radius_km > before.data.max_radius_km);
  });

  test('"ai đã thích bạn" chỉ mở cho Premium', async () => {
    const nguoiThuong = await makeUser(api, { display_name: 'Người thường' });
    const free = await api.get('/social/likes/received', { token: nguoiThuong.token });
    assert.equal(free.data.premium, false);
    assert.deepEqual(free.data.items, [], 'gói free không xem được danh sách');

    const premium = await api.get('/social/likes/received', { token: dat.token });
    assert.equal(premium.data.premium, true);
  });

  test('từ chối sản phẩm không tồn tại', async () => {
    const r = await api.post('/billing/checkout', { product: 'khong_co' }, { token: dat.token });
    assert.equal(r.status, 400);
  });
});

describe('Xác minh danh tính', () => {
  test('không lộ dữ liệu giấy tờ ra API', async () => {
    const r = await api.post('/verification/identity', {
      document_type: 'cccd', document_number: '001234567890', full_name: 'Nguyễn Tiến Đạt',
    }, { token: dat.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'pending');

    const mine = await api.get('/verification', { token: dat.token });
    const raw = JSON.stringify(mine.data);
    assert.ok(!raw.includes('001234567890'), 'số giấy tờ không được xuất hiện trong response');
  });

  test('một giấy tờ chỉ dùng cho một tài khoản', async () => {
    const { run } = await import('../src/db/index.js');
    run("UPDATE verifications SET status = 'approved' WHERE user_id = ? AND type = 'identity'", [dat.id]);

    const nguoiKhac = await makeUser(api, { display_name: 'Người khác' });
    const r = await api.post('/verification/identity', {
      document_type: 'cccd', document_number: '001234567890', full_name: 'Người Khác',
    }, { token: nguoiKhac.token });
    assert.equal(r.status, 409);
  });

  test('xác minh khuôn mặt yêu cầu tư thế ngẫu nhiên', async () => {
    const nguoi = await makeUser(api, { display_name: 'Người xác minh' });
    const ch = await api.post('/verification/photo/challenge', {}, { token: nguoi.token });
    assert.equal(ch.status, 200);
    assert.ok(ch.data.pose.length > 10, 'phải có mô tả tư thế cụ thể');
  });
});
