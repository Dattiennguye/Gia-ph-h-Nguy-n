import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 3000),
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: process.env.WEB_APP_URL || '',
  dbPath: process.env.DB_PATH || './data/vigo.db',
  // Session tokens are signed with this. Falls back to the bot token so a
  // single-secret deployment still works, but a dedicated secret is better.
  sessionSecret: process.env.SESSION_SECRET || process.env.BOT_TOKEN || 'vigo-dev-secret',
  sessionTtlMs: 12 * 60 * 60 * 1000,
  // Accept Telegram initData signed at most this long ago.
  initDataMaxAgeSec: Number(process.env.INIT_DATA_MAX_AGE || 24 * 60 * 60),
  // Lets you run the mini app in a plain browser while developing.
  allowDevAuth: process.env.ALLOW_DEV_AUTH === '1',
};

export const isProd = process.env.NODE_ENV === 'production';
