import { Router } from 'express';
import { config } from '../config.js';
import { verifyInitData, issueToken, requireAuth } from '../auth.js';
import {
  GameError, getOrCreateUser, refreshUser, buildFullState, buildBoosts,
  buildCards, applyTaps, buyBoost, buyCard, useBooster, claimDaily,
  getLeaderboard, getReferrals,
} from '../game/engine.js';

export const api = Router();

/** Turn a GameError into a 400 with a machine-readable code; anything else 500s. */
function handle(res, fn) {
  try {
    res.json(fn());
  } catch (err) {
    if (err instanceof GameError) {
      res.status(400).json({ error: err.code, message: err.message });
    } else {
      console.error('[api]', err);
      res.status(500).json({ error: 'internal_error' });
    }
  }
}

/**
 * Exchange Telegram initData for a session token plus the full game state.
 * This is the only endpoint that looks at initData.
 */
api.post('/auth', (req, res) => {
  const { initData, startParam } = req.body || {};

  let tgUser;
  let deepLinkParam = startParam || null;

  if (config.allowDevAuth && !initData) {
    // Local browser testing: ?dev=<id> style login, never available in prod.
    const devId = Number(req.body?.devUserId || 999_000_001);
    tgUser = { id: devId, first_name: `Dev ${devId % 1000}`, username: `dev${devId % 1000}` };
  } else {
    try {
      const parsed = verifyInitData(initData);
      tgUser = parsed.user;
      deepLinkParam = deepLinkParam || parsed.startParam;
    } catch (err) {
      return res.status(401).json({ error: 'bad_init_data', message: err.message });
    }
  }

  handle(res, () => {
    const { user, isNew } = getOrCreateUser(tgUser, deepLinkParam);
    const { user: fresh, mined } = refreshUser(user.id);
    return { token: issueToken(user.id), isNew, mined, ...buildFullState(fresh) };
  });
});

// Liveness probe — deliberately above the auth middleware.
api.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// ---- everything below this line requires a session token ----
api.use(requireAuth);

api.get('/state', (req, res) => handle(res, () => {
  const { user, mined } = refreshUser(req.userId);
  return { mined, ...buildFullState(user) };
}));

api.post('/tap', (req, res) => handle(res, () => {
  const result = applyTaps(req.userId, req.body?.taps);
  return { ...result, boostList: buildBoosts(refreshUser(req.userId).user) };
}));

api.post('/boost/:id', (req, res) => handle(res, () => {
  const state = buyBoost(req.userId, req.params.id);
  return { ...state, boostList: buildBoosts(refreshUser(req.userId).user) };
}));

api.post('/card/:id', (req, res) => handle(res, () => {
  const state = buyCard(req.userId, req.params.id);
  const { user } = refreshUser(req.userId);
  return { ...state, profitPerHour: user.profit_per_hour, cards: buildCards(user) };
}));

api.post('/booster/:id', (req, res) => handle(res, () => useBooster(req.userId, req.params.id)));

api.post('/daily', (req, res) => handle(res, () => claimDaily(req.userId)));

api.get('/leaderboard', (req, res) => handle(res, () => getLeaderboard(100, req.userId)));

api.get('/referrals', (req, res) => handle(res, () => {
  const data = getReferrals(req.userId);
  const botName = process.env.BOT_USERNAME;
  return {
    ...data,
    link: botName ? `https://t.me/${botName}/${process.env.WEB_APP_SHORT_NAME || 'app'}?startapp=ref_${req.userId}`
                  : null,
    shareText: 'Mine VIGO with me — you get a starting bonus and I get a cut of nothing you lose. ⛏️',
  };
}));
