/* ===========================================================================
   Năm màn hình chính: Trang chủ · Khám phá · Kết đôi · Trò chuyện · Tôi
   =========================================================================== */
import {
  api, el, frag, mount, store, toast, sheet, confirmSheet, spinner,
  timeAgo, clockOf, photoOf, money, options,
} from './lib.js';
import {
  topBar, navBar, profileCard, fitBar, reasons, emptyState,
  chipGroup, selectField, textField,
} from './components.js';

const go = (h) => { location.hash = h; };
const nav = (current, badges) => navBar(current, badges, (k) => go(`#/${k}`));

let badges = { chat: 0, me: 0 };
export function setBadges(b) { badges = { ...badges, ...b }; }

/* ============================================================ TRANG CHỦ === */

export async function homeScreen() {
  mount(topBar('Hôm nay dành cho bạn'), el('div.screen', {}, [spinner()]), nav('home', badges));

  const [daily, overview] = await Promise.all([
    api('/discovery/daily'),
    api('/profile/overview'),
  ]);

  const body = el('div.screen');

  if (overview.profile.completeness < 70) {
    body.append(
      el('div.card', {}, [
        el('div.pad', {}, [
          el('b', { text: `Hồ sơ của bạn mới hoàn thiện ${overview.profile.completeness}%` }),
          el('div.meter', { style: { margin: '8px 0' } }, [
            el('i', { style: { width: `${overview.profile.completeness}%` } }),
          ]),
          el('p.muted', { text: 'Hồ sơ đầy đủ giúp chúng tôi ghép đúng hơn và người khác tin tưởng hơn.' }),
          el('button.btn.primary.sm', { text: 'Hoàn thiện ngay', onclick: () => go('#/profile/edit') }),
        ]),
      ])
    );
  }

  if (daily.needs === 'location') {
    body.append(emptyState('📍', 'Chưa có khu vực', 'Hãy chọn khu vực sinh sống để chúng tôi tìm người quanh bạn.',
      el('button.btn.primary.sm', { text: 'Chọn khu vực', onclick: () => go('#/profile/edit') })));
  } else if (!daily.items.length) {
    body.append(emptyState('🌱', 'Hôm nay chưa có gợi ý mới',
      'Khu vực của bạn có thể chưa đủ người, hoặc bộ tiêu chí đang khá chặt.',
      el('button.btn.primary.sm', { text: 'Xem phân tích của AI Matchmaker', onclick: () => go('#/matchmaker') })));
  } else {
    const fresh = daily.items.filter((i) => !i.acted);
    body.append(
      el('p.muted', {
        text: fresh.length
          ? `${fresh.length} người thực sự phù hợp với bạn hôm nay. Chúng tôi chọn ít nhưng chọn kỹ.`
          : 'Bạn đã xem hết gợi ý hôm nay. Hãy quay lại vào ngày mai.',
      })
    );
    for (const item of daily.items) {
      if (item.acted) continue;
      body.append(
        profileCard(item, {
          onOpen: (id) => go(`#/profile/${id}`),
          onLike: (id) => reactTo(id, 'like', homeScreen),
          onPass: (id) => reactTo(id, 'pass', homeScreen),
          onSuper: (id) => reactTo(id, 'superlike', homeScreen),
        })
      );
    }
  }

  body.append(
    el('div.section-title', {}, [el('h3', { text: 'Công cụ' })]),
    el('div.card', {}, [
      listRow('🤖', 'AI Matchmaker', 'Phân tích vì sao bạn khó/dễ tìm người', () => go('#/matchmaker')),
      listRow('🗺️', 'Người quanh bạn', 'Xem mật độ người phù hợp trên bản đồ', () => go('#/nearby')),
      listRow('💎', 'Vigo Premium', 'Mở rộng phạm vi và công cụ tìm kiếm', () => go('#/premium')),
    ])
  );

  mount(topBar('Hôm nay dành cho bạn'), body, nav('home', badges));
}

function listRow(icon, title, sub, onclick) {
  return el('div.list-item', { onclick }, [
    el('div', { text: icon, style: { fontSize: '1.5rem', width: '38px', textAlign: 'center' } }),
    el('div.txt', {}, [el('div.nm', { text: title }), el('div.pv', { text: sub })]),
    el('div.rt', { text: '›', style: { fontSize: '1.3rem' } }),
  ]);
}

async function reactTo(userId, action, refresh) {
  try {
    const res = await api('/discovery/react', { method: 'POST', body: { user_id: userId, action } });
    if (res.matched) showMatch(res);
    else if (action !== 'pass') toast('Đã gửi lượt thích.');
    await refresh();
  } catch {
    /* thông báo lỗi đã hiện */
  }
}

function showMatch(res) {
  sheet(null, (close) =>
    frag(
      el('div.center', {}, [
        el('div', { text: '💞', style: { fontSize: '3rem' } }),
        el('h2', { text: 'Hai bạn đã kết nối!' }),
      ]),
      el('div.reasons', {}, [
        el('div.heading', { text: 'Hai bạn đều' }),
        el('ul', {}, (res.highlights ?? []).map((h) =>
          el('li.plus', {}, [el('span.m', { text: '✓' }), el('span', { text: h })])
        )),
      ]),
      res.icebreaker &&
        el('div.ice', {}, [
          el('div.h', { text: 'Một chủ đề để bắt đầu' }),
          el('div.q', { text: `"${res.icebreaker}"` }),
        ]),
      el('div.actions', { style: { padding: '10px 0 0' } }, [
        el('button.btn.ghost', { text: 'Để sau', onclick: close }),
        el('button.btn.primary', {
          text: 'Nhắn tin ngay',
          onclick: () => { close(); go(`#/chat/${res.conversation_id}`); },
        }),
      ])
    )
  );
}

/* ============================================================= KHÁM PHÁ === */

export async function discoverScreen() {
  mount(topBar('Khám phá'), el('div.screen', {}, [spinner()]), nav('discover', badges));

  const radius = Number(sessionStorage.getItem('vigo_radius')) || undefined;
  const feed = await api(`/discovery/feed?limit=20${radius ? `&radius_km=${radius}` : ''}`);
  const body = el('div.screen');

  const radiusOptions = [1, 5, 10, 20, 30, 50, 100, 200].filter((r) => r <= feed.max_radius_km);
  body.append(
    el('div.card', {}, [
      el('div.pad', {}, [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
          el('b', { text: 'Bán kính tìm kiếm' }),
          el('span.muted', { style: { marginLeft: 'auto' }, text: `${feed.total} người phù hợp` }),
        ]),
        el('div.chips', {}, radiusOptions.map((r) =>
          el('button.chip', {
            type: 'button',
            class: r === feed.radius_km ? 'on' : '',
            text: `${r} km`,
            onclick: () => { sessionStorage.setItem('vigo_radius', r); discoverScreen(); },
          })
        )),
        feed.max_radius_km < 200 &&
          el('p.muted', { style: { marginTop: '8px', marginBottom: 0 },
            text: `Gói miễn phí tìm được tối đa ${feed.max_radius_km} km. Premium mở tới 200 km.` }),
      ]),
    ]),
    el('div', { style: { display: 'flex', gap: '10px', marginBottom: '14px' } }, [
      el('button.btn.sm', { text: '🗺️ Bản đồ', style: { flex: 1 }, onclick: () => go('#/nearby') }),
      el('button.btn.sm', { text: '⚙️ Nhu cầu của tôi', style: { flex: 1 }, onclick: () => go('#/preference') }),
    ])
  );

  if (feed.needs === 'location') {
    body.append(emptyState('📍', 'Chưa có khu vực', feed.message,
      el('button.btn.primary.sm', { text: 'Chọn khu vực', onclick: () => go('#/profile/edit') })));
  } else if (!feed.items.length) {
    body.append(emptyState('🔍', 'Chưa tìm thấy ai phù hợp',
      'Thử mở rộng bán kính, hoặc xem lại các tiêu chí bắt buộc của bạn.',
      el('button.btn.primary.sm', { text: 'Xem AI Matchmaker', onclick: () => go('#/matchmaker') })));
  } else {
    for (const item of feed.items) {
      body.append(profileCard(item, {
        onOpen: (id) => go(`#/profile/${id}`),
        onLike: (id) => reactTo(id, 'like', discoverScreen),
        onPass: (id) => reactTo(id, 'pass', discoverScreen),
        onSuper: (id) => reactTo(id, 'superlike', discoverScreen),
      }));
    }
  }

  mount(topBar('Khám phá'), body, nav('discover', badges));
}

/* ========================================================== HỒ SƠ NGƯỜI KHÁC === */

export async function profileDetailScreen(userId) {
  mount(topBar('Hồ sơ', { onBack: () => history.back() }), el('div.screen.no-nav', {}, [spinner()]));

  const data = await api(`/discovery/profile/${userId}`);
  const p = data.profile;
  const c = data.compatibility;

  const fact = (k, v) => v && el('div', {}, [el('dt', { text: k }), el('dd', { text: v })]);

  mount(
    topBar(p.display_name, {
      onBack: () => history.back(),
      right: el('button.back', { text: '⋮', 'aria-label': 'Tuỳ chọn', onclick: () => moreSheet(p) }),
    }),
    el('div.screen.no-nav', {}, [
      el('div.card.pcard', {}, [
        el('div.photo', {}, [
          el('img', { src: photoOf(p), alt: `Ảnh của ${p.display_name}` }),
          el('div.scrim'),
          el('div.who', {}, [
            el('h3', { text: `${p.display_name}, ${p.age ?? '—'}` }),
            el('div.meta', { text: `📍 ${p.area ?? ''} · ${p.distance_label}` }),
            p.last_active && el('div.meta', { text: p.last_active }),
          ]),
        ]),
        fitBar(c),
        reasons(c),
      ]),

      p.bio && el('div.card', {}, [el('div.pad', {}, [el('h3', { text: 'Giới thiệu' }), el('p', { text: p.bio })])]),

      el('div.card', {}, [
        el('div.pad', {}, [
          el('h3', { text: 'Thông tin' }),
          el('dl.facts', {}, [
            fact('Mục đích', p.relationship_goal_label),
            fact('Nghề nghiệp', p.occupation),
            fact('Học vấn', p.education_label),
            fact('Chiều cao', p.height_cm && `${p.height_cm} cm`),
            fact('Tình trạng', p.marital_status_label),
            fact('Dự định kết hôn', p.marriage_timeline_label),
            fact('Con cái', p.children_wish_label),
            fact('Nơi ở sau kết hôn', p.living_preference_label),
            fact('Hút thuốc', p.smoking_label),
            fact('Rượu bia', p.drinking_label),
            fact('Tôn giáo', p.religion_label),
            fact('Thu nhập', p.income_label),
          ].filter(Boolean)),
        ]),
      ]),

      (p.lifestyle_tags?.length || p.interest_tags?.length) &&
        el('div.card', {}, [
          el('div.pad', {}, [
            p.lifestyle_tags?.length && el('h3', { text: 'Lối sống' }),
            p.lifestyle_tags?.length && el('div.taglist', { style: { marginBottom: '14px' } },
              p.lifestyle_tags.map((t) => el('span.tag', {
                class: (p.shared_lifestyle ?? []).includes(t.value) ? 'shared' : '', text: t.label,
              }))),
            p.interest_tags?.length && el('h3', { text: 'Sở thích' }),
            p.interest_tags?.length && el('div.taglist', {},
              p.interest_tags.map((t) => el('span.tag', {
                class: (p.shared_interests ?? []).includes(t.value) ? 'shared' : '', text: t.label,
              }))),
            (p.shared_lifestyle?.length || p.shared_interests?.length) &&
              el('p.muted', { style: { marginTop: '10px', marginBottom: 0 }, text: 'Phần tô màu là điểm chung giữa hai bạn.' }),
          ].filter(Boolean)),
        ]),

      data.blocked_by_filters?.length &&
        el('div.note.warn', { text: `Người này nằm ngoài bộ lọc hiện tại của bạn: ${data.blocked_by_filters.join(' · ')}` }),

      el('div.actions', { style: { padding: '4px 0 0' } }, [
        el('button.btn.ghost', { text: '✕  Bỏ qua', onclick: async () => { await reactTo(p.user_id, 'pass', async () => history.back()); } }),
        el('button.btn.primary', { text: '♥  Thích', onclick: async () => { await reactTo(p.user_id, 'like', async () => history.back()); } }),
      ]),
    ])
  );
}

function moreSheet(p) {
  sheet('Tuỳ chọn', (close) =>
    frag(
      el('button.btn.block', {
        text: '🚩 Báo cáo người dùng này',
        style: { marginBottom: '10px' },
        onclick: () => { close(); reportSheet(p); },
      }),
      el('button.btn.block.danger', {
        text: '🚫 Chặn người này',
        onclick: () => {
          close();
          confirmSheet('Chặn người dùng',
            `${p.display_name} sẽ không còn nhìn thấy bạn, và bạn cũng không thấy họ. Kết nối hiện có sẽ bị gỡ.`,
            'Chặn', async () => {
              await api('/social/block', { method: 'POST', body: { user_id: p.user_id } });
              toast('Đã chặn người dùng này.');
              go('#/discover');
            }, { danger: true });
        },
      })
    )
  );
}

export function reportSheet(p) {
  let category = null;
  let detail = '';
  sheet('Báo cáo người dùng', (close) =>
    frag(
      el('p.muted', { text: `Bạn đang báo cáo ${p.display_name}. Mọi báo cáo đều được đội ngũ kiểm duyệt xem xét.` }),
      el('div.chips', { style: { marginBottom: '14px' } },
        options('report_category').map((o) =>
          el('button.chip', {
            type: 'button', text: o.label,
            onclick: (e) => {
              category = o.value;
              e.target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
              e.target.classList.add('on');
            },
          })
        )),
      textField('Mô tả thêm (tuỳ chọn)', '', (v) => (detail = v), { multiline: true, placeholder: 'Điều gì đã xảy ra?' }),
      el('button.btn.primary.block', {
        text: 'Gửi báo cáo',
        onclick: async () => {
          if (!category) return toast('Hãy chọn lý do báo cáo.', true);
          const res = await api('/social/report', { method: 'POST', body: { user_id: p.user_id, category, detail } });
          close();
          toast(res.message);
        },
      })
    )
  );
}

/* ============================================================ KẾT ĐÔI === */

export async function matchesScreen() {
  mount(topBar('Kết đôi'), el('div.screen', {}, [spinner()]), nav('matches', badges));

  const [{ matches }, liked] = await Promise.all([
    api('/social/matches'),
    api('/social/likes/received'),
  ]);

  const body = el('div.screen');

  body.append(
    el('div.card', { onclick: () => go('#/liked-me'), style: { cursor: 'pointer' } }, [
      el('div.pad', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
        el('div', { text: '💗', style: { fontSize: '1.8rem' } }),
        el('div', { style: { flex: 1 } }, [
          el('b', { text: `${liked.count} người đã thích bạn` }),
          el('div.muted', { text: liked.premium ? 'Chạm để xem họ là ai' : 'Nâng cấp Premium để xem họ là ai' }),
        ]),
        el('div', { text: '›', style: { fontSize: '1.4rem', color: 'var(--text-3)' } }),
      ]),
    ])
  );

  if (!matches.length) {
    body.append(emptyState('❤️', 'Chưa có kết nối nào',
      'Khi hai bạn cùng thích nhau, cuộc trò chuyện sẽ mở ra ở đây.',
      el('button.btn.primary.sm', { text: 'Khám phá ngay', onclick: () => go('#/discover') })));
  } else {
    body.append(el('div.section-title', {}, [el('h3', { text: `${matches.length} kết nối` })]));
    const card = el('div.card');
    for (const m of matches) {
      card.append(
        el('div.list-item', { onclick: () => go(`#/chat/${m.conversation_id}`) }, [
          el('img.avatar', { src: photoOf(m.profile), alt: '' }),
          el('div.txt', {}, [
            el('div.nm', {}, [
              m.profile?.display_name ?? 'Người dùng',
              m.profile?.verification?.identity && el('span', { text: '🟣', title: 'Đã xác minh danh tính' }),
            ]),
            el('div.pv', { text: (m.highlights ?? [])[0] ?? m.tier?.label ?? '' }),
          ]),
          el('div.rt', {}, [
            el('div', { text: timeAgo(m.matched_at) }),
            m.unread ? el('span.unread', { text: String(m.unread) }) : null,
          ]),
        ])
      );
    }
    body.append(card);
  }

  mount(topBar('Kết đôi'), body, nav('matches', badges));
}

export async function likedMeScreen() {
  mount(topBar('Đã thích bạn', { onBack: () => go('#/matches') }), el('div.screen.no-nav', {}, [spinner()]));
  const data = await api('/social/likes/received');
  const body = el('div.screen.no-nav');

  if (!data.premium) {
    body.append(
      el('div.card', {}, [
        el('div.pad.center', {}, [
          el('div', { text: '💎', style: { fontSize: '2.4rem' } }),
          el('h3', { text: data.count ? `${data.count} người đã thích bạn` : 'Chưa có ai thích bạn' }),
          el('p.muted', { text: data.message }),
          data.count > 0 && el('button.btn.primary.block', { text: 'Xem gói Premium', onclick: () => go('#/premium') }),
        ].filter(Boolean)),
      ])
    );
  } else if (!data.items.length) {
    body.append(emptyState('💗', 'Chưa có ai thích bạn', 'Hồ sơ đầy đủ hơn sẽ giúp bạn được chú ý nhiều hơn.'));
  } else {
    for (const item of data.items) {
      body.append(profileCard({ profile: item.profile, compatibility: { score: item.score ?? 0, tier: {}, headline: `Đã thích bạn ${timeAgo(item.liked_at)} trước`, positives: [], considerations: [] } }, {
        onOpen: (id) => go(`#/profile/${id}`),
        onLike: (id) => reactTo(id, 'like', likedMeScreen),
        onPass: (id) => reactTo(id, 'pass', likedMeScreen),
      }));
    }
  }
  mount(topBar('Đã thích bạn', { onBack: () => go('#/matches') }), body);
}

/* =========================================================== TRÒ CHUYỆN === */

export async function chatListScreen() {
  mount(topBar('Trò chuyện'), el('div.screen', {}, [spinner()]), nav('chat', badges));
  const { matches } = await api('/social/matches');
  const withChat = matches.filter((m) => m.conversation_id);
  const body = el('div.screen');

  if (!withChat.length) {
    body.append(emptyState('💬', 'Chưa có cuộc trò chuyện nào',
      'Bạn chỉ nhắn tin được khi hai người cùng thích nhau.',
      el('button.btn.primary.sm', { text: 'Tìm người phù hợp', onclick: () => go('#/discover') })));
  } else {
    const card = el('div.card');
    for (const m of withChat) {
      card.append(
        el('div.list-item', { onclick: () => go(`#/chat/${m.conversation_id}`) }, [
          el('img.avatar', { src: photoOf(m.profile), alt: '' }),
          el('div.txt', {}, [
            el('div.nm', { text: m.profile?.display_name ?? 'Người dùng' }),
            el('div.pv', {
              text: m.last_message
                ? `${m.last_message.from_me ? 'Bạn: ' : ''}${m.last_message.body}`
                : `💡 ${m.icebreaker ?? 'Hãy gửi lời chào đầu tiên'}`,
              style: m.unread ? { color: 'var(--text)', fontWeight: '600' } : {},
            }),
          ]),
          el('div.rt', {}, [
            el('div', { text: timeAgo(m.last_message?.created_at ?? m.matched_at) }),
            m.unread ? el('span.unread', { text: String(m.unread) }) : null,
          ]),
        ])
      );
    }
    body.append(card);
  }
  mount(topBar('Trò chuyện'), body, nav('chat', badges));
}

export async function chatScreen(conversationId) {
  const [detail, { messages }] = await Promise.all([
    api(`/social/conversations/${conversationId}`),
    api(`/social/conversations/${conversationId}/messages`),
  ]);
  api(`/social/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {});

  const list = el('div.chat-body');
  const p = detail.profile;

  const renderMessages = (msgs) => {
    list.replaceChildren();
    if (detail.highlights?.length) {
      list.append(
        el('div.ice', {}, [
          el('div.h', { text: 'Hai bạn đều' }),
          ...detail.highlights.map((h) => el('div.q', { text: `✓ ${h}` })),
        ])
      );
    }
    if (detail.icebreaker && !msgs.length) {
      list.append(
        el('div.ice', {}, [
          el('div.h', { text: 'Một chủ đề để bắt đầu' }),
          el('div.q', { text: `"${detail.icebreaker}"` }),
          el('button.btn.sm', {
            text: '🔄 Gợi ý khác',
            style: { marginTop: '8px' },
            onclick: async () => {
              const r = await api(`/social/conversations/${conversationId}/icebreaker`, { method: 'POST' });
              detail.icebreaker = r.icebreaker;
              renderMessages(msgs);
            },
          }),
        ])
      );
    }
    for (const m of msgs) {
      if (m.warning) {
        list.append(el('div.msg-warn', {}, [el('span', { text: '⚠️' }), el('span', { text: m.warning })]));
      }
      list.append(
        el(`div.bubble.${m.from_me ? 'me' : 'them'}`, {}, [
          el('span', { text: m.body }),
          el('span.time', { text: clockOf(m.created_at) }),
        ])
      );
    }
    requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  };

  const input = el('input', { type: 'text', placeholder: 'Nhắn gì đó...', maxlength: 2000 });
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const { message } = await api(`/social/conversations/${conversationId}/messages`, {
        method: 'POST', body: { body: text },
      });
      messages.push(message);
      renderMessages(messages);
    } catch (err) {
      input.value = text;
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  // Nhận tin nhắn mới theo thời gian thực.
  window.__onChatMessage = (payload) => {
    if (Number(payload.conversation_id) !== Number(conversationId)) return;
    messages.push(payload.message);
    renderMessages(messages);
    api(`/social/conversations/${conversationId}/read`, { method: 'POST' }).catch(() => {});
  };

  renderMessages(messages);

  mount(
    el('div.chat-wrap', {}, [
      topBar(p?.display_name ?? 'Trò chuyện', {
        onBack: () => { window.__onChatMessage = null; go('#/chat'); },
        right: el('button.back', { text: '⋮', onclick: () => chatMoreSheet(detail, conversationId) }),
      }),
      list,
      detail.can_send
        ? el('div.chat-input', {}, [input, el('button', { text: '➤', 'aria-label': 'Gửi', onclick: send })])
        : el('div.note.warn', { style: { margin: '12px' }, text: 'Cuộc trò chuyện này đã kết thúc.' }),
    ])
  );
  input.focus();
}

function chatMoreSheet(detail, conversationId) {
  const p = detail.profile;
  sheet('Tuỳ chọn', (close) =>
    frag(
      el('button.btn.block', { text: '👤 Xem hồ sơ', style: { marginBottom: '10px' },
        onclick: () => { close(); go(`#/profile/${p.user_id}`); } }),
      el('button.btn.block', { text: '🛡️ Lời khuyên an toàn', style: { marginBottom: '10px' },
        onclick: async () => {
          close();
          const { tips } = await api('/social/safety-tips');
          sheet('Giữ an toàn khi hẹn hò', el('ul', { style: { paddingLeft: '18px', color: 'var(--text-2)' } },
            tips.map((t) => el('li', { text: t, style: { marginBottom: '8px' } }))));
        } }),
      el('button.btn.block', { text: '🚩 Báo cáo', style: { marginBottom: '10px' },
        onclick: () => { close(); reportSheet(p); } }),
      el('button.btn.block.danger', { text: '💔 Gỡ kết nối', style: { marginBottom: '10px' },
        onclick: () => {
          close();
          confirmSheet('Gỡ kết nối', 'Cuộc trò chuyện sẽ đóng lại và hai bạn không còn thấy nhau trong danh sách kết đôi.',
            'Gỡ kết nối', async () => {
              await api(`/social/matches/${detail.match_id}`, { method: 'DELETE' });
              toast('Đã gỡ kết nối.');
              go('#/matches');
            }, { danger: true });
        } }),
      el('button.btn.block.danger', { text: '🚫 Chặn người này',
        onclick: () => {
          close();
          confirmSheet('Chặn người dùng', `${p.display_name} sẽ không còn liên hệ được với bạn.`, 'Chặn',
            async () => {
              await api('/social/block', { method: 'POST', body: { user_id: p.user_id } });
              toast('Đã chặn.');
              go('#/matches');
            }, { danger: true });
        } })
    )
  );
}
