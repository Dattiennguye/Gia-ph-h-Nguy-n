/**
 * Kênh sự kiện thời gian thực bằng Server-Sent Events.
 * Dùng cho tin nhắn mới, lượt match mới và thông báo — không cần WebSocket,
 * không cần thư viện ngoài.
 */

const channels = new Map(); // userId -> Set<res>

export function subscribe(userId, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  if (!channels.has(userId)) channels.set(userId, new Set());
  channels.get(userId).add(res);

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* kết nối đã đóng */
    }
  }, 25000);

  const close = () => {
    clearInterval(ping);
    channels.get(userId)?.delete(res);
    if (channels.get(userId)?.size === 0) channels.delete(userId);
  };
  res.on('close', close);
  res.on('error', close);
  return close;
}

/** Gửi một sự kiện tới mọi thiết bị đang mở của người dùng. */
export function emit(userId, type, data) {
  const set = channels.get(userId);
  if (!set?.size) return 0;
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of set) {
    try {
      res.write(payload);
      sent += 1;
    } catch {
      set.delete(res);
    }
  }
  return sent;
}

export function onlineCount() {
  return channels.size;
}

export function closeAll() {
  for (const set of channels.values()) {
    for (const res of set) {
      try {
        res.end();
      } catch {
        /* bỏ qua */
      }
    }
  }
  channels.clear();
}
