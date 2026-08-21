import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { api } from './routes/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// The mini app is served from the same origin as the API, so no CORS dance.
app.use('/api', api);

app.use(express.static(join(__dirname, '..', 'public'), {
  maxAge: '1h',
  setHeaders(res, path) {
    // index.html must never be cached or players get a stale client after a deploy.
    if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.get('*', (req, res) => res.sendFile(join(__dirname, '..', 'public', 'index.html')));

const server = app.listen(config.port, () => {
  console.log(`⛏️  VIGO Miner listening on http://localhost:${config.port}`);
  if (!config.botToken) console.warn('⚠️  BOT_TOKEN is not set — Telegram auth will reject every login.');
  if (config.allowDevAuth) console.warn('⚠️  ALLOW_DEV_AUTH=1 — unauthenticated dev login is enabled.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
