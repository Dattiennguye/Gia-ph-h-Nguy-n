import { Router } from 'express';
import { wrap, badRequest } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import * as billing from '../services/billing.js';
import { limitByUser } from '../lib/rateLimit.js';

export const billingRouter = Router();

/* =========================================================================
   Callback từ cổng thanh toán.
   Đặt TRƯỚC requireAuth: VNPay và MoMo gọi máy-tới-máy, không mang theo token
   của người dùng. Tính xác thực đến từ CHỮ KÝ, không phải từ phiên đăng nhập.
   ========================================================================= */

/**
 * IPN của VNPay — nguồn sự thật để cộng quyền lợi.
 * VNPay chờ một JSON { RspCode, Message } và sẽ gọi lại nếu không nhận được.
 */
billingRouter.get(
  '/vnpay/ipn',
  wrap((req, res) => {
    const result = billing.vnpay.verifyCallback(req.query);
    if (!result.valid) {
      return res.json({ RspCode: '97', Message: 'Invalid signature' });
    }

    const settled = billing.settlePayment({
      ref: result.txnRef,
      amountVnd: result.amountVnd,
      success: result.success,
      reason: result.reason,
    });

    if (settled.code === 'not_found') return res.json({ RspCode: '01', Message: 'Order not found' });
    if (settled.code === 'amount_mismatch') return res.json({ RspCode: '04', Message: 'Invalid amount' });
    if (settled.code === 'already_confirmed') {
      return res.json({ RspCode: '02', Message: 'Order already confirmed' });
    }
    return res.json({ RspCode: '00', Message: 'Confirm Success' });
  })
);

/**
 * Nơi trình duyệt người dùng quay về.
 * CHỈ để hiển thị — người dùng sửa được tham số trên thanh địa chỉ, nên trang
 * này không bao giờ được dùng để cộng quyền lợi. Quyền lợi do IPN quyết định.
 */
billingRouter.get(
  '/vnpay/return',
  wrap((req, res) => {
    const result = billing.vnpay.verifyCallback(req.query);
    const params = new URLSearchParams({
      status: result.valid ? (result.success ? 'success' : 'failed') : 'invalid',
      message: result.reason,
      ref: result.txnRef ?? '',
    });
    res.redirect(`/#/premium?${params}`);
  })
);

/** IPN của MoMo. Chờ HTTP 204 khi đã tiếp nhận. */
billingRouter.post(
  '/momo/ipn',
  wrap((req, res) => {
    const result = billing.momo.verifyIpn(req.body ?? {});
    if (!result.valid) return res.status(400).json({ message: 'Invalid signature' });

    billing.settlePayment({
      ref: result.orderId,
      amountVnd: result.amountVnd,
      success: result.success,
      reason: result.reason,
    });
    // MoMo chỉ cần biết mình đã nhận; kết quả xử lý nội bộ không ảnh hưởng.
    return res.status(204).end();
  })
);

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
  wrap(async (req, res) => {
    const product = req.body?.product;
    if (!billing.PRODUCTS[product]) throw badRequest('Sản phẩm không tồn tại');
    res.status(201).json(await billing.createPayment(req.user.id, product, { ipAddr: req.ip }));
  })
);

billingRouter.get(
  '/payments',
  wrap((req, res) => res.json({ payments: billing.listPayments(req.user.id) }))
);
