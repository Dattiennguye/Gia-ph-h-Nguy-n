/* ===========================================================================
   Cổng quản trị: số liệu, người dùng, kiểm duyệt, xác minh, khu vực, nhật ký.
   =========================================================================== */
import { api, el, frag, mount, store, toast, sheet, confirmSheet, spinner, timeAgo, money } from './lib.js';
import { textField } from './components.js';

let tab = 'dashboard';

const TABS = [
  ['dashboard', '📊 Tổng quan'],
  ['cases', '🛡️ Kiểm duyệt'],
  ['reports', '🚩 Báo cáo'],
  ['users', '👥 Người dùng'],
  ['verifications', '✅ Xác minh'],
  ['regions', '🗺️ Khu vực'],
  ['audit', '📜 Nhật ký'],
];

function shell(...content) {
  mount(
    el('header.admin-head', {}, [
      el('h1', { text: '🛠️ Vigo Match — Quản trị' }),
      el('span.muted', { text: store.user ? `${store.user.email} · ${store.user.role}` : '' }),
      el('button.btn.sm', { text: 'Về ứng dụng', onclick: () => (location.href = '/') }),
    ]),
    el('div.tabs', {}, TABS.map(([key, text]) =>
      el('button', { class: tab === key ? 'on' : '', text, onclick: () => { tab = key; render(); } })
    )),
    ...content
  );
}

async function render() {
  shell(spinner());
  try {
    const view = await {
      dashboard: dashboardView,
      users: usersView,
      cases: casesView,
      reports: reportsView,
      verifications: verificationsView,
      regions: regionsView,
      audit: auditView,
    }[tab]();
    shell(view);
  } catch (err) {
    shell(el('div.note.danger', { text: err.message }));
  }
}

/* ------------------------------------------------------------- tổng quan */

async function dashboardView() {
  const [d, { series }] = await Promise.all([api('/admin/dashboard'), api('/admin/timeseries?days=14')]);

  const box = (value, labelText, alert = false) =>
    el('div.box', { class: alert && value > 0 ? 'alert' : '' }, [
      el('b', { text: typeof value === 'number' ? value.toLocaleString('vi-VN') : String(value) }),
      el('span', { text: labelText }),
    ]);

  const chart = (key, title, color) => {
    const max = Math.max(1, ...series.map((s) => s[key]));
    return el('div.card', {}, [
      el('div.pad', {}, [
        el('h3', { text: title }),
        el('div.chart', {}, series.map((s) =>
          el('div.bar', {
            style: { height: `${(s[key] / max) * 100}%`, background: color },
            title: `${s.date}: ${s[key]}`,
          })
        )),
        el('div', { style: { display: 'flex', justifyContent: 'space-between' } }, [
          el('small.muted', { text: series[0]?.date }),
          el('small.muted', { text: `cao nhất: ${max}` }),
          el('small.muted', { text: series.at(-1)?.date }),
        ]),
      ]),
    ]);
  };

  return frag(
    el('h3', { text: 'Người dùng' }),
    el('div.kpi', {}, [
      box(d.users.total, 'Tổng người dùng'),
      box(d.users.active_today, 'Hoạt động hôm nay'),
      box(d.users.new_today, 'Đăng ký hôm nay'),
      box(d.users.online_now, 'Đang trực tuyến'),
      box(d.users.suspended, 'Tạm khoá', true),
      box(d.users.banned, 'Khoá vĩnh viễn', true),
    ]),

    el('h3', { text: 'Tương tác' }),
    el('div.kpi', {}, [
      box(d.engagement.likes_today, 'Lượt thích hôm nay'),
      box(d.engagement.matches_total, 'Tổng kết đôi'),
      box(d.engagement.matches_today, 'Kết đôi hôm nay'),
      box(d.engagement.messages_today, 'Tin nhắn hôm nay'),
      box(d.engagement.conversations_active, 'Trò chuyện đang hoạt động'),
    ]),

    el('h3', { text: 'An toàn' }),
    el('div.kpi', {}, [
      box(d.safety.reports_open, 'Báo cáo chờ xử lý', true),
      box(d.safety.cases_open, 'Ca kiểm duyệt mở', true),
      box(d.safety.cases_high, 'Ca rủi ro cao', true),
      box(d.safety.messages_blocked_week, 'Tin bị gắn cờ (7 ngày)'),
      box(d.safety.verifications_pending, 'Xác minh chờ duyệt'),
    ]),

    el('h3', { text: 'Kinh doanh' }),
    el('div.kpi', {}, [
      box(d.business.premium_active, 'Premium đang hoạt động'),
      box(money(d.business.revenue_month_vnd), 'Doanh thu 30 ngày'),
      box(d.business.payments_pending, 'Giao dịch chờ xác nhận'),
    ]),

    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '14px' } }, [
      chart('new_users', 'Người dùng mới (14 ngày)', 'var(--brand)'),
      chart('matches', 'Kết đôi (14 ngày)', 'var(--accent)'),
      chart('messages', 'Tin nhắn (14 ngày)', '#7a6cc8'),
      chart('reports', 'Báo cáo (14 ngày)', 'var(--warn)'),
    ])
  );
}

/* ------------------------------------------------------------ người dùng */

let userFilter = { q: '', status: '' };

async function usersView() {
  const qs = new URLSearchParams();
  if (userFilter.q) qs.set('q', userFilter.q);
  if (userFilter.status) qs.set('status', userFilter.status);
  const { users } = await api(`/admin/users?${qs}`);

  return frag(
    el('div.toolbar', {}, [
      el('input', {
        type: 'text', placeholder: 'Tìm theo tên, email, số điện thoại...', value: userFilter.q,
        onkeydown: (e) => { if (e.key === 'Enter') { userFilter.q = e.target.value; render(); } },
      }),
      el('select', { onchange: (e) => { userFilter.status = e.target.value; render(); } }, [
        el('option', { value: '', text: 'Mọi trạng thái' }),
        ...['active', 'suspended', 'banned', 'pending'].map((s) =>
          el('option', { value: s, text: s, selected: userFilter.status === s })),
      ]),
    ]),

    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['ID', 'Tên', 'Liên hệ', 'Khu vực', 'Trạng thái', 'Rủi ro', 'Báo cáo', 'Kết đôi', 'Hoạt động', ''].map((h) => el('th', { text: h })))]),
      el('tbody', {}, users.map((u) =>
        el('tr', {}, [
          el('td', { text: String(u.id) }),
          el('td', {}, [el('b', { text: u.display_name ?? '—' }), el('div.muted', { text: `${u.completeness ?? 0}% hoàn thiện` })]),
          el('td', {}, [el('div', { text: u.email ?? '—' }), el('div.muted', { text: u.phone ?? '' })]),
          el('td', { text: u.area ?? '—' }),
          el('td', {}, [el(`span.pill.${u.status}`, { text: u.status })]),
          el('td', { text: String(u.risk_score) }),
          el('td', { text: String(u.reports) }),
          el('td', { text: String(u.matches) }),
          el('td', { text: u.last_active_at ? `${timeAgo(u.last_active_at)} trước` : '—' }),
          el('td', {}, [el('button.btn.sm', { text: 'Chi tiết', onclick: () => userSheet(u.id) })]),
        ])
      )),
    ])
  );
}

async function userSheet(userId) {
  const d = await api(`/admin/users/${userId}`);
  const u = d.user;

  sheet(`${d.profile?.display_name ?? 'Người dùng'} · #${u.id}`, (close) =>
    frag(
      el('div.kpi', {}, [
        el('div.box', {}, [el('b', { text: String(d.stats.likes_sent) }), el('span', { text: 'Đã thích' })]),
        el('div.box', {}, [el('b', { text: String(d.stats.likes_received) }), el('span', { text: 'Được thích' })]),
        el('div.box', {}, [el('b', { text: String(d.stats.matches) }), el('span', { text: 'Kết đôi' })]),
        el('div.box', {}, [el('b', { text: String(d.stats.messages_sent) }), el('span', { text: 'Tin nhắn' })]),
      ]),

      el('p', {}, [
        el('b', { text: 'Trạng thái: ' }),
        el(`span.pill.${u.status}`, { text: u.status }),
        u.status_reason && el('div.muted', { text: u.status_reason }),
      ]),
      el('p.muted', { text: `Đăng ký ${new Date(u.created_at).toLocaleString('vi-VN')} · Điểm rủi ro ${u.risk_score}` }),

      el('h3', { text: 'Xác minh' }),
      el('div.taglist', {}, d.verifications.length
        ? d.verifications.map((v) => el('span.tag', { text: `${v.type}: ${v.status}` }))
        : [el('span.muted', { text: 'Chưa có xác minh nào' })]),
      el('p.muted', { style: { marginTop: '8px' }, text: 'Nội dung giấy tờ được mã hoá và không hiển thị ở đây — quản trị viên chỉ thấy trạng thái.' }),

      d.reports_against.length && frag(
        el('h3', { text: `Báo cáo về người này (${d.reports_against.length})` }),
        el('table', {}, [
          el('tbody', {}, d.reports_against.map((r) =>
            el('tr', {}, [
              el('td', { text: r.category }),
              el('td', { text: r.detail ?? '' }),
              el('td', { text: r.status }),
            ])
          )),
        ])
      ),

      el('h3', { style: { marginTop: '16px' }, text: 'Hành động' }),
      el('div.toolbar', {}, [
        u.status !== 'active' && el('button.btn.sm', {
          text: '✓ Mở lại tài khoản',
          onclick: () => act(userId, 'active', 'Mở lại tài khoản', close),
        }),
        u.status !== 'suspended' && el('button.btn.sm', {
          text: '⏸ Tạm khoá',
          onclick: () => act(userId, 'suspended', 'Tạm khoá tài khoản', close),
        }),
        u.status !== 'banned' && el('button.btn.sm.danger', {
          text: '⛔ Khoá vĩnh viễn',
          onclick: () => act(userId, 'banned', 'Khoá vĩnh viễn', close),
        }),
        store.user?.role === 'admin' && el('button.btn.sm', {
          text: '💎 Tặng Premium 30 ngày',
          onclick: async () => {
            await api(`/admin/users/${userId}/grant-premium`, { method: 'POST', body: { days: 30 } });
            toast('Đã kích hoạt Premium 30 ngày.');
            close();
          },
        }),
      ].filter(Boolean))
    )
  );
}

function act(userId, status, title, close) {
  let reason = '';
  sheet(title, (c2) =>
    frag(
      textField('Lý do (hiển thị cho người dùng)', '', (v) => (reason = v), { multiline: true }),
      el('button.btn.primary.block', {
        text: 'Xác nhận',
        onclick: async () => {
          await api(`/admin/users/${userId}/status`, { method: 'POST', body: { status, reason } });
          c2(); close();
          toast('Đã cập nhật trạng thái.');
          render();
        },
      })
    )
  );
}

/* -------------------------------------------------------------- kiểm duyệt */

let caseFilter = 'open';

async function casesView() {
  const { cases } = await api(`/admin/cases?status=${caseFilter}`);

  return frag(
    el('div.toolbar', {}, ['open', 'reviewing', 'actioned', 'dismissed', 'all'].map((s) =>
      el('button.btn.sm', { class: caseFilter === s ? 'primary' : '', text: s, onclick: () => { caseFilter = s; render(); } })
    )),
    el('p.muted', { text: 'Ca rủi ro cao đã được tự động tạm khoá tài khoản và đang chờ người kiểm duyệt xem xét.' }),

    cases.length
      ? el('table', {}, [
          el('thead', {}, [el('tr', {}, ['#', 'Người dùng', 'Rủi ro', 'Nguồn', 'Dấu hiệu', 'Báo cáo', 'Tạo lúc', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, cases.map((c) =>
            el('tr', {}, [
              el('td', { text: String(c.id) }),
              el('td', {}, [el('b', { text: c.display_name ?? `#${c.target_id}` }), el('div', {}, [el(`span.pill.${c.user_status}`, { text: c.user_status })])]),
              el('td', {}, [el(`span.pill.${c.risk}`, { text: c.risk })]),
              el('td', { text: c.source }),
              el('td', { text: c.signals.join(' · ') }),
              el('td', { text: String(c.report_count) }),
              el('td', { text: `${timeAgo(c.created_at)} trước` }),
              el('td', {}, [el('button.btn.sm', { text: 'Xử lý', onclick: () => caseSheet(c.id) })]),
            ])
          )),
        ])
      : el('div.empty', {}, [el('span.ic', { text: '✅' }), el('p', { text: 'Không có ca nào trong bộ lọc này.' })])
  );
}

async function caseSheet(caseId) {
  const c = await api(`/admin/cases/${caseId}`);
  let note = '';

  sheet(`Ca kiểm duyệt #${c.id}`, (close) =>
    frag(
      el('p', {}, [el(`span.pill.${c.risk}`, { text: `Rủi ro ${c.risk}` }), ' ', el('span.muted', { text: `nguồn: ${c.source}` })]),
      el('h3', { text: 'Dấu hiệu' }),
      el('ul', {}, c.signals.map((s) => el('li', { text: s }))),

      c.reports.length && frag(
        el('h3', { text: 'Báo cáo liên quan' }),
        el('table', {}, [el('tbody', {}, c.reports.map((r) =>
          el('tr', {}, [
            el('td', { text: r.category }),
            el('td', { text: r.detail ?? '' }),
            el('td', { text: r.reporter_name ?? `#${r.reporter_id}` }),
          ])
        ))])
      ),

      c.safety_events.length && frag(
        el('h3', { text: 'Sự kiện an toàn' }),
        el('table', {}, [el('tbody', {}, c.safety_events.map((e) =>
          el('tr', {}, [
            el('td', { text: e.kind }),
            el('td', { text: `mức ${e.severity}` }),
            el('td', { text: (e.detail.flags ?? []).join(', ') }),
            el('td', { text: `${timeAgo(e.created_at)} trước` }),
          ])
        ))])
      ),

      el('h3', { style: { marginTop: '16px' }, text: 'Quyết định' }),
      textField('Ghi chú (lưu vào nhật ký, và gửi cho người dùng nếu là cảnh cáo)', '', (v) => (note = v), { multiline: true }),
      el('div.toolbar', {},
        [
          ['dismiss', 'Bỏ qua — không vi phạm'],
          ['warn', 'Cảnh cáo'],
          ['suspend', 'Tạm khoá'],
          ['ban', 'Khoá vĩnh viễn'],
          ['reinstate', 'Khôi phục tài khoản'],
        ].map(([action, text]) =>
          el('button.btn.sm', {
            class: action === 'ban' ? 'danger' : '',
            text,
            onclick: async () => {
              await api(`/admin/cases/${caseId}/resolve`, { method: 'POST', body: { action, note } });
              close();
              toast('Đã xử lý ca kiểm duyệt.');
              render();
            },
          })
        )),
      el('p.muted', { text: 'Mọi quyết định đều được ghi vào nhật ký kiểm toán kèm người thực hiện và thời điểm.' })
    )
  );
}

async function reportsView() {
  const { reports } = await api('/admin/reports?status=all');
  return frag(
    el('p.muted', { text: 'Toàn bộ báo cáo từ người dùng. Mỗi báo cáo đều tạo hoặc gộp vào một ca kiểm duyệt.' }),
    reports.length
      ? el('table', {}, [
          el('thead', {}, [el('tr', {}, ['#', 'Người bị báo cáo', 'Người báo cáo', 'Loại', 'Mô tả', 'Trạng thái', 'Lúc'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, reports.map((r) =>
            el('tr', {}, [
              el('td', { text: String(r.id) }),
              el('td', {}, [el('button.btn.sm', { text: r.target_name ?? `#${r.target_id}`, onclick: () => userSheet(r.target_id) })]),
              el('td', { text: r.reporter_name ?? `#${r.reporter_id}` }),
              el('td', { text: r.category }),
              el('td', { text: r.detail ?? '' }),
              el('td', { text: r.status }),
              el('td', { text: `${timeAgo(r.created_at)} trước` }),
            ])
          )),
        ])
      : el('div.empty', {}, [el('span.ic', { text: '✅' }), el('p', { text: 'Chưa có báo cáo nào.' })])
  );
}

/* ---------------------------------------------------------------- xác minh */

async function verificationsView() {
  const { pending } = await api('/admin/verifications');
  const review = async (id, approve) => {
    let note = '';
    if (!approve) {
      sheet('Từ chối xác minh', (close) =>
        frag(
          textField('Lý do', '', (v) => (note = v), { multiline: true }),
          el('button.btn.primary.block', {
            text: 'Gửi',
            onclick: async () => {
              await api(`/admin/verifications/${id}/review`, { method: 'POST', body: { approve: false, note } });
              close(); toast('Đã từ chối.'); render();
            },
          })
        ));
      return;
    }
    await api(`/admin/verifications/${id}/review`, { method: 'POST', body: { approve: true } });
    toast('Đã duyệt.');
    render();
  };

  return frag(
    el('div.note', { text: 'Ảnh selfie và giấy tờ được lưu mã hoá. Ở môi trường thật, giao diện duyệt cần kênh riêng có kiểm soát truy cập chặt hơn — đây là hàng đợi và quyết định.' }),
    pending.length
      ? el('table', {}, [
          el('thead', {}, [el('tr', {}, ['#', 'Người dùng', 'Loại', 'Gửi lúc', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, pending.map((v) =>
            el('tr', {}, [
              el('td', { text: String(v.id) }),
              el('td', {}, [el('button.btn.sm', { text: v.display_name ?? `#${v.user_id}`, onclick: () => userSheet(v.user_id) })]),
              el('td', { text: v.type }),
              el('td', { text: `${timeAgo(v.created_at)} trước` }),
              el('td', {}, [
                el('button.btn.sm', { text: '✓ Duyệt', onclick: () => review(v.id, true) }),
                ' ',
                el('button.btn.sm.danger', { text: '✕ Từ chối', onclick: () => review(v.id, false) }),
              ]),
            ])
          )),
        ])
      : el('div.empty', {}, [el('span.ic', { text: '✅' }), el('p', { text: 'Không có yêu cầu xác minh nào đang chờ.' })])
  );
}

/* ----------------------------------------------------------------- khu vực */

async function regionsView() {
  const { regions } = await api('/admin/regions/density?limit=30');

  const ratioHint = (r) => {
    if (r.gender_ratio == null) return 'chưa đủ dữ liệu';
    if (r.gender_ratio > 2) return '⚠ lệch nhiều về nam';
    if (r.gender_ratio < 0.5) return '⚠ lệch nhiều về nữ';
    return 'cân đối';
  };

  return frag(
    el('div.note', { text: 'Mật độ và tỷ lệ giới tính quyết định trải nghiệm. Chỉ nên mở đăng ký ở khu vực đã đủ dày — đây là công cụ kiểm soát bài toán "con gà và quả trứng".' }),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Tỉnh/Thành', 'Người dùng', 'Nam', 'Nữ', 'Tỷ lệ nam/nữ', 'Đánh giá', 'Đăng ký'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, regions.map((r) =>
        el('tr', {}, [
          el('td', { text: r.name }),
          el('td', { text: String(r.users) }),
          el('td', { text: String(r.male ?? 0) }),
          el('td', { text: String(r.female ?? 0) }),
          el('td', { text: r.gender_ratio == null ? '—' : String(r.gender_ratio) }),
          el('td', { text: ratioHint(r) }),
          el('td', {}, [
            el('button.btn.sm', {
              class: r.signup_open ? '' : 'danger',
              text: r.signup_open ? 'Đang mở' : 'Đang đóng',
              onclick: async () => {
                await api(`/admin/regions/${r.id}/signup`, { method: 'POST', body: { open: !r.signup_open } });
                toast(r.signup_open ? 'Đã đóng đăng ký khu vực này.' : 'Đã mở đăng ký khu vực này.');
                render();
              },
            }),
          ]),
        ])
      )),
    ])
  );
}

/* ---------------------------------------------------------------- nhật ký */

async function auditView() {
  const { logs } = await api('/admin/audit?limit=200');
  return frag(
    el('p.muted', { text: 'Nhật ký chỉ ghi thêm, không sửa được từ giao diện.' }),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Thời điểm', 'Hành động', 'Người thực hiện', 'Đối tượng', 'Chi tiết', 'IP'].map((h) => el('th', { text: h })))]),
      el('tbody', {}, logs.map((l) =>
        el('tr', {}, [
          el('td', { text: new Date(l.created_at).toLocaleString('vi-VN') }),
          el('td', { text: l.action }),
          el('td', { text: l.actor_id ? `#${l.actor_id} ${l.actor_role ?? ''}` : 'hệ thống' }),
          el('td', { text: l.target_type ? `${l.target_type}#${l.target_id}` : '—' }),
          el('td', { text: l.detail && l.detail !== '{}' ? l.detail : '' }),
          el('td', { text: l.ip ?? '' }),
        ])
      )),
    ])
  );
}

/* ------------------------------------------------------------------ khởi động */

(async function boot() {
  if (!store.token) {
    mount(el('div.screen.no-nav', {}, [
      el('div.note.danger', { text: 'Bạn cần đăng nhập bằng tài khoản quản trị.' }),
      el('button.btn.primary.block', { text: 'Tới trang đăng nhập', onclick: () => (location.href = '/#/login') }),
    ]));
    return;
  }
  try {
    store.meta = await api('/meta/taxonomy');
    store.taxonomy = store.meta.taxonomy;
    const { user } = await api('/auth/me');
    store.user = user;
    if (!['admin', 'moderator'].includes(user.role)) {
      mount(el('div.screen.no-nav', {}, [
        el('div.note.danger', { text: 'Tài khoản này không có quyền truy cập trang quản trị.' }),
        el('button.btn.block', { text: 'Về ứng dụng', onclick: () => (location.href = '/') }),
      ]));
      return;
    }
    await render();
  } catch (err) {
    mount(el('div.screen.no-nav', {}, [el('div.note.danger', { text: err.message })]));
  }
})();
