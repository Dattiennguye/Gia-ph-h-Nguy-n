import { all, get, insert, run, now, transaction } from '../db/index.js';
import {
  hashPassword,
  verifyPassword,
  randomToken,
  sha256,
  generateOtp,
} from '../lib/crypto.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, unauthorized, tooMany } from '../lib/http.js';
import { consume } from '../lib/rateLimit.js';
import { audit } from './audit.js';

/* --------------------------------------------------------------- người dùng */

export function findByEmail(email) {
  return get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
}
export function findByPhone(phone) {
  return get('SELECT * FROM users WHERE phone = ?', [phone]);
}
export function findById(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export const createUser = transaction(({ email, phone, password, oauth, displayName }) => {
  const t = now();
  if (email && findByEmail(email)) throw conflict('Email này đã được đăng ký');
  if (phone && findByPhone(phone)) throw conflict('Số điện thoại này đã được đăng ký');

  const userId = insert(
    `INSERT INTO users (email, phone, password_hash, oauth_provider, oauth_subject,
                        phone_verified, email_verified, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?)`,
    [
      email ?? null,
      phone ?? null,
      password ? hashPassword(password) : null,
      oauth?.provider ?? null,
      oauth?.subject ?? null,
      oauth ? 1 : 0,
      t,
      t,
    ]
  );

  // Hồ sơ và nhu cầu được tạo rỗng ngay, để mọi truy vấn sau đó luôn có dòng.
  run(
    `INSERT INTO profiles (user_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [userId, displayName ?? 'Người dùng mới', t, t]
  );
  run(
    `INSERT INTO preferences (user_id, interested_in, relationship_goals, updated_at)
     VALUES (?, '[]', '[]', ?)`,
    [userId, t]
  );
  run(
    `INSERT INTO subscriptions (user_id, plan, status, started_at, created_at)
     VALUES (?, 'free', 'active', ?, ?)`,
    [userId, t, t]
  );

  return findById(userId);
});

/* -------------------------------------------------------------------- phiên */

export function createSession(userId, { userAgent, ip } = {}) {
  const token = randomToken(32);
  const t = now();
  insert(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, sha256(token), userAgent ?? null, ip ?? null, t, t + config.sessionTtlMs]
  );
  run('UPDATE users SET last_active_at = ? WHERE id = ?', [t, userId]);
  return token;
}

export function resolveSession(token) {
  if (!token) return null;
  const row = get(
    `SELECT s.*, u.status AS user_status FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    [sha256(token), now()]
  );
  if (!row) return null;
  return findById(row.user_id);
}

export function revokeSession(token) {
  run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [now(), sha256(token)]);
}

export function revokeAllSessions(userId) {
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [
    now(),
    userId,
  ]);
}

export function listSessions(userId) {
  return all(
    `SELECT id, user_agent, ip, created_at, expires_at FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`,
    [userId, now()]
  );
}

/* ---------------------------------------------------------------------- OTP */

/** Gửi mã OTP. Trả về mã nếu cấu hình cho phép lộ (chỉ dùng khi dev/test). */
export function issueOtp({ channel, destination, purpose }) {
  consume(`otp:${destination}`, { limit: 5, windowMs: 15 * 60 * 1000 });

  const code = generateOtp();
  const t = now();
  // Mã cũ chưa dùng của cùng đích + mục đích sẽ bị vô hiệu.
  run(
    `UPDATE otp_codes SET consumed_at = ?
     WHERE destination = ? AND purpose = ? AND consumed_at IS NULL`,
    [t, destination, purpose]
  );
  insert(
    `INSERT INTO otp_codes (channel, destination, purpose, code_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [channel, destination, purpose, sha256(code), t, t + config.otp.ttlMs]
  );

  deliverOtp({ channel, destination, code, purpose });
  return config.otp.expose ? { code } : {};
}

function deliverOtp({ channel, destination, code, purpose }) {
  const text = `Mã xác minh Vigo Match của bạn là ${code}. Mã có hiệu lực trong ${Math.round(
    config.otp.ttlMs / 60000
  )} phút. Không chia sẻ mã này với bất kỳ ai.`;

  if (config.sms.provider === 'http' && config.sms.webhookUrl) {
    fetch(config.sms.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.sms.webhookToken
          ? { Authorization: `Bearer ${config.sms.webhookToken}` }
          : {}),
      },
      body: JSON.stringify({ channel, to: destination, text, purpose }),
    }).catch((err) => console.error('[otp] gửi thất bại:', err.message));
    return;
  }
  console.log(`\n  [OTP] ${channel} → ${destination} (${purpose}): ${code}\n`);
}

/** Đối chiếu mã. Ném lỗi nếu sai/hết hạn/quá số lần thử. */
export function verifyOtp({ destination, purpose, code }) {
  const row = get(
    `SELECT * FROM otp_codes
     WHERE destination = ? AND purpose = ? AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [destination, purpose]
  );
  if (!row) throw badRequest('Không tìm thấy mã xác minh. Hãy yêu cầu gửi lại.');
  if (row.expires_at < now()) throw badRequest('Mã xác minh đã hết hạn. Hãy yêu cầu gửi lại.');
  if (row.attempts >= config.otp.maxAttempts) {
    throw tooMany('Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.');
  }

  if (sha256(String(code)) !== row.code_hash) {
    run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
    const left = config.otp.maxAttempts - row.attempts - 1;
    throw badRequest(
      left > 0 ? `Mã không đúng. Bạn còn ${left} lần thử.` : 'Mã không đúng.'
    );
  }

  run('UPDATE otp_codes SET consumed_at = ? WHERE id = ?', [now(), row.id]);
  return true;
}

/* ------------------------------------------------------------- đăng nhập */

export function loginWithPassword({ identifier, password, isEmail, ctx }) {
  consume(`login:${identifier}`, { limit: 10, windowMs: 15 * 60 * 1000 });

  const user = isEmail ? findByEmail(identifier) : findByPhone(identifier);
  // So sánh cả khi không tìm thấy người dùng, để thời gian phản hồi không tiết
  // lộ tài khoản nào tồn tại.
  const ok = verifyPassword(password, user?.password_hash ?? 'scrypt$00$00');
  if (!user || !ok) throw unauthorized('Thông tin đăng nhập không đúng');

  assertUsable(user);
  const token = createSession(user.id, ctx);
  audit({ actorId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, ip: ctx?.ip });
  return { user, token };
}

/** Chặn tài khoản bị khoá ngay tại cửa đăng nhập. */
export function assertUsable(user) {
  if (user.status === 'banned') {
    throw forbidden(
      `Tài khoản đã bị khoá vĩnh viễn.${user.status_reason ? ` Lý do: ${user.status_reason}` : ''}`
    );
  }
  if (user.status === 'suspended') {
    throw forbidden(
      `Tài khoản đang tạm khoá để xem xét.${user.status_reason ? ` Lý do: ${user.status_reason}` : ''}`
    );
  }
  if (user.status === 'deleted') throw forbidden('Tài khoản đã bị xoá');
}

export function setPassword(userId, password) {
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    hashPassword(password),
    now(),
    userId,
  ]);
  revokeAllSessions(userId);
}

export function markPhoneVerified(userId, phone) {
  run(
    `UPDATE users SET phone = ?, phone_verified = 1,
       status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
       updated_at = ?
     WHERE id = ?`,
    [phone, now(), userId]
  );
  const t = now();
  run(
    `INSERT INTO verifications (user_id, type, status, created_at, reviewed_at)
     VALUES (?, 'phone', 'approved', ?, ?)
     ON CONFLICT(user_id, type) DO UPDATE SET status = 'approved', reviewed_at = ?`,
    [userId, t, t, t]
  );
}

export function touchActivity(userId) {
  run('UPDATE users SET last_active_at = ? WHERE id = ?', [now(), userId]);
}
