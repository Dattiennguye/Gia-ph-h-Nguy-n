import { Router } from 'express';
import { wrap, badRequest, unauthorized, ApiError } from '../lib/http.js';
import { verifyIdentityToken, isConfigured, configuredProviders } from '../lib/oauth.js';
import * as v from '../lib/validate.js';
import * as auth from '../services/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { limitByIp } from '../lib/rateLimit.js';
import { updateProfile } from '../services/profiles.js';
import { audit } from '../services/audit.js';
import { config } from '../config.js';

export const authRouter = Router();

const ctxOf = (req) => ({ userAgent: req.get('user-agent'), ip: req.ip });
const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  phone: u.phone ? `${u.phone.slice(0, 6)}***${u.phone.slice(-2)}` : null,
  role: u.role,
  status: u.status,
  phone_verified: Boolean(u.phone_verified),
  onboarding_step: u.onboarding_step,
  created_at: u.created_at,
});

/* --------------------------------------------------------------- đăng ký */

authRouter.post(
  '/register',
  limitByIp('register', 10, 60 * 60 * 1000),
  wrap((req, res) => {
    const { method } = req.body ?? {};
    const displayName = v.str(req.body?.display_name, 'display_name', { min: 2, max: 50 });

    let user;
    if (method === 'phone') {
      const phone = v.phone(req.body?.phone);
      const password = v.password(req.body?.password);
      user = auth.createUser({ phone, password, displayName });
      const otp = auth.issueOtp({ channel: 'phone', destination: phone, purpose: 'verify_phone' });
      const token = auth.createSession(user.id, ctxOf(req));
      audit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, detail: { method } });
      return res.status(201).json({
        user: publicUser(user),
        token,
        next: 'verify_phone',
        message: `Chúng tôi đã gửi mã xác minh tới ${phone}.`,
        ...otp,
      });
    }

    if (method === 'email') {
      const email = v.email(req.body?.email);
      const password = v.password(req.body?.password);
      user = auth.createUser({ email, password, displayName });
      const token = auth.createSession(user.id, ctxOf(req));
      audit({ actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, detail: { method } });
      return res.status(201).json({
        user: publicUser(user),
        token,
        next: 'verify_phone',
        message: 'Đăng ký thành công. Hãy xác minh số điện thoại để bắt đầu.',
      });
    }

    throw badRequest('Phương thức đăng ký phải là "phone" hoặc "email"');
  })
);

/**
 * Đăng nhập/đăng ký bằng Google hoặc Apple.
 *
 * Ở bản này, máy chủ nhận một `identity_token` đã được xác thực ở tầng cổng
 * (hoặc, khi chạy dev, một subject do client cung cấp). Chỗ cần thay khi đưa
 * lên môi trường thật là hàm verifyOAuthToken dưới đây: gọi tới endpoint
 * tokeninfo của Google / khoá công khai của Apple.
 */
authRouter.post(
  '/oauth',
  limitByIp('oauth', 20, 60 * 60 * 1000),
  wrap(async (req, res) => {
    const provider = req.body?.provider;
    if (!['google', 'apple'].includes(provider)) throw badRequest('Nhà cung cấp không được hỗ trợ');

    const claims = await verifyOAuthToken(provider, req.body);
    let user = claims.email ? auth.findByEmail(claims.email) : null;
    let created = false;

    if (!user) {
      user = auth.createUser({
        email: claims.email ?? null,
        oauth: { provider, subject: claims.subject },
        displayName: claims.name ?? 'Người dùng mới',
      });
      created = true;
    }
    auth.assertUsable(user);
    const token = auth.createSession(user.id, ctxOf(req));
    audit({ actorId: user.id, action: created ? 'auth.register' : 'auth.login', targetType: 'user', targetId: user.id, detail: { provider } });

    res.json({
      user: publicUser(user),
      token,
      created,
      next: user.phone_verified ? 'ready' : 'verify_phone',
    });
  })
);

/**
 * Xác thực token của nhà cung cấp.
 *
 * Chữ ký được kiểm tra tại chỗ bằng khoá công khai của nhà cung cấp, và quan
 * trọng nhất là kiểm tra `aud` — token phải được cấp CHO ỨNG DỤNG NÀY. Không
 * có bước đó thì một token hợp lệ do bất kỳ ứng dụng nào khác cấp cũng đăng
 * nhập được vào đây.
 */
async function verifyOAuthToken(provider, body) {
  if (body.identity_token) {
    try {
      const claims = await verifyIdentityToken(provider, body.identity_token);
      if (claims.email && !claims.emailVerified) {
        throw unauthorized(`Email ${provider === 'apple' ? 'Apple' : 'Google'} chưa được xác minh`);
      }
      return {
        subject: claims.subject,
        email: claims.email,
        // Apple chỉ gửi tên ở lần đăng nhập đầu tiên và gửi NGOÀI token, nên
        // client phải chuyển kèm; không có thì để trống rồi hỏi sau.
        name: claims.name ?? body.full_name ?? null,
      };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw unauthorized(err.message);
    }
  }

  if (!config.isProd && body.dev_subject) {
    // Lối vào dành riêng cho phát triển/kiểm thử. Bị chặn ở môi trường thật.
    return {
      subject: String(body.dev_subject),
      email: body.dev_email ?? null,
      name: body.dev_name ?? null,
    };
  }

  throw badRequest(
    isConfigured(provider)
      ? 'Thiếu identity_token'
      : `Chưa cấu hình đăng nhập ${provider === 'apple' ? 'Apple' : 'Google'} trên máy chủ này.`
  );
}

/* ------------------------------------------------------------- xác minh SĐT */

authRouter.post(
  '/phone/send-otp',
  requireAuth,
  limitByIp('send-otp', 20, 60 * 60 * 1000),
  wrap((req, res) => {
    const phone = v.phone(req.body?.phone ?? req.user.phone);
    const clash = auth.findByPhone(phone);
    if (clash && clash.id !== req.user.id) throw badRequest('Số điện thoại này đã được dùng cho tài khoản khác');
    const otp = auth.issueOtp({ channel: 'phone', destination: phone, purpose: 'verify_phone' });
    res.json({ sent: true, phone, message: `Đã gửi mã tới ${phone}.`, ...otp });
  })
);

authRouter.post(
  '/phone/verify',
  requireAuth,
  wrap((req, res) => {
    const phone = v.phone(req.body?.phone ?? req.user.phone);
    const code = v.str(req.body?.code, 'code', { min: 4, max: 8 });
    auth.verifyOtp({ destination: phone, purpose: 'verify_phone', code });
    auth.markPhoneVerified(req.user.id, phone);
    audit({ actorId: req.user.id, action: 'auth.phone_verified', targetType: 'user', targetId: req.user.id });
    res.json({
      verified: true,
      user: publicUser(auth.findById(req.user.id)),
      message: 'Xác minh số điện thoại thành công.',
    });
  })
);

/* ------------------------------------------------------------ đăng nhập */

authRouter.post(
  '/login',
  limitByIp('login', 30, 15 * 60 * 1000),
  wrap((req, res) => {
    const identifierRaw = req.body?.identifier;
    if (!identifierRaw) throw badRequest('Thiếu email hoặc số điện thoại');

    const isEmail = String(identifierRaw).includes('@');
    const identifier = isEmail ? v.email(identifierRaw) : v.phone(identifierRaw);
    const password = v.str(req.body?.password, 'password', { min: 1, max: 200 });

    const { user, token } = auth.loginWithPassword({ identifier, password, isEmail, ctx: ctxOf(req) });
    res.json({
      user: publicUser(user),
      token,
      next: user.phone_verified ? 'ready' : 'verify_phone',
    });
  })
);

/** Đăng nhập bằng mã OTP, không cần mật khẩu. */
authRouter.post(
  '/login/otp/send',
  limitByIp('login-otp', 20, 60 * 60 * 1000),
  wrap((req, res) => {
    const phone = v.phone(req.body?.phone);
    const user = auth.findByPhone(phone);
    // Không tiết lộ số nào đã đăng ký — thông điệp trả về luôn như nhau.
    const otp = user
      ? auth.issueOtp({ channel: 'phone', destination: phone, purpose: 'login' })
      : {};
    res.json({
      sent: true,
      message: 'Nếu số này đã đăng ký, bạn sẽ nhận được mã đăng nhập.',
      ...otp,
    });
  })
);

authRouter.post(
  '/login/otp/verify',
  limitByIp('login-otp-verify', 30, 15 * 60 * 1000),
  wrap((req, res) => {
    const phone = v.phone(req.body?.phone);
    const code = v.str(req.body?.code, 'code', { min: 4, max: 8 });
    auth.verifyOtp({ destination: phone, purpose: 'login', code });
    const user = auth.findByPhone(phone);
    if (!user) throw unauthorized('Không tìm thấy tài khoản');
    auth.assertUsable(user);
    const token = auth.createSession(user.id, ctxOf(req));
    res.json({ user: publicUser(user), token, next: 'ready' });
  })
);

/* -------------------------------------------------------------- phiên làm việc */

authRouter.get(
  '/me',
  requireAuth,
  wrap((req, res) => {
    res.json({ user: publicUser(auth.findById(req.user.id)) });
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  wrap((req, res) => {
    auth.revokeSession(req.token);
    res.json({ ok: true });
  })
);

authRouter.get(
  '/sessions',
  requireAuth,
  wrap((req, res) => res.json({ sessions: auth.listSessions(req.user.id) }))
);

authRouter.post(
  '/sessions/revoke-all',
  requireAuth,
  wrap((req, res) => {
    auth.revokeAllSessions(req.user.id);
    res.json({ ok: true, message: 'Đã đăng xuất khỏi tất cả thiết bị.' });
  })
);

authRouter.post(
  '/password',
  requireAuth,
  wrap((req, res) => {
    const next = v.password(req.body?.new_password);
    auth.setPassword(req.user.id, next);
    audit({ actorId: req.user.id, action: 'auth.password_changed', targetType: 'user', targetId: req.user.id });
    res.json({ ok: true, message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.' });
  })
);

/** Bước đầu sau đăng ký: "Bạn đang tìm gì?" */
authRouter.post(
  '/onboarding/goal',
  requireAuth,
  wrap((req, res) => {
    const goal = v.enumValue(req.body?.relationship_goal, 'relationship_goal', 'relationship_goal');
    updateProfile(req.user.id, { relationship_goal: goal });
    res.json({ ok: true, relationship_goal: goal, next: 'basic_profile' });
  })
);
