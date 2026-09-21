import { all, get, parseJson } from '../db/index.js';
import { loadViewer, loadProfile } from './profiles.js';
import { candidatePool } from './discovery.js';
import { analyzePreferences, analyzeBehaviour, profileGaps } from '../domain/insights.js';
import { narrate, aiStatus } from '../lib/ai.js';
import { isPremium } from './billing.js';
import { badRequest } from '../lib/http.js';
import { config } from '../config.js';

/**
 * AI MATCHMAKER
 *
 * Ghép phần phân tích thuần (src/domain/insights.js) với dữ liệu thật trong DB.
 * Người dùng miễn phí thấy các nhận định quan trọng nhất; Premium thấy đầy đủ
 * cộng phần nhận xét bằng lời (nếu có cấu hình API key).
 */
export async function matchmakerReport(userId, { includeNarrative = true } = {}) {
  const viewer = loadViewer(userId);
  if (!viewer) throw badRequest('Bạn cần tạo hồ sơ trước');

  const gaps = profileGaps(viewer.profile);

  if (viewer.profile.lat == null) {
    return {
      ready: false,
      needs: 'location',
      message: 'Hãy chọn khu vực sinh sống để chúng tôi phân tích được kho hồ sơ quanh bạn.',
      profile: gaps,
      ai: aiStatus(),
    };
  }

  // Kho hồ sơ để so sánh: rộng hơn bán kính hiện tại, để còn đo được "nếu mở
  // rộng thì thêm bao nhiêu người".
  const wideRadius = Math.max(
    (viewer.preference?.max_distance_km ?? 20) * 2 + 10,
    config.matching.maxRadiusFreeKm
  );
  const pool = candidatePool(viewer, { radiusKm: wideRadius, includeSeen: true, limit: 1200 });

  const prefs = analyzePreferences(viewer, pool);

  // Hành vi: những lượt thích đã gửi kèm hồ sơ người nhận.
  const likes = all(
    `SELECT l.action, l.score, l.to_user FROM likes l WHERE l.from_user = ? ORDER BY l.id DESC LIMIT 300`,
    [userId]
  ).map((l) => ({ ...l, profile: loadProfile(l.to_user) }));

  const matchedIds = all(
    `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS id FROM matches
     WHERE (user_a = ? OR user_b = ?) AND status = 'active'`,
    [userId, userId, userId]
  ).map((r) => r.id);

  const behaviour = analyzeBehaviour(viewer, likes, matchedIds);

  const premium = isPremium(userId);
  const allInsights = [...prefs.insights, ...behaviour.insights];

  // Hồ sơ thiếu nhiều thì đó mới là việc cần làm trước.
  if (gaps.completeness < 70) {
    allInsights.unshift({
      key: 'incomplete_profile',
      severity: 'high',
      title: `Hồ sơ của bạn mới hoàn thiện ${gaps.completeness}%`,
      body: `Còn thiếu: ${gaps.missing.slice(0, 4).map((m) => m.label).join(', ')}${
        gaps.missing.length > 4 ? '…' : ''
      }. Hồ sơ đầy đủ giúp thuật toán ghép đúng hơn và người khác tin tưởng hơn.`,
      action: { type: 'complete_profile', fields: gaps.missing.slice(0, 6) },
      numbers: { completeness: gaps.completeness },
    });
  }

  const visible = premium ? allInsights : allInsights.slice(0, 2);

  const report = {
    ready: true,
    premium,
    pool: {
      total_nearby: prefs.poolSize,
      matching_your_filters: prefs.matching,
      radius_km: viewer.preference?.max_distance_km,
      search_span_km: wideRadius,
    },
    profile: gaps,
    behaviour: {
      likes_sent: behaviour.likesSent,
      matches: behaviour.matched,
      match_rate: behaviour.matchRate ?? null,
      avg_liked_score: behaviour.avgLikedScore ?? null,
    },
    rule_impact: premium ? prefs.ruleImpact : prefs.ruleImpact.slice(0, 2),
    insights: visible,
    hidden_insights: premium ? 0 : Math.max(0, allInsights.length - visible.length),
    ai: aiStatus(),
  };

  if (includeNarrative && premium) {
    report.narrative = await narrate({
      poolSize: prefs.poolSize,
      matching: prefs.matching,
      radiusKm: viewer.preference?.max_distance_km,
      ageRange: `${viewer.preference?.age_min}-${viewer.preference?.age_max}`,
      mustRuleCount: (viewer.rules ?? []).filter((r) => r.kind === 'must').length,
      ruleImpact: prefs.ruleImpact,
      insights: allInsights,
    });
  }

  return report;
}

/** Xem trước: nếu đổi một tham số thì kết quả thay đổi thế nào. */
export function simulate(userId, changes) {
  const viewer = loadViewer(userId);
  if (!viewer || viewer.profile.lat == null) throw badRequest('Cần có khu vực sinh sống trước');

  const wide = Math.max((changes.max_distance_km ?? viewer.preference.max_distance_km) + 10, 60);
  const pool = candidatePool(viewer, { radiusKm: wide, includeSeen: true, limit: 1200 });

  const before = analyzePreferences(viewer, pool).matching;
  const modified = {
    ...viewer,
    preference: { ...viewer.preference, ...changes },
    rules: changes.remove_rule_id
      ? viewer.rules.filter((r) => r.id !== changes.remove_rule_id)
      : viewer.rules,
  };
  const after = analyzePreferences(modified, pool).matching;

  return {
    before,
    after,
    delta: after - before,
    message:
      after > before
        ? `Thay đổi này sẽ cho bạn thêm ${after - before} hồ sơ phù hợp.`
        : after < before
          ? `Thay đổi này sẽ giảm ${before - after} hồ sơ phù hợp.`
          : 'Thay đổi này không làm thay đổi số hồ sơ phù hợp.',
  };
}
