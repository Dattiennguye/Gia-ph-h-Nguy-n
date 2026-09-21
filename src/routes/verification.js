import { Router } from 'express';
import { wrap } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as verification from '../services/verification.js';
import { limitByUser } from '../lib/rateLimit.js';

export const verificationRouter = Router();
verificationRouter.use(requireAuth);

verificationRouter.get(
  '/',
  wrap((req, res) => res.json(verification.myVerifications(req.user.id)))
);

verificationRouter.post(
  '/photo/challenge',
  limitByUser('verify-photo', 10, 60 * 60 * 1000),
  wrap((req, res) => res.json(verification.requestPhotoChallenge(req.user.id)))
);

verificationRouter.post(
  '/photo',
  limitByUser('verify-photo-submit', 10, 60 * 60 * 1000),
  wrap((req, res) => {
    const url = v.str(req.body?.photo_url, 'photo_url', { max: 2000 });
    res.json(verification.submitPhoto(req.user.id, url));
  })
);

verificationRouter.post(
  '/identity',
  limitByUser('verify-identity', 5, 24 * 60 * 60 * 1000),
  wrap((req, res) =>
    res.json(
      verification.submitIdentity(req.user.id, {
        documentType: req.body?.document_type,
        documentNumber: v.str(req.body?.document_number, 'document_number', { min: 6, max: 30 }),
        fullName: v.str(req.body?.full_name, 'full_name', { min: 2, max: 100 }),
        documentUrl: req.body?.document_url ?? null,
      })
    )
  )
);
