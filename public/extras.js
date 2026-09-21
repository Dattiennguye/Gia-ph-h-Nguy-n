/* ===========================================================================
   Bản đồ người quanh bạn · AI Matchmaker · Premium · Xác minh · Thông báo
   =========================================================================== */
import {
  api, el, frag, mount, store, toast, sheet, confirmSheet, spinner, timeAgo, money, photoOf,
} from './lib.js';
import { topBar, emptyState, textField } from './components.js';

const go = (h) => { location.hash = h; };

/* ========================================================= BẢN ĐỒ QUANH BẠN === */

export async function nearbyScreen() {
  mount(topBar('Người phù hợp quanh bạn', { onBack: () => go('#/discover') }), el('div.screen.no-nav', {}, [spinner()]));

  let radius = Number(sessionStorage.getItem('vigo_map_radius')) || 10;
  const data = await api(`/discovery/nearby?radius_km=${radius}`);

  if (data.needs === 'location') {
    return mount(
      topBar('Người phù hợp quanh bạn', { onBack: () => go('#/discover') }),
      el('div.screen.no-nav', {}, [
        emptyState('📍', 'Chưa có khu vực', 'Hãy chọn khu vực sinh sống trước.',
          el('button.btn.primary.sm', { text: 'Chọn khu vực', onclick: () => go('#/profile/edit') })),
      ])
    );
  }

  const canvas = el('canvas', { width: 720, height: 720 });
  const box = el('div.mapbox', {}, [canvas]);

  mount(
    topBar('Người phù hợp quanh bạn', { onBack: () => go('#/discover') }),
    el('div.screen.no-nav', {}, [
      el('div.note', {
        text: 'Mỗi chấm là một người phù hợp. Vị trí đã được làm mờ có chủ đích — bạn thấy được mật độ khu vực, không thấy được địa chỉ của ai.',
      }),
      box,
      el('div.map-legend', {}, [
        el('span', {}, [el('i', { style: { background: 'var(--brand)' } }), 'Rất phù hợp']),
        el('span', {}, [el('i', { style: { background: '#e0846b' } }), 'Phù hợp cao']),
        el('span', {}, [el('i', { style: { background: '#c9a227' } }), 'Khá phù hợp']),
        el('span', {}, [el('i', { style: { background: 'var(--text-3)' } }), 'Có thể thử']),
      ]),
      el('div.chips', { style: { marginTop: '14px' } },
        [1, 5, 10, 20, 30, 50].filter((r) => r <= data.max_radius_km).map((r) =>
          el('button.chip', {
            type: 'button', class: r === data.radius_km ? 'on' : '', text: `${r} km`,
            onclick: () => { sessionStorage.setItem('vigo_map_radius', r); nearbyScreen(); },
          })
        )),
      el('p.muted', { style: { marginTop: '12px' }, text: `${data.total} người phù hợp trong bán kính ${data.radius_km} km quanh ${data.center.area ?? 'khu vực của bạn'}.` }),

      el('div.card', { style: { marginTop: '10px' } },
        data.points.slice(0, 20).map((pt) =>
          el('div.list-item', { onclick: () => go(`#/profile/${pt.user_id}`) }, [
            el('div', {
              style: {
                width: '11px', height: '11px', borderRadius: '50%', flex: 'none',
                background: colorFor(pt.tier),
              },
            }),
            el('div.txt', {}, [
              el('div.nm', { text: pt.display_name }),
              el('div.pv', { text: `${pt.area ?? ''} · cách bạn khoảng ${pt.distance_km} km` }),
            ]),
            el('div.rt', { text: '›', style: { fontSize: '1.2rem' } }),
          ])
        )),
    ])
  );

  drawMap(canvas, data);
}

const colorFor = (tier) =>
  ({ excellent: '#c8385a', high: '#e0846b', medium: '#c9a227' })[tier] ?? '#9a8b83';

/**
 * Vẽ bản đồ radar đơn giản bằng canvas: các vòng tròn bán kính và các chấm
 * người dùng đã làm mờ vị trí. Không tải bản đồ nền từ bên ngoài — tránh gửi
 * toạ độ của người dùng tới bất kỳ dịch vụ thứ ba nào.
 */
function drawMap(canvas, data) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const C = W / 2;
  const R = C - 24;
  const styles = getComputedStyle(document.body);
  const border = styles.getPropertyValue('--border').trim() || '#e8ddd6';
  const text3 = styles.getPropertyValue('--text-3').trim() || '#9a8b83';
  const surface = styles.getPropertyValue('--surface-2').trim() || '#f5efeb';

  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, W, W);

  // Vòng bán kính
  const rings = 4;
  ctx.font = '20px system-ui, sans-serif';
  for (let i = 1; i <= rings; i += 1) {
    const r = (R * i) / rings;
    ctx.beginPath();
    ctx.arc(C, C, r, 0, Math.PI * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = text3;
    ctx.fillText(`${((data.radius_km * i) / rings).toFixed(0)} km`, C + 6, C - r + 22);
  }

  // Quy đổi độ → pixel, cùng tỉ lệ cho cả hai trục.
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((data.center.lat * Math.PI) / 180);
  const scale = R / data.radius_km;

  for (const pt of data.points) {
    const dx = (pt.lng - data.center.lng) * kmPerDegLng * scale;
    const dy = -(pt.lat - data.center.lat) * kmPerDegLat * scale;
    const dist = Math.hypot(dx, dy);
    const clamp = dist > R ? R / dist : 1;
    const x = C + dx * clamp;
    const y = C + dy * clamp;

    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = colorFor(pt.tier);
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(x, y, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Vị trí của bạn (cũng chỉ là trung tâm khu vực đã khai).
  ctx.beginPath();
  ctx.arc(C, C, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#2a211d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(C, C, 20, 0, Math.PI * 2);
  ctx.strokeStyle = '#2a211d';
  ctx.lineWidth = 3;
  ctx.stroke();
}

/* =========================================================== AI MATCHMAKER === */

export async function matchmakerScreen() {
  mount(topBar('AI Matchmaker', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const r = await api('/discovery/matchmaker');

  if (!r.ready) {
    return mount(
      topBar('AI Matchmaker', { onBack: () => go('#/me') }),
      el('div.screen.no-nav', {}, [
        emptyState('📍', 'Chưa đủ dữ liệu', r.message,
          el('button.btn.primary.sm', { text: 'Hoàn thiện hồ sơ', onclick: () => go('#/profile/edit') })),
      ])
    );
  }

  const applyAction = async (action) => {
    if (action.type === 'set_radius') {
      await api('/profile/preference', { method: 'PATCH', body: { max_distance_km: action.value } });
      toast(`Đã đổi bán kính thành ${action.value} km.`);
      matchmakerScreen();
    } else if (action.type === 'set_age_range') {
      await api('/profile/preference', { method: 'PATCH', body: action.value });
      toast('Đã cập nhật khoảng tuổi.');
      matchmakerScreen();
    } else if (action.type === 'soften_rule') {
      confirmSheet('Bỏ tiêu chí bắt buộc',
        'Tiêu chí này sẽ được gỡ khỏi danh sách bắt buộc. Bạn có thể thêm lại bất cứ lúc nào.',
        'Gỡ tiêu chí', async () => {
          await api(`/profile/preference/rules/${action.ruleId}`, { method: 'DELETE' });
          toast('Đã gỡ tiêu chí.');
          matchmakerScreen();
        });
    } else if (action.type === 'complete_profile') {
      go('#/profile/edit');
    } else {
      go('#/preference');
    }
  };

  const actionLabel = (a) =>
    ({
      set_radius: `Đổi thành ${a.value} km`,
      set_age_range: `Nới thành ${a.value?.age_min}–${a.value?.age_max}`,
      soften_rule: 'Gỡ tiêu chí này',
      complete_profile: 'Hoàn thiện hồ sơ',
      review_filters: 'Xem lại bộ lọc',
      review_preferences: 'Xem lại nhu cầu',
      improve_profile: 'Cải thiện hồ sơ',
      suggest_rule: 'Xem nhu cầu',
    })[a?.type] ?? 'Xem chi tiết';

  mount(
    topBar('AI Matchmaker', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      el('p.muted', { text: 'Mọi con số dưới đây đến từ kho hồ sơ đang có thật trong hệ thống. Chúng tôi chỉ phân tích — quyết định vẫn là của bạn.' }),

      el('div.stat-grid', { style: { marginBottom: '16px' } }, [
        el('div.stat', {}, [el('b', { text: String(r.pool.total_nearby) }), el('span', { text: 'Hồ sơ quanh bạn' })]),
        el('div.stat', {}, [el('b', { text: String(r.pool.matching_your_filters) }), el('span', { text: 'Lọt bộ lọc' })]),
        el('div.stat', {}, [el('b', { text: `${r.profile.completeness}%` }), el('span', { text: 'Hồ sơ đầy đủ' })]),
      ]),

      r.narrative && el('div.note.ok', { text: r.narrative }),

      el('div.section-title', {}, [el('h3', { text: 'Nhận định' })]),
      ...(r.insights.length
        ? r.insights.map((i) =>
            el(`div.insight.${i.severity}`, {}, [
              el('b', { text: i.title }),
              el('p', { text: i.body }),
              i.action && el('button.btn.sm', { text: actionLabel(i.action), onclick: () => applyAction(i.action) }),
            ])
          )
        : [el('p.muted', { text: 'Bộ tiêu chí của bạn đang khá cân bằng. Không có gì cần điều chỉnh lúc này.' })]),

      r.hidden_insights > 0 &&
        el('div.card', {}, [
          el('div.pad.center', {}, [
            el('div', { text: '💎', style: { fontSize: '1.8rem' } }),
            el('b', { text: `Còn ${r.hidden_insights} nhận định nữa` }),
            el('p.muted', { text: 'Premium mở toàn bộ phân tích, kể cả mức độ ảnh hưởng của từng tiêu chí.' }),
            el('button.btn.primary.sm', { text: 'Xem gói Premium', onclick: () => go('#/premium') }),
          ]),
        ]),

      r.rule_impact?.length &&
        frag(
          el('div.section-title', {}, [el('h3', { text: 'Tiêu chí bắt buộc đang loại bao nhiêu hồ sơ?' })]),
          el('div.card', {}, [
            el('div.pad', {},
              r.rule_impact.map((x) =>
                el('div', { style: { marginBottom: '12px' } }, [
                  el('div', { style: { display: 'flex', gap: '8px', fontSize: '.9rem' } }, [
                    el('span', { text: x.text }),
                    el('span', { style: { marginLeft: 'auto', fontWeight: '700' }, text: `−${x.excludedPct}%` }),
                  ]),
                  el('div.meter', { style: { marginTop: '4px' } }, [el('i', { style: { width: `${Math.min(100, x.excludedPct)}%` } })]),
                ])
              )),
          ])
        ),

      el('div.section-title', {}, [el('h3', { text: 'Hành vi của bạn' })]),
      el('div.card', {}, [
        el('div.pad', {}, [
          el('p', { text: `Bạn đã gửi ${r.behaviour.likes_sent} lượt thích và có ${r.behaviour.matches} lượt kết đôi${r.behaviour.match_rate != null ? ` (tỷ lệ ${r.behaviour.match_rate}%)` : ''}.` }),
          r.behaviour.avg_liked_score != null &&
            el('p.muted', { text: `Điểm phù hợp trung bình của những người bạn thích: ${r.behaviour.avg_liked_score}/100.` }),
        ].filter(Boolean)),
      ]),

      el('div.section-title', {}, [el('h3', { text: 'Thử thay đổi' })]),
      simulator(),

      el('p.muted', { style: { marginTop: '18px' }, text: r.ai.note }),
    ])
  );
}

function simulator() {
  const out = el('div.note', { text: 'Chọn một thay đổi để xem số người phù hợp thay đổi thế nào.' });
  const try_ = async (body, describe) => {
    const r = await api('/discovery/matchmaker/simulate', { method: 'POST', body });
    out.className = `note ${r.delta > 0 ? 'ok' : r.delta < 0 ? 'warn' : ''}`;
    out.textContent = `${describe}: ${r.before} → ${r.after} hồ sơ. ${r.message}`;
  };

  return el('div.card', {}, [
    el('div.pad', {}, [
      out,
      el('div.chips', {}, [
        el('button.chip', { type: 'button', text: 'Bán kính 30 km', onclick: () => try_({ max_distance_km: 30 }, 'Bán kính 30 km') }),
        el('button.chip', { type: 'button', text: 'Bán kính 50 km', onclick: () => try_({ max_distance_km: 50 }, 'Bán kính 50 km') }),
        el('button.chip', { type: 'button', text: 'Nới tuổi ±5', onclick: async () => {
          const { preference } = await api('/profile/preference');
          try_({ age_min: Math.max(18, preference.age_min - 5), age_max: preference.age_max + 5 }, 'Nới khoảng tuổi ±5');
        } }),
      ]),
      el('p.muted', { style: { marginTop: '10px', marginBottom: 0 }, text: 'Thử nghiệm này không thay đổi nhu cầu của bạn — chỉ tính trước kết quả.' }),
    ]),
  ]);
}

/* ================================================================ PREMIUM === */

export async function premiumScreen() {
  mount(topBar('Vigo Premium', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const plans = await api('/billing/plans');

  const buy = async (productId, name) => {
    confirmSheet('Xác nhận', `Bạn sắp mua "${name}".`, 'Tiếp tục', async () => {
      const res = await api('/billing/checkout', { method: 'POST', body: { product: productId } });
      if (res.status === 'paid') {
        toast('Thanh toán thành công. Quyền lợi đã được kích hoạt.');
        premiumScreen();
      } else {
        sheet('Hướng dẫn thanh toán', frag(
          el('p', { text: res.instructions?.note ?? 'Vui lòng chuyển khoản theo thông tin dưới đây.' }),
          el('div.card', {}, [el('div.pad', {}, [
            el('div', { text: `Số tiền: ${money(res.amount_vnd)}` }),
            el('div', { text: `Tài khoản: ${res.instructions?.bank_account ?? '—'}` }),
            el('div', { text: `Nội dung: ${res.instructions?.transfer_note ?? res.provider_ref}` }),
          ])]),
          el('p.muted', { text: 'Giao dịch sẽ được kích hoạt sau khi đối soát.' })
        ));
      }
    });
  };

  mount(
    topBar('Vigo Premium', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      el('div.note', { text: plans.note }),

      plans.current.premium &&
        el('div.note.ok', { text: `Bạn đang dùng Premium${plans.current.expires_at ? `, hết hạn ${new Date(plans.current.expires_at).toLocaleDateString('vi-VN')}` : ''}.` }),

      el('div.card', {}, [
        el('div.pad', {}, [
          el('h3', { text: 'Premium có gì' }),
          el('ul', { style: { paddingLeft: '18px', color: 'var(--text-2)', margin: 0 } },
            plans.benefits.map((b) => el('li', { text: b, style: { marginBottom: '6px' } }))),
        ]),
      ]),

      el('div.section-title', {}, [el('h3', { text: 'Chọn gói' })]),
      ...Object.values(plans.products).filter((p) => p.kind === 'subscription').map((p) =>
        el('div.card', {}, [
          el('div.pad', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            el('div', { style: { flex: 1 } }, [
              el('b', { text: p.name }),
              el('div.muted', { text: `${money(Math.round(p.amount_vnd / (p.days / 30)))}/tháng` }),
            ]),
            el('button.btn.primary.sm', { text: money(p.amount_vnd), onclick: () => buy(p.id, p.name) }),
          ]),
        ])
      ),

      el('div.section-title', {}, [el('h3', { text: 'Khác' })]),
      ...Object.values(plans.products).filter((p) => p.kind === 'boost').map((p) =>
        el('div.card', {}, [
          el('div.pad', { style: { display: 'flex', alignItems: 'center', gap: '12px' } }, [
            el('div', { style: { flex: 1 } }, [
              el('b', { text: `⚡ ${p.name}` }),
              el('div.muted', { text: 'Hồ sơ của bạn được ưu tiên hiển thị trong khu vực.' }),
            ]),
            el('button.btn.sm', { text: money(p.amount_vnd), onclick: () => buy(p.id, p.name) }),
          ]),
        ])
      ),

      el('p.muted.center', { style: { marginTop: '16px' },
        text: 'Chúng tôi không bán quyền tiếp cận người khác. Nhắn tin và ghép đôi luôn miễn phí.' }),
    ])
  );
}

export async function paymentsScreen() {
  mount(topBar('Lịch sử thanh toán', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const { payments } = await api('/billing/payments');
  mount(
    topBar('Lịch sử thanh toán', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      payments.length
        ? el('div.card', {}, payments.map((p) =>
            el('div.list-item', {}, [
              el('div.txt', {}, [
                el('div.nm', { text: p.product }),
                el('div.pv', { text: `${new Date(p.created_at).toLocaleString('vi-VN')} · ${p.provider_ref}` }),
              ]),
              el('div.rt', {}, [
                el('div', { text: money(p.amount_vnd), style: { fontWeight: '600', color: 'var(--text)' } }),
                el('div', { text: { paid: 'Đã thanh toán', pending: 'Chờ xác nhận', failed: 'Thất bại', refunded: 'Đã hoàn' }[p.status] }),
              ]),
            ])
          ))
        : emptyState('💳', 'Chưa có giao dịch nào', 'Các khoản thanh toán của bạn sẽ hiện ở đây.'),
    ])
  );
}

/* =============================================================== XÁC MINH === */

export async function verifyScreen() {
  mount(topBar('Xác minh danh tính', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const v = await api('/verification');

  const statusText = (s) =>
    ({ approved: '✓ Đã xác minh', pending: '⏳ Đang chờ duyệt', rejected: '✕ Chưa được chấp nhận', none: 'Chưa xác minh' })[s] ?? s;

  const card = (icon, title, desc, state, action) =>
    el('div.card', {}, [
      el('div.pad', {}, [
        el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' } }, [
          el('div', { text: icon, style: { fontSize: '1.6rem' } }),
          el('div', { style: { flex: 1 } }, [
            el('b', { text: title }),
            el('div.muted', { text: statusText(state) }),
          ]),
        ]),
        el('p.muted', { text: desc }),
        state !== 'approved' && state !== 'pending' && action,
      ].filter(Boolean)),
    ]);

  mount(
    topBar('Xác minh danh tính', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      el('div.note', { text: 'Huy hiệu xác minh giúp người khác tin tưởng bạn hơn. Thông tin giấy tờ được mã hoá và không bao giờ hiển thị với bất kỳ người dùng nào.' }),

      card('🟢', 'Số điện thoại', 'Bắt buộc để sử dụng các tính năng xã hội.', v.phone.status,
        el('button.btn.sm', { text: 'Xác minh ngay', onclick: () => go('#/verify-phone') })),

      card('🔵', 'Khuôn mặt', 'Chụp một ảnh selfie theo tư thế ngẫu nhiên do hệ thống yêu cầu — để chắc chắn bạn là người thật.', v.photo.status,
        el('button.btn.sm', { text: 'Bắt đầu', onclick: photoVerifyFlow })),

      card('🟣', 'Giấy tờ tuỳ thân', 'Mức xác minh cao nhất. Chỉ hiển thị huy hiệu "Đã xác minh danh tính" — số giấy tờ không bao giờ lộ ra.', v.identity.status,
        el('button.btn.sm', { text: 'Gửi giấy tờ', onclick: identityFlow })),
    ])
  );
}

function photoVerifyFlow() {
  api('/verification/photo/challenge', { method: 'POST' }).then((ch) => {
    let photoUrl = null;
    sheet('Xác minh khuôn mặt', (close) =>
      frag(
        el('div.note', { text: `Tư thế của bạn: ${ch.pose}` }),
        el('p.muted', { text: 'Chụp một ảnh selfie đúng tư thế trên. Ảnh này chỉ dùng để xác minh, không hiển thị trên hồ sơ.' }),
        el('label.btn.block', { style: { cursor: 'pointer', marginBottom: '12px' } }, [
          'Chọn ảnh',
          el('input', {
            type: 'file', accept: 'image/*', capture: 'user', style: { display: 'none' },
            onchange: (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 1_500_000) return toast('Ảnh tối đa 1.5MB.', true);
              const r = new FileReader();
              r.onload = () => { photoUrl = r.result; toast('Đã chọn ảnh.'); };
              r.readAsDataURL(f);
            },
          }),
        ]),
        el('button.btn.primary.block', {
          text: 'Gửi xác minh',
          onclick: async () => {
            if (!photoUrl) return toast('Hãy chọn ảnh trước.', true);
            const res = await api('/verification/photo', { method: 'POST', body: { photo_url: photoUrl } });
            close();
            toast(res.message);
            verifyScreen();
          },
        })
      )
    );
  });
}

function identityFlow() {
  const form = { document_type: 'cccd', document_number: '', full_name: '', document_url: null };
  sheet('Xác minh giấy tờ', (close) =>
    frag(
      el('div.note', { text: 'Dữ liệu giấy tờ được mã hoá AES-256 và chỉ dùng để đối chiếu. Người dùng khác chỉ thấy huy hiệu "Đã xác minh danh tính".' }),
      el('label.field', {}, [
        el('span', { text: 'Loại giấy tờ' }),
        el('select', { onchange: (e) => (form.document_type = e.target.value) }, [
          el('option', { value: 'cccd', text: 'Căn cước công dân' }),
          el('option', { value: 'passport', text: 'Hộ chiếu' }),
          el('option', { value: 'driver_license', text: 'Giấy phép lái xe' }),
        ]),
      ]),
      textField('Họ và tên trên giấy tờ', '', (v) => (form.full_name = v)),
      textField('Số giấy tờ', '', (v) => (form.document_number = v)),
      el('button.btn.primary.block', {
        text: 'Gửi xác minh',
        onclick: async () => {
          const res = await api('/verification/identity', { method: 'POST', body: form });
          close();
          toast(res.message);
          verifyScreen();
        },
      })
    )
  );
}

/* ============================================================== KHÁC === */

export async function notificationsScreen() {
  mount(topBar('Thông báo', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const { notifications } = await api('/social/notifications');
  api('/social/notifications/read', { method: 'POST', body: {} }).catch(() => {});

  const icon = (k) => ({ match: '💞', message: '💬', superlike: '⭐', verification: '🛡️', moderation: '⚠️', billing: '💎' })[k] ?? '🔔';

  mount(
    topBar('Thông báo', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      notifications.length
        ? el('div.card', {}, notifications.map((n) =>
            el('div.list-item', {
              style: n.read_at ? {} : { background: 'var(--brand-soft)' },
              onclick: () => {
                if (n.data?.conversation_id) go(`#/chat/${n.data.conversation_id}`);
                else if (n.data?.from_user || n.data?.user_id) go(`#/profile/${n.data.from_user ?? n.data.user_id}`);
              },
            }, [
              el('div', { text: icon(n.kind), style: { fontSize: '1.4rem', width: '34px', textAlign: 'center' } }),
              el('div.txt', {}, [el('div.nm', { text: n.title }), el('div.pv', { text: n.body })]),
              el('div.rt', { text: timeAgo(n.created_at) }),
            ])
          ))
        : emptyState('🔔', 'Chưa có thông báo', 'Khi có người thích bạn hoặc nhắn tin, bạn sẽ thấy ở đây.'),
    ])
  );
}

export async function blockedScreen() {
  mount(topBar('Đã chặn', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const { blocked } = await api('/social/blocked');
  mount(
    topBar('Đã chặn', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      blocked.length
        ? el('div.card', {}, blocked.map((b) =>
            el('div.list-item', {}, [
              el('div.txt', {}, [
                el('div.nm', { text: b.display_name }),
                el('div.pv', { text: `Chặn ${timeAgo(b.created_at)} trước` }),
              ]),
              el('button.btn.sm', {
                text: 'Bỏ chặn',
                onclick: async () => {
                  await api(`/social/block/${b.user_id}`, { method: 'DELETE' });
                  toast('Đã bỏ chặn.');
                  blockedScreen();
                },
              }),
            ])
          ))
        : emptyState('🚫', 'Chưa chặn ai', 'Danh sách những người bạn đã chặn sẽ hiện ở đây.'),
    ])
  );
}
