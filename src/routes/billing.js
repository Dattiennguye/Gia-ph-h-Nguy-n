import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as billing from '../services/billing.js';
import { limitByUser } from '../lib/rateLimit.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

billingRouter.get(
  '/plans',
  wrap((req, res) =>
    res.json({
      products: billing.PRODUCTS,
      benefits: billing.PREMIUM_BENEFITS,
      current: billing.entitlements(req.user.id),
      note: 'Tạo hồ sơ, tìm kiếm, ghép đôi và nhắn tin luôn miễn phí. Gói trả phí chỉ mở rộng phạm vi và công cụ.',
    })
  )
);

billingRouter.get(
  '/entitlements',
  wrap((req, res) => res.json(billing.entitlements(req.user.id)))
);

billingRouter.post(
  '/checkout',
  limitByUser('checkout', 20, 60 * 60 * 1000),
  wrap((req, res) => {
    const product = req.body?.product;
    if (!billing.PRODUCTS[product]) throw badRequest('Sản phẩm không tồn tại');
    res.status(201).json(billing.createPayment(req.user.id, product));
  })
);

billingRouter.get(
  '/payments',
  wrap((req, res) => res.json({ payments: billing.listPayments(req.user.id) }))
);
