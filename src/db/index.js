import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');

export function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
}

/* ------------------------------------------------------------- tiện ích SQL */

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function insert(sql, params = []) {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

let txDepth = 0;

/**
 * Bọc một hàm trong transaction, rollback nếu ném lỗi.
 *
 * Hỗ trợ lồng nhau: các service gọi lẫn nhau (ví dụ createReport gọi openCase)
 * nên transaction bên trong dùng SAVEPOINT thay vì BEGIN. Lỗi ở tầng trong chỉ
 * quay lui phần việc của nó, còn lỗi ở tầng ngoài quay lui toàn bộ.
 */
export function transaction(fn) {
  return (...args) => {
    const depth = txDepth;
    if (depth === 0) db.exec('BEGIN');
    else db.exec(`SAVEPOINT vigo_tx_${depth}`);
    txDepth = depth + 1;

    try {
      const out = fn(...args);
      if (depth === 0) db.exec('COMMIT');
      else db.exec(`RELEASE vigo_tx_${depth}`);
      return out;
    } catch (err) {
      try {
        if (depth === 0) {
          db.exec('ROLLBACK');
        } else {
          db.exec(`ROLLBACK TO vigo_tx_${depth}`);
          db.exec(`RELEASE vigo_tx_${depth}`);
        }
      } catch {
        /* giao dịch đã bị huỷ sẵn */
      }
      throw err;
    } finally {
      txDepth = depth;
    }
  };
}

export const now = () => Date.now();

/** Đọc cột JSON an toàn. */
export function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
