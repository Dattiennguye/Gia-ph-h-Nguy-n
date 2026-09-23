import { verifyIdToken } from './jwt.js';
import { config } from '../config.js';

/**
 * ĐĂNG NHẬP BẰNG GOOGLE / APPLE
 *
 * Trả về thông tin đã xác thực: { subject, email, emailVerified, name }.
 * `subject` là định danh ổn định của người dùng ở phía nhà cung cấp — đó mới là
 * khoá để nhận ra người quay lại, không phải email (email có thể đổi, và với
 * Apple còn có thể là địa chỉ chuyển tiếp ẩn danh).
 */

const PROVIDERS = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    // Google phát hành token với `iss` ở một trong hai dạng này.
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audience: () => config.oauth.googleClientIds,
    label: 'Google',
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audience: () => config.oauth.appleClientIds,
    label: 'Apple',
  },
};

export function isConfigured(provider) {
  const p = PROVIDERS[provider];
  return Boolean(p && p.audience().length);
}

export function configuredProviders() {
  return Object.keys(PROVIDERS).filter(isConfigured);
}

/**
 * @param {'google'|'apple'} provider
 * @param {string} identityToken JWT nhận từ SDK phía client
 */
export async function verifyIdentityToken(provider, identityToken) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Nhà cung cấp không được hỗ trợ: ${provider}`);

  const audience = p.audience();
  if (!audience.length) {
    throw new Error(
      `Chưa cấu hình đăng nhập ${p.label}. Đặt ${provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'APPLE_CLIENT_ID'} trong .env`
    );
  }

  // Thử lần lượt các dạng `iss` hợp lệ của nhà cung cấp.
  let claims;
  let lastError;
  for (const issuer of p.issuers) {
    try {
      claims = await verifyIdToken(identityToken, {
        jwksUrl: p.jwksUrl,
        issuer,
        audience,
      });
      break;
    } catch (err) {
      lastError = err;
      // Sai `iss` thì thử dạng tiếp theo; mọi lỗi khác thì dừng ngay.
      if (!/do ".*" cấp/.test(err.message)) throw err;
    }
  }
  if (!claims) throw lastError;

  // Apple trả email_verified dưới dạng chuỗi "true"; Google trả boolean.
  const emailVerified =
    claims.email_verified === true || claims.email_verified === 'true';

  return {
    subject: claims.sub,
    email: claims.email ?? null,
    emailVerified,
    // Apple chỉ gửi tên ở lần đăng nhập ĐẦU TIÊN, và gửi ngoài token — client
    // phải chuyển lên cùng request, nếu không thì không bao giờ lấy lại được.
    name: claims.name ?? null,
    isPrivateRelay: Boolean(claims.is_private_email) || /@privaterelay\.appleid\.com$/i.test(claims.email ?? ''),
  };
}
