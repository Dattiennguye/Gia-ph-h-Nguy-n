import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import * as discovery from '../services/discovery.js';
import * as interactions from '../services/interactions.js';
import { matchmakerReport, simulate } from '../services/matchmaker.js';
import { limitByUser } from '../lib/rateLimit.js';

export const discoveryRouter = Router();
discoveryRouter.use(requireAuth, requireVerified);

/** Bảng khám phá — danh sách thẻ đã xếp theo độ phù hợp. */
discoveryRouter.get(
  '/feed',
  limitByUser('feed', 240, 60 * 60 * 1000),
  wrap((req, res) => {
    res.json(
      discovery.discoverFeed(req.user.id, {
        limit: Math.min(Number(req.query.limit) || 20, 50),
        offset: Number(req.query.offset) || 0,
        radiusKm: req.query.radius_km ? Number(req.query.radius_km) : undefined,
      })
    );
  })
);

/** "Hôm nay dành cho bạn" — nhóm nhỏ được chọn kỹ, cố định trong ngày. */
discoveryRouter.get(
  '/daily',
  wrap((req, res) => res.json(discovery.dailyPicks(req.user.id)))
);

/** Bản đồ mật độ người phù hợp quanh bạn (vị trí đã được làm mờ). */
discoveryRouter.get(
  '/nearby',
  wrap((req, res) =>
    res.json(discovery.nearbyMap(req.user.id, { radiusKm: Number(req.query.radius_km) || 10 }))
  )
);

/** Chi tiết một hồ sơ + vì sao chúng tôi đề xuất người này. */
// Giới hạn để một tài khoản không thể dò tuần tự theo id mà cào sạch kho hồ sơ.
discoveryRouter.get(
  '/profile/:id',
  limitByUser('profile-view', 300, 60 * 60 * 1000),
  wrap((req, res) => {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) throw badRequest('Mã người dùng không hợp lệ');
    discovery.markPickSeen(req.user.id, targetId);
    res.json(discovery.viewProfile(req.user.id, targetId));
  })
);

/** Thích / bỏ qua / thích đặc biệt. */
discoveryRouter.post(
  '/react',
  limitByUser('react', 300, 60 * 60 * 1000),
  wrap((req, res) => {
    const targetId = Number(req.body?.user_id);
    if (!Number.isInteger(targetId)) throw badRequest('Thiếu user_id');
    res.json(interactions.react(req.user.id, targetId, req.body?.action ?? 'like'));
  })
);

/* ------------------------------------------------------------ AI Matchmaker */

discoveryRouter.get(
  '/matchmaker',
  limitByUser('matchmaker', 30, 60 * 60 * 1000),
  wrap(async (req, res) => res.json(await matchmakerReport(req.user.id)))
);

/** Thử xem: nếu đổi bán kính / khoảng tuổi / bỏ một tiêu chí thì được thêm bao nhiêu người? */
discoveryRouter.post(
  '/matchmaker/simulate',
  limitByUser('simulate', 60, 60 * 60 * 1000),
  wrap((req, res) => {
    const changes = {};
    if (req.body?.max_distance_km !== undefined) changes.max_distance_km = Number(req.body.max_distance_km);
    if (req.body?.age_min !== undefined) changes.age_min = Number(req.body.age_min);
    if (req.body?.age_max !== undefined) changes.age_max = Number(req.body.age_max);
    if (req.body?.remove_rule_id !== undefined) changes.remove_rule_id = Number(req.body.remove_rule_id);
    if (!Object.keys(changes).length) throw badRequest('Hãy chỉ định ít nhất một thay đổi để thử');
    res.json(simulate(req.user.id, changes));
  })
);
