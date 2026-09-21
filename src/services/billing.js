import { all, get, insert, run, now, transaction } from '../db/index.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { randomToken } from '../lib/crypto.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

/**
 * GÓI DỊCH VỤ
 *
 * Nguyên tắc: không bán quyền TIẾP CẬN người khác. Tạo hồ sơ, tìm kiếm, ghép
 * đôi và nhắn tin luôn miễn phí. Gói trả phí chỉ mở rộng phạm vi và thêm công
 * cụ — không ai bị khoá lại sau tường phí để rồi phải trả tiền mới nhắn được.
 */

export const PRODUCTS = {
  premium_1m: {
    id: 'premium_1m',
    name: 'Vigo Premium — 1 tháng',
    amount_vnd: 79000,
    days: 30,
    kind: 'subscription',
  },
  premium_3m: {
    id: 'premium_3m',
    name: 'Vigo Premium — 3 tháng',
    amount_vnd: 199000,
    days: 90,
    kind: 'subscription',
  },
  premium_12m: {
    id: 'premium_12m',
    name: 'Vigo Premium — 12 tháng',
    amount_vnd: 699000,
    days: 365,
    kind: 'subscription',
  },
  boost_30m: {
    id: 'boost_30m',
    name: 'Boost 30 phút',
    amount_vnd: 29000,
    minutes: 30,
    kind: 'boost',
  },
};

export const PREMIUM_BENEFITS = [
  'Xem ai đã thích bạn',
  'Nhiều gợi ý mỗi ngày hơn',
  'Bộ lọc nâng cao và bán kính tìm kiếm tới 200 km',
  'Toàn bộ phân tích của AI Matchmaker',
  'Không giới hạn lượt thích mỗi ngày',
];

/* ------------------------------------------------------------- gói hiện tại */

export function currentSubscription(userId) {
  const sub = get(
    `SELECT * FROM subscriptions WHERE user_id = ? AND plan = 'premium' AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY expires_at DESC LIMIT 1`,
    [userId, now()]
  );
  if (sub) return sub;
  return get(
    `SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
    [userId]
  );
}

export function isPremium(userId) {
  const sub = get(
    `SELECT 1 AS x FROM subscriptions
     WHERE user_id = ? AND plan = 'premium' AND status = 'active'
       AND (expires_at IS NULL OR expires_at > ?)`,
    [userId, now()]
  );
  return Boolean(sub);
}

export function entitlements(userId) {
  const premium = isPremium(userId);
  return {
    plan: premium ? 'premium' : 'free',
    premium,
    max_radius_km: premium ? config.matching.maxRadiusPremiumKm : config.matching.maxRadiusFreeKm,
    daily_picks: premium ? config.matching.dailyPicks + 4 : config.matching.dailyPicks,
    daily_likes: premium ? null : config.matching.freeDailyLikes,
    see_who_liked_you: premium,
    ai_matchmaker_full: premium,
    advanced_filters: premium,
    expires_at: currentSubscription(userId)?.expires_at ?? null,
    benefits: PREMIUM_BENEFITS,
  };
}

/* --------------------------------------------------------------- thanh toán */

/**
 * Tạo giao dịch. Với provider `mock`, giao dịch được xác nhận ngay (dùng để
 * demo và kiểm thử). Với `manual`, giao dịch chờ admin đối soát chuyển khoản.
 */
export const createPayment = transaction((userId, productId) => {
  const product = PRODUCTS[productId];
  if (!product) throw badRequest('Sản phẩm không tồn tại');

  const ref = `VIGO${randomToken(6).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)}`;
  const paymentId = insert(
    `INSERT INTO payments (user_id, product, amount_vnd, provider, provider_ref, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [userId, product.id, product.amount_vnd, config.payment.provider, ref, now()]
  );

  if (config.payment.provider === 'mock') {
    confirmPayment(ref, { auto: true });
    return { ...getPayment(paymentId), instructions: null };
  }

  return {
    ...getPayment(paymentId),
    instructions: {
      bank_account: config.payment.bankAccount || 'Liên hệ quản trị viên để lấy thông tin chuyển khoản',
      amount_vnd: product.amount_vnd,
      transfer_note: ref,
      note: `Chuyển khoản đúng nội dung "${ref}" để hệ thống đối soát tự động.`,
    },
  };
});

export function getPayment(id) {
  return get('SELECT * FROM payments WHERE id = ?', [id]);
}

/** Xác nhận đã thu tiền → kích hoạt quyền lợi. */
export const confirmPayment = transaction((providerRef, { auto = false, adminId = null } = {}) => {
  const payment = get('SELECT * FROM payments WHERE provider_ref = ?', [providerRef]);
  if (!payment) throw notFound('Không tìm thấy giao dịch');
  if (payment.status === 'paid') throw conflict('Giao dịch này đã được xác nhận');

  const t = now();
  run('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?', ['paid', t, payment.id]);
  insert(
    `INSERT INTO transactions (payment_id, user_id, kind, amount_vnd, note, created_at)
     VALUES (?, ?, 'charge', ?, ?, ?)`,
    [payment.id, payment.user_id, payment.amount_vnd, auto ? 'Tự động xác nhận' : `Admin #${adminId} xác nhận`, t]
  );

  const product = PRODUCTS[payment.product];
  if (product?.kind === 'subscription') grantPremium(payment.user_id, product.days, payment.id);
  if (product?.kind === 'boost') startBoost(payment.user_id, product.minutes, payment.id);

  audit({
    actorId: adminId ?? payment.user_id,
    action: 'billing.payment_confirmed',
    targetType: 'payment',
    targetId: payment.id,
    detail: { product: payment.product, amount: payment.amount_vnd, auto },
  });

  return getPayment(payment.id);
});

export function grantPremium(userId, days, paymentId = null) {
  const t = now();
  const active = get(
    `SELECT * FROM subscriptions WHERE user_id = ? AND plan = 'premium' AND status = 'active'
       AND expires_at > ? ORDER BY expires_at DESC LIMIT 1`,
    [userId, t]
  );

  if (active) {
    // Gia hạn: cộng dồn vào ngày hết hạn hiện tại.
    run('UPDATE subscriptions SET expires_at = ? WHERE id = ?', [
      active.expires_at + days * 86400000,
      active.id,
    ]);
  } else {
    insert(
      `INSERT INTO subscriptions (user_id, plan, status, started_at, expires_at, created_at)
       VALUES (?, 'premium', 'active', ?, ?, ?)`,
      [userId, t, t + days * 86400000, t]
    );
  }

  notify(userId, {
    kind: 'billing',
    title: 'Bạn đã có Vigo Premium',
    body: `Quyền lợi Premium đã được kích hoạt thêm ${days} ngày.`,
    data: { payment_id: paymentId },
  });
  return currentSubscription(userId);
}

export function startBoost(userId, minutes, paymentId = null) {
  const t = now();
  const expires = t + minutes * 60000;
  insert(
    `INSERT INTO boosts (user_id, started_at, expires_at, payment_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, t, expires, paymentId, t]
  );
  run('UPDATE profiles SET boosted_until = ?, updated_at = ? WHERE user_id = ?', [expires, t, userId]);
  notify(userId, {
    kind: 'billing',
    title: 'Boost đang chạy',
    body: `Hồ sơ của bạn được ưu tiên hiển thị trong ${minutes} phút tới.`,
    data: {},
  });
  return { expires_at: expires };
}

export function listPayments(userId) {
  return all('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 50', [userId]);
}

/** Hết hạn các gói quá ngày — gọi định kỳ. */
export function expireSubscriptions() {
  const t = now();
  const res = run(
    `UPDATE subscriptions SET status = 'expired'
     WHERE status = 'active' AND plan = 'premium' AND expires_at IS NOT NULL AND expires_at <= ?`,
    [t]
  );
  run('UPDATE profiles SET boosted_until = NULL WHERE boosted_until IS NOT NULL AND boosted_until <= ?', [t]);
  return Number(res.changes ?? 0);
}
