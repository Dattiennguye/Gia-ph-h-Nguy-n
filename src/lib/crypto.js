import crypto from 'node:crypto';
import { config } from '../config.js';

/* ------------------------------------------------------------------ mật khẩu */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT.keylen, SCRYPT);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* -------------------------------------------------------------------- token */

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Token có chữ ký: `<payload base64url>.<hmac>` — không cần lưu DB để xác thực hình dạng. */
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** Băm một chiều — dùng cho OTP, session token lưu trong DB, tra cứu CCCD trùng. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/* -------------------------------------------------- mã hoá dữ liệu nhạy cảm */

/**
 * AES-256-GCM. Dùng cho số CCCD và các trường giấy tờ: dữ liệu này không bao
 * giờ được trả ra API công khai, chỉ tồn tại để đối chiếu khi cần.
 */
export function encryptPII(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.piiKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptPII(blob) {
  if (!blob) return null;
  const [version, ivB64, tagB64, dataB64] = String(blob).split('.');
  if (version !== 'v1') return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      config.piiKey,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** Mã OTP 6 số, sinh bằng nguồn ngẫu nhiên an toàn. */
export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Số ngẫu nhiên ổn định trong [0,1) từ một chuỗi — dùng cho gợi ý theo ngày. */
export function seededUnit(seed) {
  const h = crypto.createHash('sha256').update(String(seed)).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000;
}
