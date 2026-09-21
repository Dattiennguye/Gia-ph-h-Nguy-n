import { all, get, insert, run, now, parseJson, transaction } from '../db/index.js';
import { loadProfile, loadViewer, publicView } from './profiles.js';
import { scanMessage, detectBulkSpam, warningFor, riskLevel } from '../domain/safety.js';
import { badRequest, forbidden, notFound } from '../lib/http.js';
import { emit } from '../lib/events.js';
import { notify } from './notifications.js';
import { openCase, recordSafetyEvent } from './moderation.js';
import { haversineKm } from '../lib/geo.js';
import { buildIcebreaker } from '../domain/icebreaker.js';

/** Lấy cuộc trò chuyện và kiểm tra người dùng có quyền vào hay không. */
export function loadConversation(userId, conversationId) {
  const row = get(
    `SELECT c.*, m.user_a, m.user_b, m.status AS match_status, m.highlights, m.score
     FROM conversations c JOIN matches m ON m.id = c.match_id
     WHERE c.id = ?`,
    [conversationId]
  );
  if (!row) throw notFound('Không tìm thấy cuộc trò chuyện');
  if (row.user_a !== userId && row.user_b !== userId) {
    throw forbidden('Bạn không có quyền truy cập cuộc trò chuyện này');
  }
  return row;
}

export function conversationDetail(userId, conversationId) {
  const conv = loadConversation(userId, conversationId);
  const otherId = conv.user_a === userId ? conv.user_b : conv.user_a;
  const viewer = loadViewer(userId);
  const other = loadProfile(otherId);
  const distanceKm = haversineKm(viewer.profile.lat, viewer.profile.lng, other?.lat, other?.lng);

  return {
    conversation_id: conv.id,
    match_id: conv.match_id,
    status: conv.match_status,
    can_send: conv.match_status === 'active',
    icebreaker: conv.icebreaker,
    highlights: parseJson(conv.highlights, []),
    score: conv.score,
    profile: other ? publicView(other, { distanceKm, viewer }) : null,
  };
}

export function listMessages(userId, conversationId, { before = null, limit = 50 } = {}) {
  loadConversation(userId, conversationId);
  const rows = all(
    `SELECT * FROM messages WHERE conversation_id = ? ${before ? 'AND id < ?' : ''}
     ORDER BY id DESC LIMIT ?`,
    before ? [conversationId, before, limit] : [conversationId, limit]
  );
  return rows
    .reverse()
    .map((m) => shapeMessage(m, userId));
}

function shapeMessage(m, userId) {
  const flags = parseJson(m.safety_flags, []);
  return {
    id: m.id,
    body: m.body,
    from_me: m.sender_id === userId,
    sender_id: m.sender_id,
    created_at: m.created_at,
    read_at: m.read_at,
    // Cảnh báo chỉ hiện cho NGƯỜI NHẬN, không hiện cho người gửi.
    warning: m.safety_state === 'warned' && m.sender_id !== userId ? warningFor(flags) : null,
  };
}

/**
 * Gửi tin nhắn. Mọi tin đều đi qua bộ quét an toàn trước khi lưu:
 *   clean   → gửi bình thường
 *   warned  → vẫn gửi, người nhận thấy cảnh báo, mở ca theo dõi
 *   blocked → không gửi, mở ca kiểm duyệt mức cao
 *
 * Việc ghi nhận an toàn nằm NGOÀI transaction lưu tin nhắn: khi một tin bị
 * chặn, chúng ta ném lỗi để người gửi biết — nếu ghi nhận nằm trong cùng
 * transaction thì chính hồ sơ kiểm duyệt cũng bị quay lui theo, và hành vi
 * xấu sẽ không để lại dấu vết nào.
 */
export function sendMessage(userId, conversationId, body) {
  const text = String(body ?? '').trim();
  if (!text) throw badRequest('Tin nhắn không được để trống');
  if (text.length > 2000) throw badRequest('Tin nhắn tối đa 2000 ký tự');

  const conv = loadConversation(userId, conversationId);
  if (conv.match_status !== 'active') {
    throw forbidden('Cuộc trò chuyện này đã kết thúc');
  }
  const otherId = conv.user_a === userId ? conv.user_b : conv.user_a;

  const scan = scanMessage(text);
  const flags = [...scan.flags];
  let risk = scan.risk;

  // Kiểm tra spam hàng loạt trên các tin gần đây của chính người gửi.
  const recent = all(
    `SELECT conversation_id, body FROM messages
     WHERE sender_id = ? AND created_at > ? ORDER BY id DESC LIMIT 60`,
    [userId, now() - 6 * 3600 * 1000]
  );
  const bulk = detectBulkSpam(text, recent);
  if (bulk) {
    flags.push(bulk);
    risk += bulk.severity;
  }

  const state = risk >= 8 ? 'blocked' : risk >= 3 ? 'warned' : 'clean';

  if (flags.length) {
    recordSafetyEvent(userId, {
      kind: 'message_scan',
      severity: risk,
      detail: { conversation_id: conversationId, flags: flags.map((f) => f.key), state },
    });
    openCase({
      targetId: userId,
      source: 'auto_scan',
      risk: riskLevel(risk),
      signals: flags.map((f) => f.label),
    });
  }

  if (state === 'blocked') {
    throw badRequest(
      'Tin nhắn này không thể gửi vì có dấu hiệu lừa đảo hoặc vi phạm quy tắc cộng đồng. Nếu bạn cho rằng đây là nhầm lẫn, hãy liên hệ hỗ trợ.'
    );
  }

  const row = persistMessage(userId, conversationId, text, state, flags);
  const sender = loadProfile(userId);

  emit(otherId, 'message', {
    conversation_id: conversationId,
    message: shapeMessage(row, otherId),
    from: { user_id: userId, display_name: sender.display_name },
  });
  emit(userId, 'message_sent', {
    conversation_id: conversationId,
    message: shapeMessage(row, userId),
  });

  notify(otherId, {
    kind: 'message',
    title: `Tin nhắn mới từ ${sender.display_name}`,
    body: text.slice(0, 80),
    data: { conversation_id: conversationId, user_id: userId },
  });

  return shapeMessage(row, userId);
}

/** Lưu tin nhắn và cập nhật mốc thời gian của cuộc trò chuyện — một khối. */
const persistMessage = transaction((userId, conversationId, text, state, flags) => {
  const t = now();
  const messageId = insert(
    `INSERT INTO messages (conversation_id, sender_id, body, safety_state, safety_flags, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conversationId, userId, text, state, JSON.stringify(flags), t]
  );
  run('UPDATE conversations SET last_message_at = ? WHERE id = ?', [t, conversationId]);
  return get('SELECT * FROM messages WHERE id = ?', [messageId]);
});

export function markConversationRead(userId, conversationId) {
  loadConversation(userId, conversationId);
  run(
    `UPDATE messages SET read_at = ?
     WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`,
    [now(), conversationId, userId]
  );
  return { ok: true };
}

export function totalUnread(userId) {
  return get(
    `SELECT COUNT(*) AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN matches mt ON mt.id = c.match_id
     WHERE m.sender_id != ? AND m.read_at IS NULL AND mt.status = 'active'
       AND (mt.user_a = ? OR mt.user_b = ?)`,
    [userId, userId, userId]
  ).n;
}

/**
 * Gợi ý một câu mở lời khác.
 *
 * Danh sách ứng viên được dựng từ TẤT CẢ điểm chung thật của hai người (từng
 * sở thích chung, rồi từng nét lối sống chung), nên mỗi lần bấm là một câu
 * khác nhau mà vẫn bám vào điểm chung — không phải câu chúc chung chung.
 */
export function refreshIcebreaker(userId, conversationId) {
  const conv = loadConversation(userId, conversationId);
  const otherId = conv.user_a === userId ? conv.user_b : conv.user_a;
  const me = loadProfile(userId);
  const other = loadProfile(otherId);

  const sharedInterests = (me.interest_tags ?? []).filter((t) =>
    (other.interest_tags ?? []).includes(t)
  );
  const sharedLifestyle = (me.lifestyle_tags ?? []).filter((t) =>
    (other.lifestyle_tags ?? []).includes(t)
  );

  const options = [];
  // Mỗi điểm chung cho ra một câu hỏi riêng.
  for (const tag of sharedInterests) {
    const q = buildIcebreaker({ ...me, interest_tags: [tag], lifestyle_tags: [] }, other).question;
    if (!options.includes(q)) options.push(q);
  }
  for (const tag of sharedLifestyle) {
    const q = buildIcebreaker(
      { ...me, interest_tags: [], lifestyle_tags: [tag] },
      { ...other, interest_tags: [] }
    ).question;
    if (!options.includes(q)) options.push(q);
  }
  // Luôn giữ vài câu dự phòng để còn chỗ mà xoay vòng.
  for (let i = 0; i < 4; i += 1) {
    const q = buildIcebreaker(
      { ...me, user_id: userId + i, interest_tags: [], lifestyle_tags: [] },
      { ...other, interest_tags: [], lifestyle_tags: [] }
    ).question;
    if (!options.includes(q)) options.push(q);
  }

  const currentIndex = options.indexOf(conv.icebreaker);
  const next = options[(currentIndex + 1) % options.length];

  run('UPDATE conversations SET icebreaker = ? WHERE id = ?', [next, conversationId]);
  return { icebreaker: next };
}
