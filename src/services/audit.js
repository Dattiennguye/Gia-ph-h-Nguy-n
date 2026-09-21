import { all, insert, now } from '../db/index.js';

/**
 * Nhật ký kiểm toán: mọi hành động của quản trị viên và các mốc quan trọng của
 * người dùng đều để lại dấu vết không sửa được từ giao diện.
 */
export function audit({ actorId, actorRole, action, targetType, targetId, detail, ip }) {
  return insert(
    `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorId ?? null,
      actorRole ?? null,
      action,
      targetType ?? null,
      targetId != null ? String(targetId) : null,
      JSON.stringify(detail ?? {}),
      ip ?? null,
      now(),
    ]
  );
}

export function listAudit({ limit = 100, offset = 0, actorId, action } = {}) {
  const where = [];
  const params = [];
  if (actorId) {
    where.push('actor_id = ?');
    params.push(actorId);
  }
  if (action) {
    where.push('action LIKE ?');
    params.push(`${action}%`);
  }
  const sql = `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY id DESC LIMIT ? OFFSET ?`;
  return all(sql, [...params, limit, offset]);
}
