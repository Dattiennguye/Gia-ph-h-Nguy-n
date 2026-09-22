import { all, get, insert, run, now, parseJson } from '../db/index.js';
import { loadViewer, loadProfile, publicView } from './profiles.js';
import { hardFilter, scorePair, explain, matchTier } from '../domain/matching.js';
import { haversineKm, boundingBox, jitterPoint, fuzzyDistanceKm } from '../lib/geo.js';
import { seededUnit } from '../lib/crypto.js';
import { publicRegionLabel } from './regions.js';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/http.js';
import { isPremium } from './billing.js';

/**
 * Lấy tập ứng viên thô: những người còn hoạt động, hiển thị công khai, chưa bị
 * chặn hai chiều, và nằm trong hộp bao quanh bán kính tìm kiếm.
 *
 * Lọc thô bằng SQL trước, rồi mới tính khoảng cách chính xác và điểm phù hợp
 * trong bộ nhớ — vừa nhanh vừa giữ được toàn bộ logic ghép đôi ở một chỗ.
 */
export function candidatePool(viewer, { radiusKm, includeSeen = false, limit = 500 } = {}) {
  const p = viewer.profile;
  if (p.lat == null || p.lng == null) return [];

  const radius = radiusKm ?? viewer.preference?.max_distance_km ?? 20;
  const box = boundingBox(p.lat, p.lng, radius * 1.2);

  const seenClause = includeSeen
    ? ''
    : 'AND NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_user = ? AND l.to_user = pr.user_id)';
  const params = [
    p.user_id,
    box.minLat, box.maxLat, box.minLng, box.maxLng,
    p.user_id, p.user_id,
  ];
  if (!includeSeen) params.push(p.user_id);

  const rows = all(
    `SELECT pr.* FROM profiles pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.user_id != ?
       AND u.status = 'active'
       AND pr.visibility = 'public'
       AND pr.lat BETWEEN ? AND ?
       AND pr.lng BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM blocks b
                       WHERE (b.user_id = pr.user_id AND b.blocked_id = ?)
                          OR (b.user_id = ? AND b.blocked_id = pr.user_id))
       ${seenClause}
     LIMIT ?`,
    [...params, limit]
  );

  return rows.map((row) => {
    const profile = {
      ...row,
      lifestyle_tags: parseJson(row.lifestyle_tags, []),
      interest_tags: parseJson(row.interest_tags, []),
    };
    return { userId: row.user_id, profile, preference: loadPref(row.user_id), rules: loadRulesOf(row.user_id) };
  });
}

// Tải nhu cầu/luật của ứng viên — cần cho bộ lọc hai chiều.
function loadPref(userId) {
  const row = get('SELECT * FROM preferences WHERE user_id = ?', [userId]);
  return row
    ? {
        ...row,
        interested_in: parseJson(row.interested_in, []),
        relationship_goals: parseJson(row.relationship_goals, []),
      }
    : null;
}
function loadRulesOf(userId) {
  return all('SELECT * FROM preference_rules WHERE user_id = ? AND kind = ?', [userId, 'must']).map(
    (r) => ({ ...r, value: parseJson(r.value, null) })
  );
}

/** Bổ sung cờ xác minh cho hồ sơ ứng viên (dùng trong luật `verified`). */
function decorate(candidate) {
  const v = all('SELECT type, status FROM verifications WHERE user_id = ?', [candidate.userId]);
  candidate.profile.identity_verified = v.some((x) => x.type === 'identity' && x.status === 'approved');
  candidate.profile.photo_verified = v.some((x) => x.type === 'photo' && x.status === 'approved');
  candidate.profile.phone_verified = Boolean(
    get('SELECT phone_verified FROM users WHERE id = ?', [candidate.userId])?.phone_verified
  );
  candidate.profile.last_active_at = get('SELECT last_active_at FROM users WHERE id = ?', [
    candidate.userId,
  ])?.last_active_at;
  return candidate;
}

/**
 * Xếp hạng ứng viên: lọc cứng hai chiều, tính điểm, rồi sắp theo điểm.
 * Người đang được boost được đẩy lên trong 30 phút.
 */
export function rankCandidates(viewer, pool, { radiusKm } = {}) {
  const out = [];
  const t = now();
  for (const raw of pool) {
    const candidate = decorate(raw);
    const distanceKm = haversineKm(
      viewer.profile.lat, viewer.profile.lng,
      candidate.profile.lat, candidate.profile.lng
    );
    if (radiusKm != null && distanceKm != null && distanceKm > radiusKm) continue;

    const blocked = hardFilter(viewer, candidate, distanceKm);
    if (blocked.length) continue;

    const result = scorePair(viewer, candidate, { distanceKm });
    const boosted = candidate.profile.boosted_until && candidate.profile.boosted_until > t;
    out.push({
      candidate,
      result,
      distanceKm,
      sortKey: result.score + (boosted ? 15 : 0),
      boosted: Boolean(boosted),
    });
  }
  out.sort((a, b) => b.sortKey - a.sortKey);
  return out;
}

/** Đóng gói một ứng viên đã xếp hạng thành thẻ hiển thị. */
export function toCard(viewer, entry) {
  const ex = explain(entry.result);
  return {
    profile: publicView(entry.candidate.profile, { distanceKm: entry.distanceKm, viewer }),
    compatibility: {
      score: entry.result.score,
      tier: matchTier(entry.result.score),
      headline: ex.headline,
      positives: ex.positives,
      considerations: ex.considerations,
      breakdown: entry.result.breakdown,
      confidence: entry.result.confidence,
    },
    boosted: entry.boosted,
  };
}

/* ------------------------------------------------------------ bảng khám phá */

export function discoverFeed(userId, { limit = 20, radiusKm, offset = 0 } = {}) {
  const viewer = loadViewer(userId);
  if (!viewer) throw badRequest('Bạn cần hoàn thiện hồ sơ trước');
  if (viewer.profile.lat == null) {
    return { items: [], needs: 'location', message: 'Hãy chọn khu vực sinh sống để bắt đầu tìm kiếm.' };
  }

  const maxRadius = isPremium(userId)
    ? config.matching.maxRadiusPremiumKm
    : config.matching.maxRadiusFreeKm;
  const radius = Math.min(radiusKm ?? viewer.preference.max_distance_km, maxRadius);

  const pool = candidatePool(viewer, { radiusKm: radius });
  const ranked = rankCandidates(viewer, pool, { radiusKm: radius });

  return {
    items: ranked.slice(offset, offset + limit).map((e) => toCard(viewer, e)),
    total: ranked.length,
    radius_km: radius,
    max_radius_km: maxRadius,
  };
}

/* ------------------------------------------------- "Hôm nay dành cho bạn" */

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Mỗi ngày chọn ra một nhóm nhỏ người thật sự phù hợp và GIỮ NGUYÊN trong ngày.
 * Mục tiêu là cho người dùng lý do quay lại mỗi ngày, không phải để họ vuốt
 * hàng trăm hồ sơ.
 */
export function dailyPicks(userId, { count } = {}) {
  const date = today();
  const n = count ?? config.matching.dailyPicks;

  const existing = all(
    `SELECT * FROM recommendations WHERE user_id = ? AND batch_date = ? ORDER BY rank`,
    [userId, date]
  );
  if (existing.length) return hydratePicks(userId, existing);

  const viewer = loadViewer(userId);
  if (!viewer || viewer.profile.lat == null) return { date, items: [], needs: 'location' };

  const maxRadius = isPremium(userId)
    ? config.matching.maxRadiusPremiumKm
    : config.matching.maxRadiusFreeKm;
  const radius = Math.min(viewer.preference.max_distance_km, maxRadius);

  // Lấy cả những người đã xem qua ở bảng khám phá — gợi ý hôm nay là một lát
  // cắt riêng, chọn theo chất lượng chứ không theo thứ tự vuốt.
  const pool = candidatePool(viewer, { radiusKm: radius, includeSeen: false, limit: 800 });
  const ranked = rankCandidates(viewer, pool, { radiusKm: radius });

  // Xáo nhẹ trong nhóm điểm cao để mỗi ngày một khác, nhưng ổn định trong ngày.
  const top = ranked.slice(0, n * 3);
  top.sort(
    (a, b) =>
      b.result.score + seededUnit(`${userId}:${date}:${b.candidate.userId}`) * 8 -
      (a.result.score + seededUnit(`${userId}:${date}:${a.candidate.userId}`) * 8)
  );

  const chosen = top.slice(0, n);
  const t = now();
  chosen.forEach((entry, i) => {
    const ex = explain(entry.result);
    insert(
      `INSERT OR IGNORE INTO recommendations
         (user_id, target_id, batch_date, rank, score, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        entry.candidate.userId,
        date,
        i,
        entry.result.score,
        JSON.stringify({ ...ex, breakdown: entry.result.breakdown, distanceKm: entry.distanceKm }),
        t,
      ]
    );
  });

  return hydratePicks(
    userId,
    all('SELECT * FROM recommendations WHERE user_id = ? AND batch_date = ? ORDER BY rank', [
      userId, date,
    ])
  );
}

function hydratePicks(userId, rows) {
  const viewer = loadViewer(userId);
  const items = [];
  for (const row of rows) {
    // Bỏ qua người đã bị khoá/ẩn hồ sơ sau khi gợi ý được chốt.
    const target = loadProfile(row.target_id);
    if (!target || target.user_status !== 'active' || target.visibility !== 'public') continue;
    // Bỏ qua người đã tương tác rồi.
    const acted = get('SELECT 1 AS x FROM likes WHERE from_user = ? AND to_user = ?', [
      userId, row.target_id,
    ]);
    const ex = parseJson(row.explanation, {});
    items.push({
      profile: publicView(target, { distanceKm: ex.distanceKm ?? null, viewer }),
      compatibility: {
        score: row.score,
        tier: matchTier(row.score),
        headline: ex.headline,
        positives: ex.positives ?? [],
        considerations: ex.considerations ?? [],
        breakdown: ex.breakdown ?? {},
      },
      acted: Boolean(acted),
      seen_at: row.seen_at,
    });
  }
  return { date: today(), items, total: items.length };
}

export function markPickSeen(userId, targetId) {
  run(
    'UPDATE recommendations SET seen_at = ? WHERE user_id = ? AND target_id = ? AND batch_date = ?',
    [now(), userId, targetId, today()]
  );
}

/* ---------------------------------------------------------------- bản đồ */

/**
 * Dữ liệu cho màn hình "Người phù hợp quanh bạn".
 *
 * KHÔNG trả về vị trí thật của bất kỳ ai. Mỗi chấm được xê dịch ngẫu nhiên
 * nhưng ổn định trong bán kính vài trăm mét, và chỉ kèm tên khu vực cấp
 * quận/huyện. Người dùng nhìn thấy mật độ, không nhìn thấy địa chỉ.
 */
export function nearbyMap(userId, { radiusKm = 10 } = {}) {
  const viewer = loadViewer(userId);
  if (!viewer || viewer.profile.lat == null) return { points: [], center: null, needs: 'location' };

  const maxRadius = isPremium(userId)
    ? config.matching.maxRadiusPremiumKm
    : config.matching.maxRadiusFreeKm;
  const radius = Math.min(Number(radiusKm) || 10, maxRadius);

  const pool = candidatePool(viewer, { radiusKm: radius, includeSeen: true, limit: 800 });
  const ranked = rankCandidates(viewer, pool, { radiusKm: radius });

  const points = ranked.slice(0, 120).map((e) => {
    const j = jitterPoint(e.candidate.profile.lat, e.candidate.profile.lng, `vigo:${e.candidate.userId}`);
    return {
      user_id: e.candidate.userId,
      lat: Number(j.lat.toFixed(4)),
      lng: Number(j.lng.toFixed(4)),
      area: publicRegionLabel(e.candidate.profile.region_id),
      distance_km: fuzzyDistanceKm(e.distanceKm),
      score: e.result.score,
      tier: matchTier(e.result.score).key,
      display_name: e.candidate.profile.display_name,
    };
  });

  // Tâm bản đồ cũng được làm mờ: lấy trung tâm khu vực đã khai, không phải
  // toạ độ thiết bị.
  const region = viewer.profile.region_id
    ? get('SELECT lat, lng FROM regions WHERE id = ?', [viewer.profile.region_id])
    : null;

  return {
    center: {
      lat: region?.lat ?? Number(viewer.profile.lat.toFixed(2)),
      lng: region?.lng ?? Number(viewer.profile.lng.toFixed(2)),
      area: publicRegionLabel(viewer.profile.region_id),
    },
    radius_km: radius,
    max_radius_km: maxRadius,
    points,
    total: ranked.length,
  };
}

/**
 * Ai được xem hồ sơ của ai.
 *
 * Hồ sơ chỉ mở khi người đó đang hoạt động VÀ để chế độ công khai. Ngoại lệ
 * duy nhất: hai người đã kết đôi — khi đó vẫn xem được nhau dù một bên đã ẩn
 * hồ sơ, vì cuộc trò chuyện của họ vẫn đang mở.
 *
 * Mọi trường hợp từ chối đều trả về cùng một lỗi "không tìm thấy", để không
 * xác nhận giúp kẻ dò rằng tài khoản đó có tồn tại hay không.
 */
function assertCanView(userId, targetId, target) {
  const blocked = get(
    `SELECT 1 AS x FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)`,
    [userId, targetId, targetId, userId]
  );
  if (blocked) throw notFound('Không tìm thấy hồ sơ này');

  if (target.user_status === 'active' && target.visibility === 'public') return;

  const [a, b] = userId < targetId ? [userId, targetId] : [targetId, userId];
  const matched = get(
    "SELECT 1 AS x FROM matches WHERE user_a = ? AND user_b = ? AND status = 'active'",
    [a, b]
  );
  if (!matched) throw notFound('Không tìm thấy hồ sơ này');
}

/** Xem chi tiết một hồ sơ kèm lời giải thích vì sao được đề xuất. */
export function viewProfile(userId, targetId) {
  const viewer = loadViewer(userId);
  const target = loadProfile(targetId);
  if (!target) throw notFound('Không tìm thấy hồ sơ này');

  assertCanView(userId, targetId, target);

  const distanceKm = haversineKm(
    viewer.profile.lat, viewer.profile.lng, target.lat, target.lng
  );
  const candidate = decorate({ userId: targetId, profile: target, preference: loadPref(targetId), rules: loadRulesOf(targetId) });
  const result = scorePair(viewer, candidate, { distanceKm });
  const ex = explain(result);

  return {
    profile: publicView(target, { distanceKm, viewer }),
    compatibility: {
      score: result.score,
      tier: matchTier(result.score),
      headline: ex.headline,
      positives: ex.positives,
      considerations: ex.considerations,
      breakdown: result.breakdown,
      confidence: result.confidence,
    },
    blocked_by_filters: hardFilter(viewer, candidate, distanceKm).map((b) => b.label),
  };
}
