/* ===========================================================================
   Điểm vào: nạp cấu hình, định tuyến theo hash, và kênh sự kiện thời gian thực.
   =========================================================================== */
import { api, store, mount, el, toast } from './lib.js';
import * as auth from './auth.js';
import * as screens from './screens.js';
import * as me from './me.js';
import * as extras from './extras.js';

/* ------------------------------------------------------------ định tuyến */

const routes = [
  [/^\/welcome$/, () => auth.welcomeScreen(), { public: true }],
  [/^\/register$/, () => auth.registerScreen(), { public: true }],
  [/^\/login$/, () => auth.loginScreen(), { public: true }],
  [/^\/login-otp$/, () => auth.loginOtpScreen(), { public: true }],
  [/^\/verify-phone$/, () => auth.verifyPhoneScreen()],
  [/^\/onboarding\/goal$/, () => auth.onboardingGoalScreen()],
  [/^\/onboarding\/basic$/, () => auth.onboardingBasicScreen()],
  [/^\/onboarding\/values$/, () => auth.onboardingValuesScreen()],

  [/^\/home$/, () => screens.homeScreen()],
  [/^\/discover$/, () => screens.discoverScreen()],
  [/^\/matches$/, () => screens.matchesScreen()],
  [/^\/liked-me$/, () => screens.likedMeScreen()],
  [/^\/chat$/, () => screens.chatListScreen()],
  [/^\/chat\/(\d+)$/, (m) => screens.chatScreen(m[1])],
  [/^\/profile\/edit$/, () => me.editProfileScreen()],
  [/^\/profile\/(\d+)$/, (m) => screens.profileDetailScreen(m[1])],
  [/^\/preference$/, () => me.preferenceScreen()],
  [/^\/me$/, () => me.meScreen(badges)],
  [/^\/nearby$/, () => extras.nearbyScreen()],
  [/^\/matchmaker$/, () => extras.matchmakerScreen()],
  [/^\/premium$/, () => extras.premiumScreen()],
  [/^\/payments$/, () => extras.paymentsScreen()],
  [/^\/verify$/, () => extras.verifyScreen()],
  [/^\/notifications$/, () => extras.notificationsScreen()],
  [/^\/blocked$/, () => extras.blockedScreen()],
];

let badges = { chat: 0, me: 0 };

async function route() {
  const path = location.hash.slice(1) || '/';
  const match = routes.find(([re]) => re.test(path));

  if (!match) {
    location.hash = store.token ? '#/home' : '#/welcome';
    return;
  }
  const [re, handler, opts = {}] = match;

  if (!opts.public && !store.token) {
    location.hash = '#/welcome';
    return;
  }
  // Chưa xác minh SĐT thì chỉ được ở các bước tạo tài khoản.
  if (
    store.user &&
    !store.user.phone_verified &&
    !/^\/(verify-phone|onboarding)/.test(path)
  ) {
    location.hash = '#/verify-phone';
    return;
  }

  try {
    await handler(re.exec(path));
  } catch (err) {
    if (err?.status === 401) return;
    console.error(err);
    mount(
      el('div.screen.no-nav', {}, [
        el('div.note.danger', { text: err.message || 'Không tải được màn hình này.' }),
        el('button.btn.block', { text: 'Thử lại', onclick: () => route() }),
        el('button.btn.ghost.block', { style: { marginTop: '8px' }, text: 'Về trang chủ', onclick: () => (location.hash = '#/home') }),
      ])
    );
  }
}

window.addEventListener('hashchange', route);

/* ------------------------------------------------- kênh sự kiện thời gian thực */

let eventSource = null;

function connectStream() {
  if (!store.token || eventSource) return;
  eventSource = new EventSource(`/api/social/stream?token=${encodeURIComponent(store.token)}`);

  eventSource.addEventListener('message', (e) => {
    const payload = JSON.parse(e.data);
    // Nếu đang mở đúng cuộc trò chuyện thì chèn thẳng vào, không thì đếm badge.
    if (window.__onChatMessage) window.__onChatMessage(payload);
    else {
      badges.chat += 1;
      refreshBadges();
      toast(`💬 ${payload.from?.display_name ?? 'Tin nhắn mới'}`);
    }
  });

  eventSource.addEventListener('match', () => {
    toast('💞 Bạn có một kết nối mới!');
    refreshBadges();
  });

  eventSource.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data);
    if (n.kind !== 'message') toast(`${n.title}`);
    refreshBadges();
  });

  eventSource.addEventListener('unmatch', () => refreshBadges());

  eventSource.onerror = () => {
    // EventSource tự kết nối lại; chỉ dọn khi đã đóng hẳn.
    if (eventSource.readyState === EventSource.CLOSED) {
      eventSource = null;
      setTimeout(connectStream, 4000);
    }
  };
}

async function refreshBadges() {
  if (!store.token || !store.user?.phone_verified) return;
  try {
    const o = await api('/profile/overview', { quiet: true });
    badges = { chat: o.badges.messages, me: o.badges.notifications };
    screens.setBadges(badges);
    document.querySelectorAll('.nav button').forEach((b) => {
      const key = ['home', 'discover', 'matches', 'chat', 'me'][[...b.parentElement.children].indexOf(b)];
      b.querySelector('.dot')?.remove();
      if (badges[key]) {
        b.prepend(el('span.dot', { text: badges[key] > 99 ? '99+' : String(badges[key]) }));
      }
    });
  } catch {
    /* không quan trọng */
  }
}

/* ------------------------------------------------------------------ khởi động */

async function boot() {
  try {
    store.meta = await api('/meta/taxonomy');
    store.taxonomy = store.meta.taxonomy;
  } catch {
    mount(el('div.screen.no-nav', {}, [
      el('div.note.danger', { text: 'Không kết nối được tới máy chủ. Hãy kiểm tra kết nối và tải lại trang.' }),
    ]));
    return;
  }

  if (store.token) {
    try {
      const { user } = await api('/auth/me', { quiet: true });
      store.user = user;
    } catch {
      store.setToken(null);
    }
  }

  if (!location.hash || location.hash === '#/') {
    location.hash = store.token ? '#/home' : '#/welcome';
  }

  await route();

  if (store.token && store.user?.phone_verified) {
    connectStream();
    refreshBadges();
    setInterval(refreshBadges, 60000);
  }
}

boot();
