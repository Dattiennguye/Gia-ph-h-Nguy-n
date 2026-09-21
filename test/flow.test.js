import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb, startServer, makeUser, regionIdByCode } from './helpers.js';

useTempDb('flow');
let api;
let dat;   // nam, Thượng Phúc
let linh;  // nữ, Thanh Oai — rất hợp với Đạt
let xa;    // nữ, TP.HCM — quá xa

before(async () => {
  api = await startServer();
  const thuongPhuc = await regionIdByCode('viet-nam.ha-noi.thuong-tin.thuong-phuc');
  const thanhOai = await regionIdByCode('viet-nam.ha-noi.thanh-oai');
  const q1 = await regionIdByCode('viet-nam.thanh-pho-ho-chi-minh.quan-1');

  dat = await makeUser(api, {
    display_name: 'Tiến Đạt', gender: 'male', region_id: thuongPhuc,
    interested_in: ['female'], age_min: 20, age_max: 30, max_distance_km: 20,
  });
  linh = await makeUser(api, {
    display_name: 'Khánh Linh', gender: 'female', birth_date: '2001-08-02', region_id: thanhOai,
    interested_in: ['male'], age_min: 24, age_max: 34, max_distance_km: 30,
  });
  xa = await makeUser(api, {
    display_name: 'Phương Nam', gender: 'female', birth_date: '2000-03-03', region_id: q1,
    interested_in: ['male'], age_min: 20, age_max: 40, max_distance_km: 30,
  });
});
after(async () => { await api.close(); });

describe('Khám phá & khoảng cách', () => {
  test('người trong bán kính xuất hiện, người quá xa thì không', async () => {
    const feed = await api.get('/discovery/feed', { token: dat.token });
    assert.equal(feed.status, 200);
    const ids = feed.data.items.map((i) => i.profile.user_id);
    assert.ok(ids.includes(linh.id), 'Linh ở Thanh Oai (~11km) phải xuất hiện');
    assert.ok(!ids.includes(xa.id), 'người ở TP.HCM không được xuất hiện trong bán kính 20km');
  });

  test('thẻ hồ sơ giải thích vì sao được đề xuất', async () => {
    const feed = await api.get('/discovery/feed', { token: dat.token });
    const card = feed.data.items.find((i) => i.profile.user_id === linh.id);
    assert.ok(card.compatibility.score > 0);
    assert.ok(card.compatibility.positives.length >= 3);
    assert.ok(card.compatibility.headline);
    assert.ok(card.compatibility.tier.label);
  });

  test('KHÔNG BAO GIỜ trả toạ độ hay thông tin liên hệ của người khác', async () => {
    const feed = await api.get('/discovery/feed', { token: dat.token });
    const raw = JSON.stringify(feed.data);
    assert.ok(!/"lat"/.test(raw), 'không được lộ vĩ độ');
    assert.ok(!/"lng"/.test(raw), 'không được lộ kinh độ');
    // Tìm dữ liệu thật, không tìm tên khoá: `verification.phone` chỉ là huy hiệu.
    assert.ok(!/(\+84|\b0)\d{9}\b/.test(raw), 'không được lộ số điện thoại');
    assert.ok(!/[\w.]+@[\w.]+\.\w+/.test(raw), 'không được lộ email');
    assert.ok(!/"password|"token|document_number/.test(raw), 'không được lộ dữ liệu nhạy cảm');

    const card = feed.data.items[0];
    assert.ok(card.profile.area, 'phải có tên khu vực');
    assert.ok(card.profile.distance_label, 'phải có khoảng cách đã làm tròn');
  });

  test('khu vực hiển thị chỉ tới cấp quận/huyện, không tới xã/phường', async () => {
    const view = await api.get(`/discovery/profile/${dat.id}`, { token: linh.token });
    assert.equal(view.data.profile.area, 'Thường Tín, Hà Nội');
    assert.ok(!view.data.profile.area.includes('Thượng Phúc'), 'không được lộ cấp xã/phường');
  });

  test('bản đồ trả về toạ độ đã làm mờ, khác toạ độ thật', async () => {
    const map = await api.get('/discovery/nearby?radius_km=30', { token: dat.token });
    assert.ok(map.data.points.length > 0);
    const point = map.data.points.find((p) => p.user_id === linh.id);
    assert.ok(point);
    // Toạ độ được làm tròn 4 chữ số và xê dịch ngẫu nhiên vài trăm mét.
    assert.equal(String(point.lat).split('.')[1]?.length <= 4, true);
    assert.ok(point.area);
  });

  test('gợi ý hằng ngày cố định trong ngày', async () => {
    const a = await api.get('/discovery/daily', { token: dat.token });
    const b = await api.get('/discovery/daily', { token: dat.token });
    assert.deepEqual(
      a.data.items.map((i) => i.profile.user_id),
      b.data.items.map((i) => i.profile.user_id),
      'gọi hai lần trong cùng một ngày phải cho cùng kết quả'
    );
  });
});

describe('Thích, kết đôi và trò chuyện', () => {
  test('thích một chiều chưa tạo kết nối', async () => {
    const r = await api.post('/discovery/react', { user_id: linh.id, action: 'like' }, { token: dat.token });
    assert.equal(r.status, 200);
    assert.equal(r.data.matched, false);

    const conv = await api.get('/social/matches', { token: dat.token });
    assert.equal(conv.data.matches.length, 0, 'chưa được match thì chưa có cuộc trò chuyện');
  });

  test('thích lại tạo kết nối, cuộc trò chuyện và câu mở lời', async () => {
    const r = await api.post('/discovery/react', { user_id: dat.id, action: 'like' }, { token: linh.token });
    assert.equal(r.data.matched, true);
    assert.ok(r.data.conversation_id);
    assert.ok(r.data.icebreaker, 'phải có câu mở lời');
    assert.ok(r.data.highlights.length >= 2, 'phải nêu điểm chung');
  });

  test('cả hai phía đều thấy kết nối', async () => {
    for (const u of [dat, linh]) {
      const m = await api.get('/social/matches', { token: u.token });
      assert.equal(m.data.matches.length, 1);
      assert.ok(m.data.matches[0].conversation_id);
    }
  });

  test('gửi và nhận tin nhắn', async () => {
    const { matches } = (await api.get('/social/matches', { token: dat.token })).data;
    const convId = matches[0].conversation_id;

    const sent = await api.post(`/social/conversations/${convId}/messages`,
      { body: 'Chào bạn, rất vui được kết nối!' }, { token: dat.token });
    assert.equal(sent.status, 201);

    const received = await api.get(`/social/conversations/${convId}/messages`, { token: linh.token });
    assert.equal(received.data.messages.length, 1);
    assert.equal(received.data.messages[0].from_me, false);
    assert.equal(received.data.messages[0].body, 'Chào bạn, rất vui được kết nối!');
  });

  test('người ngoài không vào được cuộc trò chuyện', async () => {
    const { matches } = (await api.get('/social/matches', { token: dat.token })).data;
    const convId = matches[0].conversation_id;
    const r = await api.get(`/social/conversations/${convId}/messages`, { token: xa.token });
    assert.equal(r.status, 403);
  });

  test('không thể nhắn tin cho người chưa match', async () => {
    const r = await api.post('/social/conversations/99999/messages', { body: 'hello' }, { token: xa.token });
    assert.ok([403, 404].includes(r.status));
  });

  test('gỡ kết nối đóng cuộc trò chuyện', async () => {
    const { matches } = (await api.get('/social/matches', { token: dat.token })).data;
    const matchId = matches[0].match_id;
    const convId = matches[0].conversation_id;

    await api.del(`/social/matches/${matchId}`, { token: dat.token });
    assert.equal((await api.get('/social/matches', { token: dat.token })).data.matches.length, 0);

    const blocked = await api.post(`/social/conversations/${convId}/messages`, { body: 'còn đó không' }, { token: linh.token });
    assert.equal(blocked.status, 403);
  });
});

describe('Chặn', () => {
  test('chặn thì hai bên không còn thấy nhau', async () => {
    await api.post('/social/block', { user_id: xa.id }, { token: dat.token });

    const feedDat = await api.get('/discovery/feed?radius_km=200', { token: dat.token });
    assert.ok(!feedDat.data.items.some((i) => i.profile.user_id === xa.id));

    const feedXa = await api.get('/discovery/feed?radius_km=200', { token: xa.token });
    assert.ok(!feedXa.data.items.some((i) => i.profile.user_id === dat.id));

    const react = await api.post('/discovery/react', { user_id: xa.id, action: 'like' }, { token: dat.token });
    assert.equal(react.status, 403);
  });

  test('bỏ chặn khôi phục lại', async () => {
    await api.del(`/social/block/${xa.id}`, { token: dat.token });
    const list = await api.get('/social/blocked', { token: dat.token });
    assert.equal(list.data.blocked.length, 0);
  });
});
