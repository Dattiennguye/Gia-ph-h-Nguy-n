import { all, get, insert, run, now, parseJson, transaction } from '../db/index.js';
import { loadViewer, loadProfile, publicView } from './profiles.js';
import { scorePair, explain, matchTier, hardFilter } from '../domain/matching.js';
import { buildIcebreaker, matchHighlights } from '../domain/icebreaker.js';
import { haversineKm } from '../lib/geo.js';
import { badRequest, conflict, notFound, forbidden, tooMany } from '../lib/http.js';
import { notify } from './notifications.js';
import { emit } from '../lib/events.js';
import { isPremium } from './billing.js';
import { config } from '../config.js';
import { audit } from './audit.js';

const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

function assertNotBlocked(a, b) {
  const row = get(
    'SELECT 1 AS x FROM blocks WHERE (user_id = ? AND blocked_id = ?) OR (user_id = ? AND blocked_id = ?)',
    [a, b, b, a]
  );
  if (row) throw forbidden('Không thể tương tác với người dùng này');
}

/** Số lượt thích đã dùng hôm nay (người dùng miễn phí bị giới hạn). */
export function likesUsedToday(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return get(
    `SELECT COUNT(*) AS n FROM likes
     WHERE from_user = ? AND action IN ('like','superlike') AND created_at >= ?`,
    [userId, start.getTime()]
  ).n;
}

/**
 * Ghi nhận một lượt thích hoặc bỏ qua.
 * Nếu cả hai cùng thích → tạo match + cuộc trò chuyện + câu mở lời.
 */
export const react = transaction((userId, targetId, action) => {
  if (userId === targetId) throw badRequest('Không thể tương tác với chính mình');
  if (!['like', 'pass', 'superlike'].includes(action)) throw badRequest('Hành động không hợp lệ');
  assertNotBlocked(userId, targetId);

  const target = loadProfile(targetId);
  if (!target) throw notFound('Không tìm thấy người dùng');
  if (target.user_status !== 'active') throw badRequest('Tài khoản này hiện không hoạt động');

  if (action !== 'pass' && !isPremium(userId)) {
    const used = likesUsedToday(userId);
    if (used >= config.matching.freeDailyLikes) {
      throw tooMany(
        `Bạn đã dùng hết ${config.matching.freeDailyLikes} lượt thích hôm nay. Hãy quay lại vào ngày mai, hoặc nâng cấp Premium để không giới hạn.`
      );
    }
  }

  const existing = get('SELECT * FROM likes WHERE from_user = ? AND to_user = ?', [userId, targetId]);
  if (existing) {
    if (existing.action === action) return { already: true, action };
    // Cho phép đổi ý từ "bỏ qua" sang "thích".
    if (existing.action !== 'pass') throw conflict('Bạn đã tương tác với người này rồi');
  }

  const viewer = loadViewer(userId);
  const distanceKm = haversineKm(viewer.profile.lat, viewer.profile.lng, target.lat, target.lng);
  const result = scorePair(viewer, { profile: target }, { distanceKm });

  if (existing) {
    run('UPDATE likes SET action = ?, score = ?, created_at = ? WHERE id = ?', [
      action, result.score, now(), existing.id,
    ]);
  } else {
    insert(
      `INSERT INTO likes (from_user, to_user, action, score, created_at) VALUES (?, ?, ?, ?, ?)`,
      [userId, targetId, action, result.score, now()]
    );
  }

  if (action === 'pass') return { action, matched: false };

  // Có match chưa?
  const theirs = get(
    `SELECT * FROM likes WHERE from_user = ? AND to_user = ? AND action IN ('like','superlike')`,
    [targetId, userId]
  );
  if (!theirs) {
    // Superlike thì người kia được báo ngay — đó là điểm khác biệt của nó.
    if (action === 'superlike') {
      notify(targetId, {
        kind: 'superlike',
        title: 'Có người đặc biệt quan tâm đến bạn',
        body: `${viewer.profile.display_name} đã gửi cho bạn một lượt thích đặc biệt.`,
        data: { from_user: userId },
      });
    }
    return { action, matched: false };
  }

  return { action, ...createMatch(userId, targetId, result) };
});

function createMatch(userId, targetId, result) {
  const [a, b] = pairKey(userId, targetId);
  const existing = get('SELECT * FROM matches WHERE user_a = ? AND user_b = ?', [a, b]);
  if (existing && existing.status === 'active') {
    return { matched: true, match_id: existing.id, already: true };
  }

  const profileA = loadProfile(a);
  const profileB = loadProfile(b);
  const ex = explain(result);
  const highlights = matchHighlights(profileA, profileB, ex.positives);
  const ice = buildIcebreaker(profileA, profileB, ex.positives);
  const t = now();

  let matchId;
  if (existing) {
    run('UPDATE matches SET status = ?, score = ?, highlights = ?, created_at = ?, closed_at = NULL WHERE id = ?', [
      'active', result.score, JSON.stringify(highlights), t, existing.id,
    ]);
    matchId = existing.id;
  } else {
    matchId = insert(
      `INSERT INTO matches (user_a, user_b, score, highlights, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
      [a, b, result.score, JSON.stringify(highlights), t]
    );
  }

  let conv = get('SELECT * FROM conversations WHERE match_id = ?', [matchId]);
  if (!conv) {
    const convId = insert(
      `INSERT INTO conversations (match_id, icebreaker, created_at) VALUES (?, ?, ?)`,
      [matchId, ice.question, t]
    );
    conv = get('SELECT * FROM conversations WHERE id = ?', [convId]);
  }

  for (const [me, other] of [[a, b], [b, a]]) {
    const otherProfile = other === a ? profileA : profileB;
    notify(me, {
      kind: 'match',
      title: 'Hai bạn đã kết nối ❤️',
      body: `Bạn và ${otherProfile.display_name} đã thích nhau.`,
      data: { match_id: matchId, conversation_id: conv.id, user_id: other },
    });
    emit(me, 'match', { match_id: matchId, conversation_id: conv.id, user_id: other });
  }

  return {
    matched: true,
    match_id: matchId,
    conversation_id: conv.id,
    highlights,
    icebreaker: ice.question,
    score: result.score,
  };
}

/* ------------------------------------------------------------ danh sách match */

export function listMatches(userId) {
  const rows = all(
    `SELECT m.*, c.id AS conversation_id, c.icebreaker, c.last_message_at
     FROM matches m
     LEFT JOIN conversations c ON c.match_id = m.id
     WHERE (m.user_a = ? OR m.user_b = ?) AND m.status = 'active'
     ORDER BY COALESCE(c.last_message_at, m.created_at) DESC`,
    [userId, userId]
  );
  const viewer = loadViewer(userId);

  return rows.map((row) => {
    const otherId = row.user_a === userId ? row.user_b : row.user_a;
    const other = loadProfile(otherId);
    const distanceKm = haversineKm(viewer.profile.lat, viewer.profile.lng, other?.lat, other?.lng);
    const lastMessage = get(
      `SELECT body, sender_id, created_at, read_at FROM messages
       WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [row.conversation_id]
    );
    const unread = row.conversation_id
      ? get(
          `SELECT COUNT(*) AS n FROM messages
           WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`,
          [row.conversation_id, userId]
        ).n
      : 0;

    return {
      match_id: row.id,
      conversation_id: row.conversation_id,
      matched_at: row.created_at,
      score: row.score,
      tier: matchTier(row.score ?? 0),
      highlights: parseJson(row.highlights, []),
      icebreaker: row.icebreaker,
      profile: other ? publicView(other, { distanceKm, viewer }) : null,
      last_message: lastMessage
        ? {
            body: lastMessage.body,
            from_me: lastMessage.sender_id === userId,
            created_at: lastMessage.created_at,
          }
        : null,
      unread,
    };
  });
}

/** Ai đã thích mình — tính năng Premium. */
export function whoLikedMe(userId) {
  const premium = isPremium(userId);
  const rows = all(
    `SELECT l.*, p.display_name FROM likes l
     JOIN profiles p ON p.user_id = l.from_user
     JOIN users u ON u.id = l.from_user
     WHERE l.to_user = ? AND l.action IN ('like','superlike') AND u.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM likes mine WHERE mine.from_user = ? AND mine.to_user = l.from_user)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id = ? AND b.blocked_id = l.from_user)
                                                 OR (b.user_id = l.from_user AND b.blocked_id = ?))
     ORDER BY l.created_at DESC LIMIT 50`,
    [userId, userId, userId, userId]
  );

  if (!premium) {
    return {
      premium: false,
      count: rows.length,
      items: [],
      message:
        rows.length > 0
          ? `Có ${rows.length} người đã thích bạn. Nâng cấp Premium để xem họ là ai.`
          : 'Chưa có ai thích bạn trong thời gian gần đây.',
    };
  }

  const viewer = loadViewer(userId);
  return {
    premium: true,
    count: rows.length,
    items: rows.map((r) => {
      const p = loadProfile(r.from_user);
      const distanceKm = haversineKm(viewer.profile.lat, viewer.profile.lng, p?.lat, p?.lng);
      return {
        profile: publicView(p, { distanceKm, viewer }),
        action: r.action,
        liked_at: r.created_at,
        score: r.score,
      };
    }),
  };
}

export function unmatch(userId, matchId) {
  const m = get('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!m) throw notFound('Không tìm thấy kết nối');
  if (m.user_a !== userId && m.user_b !== userId) throw forbidden('Đây không phải kết nối của bạn');
  run("UPDATE matches SET status = 'unmatched', closed_at = ? WHERE id = ?", [now(), matchId]);
  const other = m.user_a === userId ? m.user_b : m.user_a;
  emit(other, 'unmatch', { match_id: matchId });
  return { ok: true };
}

/* ------------------------------------------------------------------- chặn */

export const blockUser = transaction((userId, targetId, reason = null) => {
  if (userId === targetId) throw badRequest('Không thể tự chặn chính mình');
  if (!loadProfile(targetId)) throw notFound('Không tìm thấy người dùng');

  run(
    `INSERT INTO blocks (user_id, blocked_id, reason, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, blocked_id) DO NOTHING`,
    [userId, targetId, reason, now()]
  );

  const [a, b] = pairKey(userId, targetId);
  run("UPDATE matches SET status = 'blocked', closed_at = ? WHERE user_a = ? AND user_b = ?", [
    now(), a, b,
  ]);
  audit({ actorId: userId, action: 'user.block', targetType: 'user', targetId, detail: { reason } });
  emit(targetId, 'unmatch', { reason: 'blocked' });
  return { ok: true };
});

export function unblockUser(userId, targetId) {
  run('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?', [userId, targetId]);
  return { ok: true };
}

export function listBlocked(userId) {
  return all(
    `SELECT b.blocked_id AS user_id, b.reason, b.created_at, p.display_name
     FROM blocks b JOIN profiles p ON p.user_id = b.blocked_id
     WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    [userId]
  );
}

/** Thống kê tương tác của chính mình. */
export function myStats(userId) {
  const sent = get(
    `SELECT COUNT(*) AS n FROM likes WHERE from_user = ? AND action IN ('like','superlike')`,
    [userId]
  ).n;
  const received = get(
    `SELECT COUNT(*) AS n FROM likes WHERE to_user = ? AND action IN ('like','superlike')`,
    [userId]
  ).n;
  const matches = get(
    `SELECT COUNT(*) AS n FROM matches WHERE (user_a = ? OR user_b = ?) AND status = 'active'`,
    [userId, userId]
  ).n;
  return {
    likes_sent: sent,
    likes_received: received,
    matches,
    likes_left_today: isPremium(userId)
      ? null
      : Math.max(0, config.matching.freeDailyLikes - likesUsedToday(userId)),
  };
}
