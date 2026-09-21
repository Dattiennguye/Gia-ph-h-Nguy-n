import { hardFilter, scorePair, evaluateRule, describeRule, ageFrom } from './matching.js';
import { haversineKm } from '../lib/geo.js';
import { labelOf } from './taxonomy.js';

/**
 * AI MATCHMAKER
 *
 * Phân tích thật trên dữ liệu thật: mỗi nhận xét đều đến từ một phép đếm trên
 * kho hồ sơ đang có, kèm con số cụ thể. Hệ thống chỉ phân tích và giải thích —
 * quyết định cuối cùng vẫn là của người dùng.
 *
 * Toàn bộ phần này chạy được mà KHÔNG cần API key nào. Nếu có cấu hình
 * ANTHROPIC_API_KEY, `narrate()` sẽ viết thêm một đoạn nhận xét bằng lời dựa
 * trên chính các con số này.
 */

/** Đếm số hồ sơ vượt qua bộ lọc hiện tại của người dùng. */
function countPassing(viewer, pool, overrides = {}) {
  const v = {
    profile: viewer.profile,
    preference: { ...viewer.preference, ...(overrides.preference ?? {}) },
    rules: overrides.rules ?? viewer.rules,
  };
  let passed = 0;
  for (const c of pool) {
    const d = haversineKm(v.profile.lat, v.profile.lng, c.profile.lat, c.profile.lng);
    if (hardFilter(v, c, d).length === 0) passed += 1;
  }
  return passed;
}

/**
 * Phân tích toàn bộ bộ tiêu chí của một người dùng trên kho hồ sơ `pool`.
 * @returns {{poolSize:number, matching:number, insights:object[], ruleImpact:object[]}}
 */
export function analyzePreferences(viewer, pool) {
  const poolSize = pool.length;
  const base = countPassing(viewer, pool);
  const insights = [];

  /* --- Tiêu chí nào đang loại nhiều hồ sơ nhất? ------------------------- */
  const mustRules = (viewer.rules ?? []).filter((r) => r.kind === 'must');
  const ruleImpact = [];

  for (const rule of mustRules) {
    const without = countPassing(viewer, pool, {
      rules: viewer.rules.filter((r) => r.id !== rule.id),
    });
    const removed = without - base;
    ruleImpact.push({
      ruleId: rule.id,
      field: rule.field,
      text: describeRule(rule),
      excluded: removed,
      excludedPct: poolSize ? Math.round((removed / poolSize) * 100) : 0,
    });
  }
  ruleImpact.sort((a, b) => b.excluded - a.excluded);

  const heavy = ruleImpact.filter((r) => r.excludedPct >= 15);
  if (mustRules.length >= 4 && heavy.length >= 1) {
    insights.push({
      key: 'too_many_musts',
      severity: 'high',
      title: `Bạn đang đặt ${mustRules.length} tiêu chí bắt buộc`,
      body: `${heavy.length === 1 ? 'Có 1 tiêu chí đang' : `Có ${heavy.length} tiêu chí đang`} loại phần lớn hồ sơ: ${heavy
        .slice(0, 2)
        .map((r) => `“${r.text}” (loại ${r.excludedPct}%)`)
        .join(' và ')}. Chuyển bớt sang mục ưu tiên sẽ mở rộng kết quả mà vẫn giữ được mong muốn của bạn.`,
      action: { type: 'soften_rule', ruleId: heavy[0].ruleId },
      numbers: { mustRules: mustRules.length, worst: heavy[0] },
    });
  } else if (heavy.length >= 1) {
    insights.push({
      key: 'one_heavy_rule',
      severity: 'medium',
      title: `Tiêu chí “${heavy[0].text}” đang thu hẹp kết quả`,
      body: `Riêng tiêu chí này loại ${heavy[0].excluded} hồ sơ (${heavy[0].excludedPct}% kho hiện có). Nếu đây là điều bạn thật sự không nhân nhượng thì cứ giữ — chỉ là bạn nên biết cái giá của nó.`,
      action: { type: 'soften_rule', ruleId: heavy[0].ruleId },
      numbers: { worst: heavy[0] },
    });
  }

  /* --- Mở rộng bán kính thì được thêm bao nhiêu người? ------------------ */
  const currentRadius = viewer.preference?.max_distance_km ?? 20;
  for (const next of [currentRadius * 2, currentRadius + 10, 50].sort((a, b) => a - b)) {
    if (next <= currentRadius || next > 200) continue;
    const withWider = countPassing(viewer, pool, { preference: { max_distance_km: next } });
    const gain = withWider - base;
    if (gain >= Math.max(3, base * 0.3)) {
      insights.push({
        key: 'widen_radius',
        severity: 'medium',
        title: `Tăng bán kính lên ${next} km sẽ có thêm ${gain} người phù hợp`,
        body: `Bạn đang tìm trong ${currentRadius} km và có ${base} hồ sơ phù hợp. Mở rộng lên ${next} km, con số đó thành ${withWider}.`,
        action: { type: 'set_radius', value: next },
        numbers: { from: currentRadius, to: next, base, gain },
      });
      break;
    }
  }

  /* --- Khoảng tuổi ----------------------------------------------------- */
  const pref = viewer.preference ?? {};
  const wider = { age_min: Math.max(18, (pref.age_min ?? 20) - 3), age_max: (pref.age_max ?? 30) + 3 };
  const withWiderAge = countPassing(viewer, pool, { preference: wider });
  if (withWiderAge - base >= Math.max(3, base * 0.25)) {
    insights.push({
      key: 'widen_age',
      severity: 'low',
      title: `Nới khoảng tuổi ra ${wider.age_min}–${wider.age_max} sẽ có thêm ${withWiderAge - base} người`,
      body: `Khoảng tuổi ${pref.age_min}–${pref.age_max} hiện cho ${base} kết quả. Nới mỗi đầu 3 tuổi thì được ${withWiderAge}.`,
      action: { type: 'set_age_range', value: wider },
      numbers: { base, gain: withWiderAge - base, ...wider },
    });
  }

  /* --- Kho hồ sơ trong khu vực có đủ dày không? ------------------------- */
  if (base === 0) {
    insights.push({
      key: 'empty_pool',
      severity: 'high',
      title: 'Chưa có hồ sơ nào lọt qua bộ tiêu chí hiện tại',
      body: 'Khu vực của bạn có thể chưa đủ người dùng, hoặc bộ lọc đang quá chặt. Thử nới bán kính trước, rồi tới các tiêu chí bắt buộc.',
      action: { type: 'review_filters' },
      numbers: { poolSize, base },
    });
  } else if (base < 5 && poolSize > 20) {
    insights.push({
      key: 'narrow_pool',
      severity: 'medium',
      title: `Chỉ ${base} hồ sơ lọt qua bộ lọc của bạn`,
      body: `Trong ${poolSize} hồ sơ đang hoạt động, chỉ ${base} người vượt qua toàn bộ tiêu chí. Bạn sẽ hết người để xem khá nhanh.`,
      action: { type: 'review_filters' },
      numbers: { poolSize, base },
    });
  }

  return { poolSize, matching: base, insights, ruleImpact };
}

/**
 * Phân tích hành vi: người dùng thường thích kiểu người nào, và tỷ lệ được
 * đáp lại ra sao. `likes` là các lượt thích đã gửi kèm hồ sơ người nhận.
 */
export function analyzeBehaviour(viewer, likes, matchedIds) {
  const liked = likes.filter((l) => l.action === 'like' || l.action === 'superlike');
  const out = { likesSent: liked.length, matched: matchedIds.length, insights: [] };
  if (liked.length < 8) return out;

  const matchRate = matchedIds.length / liked.length;
  out.matchRate = Math.round(matchRate * 100);

  /* Kiểu người hay được thích: thống kê trên các trường phân loại. */
  const tally = (field, group) => {
    const counts = new Map();
    for (const l of liked) {
      const v = l.profile?.[field];
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const share = top[1] / liked.length;
    return share >= 0.6 ? { field, value: top[0], label: labelOf(group, top[0]), share } : null;
  };

  const patterns = [
    tally('relationship_goal', 'relationship_goal'),
    tally('education', 'education'),
    tally('marriage_timeline', 'marriage_timeline'),
  ].filter(Boolean);

  for (const p of patterns) {
    out.insights.push({
      key: `pattern_${p.field}`,
      severity: 'low',
      title: `${Math.round(p.share * 100)}% người bạn thích có cùng đặc điểm: ${p.label}`,
      body: `Đây là xu hướng thật trong lựa chọn của bạn. Nếu nó đúng với điều bạn muốn, hãy đưa nó thành tiêu chí để hệ thống ưu tiên sẵn cho bạn.`,
      action: { type: 'suggest_rule', field: p.field, value: p.value },
      numbers: { share: Math.round(p.share * 100) },
    });
  }

  /* Thích nhiều mà ít được đáp lại → đang thích quá rộng hoặc lệch tầm. */
  if (liked.length >= 20 && matchRate < 0.05) {
    out.insights.push({
      key: 'low_match_rate',
      severity: 'medium',
      title: `Bạn đã thích ${liked.length} người nhưng mới có ${matchedIds.length} lượt kết đôi`,
      body: 'Thử dành thời gian cho những hồ sơ có điểm phù hợp cao thay vì thích rộng. Hồ sơ của bạn đầy đủ hơn cũng làm tăng tỷ lệ được thích lại.',
      action: { type: 'improve_profile' },
      numbers: { liked: liked.length, matched: matchedIds.length },
    });
  }

  /* Điểm phù hợp trung bình của những người được thích. */
  const scored = liked.filter((l) => typeof l.score === 'number');
  if (scored.length >= 10) {
    const avg = Math.round(scored.reduce((s, l) => s + l.score, 0) / scored.length);
    out.avgLikedScore = avg;
    if (avg < 55) {
      out.insights.push({
        key: 'likes_low_score',
        severity: 'medium',
        title: `Điểm phù hợp trung bình của những người bạn thích chỉ ${avg}/100`,
        body: 'Bạn đang thích khá nhiều hồ sơ lệch với tiêu chí đã khai. Hoặc tiêu chí chưa phản ánh đúng điều bạn muốn — hãy cập nhật lại phần Nhu cầu.',
        action: { type: 'review_preferences' },
        numbers: { avg },
      });
    }
  }

  return out;
}

/** Gợi ý hoàn thiện hồ sơ, tính theo các trường còn trống. */
export function profileGaps(profile) {
  const fields = [
    ['birth_date', 'Ngày sinh'],
    ['gender', 'Giới tính'],
    ['region_id', 'Khu vực'],
    ['bio', 'Giới thiệu bản thân'],
    ['relationship_goal', 'Mục đích tìm kiếm'],
    ['marriage_timeline', 'Quan điểm hôn nhân'],
    ['children_wish', 'Mong muốn có con'],
    ['living_preference', 'Nơi ở sau kết hôn'],
    ['occupation', 'Nghề nghiệp'],
    ['education', 'Học vấn'],
    ['height_cm', 'Chiều cao'],
    ['smoking', 'Hút thuốc'],
    ['drinking', 'Uống rượu bia'],
    ['marital_status', 'Tình trạng hôn nhân'],
    ['seriousness', 'Mức độ nghiêm túc'],
  ];
  const missing = fields.filter(([f]) => {
    const v = profile[f];
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
  });
  const tagsMissing = [];
  if (!(profile.lifestyle_tags ?? []).length) tagsMissing.push(['lifestyle_tags', 'Lối sống']);
  if (!(profile.interest_tags ?? []).length) tagsMissing.push(['interest_tags', 'Sở thích']);

  const all = [...missing, ...tagsMissing];
  const total = fields.length + 2;
  return {
    completeness: Math.round(((total - all.length) / total) * 100),
    missing: all.map(([field, label]) => ({ field, label })),
  };
}

/** Tính độ đầy đủ hồ sơ (0..100) — lưu vào cột profiles.completeness. */
export function computeCompleteness(profile) {
  return profileGaps(profile).completeness;
}
