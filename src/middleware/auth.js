import { resolveSession, touchActivity, assertUsable } from '../services/auth.js';
import { unauthorized, forbidden } from '../lib/http.js';

/**
 * Lối vào dành riêng cho EventSource, thứ duy nhất trong trình duyệt không cho
 * đặt tiêu đề Authorization. Chỉ gắn vào đúng route luồng sự kiện.
 */
export function attachUserFromQuery(req, res, next) {
  if (!req.user && req.query?.token) {
    const user = resolveSession(String(req.query.token));
    if (user) {
      req.user = user;
      req.token = String(req.query.token);
    }
  }
  next();
}

/**
 * Token LUÔN đọc từ tiêu đề Authorization.
 *
 * Không chấp nhận `?token=` ở đây: token nằm trong URL sẽ lọt vào log máy chủ,
 * lịch sử trình duyệt và tiêu đề Referer. Riêng kênh SSE không đặt được tiêu đề
 * nên có lối đi riêng, giới hạn đúng một endpoint (xem routes/social.js).
 */
function tokenFrom(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Gắn req.user nếu có token hợp lệ, nhưng không bắt buộc. */
export function attachUser(req, res, next) {
  const token = tokenFrom(req);
  if (!token) return next();
  const user = resolveSession(token);
  if (user) {
    req.user = user;
    req.token = token;
  }
  next();
}

/** Bắt buộc đăng nhập. */
export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  try {
    assertUsable(req.user);
  } catch (err) {
    return next(err);
  }
  // Cập nhật "hoạt động lần cuối" nhưng không phải mỗi request — mỗi 2 phút là đủ.
  if (!req.user.last_active_at || Date.now() - req.user.last_active_at > 120000) {
    touchActivity(req.user.id);
  }
  next();
}

/** Bắt buộc đã xác minh số điện thoại — cửa vào mọi tính năng xã hội. */
export function requireVerified(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.phone_verified) {
    return next(
      forbidden('Bạn cần xác minh số điện thoại trước khi dùng tính năng này')
    );
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Bạn không có quyền truy cập khu vực này'));
    }
    next();
  };
}
