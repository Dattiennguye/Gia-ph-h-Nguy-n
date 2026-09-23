import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d = false) => {
  if (v === undefined || v === '') return d;
  return v === '1' || String(v).toLowerCase() === 'true';
};

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function requiredSecret(name, fallbackDev) {
  const v = process.env[name];
  if (v && v.length >= 16) return v;
  if (isProd) {
    throw new Error(
      `${name} chưa được đặt (hoặc quá ngắn). Sinh khoá: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return fallbackDev;
}

// Ở chế độ dev, khoá được sinh ổn định theo thư mục dự án để restart không
// làm mất session — nhưng vẫn khác nhau giữa các máy.
const devSeed = crypto.createHash('sha256').update(`vigo-match::${process.cwd()}`).digest('hex');

export const config = {
  env,
  isProd,
  port: num(process.env.PORT, 3000),
  dbPath: path.resolve(process.env.DB_PATH || './data/vigo-match.db'),
  // Nơi lưu ảnh người dùng tải lên. Khi chạy nhiều máy chủ, trỏ vào ổ đĩa dùng
  // chung hoặc thay bằng lưu trữ đối tượng trong src/lib/images.js.
  uploadDir: process.env.UPLOAD_DIR || './uploads',

  sessionSecret: requiredSecret('SESSION_SECRET', devSeed),
  sessionTtlMs: num(process.env.SESSION_TTL_DAYS, 30) * 86400000,
  piiKey: Buffer.from(
    requiredSecret('PII_ENCRYPTION_KEY', devSeed).slice(0, 64).padEnd(64, '0'),
    'hex'
  ),

  sms: {
    // console | twilio | esms | http
    provider: process.env.SMS_PROVIDER || 'console',
    senderName: process.env.SMS_SENDER_NAME || 'Vigo Match',

    webhookUrl: process.env.SMS_WEBHOOK_URL || '',
    webhookToken: process.env.SMS_WEBHOOK_TOKEN || '',

    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      from: process.env.TWILIO_FROM || '',
      baseUrl: process.env.TWILIO_BASE_URL || 'https://api.twilio.com',
    },

    esms: {
      apiKey: process.env.ESMS_API_KEY || '',
      secretKey: process.env.ESMS_SECRET_KEY || '',
      brandname: process.env.ESMS_BRANDNAME || '',
      // 2 = tin CSKH qua brandname, 8 = tin cố định. Xem tài liệu eSMS.
      smsType: process.env.ESMS_SMS_TYPE || '2',
      baseUrl: process.env.ESMS_BASE_URL || 'https://rest.esms.vn',
    },
  },
  otp: {
    ttlMs: num(process.env.OTP_TTL_SECONDS, 300) * 1000,
    maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
    // Ở môi trường thật thì KHÔNG BAO GIỜ trả mã OTP qua API, kể cả khi biến
    // môi trường được đặt — tránh trường hợp ai đó sao chép nguyên .env.example
    // lên máy chủ thật rồi vô tình biến mọi số điện thoại thành cửa sau.
    expose: isProd ? false : bool(process.env.EXPOSE_OTP, true),
  },

  // Hệ số nhân cho mọi giới hạn tần suất. Để 1 khi chạy thật; bộ kiểm thử
  // nâng lên để tạo được nhiều tài khoản từ cùng một địa chỉ.
  rateLimitFactor: Math.max(1, num(process.env.RATE_LIMIT_FACTOR, 1)),

  matching: {
    maxRadiusFreeKm: num(process.env.MAX_RADIUS_FREE_KM, 50),
    maxRadiusPremiumKm: num(process.env.MAX_RADIUS_PREMIUM_KM, 200),
    dailyPicks: num(process.env.DAILY_PICKS_COUNT, 8),
    freeDailyLikes: num(process.env.FREE_DAILY_LIKES, 40),
  },

  oauth: {
    // Nhiều client id cách nhau bởi dấu phẩy: web, iOS và Android thường mỗi
    // nền tảng một id, và token của cả ba đều phải được chấp nhận.
    googleClientIds: (process.env.GOOGLE_CLIENT_ID || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
    appleClientIds: (process.env.APPLE_CLIENT_ID || '')
      .split(',').map((s) => s.trim()).filter(Boolean),
  },

  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    get enabled() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },
  },

  payment: {
    // mock | manual | vnpay | momo
    provider: process.env.PAYMENT_PROVIDER || 'mock',
    bankAccount: process.env.PAYMENT_BANK_ACCOUNT || '',
    // Địa chỉ công khai của máy chủ, để dựng returnUrl và ipnUrl.
    publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),

    vnpay: {
      tmnCode: process.env.VNPAY_TMN_CODE || '',
      hashSecret: process.env.VNPAY_HASH_SECRET || '',
      payUrl: process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
      // Bản 2.1.0 mã hoá giá trị trong chuỗi ký; một số bản demo cũ thì không.
      // Nếu VNPay báo sai chữ ký, thử đổi cờ này.
      encodeHash: (process.env.VNPAY_HASH_ENCODE ?? '1') !== '0',
    },

    momo: {
      partnerCode: process.env.MOMO_PARTNER_CODE || '',
      accessKey: process.env.MOMO_ACCESS_KEY || '',
      secretKey: process.env.MOMO_SECRET_KEY || '',
      endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn',
      requestType: process.env.MOMO_REQUEST_TYPE || 'captureWallet',
    },
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@vigomatch.vn',
    password: process.env.ADMIN_PASSWORD || '',
  },
};
