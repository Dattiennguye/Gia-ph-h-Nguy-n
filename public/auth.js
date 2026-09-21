/* ===========================================================================
   Đăng ký, đăng nhập, xác minh số điện thoại và các bước tạo hồ sơ ban đầu.
   =========================================================================== */
import { api, el, frag, mount, store, toast, options } from './lib.js';
import { topBar, chipGroup, selectField, textField } from './components.js';

const go = (hash) => {
  location.hash = hash;
};

/* ------------------------------------------------------------ màn hình chào */

export function welcomeScreen() {
  mount(
    el('div.welcome', {}, [
      el('div.logo', { text: '💞' }),
      el('h1', { text: 'Vigo Match' }),
      el('p.tagline', { text: 'Tìm người phù hợp để xây dựng cuộc sống — không chỉ tìm người để chat.' }),

      el('div.pillars', {}, [
        ['📍', 'Gần bạn', 'Tìm theo bán kính thật, từ 1 km tới 200 km.'],
        ['🎯', 'Đúng nhu cầu', 'Tiêu chí bắt buộc và tiêu chí ưu tiên, tách bạch rõ ràng.'],
        ['❤️', 'Phù hợp lâu dài', 'Chúng tôi nói rõ vì sao hai bạn hợp, và chỗ nào cần cân nhắc.'],
      ].map(([e, t, d]) =>
        el('div.pillar', {}, [
          el('span.e', { text: e }),
          el('div', {}, [el('b', { text: t }), el('span', { text: d })]),
        ])
      )),

      el('button.btn.primary.block', { text: 'Tạo tài khoản', onclick: () => go('#/register') }),
      el('div', { style: { height: '10px' } }),
      el('button.btn.block', { text: 'Tôi đã có tài khoản', onclick: () => go('#/login') }),

      el('p.muted.center', {
        style: { marginTop: '22px' },
        text: 'Bạn cần đủ 18 tuổi và xác minh số điện thoại để sử dụng Vigo Match.',
      }),
    ])
  );
}

/* ------------------------------------------------------------------ đăng ký */

export function registerScreen() {
  const form = { method: 'phone', display_name: '', phone: '', email: '', password: '' };

  const body = el('div');
  const render = () => {
    body.replaceChildren(
      form.method === 'phone'
        ? textField('Số điện thoại', form.phone, (v) => (form.phone = v), {
            type: 'tel',
            placeholder: '0912345678',
          })
        : textField('Email', form.email, (v) => (form.email = v), {
            type: 'email',
            placeholder: 'ban@example.com',
          }),
      textField('Mật khẩu', form.password, (v) => (form.password = v), {
        type: 'password',
        placeholder: 'Ít nhất 8 ký tự, có cả chữ và số',
      })
    );
  };
  render();

  const submit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await api('/auth/register', { method: 'POST', body: { ...form } });
      store.setToken(res.token);
      store.user = res.user;
      if (res.code) toast(`Mã xác minh (chế độ thử nghiệm): ${res.code}`);
      go(res.next === 'verify_phone' ? '#/verify-phone' : '#/onboarding/goal');
    } catch {
      btn.disabled = false;
    }
  };

  mount(
    topBar('Tạo tài khoản', { onBack: () => go('#/welcome') }),
    el('div.screen.no-nav', {}, [
      el('form', { onsubmit: submit }, [
        el('div.chips', { style: { marginBottom: '16px' } }, [
          el('button.chip.on', {
            type: 'button',
            text: '📱 Số điện thoại',
            onclick: (e) => {
              form.method = 'phone';
              e.target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
              e.target.classList.add('on');
              render();
            },
          }),
          el('button.chip', {
            type: 'button',
            text: '✉️ Email',
            onclick: (e) => {
              form.method = 'email';
              e.target.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
              e.target.classList.add('on');
              render();
            },
          }),
        ]),

        textField('Tên hiển thị', form.display_name, (v) => (form.display_name = v), {
          placeholder: 'Ví dụ: Tiến Đạt',
        }),
        body,

        el('button.btn.primary.block', { type: 'submit', text: 'Tiếp tục' }),
        el('p.muted.center', {
          style: { marginTop: '14px' },
          text: 'Dù đăng ký bằng cách nào, bạn vẫn cần xác minh số điện thoại trước khi bắt đầu.',
        }),
      ]),
    ])
  );
}

/* ---------------------------------------------------------------- đăng nhập */

export function loginScreen() {
  const form = { identifier: '', password: '' };

  const submit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const res = await api('/auth/login', { method: 'POST', body: form });
      store.setToken(res.token);
      store.user = res.user;
      go(res.next === 'verify_phone' ? '#/verify-phone' : '#/home');
    } catch {
      btn.disabled = false;
    }
  };

  mount(
    topBar('Đăng nhập', { onBack: () => go('#/welcome') }),
    el('div.screen.no-nav', {}, [
      el('form', { onsubmit: submit }, [
        textField('Email hoặc số điện thoại', form.identifier, (v) => (form.identifier = v), {
          placeholder: '0912345678',
        }),
        textField('Mật khẩu', form.password, (v) => (form.password = v), { type: 'password' }),
        el('button.btn.primary.block', { type: 'submit', text: 'Đăng nhập' }),
      ]),
      el('hr.sep'),
      el('button.btn.block', { text: 'Đăng nhập bằng mã OTP', onclick: () => go('#/login-otp') }),
    ])
  );
}

export function loginOtpScreen() {
  const form = { phone: '', code: '' };
  let sent = false;

  const render = () => {
    mount(
      topBar('Đăng nhập bằng OTP', { onBack: () => go('#/login') }),
      el('div.screen.no-nav', {}, [
        textField('Số điện thoại', form.phone, (v) => (form.phone = v), { type: 'tel', placeholder: '0912345678' }),
        !sent
          ? el('button.btn.primary.block', {
              text: 'Gửi mã',
              onclick: async () => {
                await api('/auth/login/otp/send', { method: 'POST', body: { phone: form.phone } });
                sent = true;
                toast('Nếu số này đã đăng ký, bạn sẽ nhận được mã.');
                render();
              },
            })
          : frag(
              textField('Mã xác minh', form.code, (v) => (form.code = v), { placeholder: '6 chữ số' }),
              el('button.btn.primary.block', {
                text: 'Đăng nhập',
                onclick: async () => {
                  const res = await api('/auth/login/otp/verify', { method: 'POST', body: form });
                  store.setToken(res.token);
                  store.user = res.user;
                  go('#/home');
                },
              })
            ),
      ])
    );
  };
  render();
}

/* ------------------------------------------------------- xác minh số điện thoại */

export function verifyPhoneScreen() {
  const form = { phone: store.user?.phone ?? '', code: '' };
  let sent = false;

  const render = () => {
    mount(
      topBar('Xác minh số điện thoại'),
      el('div.screen.no-nav', {}, [
        el('div.note', {
          text: 'Xác minh số điện thoại giúp cộng đồng Vigo Match an toàn hơn. Số của bạn không hiển thị với người khác.',
        }),

        !sent
          ? frag(
              textField('Số điện thoại', form.phone, (v) => (form.phone = v), {
                type: 'tel',
                placeholder: '0912345678',
              }),
              el('button.btn.primary.block', {
                text: 'Gửi mã xác minh',
                onclick: async () => {
                  const res = await api('/auth/phone/send-otp', { method: 'POST', body: { phone: form.phone } });
                  sent = true;
                  if (res.code) toast(`Mã xác minh (chế độ thử nghiệm): ${res.code}`);
                  render();
                },
              })
            )
          : frag(
              el('p', { text: `Chúng tôi đã gửi mã tới ${form.phone}.` }),
              textField('Mã xác minh', form.code, (v) => (form.code = v), { placeholder: '6 chữ số' }),
              el('button.btn.primary.block', {
                text: 'Xác minh',
                onclick: async () => {
                  const res = await api('/auth/phone/verify', { method: 'POST', body: form });
                  store.user = res.user;
                  toast('Xác minh thành công!');
                  go('#/onboarding/goal');
                },
              }),
              el('button.btn.ghost.block', {
                style: { marginTop: '10px' },
                text: 'Gửi lại mã',
                onclick: async () => {
                  const res = await api('/auth/phone/send-otp', { method: 'POST', body: { phone: form.phone } });
                  if (res.code) toast(`Mã mới: ${res.code}`);
                  else toast('Đã gửi lại mã.');
                },
              })
            ),
      ])
    );
  };
  render();
}

/* ------------------------------------------------------------ tạo hồ sơ */

/** Bước 1: "Bạn đang tìm gì?" */
export function onboardingGoalScreen() {
  let goal = null;

  const cards = options('relationship_goal').map((o) =>
    el('button.card', {
      type: 'button',
      style: { width: '100%', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' },
      onclick: async () => {
        goal = o.value;
        await api('/auth/onboarding/goal', { method: 'POST', body: { relationship_goal: goal } });
        go('#/onboarding/basic');
      },
    }, [
      el('div.pad', {}, [
        el('b', { text: o.label }),
        el('div.muted', {
          text: {
            love: 'Một mối quan hệ tình cảm, chưa đặt nặng chuyện lâu dài.',
            partner: 'Một người đồng hành lâu dài, có thể tiến tới hôn nhân.',
            marriage: 'Bạn đang tìm người để kết hôn trong tương lai gần.',
            friends: 'Bạn muốn gặp người hợp gu để chơi cùng.',
          }[o.value],
        }),
      ]),
    ])
  );

  mount(
    topBar('Bạn đang tìm gì?'),
    el('div.screen.no-nav', {}, [
      el('p.muted', { text: 'Câu trả lời này quyết định phần lớn việc chúng tôi giới thiệu ai cho bạn. Bạn có thể đổi bất cứ lúc nào.' }),
      ...cards,
    ])
  );
}

/** Bước 2: thông tin cơ bản + khu vực. */
export function onboardingBasicScreen() {
  const form = { birth_date: '', gender: null, region_id: null };
  let provinces = [];
  let districts = [];
  let wards = [];

  const wrap = el('div.screen.no-nav');

  const render = () => {
    wrap.replaceChildren(
      el('p.muted', { text: 'Những thông tin này dùng để tính độ tuổi và khoảng cách. Vị trí chính xác của bạn không bao giờ hiển thị với người khác.' }),

      textField('Ngày sinh', form.birth_date, (v) => (form.birth_date = v), { type: 'date' }),

      el('label.field', {}, [
        el('span', { text: 'Giới tính' }),
        chipGroup('gender', form.gender ? [form.gender] : [], (vals) => (form.gender = vals[vals.length - 1] ?? null), { max: 1 }),
      ]),

      el('label.field', {}, [
        el('span', { text: 'Tỉnh / Thành phố' }),
        el('select', {
          onchange: async (e) => {
            form.region_id = Number(e.target.value) || null;
            districts = form.region_id ? (await api(`/meta/regions?parent_id=${form.region_id}`)).regions : [];
            wards = [];
            render();
          },
        }, [
          el('option', { value: '', text: '— Chọn tỉnh/thành —' }),
          ...provinces.map((p) => el('option', { value: p.id, text: p.name })),
        ]),
      ]),

      districts.length &&
        el('label.field', {}, [
          el('span', { text: 'Quận / Huyện' }),
          el('select', {
            onchange: async (e) => {
              form.region_id = Number(e.target.value) || form.region_id;
              wards = e.target.value ? (await api(`/meta/regions?parent_id=${e.target.value}`)).regions : [];
              render();
            },
          }, [
            el('option', { value: '', text: '— Chọn quận/huyện —' }),
            ...districts.map((d) => el('option', { value: d.id, text: d.name })),
          ]),
        ]),

      wards.length &&
        el('label.field', {}, [
          el('span', { text: 'Xã / Phường (tuỳ chọn)' }),
          el('select', {
            onchange: (e) => {
              if (e.target.value) form.region_id = Number(e.target.value);
            },
          }, [
            el('option', { value: '', text: '— Không chọn —' }),
            ...wards.map((w) => el('option', { value: w.id, text: w.name })),
          ]),
        ]),

      el('button.btn.primary.block', {
        text: 'Tiếp tục',
        onclick: async () => {
          if (!form.birth_date || !form.gender || !form.region_id) {
            return toast('Vui lòng điền đủ ngày sinh, giới tính và khu vực.', true);
          }
          await api('/profile', { method: 'PATCH', body: form });
          go('#/onboarding/values');
        },
      })
    );
  };

  mount(topBar('Về bạn'), wrap);
  api('/meta/regions').then((r) => {
    provinces = r.regions;
    render();
  });
  render();
}

/** Bước 3: quan điểm sống — phần quan trọng nhất với thuật toán. */
export function onboardingValuesScreen() {
  const form = {
    seriousness: 3,
    marriage_timeline: null,
    children_wish: null,
    living_preference: null,
    lifestyle_tags: [],
    interest_tags: [],
  };

  mount(
    topBar('Quan điểm của bạn'),
    el('div.screen.no-nav', {}, [
      el('p.muted', { text: 'Đây là phần quyết định chất lượng ghép đôi. Trả lời thật, bạn sẽ gặp đúng người hơn.' }),

      el('label.field', {}, [
        el('span', { text: 'Mức độ nghiêm túc' }),
        el('input', {
          type: 'range', min: 1, max: 5, value: 3,
          oninput: (e) => {
            form.seriousness = Number(e.target.value);
            e.target.nextElementSibling.textContent =
              options('seriousness').find((s) => String(s.value) === e.target.value)?.label ?? '';
          },
        }),
        el('div.muted', { text: options('seriousness')[2]?.label ?? '' }),
      ]),

      selectField('Dự định kết hôn', 'marriage_timeline', null, (v) => (form.marriage_timeline = v)),
      selectField('Mong muốn có con', 'children_wish', null, (v) => (form.children_wish = v)),
      selectField('Nơi ở sau khi kết hôn', 'living_preference', null, (v) => (form.living_preference = v)),

      el('label.field', {}, [
        el('span', { text: 'Lối sống — chọn tối đa 6' }),
        chipGroup('lifestyle', [], (v) => (form.lifestyle_tags = v), { max: 6 }),
      ]),
      el('label.field', {}, [
        el('span', { text: 'Sở thích — chọn tối đa 6' }),
        chipGroup('interests', [], (v) => (form.interest_tags = v), { max: 6 }),
      ]),

      el('button.btn.primary.block', {
        text: 'Hoàn tất hồ sơ',
        onclick: async () => {
          await api('/profile', { method: 'PATCH', body: form });
          toast('Hồ sơ của bạn đã sẵn sàng!');
          go('#/home');
        },
      }),
      el('button.btn.ghost.block', {
        style: { marginTop: '10px' },
        text: 'Để sau',
        onclick: () => go('#/home'),
      }),
    ])
  );
}
