import { all, get, run, now, transaction } from '../db/index.js';
import { onlineCount } from '../lib/events.js';
import { notFound, badRequest } from '../lib/http.js';
import { audit } from './audit.js';
import { loadProfile } from './profiles.js';
import { publicRegionLabel } from './regions.js';

const DAY = 86400000;

/** Số liệu tổng quan cho bảng điều khiển quản trị. */
export function dashboard() {
  const t = now();
  const one = (sql, params = []) => get(sql, params)?.n ?? 0;

  return {
    users: {
      total: one("SELECT COUNT(*) AS n FROM users WHERE status != 'deleted'"),
      active_today: one('SELECT COUNT(*) AS n FROM users WHERE last_active_at > ?', [t - DAY]),
      active_week: one('SELECT COUNT(*) AS n FROM users WHERE last_active_at > ?', [t - 7 * DAY]),
      new_today: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [t - DAY]),
      new_week: one('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', [t - 7 * DAY]),
      suspended: one("SELECT COUNT(*) AS n FROM users WHERE status = 'suspended'"),
      banned: one("SELECT COUNT(*) AS n FROM users WHERE status = 'banned'"),
      online_now: onlineCount(),
    },
    engagement: {
      likes_today: one('SELECT COUNT(*) AS n FROM likes WHERE created_at > ?', [t - DAY]),
      matches_total: one("SELECT COUNT(*) AS n FROM matches WHERE status = 'active'"),
      matches_today: one('SELECT COUNT(*) AS n FROM matches WHERE created_at > ?', [t - DAY]),
      messages_today: one('SELECT COUNT(*) AS n FROM messages WHERE created_at > ?', [t - DAY]),
      conversations_active: one(
        'SELECT COUNT(*) AS n FROM conversations WHERE last_message_at > ?', [t - 7 * DAY]
      ),
    },
    safety: {
      reports_open: one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      reports_total: one('SELECT COUNT(*) AS n FROM reports'),
      cases_open: one("SELECT COUNT(*) AS n FROM moderation_cases WHERE status IN ('open','reviewing')"),
      cases_high: one("SELECT COUNT(*) AS n FROM moderation_cases WHERE status = 'open' AND risk = 'high'"),
      messages_blocked_week: one(
        "SELECT COUNT(*) AS n FROM safety_events WHERE kind = 'message_scan' AND created_at > ?",
        [t - 7 * DAY]
      ),
      verifications_pending: one("SELECT COUNT(*) AS n FROM verifications WHERE status = 'pending'"),
    },
    business: {
      premium_active: one(
        `SELECT COUNT(*) AS n FROM subscriptions WHERE plan = 'premium' AND status = 'active'
           AND (expires_at IS NULL OR expires_at > ?)`, [t]
      ),
      revenue_month_vnd:
        get(
          `SELECT COALESCE(SUM(amount_vnd), 0) AS n FROM payments
           WHERE status = 'paid' AND paid_at > ?`, [t - 30 * DAY]
        )?.n ?? 0,
      payments_pending: one("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'"),
    },
  };
}

/** Phân bố người dùng theo tỉnh/thành — để biết nên mở khu vực nào tiếp theo. */
export function regionDensity({ limit = 20 } = {}) {
  return all(
    `SELECT prov.id, prov.name, prov.signup_open,
            COUNT(p.user_id) AS users,
            SUM(CASE WHEN pr.gender = 'male' THEN 1 ELSE 0 END) AS male,
            SUM(CASE WHEN pr.gender = 'female' THEN 1 ELSE 0 END) AS female
     FROM regions prov
     LEFT JOIN regions r ON (r.id = prov.id OR r.parent_id = prov.id
                             OR r.parent_id IN (SELECT id FROM regions WHERE parent_id = prov.id))
     LEFT JOIN profiles p ON p.region_id = r.id
     LEFT JOIN profiles pr ON pr.user_id = p.user_id
     LEFT JOIN users u ON u.id = p.user_id AND u.status = 'active'
     WHERE prov.level = 'province'
     GROUP BY prov.id
     ORDER BY users DESC LIMIT ?`,
    [limit]
  ).map((r) => ({
    ...r,
    users: r.users ?? 0,
    // Tỷ lệ giới tính là chỉ số quan trọng nhất: lệch quá thì trải nghiệm hỏng.
    gender_ratio:
      r.female > 0 ? Number(((r.male ?? 0) / r.female).toFixed(2)) : r.male > 0 ? null : 0,
  }));
}

/** Tìm và liệt kê người dùng cho phần quản trị. */
export function listUsers({ query = '', status = null, limit = 50, offset = 0 } = {}) {
  const where = ["u.status != 'deleted'"];
  const params = [];
  if (status) {
    where.push('u.status = ?');
    params.push(status);
  }
  if (query) {
    where.push('(u.email LIKE ? OR u.phone LIKE ? OR p.display_name LIKE ?)');
    const q = `%${query}%`;
    params.push(q, q, q);
  }

  return all(
    `SELECT u.id, u.email, u.phone, u.role, u.status, u.status_reason, u.risk_score,
            u.phone_verified, u.created_at, u.last_active_at,
            p.display_name, p.region_id, p.completeness, p.visibility,
            (SELECT COUNT(*) FROM reports r WHERE r.target_id = u.id) AS reports,
            (SELECT COUNT(*) FROM matches m WHERE (m.user_a = u.id OR m.user_b = u.id) AND m.status='active') AS matches
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((u) => ({ ...u, area: u.region_id ? publicRegionLabel(u.region_id) : null }));
}

/**
 * Hồ sơ đầy đủ của một người dùng cho quản trị viên.
 * Lưu ý: KHÔNG trả về nội dung giấy tờ đã mã hoá — chỉ trả trạng thái xác minh.
 */
export function userDetail(userId) {
  const u = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u) throw notFound('Không tìm thấy người dùng');
  const { password_hash, ...safe } = u;

  // Quản trị viên cần biết người dùng ở khu vực nào, không cần toạ độ chính
  // xác. Bỏ lat/lng ra khỏi response để một tài khoản quản trị bị chiếm quyền
  // không kéo theo việc lộ vị trí nhà của toàn bộ người dùng.
  const { lat, lng, ...profile } = loadProfile(userId) ?? {};

  return {
    user: safe,
    profile: {
      ...profile,
      area: profile.region_id ? publicRegionLabel(profile.region_id) : null,
      coordinates: 'ẩn',
    },
    verifications: all(
      'SELECT id, type, status, review_note, created_at, reviewed_at FROM verifications WHERE user_id = ?',
      [userId]
    ),
    reports_against: all(
      `SELECT r.id, r.category, r.detail, r.status, r.created_at FROM reports r
       WHERE r.target_id = ? ORDER BY r.id DESC LIMIT 20`,
      [userId]
    ),
    reports_by: get('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ?', [userId]).n,
    safety_events: all(
      'SELECT kind, severity, created_at FROM safety_events WHERE user_id = ? ORDER BY id DESC LIMIT 20',
      [userId]
    ),
    stats: {
      likes_sent: get("SELECT COUNT(*) AS n FROM likes WHERE from_user = ? AND action != 'pass'", [userId]).n,
      likes_received: get("SELECT COUNT(*) AS n FROM likes WHERE to_user = ? AND action != 'pass'", [userId]).n,
      matches: get(
        "SELECT COUNT(*) AS n FROM matches WHERE (user_a = ? OR user_b = ?) AND status = 'active'",
        [userId, userId]
      ).n,
      messages_sent: get('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ?', [userId]).n,
    },
    payments: all('SELECT * FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 10', [userId]),
  };
}

const STATUSES = ['active', 'suspended', 'banned'];

export const setUserStatus = transaction((adminId, userId, status, reason) => {
  if (!STATUSES.includes(status)) throw badRequest('Trạng thái không hợp lệ');
  const u = get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!u) throw notFound('Không tìm thấy người dùng');
  if (u.role === 'admin' && status !== 'active') {
    throw badRequest('Không thể khoá tài khoản quản trị viên');
  }

  run('UPDATE users SET status = ?, status_reason = ?, updated_at = ? WHERE id = ?', [
    status, reason ?? null, now(), userId,
  ]);
  // Khoá vĩnh viễn thì thu hồi mọi phiên. Tạm khoá thì giữ phiên lại, để lần
  // thao tác kế tiếp người dùng nhận được thông báo kèm lý do thay vì bị đăng
  // xuất không rõ nguyên nhân.
  if (status === 'banned') {
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now(), userId]);
  }
  audit({
    actorId: adminId,
    actorRole: 'admin',
    action: `admin.set_status.${status}`,
    targetType: 'user',
    targetId: userId,
    detail: { reason },
  });
  return { ok: true, status };
});

export function setUserRole(adminId, userId, role) {
  if (!['user', 'moderator', 'admin'].includes(role)) throw badRequest('Vai trò không hợp lệ');
  run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [role, now(), userId]);
  audit({
    actorId: adminId,
    actorRole: 'admin',
    action: 'admin.set_role',
    targetType: 'user',
    targetId: userId,
    detail: { role },
  });
  return { ok: true, role };
}

/** Chuỗi số liệu theo ngày, cho biểu đồ. */
export function timeseries({ days = 14 } = {}) {
  const out = [];
  const t = now();
  for (let i = days - 1; i >= 0; i -= 1) {
    const end = t - i * DAY;
    const start = end - DAY;
    const label = new Date(end).toISOString().slice(0, 10);
    out.push({
      date: label,
      new_users: get('SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?', [start, end]).n,
      matches: get('SELECT COUNT(*) AS n FROM matches WHERE created_at >= ? AND created_at < ?', [start, end]).n,
      messages: get('SELECT COUNT(*) AS n FROM messages WHERE created_at >= ? AND created_at < ?', [start, end]).n,
      reports: get('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ? AND created_at < ?', [start, end]).n,
    });
  }
  return out;
}
