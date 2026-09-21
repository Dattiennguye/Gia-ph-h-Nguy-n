import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import * as v from '../lib/validate.js';
import * as profiles from '../services/profiles.js';
import { requireAuth } from '../middleware/auth.js';
import { entitlements } from '../services/billing.js';
import { myVerifications } from '../services/verification.js';
import { myStats } from '../services/interactions.js';
import { unreadCount } from '../services/notifications.js';
import { totalUnread } from '../services/chat.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

/* ------------------------------------------------------------------ hồ sơ */

profileRouter.get(
  '/',
  wrap((req, res) => res.json({ profile: profiles.selfView(req.user.id) }))
);

profileRouter.patch(
  '/',
  wrap((req, res) => {
    const patch = { ...req.body };
    if (patch.birth_date !== undefined) patch.birth_date = v.birthDate(patch.birth_date);
    res.json({ profile: profiles.updateProfile(req.user.id, patch) });
  })
);

profileRouter.post(
  '/location',
  wrap((req, res) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    profiles.updateLocation(req.user.id, lat, lng);
    res.json({ ok: true, message: 'Đã cập nhật vị trí. Vị trí chính xác không bao giờ hiển thị với người khác.' });
  })
);

/* -------------------------------------------------------------------- ảnh */

profileRouter.post(
  '/photos',
  wrap((req, res) => {
    const url = v.str(req.body?.url, 'url', { max: 2000 });
    if (!/^(https?:\/\/|data:image\/)/.test(url)) {
      throw badRequest('Đường dẫn ảnh không hợp lệ');
    }
    res.status(201).json({ photo: profiles.addPhoto(req.user.id, url) });
  })
);

profileRouter.delete(
  '/photos/:id',
  wrap((req, res) => res.json(profiles.deletePhoto(req.user.id, Number(req.params.id))))
);

profileRouter.post(
  '/photos/:id/primary',
  wrap((req, res) => res.json(profiles.setPrimaryPhoto(req.user.id, Number(req.params.id))))
);

/* ----------------------------------------------------------------- nhu cầu */

profileRouter.get(
  '/preference',
  wrap((req, res) =>
    res.json({
      preference: profiles.loadPreference(req.user.id),
      rules: profiles.loadRules(req.user.id),
    })
  )
);

profileRouter.patch(
  '/preference',
  wrap((req, res) => res.json({ preference: profiles.updatePreference(req.user.id, req.body ?? {}) }))
);

profileRouter.post(
  '/preference/rules',
  wrap((req, res) => {
    const rule = profiles.addRule(req.user.id, {
      kind: req.body?.kind,
      field: req.body?.field,
      operator: req.body?.operator,
      value: req.body?.value,
      weight: req.body?.weight ?? 3,
    });
    res.status(201).json({ rule, rules: profiles.loadRules(req.user.id) });
  })
);

profileRouter.delete(
  '/preference/rules/:id',
  wrap((req, res) => {
    profiles.deleteRule(req.user.id, Number(req.params.id));
    res.json({ ok: true, rules: profiles.loadRules(req.user.id) });
  })
);

/* ----------------------------------------------------------- tổng quan "Tôi" */

profileRouter.get(
  '/overview',
  wrap((req, res) => {
    res.json({
      profile: profiles.selfView(req.user.id),
      preference: profiles.loadPreference(req.user.id),
      rules: profiles.loadRules(req.user.id),
      entitlements: entitlements(req.user.id),
      verification: myVerifications(req.user.id),
      stats: myStats(req.user.id),
      badges: {
        notifications: unreadCount(req.user.id),
        messages: totalUnread(req.user.id),
      },
    });
  })
);
