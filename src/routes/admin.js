import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as admin from '../services/admin.js';
import * as moderation from '../services/moderation.js';
import * as verification from '../services/verification.js';
import * as billing from '../services/billing.js';
import * as regions from '../services/regions.js';
import { listAudit, audit } from '../services/audit.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'moderator'));

/* ---------------------------------------------------------------- tổng quan */

adminRouter.get('/dashboard', wrap((req, res) => res.json(admin.dashboard())));

adminRouter.get(
  '/timeseries',
  wrap((req, res) => res.json({ series: admin.timeseries({ days: Math.min(Number(req.query.days) || 14, 90) }) }))
);

adminRouter.get(
  '/regions/density',
  wrap((req, res) => res.json({ regions: admin.regionDensity({ limit: Number(req.query.limit) || 20 }) }))
);

/* ------------------------------------------------------------- người dùng */

adminRouter.get(
  '/users',
  wrap((req, res) =>
    res.json({
      users: admin.listUsers({
        query: req.query.q ? String(req.query.q) : '',
        status: req.query.status ? String(req.query.status) : null,
        limit: Math.min(Number(req.query.limit) || 50, 200),
        offset: Number(req.query.offset) || 0,
      }),
    })
  )
);

adminRouter.get(
  '/users/:id',
  wrap((req, res) => res.json(admin.userDetail(Number(req.params.id))))
);

adminRouter.post(
  '/users/:id/status',
  wrap((req, res) =>
    res.json(
      admin.setUserStatus(
        req.user.id,
        Number(req.params.id),
        req.body?.status,
        req.body?.reason ?? null
      )
    )
  )
);

adminRouter.post(
  '/users/:id/role',
  requireRole('admin'),
  wrap((req, res) => res.json(admin.setUserRole(req.user.id, Number(req.params.id), req.body?.role)))
);

/* -------------------------------------------------------------- kiểm duyệt */

adminRouter.get(
  '/cases',
  wrap((req, res) =>
    res.json({
      cases: moderation.listCases({
        status: req.query.status ? String(req.query.status) : 'open',
        risk: req.query.risk ? String(req.query.risk) : null,
        limit: Math.min(Number(req.query.limit) || 50, 200),
        offset: Number(req.query.offset) || 0,
      }),
    })
  )
);

adminRouter.get(
  '/cases/:id',
  wrap((req, res) => res.json(moderation.caseDetail(Number(req.params.id))))
);

adminRouter.post(
  '/cases/:id/resolve',
  wrap((req, res) =>
    res.json(
      moderation.resolveCase(req.user.id, Number(req.params.id), {
        action: req.body?.action,
        note: req.body?.note ?? null,
      })
    )
  )
);

adminRouter.get(
  '/reports',
  wrap((req, res) =>
    res.json({
      reports: moderation.listReports({
        status: req.query.status ? String(req.query.status) : 'open',
        limit: Math.min(Number(req.query.limit) || 50, 200),
      }),
    })
  )
);

/* --------------------------------------------------------------- xác minh */

adminRouter.get(
  '/verifications',
  wrap((req, res) => res.json({ pending: verification.pendingVerifications() }))
);

adminRouter.post(
  '/verifications/:id/review',
  wrap((req, res) =>
    res.json(
      verification.reviewVerification(req.user.id, Number(req.params.id), {
        approve: req.body?.approve === true,
        note: req.body?.note ?? null,
      })
    )
  )
);

/* ------------------------------------------------------------ thanh toán */

adminRouter.post(
  '/payments/:ref/confirm',
  requireRole('admin'),
  wrap((req, res) =>
    res.json(billing.confirmPayment(String(req.params.ref), { adminId: req.user.id }))
  )
);

adminRouter.post(
  '/users/:id/grant-premium',
  requireRole('admin'),
  wrap((req, res) => {
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw badRequest('Số ngày không hợp lệ');
    const sub = billing.grantPremium(Number(req.params.id), days);
    audit({
      actorId: req.user.id,
      actorRole: 'admin',
      action: 'admin.grant_premium',
      targetType: 'user',
      targetId: Number(req.params.id),
      detail: { days },
    });
    res.json({ subscription: sub });
  })
);

/* ------------------------------------------------------- mở/đóng khu vực */

adminRouter.post(
  '/regions/:id/signup',
  requireRole('admin'),
  wrap((req, res) => {
    const open = req.body?.open === true;
    regions.setSignupOpen(Number(req.params.id), open);
    audit({
      actorId: req.user.id,
      actorRole: 'admin',
      action: 'admin.region_signup',
      targetType: 'region',
      targetId: Number(req.params.id),
      detail: { open },
    });
    res.json({ ok: true, open });
  })
);

/* --------------------------------------------------------- nhật ký kiểm toán */

adminRouter.get(
  '/audit',
  requireRole('admin'),
  wrap((req, res) =>
    res.json({
      logs: listAudit({
        limit: Math.min(Number(req.query.limit) || 100, 500),
        offset: Number(req.query.offset) || 0,
        actorId: req.query.actor_id ? Number(req.query.actor_id) : undefined,
        action: req.query.action ? String(req.query.action) : undefined,
      }),
    })
  )
);
