import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useTempDb } from './helpers.js';

useTempDb('scale');

let db, candidatePool, loadViewer, haversineKm, seedRegions;

/**
 * Tạo hồ sơ trực tiếp trong DB.
 *
 * `kmEast` là khoảng cách về phía đông so với điểm gốc — nhờ vậy bài kiểm thử
 * biết chính xác ai gần ai xa, và kiểm tra được thứ tự.
 */
function makeProfile({ id: _ignored, name, kmEast, gender = 'female', baseLat = 21.0, baseLng = 105.8 }) {
  const t = Date.now();
  const kmPerLng = 111.32 * Math.cos((baseLat * Math.PI) / 180);
  const userId = db.insert(
    `INSERT INTO users (email, password_hash, status, phone_verified, created_at, updated_at, last_active_at)
     VALUES (?, 'x', 'active', 1, ?, ?, ?)`,
    [`${name}@scale.test`, t, t, t]
  );
  db.run(
    `INSERT INTO profiles (user_id, display_name, birth_date, gender, region_id, lat, lng,
       relationship_goal, marriage_timeline, children_wish, smoking, marital_status,
       lifestyle_tags, interest_tags, visibility, created_at, updated_at)
     VALUES (?,?,?,?,NULL,?,?, 'marriage','asap','want','never','single','[]','[]','public',?,?)`,
    [userId, name, '1998-01-01', gender, baseLat, baseLng + kmEast / kmPerLng, t, t]
  );
  db.run(
    `INSERT INTO preferences (user_id, interested_in, relationship_goals, age_min, age_max, max_distance_km, updated_at)
     VALUES (?,?,?,18,60,200,?)`,
    [userId, JSON.stringify([gender === 'female' ? 'male' : 'female']),
     JSON.stringify(['marriage', 'partner', 'love']), t]
  );
  return userId;
}

before(async () => {
  db = await import('../src/db/index.js');
  db.migrate();
  ({ seedRegions } = await import('../src/services/regions.js'));
  seedRegions();
  ({ candidatePool } = await import('../src/services/discovery.js'));
  ({ loadViewer } = await import('../src/services/profiles.js'));
  ({ haversineKm } = await import('../src/lib/geo.js'));
});

describe('Ai được nhìn thấy', () => {
  let viewerId;
  const far = [];   // đăng ký TRƯỚC, ở XA
  const near = [];  // đăng ký SAU, ở GẦN

  before(() => {
    // Người ở xa được tạo trước → id nhỏ hơn.
    for (let i = 0; i < 30; i += 1) {
      far.push(makeProfile({ name: `xa${i}`, kmEast: 40 + i }));
    }
    // Người ở gần được tạo sau → id lớn hơn.
    for (let i = 0; i < 30; i += 1) {
      near.push(makeProfile({ name: `gan${i}`, kmEast: 1 + i * 0.2 }));
    }
    viewerId = makeProfile({ name: 'nguoixem', kmEast: 0, gender: 'male' });
  });

  test('tập ứng viên lấy người GẦN NHẤT, không phải người đăng ký sớm nhất', () => {
    const viewer = loadViewer(viewerId);
    const pool = candidatePool(viewer, { radiusKm: 200, limit: 30 });
    assert.equal(pool.length, 30);

    const ids = new Set(pool.map((c) => c.userId));
    const nearHits = near.filter((id) => ids.has(id)).length;
    const farHits = far.filter((id) => ids.has(id)).length;

    assert.equal(nearHits, 30, 'cả 30 người ở gần phải lọt vào');
    assert.equal(farHits, 0, 'người ở xa không được chiếm chỗ chỉ vì đăng ký sớm');
  });

  test('người đăng ký SAU CÙNG vẫn được nhìn thấy nếu ở gần', () => {
    const newest = makeProfile({ name: 'nguoimoinhat', kmEast: 0.3 });
    const viewer = loadViewer(viewerId);
    const pool = candidatePool(viewer, { radiusKm: 200, limit: 5 });
    assert.equal(pool[0].userId, newest, 'người mới nhất ở gần nhất phải đứng đầu');
  });

  test('tập ứng viên được sắp xếp theo khoảng cách tăng dần', () => {
    const viewer = loadViewer(viewerId);
    const pool = candidatePool(viewer, { radiusKm: 200, limit: 40 });
    const distances = pool.map((c) =>
      haversineKm(viewer.profile.lat, viewer.profile.lng, c.profile.lat, c.profile.lng)
    );
    for (let i = 1; i < distances.length; i += 1) {
      assert.ok(
        distances[i] >= distances[i - 1] - 0.01,
        `sai thứ tự ở vị trí ${i}: ${distances[i - 1].toFixed(2)}km rồi tới ${distances[i].toFixed(2)}km`
      );
    }
  });

  test('sau nhiều người xem khác nhau, phần lớn kho hồ sơ đều xuất hiện', () => {
    const everyone = db.all('SELECT user_id FROM profiles').map((r) => r.user_id);
    const seen = new Set();
    // Lấy người xem TRẢI ĐỀU khắp danh sách. Lấy 20 người đầu là lấy toàn bộ
    // từ một cụm địa lý, và khi đó phép đo nói về địa lý chứ không nói về thứ
    // tự đăng ký — tức là không kiểm được điều cần kiểm.
    const step = Math.max(1, Math.floor(everyone.length / 20));
    for (const uid of everyone.filter((_, i) => i % step === 0)) {
      for (const c of candidatePool(loadViewer(uid), { radiusKm: 200, limit: 40 })) {
        seen.add(c.userId);
      }
    }
    const coverage = seen.size / everyone.length;
    assert.ok(coverage > 0.7, `chỉ ${(coverage * 100).toFixed(0)}% hồ sơ từng xuất hiện`);
  });
});

describe('Số truy vấn không tăng theo kích thước kho', () => {
  /** Đếm số câu lệnh SQL thực sự được chuẩn bị. */
  function countQueries(fn) {
    const original = db.db.prepare.bind(db.db);
    let n = 0;
    db.db.prepare = (sql) => { n += 1; return original(sql); };
    try { fn(); } finally { db.db.prepare = original; }
    return n;
  }

  test('lấy 20 ứng viên và lấy 400 ứng viên tốn gần như nhau', () => {
    // Thêm hồ sơ cho đủ đông.
    for (let i = 0; i < 400; i += 1) makeProfile({ name: `dong${i}`, kmEast: 2 + i * 0.05 });

    const viewer = loadViewer(db.get("SELECT user_id FROM profiles WHERE display_name='nguoixem'").user_id);

    const small = countQueries(() => candidatePool(viewer, { radiusKm: 200, limit: 20 }));
    const large = countQueries(() => candidatePool(viewer, { radiusKm: 200, limit: 400 }));

    assert.ok(small < 10, `lấy 20 người mà tốn ${small} truy vấn`);
    assert.ok(
      large <= small + 4,
      `gấp 20 lần số ứng viên mà số truy vấn nhảy từ ${small} lên ${large} — lỗi N+1 đã quay lại`
    );
  });

  test('xếp hạng không sinh thêm truy vấn nào', async () => {
    const { rankCandidates } = await import('../src/services/discovery.js');
    const viewer = loadViewer(db.get("SELECT user_id FROM profiles WHERE display_name='nguoixem'").user_id);
    const pool = candidatePool(viewer, { radiusKm: 200, limit: 300 });

    const n = countQueries(() => rankCandidates(viewer, pool, { radiusKm: 200 }));
    assert.equal(n, 0, 'mọi dữ liệu cần cho việc xếp hạng phải đã được nạp sẵn theo lô');
  });
});
