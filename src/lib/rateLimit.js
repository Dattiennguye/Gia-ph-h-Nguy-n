import { get, run, now } from '../db/index.js';
import { tooMany } from './http.js';
import { config } from '../config.js';

/**
 * Giới hạn tần suất theo cửa sổ thời gian, lưu trong SQLite nên vẫn đúng sau
 * khi khởi động lại tiến trình.
 */
export function consume(bucket, { limit: rawLimit, windowMs }) {
  const limit = rawLimit * config.rateLimitFactor;
  const t = now();
  const windowStart = Math.floor(t / windowMs) * windowMs;

  run(
    `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1`,
    [bucket, windowStart]
  );
  const row = get('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?', [
    bucket,
    windowStart,
  ]);

  // Dọn cửa sổ cũ, thỉnh thoảng thôi cho nhẹ.
  if (Math.random() < 0.02) {
    run('DELETE FROM rate_limits WHERE window_start < ?', [t - windowMs * 4]);
  }

  if ((row?.count ?? 0) > limit) {
    const retryIn = Math.ceil((windowStart + windowMs - t) / 1000);
    throw tooMany(`Bạn thao tác quá nhanh. Vui lòng thử lại sau ${retryIn} giây.`);
  }
  return { remaining: Math.max(0, limit - (row?.count ?? 0)) };
}

/** Middleware tiện dụng: giới hạn theo IP cho một nhóm route. */
export function limitByIp(name, limit, windowMs) {
  return (req, res, next) => {
    try {
      consume(`${name}:${req.ip}`, { limit, windowMs });
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Giới hạn theo người dùng đã đăng nhập. */
export function limitByUser(name, limit, windowMs) {
  return (req, res, next) => {
    try {
      consume(`${name}:user:${req.user?.id ?? req.ip}`, { limit, windowMs });
      next();
    } catch (err) {
      next(err);
    }
  };
}
