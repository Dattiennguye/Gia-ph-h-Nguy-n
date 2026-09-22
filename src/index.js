import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, get, run, now } from './db/index.js';
import { seedRegions } from './services/regions.js';
import { errorHandler } from './lib/http.js';
import { attachUser } from './middleware/auth.js';
import { expireSubscriptions } from './services/billing.js';
import { hashPassword } from './lib/crypto.js';
import { uploadDir } from './lib/images.js';

import { authRouter } from './routes/auth.js';
import { profileRouter } from './routes/profile.js';
import { discoveryRouter } from './routes/discovery.js';
import { socialRouter } from './routes/social.js';
import { metaRouter } from './routes/meta.js';
import { billingRouter } from './routes/billing.js';
import { verificationRouter } from './routes/verification.js';
import { adminRouter } from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ khởi tạo DB */

export function bootstrap() {
  migrate();
  const seeded = seedRegions();
  if (seeded) console.log(`[db] Đã nạp ${seeded} đơn vị hành chính.`);
  ensureAdmin();
  expireSubscriptions();
}

/** Tạo tài khoản quản trị đầu tiên nếu chưa có và đã cấu hình mật khẩu. */
function ensureAdmin() {
  const existing = get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) return;
  if (!config.admin.password) {
    console.log(
      '[admin] Chưa có tài khoản quản trị. Đặt ADMIN_EMAIL và ADMIN_PASSWORD trong .env rồi khởi động lại để tạo.'
    );
    return;
  }
  const t = now();
  run(
    `INSERT INTO users (email, password_hash, role, status, email_verified, phone_verified, created_at, updated_at)
     VALUES (?, ?, 'admin', 'active', 1, 1, ?, ?)`,
    [config.admin.email, hashPassword(config.admin.password), t, t]
  );
  const id = get('SELECT id FROM users WHERE email = ?', [config.admin.email]).id;
  run(`INSERT INTO profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)`, [
    id, 'Quản trị viên', t, t,
  ]);
  run(`INSERT INTO preferences (user_id, updated_at) VALUES (?, ?)`, [id, t]);
  console.log(`[admin] Đã tạo tài khoản quản trị: ${config.admin.email}`);
}

/* --------------------------------------------------------------- ứng dụng */

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // Tiêu đề bảo mật.
  //
  // CSP khoá chặt: không script từ bên ngoài, không nhúng vào iframe, không gửi
  // dữ liệu đi đâu khác ngoài chính máy chủ này. Ảnh cho phép data: vì ảnh đại
  // diện được nhúng trực tiếp, nhưng KHÔNG cho phép ảnh từ tên miền lạ — tránh
  // việc một người đặt ảnh trỏ sang máy chủ của họ để ghi lại IP người xem.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // Chỉ bật HSTS khi chạy thật qua HTTPS — bật lúc dev sẽ khoá luôn localhost.
    if (config.isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(attachUser);

  app.use('/api/auth', authRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/discovery', discoveryRouter);
  app.use('/api/social', socialRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/verification', verificationRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', message: `Không có endpoint ${req.method} ${req.originalUrl}` });
  });

  // Ảnh người dùng. `Content-Disposition: attachment` để trình duyệt không bao
  // giờ hiển thị tệp như một tài liệu — tệp tải lên chỉ được dùng làm <img>.
  app.use(
    '/uploads',
    express.static(uploadDir, {
      maxAge: '7d',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    })
  );

  app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));
  app.get('*', (req, res) => {
    res.sendFile(path.join(here, '..', 'public', 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

/* ------------------------------------------------------------ chạy server */

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isMain) {
  bootstrap();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`\n  💞 Vigo Match đang chạy tại http://localhost:${config.port}`);
    console.log(`     Môi trường: ${config.env}`);
    console.log(`     Cơ sở dữ liệu: ${config.dbPath}`);
    if (config.otp.expose) {
      console.log('     ⚠  EXPOSE_OTP đang bật — mã OTP trả thẳng về API. Chỉ dùng khi phát triển.\n');
    } else {
      console.log('');
    }
  });

  // Dọn gói hết hạn mỗi giờ.
  const timer = setInterval(() => {
    const n = expireSubscriptions();
    if (n) console.log(`[billing] ${n} gói Premium đã hết hạn.`);
  }, 3600_000);
  timer.unref();

  const shutdown = () => {
    console.log('\nĐang dừng máy chủ...');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
