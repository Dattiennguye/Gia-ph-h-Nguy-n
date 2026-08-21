import { db, transaction, nowMs } from '../db.js';
import {
  BOOSTS, DAILY_BOOSTERS, CARDS, CARD_CATEGORIES, CARD_MAX_LEVEL, cardById,
  cardPrice, cardProfit, OFFLINE_CAP_HOURS, dailyReward, DAILY_REWARDS,
  REFERRAL_BONUS, REFERRAL_TAP_SHARE, leagueFor, LEAGUES, MAX_TAPS_PER_SECOND,
} from './rules.js';

export class GameError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const utcDay = (ms = nowMs()) => new Date(ms).toISOString().slice(0, 10);

// --- statements -----------------------------------------------------------
const selUser = db.prepare('SELECT * FROM users WHERE id = ?');
const selCards = db.prepare('SELECT card_id, level FROM user_cards WHERE user_id = ?');
const upsertCard = db.prepare(`
  INSERT INTO user_cards (user_id, card_id, level) VALUES (?, ?, ?)
  ON CONFLICT(user_id, card_id) DO UPDATE SET level = excluded.level
`);

const insUser = db.prepare(`
  INSERT INTO users (id, username, first_name, last_name, photo_url, is_premium,
                     energy, energy_at, claimed_at, referrer_id, boosters_day,
                     created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updProfile = db.prepare(`
  UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?,
                   is_premium = ?, updated_at = ? WHERE id = ?
`);

const updProgress = db.prepare(`
  UPDATE users SET balance = ?, total_earned = ?, energy = ?, energy_at = ?,
                   claimed_at = ?, updated_at = ? WHERE id = ?
`);

// --- derived values -------------------------------------------------------

export function maxEnergy(user) {
  return BOOSTS.energyLimit.value(user.energy_limit_level);
}

export function rechargeRate(user) {
  return BOOSTS.rechargeSpeed.value(user.recharge_level); // energy per second
}

export function tapPower(user, atMs = nowMs()) {
  const base = BOOSTS.multitap.value(user.multitap_level);
  return user.turbo_until > atMs ? base * DAILY_BOOSTERS.turbo.multiplier : base;
}

function cardLevels(userId) {
  const map = new Map();
  for (const row of selCards.all(userId)) map.set(row.card_id, row.level);
  return map;
}

function recomputeProfit(userId) {
  let total = 0;
  for (const [id, level] of cardLevels(userId)) {
    const card = cardById.get(id);
    if (card) total += cardProfit(card, level);
  }
  db.prepare('UPDATE users SET profit_per_hour = ? WHERE id = ?').run(total, userId);
  return total;
}

/**
 * Bring a user row up to date: regenerate energy and bank the passive income
 * earned since the last visit. Everything in the game reads through this, so
 * the client can never dictate how much time has passed.
 */
function refresh(user, atMs = nowMs()) {
  const cap = maxEnergy(user);

  // Energy regen (never above the cap; a full-energy booster may have pushed
  // the stored value to exactly the cap already).
  const elapsedSec = Math.max(0, (atMs - user.energy_at) / 1000);
  const energy = Math.min(cap, user.energy + elapsedSec * rechargeRate(user));

  // Passive mining, capped so a player who left for a week gets 3 hours.
  const offlineMs = Math.max(0, atMs - user.claimed_at);
  const earnMs = Math.min(offlineMs, OFFLINE_CAP_HOURS * 3600_000);
  const mined = Math.floor((user.profit_per_hour * earnMs) / 3600_000);

  user.energy = energy;
  user.energy_at = atMs;
  user.balance += mined;
  user.total_earned += mined;
  user.claimed_at = atMs;

  updProgress.run(user.balance, user.total_earned, user.energy, user.energy_at,
    user.claimed_at, atMs, user.id);

  return { user, mined, offlineMs };
}

/** Reset the per-day booster counters when the UTC date rolls over. */
function rollBoosterDay(user, atMs = nowMs()) {
  const today = utcDay(atMs);
  if (user.boosters_day === today) return user;
  db.prepare('UPDATE users SET full_energy_used = 0, turbo_used = 0, boosters_day = ? WHERE id = ?')
    .run(today, user.id);
  user.full_energy_used = 0;
  user.turbo_used = 0;
  user.boosters_day = today;
  return user;
}

function loadUser(userId) {
  const user = selUser.get(userId);
  if (!user) throw new GameError('user_not_found', 'User not found');
  return user;
}

// --- account creation -----------------------------------------------------

/**
 * Look up (or create) the player behind a verified Telegram user.
 * `startParam` carries the referral code from a t.me deep link.
 */
export const getOrCreateUser = transaction((tgUser, startParam) => {
  const at = nowMs();
  const existing = selUser.get(tgUser.id);

  if (existing) {
    updProfile.run(
      tgUser.username ?? null, tgUser.first_name ?? null, tgUser.last_name ?? null,
      tgUser.photo_url ?? null, tgUser.is_premium ? 1 : 0, at, tgUser.id,
    );
    return { user: loadUser(tgUser.id), isNew: false };
  }

  const referrerId = parseReferral(startParam, tgUser.id);
  const startEnergy = BOOSTS.energyLimit.value(1);

  insUser.run(
    tgUser.id, tgUser.username ?? null, tgUser.first_name ?? null, tgUser.last_name ?? null,
    tgUser.photo_url ?? null, tgUser.is_premium ? 1 : 0,
    startEnergy, at, at, referrerId, utcDay(at), at, at,
  );

  if (referrerId) {
    const premium = tgUser.is_premium ? 1 : 0;
    const inviterBonus = premium ? REFERRAL_BONUS.premiumInviter : REFERRAL_BONUS.inviter;
    const inviteeBonus = premium ? REFERRAL_BONUS.premiumInvitee : REFERRAL_BONUS.invitee;

    db.prepare(`UPDATE users SET balance = balance + ?, total_earned = total_earned + ?,
                referral_count = referral_count + 1, referral_earned = referral_earned + ?
                WHERE id = ?`).run(inviterBonus, inviterBonus, inviterBonus, referrerId);
    db.prepare('UPDATE users SET balance = balance + ?, total_earned = total_earned + ? WHERE id = ?')
      .run(inviteeBonus, inviteeBonus, tgUser.id);
  }

  return { user: loadUser(tgUser.id), isNew: true };
});

/** `ref_<id>` (or a bare id) from a deep link, if it points at a real, different user. */
function parseReferral(startParam, selfId) {
  if (!startParam) return null;
  const match = String(startParam).match(/^(?:ref_)?(\d{1,20})$/);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id === selfId) return null;
  return selUser.get(id) ? id : null;
}

// --- actions --------------------------------------------------------------

/**
 * Bank a batch of taps. The client reports how many taps happened; the server
 * decides how many it can actually pay for, based on energy and a human-rate
 * ceiling, then credits the inviter their share.
 */
export const applyTaps = transaction((userId, requestedTaps) => {
  const at = nowMs();
  let user = loadUser(userId);
  const prevSyncAt = user.energy_at;
  ({ user } = refresh(user, at));

  const asked = Math.max(0, Math.min(10_000, Math.floor(Number(requestedTaps) || 0)));
  if (asked === 0) return { ...buildState(user), tapsApplied: 0, earned: 0 };

  // Nobody taps faster than MAX_TAPS_PER_SECOND; allow a 2s floor so short
  // batches from a fast client are not unfairly clipped.
  const windowSec = Math.max(2, (at - prevSyncAt) / 1000);
  const rateCap = Math.floor(windowSec * MAX_TAPS_PER_SECOND);

  const power = tapPower(user, at);
  const energyCap = Math.floor(user.energy / power);
  const taps = Math.max(0, Math.min(asked, rateCap, energyCap));

  const earned = taps * power;
  user.balance += earned;
  user.total_earned += earned;
  user.energy = Math.max(0, user.energy - earned);
  user.taps += taps;

  db.prepare(`UPDATE users SET balance = ?, total_earned = ?, energy = ?, energy_at = ?,
              taps = ?, updated_at = ? WHERE id = ?`)
    .run(user.balance, user.total_earned, user.energy, at, user.taps, at, userId);

  if (user.referrer_id && earned > 0) {
    const share = Math.floor(earned * REFERRAL_TAP_SHARE);
    if (share > 0) {
      db.prepare(`UPDATE users SET balance = balance + ?, total_earned = total_earned + ?,
                  referral_earned = referral_earned + ? WHERE id = ?`)
        .run(share, share, share, user.referrer_id);
    }
  }

  return { ...buildState(user), tapsApplied: taps, earned };
});

const BOOST_COLUMN = {
  multitap: 'multitap_level',
  energyLimit: 'energy_limit_level',
  rechargeSpeed: 'recharge_level',
};

export const buyBoost = transaction((userId, boostId) => {
  const boost = BOOSTS[boostId];
  if (!boost) throw new GameError('unknown_boost', 'Unknown boost');

  const at = nowMs();
  let user = loadUser(userId);
  ({ user } = refresh(user, at));

  const column = BOOST_COLUMN[boostId];
  const level = user[column];
  if (level >= boost.maxLevel) throw new GameError('max_level', `${boost.name} is already maxed`);

  const price = boost.price(level);
  if (user.balance < price) throw new GameError('insufficient_funds', 'Not enough VIGO');

  user.balance -= price;
  user[column] = level + 1;

  db.prepare(`UPDATE users SET balance = ?, ${column} = ?, updated_at = ? WHERE id = ?`)
    .run(user.balance, user[column], at, userId);

  // A bigger battery should feel immediate, not like a debuff.
  if (boostId === 'energyLimit') {
    user.energy = Math.min(maxEnergy(user), user.energy + 500);
    db.prepare('UPDATE users SET energy = ?, energy_at = ? WHERE id = ?').run(user.energy, at, userId);
  }

  return { ...buildState(user), spent: price };
});

export const buyCard = transaction((userId, cardId) => {
  const card = cardById.get(cardId);
  if (!card) throw new GameError('unknown_card', 'Unknown card');

  const at = nowMs();
  let user = loadUser(userId);
  ({ user } = refresh(user, at));

  const levels = cardLevels(userId);
  const level = levels.get(cardId) || 0;
  if (level >= CARD_MAX_LEVEL) throw new GameError('max_level', `${card.name} is already maxed`);
  if (!isCardUnlocked(card, user, levels)) throw new GameError('locked', `${card.name} is locked`);

  const price = cardPrice(card, level);
  if (user.balance < price) throw new GameError('insufficient_funds', 'Not enough VIGO');

  user.balance -= price;
  upsertCard.run(userId, cardId, level + 1);
  db.prepare('UPDATE users SET balance = ?, updated_at = ? WHERE id = ?').run(user.balance, at, userId);
  user.profit_per_hour = recomputeProfit(userId);

  return { ...buildState(user), spent: price, cardId, level: level + 1 };
});

export const useBooster = transaction((userId, boosterId) => {
  const booster = DAILY_BOOSTERS[boosterId];
  if (!booster) throw new GameError('unknown_booster', 'Unknown booster');

  const at = nowMs();
  let user = loadUser(userId);
  ({ user } = refresh(user, at));
  user = rollBoosterDay(user, at);

  if (boosterId === 'fullEnergy') {
    if (user.full_energy_used >= booster.perDay) throw new GameError('no_charges', 'No Full Energy left today');
    user.energy = maxEnergy(user);
    user.full_energy_used += 1;
    db.prepare('UPDATE users SET energy = ?, energy_at = ?, full_energy_used = ?, updated_at = ? WHERE id = ?')
      .run(user.energy, at, user.full_energy_used, at, userId);
  } else {
    if (user.turbo_used >= booster.perDay) throw new GameError('no_charges', 'No Turbo left today');
    if (user.turbo_until > at) throw new GameError('already_active', 'Turbo is already running');
    user.turbo_until = at + booster.durationSec * 1000;
    user.turbo_used += 1;
    db.prepare('UPDATE users SET turbo_until = ?, turbo_used = ?, updated_at = ? WHERE id = ?')
      .run(user.turbo_until, user.turbo_used, at, userId);
  }

  return buildState(user);
});

export const claimDaily = transaction((userId) => {
  const at = nowMs();
  let user = loadUser(userId);
  ({ user } = refresh(user, at));

  const today = utcDay(at);
  if (user.daily_claimed_day === today) throw new GameError('already_claimed', 'Come back tomorrow');

  const yesterday = utcDay(at - 86_400_000);
  const streak = user.daily_claimed_day === yesterday ? user.daily_streak + 1 : 1;
  const reward = dailyReward(streak);

  user.balance += reward;
  user.total_earned += reward;
  user.daily_streak = streak;
  user.daily_claimed_day = today;

  db.prepare(`UPDATE users SET balance = ?, total_earned = ?, daily_streak = ?,
              daily_claimed_day = ?, updated_at = ? WHERE id = ?`)
    .run(user.balance, user.total_earned, streak, today, at, userId);

  return { ...buildState(user), reward, streak };
});

// --- reads ----------------------------------------------------------------

function isCardUnlocked(card, user, levels) {
  const req = card.requires;
  if (!req) return true;
  if (req.card && (levels.get(req.card) || 0) < (req.level || 1)) return false;
  if (req.referrals && user.referral_count < req.referrals) return false;
  if (req.streak && user.daily_streak < req.streak) return false;
  return true;
}

function requirementLabel(card, levels) {
  const req = card.requires;
  if (!req) return null;
  if (req.card) {
    const dep = cardById.get(req.card);
    return `${dep ? dep.name : req.card} lvl ${req.level || 1}`;
  }
  if (req.referrals) return `${req.referrals} friends`;
  if (req.streak) return `${req.streak}-day streak`;
  return null;
}

export function buildCards(user) {
  const levels = cardLevels(user.id);
  return CARDS.map((card) => {
    const level = levels.get(card.id) || 0;
    const unlocked = isCardUnlocked(card, user, levels);
    return {
      id: card.id,
      name: card.name,
      category: card.category,
      level,
      maxLevel: CARD_MAX_LEVEL,
      profitPerHour: cardProfit(card, level),
      profitDelta: cardProfit(card, level + 1) - cardProfit(card, level),
      price: level >= CARD_MAX_LEVEL ? null : cardPrice(card, level),
      unlocked,
      requirement: unlocked ? null : requirementLabel(card, levels),
    };
  });
}

export function buildBoosts(user) {
  return Object.values(BOOSTS).map((boost) => {
    const level = user[BOOST_COLUMN[boost.id]];
    const maxed = level >= boost.maxLevel;
    return {
      id: boost.id,
      name: boost.name,
      description: boost.description,
      icon: boost.icon,
      level,
      maxLevel: boost.maxLevel,
      price: maxed ? null : boost.price(level),
      value: boost.value(level),
      nextValue: maxed ? null : boost.value(level + 1),
    };
  });
}

/** The single payload shape every mutating endpoint returns. */
export function buildState(user, extra = {}) {
  const at = nowMs();
  const cap = maxEnergy(user);
  const league = leagueFor(user.total_earned);
  const leagueIndex = LEAGUES.findIndex((l) => l.id === league.id);
  const nextLeague = LEAGUES[leagueIndex + 1] || null;
  const boostersDayFresh = user.boosters_day === utcDay(at);

  return {
    user: {
      id: String(user.id),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      photoUrl: user.photo_url,
      isPremium: !!user.is_premium,
    },
    balance: user.balance,
    totalEarned: user.total_earned,
    taps: user.taps,
    energy: Math.floor(user.energy),
    maxEnergy: cap,
    rechargeRate: rechargeRate(user),
    tapPower: tapPower(user, at),
    baseTapPower: BOOSTS.multitap.value(user.multitap_level),
    profitPerHour: user.profit_per_hour,
    offlineCapHours: OFFLINE_CAP_HOURS,
    turboUntil: user.turbo_until > at ? user.turbo_until : 0,
    turboMultiplier: DAILY_BOOSTERS.turbo.multiplier,
    boosters: {
      fullEnergy: {
        left: boosterCharges(boostersDayFresh, user.full_energy_used, DAILY_BOOSTERS.fullEnergy.perDay),
        perDay: DAILY_BOOSTERS.fullEnergy.perDay,
      },
      turbo: {
        left: boosterCharges(boostersDayFresh, user.turbo_used, DAILY_BOOSTERS.turbo.perDay),
        perDay: DAILY_BOOSTERS.turbo.perDay,
        durationSec: DAILY_BOOSTERS.turbo.durationSec,
      },
    },
    daily: (() => {
      const today = utcDay(at);
      const claimedToday = user.daily_claimed_day === today;
      // The streak the *next* claim will land on: continuing today's streak if
      // it is still alive, otherwise starting over at day 1.
      const continues = claimedToday || user.daily_claimed_day === utcDay(at - 86_400_000);
      const nextDay = continues ? user.daily_streak + 1 : 1;
      return {
        streak: user.daily_streak,
        claimedToday,
        nextDay,
        nextReward: dailyReward(nextDay),
        rewards: DAILY_REWARDS,
      };
    })(),
    league: { ...league, index: leagueIndex, next: nextLeague },
    referrals: { count: user.referral_count, earned: user.referral_earned, share: REFERRAL_TAP_SHARE },
    serverTime: at,
    ...extra,
  };
}

function boosterCharges(dayFresh, used, perDay) {
  return dayFresh ? Math.max(0, perDay - used) : perDay;
}

/** Full payload for the initial load: state plus the catalogues. */
export function buildFullState(user) {
  return {
    ...buildState(user),
    boostList: buildBoosts(user),
    cards: buildCards(user),
    categories: CARD_CATEGORIES,
    leagues: LEAGUES,
  };
}

/**
 * Bring a user up to date and report what their rigs mined while away.
 * Returns `{ user, mined }` — callers that only need the row use `.user`.
 */
export function refreshUser(userId) {
  const at = nowMs();
  return transaction(() => {
    let user = loadUser(userId);
    let mined;
    ({ user, mined } = refresh(user, at));
    return { user: rollBoosterDay(user, at), mined };
  })();
}

export function getLeaderboard(limit = 100, aroundUserId = null) {
  const rows = db.prepare(`
    SELECT id, username, first_name, last_name, photo_url, total_earned, profit_per_hour
    FROM users ORDER BY total_earned DESC, id ASC LIMIT ?
  `).all(limit);

  const top = rows.map((r, i) => ({
    rank: i + 1,
    id: String(r.id),
    name: displayName(r),
    photoUrl: r.photo_url,
    totalEarned: r.total_earned,
    profitPerHour: r.profit_per_hour,
    league: leagueFor(r.total_earned).id,
  }));

  let me = null;
  if (aroundUserId != null) {
    const found = top.find((e) => e.id === String(aroundUserId));
    if (found) {
      me = found;
    } else {
      const row = selUser.get(aroundUserId);
      if (row) {
        const ahead = db.prepare(
          'SELECT COUNT(*) AS c FROM users WHERE total_earned > ? OR (total_earned = ? AND id < ?)',
        ).get(row.total_earned, row.total_earned, row.id);
        me = {
          rank: ahead.c + 1,
          id: String(row.id),
          name: displayName(row),
          photoUrl: row.photo_url,
          totalEarned: row.total_earned,
          profitPerHour: row.profit_per_hour,
          league: leagueFor(row.total_earned).id,
        };
      }
    }
  }

  const { c: totalPlayers } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return { top, me, totalPlayers };
}

export function getReferrals(userId) {
  const user = loadUser(userId);
  const rows = db.prepare(`
    SELECT id, username, first_name, last_name, photo_url, total_earned, is_premium
    FROM users WHERE referrer_id = ? ORDER BY total_earned DESC LIMIT 100
  `).all(userId);

  return {
    count: user.referral_count,
    earned: user.referral_earned,
    share: REFERRAL_TAP_SHARE,
    bonus: REFERRAL_BONUS,
    friends: rows.map((r) => ({
      id: String(r.id),
      name: displayName(r),
      photoUrl: r.photo_url,
      totalEarned: r.total_earned,
      isPremium: !!r.is_premium,
      league: leagueFor(r.total_earned).id,
    })),
  };
}

function displayName(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return name || (row.username ? `@${row.username}` : `Miner ${String(row.id).slice(-4)}`);
}
