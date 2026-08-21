import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY,            -- telegram user id
  username          TEXT,
  first_name        TEXT,
  last_name         TEXT,
  photo_url         TEXT,
  is_premium        INTEGER NOT NULL DEFAULT 0,
  balance           INTEGER NOT NULL DEFAULT 0,     -- spendable VIGO
  total_earned      INTEGER NOT NULL DEFAULT 0,     -- lifetime, drives league
  energy            REAL    NOT NULL DEFAULT 1000,
  energy_at         INTEGER NOT NULL,               -- ms epoch of last energy calc
  taps              INTEGER NOT NULL DEFAULT 0,
  multitap_level    INTEGER NOT NULL DEFAULT 1,
  energy_limit_level INTEGER NOT NULL DEFAULT 1,
  recharge_level    INTEGER NOT NULL DEFAULT 1,
  profit_per_hour   INTEGER NOT NULL DEFAULT 0,     -- cached sum of card profits
  claimed_at        INTEGER NOT NULL,               -- ms epoch of last passive claim
  full_energy_used  INTEGER NOT NULL DEFAULT 0,
  turbo_used        INTEGER NOT NULL DEFAULT 0,
  boosters_day      TEXT,                           -- UTC date the counters belong to
  turbo_until       INTEGER NOT NULL DEFAULT 0,
  daily_streak      INTEGER NOT NULL DEFAULT 0,
  daily_claimed_day TEXT,
  referrer_id       INTEGER,
  referral_count    INTEGER NOT NULL DEFAULT 0,
  referral_earned   INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_cards (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id  TEXT    NOT NULL,
  level    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS idx_users_total_earned ON users(total_earned DESC);
CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer_id);
`);

export function nowMs() {
  return Date.now();
}

// Wrap a function in a transaction. node:sqlite has no helper for this, and
// several game actions touch users + user_cards together.
export function transaction(fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
  };
}
