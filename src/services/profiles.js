import { all, get, insert, run, now, parseJson, transaction } from '../db/index.js';
import { getRegion, publicRegionLabel, regionPath } from './regions.js';
import { computeCompleteness } from '../domain/insights.js';
import { ageFrom } from '../domain/matching.js';
import { labelOf, ruleFields, isValid } from '../domain/taxonomy.js';
import { badRequest, notFound } from '../lib/http.js';
import { imageUrl } from '../lib/validate.js';
import { storeImage, deleteImage } from '../lib/images.js';
import { fuzzyDistanceKm, fuzzyDistanceLabel } from '../lib/geo.js';

/* ------------------------------------------------------- đọc ra dạng dùng được */

/** Hồ sơ đầy đủ kèm mảng JSON đã giải mã — dùng nội bộ cho thuật toán. */
export function loadProfile(userId) {
  const row = get('SELECT * FROM profiles WHERE user_id = ?', [userId]);
  if (!row) return null;
  const user = get('SELECT phone_verified, status, last_active_at, risk_score FROM users WHERE id = ?', [userId]);
  const verifs = all('SELECT type, status FROM verifications WHERE user_id = ?', [userId]);
  return {
    ...row,
    lifestyle_tags: parseJson(row.lifestyle_tags, []),
    interest_tags: parseJson(row.interest_tags, []),
    phone_verified: Boolean(user?.phone_verified),
    photo_verified: verifs.some((v) => v.type === 'photo' && v.status === 'approved'),
    identity_verified: verifs.some((v) => v.type === 'identity' && v.status === 'approved'),
    last_active_at: user?.last_active_at ?? null,
    user_status: user?.status,
  };
}

export function loadPreference(userId) {
  const row = get('SELECT * FROM preferences WHERE user_id = ?', [userId]);
  if (!row) return null;
  return {
    ...row,
    interested_in: parseJson(row.interested_in, []),
    relationship_goals: parseJson(row.relationship_goals, []),
  };
}

export function loadRules(userId) {
  return all('SELECT * FROM preference_rules WHERE user_id = ? ORDER BY kind, id', [userId]).map(
    (r) => ({ ...r, value: parseJson(r.value, null) })
  );
}

/** Gói đầy đủ một "người xem": hồ sơ + nhu cầu + luật. */
export function loadViewer(userId) {
  const profile = loadProfile(userId);
  if (!profile) return null;
  return { userId, profile, preference: loadPreference(userId), rules: loadRules(userId) };
}

export function loadPhotos(userId) {
  return all(
    `SELECT id, url, position, is_primary, status FROM profile_photos
     WHERE user_id = ? AND status != 'rejected' ORDER BY is_primary DESC, position, id`,
    [userId]
  );
}

/* ------------------------------------------------------------- trả ra API */

/**
 * Hồ sơ như CHÍNH CHỦ nhìn thấy. Có toạ độ (của chính họ), có độ đầy đủ.
 */
export function selfView(userId) {
  const p = loadProfile(userId);
  if (!p) throw notFound('Không tìm thấy hồ sơ');
  const region = p.region_id ? getRegion(p.region_id) : null;
  return {
    user_id: p.user_id,
    display_name: p.display_name,
    birth_date: p.birth_date,
    age: ageFrom(p.birth_date),
    gender: p.gender,
    bio: p.bio,
    region: region
      ? {
          id: region.id,
          name: region.name,
          full_name: region.full_name,
          path: regionPath(region.id).map((r) => ({ id: r.id, name: r.name, level: r.level })),
        }
      : null,
    height_cm: p.height_cm,
    body_type: p.body_type,
    marital_status: p.marital_status,
    has_children: p.has_children,
    occupation: p.occupation,
    education: p.education,
    income_range: p.income_range,
    religion: p.religion,
    smoking: p.smoking,
    drinking: p.drinking,
    relationship_goal: p.relationship_goal,
    seriousness: p.seriousness,
    marriage_timeline: p.marriage_timeline,
    children_wish: p.children_wish,
    living_preference: p.living_preference,
    lifestyle_tags: p.lifestyle_tags,
    interest_tags: p.interest_tags,
    photos: loadPhotos(userId),
    visibility: p.visibility,
    completeness: p.completeness,
    verification: {
      phone: p.phone_verified,
      photo: p.photo_verified,
      identity: p.identity_verified,
    },
    boosted_until: p.boosted_until,
  };
}

/**
 * Hồ sơ như NGƯỜI KHÁC nhìn thấy.
 *
 * Quy tắc riêng tư, áp dụng không có ngoại lệ:
 *   - Không bao giờ có lat/lng.
 *   - Khu vực chỉ tới cấp quận/huyện.
 *   - Khoảng cách được làm tròn.
 *   - Không có email, số điện thoại, dữ liệu giấy tờ.
 */
export function publicView(profile, { distanceKm = null, viewer = null } = {}) {
  const tagLabels = (group, tags) => tags.map((t) => ({ value: t, label: labelOf(group, t) }));
  const shared = (group, tags) =>
    viewer ? tags.filter((t) => (viewer.profile?.[group] ?? []).includes(t)) : [];

  return {
    user_id: profile.user_id,
    display_name: profile.display_name,
    age: ageFrom(profile.birth_date),
    gender: profile.gender,
    gender_label: labelOf('gender', profile.gender),
    bio: profile.bio,
    area: publicRegionLabel(profile.region_id),
    distance_km: fuzzyDistanceKm(distanceKm),
    distance_label: fuzzyDistanceLabel(distanceKm),
    height_cm: profile.height_cm,
    body_type_label: labelOf('body_type', profile.body_type),
    occupation: profile.occupation,
    education_label: labelOf('education', profile.education),
    marital_status_label: labelOf('marital_status', profile.marital_status),
    relationship_goal: profile.relationship_goal,
    relationship_goal_label: labelOf('relationship_goal', profile.relationship_goal),
    marriage_timeline_label: labelOf('marriage_timeline', profile.marriage_timeline),
    children_wish_label: labelOf('children_wish', profile.children_wish),
    living_preference_label: labelOf('living_preference', profile.living_preference),
    smoking_label: labelOf('smoking', profile.smoking),
    drinking_label: labelOf('drinking', profile.drinking),
    religion_label:
      profile.religion === 'private' ? null : labelOf('religion', profile.religion),
    income_label: profile.income_range === 'private' ? null : labelOf('income_range', profile.income_range),
    seriousness: profile.seriousness,
    lifestyle_tags: tagLabels('lifestyle', profile.lifestyle_tags ?? []),
    interest_tags: tagLabels('interests', profile.interest_tags ?? []),
    shared_lifestyle: shared('lifestyle_tags', profile.lifestyle_tags ?? []),
    shared_interests: shared('interest_tags', profile.interest_tags ?? []),
    photos: loadPhotos(profile.user_id).map((p) => ({ url: p.url, is_primary: p.is_primary })),
    verification: {
      phone: Boolean(profile.phone_verified),
      photo: Boolean(profile.photo_verified),
      identity: Boolean(profile.identity_verified),
    },
    last_active: relativeActivity(profile.last_active_at),
  };
}

function relativeActivity(ts) {
  if (!ts) return null;
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 10) return 'Đang hoạt động';
  if (mins < 60) return `Hoạt động ${mins} phút trước`;
  if (mins < 1440) return `Hoạt động ${Math.floor(mins / 60)} giờ trước`;
  const days = Math.floor(mins / 1440);
  if (days <= 7) return `Hoạt động ${days} ngày trước`;
  return 'Đã lâu không hoạt động';
}

/* -------------------------------------------------------------- ghi dữ liệu */

const PROFILE_ENUMS = {
  gender: 'gender',
  body_type: 'body_type',
  marital_status: 'marital_status',
  has_children: 'has_children',
  education: 'education',
  income_range: 'income_range',
  religion: 'religion',
  smoking: 'smoking',
  drinking: 'drinking',
  relationship_goal: 'relationship_goal',
  marriage_timeline: 'marriage_timeline',
  children_wish: 'children_wish',
  living_preference: 'living_preference',
};

export const updateProfile = transaction((userId, patch) => {
  const current = loadProfile(userId);
  if (!current) throw notFound('Không tìm thấy hồ sơ');

  const sets = [];
  const params = [];
  const put = (col, val) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };

  if (patch.display_name !== undefined) {
    const name = String(patch.display_name).trim();
    if (name.length < 2 || name.length > 50) throw badRequest('Tên hiển thị phải từ 2 đến 50 ký tự');
    put('display_name', name);
  }
  if (patch.bio !== undefined) {
    const bio = String(patch.bio ?? '').trim();
    if (bio.length > 1000) throw badRequest('Phần giới thiệu không quá 1000 ký tự');
    put('bio', bio);
  }
  if (patch.birth_date !== undefined) put('birth_date', patch.birth_date);
  if (patch.occupation !== undefined) {
    put('occupation', patch.occupation ? String(patch.occupation).trim().slice(0, 100) : null);
  }
  if (patch.height_cm !== undefined) {
    const h = patch.height_cm == null ? null : Number(patch.height_cm);
    if (h != null && (!Number.isInteger(h) || h < 130 || h > 220)) {
      throw badRequest('Chiều cao phải từ 130 đến 220 cm');
    }
    put('height_cm', h);
  }
  if (patch.seriousness !== undefined) {
    const s = patch.seriousness == null ? null : Number(patch.seriousness);
    if (s != null && (!Number.isInteger(s) || s < 1 || s > 5)) {
      throw badRequest('Mức độ nghiêm túc phải từ 1 đến 5');
    }
    put('seriousness', s);
  }

  for (const [col, group] of Object.entries(PROFILE_ENUMS)) {
    if (patch[col] === undefined) continue;
    const v = patch[col];
    if (v === null || v === '') {
      put(col, null);
      continue;
    }
    if (!isValid(group, v)) throw badRequest(`Giá trị không hợp lệ cho "${col}": ${v}`);
    put(col, v);
  }

  for (const [col, group] of [['lifestyle_tags', 'lifestyle'], ['interest_tags', 'interests']]) {
    if (patch[col] === undefined) continue;
    if (!Array.isArray(patch[col])) throw badRequest(`"${col}" phải là danh sách`);
    if (patch[col].length > 15) throw badRequest('Chọn tối đa 15 mục');
    for (const v of patch[col]) {
      if (!isValid(group, v)) throw badRequest(`Giá trị không hợp lệ trong "${col}": ${v}`);
    }
    put(col, JSON.stringify([...new Set(patch[col])]));
  }

  if (patch.region_id !== undefined) {
    const region = getRegion(patch.region_id);
    if (!region) throw badRequest('Khu vực không tồn tại');
    if (region.level === 'country') throw badRequest('Hãy chọn tới cấp tỉnh/thành trở xuống');
    put('region_id', region.id);
    // Toạ độ mặc định lấy theo trung tâm khu vực; người dùng có thể ghi đè bằng
    // vị trí thiết bị qua updateLocation().
    if (patch.lat === undefined && region.lat != null) {
      put('lat', region.lat);
      put('lng', region.lng);
      put('location_updated_at', now());
    }
  }
  if (patch.visibility !== undefined) {
    if (!['public', 'hidden', 'paused'].includes(patch.visibility)) {
      throw badRequest('Trạng thái hiển thị không hợp lệ');
    }
    put('visibility', patch.visibility);
  }

  if (!sets.length) return selfView(userId);

  put('updated_at', now());
  run(`UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`, [...params, userId]);

  // Tính lại độ đầy đủ sau mỗi lần sửa.
  const fresh = loadProfile(userId);
  run('UPDATE profiles SET completeness = ? WHERE user_id = ?', [
    computeCompleteness(fresh),
    userId,
  ]);
  return selfView(userId);
});

/** Cập nhật vị trí thật từ thiết bị. Chỉ dùng để tính khoảng cách. */
export function updateLocation(userId, lat, lng) {
  if (
    typeof lat !== 'number' || typeof lng !== 'number' ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    throw badRequest('Toạ độ không hợp lệ');
  }
  run('UPDATE profiles SET lat = ?, lng = ?, location_updated_at = ?, updated_at = ? WHERE user_id = ?', [
    lat, lng, now(), now(), userId,
  ]);
  return { ok: true };
}

/* ------------------------------------------------------------------- ảnh */

export function addPhoto(userId, url) {
  const validated = imageUrl(url, 'url');
  const count = get('SELECT COUNT(*) AS n FROM profile_photos WHERE user_id = ?', [userId]).n;
  if (count >= 9) throw badRequest('Mỗi hồ sơ tối đa 9 ảnh');
  // Ảnh được ghi ra tệp; cơ sở dữ liệu chỉ giữ đường dẫn.
  const safeUrl = storeImage(validated, { prefix: `u${userId}` });
  const id = insert(
    `INSERT INTO profile_photos (user_id, url, position, is_primary, status, created_at)
     VALUES (?, ?, ?, ?, 'approved', ?)`,
    [userId, safeUrl, count, count === 0 ? 1 : 0, now()]
  );
  return get('SELECT * FROM profile_photos WHERE id = ?', [id]);
}

export function deletePhoto(userId, photoId) {
  const photo = get('SELECT * FROM profile_photos WHERE id = ? AND user_id = ?', [photoId, userId]);
  if (!photo) throw notFound('Không tìm thấy ảnh');
  run('DELETE FROM profile_photos WHERE id = ?', [photoId]);
  deleteImage(photo.url);
  if (photo.is_primary) {
    const next = get(
      'SELECT id FROM profile_photos WHERE user_id = ? ORDER BY position, id LIMIT 1',
      [userId]
    );
    if (next) run('UPDATE profile_photos SET is_primary = 1 WHERE id = ?', [next.id]);
  }
  return { ok: true };
}

export function setPrimaryPhoto(userId, photoId) {
  const photo = get('SELECT * FROM profile_photos WHERE id = ? AND user_id = ?', [photoId, userId]);
  if (!photo) throw notFound('Không tìm thấy ảnh');
  run('UPDATE profile_photos SET is_primary = 0 WHERE user_id = ?', [userId]);
  run('UPDATE profile_photos SET is_primary = 1 WHERE id = ?', [photoId]);
  return { ok: true };
}

/* -------------------------------------------------------------- nhu cầu */

export function updatePreference(userId, patch) {
  const current = loadPreference(userId);
  const sets = [];
  const params = [];
  const put = (c, v) => {
    sets.push(`${c} = ?`);
    params.push(v);
  };

  if (patch.interested_in !== undefined) {
    if (!Array.isArray(patch.interested_in)) throw badRequest('"interested_in" phải là danh sách');
    for (const g of patch.interested_in) {
      if (!isValid('gender', g)) throw badRequest(`Giới tính không hợp lệ: ${g}`);
    }
    put('interested_in', JSON.stringify([...new Set(patch.interested_in)]));
  }
  if (patch.relationship_goals !== undefined) {
    if (!Array.isArray(patch.relationship_goals)) throw badRequest('"relationship_goals" phải là danh sách');
    for (const g of patch.relationship_goals) {
      if (!isValid('relationship_goal', g)) throw badRequest(`Mục đích không hợp lệ: ${g}`);
    }
    put('relationship_goals', JSON.stringify([...new Set(patch.relationship_goals)]));
  }

  const ageMin = patch.age_min ?? current.age_min;
  const ageMax = patch.age_max ?? current.age_max;
  if (patch.age_min !== undefined || patch.age_max !== undefined) {
    if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax)) throw badRequest('Khoảng tuổi phải là số nguyên');
    if (ageMin < 18) throw badRequest('Tuổi tối thiểu là 18');
    if (ageMax > 99) throw badRequest('Tuổi tối đa là 99');
    if (ageMin > ageMax) throw badRequest('Tuổi tối thiểu không được lớn hơn tuổi tối đa');
    put('age_min', ageMin);
    put('age_max', ageMax);
  }
  if (patch.max_distance_km !== undefined) {
    const d = Number(patch.max_distance_km);
    if (!Number.isInteger(d) || d < 1 || d > 200) throw badRequest('Bán kính phải từ 1 đến 200 km');
    put('max_distance_km', d);
  }

  if (sets.length) {
    put('updated_at', now());
    run(`UPDATE preferences SET ${sets.join(', ')} WHERE user_id = ?`, [...params, userId]);
  }
  return loadPreference(userId);
}

/* ------------------------------------------------------ tiêu chí bắt buộc/ưu tiên */

const OPERATORS_BY_TYPE = {
  enum: ['eq', 'neq', 'in', 'not_in', 'gte', 'lte'],
  number: ['eq', 'gte', 'lte', 'between'],
  tags: ['contains_any', 'contains_all'],
  bool: ['eq'],
};

export function addRule(userId, { kind, field, operator, value, weight = 3 }) {
  if (!['must', 'prefer'].includes(kind)) throw badRequest('Loại tiêu chí phải là "must" hoặc "prefer"');
  const meta = ruleFields[field];
  if (!meta) throw badRequest(`Không hỗ trợ tiêu chí trên trường "${field}"`);
  if (!OPERATORS_BY_TYPE[meta.type].includes(operator)) {
    throw badRequest(`Phép so sánh "${operator}" không dùng được với "${meta.label}"`);
  }

  // Kiểm tra giá trị khớp kiểu của trường.
  const arrayOps = ['in', 'not_in', 'contains_any', 'contains_all', 'between'];
  if (arrayOps.includes(operator)) {
    if (!Array.isArray(value) || value.length === 0) {
      throw badRequest('Giá trị phải là một danh sách không rỗng');
    }
    if (operator === 'between') {
      if (value.length !== 2 || value.some((v) => !Number.isFinite(Number(v)))) {
        throw badRequest('Khoảng giá trị phải gồm đúng hai số');
      }
    } else if (meta.source) {
      for (const v of value) {
        if (!isValid(meta.source, v)) throw badRequest(`Giá trị không hợp lệ: ${v}`);
      }
    }
  } else if (meta.type === 'number') {
    if (!Number.isFinite(Number(value))) throw badRequest('Giá trị phải là số');
    if (meta.min != null && Number(value) < meta.min) throw badRequest(`Giá trị tối thiểu là ${meta.min}`);
    if (meta.max != null && Number(value) > meta.max) throw badRequest(`Giá trị tối đa là ${meta.max}`);
  } else if (meta.type === 'bool') {
    if (typeof value !== 'boolean') throw badRequest('Giá trị phải là true hoặc false');
  } else if (meta.source && !isValid(meta.source, value)) {
    throw badRequest(`Giá trị không hợp lệ: ${value}`);
  }

  const w = Number(weight);
  if (!Number.isInteger(w) || w < 1 || w > 5) throw badRequest('Trọng số phải từ 1 đến 5');

  const existingCount = get(
    'SELECT COUNT(*) AS n FROM preference_rules WHERE user_id = ? AND kind = ?',
    [userId, kind]
  ).n;
  if (existingCount >= 12) throw badRequest(`Tối đa 12 tiêu chí ${kind === 'must' ? 'bắt buộc' : 'ưu tiên'}`);

  // Một trường chỉ có một luật cùng loại — sửa thì thay luôn.
  run('DELETE FROM preference_rules WHERE user_id = ? AND kind = ? AND field = ?', [
    userId, kind, field,
  ]);
  const id = insert(
    `INSERT INTO preference_rules (user_id, kind, field, operator, value, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, kind, field, operator, JSON.stringify(value), w, now()]
  );
  return loadRules(userId).find((r) => r.id === id);
}

export function deleteRule(userId, ruleId) {
  const r = get('SELECT * FROM preference_rules WHERE id = ? AND user_id = ?', [ruleId, userId]);
  if (!r) throw notFound('Không tìm thấy tiêu chí');
  run('DELETE FROM preference_rules WHERE id = ?', [ruleId]);
  return { ok: true };
}
