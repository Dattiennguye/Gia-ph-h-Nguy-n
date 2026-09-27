/**
 * Đo hiệu năng ở quy mô lớn.
 *
 *   npm run bench            # 5.000 hồ sơ
 *   npm run bench -- 50000   # 50.000 hồ sơ
 *
 * Nạp hồ sơ tổng hợp quanh Hà Nội vào một cơ sở dữ liệu RIÊNG (data/bench.db),
 * rồi đo thời gian và ĐẾM SỐ TRUY VẤN của từng màn hình chính.
 *
 * Số truy vấn quan trọng không kém thời gian: nó phải gần như không đổi khi kho
 * hồ sơ lớn lên. Nếu con số đó tăng theo số ứng viên, lỗi N+1 đã quay lại và
 * thời gian sẽ sụp đổ ở quy mô thật, dù trên máy dev vẫn thấy nhanh.
 */
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2]) || 5000;
const benchDb = path.resolve('./data/bench.db');
process.env.DB_PATH = benchDb;
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || './data/bench-uploads';

for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(benchDb + suffix)) fs.unlinkSync(benchDb + suffix);
}

const db = await import('../src/db/index.js');
db.migrate();
const { seedRegions } = await import('../src/services/regions.js');
seedRegions();

const LIFE = ['homebody', 'outgoing', 'travel', 'sports', 'fitness', 'foodie', 'cooking', 'pets', 'nature', 'saving'];
const INT = ['music', 'movies', 'reading', 'gaming', 'coffee', 'football', 'running', 'yoga', 'tech', 'camping'];
const any = (a) => a[Math.floor(Math.random() * a.length)];
const pick = (a, n) => {
  const c = [...a]; const o = [];
  for (let i = 0; i < n && c.length; i += 1) o.push(c.splice(Math.floor(Math.random() * c.length), 1)[0]);
  return o;
};

const districts = db.all(
  "SELECT id, lat, lng FROM regions WHERE code LIKE 'viet-nam.ha-noi.%' AND level = 'district'"
);

console.log(`Đang nạp ${N.toLocaleString('vi-VN')} hồ sơ...`);
const t0 = Date.now();

db.transaction(() => {
  for (let i = 0; i < N; i += 1) {
    const t = Date.now();
    const male = Math.random() < 0.52;
    const r = any(districts);
    const age = 22 + Math.floor(Math.random() * 16);
    const id = db.insert(
      `INSERT INTO users (email, password_hash, status, phone_verified, created_at, updated_at, last_active_at)
       VALUES (?, 'x', 'active', 1, ?, ?, ?)`,
      [`bench${i}@bench.local`, t, t, t - Math.floor(Math.random() * 5 * 86400000)]
    );
    db.run(
      `INSERT INTO profiles (user_id, display_name, birth_date, gender, bio, region_id, lat, lng,
         relationship_goal, marriage_timeline, children_wish, living_preference, smoking, drinking,
         marital_status, education, height_cm, seriousness, lifestyle_tags, interest_tags,
         completeness, visibility, created_at, updated_at)
       VALUES (?,?,?,?,'',?,?,?,?,?,?,?,?,?,'single',?,?,?,?,?,90,'public',?,?)`,
      [id, `Người ${i}`, `${new Date().getFullYear() - age}-06-15`, male ? 'male' : 'female',
       r.id, r.lat + (Math.random() - 0.5) * 0.12, r.lng + (Math.random() - 0.5) * 0.12,
       any(['marriage', 'partner', 'love', 'friends']),
       any(['asap', '1_3_years', 'over_3_years', 'undecided']),
       any(['want', 'not_want', 'undecided', 'open']),
       any(['near_family', 'independent', 'flexible']),
       any(['never', 'never', 'occasionally', 'regularly']),
       any(['never', 'occasionally', 'regularly']),
       any(['bachelor', 'master', 'college', 'high_school']),
       150 + Math.floor(Math.random() * 35), 1 + Math.floor(Math.random() * 5),
       JSON.stringify(pick(LIFE, 4)), JSON.stringify(pick(INT, 4)), t, t]
    );
    db.run(
      `INSERT INTO preferences (user_id, interested_in, relationship_goals, age_min, age_max, max_distance_km, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
      [id, JSON.stringify([male ? 'female' : 'male']),
       JSON.stringify(['marriage', 'partner', 'love']),
       Math.max(18, age - 6), age + 8, any([10, 20, 30, 50]), t]
    );
    if (Math.random() < 0.4) {
      db.run(
        `INSERT INTO preference_rules (user_id, kind, field, operator, value, weight, created_at)
         VALUES (?, 'must', 'smoking', 'eq', '"never"', 5, ?)`, [id, t]
      );
    }
  }
})();

console.log(`Nạp xong trong ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

/* ------------------------------------------------------------------- đo */

const { discoverFeed, dailyPicks, nearbyMap } = await import('../src/services/discovery.js');
const { matchmakerReport } = await import('../src/services/matchmaker.js');

// Đếm số câu lệnh SQL bằng cách bọc lại prepare.
let queries = 0;
const originalPrepare = db.db.prepare.bind(db.db);
db.db.prepare = (sql) => { queries += 1; return originalPrepare(sql); };

/** Chạy nhiều lượt với những người xem khác nhau rồi lấy trung vị. */
async function measure(label, fn, rounds = 12) {
  const viewers = db.all(`SELECT user_id FROM profiles ORDER BY RANDOM() LIMIT ${rounds}`)
    .map((r) => r.user_id);
  const times = [];
  let q = 0;
  for (const uid of viewers) {
    queries = 0;
    const start = process.hrtime.bigint();
    await fn(uid);
    times.push(Number(process.hrtime.bigint() - start) / 1e6);
    q = Math.max(q, queries);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  console.log(
    `  ${label.padEnd(26)} ${median.toFixed(0).padStart(5)} ms   p95 ${p95.toFixed(0).padStart(5)} ms   ${String(q).padStart(4)} truy vấn`
  );
}

console.log(`Kho ${N.toLocaleString('vi-VN')} hồ sơ · trung vị trên 12 người xem ngẫu nhiên\n`);
await measure('GET /discovery/feed', (uid) => discoverFeed(uid, { limit: 20 }));
await measure('GET /discovery/daily', (uid) => dailyPicks(uid));
await measure('GET /discovery/nearby', (uid) => nearbyMap(uid, { radiusKm: 20 }));
await measure('GET /discovery/matchmaker', (uid) => matchmakerReport(uid), 6);

const size = fs.statSync(benchDb).size / 1024 / 1024;
console.log(`\nKích thước cơ sở dữ liệu: ${size.toFixed(1)} MB`);
console.log(`Bench dùng DB riêng (${benchDb}) — dữ liệu thật không bị đụng tới.\n`);
