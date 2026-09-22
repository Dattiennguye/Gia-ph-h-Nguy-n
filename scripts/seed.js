/**
 * Tạo dữ liệu mẫu để chạy thử ngay sau khi cài.
 *
 * Toàn bộ hồ sơ ở đây là hồ sơ hư cấu, sinh bằng thuật toán — không lấy ảnh
 * hay thông tin của người thật. Ảnh đại diện là hình SVG sinh tại chỗ (chữ cái
 * đầu trên nền chuyển màu), nhúng thẳng vào dữ liệu nên chạy được hoàn toàn
 * ngoại tuyến.
 *
 *   npm run seed            # ~120 hồ sơ quanh Hà Nội và TP.HCM
 *   npm run seed -- 300     # số lượng tuỳ chọn
 */
import crypto from 'node:crypto';
import { migrate, db, all, get, run, insert, now, transaction } from '../src/db/index.js';
import { seedRegions } from '../src/services/regions.js';
import { createUser, markPhoneVerified } from '../src/services/auth.js';
import { updateProfile, updatePreference, addRule } from '../src/services/profiles.js';
import { react } from '../src/services/interactions.js';
import { sendMessage } from '../src/services/chat.js';
import { createReport } from '../src/services/moderation.js';
import { grantPremium } from '../src/services/billing.js';
import { hashPassword } from '../src/lib/crypto.js';
import { writeAvatar } from '../src/lib/images.js';

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const DEM_NAM = ['Văn', 'Hữu', 'Đức', 'Quang', 'Minh', 'Thanh', 'Tuấn', 'Công', 'Bá', 'Xuân'];
const DEM_NU = ['Thị', 'Ngọc', 'Thanh', 'Thu', 'Khánh', 'Mai', 'Phương', 'Hoài', 'Diệu', 'Kim'];
const TEN_NAM = ['Đạt', 'Hùng', 'Nam', 'Long', 'Khoa', 'Sơn', 'Tùng', 'Hiếu', 'Dũng', 'Bình', 'Kiên', 'Phúc', 'Trung', 'Thắng', 'An', 'Hải', 'Quân', 'Vinh', 'Lâm', 'Thịnh'];
const TEN_NU = ['Linh', 'Hương', 'Trang', 'Ngọc', 'Anh', 'Thảo', 'Hà', 'Vân', 'Yến', 'Nhung', 'Quỳnh', 'Chi', 'My', 'Hiền', 'Trâm', 'Duyên', 'Lan', 'Nga', 'Uyên', 'Tâm'];

const NGHE = ['Kỹ sư phần mềm', 'Giáo viên', 'Kế toán', 'Nhân viên ngân hàng', 'Bác sĩ', 'Điều dưỡng', 'Kiến trúc sư', 'Nhân viên kinh doanh', 'Thiết kế đồ hoạ', 'Đầu bếp', 'Dược sĩ', 'Nhân viên marketing', 'Kỹ sư xây dựng', 'Luật sư', 'Chủ cửa hàng', 'Công nhân kỹ thuật', 'Phiên dịch', 'Nhân viên hành chính', 'Kỹ thuật viên', 'Giảng viên'];

const BIO = [
  'Thích những buổi sáng yên tĩnh và một tách cà phê nóng.',
  'Đang tìm một người để cùng đi qua những điều bình thường của cuộc sống.',
  'Cuối tuần thường ở nhà nấu ăn, thỉnh thoảng xách ba lô đi đâu đó.',
  'Không giỏi nói chuyện qua tin nhắn, nhưng gặp ngoài đời thì vui lắm.',
  'Tin vào sự tử tế và những mối quan hệ được xây từ từ.',
  'Yêu gia đình, thích trẻ con, và đang nghiêm túc tìm một nửa.',
  'Làm việc chăm chỉ, sống đơn giản, và đang tìm người hợp gu.',
  'Mê phượt, mê đồ ăn vặt, và mê cả những cuộc trò chuyện dài.',
  'Một người hướng nội đang học cách mở lòng hơn.',
  'Muốn tìm người cùng xây dựng một cuộc sống ổn định và ấm áp.',
];

const LIFESTYLE = ['homebody', 'outgoing', 'travel', 'sports', 'fitness', 'foodie', 'cooking', 'nightlife', 'nature', 'early_bird', 'night_owl', 'pets', 'saving', 'volunteering'];
const INTERESTS = ['music', 'movies', 'reading', 'gaming', 'photography', 'coffee', 'football', 'badminton', 'running', 'yoga', 'dancing', 'art', 'tech', 'investing', 'motorbike', 'camping', 'karaoke', 'gardening'];

/* ---------------------------------------------------- ngẫu nhiên tái lập được */

let seedState = 20260921;
function rnd() {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickN = (arr, n) => {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i += 1) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
  return out;
};
const chance = (p) => rnd() < p;
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

/**
 * Ảnh đại diện sinh tại chỗ dưới dạng PNG thật, ghi ra thư mục uploads.
 *
 * Dùng PNG chứ không phải SVG vì ứng dụng từ chối SVG do người dùng gửi lên —
 * dữ liệu mẫu phải tuân đúng luật mà hệ thống áp cho người dùng thật.
 */
function avatar(name) {
  return writeAvatar(name);
}

/* ------------------------------------------------------------ chọn khu vực */

function pickRegion(weights) {
  const roll = rnd();
  let acc = 0;
  for (const [code, w] of weights) {
    acc += w;
    if (roll <= acc) {
      const parent = get('SELECT id FROM regions WHERE code = ?', [code]);
      if (!parent) continue;
      const kids = all("SELECT * FROM regions WHERE parent_id = ?", [parent.id]);
      if (!kids.length) return parent;
      const district = kids[Math.floor(rnd() * kids.length)];
      const wards = all('SELECT * FROM regions WHERE parent_id = ?', [district.id]);
      return wards.length && chance(0.5) ? wards[Math.floor(rnd() * wards.length)] : district;
    }
  }
  return get("SELECT * FROM regions WHERE code = 'viet-nam.ha-noi'");
}

const REGION_WEIGHTS = [
  ['viet-nam.ha-noi', 0.42],
  ['viet-nam.thanh-pho-ho-chi-minh', 0.3],
  ['viet-nam.bac-ninh', 0.05],
  ['viet-nam.hung-yen', 0.05],
  ['viet-nam.hai-phong', 0.05],
  ['viet-nam.da-nang', 0.05],
  ['viet-nam.binh-duong', 0.04],
  ['viet-nam.hai-duong', 0.04],
];

/* --------------------------------------------------------------- tạo hồ sơ */

function makePerson(i) {
  const isMale = chance(0.52);
  const gender = isMale ? 'male' : 'female';
  const name = `${pick(HO)} ${isMale ? pick(DEM_NAM) : pick(DEM_NU)} ${isMale ? pick(TEN_NAM) : pick(TEN_NU)}`;
  const age = between(22, 38);
  const birthYear = new Date().getFullYear() - age;
  const birth = `${birthYear}-${String(between(1, 12)).padStart(2, '0')}-${String(between(1, 28)).padStart(2, '0')}`;

  const goal = pick(['marriage', 'marriage', 'partner', 'partner', 'love', 'love', 'friends']);
  const seriousness = goal === 'friends' ? between(1, 3) : goal === 'love' ? between(2, 4) : between(4, 5);

  const region = pickRegion(REGION_WEIGHTS);
  // Rải toạ độ quanh trung tâm khu vực cho giống phân bố dân cư thật.
  const jitter = () => (rnd() - 0.5) * 0.06;

  return {
    name,
    gender,
    birth,
    age,
    region,
    lat: region.lat + jitter(),
    lng: region.lng + jitter(),
    profile: {
      display_name: name,
      birth_date: birth,
      gender,
      bio: pick(BIO),
      region_id: region.id,
      height_cm: isMale ? between(163, 183) : between(150, 170),
      body_type: pick(['slim', 'athletic', 'average', 'average', 'curvy']),
      marital_status: chance(0.88) ? 'single' : pick(['divorced', 'widowed']),
      has_children: chance(0.86) ? 'none' : pick(['yes_living_with', 'yes_not_living_with']),
      occupation: pick(NGHE),
      education: pick(['college', 'bachelor', 'bachelor', 'bachelor', 'master', 'vocational', 'high_school']),
      income_range: pick(['under_10m', '10_20m', '10_20m', '20_35m', '20_35m', '35_50m', 'over_50m', 'private']),
      religion: pick(['none', 'none', 'none', 'buddhism', 'buddhism', 'catholic', 'private']),
      smoking: isMale ? pick(['never', 'never', 'occasionally', 'regularly']) : pick(['never', 'never', 'never', 'occasionally']),
      drinking: pick(['never', 'occasionally', 'occasionally', 'occasionally', 'regularly']),
      relationship_goal: goal,
      seriousness,
      marriage_timeline:
        goal === 'marriage' ? pick(['asap', 'asap', '1_3_years'])
        : goal === 'partner' ? pick(['1_3_years', '1_3_years', 'over_3_years'])
        : goal === 'love' ? pick(['1_3_years', 'over_3_years', 'undecided'])
        : pick(['undecided', 'no_marriage']),
      children_wish:
        goal === 'friends' ? pick(['undecided', 'not_want', 'open'])
        : pick(['want', 'want', 'want', 'open', 'undecided', 'not_want']),
      living_preference: pick(['near_family', 'near_family', 'independent', 'flexible', 'flexible']),
      lifestyle_tags: pickN(LIFESTYLE, between(3, 6)),
      interest_tags: pickN(INTERESTS, between(3, 6)),
    },
    preference: {
      interested_in: [isMale ? 'female' : 'male'],
      age_min: Math.max(18, age - between(3, 7)),
      age_max: age + between(3, 8),
      max_distance_km: pick([5, 10, 10, 20, 20, 30, 50]),
      relationship_goals:
        goal === 'marriage' ? ['marriage', 'partner']
        : goal === 'partner' ? ['partner', 'marriage', 'love']
        : goal === 'love' ? ['love', 'partner']
        : ['friends'],
    },
  };
}

/* ----------------------------------------------------------------- chạy */

const target = Number(process.argv[2]) || 120;

const seedAll = transaction(() => {
  const created = [];

  for (let i = 0; i < target; i += 1) {
    const person = makePerson(i);
    const phone = `+849${String(10000000 + i * 7 + 13).slice(0, 8)}`;
    const email = `nguoidung${i + 1}@vigomatch.test`;

    const user = createUser({
      email,
      password: 'matkhau123',
      displayName: person.name,
    });
    markPhoneVerified(user.id, phone);

    updateProfile(user.id, person.profile);
    // Toạ độ riêng cho từng người (rải quanh trung tâm khu vực).
    run('UPDATE profiles SET lat = ?, lng = ?, location_updated_at = ? WHERE user_id = ?', [
      person.lat, person.lng, now(), user.id,
    ]);
    updatePreference(user.id, person.preference);

    insert(
      `INSERT INTO profile_photos (user_id, url, position, is_primary, status, created_at)
       VALUES (?, ?, 0, 1, 'approved', ?)`,
      [user.id, avatar(person.name), now()]
    );

    // Một số người đặt tiêu chí bắt buộc/ưu tiên.
    if (chance(0.45)) {
      addRule(user.id, { kind: 'must', field: 'smoking', operator: 'eq', value: 'never', weight: 5 });
    }
    if (chance(0.3)) {
      addRule(user.id, { kind: 'must', field: 'marital_status', operator: 'eq', value: 'single', weight: 4 });
    }
    if (chance(0.35)) {
      addRule(user.id, { kind: 'prefer', field: 'education', operator: 'gte', value: 'bachelor', weight: 3 });
    }
    if (chance(0.3)) {
      addRule(user.id, {
        kind: 'prefer',
        field: 'interest_tags',
        operator: 'contains_any',
        value: pickN(INTERESTS, 3),
        weight: 3,
      });
    }
    if (chance(0.25)) {
      addRule(user.id, { kind: 'prefer', field: 'living_preference', operator: 'eq', value: 'near_family', weight: 4 });
    }

    // Hoạt động gần đây, rải đều để danh sách trông sống động.
    run('UPDATE users SET last_active_at = ? WHERE id = ?', [
      now() - Math.floor(rnd() * 5 * 86400000), user.id,
    ]);
    if (chance(0.12)) grantPremium(user.id, 30);

    created.push({ id: user.id, ...person });
  }

  return created;
});

console.log(`Đang tạo ${target} hồ sơ mẫu...`);
migrate();
seedRegions();
const people = seedAll();
console.log(`✓ Đã tạo ${people.length} người dùng.`);

/* ------------------------------------- tương tác: thích, match, tin nhắn */

let likes = 0;
let matches = 0;
let messages = 0;

const GREETINGS = [
  'Chào bạn, mình thấy hai đứa có khá nhiều điểm chung đó.',
  'Hi bạn! Cuối tuần này bạn có dự định gì chưa?',
  'Chào bạn, mình cũng thích du lịch lắm. Bạn đi đâu gần đây chưa?',
  'Xin chào, rất vui khi được kết nối với bạn.',
  'Chào bạn, mình thấy bạn cũng thích cà phê. Quán nào bạn hay ngồi thế?',
];
const REPLIES = [
  'Chào bạn, mình cũng vừa định nhắn cho bạn đấy.',
  'Hi! Cuối tuần mình thường về quê, còn bạn?',
  'Mình mới đi Đà Lạt tháng trước, cảnh đẹp lắm.',
  'Rất vui được làm quen với bạn nhé.',
  'Mình hay ngồi mấy quán nhỏ trong ngõ, yên tĩnh dễ chịu.',
];

for (const person of people) {
  if (!chance(0.75)) continue;
  // Mỗi người thích một vài hồ sơ trong danh sách gợi ý của chính họ.
  let feed;
  try {
    const { discoverFeed } = await import('../src/services/discovery.js');
    feed = discoverFeed(person.id, { limit: 8 });
  } catch {
    continue;
  }
  for (const card of feed.items ?? []) {
    if (!chance(0.45)) continue;
    try {
      const result = react(person.id, card.profile.user_id, chance(0.9) ? 'like' : 'superlike');
      likes += 1;
      if (result.matched && result.conversation_id) {
        matches += 1;
        // Một nửa số cặp bắt đầu trò chuyện.
        if (chance(0.55)) {
          const g = Math.floor(rnd() * GREETINGS.length);
          sendMessage(person.id, result.conversation_id, GREETINGS[g]);
          messages += 1;
          if (chance(0.7)) {
            sendMessage(card.profile.user_id, result.conversation_id, REPLIES[g]);
            messages += 1;
          }
        }
      }
    } catch {
      /* hết lượt thích trong ngày hoặc bị lọc — bỏ qua */
    }
  }
}

console.log(`✓ ${likes} lượt thích · ${matches} lượt kết đôi · ${messages} tin nhắn.`);

/* ------------------------------------ vài báo cáo để thử trang quản trị */

let reports = 0;
for (let i = 0; i < Math.min(6, people.length / 10); i += 1) {
  const reporter = pick(people);
  const target2 = pick(people);
  if (reporter.id === target2.id) continue;
  try {
    createReport(reporter.id, {
      targetId: target2.id,
      category: pick(['spam', 'fake_profile', 'inappropriate', 'scam']),
      detail: 'Hồ sơ mẫu — dữ liệu dùng để thử nghiệm trang kiểm duyệt.',
    });
    reports += 1;
  } catch {
    /* trùng báo cáo */
  }
}
console.log(`✓ ${reports} báo cáo mẫu cho trang kiểm duyệt.`);

/* ----------------------------------------------------- tài khoản demo cố định */

const DEMO_EMAIL = 'dat@vigomatch.test';
if (!get('SELECT id FROM users WHERE email = ?', [DEMO_EMAIL])) {
  const demo = createUser({ email: DEMO_EMAIL, password: 'matkhau123', displayName: 'Tiến Đạt' });
  markPhoneVerified(demo.id, '+84900000001');
  const thuongPhuc = get("SELECT * FROM regions WHERE code LIKE '%thuong-tin.thuong-phuc'");
  updateProfile(demo.id, {
    display_name: 'Tiến Đạt',
    birth_date: `${new Date().getFullYear() - 25}-05-10`,
    gender: 'male',
    bio: 'Mình 25 tuổi, đang sống ở Thượng Phúc. Tìm một người để cùng xây dựng cuộc sống lâu dài.',
    region_id: thuongPhuc?.id,
    height_cm: 174,
    body_type: 'average',
    marital_status: 'single',
    has_children: 'none',
    occupation: 'Kỹ sư phần mềm',
    education: 'bachelor',
    income_range: '20_35m',
    religion: 'none',
    smoking: 'never',
    drinking: 'occasionally',
    relationship_goal: 'marriage',
    seriousness: 5,
    marriage_timeline: 'asap',
    children_wish: 'want',
    living_preference: 'near_family',
    lifestyle_tags: ['homebody', 'travel', 'saving', 'foodie'],
    interest_tags: ['music', 'coffee', 'football', 'tech'],
  });
  updatePreference(demo.id, {
    interested_in: ['female'],
    age_min: 20,
    age_max: 30,
    max_distance_km: 20,
    relationship_goals: ['marriage', 'partner'],
  });
  addRule(demo.id, { kind: 'must', field: 'smoking', operator: 'eq', value: 'never', weight: 5 });
  addRule(demo.id, { kind: 'prefer', field: 'living_preference', operator: 'eq', value: 'near_family', weight: 4 });
  insert(
    `INSERT INTO profile_photos (user_id, url, position, is_primary, status, created_at)
     VALUES (?, ?, 0, 1, 'approved', ?)`,
    [demo.id, avatar('Tiến Đạt'), now()]
  );
  console.log(`\n✓ Tài khoản demo: ${DEMO_EMAIL} / matkhau123`);
}

const stats = {
  users: get("SELECT COUNT(*) AS n FROM users WHERE status = 'active'").n,
  matches: get("SELECT COUNT(*) AS n FROM matches WHERE status = 'active'").n,
  messages: get('SELECT COUNT(*) AS n FROM messages').n,
};
console.log(`\nTổng cộng: ${stats.users} người dùng · ${stats.matches} kết đôi · ${stats.messages} tin nhắn.`);
console.log('Chạy `npm start` rồi mở http://localhost:3000\n');
