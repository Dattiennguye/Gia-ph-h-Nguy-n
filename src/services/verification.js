import { all, get, insert, run, now, transaction } from '../db/index.js';
import { encryptPII, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, notFound } from '../lib/http.js';
import { audit } from './audit.js';
import { notify } from './notifications.js';

/**
 * XÁC MINH DANH TÍNH
 *
 * Ba mức, hiển thị như ba huy hiệu:
 *   🟢 phone    — xác minh số điện thoại (bắt buộc khi đăng ký)
 *   🔵 photo    — xác minh khuôn mặt (ảnh selfie theo tư thế ngẫu nhiên)
 *   🟣 identity — xác minh giấy tờ tuỳ thân
 *
 * Dữ liệu giấy tờ được mã hoá AES-256-GCM và KHÔNG BAO GIỜ xuất hiện trong bất
 * kỳ response nào tới người dùng khác. Người khác chỉ thấy "Đã xác minh danh
 * tính" — không thấy số, không thấy ảnh.
 */

/** Tư thế selfie ngẫu nhiên — chống dùng ảnh có sẵn. */
const POSES = [
  'Đưa tay phải lên ngang vai, lòng bàn tay hướng về camera',
  'Nghiêng đầu sang trái và mỉm cười',
  'Giơ hai ngón tay hình chữ V bên má phải',
  'Đặt bàn tay trái lên cằm',
  'Nhìn thẳng camera và giơ ngón tay cái lên',
];

export function requestPhotoChallenge(userId) {
  const existing = get(
    "SELECT * FROM verifications WHERE user_id = ? AND type = 'photo'",
    [userId]
  );
  if (existing?.status === 'approved') throw conflict('Bạn đã xác minh khuôn mặt rồi');

  const pose = POSES[Math.floor(Math.random() * POSES.length)];
  const t = now();
  run(
    `INSERT INTO verifications (user_id, type, status, payload_enc, created_at)
     VALUES (?, 'photo', 'pending', ?, ?)
     ON CONFLICT(user_id, type) DO UPDATE SET status = 'pending', payload_enc = ?, created_at = ?`,
    [userId, encryptPII(JSON.stringify({ pose })), t, encryptPII(JSON.stringify({ pose })), t]
  );
  return { pose, expires_in_minutes: 10 };
}

/** Nộp ảnh selfie theo tư thế đã yêu cầu. Người kiểm duyệt sẽ đối chiếu. */
export function submitPhoto(userId, photoUrl) {
  if (!photoUrl) throw badRequest('Thiếu ảnh xác minh');
  const row = get("SELECT * FROM verifications WHERE user_id = ? AND type = 'photo'", [userId]);
  if (!row) throw badRequest('Hãy yêu cầu tư thế xác minh trước');
  if (row.status === 'approved') throw conflict('Bạn đã xác minh khuôn mặt rồi');

  run(
    `UPDATE verifications SET payload_enc = ?, status = 'pending', created_at = ? WHERE id = ?`,
    [encryptPII(JSON.stringify({ photo_url: photoUrl, submitted_at: now() })), now(), row.id]
  );
  audit({ actorId: userId, action: 'verification.submit', targetType: 'verification', targetId: row.id, detail: { type: 'photo' } });
  return { status: 'pending', message: 'Đã gửi. Chúng tôi sẽ xác minh trong vòng 24 giờ.' };
}

/**
 * Nộp giấy tờ tuỳ thân. Số giấy tờ được băm để phát hiện một người mở nhiều
 * tài khoản, và được mã hoá để có thể đối chiếu khi cần — nhưng không hiển thị.
 */
export const submitIdentity = transaction((userId, { documentType, documentNumber, fullName, documentUrl }) => {
  if (!documentNumber || String(documentNumber).length < 6) {
    throw badRequest('Số giấy tờ không hợp lệ');
  }
  if (!['cccd', 'passport', 'driver_license'].includes(documentType)) {
    throw badRequest('Loại giấy tờ không được hỗ trợ');
  }

  const docHash = sha256(`${documentType}:${String(documentNumber).replace(/\s/g, '')}`);

  // Một giấy tờ chỉ gắn được với một tài khoản.
  const clash = get(
    `SELECT user_id FROM verifications WHERE document_hash = ? AND user_id != ? AND status = 'approved'`,
    [docHash, userId]
  );
  if (clash) {
    throw conflict('Giấy tờ này đã được dùng để xác minh cho một tài khoản khác.');
  }

  const payload = encryptPII(
    JSON.stringify({ documentType, documentNumber, fullName, documentUrl, submitted_at: now() })
  );
  const t = now();
  run(
    `INSERT INTO verifications (user_id, type, status, payload_enc, document_hash, created_at)
     VALUES (?, 'identity', 'pending', ?, ?, ?)
     ON CONFLICT(user_id, type) DO UPDATE
       SET status = 'pending', payload_enc = ?, document_hash = ?, created_at = ?`,
    [userId, payload, docHash, t, payload, docHash, t]
  );
  audit({ actorId: userId, action: 'verification.submit', targetType: 'user', targetId: userId, detail: { type: 'identity' } });
  return {
    status: 'pending',
    message: 'Đã nhận giấy tờ. Thông tin này được mã hoá và không hiển thị với người dùng khác.',
  };
});

export function myVerifications(userId) {
  const rows = all('SELECT type, status, review_note, created_at, reviewed_at FROM verifications WHERE user_id = ?', [
    userId,
  ]);
  const byType = Object.fromEntries(rows.map((r) => [r.type, r]));
  return {
    phone: byType.phone ?? { type: 'phone', status: 'none' },
    photo: byType.photo ?? { type: 'photo', status: 'none' },
    identity: byType.identity ?? { type: 'identity', status: 'none' },
    badges: rows.filter((r) => r.status === 'approved').map((r) => r.type),
  };
}

/* ------------------------------------------------------------ phía kiểm duyệt */

export function pendingVerifications({ limit = 50 } = {}) {
  return all(
    `SELECT v.id, v.user_id, v.type, v.created_at, p.display_name
     FROM verifications v LEFT JOIN profiles p ON p.user_id = v.user_id
     WHERE v.status = 'pending' ORDER BY v.created_at LIMIT ?`,
    [limit]
  );
}

export const reviewVerification = transaction((adminId, verificationId, { approve, note }) => {
  const v = get('SELECT * FROM verifications WHERE id = ?', [verificationId]);
  if (!v) throw notFound('Không tìm thấy yêu cầu xác minh');

  run(
    `UPDATE verifications SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?`,
    [approve ? 'approved' : 'rejected', adminId, note ?? null, now(), verificationId]
  );

  notify(v.user_id, {
    kind: 'verification',
    title: approve ? 'Xác minh thành công' : 'Xác minh chưa được chấp nhận',
    body: approve
      ? `Huy hiệu ${labelOfType(v.type)} đã được thêm vào hồ sơ của bạn.`
      : note || 'Vui lòng thử lại với hình ảnh/giấy tờ rõ nét hơn.',
    data: { type: v.type },
  });

  audit({
    actorId: adminId,
    actorRole: 'moderator',
    action: `verification.${approve ? 'approve' : 'reject'}`,
    targetType: 'user',
    targetId: v.user_id,
    detail: { type: v.type, note },
  });

  return { ok: true };
});

const labelOfType = (t) =>
  ({ phone: 'số điện thoại', photo: 'khuôn mặt', identity: 'danh tính' })[t] ?? t;
