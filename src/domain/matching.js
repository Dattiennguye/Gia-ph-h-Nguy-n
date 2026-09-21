import { labelOf, ordinalScales, ruleFields } from './taxonomy.js';
import { haversineKm } from '../lib/geo.js';

/**
 * ĐỘNG CƠ GHÉP ĐÔI
 *
 * Hai tầng tách biệt:
 *   1. Tiêu chí BẮT BUỘC  → loại hẳn khỏi kết quả (hard filter, hai chiều).
 *   2. Tiêu chí ƯU TIÊN   → chỉ làm điểm phù hợp cao hay thấp (soft score).
 *
 * Điểm số không hiển thị trần trụi cho người dùng. Cái người dùng thấy là
 * "vì sao chúng tôi đề xuất người này": danh sách điểm phù hợp và điểm cần
 * cân nhắc, sinh ra từ chính các thành phần đã tính điểm.
 */

export const WEIGHTS = {
  goal: 20,          // Mục đích quan hệ
  marriage: 15,      // Quan điểm hôn nhân
  children: 10,      // Muốn có con
  distance: 15,      // Khoảng cách
  age: 10,           // Độ tuổi
  lifestyle: 10,     // Lối sống
  interests: 5,      // Sở thích
  rules: 15,         // Tiêu chí cá nhân (ưu tiên)
};

/* --------------------------------------------------------------- tiện ích */

export function ageFrom(birthDate, at = Date.now()) {
  if (!birthDate) return null;
  const b = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  const d = new Date(at);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const m = d.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && d.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

const asArray = (v) => (Array.isArray(v) ? v : []);

/** Lấy giá trị một trường của hồ sơ theo tên dùng trong luật. */
export function fieldValue(profile, field) {
  switch (field) {
    case 'age':
      return ageFrom(profile.birth_date);
    case 'verified':
      return Boolean(profile.identity_verified);
    case 'lifestyle_tags':
      return asArray(profile.lifestyle_tags);
    case 'interest_tags':
      return asArray(profile.interest_tags);
    default:
      return profile[field] ?? null;
  }
}

/** So sánh có thứ bậc cho các trường enum (học vấn, thu nhập...). */
function ordinalOf(field, value) {
  const scale = ordinalScales[field];
  if (!scale) return typeof value === 'number' ? value : Number(value);
  const idx = scale.indexOf(value);
  return idx === -1 ? null : idx;
}

/** Đánh giá một luật trên hồ sơ đối phương. Trả về true/false/null (không đủ dữ liệu). */
export function evaluateRule(rule, profile) {
  const actual = fieldValue(profile, rule.field);
  const expected = rule.value;

  if (actual === null || actual === undefined || actual === '') return null;

  switch (rule.operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'in':
      return asArray(expected).includes(actual);
    case 'not_in':
      return !asArray(expected).includes(actual);
    case 'gte': {
      const a = ordinalOf(rule.field, actual);
      const e = ordinalOf(rule.field, expected);
      return a === null || e === null ? null : a >= e;
    }
    case 'lte': {
      const a = ordinalOf(rule.field, actual);
      const e = ordinalOf(rule.field, expected);
      return a === null || e === null ? null : a <= e;
    }
    case 'between': {
      const [lo, hi] = asArray(expected);
      const a = Number(actual);
      return Number.isFinite(a) ? a >= Number(lo) && a <= Number(hi) : null;
    }
    case 'contains_any': {
      const tags = asArray(actual);
      return asArray(expected).some((v) => tags.includes(v));
    }
    case 'contains_all': {
      const tags = asArray(actual);
      return asArray(expected).every((v) => tags.includes(v));
    }
    default:
      return null;
  }
}

/** Mô tả một luật bằng tiếng Việt, để giải thích cho người dùng. */
export function describeRule(rule) {
  const meta = ruleFields[rule.field] ?? { label: rule.field };
  const val = (v) =>
    meta.source ? labelOf(meta.source, v) : Array.isArray(v) ? v.join(', ') : String(v);

  switch (rule.operator) {
    case 'eq':
      return `${meta.label}: ${val(rule.value)}`;
    case 'neq':
      return `${meta.label}: không phải ${val(rule.value)}`;
    case 'in':
      return `${meta.label}: ${asArray(rule.value).map(val).join(' hoặc ')}`;
    case 'not_in':
      return `${meta.label}: không thuộc ${asArray(rule.value).map(val).join(', ')}`;
    case 'gte':
      return `${meta.label}: từ ${val(rule.value)} trở lên`;
    case 'lte':
      return `${meta.label}: tối đa ${val(rule.value)}`;
    case 'between':
      return `${meta.label}: từ ${asArray(rule.value)[0]} đến ${asArray(rule.value)[1]}`;
    case 'contains_any':
      return `${meta.label}: ${asArray(rule.value).map(val).join(' / ')}`;
    case 'contains_all':
      return `${meta.label}: có đủ ${asArray(rule.value).map(val).join(', ')}`;
    default:
      return meta.label;
  }
}

/* ----------------------------------------------- ma trận tương thích quan điểm */

const GOAL_FIT = {
  love:     { love: 1,    partner: 0.85, marriage: 0.6,  friends: 0.2 },
  partner:  { love: 0.85, partner: 1,    marriage: 0.9,  friends: 0.15 },
  marriage: { love: 0.6,  partner: 0.9,  marriage: 1,    friends: 0.1 },
  friends:  { love: 0.2,  partner: 0.15, marriage: 0.1,  friends: 1 },
};

const MARRIAGE_FIT = {
  asap:         { asap: 1,    '1_3_years': 0.8, over_3_years: 0.4, undecided: 0.35, no_marriage: 0 },
  '1_3_years':  { asap: 0.8,  '1_3_years': 1,   over_3_years: 0.75, undecided: 0.5, no_marriage: 0.05 },
  over_3_years: { asap: 0.4,  '1_3_years': 0.75, over_3_years: 1,  undecided: 0.6, no_marriage: 0.2 },
  undecided:    { asap: 0.35, '1_3_years': 0.5, over_3_years: 0.6, undecided: 0.75, no_marriage: 0.4 },
  no_marriage:  { asap: 0,    '1_3_years': 0.05, over_3_years: 0.2, undecided: 0.4, no_marriage: 1 },
};

const CHILDREN_FIT = {
  want:      { want: 1,   not_want: 0,   undecided: 0.5, open: 0.85 },
  not_want:  { want: 0,   not_want: 1,   undecided: 0.5, open: 0.85 },
  undecided: { want: 0.5, not_want: 0.5, undecided: 0.75, open: 0.7 },
  open:      { want: 0.85, not_want: 0.85, undecided: 0.7, open: 0.9 },
};

const LIVING_FIT = {
  near_family:  { near_family: 1, independent: 0.3, flexible: 0.8 },
  independent:  { near_family: 0.3, independent: 1, flexible: 0.8 },
  flexible:     { near_family: 0.8, independent: 0.8, flexible: 1 },
};

function tagOverlap(a, b) {
  const A = new Set(asArray(a));
  const B = new Set(asArray(b));
  if (A.size === 0 || B.size === 0) return null;
  const shared = [...A].filter((t) => B.has(t));
  const union = new Set([...A, ...B]).size;
  const jaccard = shared.length / union;
  const absolute = Math.min(shared.length, 3) / 3;
  return { score: jaccard * 0.3 + absolute * 0.7, shared };
}

/* ------------------------------------------------------------ tiêu chí cứng */

/**
 * Kiểm tra các điều kiện loại trừ, HAI CHIỀU: nhu cầu của người xem áp lên đối
 * phương, và nhu cầu của đối phương áp lên người xem. Không hiển thị người đã
 * loại mình ra — đó là tôn trọng cả hai phía.
 */
export function hardFilter(viewer, candidate, distanceKm) {
  const blocked = [];

  const check = (side, other, dir) => {
    const pref = side.preference;
    const prof = other.profile;
    const age = ageFrom(prof.birth_date);

    const wanted = asArray(pref?.interested_in);
    if (wanted.length && prof.gender && !wanted.includes(prof.gender)) {
      blocked.push({ dir, reason: 'gender', label: 'Không đúng giới tính đang tìm' });
    }
    if (age != null && pref) {
      if (age < pref.age_min || age > pref.age_max) {
        blocked.push({ dir, reason: 'age', label: 'Ngoài khoảng tuổi mong muốn' });
      }
    }
    if (distanceKm != null && pref && distanceKm > pref.max_distance_km) {
      blocked.push({ dir, reason: 'distance', label: 'Ngoài bán kính tìm kiếm' });
    }
    const goals = asArray(pref?.relationship_goals);
    if (goals.length && prof.relationship_goal && !goals.includes(prof.relationship_goal)) {
      // Mục đích khác nhau không loại hẳn, trừ khi lệch hoàn toàn (bạn bè ↔ kết hôn).
      const fit = GOAL_FIT[prof.relationship_goal]?.[goals[0]] ?? 0.5;
      if (fit <= 0.2) {
        blocked.push({ dir, reason: 'goal', label: 'Mục đích tìm kiếm khác nhau' });
      }
    }
    for (const rule of side.rules ?? []) {
      if (rule.kind !== 'must') continue;
      const ok = evaluateRule(rule, prof);
      if (ok === false) {
        blocked.push({ dir, reason: `rule:${rule.field}`, label: describeRule(rule) });
      }
    }
  };

  check(viewer, candidate, 'viewer');
  check(candidate, viewer, 'candidate');
  return blocked;
}

/* ------------------------------------------------------------- điểm phù hợp */

function pushComponent(list, key, weight, score, detail) {
  list.push({ key, weight, score, ...detail });
}

/**
 * Tính điểm phù hợp giữa hai người.
 * Thành phần nào thiếu dữ liệu sẽ bị bỏ qua và trọng số của nó được chia lại
 * cho các thành phần còn lại — hồ sơ chưa điền hết vẫn ghép được, chỉ là kém
 * chắc chắn hơn.
 */
export function scorePair(viewer, candidate, options = {}) {
  const vp = viewer.profile;
  const cp = candidate.profile;
  const pref = viewer.preference ?? {};

  const distanceKm =
    options.distanceKm !== undefined
      ? options.distanceKm
      : haversineKm(vp.lat, vp.lng, cp.lat, cp.lng);

  const components = [];

  // 1. Mục đích quan hệ
  if (vp.relationship_goal && cp.relationship_goal) {
    const fit = GOAL_FIT[vp.relationship_goal]?.[cp.relationship_goal] ?? 0.5;
    pushComponent(components, 'goal', WEIGHTS.goal, fit, {
      positive: `Cùng ${labelOf('relationship_goal', cp.relationship_goal).toLowerCase()}`,
      negative: `Bạn ${labelOf('relationship_goal', vp.relationship_goal).toLowerCase()}, người ấy ${labelOf('relationship_goal', cp.relationship_goal).toLowerCase()}`,
      same: vp.relationship_goal === cp.relationship_goal,
    });
  }

  // 2. Quan điểm hôn nhân
  if (vp.marriage_timeline && cp.marriage_timeline) {
    const fit = MARRIAGE_FIT[vp.marriage_timeline]?.[cp.marriage_timeline] ?? 0.5;
    pushComponent(components, 'marriage', WEIGHTS.marriage, fit, {
      positive:
        vp.marriage_timeline === cp.marriage_timeline
          ? `Cùng quan điểm: ${labelOf('marriage_timeline', cp.marriage_timeline).toLowerCase()}`
          : 'Quan điểm hôn nhân gần nhau',
      negative: `Bạn ${labelOf('marriage_timeline', vp.marriage_timeline).toLowerCase()}, người ấy ${labelOf('marriage_timeline', cp.marriage_timeline).toLowerCase()}`,
      same: vp.marriage_timeline === cp.marriage_timeline,
    });
  }

  // 3. Con cái
  if (vp.children_wish && cp.children_wish) {
    const fit = CHILDREN_FIT[vp.children_wish]?.[cp.children_wish] ?? 0.5;
    pushComponent(components, 'children', WEIGHTS.children, fit, {
      positive:
        vp.children_wish === cp.children_wish
          ? `Cùng ${labelOf('children_wish', cp.children_wish).toLowerCase()}`
          : 'Quan điểm về con cái tương thích',
      negative: `Bạn ${labelOf('children_wish', vp.children_wish).toLowerCase()}, người ấy ${labelOf('children_wish', cp.children_wish).toLowerCase()}`,
      same: vp.children_wish === cp.children_wish,
    });
  }

  // 4. Khoảng cách
  if (distanceKm != null) {
    const max = Math.max(1, pref.max_distance_km ?? 20);
    const fit = distanceKm > max ? 0 : 1 - 0.6 * (distanceKm / max);
    pushComponent(components, 'distance', WEIGHTS.distance, fit, {
      positive:
        distanceKm < 1
          ? 'Ở rất gần bạn'
          : `Cách nhau khoảng ${distanceKm < 10 ? distanceKm.toFixed(1) : Math.round(distanceKm)} km`,
      negative: `Cách nhau khoảng ${Math.round(distanceKm)} km — khá xa so với bán kính bạn đặt`,
      distanceKm,
    });
  }

  // 5. Độ tuổi
  const cAge = ageFrom(cp.birth_date);
  if (cAge != null) {
    const lo = pref.age_min ?? 18;
    const hi = pref.age_max ?? 60;
    let fit;
    if (cAge >= lo && cAge <= hi) {
      const center = (lo + hi) / 2;
      const half = Math.max(1, (hi - lo) / 2);
      fit = 1 - 0.25 * (Math.abs(cAge - center) / half);
    } else {
      const off = cAge < lo ? lo - cAge : cAge - hi;
      fit = Math.max(0, 1 - 0.25 * off);
    }
    pushComponent(components, 'age', WEIGHTS.age, fit, {
      positive: `${cAge} tuổi — nằm trong khoảng bạn mong muốn`,
      negative: `${cAge} tuổi — ngoài khoảng ${lo}–${hi} bạn đặt`,
      age: cAge,
    });
  }

  // 6. Lối sống
  const life = tagOverlap(vp.lifestyle_tags, cp.lifestyle_tags);
  if (life) {
    pushComponent(components, 'lifestyle', WEIGHTS.lifestyle, life.score, {
      positive: life.shared.length
        ? `Lối sống giống nhau: ${life.shared.slice(0, 3).map((t) => labelOf('lifestyle', t).toLowerCase()).join(', ')}`
        : 'Lối sống khác nhau',
      negative: 'Lối sống hai bạn khá khác nhau',
      shared: life.shared,
    });
  }

  // 7. Sở thích
  const hobby = tagOverlap(vp.interest_tags, cp.interest_tags);
  if (hobby) {
    pushComponent(components, 'interests', WEIGHTS.interests, hobby.score, {
      positive: hobby.shared.length
        ? `Cùng thích ${hobby.shared.slice(0, 3).map((t) => labelOf('interests', t).toLowerCase()).join(', ')}`
        : 'Chưa có sở thích chung',
      negative: 'Chưa tìm thấy sở thích chung',
      shared: hobby.shared,
    });
  }

  // 8. Tiêu chí ưu tiên của riêng người dùng
  const preferRules = (viewer.rules ?? []).filter((r) => r.kind === 'prefer');
  const ruleResults = [];
  if (preferRules.length) {
    let got = 0;
    let total = 0;
    for (const rule of preferRules) {
      const ok = evaluateRule(rule, cp);
      if (ok === null) continue;
      total += rule.weight;
      if (ok) got += rule.weight;
      ruleResults.push({ rule, ok, text: describeRule(rule) });
    }
    if (total > 0) {
      pushComponent(components, 'rules', WEIGHTS.rules, got / total, {
        positive: 'Đáp ứng các tiêu chí bạn ưu tiên',
        negative: 'Chưa đáp ứng một số tiêu chí bạn ưu tiên',
        results: ruleResults,
      });
    }
  }

  // Thành phần phụ: nơi ở sau kết hôn — không có trọng số riêng nhưng luôn
  // được nêu ra trong phần "điểm cần cân nhắc" vì đây là khác biệt dễ đổ vỡ.
  let livingNote = null;
  if (vp.living_preference && cp.living_preference) {
    const fit = LIVING_FIT[vp.living_preference]?.[cp.living_preference] ?? 0.5;
    livingNote = {
      fit,
      positive: `Cùng ${labelOf('living_preference', cp.living_preference).toLowerCase()}`,
      negative: `Bạn ${labelOf('living_preference', vp.living_preference).toLowerCase()}, người ấy ${labelOf('living_preference', cp.living_preference).toLowerCase()}`,
    };
  }

  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const raw = totalWeight
    ? components.reduce((s, c) => s + c.weight * c.score, 0) / totalWeight
    : 0;

  // Hồ sơ điền đầy đủ hơn thì kết quả đáng tin hơn — phản ánh nhẹ vào điểm.
  const confidence = totalWeight / Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  const score = Math.round(raw * 100 * (0.85 + 0.15 * confidence));

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence: Math.round(confidence * 100),
    distanceKm,
    components,
    livingNote,
    breakdown: Object.fromEntries(
      components.map((c) => [c.key, Math.round(c.score * 100)])
    ),
  };
}

/**
 * Chuyển kết quả tính điểm thành lời giải thích cho người dùng:
 * "Vì sao chúng tôi đề xuất người này?"
 */
export function explain(result) {
  const positives = [];
  const considerations = [];

  for (const c of result.components) {
    if (c.key === 'rules') {
      for (const r of c.results ?? []) {
        if (r.ok) positives.push({ key: `rule:${r.rule.field}`, text: r.text });
        else considerations.push({ key: `rule:${r.rule.field}`, text: `Chưa đáp ứng: ${r.text}` });
      }
      continue;
    }
    const posAt = c.key === 'lifestyle' || c.key === 'interests' ? 0.6 : 0.75;
    if (c.score >= posAt && c.positive) {
      positives.push({ key: c.key, text: c.positive });
    } else if (c.score <= 0.45 && c.negative) {
      considerations.push({ key: c.key, text: c.negative });
    }
  }

  if (result.livingNote) {
    if (result.livingNote.fit >= 0.8) {
      positives.push({ key: 'living', text: result.livingNote.positive });
    } else if (result.livingNote.fit <= 0.5) {
      considerations.push({ key: 'living', text: result.livingNote.negative });
    }
  }

  return {
    score: result.score,
    positives: positives.slice(0, 6),
    considerations: considerations.slice(0, 4),
    headline:
      positives.length >= 4
        ? `Hai bạn có ${positives.length} điểm chung quan trọng`
        : positives.length > 0
          ? `${positives.length} điểm phù hợp`
          : 'Một gợi ý để bạn thử tìm hiểu',
  };
}

/** Nhãn mức độ phù hợp — thứ người dùng nhìn thấy thay cho con số trần trụi. */
export function matchTier(score) {
  if (score >= 85) return { key: 'excellent', label: 'Rất phù hợp' };
  if (score >= 70) return { key: 'high', label: 'Phù hợp cao' };
  if (score >= 55) return { key: 'medium', label: 'Khá phù hợp' };
  return { key: 'low', label: 'Có thể thử tìm hiểu' };
}
