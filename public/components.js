/* ===========================================================================
   Các thành phần giao diện dùng lại: thẻ hồ sơ, phần giải thích độ phù hợp,
   ô chọn nhiều, thanh điều hướng.
   =========================================================================== */
import { el, frag, photoOf, options } from './lib.js';

/** Vòng tròn điểm phù hợp + nhãn mức độ. Không phô con số ra làm trọng tâm. */
export function fitBar(compat) {
  return el('div.fit', {}, [
    el('div.ring', { style: { '--p': compat.score } }, [el('i', { text: `${compat.score}` })]),
    el('div', {}, [
      el('div.lbl', { text: compat.tier?.label ?? 'Gợi ý cho bạn' }),
      el('div.sub', { text: compat.headline }),
    ]),
  ]);
}

/** "Vì sao chúng tôi đề xuất người này?" */
export function reasons(compat, { compact = false } = {}) {
  const pos = compat.positives ?? [];
  const con = compat.considerations ?? [];
  if (!pos.length && !con.length) return null;

  const list = (items, cls, mark) =>
    el('ul', {}, items.map((r) => el(`li.${cls}`, {}, [el('span.m', { text: mark }), el('span', { text: r.text })])));

  return el('div.reasons', {}, [
    pos.length && el('div.heading', { text: compact ? 'Điểm phù hợp' : `${pos.length} điểm phù hợp` }),
    pos.length && list(compact ? pos.slice(0, 3) : pos, 'plus', '✓'),
    con.length && el('div.heading', { text: `${con.length} điểm cần cân nhắc` }),
    con.length && list(compact ? con.slice(0, 2) : con, 'warn', '△'),
  ]);
}

function verifBadges(v) {
  const out = [];
  if (v?.phone) out.push(el('span.vbadge', { text: '🟢 Đã xác minh SĐT' }));
  if (v?.photo) out.push(el('span.vbadge', { text: '🔵 Đã xác minh ảnh' }));
  if (v?.identity) out.push(el('span.vbadge', { text: '🟣 Đã xác minh danh tính' }));
  return out;
}

/** Thẻ hồ sơ trong bảng khám phá. */
export function profileCard(item, { onLike, onPass, onOpen, onSuper } = {}) {
  const p = item.profile;
  const c = item.compatibility;

  return el('article.card.pcard', {}, [
    el('div.photo', { onclick: () => onOpen?.(p.user_id), style: { cursor: 'pointer' } }, [
      el('img', { src: photoOf(p), alt: `Ảnh của ${p.display_name}`, loading: 'lazy' }),
      el('div.scrim'),
      item.boosted && el('span.vbadge', { text: '⚡ Đang được ưu tiên', style: { position: 'absolute', top: '12px', left: '12px' } }),
      el('div.who', {}, [
        el('h3', { text: `${p.display_name}, ${p.age ?? '—'}` }),
        el('div.meta', { text: `📍 ${p.area ?? 'Chưa rõ'} · ${p.distance_label}` }),
        el('div.badge-row', {}, verifBadges(p.verification)),
      ]),
    ]),

    fitBar(c),
    reasons(c, { compact: true }),

    p.relationship_goal_label &&
      el('div.pad', { style: { paddingTop: '0' } }, [
        el('div.taglist', {}, [
          el('span.tag', { text: `🎯 ${p.relationship_goal_label}` }),
          ...(p.interest_tags ?? []).slice(0, 4).map((t) =>
            el('span.tag', {
              class: (p.shared_interests ?? []).includes(t.value) ? 'shared' : '',
              text: t.label,
            })
          ),
        ]),
      ]),

    el('div.actions', {}, [
      el('button.btn.ghost', { text: '✕  Bỏ qua', onclick: () => onPass?.(p.user_id) }),
      onSuper && el('button.btn.sm', { text: '⭐', title: 'Thích đặc biệt', onclick: () => onSuper(p.user_id) }),
      el('button.btn.primary', { text: '♥  Thích', onclick: () => onLike?.(p.user_id) }),
    ]),
  ]);
}

/** Danh sách nhiều lựa chọn dạng chip. */
export function chipGroup(group, selected, onChange, { max = 99, items = null } = {}) {
  const chosen = new Set(selected ?? []);
  const source = items ?? options(group);

  const wrap = el('div.chips');
  for (const opt of source) {
    const chip = el('button.chip', {
      type: 'button',
      class: chosen.has(opt.value) ? 'on' : '',
      text: opt.label,
      onclick: () => {
        if (chosen.has(opt.value)) chosen.delete(opt.value);
        else {
          if (chosen.size >= max) return;
          chosen.add(opt.value);
        }
        chip.classList.toggle('on', chosen.has(opt.value));
        onChange([...chosen]);
      },
    });
    wrap.append(chip);
  }
  return wrap;
}

/** Ô chọn một giá trị từ bộ từ vựng. */
export function selectField(labelText, group, value, onChange, { allowEmpty = true } = {}) {
  const sel = el('select', { onchange: (e) => onChange(e.target.value || null) }, [
    allowEmpty && el('option', { value: '', text: '— Chưa chọn —' }),
    ...options(group).map((o) =>
      el('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) })
    ),
  ]);
  return el('label.field', {}, [el('span', { text: labelText }), sel]);
}

export function textField(labelText, value, onChange, props = {}) {
  return el('label.field', {}, [
    el('span', { text: labelText }),
    el(props.multiline ? 'textarea' : 'input', {
      type: props.type ?? 'text',
      value: value ?? '',
      placeholder: props.placeholder ?? '',
      ...(props.min !== undefined ? { min: props.min } : {}),
      ...(props.max !== undefined ? { max: props.max } : {}),
      oninput: (e) => onChange(e.target.value),
    }),
  ]);
}

/** Thanh điều hướng 5 mục. */
export function navBar(current, badges = {}, go) {
  const items = [
    ['home', '🏠', 'Trang chủ'],
    ['discover', '🔎', 'Khám phá'],
    ['matches', '❤️', 'Kết đôi'],
    ['chat', '💬', 'Trò chuyện'],
    ['me', '👤', 'Tôi'],
  ];
  return el('nav.nav', {},
    items.map(([key, icon, text]) =>
      el('button', { class: current === key ? 'on' : '', onclick: () => go(key) }, [
        badges[key] ? el('span.dot', { text: badges[key] > 99 ? '99+' : String(badges[key]) }) : null,
        el('span.ic', { text: icon }),
        el('span', { text }),
      ])
    )
  );
}

export function topBar(title, { onBack, right } = {}) {
  return el('header.topbar', {}, [
    onBack && el('button.back', { text: '←', 'aria-label': 'Quay lại', onclick: onBack }),
    el('h2', { text: title }),
    right,
  ]);
}

export function emptyState(icon, title, message, action) {
  return el('div.empty', {}, [
    el('span.ic', { text: icon }),
    el('h3', { text: title }),
    el('p', { text: message }),
    action,
  ]);
}
