import crypto from 'node:crypto';

/**
 * XÁC THỰC ID TOKEN (JWT) CỦA NHÀ CUNG CẤP ĐĂNG NHẬP
 *
 * Dùng cho Đăng nhập bằng Google và Apple. Tự kiểm tra chữ ký thay vì gọi
 * endpoint "tokeninfo" của nhà cung cấp, vì hai lý do:
 *
 *   1. Endpoint đó chỉ nói token có chữ ký hợp lệ hay không — nó KHÔNG nói
 *      token được cấp cho ứng dụng nào. Nếu không tự kiểm tra `aud`, thì một
 *      token hợp lệ do bất kỳ ứng dụng nào khác trên đời cấp cũng đăng nhập
 *      được vào đây. Đó là lỗ hổng chiếm tài khoản.
 *   2. Mỗi lần đăng nhập là một vòng gọi mạng thêm.
 *
 * Thuật toán được SUY RA TỪ KHOÁ trong JWKS, không phải từ tiêu đề token.
 * Nếu tin theo tiêu đề, kẻ tấn công chỉ cần đổi `alg` thành `none` hoặc đổi
 * RS256 thành HS256 rồi ký bằng chính khoá công khai — một lớp tấn công kinh
 * điển vào các thư viện JWT.
 */

const CLOCK_SKEW_MS = 60_000;

/* ------------------------------------------------------ bộ nhớ đệm JWKS */

const jwksCache = new Map(); // url -> { keys, expiresAt }
const JWKS_TTL_MS = 60 * 60 * 1000;

async function loadJwks(url, { force = false } = {}) {
  const cached = jwksCache.get(url);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.keys;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Không tải được khoá công khai (${res.status})`);
  const body = await res.json();
  if (!Array.isArray(body?.keys)) throw new Error('Khoá công khai trả về sai định dạng');

  jwksCache.set(url, { keys: body.keys, expiresAt: Date.now() + JWKS_TTL_MS });
  return body.keys;
}

export function clearJwksCache() {
  jwksCache.clear();
}

/* ----------------------------------------------------------- giải mã JWT */

const b64urlToBuffer = (s) => Buffer.from(s, 'base64url');
const b64urlToJson = (s) => JSON.parse(b64urlToBuffer(s).toString('utf8'));

/** Thuật toán hợp lệ cho một khoá, suy ra từ chính khoá đó. */
function algorithmsFor(jwk) {
  if (jwk.alg) return [jwk.alg];
  if (jwk.kty === 'RSA') return ['RS256', 'RS384', 'RS512'];
  if (jwk.kty === 'EC') {
    return { 'P-256': ['ES256'], 'P-384': ['ES384'], 'P-521': ['ES512'] }[jwk.crv] ?? [];
  }
  return [];
}

const DIGEST = { 256: 'sha256', 384: 'sha384', 512: 'sha512' };

function verifySignature(alg, signingInput, signature, jwk) {
  const bits = Number(alg.slice(2));
  const digest = DIGEST[bits];
  if (!digest) return false;

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });

  if (alg.startsWith('RS')) {
    return crypto.verify(digest, Buffer.from(signingInput), key, signature);
  }
  if (alg.startsWith('PS')) {
    return crypto.verify(digest, Buffer.from(signingInput), {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, signature);
  }
  if (alg.startsWith('ES')) {
    // Chữ ký ECDSA trong JWT là r‖s thô, không phải DER như mặc định của Node.
    return crypto.verify(digest, Buffer.from(signingInput), {
      key,
      dsaEncoding: 'ieee-p1363',
    }, signature);
  }
  return false;
}

/**
 * Xác thực một ID token.
 *
 * @param {string} token        chuỗi JWT
 * @param {string} jwksUrl      địa chỉ khoá công khai của nhà cung cấp
 * @param {string} issuer       giá trị `iss` bắt buộc
 * @param {string[]} audience   danh sách client id được chấp nhận
 * @returns {Promise<object>}   phần claims đã được xác thực
 */
export async function verifyIdToken(token, { jwksUrl, issuer, audience }) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new Error('Token không đúng định dạng');
  }
  if (!audience?.length) {
    throw new Error('Chưa cấu hình client id — không thể xác thực token');
  }

  const [headerB64, payloadB64, signatureB64] = token.split('.');
  let header;
  let claims;
  try {
    header = b64urlToJson(headerB64);
    claims = b64urlToJson(payloadB64);
  } catch {
    throw new Error('Token không đọc được');
  }

  if (!header.kid) throw new Error('Token thiếu định danh khoá (kid)');

  // Không tìm thấy kid có thể là do nhà cung cấp vừa xoay khoá — tải lại một lần.
  let keys = await loadJwks(jwksUrl);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(jwksUrl, { force: true });
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error('Không tìm thấy khoá công khai tương ứng với token');

  const allowed = algorithmsFor(jwk);
  if (!allowed.includes(header.alg)) {
    throw new Error(`Thuật toán "${header.alg}" không hợp lệ cho khoá này`);
  }

  const ok = verifySignature(
    header.alg,
    `${headerB64}.${payloadB64}`,
    b64urlToBuffer(signatureB64),
    jwk
  );
  if (!ok) throw new Error('Chữ ký token không hợp lệ');

  /* --- claims --- */
  const nowMs = Date.now();

  if (claims.iss !== issuer) {
    throw new Error(`Token do "${claims.iss}" cấp, không phải "${issuer}"`);
  }

  // Đây là kiểm tra quan trọng nhất: token được cấp CHO ỨNG DỤNG NÀO.
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.some((a) => audience.includes(a))) {
    throw new Error('Token được cấp cho một ứng dụng khác');
  }

  if (typeof claims.exp !== 'number' || claims.exp * 1000 + CLOCK_SKEW_MS < nowMs) {
    throw new Error('Token đã hết hạn');
  }
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 - CLOCK_SKEW_MS > nowMs) {
    throw new Error('Token chưa có hiệu lực');
  }
  if (typeof claims.iat === 'number' && claims.iat * 1000 - CLOCK_SKEW_MS > nowMs) {
    throw new Error('Token có thời điểm phát hành trong tương lai');
  }
  if (!claims.sub) throw new Error('Token thiếu định danh người dùng (sub)');

  return claims;
}
