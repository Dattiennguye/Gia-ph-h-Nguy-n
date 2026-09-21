/* ===========================================================================
   Nền tảng dùng chung: gọi API, dựng DOM, thông báo, kho trạng thái.
   Không dùng framework — chỉ DOM thuần, để app tải nhanh trên mạng yếu.
   =========================================================================== */

export const store = {
  token: localStorage.getItem('vigo_token') || null,
  user: null,
  taxonomy: null,
  meta: null,
  setToken(t) {
    this.token = t;
    if (t) localStorage.setItem('vigo_token', t);
    else localStorage.removeItem('vigo_token');
  },
};

/* --------------------------------------------------------------- gọi API */

export async function api(path, { method = 'GET', body, quiet = false } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = new Error(data.message || 'Có lỗi xảy ra, vui lòng thử lại.');
    err.code = data.error;
    err.status = res.status;
    err.detail = data.detail;
    if (res.status === 401) {
      store.setToken(null);
      store.user = null;
      location.hash = '#/welcome';
    }
    if (!quiet) toast(err.message, true);
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------- dựng DOM */

/**
 * el('div.card', {onclick}, [children])
 * Tên thẻ hỗ trợ cú pháp ngắn: 'button.btn.primary'
 */
export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className += ` ${v}`;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }

  for (const child of [children].flat(3)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  for (const c of children.flat(3)) if (c) f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return f;
};

export function mount(...nodes) {
  const app = document.getElementById('app');
  app.replaceChildren(...nodes.flat(3).filter(Boolean));
  window.scrollTo(0, 0);
  return app;
}

/* ------------------------------------------------------------- thông báo */

let toastTimer;
export function toast(message, isError = false) {
  document.querySelector('.toast')?.remove();
  const node = el('div.toast', { class: isError ? 'err' : '', text: message });
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3600);
}

/** Bảng trượt từ dưới lên. Trả về hàm đóng. */
export function sheet(title, content, { onClose } = {}) {
  const close = () => {
    bg.remove();
    onClose?.();
  };
  const bg = el('div.sheet-bg', {
    onclick: (e) => {
      if (e.target === bg) close();
    },
  }, [
    el('div.sheet', {}, [
      el('div.grab'),
      title && el('h2', { text: title }),
      typeof content === 'function' ? content(close) : content,
    ]),
  ]);
  document.body.append(bg);
  return close;
}

/** Hộp xác nhận — luôn hỏi trước khi làm việc khó hoàn tác. */
export function confirmSheet(title, message, confirmLabel, onConfirm, { danger = false } = {}) {
  sheet(title, (close) =>
    frag(
      el('p', { text: message, style: { color: 'var(--text-2)' } }),
      el('div.actions', { style: { padding: '8px 0 0' } }, [
        el('button.btn.ghost', { text: 'Huỷ', onclick: close }),
        el('button.btn', {
          class: danger ? 'danger' : 'primary',
          text: confirmLabel,
          onclick: async () => {
            close();
            await onConfirm();
          },
        }),
      ])
    )
  );
}

export const spinner = () => el('div.spinner');

/* ------------------------------------------------------------ định dạng */

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  if (s < 604800) return `${Math.floor(s / 86400)} ngày`;
  return new Date(ts).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export function clockOf(ts) {
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export const money = (vnd) => `${Number(vnd).toLocaleString('vi-VN')}₫`;

export const photoOf = (profile) =>
  profile?.photos?.[0]?.url ||
  `data:image/svg+xml;base64,${btoa(
    unescape(
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#e8ddd6"/><text x="40" y="52" font-size="34" text-anchor="middle" fill="#9a8b83">?</text></svg>`
      )
    )
  )}`;

/** Nhãn từ bộ từ vựng của server. */
export function label(group, value) {
  if (value == null) return null;
  const item = store.taxonomy?.[group]?.find((i) => String(i.value) === String(value));
  return item?.label ?? String(value);
}

export const options = (group) => store.taxonomy?.[group] ?? [];
