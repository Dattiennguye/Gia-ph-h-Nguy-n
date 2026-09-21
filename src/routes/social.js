import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import * as interactions from '../services/interactions.js';
import * as chat from '../services/chat.js';
import * as notifications from '../services/notifications.js';
import { createReport } from '../services/moderation.js';
import { subscribe } from '../lib/events.js';
import { limitByUser } from '../lib/rateLimit.js';
import { SAFETY_TIPS } from '../domain/safety.js';

export const socialRouter = Router();
socialRouter.use(requireAuth, requireVerified);

/* ------------------------------------------------------------------ match */

socialRouter.get(
  '/matches',
  wrap((req, res) => res.json({ matches: interactions.listMatches(req.user.id) }))
);

socialRouter.get(
  '/likes/received',
  wrap((req, res) => res.json(interactions.whoLikedMe(req.user.id)))
);

socialRouter.delete(
  '/matches/:id',
  wrap((req, res) => res.json(interactions.unmatch(req.user.id, Number(req.params.id))))
);

/* ------------------------------------------------------------------- chat */

socialRouter.get(
  '/conversations/:id',
  wrap((req, res) => res.json(chat.conversationDetail(req.user.id, Number(req.params.id))))
);

socialRouter.get(
  '/conversations/:id/messages',
  wrap((req, res) =>
    res.json({
      messages: chat.listMessages(req.user.id, Number(req.params.id), {
        before: req.query.before ? Number(req.query.before) : null,
        limit: Math.min(Number(req.query.limit) || 50, 100),
      }),
    })
  )
);

socialRouter.post(
  '/conversations/:id/messages',
  limitByUser('send-message', 120, 10 * 60 * 1000),
  wrap((req, res) => {
    const body = v.str(req.body?.body, 'body', { min: 1, max: 2000 });
    res.status(201).json({ message: chat.sendMessage(req.user.id, Number(req.params.id), body) });
  })
);

socialRouter.post(
  '/conversations/:id/read',
  wrap((req, res) => res.json(chat.markConversationRead(req.user.id, Number(req.params.id))))
);

socialRouter.post(
  '/conversations/:id/icebreaker',
  limitByUser('icebreaker', 30, 10 * 60 * 1000),
  wrap((req, res) => res.json(chat.refreshIcebreaker(req.user.id, Number(req.params.id))))
);

/* -------------------------------------------------------- chặn & báo cáo */

socialRouter.post(
  '/block',
  wrap((req, res) => {
    const targetId = Number(req.body?.user_id);
    if (!Number.isInteger(targetId)) throw badRequest('Thiếu user_id');
    res.json(interactions.blockUser(req.user.id, targetId, req.body?.reason ?? null));
  })
);

socialRouter.delete(
  '/block/:id',
  wrap((req, res) => res.json(interactions.unblockUser(req.user.id, Number(req.params.id))))
);

socialRouter.get(
  '/blocked',
  wrap((req, res) => res.json({ blocked: interactions.listBlocked(req.user.id) }))
);

socialRouter.post(
  '/report',
  limitByUser('report', 20, 24 * 60 * 60 * 1000),
  wrap((req, res) => {
    const targetId = Number(req.body?.user_id);
    if (!Number.isInteger(targetId)) throw badRequest('Thiếu user_id');
    const category = v.enumValue(req.body?.category, 'report_category', 'category');
    const detail = v.str(req.body?.detail, 'detail', { required: false, max: 2000 });
    res.json(
      createReport(req.user.id, {
        targetId,
        category,
        detail,
        evidence: req.body?.evidence ?? {},
      })
    );
  })
);

socialRouter.get('/safety-tips', wrap((req, res) => res.json({ tips: SAFETY_TIPS })));

/* ------------------------------------------------------------- thông báo */

socialRouter.get(
  '/notifications',
  wrap((req, res) =>
    res.json({
      notifications: notifications.listNotifications(req.user.id, {
        unreadOnly: req.query.unread === '1',
      }),
      unread: notifications.unreadCount(req.user.id),
    })
  )
);

socialRouter.post(
  '/notifications/read',
  wrap((req, res) => res.json(notifications.markRead(req.user.id, req.body?.ids ?? null)))
);

/* ---------------------------------------------------- kênh thời gian thực */

/**
 * Luồng sự kiện: tin nhắn mới, match mới, thông báo.
 * Trình duyệt kết nối bằng EventSource, token truyền qua query vì EventSource
 * không cho đặt header.
 */
socialRouter.get('/stream', (req, res) => {
  subscribe(req.user.id, res);
});
