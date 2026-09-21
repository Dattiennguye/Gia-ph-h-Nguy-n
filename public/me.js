/* ===========================================================================
   Tab "Tôi": hồ sơ, nhu cầu, tiêu chí, xác minh, gói dịch vụ, cài đặt.
   Cùng với bản đồ và AI Matchmaker.
   =========================================================================== */
import {
  api, el, frag, mount, store, toast, sheet, confirmSheet, spinner, money, options, label, photoOf,
} from './lib.js';
import { topBar, navBar, chipGroup, selectField, textField, emptyState } from './components.js';

const go = (h) => { location.hash = h; };
const nav = (c, b) => navBar(c, b, (k) => go(`#/${k}`));

/* ================================================================= TÔI === */

export async function meScreen(badges = {}) {
  mount(topBar('Tôi'), el('div.screen', {}, [spinner()]), nav('me', badges));
  const o = await api('/profile/overview');
  const p = o.profile;

  const row = (icon, title, sub, onclick, right) =>
    el('div.list-item', { onclick }, [
      el('div', { text: icon, style: { fontSize: '1.35rem', width: '34px', textAlign: 'center' } }),
      el('div.txt', {}, [el('div.nm', { text: title }), sub && el('div.pv', { text: sub })]),
      el('div.rt', { text: right ?? '›', style: { fontSize: right ? '.8rem' : '1.3rem' } }),
    ]);

  const badgeText = [
    o.verification.phone.status === 'approved' && '🟢 SĐT',
    o.verification.photo.status === 'approved' && '🔵 Ảnh',
    o.verification.identity.status === 'approved' && '🟣 Danh tính',
  ].filter(Boolean).join(' · ') || 'Chưa xác minh';

  mount(
    topBar('Tôi'),
    el('div.screen', {}, [
      el('div.card', {}, [
        el('div.pad', { style: { display: 'flex', gap: '14px', alignItems: 'center' } }, [
          el('img.avatar', { src: photoOf(p), alt: '', style: { width: '66px', height: '66px' } }),
          el('div', { style: { flex: 1, minWidth: 0 } }, [
            el('h3', { text: `${p.display_name}${p.age ? `, ${p.age}` : ''}`, style: { marginBottom: '2px' } }),
            el('div.muted', { text: p.region?.full_name ?? 'Chưa chọn khu vực' }),
            el('div.muted', { text: badgeText, style: { marginTop: '2px' } }),
          ]),
        ]),
        el('div.pad', { style: { paddingTop: 0 } }, [
          el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' } }, [
            el('small.muted', { text: 'Độ hoàn thiện hồ sơ' }),
            el('small', { text: `${p.completeness}%`, style: { marginLeft: 'auto', fontWeight: '700' } }),
          ]),
          el('div.meter', {}, [el('i', { style: { width: `${p.completeness}%` } })]),
        ]),
      ]),

      el('div.stat-grid', { style: { marginBottom: '14px' } }, [
        el('div.stat', {}, [el('b', { text: String(o.stats.likes_sent) }), el('span', { text: 'Đã thích' })]),
        el('div.stat', {}, [el('b', { text: String(o.stats.likes_received) }), el('span', { text: 'Được thích' })]),
        el('div.stat', {}, [el('b', { text: String(o.stats.matches) }), el('span', { text: 'Kết đôi' })]),
      ]),

      o.entitlements.premium
        ? el('div.note.ok', { text: `Bạn đang dùng Vigo Premium${o.entitlements.expires_at ? ` — tới ${new Date(o.entitlements.expires_at).toLocaleDateString('vi-VN')}` : ''}.` })
        : el('div.card', { onclick: () => go('#/premium'), style: { cursor: 'pointer' } }, [
            el('div.pad', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [
              el('div', { text: '💎', style: { fontSize: '1.7rem' } }),
              el('div', { style: { flex: 1 } }, [
                el('b', { text: 'Vigo Premium' }),
                el('div.muted', { text: 'Xem ai đã thích bạn, mở rộng bán kính, AI Matchmaker đầy đủ' }),
              ]),
              el('div', { text: '›', style: { fontSize: '1.3rem', color: 'var(--text-3)' } }),
            ]),
          ]),

      el('div.section-title', {}, [el('h3', { text: 'Hồ sơ & nhu cầu' })]),
      el('div.card', {}, [
        row('📝', 'Chỉnh sửa hồ sơ', 'Thông tin, ảnh, quan điểm sống', () => go('#/profile/edit')),
        row('🎯', 'Nhu cầu của tôi', `${o.rules.filter((r) => r.kind === 'must').length} tiêu chí bắt buộc · ${o.rules.filter((r) => r.kind === 'prefer').length} ưu tiên`, () => go('#/preference')),
        row('🤖', 'AI Matchmaker', 'Phân tích bộ tiêu chí của bạn', () => go('#/matchmaker')),
      ]),

      el('div.section-title', {}, [el('h3', { text: 'An toàn' })]),
      el('div.card', {}, [
        row('🛡️', 'Xác minh danh tính', badgeText, () => go('#/verify')),
        row('🚫', 'Danh sách đã chặn', null, () => go('#/blocked')),
        row('💡', 'Lời khuyên an toàn', null, async () => {
          const { tips } = await api('/social/safety-tips');
          sheet('Giữ an toàn khi hẹn hò', el('ul', { style: { paddingLeft: '18px', color: 'var(--text-2)' } },
            tips.map((t) => el('li', { text: t, style: { marginBottom: '8px' } }))));
        }),
      ]),

      el('div.section-title', {}, [el('h3', { text: 'Tài khoản' })]),
      el('div.card', {}, [
        row('👁️', 'Hiển thị hồ sơ', p.visibility === 'public' ? 'Đang hiển thị công khai' : 'Đang ẩn', () => visibilitySheet(p)),
        row('🔔', 'Thông báo', null, () => go('#/notifications')),
        row('💳', 'Lịch sử thanh toán', null, () => go('#/payments')),
        store.user?.role !== 'user' ? row('🛠️', 'Trang quản trị', 'Dành cho quản trị viên', () => { location.href = '/admin.html'; }) : null,
        row('🚪', 'Đăng xuất', null, () => {
          confirmSheet('Đăng xuất', 'Bạn có chắc muốn đăng xuất khỏi thiết bị này?', 'Đăng xuất', async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => {});
            store.setToken(null);
            store.user = null;
            go('#/welcome');
          });
        }),
      ].filter(Boolean)),

      el('p.muted.center', { style: { marginTop: '18px' }, text: 'Vigo Match · Tìm người phù hợp để xây dựng cuộc sống' }),
    ]),
    nav('me', badges)
  );
}

function visibilitySheet(p) {
  sheet('Hiển thị hồ sơ', (close) =>
    frag(
      ...[
        ['public', 'Công khai', 'Hồ sơ của bạn xuất hiện trong kết quả tìm kiếm của người khác.'],
        ['hidden', 'Ẩn', 'Không ai tìm thấy bạn. Các kết nối hiện có vẫn giữ nguyên.'],
      ].map(([value, title, desc]) =>
        el('button.btn.block', {
          style: { marginBottom: '10px', textAlign: 'left', justifyContent: 'flex-start', height: 'auto', padding: '12px 16px', flexDirection: 'column', alignItems: 'flex-start' },
          class: p.visibility === value ? 'primary' : '',
          onclick: async () => {
            await api('/profile', { method: 'PATCH', body: { visibility: value } });
            close();
            toast('Đã cập nhật.');
            meScreen();
          },
        }, [el('b', { text: title }), el('small', { text: desc, style: { fontWeight: 400, opacity: .8 } })])
      )
    )
  );
}

/* ====================================================== CHỈNH SỬA HỒ SƠ === */

export async function editProfileScreen() {
  mount(topBar('Chỉnh sửa hồ sơ', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const p = await api('/profile').then((r) => r.profile);
  const patch = {};
  const set = (k) => (v) => { patch[k] = v; };

  let provinces = (await api('/meta/regions')).regions;
  let districts = p.region?.path?.[1] ? (await api(`/meta/regions?parent_id=${p.region.path[1].id}`)).regions : [];
  let wards = p.region?.path?.[2] ? (await api(`/meta/regions?parent_id=${p.region.path[2].id}`)).regions : [];

  const regionBox = el('div');
  const renderRegion = () => {
    const cur = p.region?.path ?? [];
    regionBox.replaceChildren(
      el('label.field', {}, [
        el('span', { text: 'Tỉnh / Thành phố' }),
        el('select', {
          onchange: async (e) => {
            patch.region_id = Number(e.target.value) || null;
            districts = e.target.value ? (await api(`/meta/regions?parent_id=${e.target.value}`)).regions : [];
            wards = [];
            p.region = { path: [null, { id: Number(e.target.value) }] };
            renderRegion();
          },
        }, [
          el('option', { value: '', text: '— Chọn —' }),
          ...provinces.map((x) => el('option', { value: x.id, text: x.name, selected: cur[1]?.id === x.id })),
        ]),
      ]),
      districts.length && el('label.field', {}, [
        el('span', { text: 'Quận / Huyện' }),
        el('select', {
          onchange: async (e) => {
            if (e.target.value) patch.region_id = Number(e.target.value);
            wards = e.target.value ? (await api(`/meta/regions?parent_id=${e.target.value}`)).regions : [];
            renderRegion();
          },
        }, [
          el('option', { value: '', text: '— Chọn —' }),
          ...districts.map((x) => el('option', { value: x.id, text: x.name, selected: cur[2]?.id === x.id })),
        ]),
      ]),
      wards.length && el('label.field', {}, [
        el('span', { text: 'Xã / Phường (tuỳ chọn)' }),
        el('select', {
          onchange: (e) => { if (e.target.value) patch.region_id = Number(e.target.value); },
        }, [
          el('option', { value: '', text: '— Không chọn —' }),
          ...wards.map((x) => el('option', { value: x.id, text: x.name, selected: cur[3]?.id === x.id })),
        ]),
      ])
    );
  };
  renderRegion();

  const save = async () => {
    if (!Object.keys(patch).length) return go('#/me');
    await api('/profile', { method: 'PATCH', body: patch });
    toast('Đã lưu hồ sơ.');
    go('#/me');
  };

  mount(
    topBar('Chỉnh sửa hồ sơ', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      el('div.section-title', {}, [el('h3', { text: 'Ảnh' })]),
      photoManager(p),

      el('div.section-title', {}, [el('h3', { text: 'Cơ bản' })]),
      textField('Tên hiển thị', p.display_name, set('display_name')),
      textField('Ngày sinh', p.birth_date, set('birth_date'), { type: 'date' }),
      el('label.field', {}, [
        el('span', { text: 'Giới tính' }),
        chipGroup('gender', p.gender ? [p.gender] : [], (v) => (patch.gender = v[v.length - 1] ?? null), { max: 1 }),
      ]),
      regionBox,
      textField('Giới thiệu bản thân', p.bio, set('bio'), { multiline: true, placeholder: 'Vài dòng về bạn...' }),

      el('div.section-title', {}, [el('h3', { text: 'Ngoại hình & nghề nghiệp' })]),
      textField('Chiều cao (cm)', p.height_cm, (v) => (patch.height_cm = v ? Number(v) : null), { type: 'number', min: 130, max: 220 }),
      selectField('Dáng người', 'body_type', p.body_type, set('body_type')),
      textField('Nghề nghiệp', p.occupation, set('occupation')),
      selectField('Học vấn', 'education', p.education, set('education')),
      selectField('Thu nhập (tuỳ chọn)', 'income_range', p.income_range, set('income_range')),

      el('div.section-title', {}, [el('h3', { text: 'Quan điểm sống' })]),
      selectField('Mục đích tìm kiếm', 'relationship_goal', p.relationship_goal, set('relationship_goal')),
      el('label.field', {}, [
        el('span', { text: 'Mức độ nghiêm túc' }),
        el('input', {
          type: 'range', min: 1, max: 5, value: p.seriousness ?? 3,
          oninput: (e) => {
            patch.seriousness = Number(e.target.value);
            e.target.nextElementSibling.textContent = label('seriousness', e.target.value);
          },
        }),
        el('div.muted', { text: label('seriousness', p.seriousness ?? 3) }),
      ]),
      selectField('Tình trạng hôn nhân', 'marital_status', p.marital_status, set('marital_status')),
      selectField('Con riêng', 'has_children', p.has_children, set('has_children')),
      selectField('Dự định kết hôn', 'marriage_timeline', p.marriage_timeline, set('marriage_timeline')),
      selectField('Mong muốn có con', 'children_wish', p.children_wish, set('children_wish')),
      selectField('Nơi ở sau khi kết hôn', 'living_preference', p.living_preference, set('living_preference')),
      selectField('Tôn giáo (tuỳ chọn)', 'religion', p.religion, set('religion')),
      selectField('Hút thuốc', 'smoking', p.smoking, set('smoking')),
      selectField('Uống rượu bia', 'drinking', p.drinking, set('drinking')),

      el('div.section-title', {}, [el('h3', { text: 'Lối sống & sở thích' })]),
      el('label.field', {}, [
        el('span', { text: 'Lối sống — tối đa 8' }),
        chipGroup('lifestyle', p.lifestyle_tags, (v) => (patch.lifestyle_tags = v), { max: 8 }),
      ]),
      el('label.field', {}, [
        el('span', { text: 'Sở thích — tối đa 8' }),
        chipGroup('interests', p.interest_tags, (v) => (patch.interest_tags = v), { max: 8 }),
      ]),

      el('button.btn.primary.block', { text: 'Lưu hồ sơ', onclick: save }),
    ])
  );
}

function photoManager(p) {
  const box = el('div.card');
  const render = async () => {
    const fresh = await api('/profile').then((r) => r.profile);
    box.replaceChildren(
      el('div.pad', {}, [
        el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          fresh.photos.map((ph) =>
            el('div', { style: { position: 'relative' } }, [
              el('img', { src: ph.url, alt: '', style: { width: '78px', height: '98px', objectFit: 'cover', borderRadius: '10px' } }),
              el('button', {
                text: '×',
                style: { position: 'absolute', top: '-6px', right: '-6px', width: '22px', height: '22px', borderRadius: '50%', border: 0, background: 'var(--danger)', color: '#fff', cursor: 'pointer' },
                onclick: async () => { await api(`/profile/photos/${ph.id}`, { method: 'DELETE' }); render(); },
              }),
              !ph.is_primary && el('button', {
                text: '★',
                title: 'Đặt làm ảnh chính',
                style: { position: 'absolute', bottom: '4px', left: '4px', border: 0, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '.7rem', padding: '2px 5px' },
                onclick: async () => { await api(`/profile/photos/${ph.id}/primary`, { method: 'POST' }); render(); },
              }),
            ])
          )
        ),
        el('label.btn.sm', {
          style: { marginTop: '12px', display: 'inline-flex', cursor: 'pointer' },
        }, [
          'Thêm ảnh',
          el('input', {
            type: 'file', accept: 'image/*', style: { display: 'none' },
            onchange: async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 1_500_000) return toast('Ảnh tối đa 1.5MB.', true);
              const reader = new FileReader();
              reader.onload = async () => {
                await api('/profile/photos', { method: 'POST', body: { url: reader.result } });
                render();
              };
              reader.readAsDataURL(file);
            },
          }),
        ]),
      ])
    );
  };
  render();
  return box;
}

/* ============================================================== NHU CẦU === */

export async function preferenceScreen() {
  mount(topBar('Nhu cầu của tôi', { onBack: () => go('#/me') }), el('div.screen.no-nav', {}, [spinner()]));
  const { preference: pref, rules } = await api('/profile/preference');
  const ent = await api('/billing/entitlements');

  const patch = {};
  const save = async () => {
    if (Object.keys(patch).length) await api('/profile/preference', { method: 'PATCH', body: patch });
    toast('Đã lưu nhu cầu.');
    preferenceScreen();
  };

  const ruleList = (kind) => {
    const items = rules.filter((r) => r.kind === kind);
    if (!items.length) {
      return el('p.muted', { text: kind === 'must' ? 'Chưa có tiêu chí bắt buộc nào.' : 'Chưa có tiêu chí ưu tiên nào.' });
    }
    return frag(...items.map((r) =>
      el(`div.rule.${kind}`, {}, [
        el('span.kind', { text: kind === 'must' ? 'BẮT BUỘC' : 'ƯU TIÊN' }),
        el('span.txt', { text: describeRule(r) }),
        el('button.x', {
          text: '×',
          onclick: async () => {
            await api(`/profile/preference/rules/${r.id}`, { method: 'DELETE' });
            preferenceScreen();
          },
        }),
      ])
    ));
  };

  mount(
    topBar('Nhu cầu của tôi', { onBack: () => go('#/me') }),
    el('div.screen.no-nav', {}, [
      el('div.note', { text: 'Đây là nơi bạn mô tả người bạn muốn tìm. Càng rõ ràng, chúng tôi càng giới thiệu đúng.' }),

      el('div.card', {}, [
        el('div.pad', {}, [
          el('h3', { text: 'Cơ bản' }),
          el('label.field', {}, [
            el('span', { text: 'Tôi muốn tìm' }),
            chipGroup('gender', pref.interested_in, (v) => (patch.interested_in = v)),
          ]),
          el('label.field', {}, [
            el('span', { text: 'Mục đích' }),
            chipGroup('relationship_goal', pref.relationship_goals, (v) => (patch.relationship_goals = v)),
          ]),
          el('div.row', {}, [
            textField('Tuổi từ', pref.age_min, (v) => (patch.age_min = Number(v)), { type: 'number', min: 18, max: 99 }),
            textField('Đến', pref.age_max, (v) => (patch.age_max = Number(v)), { type: 'number', min: 18, max: 99 }),
          ]),
          el('label.field', {}, [
            el('span', { text: `Bán kính tìm kiếm — tối đa ${ent.max_radius_km} km với gói ${ent.plan}` }),
            el('div.chips', {}, [1, 5, 10, 20, 30, 50, 100, 200].filter((r) => r <= ent.max_radius_km).map((r) =>
              el('button.chip', {
                type: 'button',
                class: r === pref.max_distance_km ? 'on' : '',
                text: `${r} km`,
                onclick: (e) => {
                  patch.max_distance_km = r;
                  e.target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
                  e.target.classList.add('on');
                },
              })
            )),
          ]),
          el('button.btn.primary.block', { text: 'Lưu', onclick: save }),
        ]),
      ]),

      el('div.section-title', {}, [el('h3', { text: 'Tiêu chí bắt buộc' })]),
      el('p.muted', { text: 'Người không đáp ứng sẽ KHÔNG xuất hiện trong kết quả của bạn. Dùng ít thôi — mỗi tiêu chí đều thu hẹp kho hồ sơ.' }),
      ruleList('must'),
      el('button.btn.sm', { text: '+ Thêm tiêu chí bắt buộc', onclick: () => addRuleSheet('must') }),

      el('div.section-title', {}, [el('h3', { text: 'Tiêu chí ưu tiên' })]),
      el('p.muted', { text: 'Người không đáp ứng vẫn xuất hiện, chỉ là điểm phù hợp thấp hơn.' }),
      ruleList('prefer'),
      el('button.btn.sm', { text: '+ Thêm tiêu chí ưu tiên', onclick: () => addRuleSheet('prefer') }),

      el('hr.sep'),
      el('button.btn.block', { text: '🤖 Xem AI Matchmaker phân tích bộ tiêu chí này', onclick: () => go('#/matchmaker') }),
    ])
  );
}

/** Mô tả một luật bằng tiếng Việt ở phía client. */
function describeRule(r) {
  const meta = store.meta?.rule_fields?.[r.field] ?? { label: r.field };
  const val = (v) => (meta.source ? label(meta.source, v) : String(v));
  const arr = Array.isArray(r.value) ? r.value : [r.value];
  switch (r.operator) {
    case 'eq': return `${meta.label}: ${val(r.value)}`;
    case 'neq': return `${meta.label}: không phải ${val(r.value)}`;
    case 'in': return `${meta.label}: ${arr.map(val).join(' hoặc ')}`;
    case 'not_in': return `${meta.label}: không thuộc ${arr.map(val).join(', ')}`;
    case 'gte': return `${meta.label}: từ ${val(r.value)} trở lên`;
    case 'lte': return `${meta.label}: tối đa ${val(r.value)}`;
    case 'between': return `${meta.label}: từ ${arr[0]} đến ${arr[1]}`;
    case 'contains_any': return `${meta.label}: ${arr.map(val).join(' / ')}`;
    case 'contains_all': return `${meta.label}: có đủ ${arr.map(val).join(', ')}`;
    default: return meta.label;
  }
}

function addRuleSheet(kind) {
  const fields = store.meta?.rule_fields ?? {};
  let field = null;
  const box = el('div');

  const renderValue = () => {
    const meta = fields[field];
    box.replaceChildren();
    if (!meta) return;

    if (meta.type === 'enum') {
      let chosen = [];
      box.append(
        el('label.field', {}, [
          el('span', { text: `Chấp nhận giá trị nào? (chọn một hoặc nhiều)` }),
          chipGroup(meta.source, [], (v) => (chosen = v)),
        ]),
        submitBtn(() => ({
          operator: chosen.length > 1 ? 'in' : 'eq',
          value: chosen.length > 1 ? chosen : chosen[0],
        }), () => chosen.length > 0)
      );
    } else if (meta.type === 'tags') {
      let chosen = [];
      box.append(
        el('label.field', {}, [
          el('span', { text: 'Có ít nhất một trong các mục sau' }),
          chipGroup(meta.source, [], (v) => (chosen = v)),
        ]),
        submitBtn(() => ({ operator: 'contains_any', value: chosen }), () => chosen.length > 0)
      );
    } else if (meta.type === 'number') {
      let lo = meta.min;
      let hi = meta.max;
      box.append(
        el('div.row', {}, [
          textField('Từ', lo, (v) => (lo = Number(v)), { type: 'number' }),
          textField('Đến', hi, (v) => (hi = Number(v)), { type: 'number' }),
        ]),
        submitBtn(() => ({ operator: 'between', value: [lo, hi] }), () => Number.isFinite(lo) && Number.isFinite(hi))
      );
    } else if (meta.type === 'bool') {
      box.append(submitBtn(() => ({ operator: 'eq', value: true }), () => true, 'Yêu cầu đã xác minh danh tính'));
    }
  };

  const submitBtn = (build, valid, text = 'Thêm tiêu chí') =>
    el('button.btn.primary.block', {
      text,
      onclick: async () => {
        if (!valid()) return toast('Hãy chọn ít nhất một giá trị.', true);
        const { operator, value } = build();
        await api('/profile/preference/rules', { method: 'POST', body: { kind, field, operator, value, weight: kind === 'must' ? 5 : 3 } });
        document.querySelector('.sheet-bg')?.remove();
        toast('Đã thêm tiêu chí.');
        preferenceScreen();
      },
    });

  sheet(kind === 'must' ? 'Thêm tiêu chí bắt buộc' : 'Thêm tiêu chí ưu tiên', () =>
    frag(
      el('p.muted', {
        text: kind === 'must'
          ? 'Người không đáp ứng sẽ bị loại hoàn toàn khỏi kết quả của bạn.'
          : 'Người không đáp ứng vẫn xuất hiện, chỉ là xếp sau.',
      }),
      el('label.field', {}, [
        el('span', { text: 'Tiêu chí về' }),
        el('select', {
          onchange: (e) => { field = e.target.value || null; renderValue(); },
        }, [
          el('option', { value: '', text: '— Chọn —' }),
          ...Object.entries(fields).map(([k, m]) => el('option', { value: k, text: m.label })),
        ]),
      ]),
      box
    )
  );
}
