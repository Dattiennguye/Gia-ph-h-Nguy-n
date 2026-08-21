// End-to-end tests: they boot the real Express app against a throwaway
// SQLite file and drive it over HTTP, so routing, auth and game rules are
// all covered by the same pass.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';

const BOT_TOKEN = '111111:TEST-BOT-TOKEN';
const DB_FILE = `./data/test-${process.pid}.db`;

process.env.BOT_TOKEN = BOT_TOKEN;
process.env.SESSION_SECRET = 'test-secret';
process.env.DB_PATH = DB_FILE;
process.env.PORT = '0';

let base;
let server;

/** Forge a valid initData string the way Telegram would sign it. */
function initDataFor(user, startParam) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAtest',
    user: JSON.stringify(user),
  });
  if (startParam) params.set('start_param', startParam);

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function login(user, startParam) {
  const res = await call('/api/auth', { method: 'POST', body: { initData: initDataFor(user, startParam) } });
  assert.equal(res.status, 200, `login failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

before(async () => {
  const express = (await import('express')).default;
  const { api } = await import('../src/routes/api.js');
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB_FILE + suffix); } catch { /* never created */ }
  }
});

// ---------------------------------------------------------------- auth

test('rejects a request with no token', async () => {
  const res = await call('/api/state');
  assert.equal(res.status, 401);
});

test('rejects forged initData', async () => {
  const forged = initDataFor({ id: 1, first_name: 'X' }).replace(/hash=[0-9a-f]+/, 'hash=' + 'a'.repeat(64));
  const res = await call('/api/auth', { method: 'POST', body: { initData: forged } });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'bad_init_data');
});

test('creates a player on first login and returns full state', async () => {
  const state = await login({ id: 1001, first_name: 'Alice', username: 'alice' });
  assert.ok(state.token);
  assert.equal(state.isNew, true);
  assert.equal(state.balance, 0);
  assert.equal(state.energy, 1000);
  assert.equal(state.tapPower, 1);
  assert.equal(state.user.firstName, 'Alice');
  assert.ok(state.cards.length > 0);
  assert.ok(state.boostList.length === 3);

  const again = await login({ id: 1001, first_name: 'Alice', username: 'alice' });
  assert.equal(again.isNew, false, 'second login must not recreate the player');
});

// ---------------------------------------------------------------- tapping

test('taps credit balance and drain energy', async () => {
  const { token } = await login({ id: 1002, first_name: 'Bob' });
  const res = await call('/api/tap', { method: 'POST', body: { taps: 10 }, token });

  assert.equal(res.status, 200);
  assert.equal(res.body.tapsApplied, 10);
  assert.equal(res.body.earned, 10);
  assert.equal(res.body.balance, 10);
  assert.equal(res.body.energy, 990);
});

test('taps beyond available energy are clamped, not rejected', async () => {
  const { token } = await login({ id: 1003, first_name: 'Carol' });
  // Ask for far more taps than the 1000 starting energy allows.
  const res = await call('/api/tap', { method: 'POST', body: { taps: 9999 }, token });

  assert.equal(res.status, 200);
  assert.ok(res.body.balance <= 1000, `balance ${res.body.balance} exceeded the energy budget`);
  assert.ok(res.body.energy >= 0);
});

test('a negative or junk tap count earns nothing', async () => {
  const { token } = await login({ id: 1004, first_name: 'Dan' });
  for (const taps of [-50, 'lots', null, NaN]) {
    const res = await call('/api/tap', { method: 'POST', body: { taps }, token });
    assert.equal(res.status, 200);
    assert.equal(res.body.balance, 0, `taps=${taps} should not pay out`);
  }
});

test('the tap rate ceiling caps a burst from a single batch', async () => {
  const { token } = await login({ id: 1005, first_name: 'Eve' });
  // Fresh session: the rate window floor is 2s → at most 40 taps.
  const res = await call('/api/tap', { method: 'POST', body: { taps: 500 }, token });
  assert.ok(res.body.tapsApplied <= 40, `rate cap let ${res.body.tapsApplied} taps through`);
});

// ---------------------------------------------------------------- upgrades

test('a boost cannot be bought without the balance for it', async () => {
  const { token } = await login({ id: 1006, first_name: 'Frank' });
  const res = await call('/api/boost/multitap', { method: 'POST', token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'insufficient_funds');
});

test('buying multitap raises tap power and charges the price', async () => {
  const { token } = await login({ id: 1007, first_name: 'Grace' });
  await grant(token, 5000);

  const before = await call('/api/state', { token });
  const price = before.body.boostList.find((b) => b.id === 'multitap').price;

  const res = await call('/api/boost/multitap', { method: 'POST', token });
  assert.equal(res.status, 200);
  assert.equal(res.body.baseTapPower, 2);
  assert.equal(res.body.balance, before.body.balance - price);
});

test('an unknown boost or card id is rejected', async () => {
  const { token } = await login({ id: 1008, first_name: 'Heidi' });
  assert.equal((await call('/api/boost/wat', { method: 'POST', token })).body.error, 'unknown_boost');
  assert.equal((await call('/api/card/wat', { method: 'POST', token })).body.error, 'unknown_card');
});

test('buying a card raises profit per hour', async () => {
  const { token } = await login({ id: 1009, first_name: 'Ivan' });
  await grant(token, 5000);

  const res = await call('/api/card/usb_stick', { method: 'POST', token });
  assert.equal(res.status, 200);
  assert.equal(res.body.profitPerHour, 20);

  const card = res.body.cards.find((c) => c.id === 'usb_stick');
  assert.equal(card.level, 1);
});

test('a locked card cannot be bought even with the money', async () => {
  const { token } = await login({ id: 1010, first_name: 'Judy' });
  await grant(token, 10_000_000);

  const res = await call('/api/card/quantum', { method: 'POST', token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'locked');
});

// ---------------------------------------------------------------- boosters

test('full energy refills the bar and burns a daily charge', async () => {
  const { token } = await login({ id: 1011, first_name: 'Ken' });
  await call('/api/tap', { method: 'POST', body: { taps: 30 }, token });

  const res = await call('/api/booster/fullEnergy', { method: 'POST', token });
  assert.equal(res.status, 200);
  assert.equal(res.body.energy, res.body.maxEnergy);
  assert.equal(res.body.boosters.fullEnergy.left, res.body.boosters.fullEnergy.perDay - 1);
});

test('full energy runs out after the daily allowance', async () => {
  const { token } = await login({ id: 1012, first_name: 'Leo' });
  const { body: state } = await call('/api/state', { token });

  for (let i = 0; i < state.boosters.fullEnergy.perDay; i++) {
    assert.equal((await call('/api/booster/fullEnergy', { method: 'POST', token })).status, 200);
  }
  const res = await call('/api/booster/fullEnergy', { method: 'POST', token });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'no_charges');
});

test('turbo multiplies tap power while it is running', async () => {
  const { token } = await login({ id: 1013, first_name: 'Mia' });
  const res = await call('/api/booster/turbo', { method: 'POST', token });

  assert.equal(res.status, 200);
  assert.ok(res.body.turboUntil > Date.now());
  assert.equal(res.body.tapPower, res.body.baseTapPower * res.body.turboMultiplier);

  const tap = await call('/api/tap', { method: 'POST', body: { taps: 3 }, token });
  assert.equal(tap.body.earned, 3 * res.body.turboMultiplier);

  const second = await call('/api/booster/turbo', { method: 'POST', token });
  assert.equal(second.body.error, 'already_active');
});

// ---------------------------------------------------------------- daily

test('the daily reward pays once per day', async () => {
  const { token } = await login({ id: 1014, first_name: 'Nina' });

  const first = await call('/api/daily', { method: 'POST', token });
  assert.equal(first.status, 200);
  assert.equal(first.body.streak, 1);
  assert.equal(first.body.reward, 500);
  assert.equal(first.body.balance, 500);
  assert.equal(first.body.daily.claimedToday, true);

  const second = await call('/api/daily', { method: 'POST', token });
  assert.equal(second.status, 400);
  assert.equal(second.body.error, 'already_claimed');
});

// ---------------------------------------------------------------- referrals

test('a referral pays both sides and shows up in the friend list', async () => {
  const inviter = await login({ id: 1015, first_name: 'Olga' });
  const invitee = await login({ id: 1016, first_name: 'Pete' }, `ref_${1015}`);

  assert.equal(invitee.balance, 2500, 'invitee should get the joining bonus');

  const inviterState = await call('/api/state', { token: inviter.token });
  assert.equal(inviterState.body.balance, 5000);
  assert.equal(inviterState.body.referrals.count, 1);

  const friends = await call('/api/referrals', { token: inviter.token });
  assert.equal(friends.body.friends.length, 1);
  assert.equal(friends.body.friends[0].id, '1016');
});

test('a referral cut flows to the inviter when the friend taps', async () => {
  const inviter = await login({ id: 1017, first_name: 'Quinn' });
  const invitee = await login({ id: 1018, first_name: 'Rosa' }, 'ref_1017');

  const before = (await call('/api/state', { token: inviter.token })).body.balance;
  await call('/api/tap', { method: 'POST', body: { taps: 20 }, token: invitee.token });
  const after = (await call('/api/state', { token: inviter.token })).body.balance;

  assert.ok(after > before, 'inviter balance should grow from the friend\'s taps');
});

test('self-referral is ignored', async () => {
  const state = await login({ id: 1019, first_name: 'Sam' }, 'ref_1019');
  assert.equal(state.balance, 0, 'inviting yourself must not pay a bonus');
});

// ---------------------------------------------------------------- leaderboard

test('the leaderboard ranks by lifetime earnings and finds the player', async () => {
  const rich = await login({ id: 1020, first_name: 'Tina' });
  await grant(rich.token, 100_000);

  const res = await call('/api/leaderboard', { token: rich.token });
  assert.equal(res.status, 200);
  assert.ok(res.body.top.length > 0);
  assert.ok(res.body.totalPlayers > 0);

  const earnings = res.body.top.map((e) => e.totalEarned);
  assert.deepEqual(earnings, [...earnings].sort((a, b) => b - a), 'leaderboard must be sorted');
  assert.ok(res.body.me, 'the caller should always find their own rank');
});

/** Tap the balance up to roughly `amount`, refilling energy as needed. */
async function grant(token, amount) {
  let balance = 0;
  let guard = 0;
  while (balance < amount && guard++ < 60) {
    const res = await call('/api/tap', { method: 'POST', body: { taps: 2000 }, token });
    balance = res.body.balance;
    if (res.body.energy < 10) {
      const refill = await call('/api/booster/fullEnergy', { method: 'POST', token });
      if (refill.status !== 200) break; // out of charges — take what we have
    }
  }
  return balance;
}
