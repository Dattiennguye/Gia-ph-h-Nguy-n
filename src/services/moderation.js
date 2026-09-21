import { all, get, insert, run, now, parseJson, transaction } from '../db/index.js';
import { riskLevel } from '../domain/safety.js';
import { badRequest, notFound } from '../lib/http.js';
import { isValid } from '../domain/taxonomy.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

/**
 * KIỂM DUYỆT
 *
 * Luồng: Báo cáo → Ca kiểm duyệt → Hành động → Nhật ký.
 * Phân tầng theo rủi ro:
 *   low    → ghi nhận, gom lại để xem xu hướng
 *   medium → đưa vào hàng đợi cho người kiểm duyệt
 *   high   → tạm khoá tài khoản ngay, rồi mới xem xét
 */

export function recordSafetyEvent(userId, { kind, severity = 1, detail = {} }) {
  insert(
    `INSERT INTO safety_events (user_id, kind, severity, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, kind, severity, JSON.stringify(detail), now()]
  );
  // Điểm rủi ro cộng dồn của tài khoản, dùng để xếp ưu tiên kiểm duyệt.
  run('UPDATE users SET risk_score = risk_score + ? WHERE id = ?', [severity, userId]);
}

/** Mở ca kiểm duyệt. Gộp vào ca đang mở nếu có, để không làm ngập hàng đợi. */
export const openCase = transaction(({ targetId, reportId = null, source, risk, signals = [] }) => {
  const existing = get(
    `SELECT * FROM moderation_cases WHERE target_id = ? AND status IN ('open','reviewing')
     ORDER BY id DESC LIMIT 1`,
    [targetId]
  );

  if (existing) {
    const merged = [...new Set([...parseJson(existing.signals, []), ...signals])];
    const order = { low: 0, medium: 1, high: 2 };
    const worse = order[risk] > order[existing.risk] ? risk : existing.risk;
    run('UPDATE moderation_cases SET signals = ?, risk = ? WHERE id = ?', [
      JSON.stringify(merged), worse, existing.id,
    ]);
    if (worse === 'high') autoSuspend(targetId, merged);
    return get('SELECT * FROM moderation_cases WHERE id = ?', [existing.id]);
  }

  const id = insert(
    `INSERT INTO moderation_cases (target_id, report_id, source, risk, signals, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    [targetId, reportId, source, risk, JSON.stringify(signals), now()]
  );

  if (risk === 'high') autoSuspend(targetId, signals);
  return get('SELECT * FROM moderation_cases WHERE id = ?', [id]);
});

/** Rủi ro cao → tạm khoá ngay, con người xem xét sau. */
function autoSuspend(userId, signals) {
  const user = get('SELECT status FROM users WHERE id = ?', [userId]);
  if (!user || ['banned', 'suspended'].includes(user.status)) return;
  run(
    `UPDATE users SET status = 'suspended', status_reason = ?, updated_at = ? WHERE id = ?`,
    ['Tạm khoá tự động do phát hiện dấu hiệu rủi ro cao, đang chờ kiểm duyệt', now(), userId]
  );
  audit({
    actorId: null,
    actorRole: 'system',
    action: 'moderation.auto_suspend',
    targetType: 'user',
    targetId: userId,
    detail: { signals },
  });
}

/* ------------------------------------------------------------------ báo cáo */

export const createReport = transaction((reporterId, { targetId, category, detail, evidence }) => {
  if (reporterId === targetId) throw badRequest('Không thể tự báo cáo chính mình');
  if (!get('SELECT 1 AS x FROM users WHERE id = ?', [targetId])) throw notFound('Không tìm thấy người dùng');
  if (!isValid('report_category', category)) throw badRequest('Loại báo cáo không hợp lệ');

  const recent = get(
    `SELECT 1 AS x FROM reports WHERE reporter_id = ? AND target_id = ? AND created_at > ?`,
    [reporterId, targetId, now() - 24 * 3600 * 1000]
  );
  if (recent) {
    return { ok: true, duplicate: true, message: 'Bạn đã báo cáo người này trong 24 giờ qua. Chúng tôi đang xử lý.' };
  }

  const reportId = insert(
    `INSERT INTO reports (reporter_id, target_id, category, detail, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [reporterId, targetId, category, detail ?? null, JSON.stringify(evidence ?? {}), now()]
  );

  // Mức rủi ro ban đầu phụ thuộc loại vi phạm và số báo cáo đã có.
  const reportCount = get(
    `SELECT COUNT(DISTINCT reporter_id) AS n FROM reports WHERE target_id = ? AND status != 'dismissed'`,
    [targetId]
  ).n;
  const severe = ['scam', 'harassment', 'underage', 'fake_profile'].includes(category);
  const risk = reportCount >= 3 || (severe && reportCount >= 2) ? 'high' : severe ? 'medium' : 'low';

  recordSafetyEvent(targetId, {
    kind: 'report',
    severity: severe ? 3 : 1,
    detail: { category, report_id: reportId },
  });
  openCase({
    targetId,
    reportId,
    source: 'report',
    risk,
    signals: [`Báo cáo: ${category}`],
  });

  audit({ actorId: reporterId, action: 'report.create', targetType: 'user', targetId, detail: { category } });
  return {
    ok: true,
    report_id: reportId,
    message: 'Cảm ơn bạn đã báo cáo. Đội ngũ kiểm duyệt sẽ xem xét trong thời gian sớm nhất.',
  };
});

/* --------------------------------------------------------- hàng đợi & xử lý */

export function listCases({ status = 'open', risk = null, limit = 50, offset = 0 } = {}) {
  const where = ['1=1'];
  const params = [];
  if (status && status !== 'all') {
    where.push('mc.status = ?');
    params.push(status);
  }
  if (risk) {
    where.push('mc.risk = ?');
    params.push(risk);
  }

  return all(
    `SELECT mc.*, p.display_name, u.status AS user_status, u.risk_score,
            (SELECT COUNT(*) FROM reports r WHERE r.target_id = mc.target_id) AS report_count
     FROM moderation_cases mc
     JOIN users u ON u.id = mc.target_id
     LEFT JOIN profiles p ON p.user_id = mc.target_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE mc.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, mc.created_at
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((c) => ({ ...c, signals: parseJson(c.signals, []) }));
}

export function caseDetail(caseId) {
  const c = get('SELECT * FROM moderation_cases WHERE id = ?', [caseId]);
  if (!c) throw notFound('Không tìm thấy ca kiểm duyệt');
  return {
    ...c,
    signals: parseJson(c.signals, []),
    reports: all(
      `SELECT r.*, p.display_name AS reporter_name FROM reports r
       LEFT JOIN profiles p ON p.user_id = r.reporter_id
       WHERE r.target_id = ? ORDER BY r.id DESC LIMIT 20`,
      [c.target_id]
    ).map((r) => ({ ...r, evidence: parseJson(r.evidence, {}) })),
    safety_events: all(
      'SELECT * FROM safety_events WHERE user_id = ? ORDER BY id DESC LIMIT 20',
      [c.target_id]
    ).map((e) => ({ ...e, detail: parseJson(e.detail, {}) })),
  };
}

const ACTIONS = ['dismiss', 'warn', 'suspend', 'ban', 'reinstate'];

/** Người kiểm duyệt ra quyết định. Mọi quyết định đều vào nhật ký. */
export const resolveCase = transaction((adminId, caseId, { action, note }) => {
  if (!ACTIONS.includes(action)) throw badRequest('Hành động không hợp lệ');
  const c = get('SELECT * FROM moderation_cases WHERE id = ?', [caseId]);
  if (!c) throw notFound('Không tìm thấy ca kiểm duyệt');

  const t = now();
  const target = c.target_id;

  switch (action) {
    case 'dismiss':
      run("UPDATE users SET status = CASE WHEN status = 'suspended' THEN 'active' ELSE status END, status_reason = NULL WHERE id = ?", [target]);
      run('UPDATE users SET risk_score = 0 WHERE id = ?', [target]);
      break;
    case 'warn':
      notify(target, {
        kind: 'moderation',
        title: 'Cảnh báo từ đội ngũ kiểm duyệt',
        body: note || 'Hoạt động của bạn có dấu hiệu vi phạm quy tắc cộng đồng. Vui lòng xem lại.',
        data: {},
      });
      break;
    case 'suspend':
      // Giữ nguyên phiên đăng nhập: người dùng cần đọc được lý do bị tạm khoá.
      run("UPDATE users SET status = 'suspended', status_reason = ?, updated_at = ? WHERE id = ?", [
        note || 'Tạm khoá do vi phạm quy tắc cộng đồng', t, target,
      ]);
      break;
    case 'ban':
      run("UPDATE users SET status = 'banned', status_reason = ?, updated_at = ? WHERE id = ?", [
        note || 'Khoá vĩnh viễn do vi phạm nghiêm trọng', t, target,
      ]);
      run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [t, target]);
      run("UPDATE profiles SET visibility = 'hidden' WHERE user_id = ?", [target]);
      break;
    case 'reinstate':
      run("UPDATE users SET status = 'active', status_reason = NULL, risk_score = 0, updated_at = ? WHERE id = ?", [t, target]);
      run("UPDATE profiles SET visibility = 'public' WHERE user_id = ?", [target]);
      notify(target, {
        kind: 'moderation',
        title: 'Tài khoản của bạn đã được mở lại',
        body: note || 'Sau khi xem xét, chúng tôi đã khôi phục tài khoản của bạn.',
        data: {},
      });
      break;
  }

  run(
    `UPDATE moderation_cases SET status = ?, assignee_id = ?, resolution = ?, resolved_at = ? WHERE id = ?`,
    [action === 'dismiss' ? 'dismissed' : 'actioned', adminId, `${action}: ${note ?? ''}`.trim(), t, caseId]
  );
  run(
    `UPDATE reports SET status = ? WHERE target_id = ? AND status IN ('open','reviewing')`,
    [action === 'dismiss' ? 'dismissed' : 'resolved', target]
  );

  audit({
    actorId: adminId,
    actorRole: 'moderator',
    action: `moderation.${action}`,
    targetType: 'user',
    targetId: target,
    detail: { case_id: caseId, note },
  });

  return caseDetail(caseId);
});

export function listReports({ status = 'open', limit = 50, offset = 0 } = {}) {
  return all(
    `SELECT r.*, pt.display_name AS target_name, pr.display_name AS reporter_name
     FROM reports r
     LEFT JOIN profiles pt ON pt.user_id = r.target_id
     LEFT JOIN profiles pr ON pr.user_id = r.reporter_id
     ${status && status !== 'all' ? 'WHERE r.status = ?' : ''}
     ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    status && status !== 'all' ? [status, limit, offset] : [limit, offset]
  ).map((r) => ({ ...r, evidence: parseJson(r.evidence, {}) }));
}
