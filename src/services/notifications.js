import { all, get, insert, run, now, parseJson } from '../db/index.js';
import { emit } from '../lib/events.js';

/** Tạo thông báo và đẩy ngay qua kênh realtime nếu người dùng đang mở app. */
export function notify(userId, { kind, title, body = '', data = {} }) {
  const id = insert(
    `INSERT INTO notifications (user_id, kind, title, body, data, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, kind, title, body, JSON.stringify(data), now()]
  );
  const payload = { id, kind, title, body, data, created_at: now(), read_at: null };
  emit(userId, 'notification', payload);
  return payload;
}

export function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const rows = all(
    `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
     ORDER BY id DESC LIMIT ?`,
    [userId, limit]
  );
  return rows.map((r) => ({ ...r, data: parseJson(r.data, {}) }));
}

export function unreadCount(userId) {
  return get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [
    userId,
  ]).n;
}

export function markRead(userId, ids = null) {
  if (ids?.length) {
    const marks = ids.map(() => '?').join(',');
    run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN (${marks}) AND read_at IS NULL`,
      [now(), userId, ...ids]
    );
  } else {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [
      now(), userId,
    ]);
  }
  return { unread: unreadCount(userId) };
}
