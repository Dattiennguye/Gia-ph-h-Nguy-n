import { Bot, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { db } from './db.js';
import { leagueFor } from './game/rules.js';

if (!config.botToken) {
  console.error('BOT_TOKEN is required to run the bot. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!config.webAppUrl) {
  console.error('WEB_APP_URL is required (the public https URL serving public/index.html).');
  process.exit(1);
}

const bot = new Bot(config.botToken);

const playButton = (startParam) => {
  const url = startParam
    ? `${config.webAppUrl}${config.webAppUrl.includes('?') ? '&' : '?'}startapp=${encodeURIComponent(startParam)}`
    : config.webAppUrl;
  return new InlineKeyboard().webApp('⛏️  Start mining', url);
};

bot.command('start', async (ctx) => {
  // `/start ref_12345` — the payload rides along to the mini app so the
  // referral is credited the first time the player opens it.
  const payload = (ctx.match || '').trim();
  const name = ctx.from?.first_name ? `, ${ctx.from.first_name}` : '';

  await ctx.reply(
    `⛏️ *VIGO Miner*\n\nWelcome${name}! Tap the coin to mine VIGO, spend it on rigs that keep mining while you sleep, and climb the leagues.\n\n` +
    '• Tap to earn — energy refills on its own\n' +
    '• Buy rigs for profit every hour, even offline\n' +
    '• Invite friends for a bonus and a cut of their taps',
    { parse_mode: 'Markdown', reply_markup: playButton(payload) },
  );
});

bot.command('stats', async (ctx) => {
  const row = db.prepare('SELECT balance, total_earned, profit_per_hour, taps, referral_count FROM users WHERE id = ?')
    .get(ctx.from.id);

  if (!row) {
    return ctx.reply('You have not mined anything yet. Open the app to start!', { reply_markup: playButton() });
  }

  const fmt = (n) => n.toLocaleString('en-US');
  await ctx.reply(
    `📊 *Your mine*\n\n` +
    `Balance: *${fmt(row.balance)}* VIGO\n` +
    `Lifetime: *${fmt(row.total_earned)}* VIGO\n` +
    `Per hour: *${fmt(row.profit_per_hour)}* VIGO\n` +
    `Taps: *${fmt(row.taps)}*\n` +
    `Friends: *${fmt(row.referral_count)}*\n` +
    `League: *${leagueFor(row.total_earned).name}*`,
    { parse_mode: 'Markdown', reply_markup: playButton() },
  );
});

bot.command('invite', async (ctx) => {
  const me = await bot.api.getMe();
  const link = `https://t.me/${me.username}?start=ref_${ctx.from.id}`;
  await ctx.reply(
    `🤝 *Your invite link*\n\n\`${link}\`\n\nBoth of you get a starting bonus, and you keep earning a share of every tap your friends make.`,
    { parse_mode: 'Markdown' },
  );
});

bot.command('top', async (ctx) => {
  const rows = db.prepare(
    'SELECT first_name, username, total_earned FROM users ORDER BY total_earned DESC LIMIT 10',
  ).all();

  if (!rows.length) return ctx.reply('No miners yet — be the first!', { reply_markup: playButton() });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((r, i) => {
    const name = r.first_name || (r.username ? `@${r.username}` : 'Miner');
    return `${medals[i] || `${i + 1}.`} ${name} — ${r.total_earned.toLocaleString('en-US')}`;
  });

  await ctx.reply(`🏆 *Top miners*\n\n${lines.join('\n')}`, { parse_mode: 'Markdown', reply_markup: playButton() });
});

bot.catch((err) => console.error('[bot]', err));

await bot.api.setMyCommands([
  { command: 'start', description: 'Open VIGO Miner' },
  { command: 'stats', description: 'Your mining stats' },
  { command: 'invite', description: 'Get your referral link' },
  { command: 'top', description: 'Leaderboard' },
]);

console.log('🤖 VIGO Miner bot is running');
bot.start();
