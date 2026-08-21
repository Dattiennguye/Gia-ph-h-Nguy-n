import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Verify the `initData` query string Telegram hands to a Mini App.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Returns the parsed payload, or throws with a short reason.
 */
export function verifyInitData(initData) {
  if (!initData || typeof initData !== 'string') throw new Error('initData missing');
  if (!config.botToken) throw new Error('BOT_TOKEN is not configured');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('initData has no hash');
  params.delete('hash');
  params.delete('signature'); // Ed25519 field, not part of the HMAC check

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('initData signature mismatch');

  const authDate = Number(params.get('auth_date') || 0);
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (!authDate || ageSec > config.initDataMaxAgeSec) throw new Error('initData expired');

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('initData has no user');
  const user = JSON.parse(rawUser);
  if (!user?.id) throw new Error('initData user has no id');

  return { user, startParam: params.get('start_param') || null, authDate };
}

// --- Session tokens -------------------------------------------------------
// initData ages out, so we validate it once at /api/auth and hand back a
// short-lived signed token that every later request carries instead.

function sign(payloadB64) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payloadB64).digest('base64url');
}

export function issueToken(userId) {
  const payload = { uid: userId, exp: Date.now() + config.sessionTtlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') throw new Error('no token');
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new Error('malformed token');

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad token signature');

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload?.uid || Date.now() > payload.exp) throw new Error('token expired');
  return payload.uid;
}

/** Express middleware: resolves `req.userId` from the Authorization header. */
export function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    req.userId = verifyToken(header.replace(/^Bearer\s+/i, ''));
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
