/* ============================================================
   VIGO Miner — mini app client.

   Taps are applied optimistically so the coin feels instant, then
   flushed to the server in batches. The server's reply is always
   authoritative: if it paid for fewer taps than we counted (out of
   energy, rate limit), its numbers overwrite ours.
   ============================================================ */

const tg = window.Telegram?.WebApp;

// ---------- tiny DOM helpers ----------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};

const nf = new Intl.NumberFormat('en-US');
const fmt = (n) => nf.format(Math.floor(n));

/** Compact form for prices and profits: 1.2K, 3.4M, 5.6B. */
function short(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return String(Math.floor(n));
}

const CARD_ICONS = {
  usb_stick: '🔌', gpu_rig: '🖥️', asic_s19: '⚙️', immersion: '🛢️', quantum: '🔮',
  solar_panel: '☀️', cooling: '❄️', substation: '🏗️', datacenter: '🏢', fusion: '⚛️',
  intern: '🧑‍💻', sysadmin: '🛠️', trader: '📈', cfo: '💼', lobbyist: '🎩',
  referral_hub: '🤝', vigo_vault: '🏦', streak_shrine: '🔥',
};
const BOOST_ICONS = { multitap: '👆', battery: '🔋', bolt: '⚡' };
const LEAGUE_ICONS = {
  wood: '🪵', bronze: '🥉', silver: '🥈', gold: '🥇',
  platinum: '💠', diamond: '💎', epic: '👑', legend: '🔱',
};

// ---------- feedback ----------
let toastTimer;
function toast(message, kind = '') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast ${kind ? `is-${kind}` : ''}`;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
}

function haptic(style = 'light') {
  try { tg?.HapticFeedback?.impactOccurred(style); } catch { /* not in Telegram */ }
}

function notifyHaptic(type = 'success') {
  try { tg?.HapticFeedback?.notificationOccurred(type); } catch { /* not in Telegram */ }
}

// ---------- api ----------
const api = {
  token: null,

  async call(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }

    if (!res.ok) {
      const err = new Error(data?.message || data?.error || `Request failed (${res.status})`);
      err.code = data?.error;
      err.status = res.status;
      throw err;
    }
    return data;
  },

  get(path) { return this.call(path); },
  post(path, body) { return this.call(path, { method: 'POST', body }); },
};

// ---------- state ----------
const store = {
  state: null,        // last authoritative payload from the server
  cards: [],
  boostList: [],
  categories: [],
  activeCategory: 'rigs',
  activeTab: 'mine',

  // Local, optimistic-only values reconciled on every server reply.
  energy: 0,
  balance: 0,
  pendingTaps: 0,
  syncing: false,
  dirty: false,
};

/** Merge a server payload into the store and repaint. */
function applyServerState(payload, { authoritativeEnergy = true } = {}) {
  if (!payload) return;
  store.state = { ...store.state, ...payload };

  if (payload.cards) store.cards = payload.cards;
  if (payload.boostList) store.boostList = payload.boostList;
  if (payload.categories) store.categories = payload.categories;

  store.balance = payload.balance;
  // While taps are still queued locally, keep our lower energy reading so the
  // bar does not jump back up between a tap and its flush.
  if (authoritativeEnergy || payload.energy < store.energy) store.energy = payload.energy;

  render();
}

// ============================================================
//  Tapping
// ============================================================

const tapCoin = $('tap-coin');

function currentTapPower() {
  const s = store.state;
  if (!s) return 1;
  const turboActive = s.turboUntil && Date.now() < s.turboUntil;
  return turboActive ? s.baseTapPower * s.turboMultiplier : s.baseTapPower;
}

function spawnFloater(x, y, amount) {
  const node = el('div', 'floater', `+${amount}`);
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  $('floaters').appendChild(node);
  setTimeout(() => node.remove(), 800);
}

function onTap(event) {
  const power = currentTapPower();
  if (store.energy < power) {
    tapCoin.classList.add('is-drained');
    haptic('rigid');
    toast('Out of energy — wait or use Full Energy', 'error');
    return;
  }

  store.energy -= power;
  store.balance += power;
  store.pendingTaps += 1;
  store.dirty = true;

  const rect = $('floaters').getBoundingClientRect();
  const point = event.changedTouches?.[0] || event;
  spawnFloater((point.clientX ?? rect.width / 2) - rect.left,
               (point.clientY ?? rect.height / 2) - rect.top, power);

  haptic('light');
  paintBalance();
  paintEnergy();
  scheduleFlush();
}

// Touch gives us multi-finger tapping; the click fallback keeps the desktop
// browser (and Telegram Desktop) playable.
tapCoin.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const touch of e.changedTouches) onTap(touch);
}, { passive: false });

tapCoin.addEventListener('click', (e) => {
  if (e.detail === 0) return;          // keyboard activation
  if ('ontouchstart' in window) return; // already handled by touchstart
  onTap(e);
});

let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushTaps, 700);
}

async function flushTaps() {
  flushTimer = null;
  if (store.syncing || store.pendingTaps === 0) return;

  const batch = store.pendingTaps;
  store.pendingTaps = 0;
  store.syncing = true;

  try {
    const payload = await api.post('/tap', { taps: batch });
    // Server is the source of truth for both balance and energy here.
    applyServerState(payload, { authoritativeEnergy: store.pendingTaps === 0 });
  } catch (err) {
    if (err.status === 401) return relogin();
    // Put the taps back so a flaky connection does not eat them.
    store.pendingTaps += batch;
  } finally {
    store.syncing = false;
    if (store.pendingTaps > 0) scheduleFlush();
  }
}

// Never lose a batch when the app is backgrounded or closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushTaps();
  else refreshState();
});
window.addEventListener('pagehide', () => flushTaps());

// ============================================================
//  Local ticking (energy regen + turbo countdown)
// ============================================================

setInterval(() => {
  const s = store.state;
  if (!s) return;

  if (store.energy < s.maxEnergy) {
    store.energy = Math.min(s.maxEnergy, store.energy + s.rechargeRate);
    paintEnergy();
    if (store.energy >= currentTapPower()) tapCoin.classList.remove('is-drained');
  }

  // Passive income ticks up visually between syncs.
  if (s.profitPerHour > 0) {
    store.balance += s.profitPerHour / 3600;
    paintBalance();
  }

  const turboOn = s.turboUntil && Date.now() < s.turboUntil;
  tapCoin.classList.toggle('is-turbo', !!turboOn);
  if (!turboOn && s.turboUntil) { s.turboUntil = 0; paintTapPower(); }
}, 1000);

// Reconcile with the server periodically so passive income and other devices
// stay in sync without the player noticing.
setInterval(() => { if (document.visibilityState === 'visible') refreshState(); }, 45_000);

async function refreshState() {
  if (!api.token || store.pendingTaps > 0) return;
  try {
    applyServerState(await api.get('/state'));
  } catch (err) {
    if (err.status === 401) relogin();
  }
}

// ============================================================
//  Rendering
// ============================================================

function paintBalance() {
  $('balance').textContent = fmt(store.balance);
  $('boost-balance').textContent = fmt(store.balance);
  $('rigs-balance').textContent = fmt(store.balance);
}

function paintEnergy() {
  const s = store.state;
  if (!s) return;
  const energy = Math.floor(store.energy);
  $('energy').textContent = fmt(energy);
  $('energy-max').textContent = fmt(s.maxEnergy);
  $('energy-fill').style.width = `${Math.max(0, Math.min(100, (energy / s.maxEnergy) * 100))}%`;
}

function paintTapPower() {
  const power = currentTapPower();
  const turbo = store.state?.turboUntil && Date.now() < store.state.turboUntil;
  $('tap-power-label').textContent = turbo ? `+${power} / tap 🚀` : `+${power} / tap`;
}

function paintHeader() {
  const s = store.state;
  const user = s.user;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Miner';
  $('profile-name').textContent = name;

  const avatar = $('avatar');
  if (user.photoUrl) {
    avatar.style.backgroundImage = `url("${user.photoUrl}")`;
    avatar.textContent = '';
  } else {
    avatar.textContent = name.slice(0, 1).toUpperCase();
  }

  const league = s.league;
  $('profile-league').textContent = `${LEAGUE_ICONS[league.id] || ''} ${league.name}`;
  $('league-name').textContent = league.name;

  if (league.next) {
    const span = league.next.min - league.min;
    const done = Math.max(0, s.totalEarned - league.min);
    $('league-next').textContent = league.next.name;
    $('league-fill').style.width = `${Math.min(100, (done / span) * 100)}%`;
  } else {
    $('league-next').textContent = 'Max league';
    $('league-fill').style.width = '100%';
  }

  $('profit-per-hour').textContent = fmt(s.profitPerHour);
  $('rigs-pph').textContent = fmt(s.profitPerHour);
  $('daily-dot').hidden = s.daily.claimedToday;
}

function paintQuickBoosters() {
  const s = store.state;
  const energyLeft = s.boosters.fullEnergy.left;
  const turboLeft = s.boosters.turbo.left;

  $('qb-energy-left').textContent = `${energyLeft} left today`;
  $('qb-turbo-left').textContent = `${turboLeft} left today`;
  $('qb-energy').disabled = energyLeft === 0;
  $('qb-turbo').disabled = turboLeft === 0;
}

function renderBoostScreen() {
  const s = store.state;

  const daily = $('daily-boosters');
  daily.replaceChildren();
  const boosters = [
    { id: 'fullEnergy', icon: '🔋', name: 'Full Energy', sub: 'Instantly refill your energy bar',
      left: s.boosters.fullEnergy.left, perDay: s.boosters.fullEnergy.perDay },
    { id: 'turbo', icon: '🚀', name: 'Turbo', sub: `${s.turboMultiplier}× tap power for ${s.boosters.turbo.durationSec}s`,
      left: s.boosters.turbo.left, perDay: s.boosters.turbo.perDay },
  ];

  for (const b of boosters) {
    const row = el('button', 'row');
    row.disabled = b.left === 0;
    row.append(
      el('div', 'row__icon', b.icon),
      el('div', 'row__body', `<div class="row__title">${b.name}</div><div class="row__sub">${b.sub}</div>`),
      el('div', 'row__side', `<div class="row__price ${b.left ? 'is-affordable' : ''}">${b.left}/${b.perDay}</div><div class="row__lvl">free</div>`),
    );
    row.addEventListener('click', () => useBooster(b.id));
    daily.appendChild(row);
  }

  const list = $('boost-list');
  list.replaceChildren();
  for (const boost of store.boostList) {
    const maxed = boost.price == null;
    const affordable = !maxed && store.balance >= boost.price;

    const row = el('button', 'row');
    row.disabled = maxed || !affordable;

    const nextLine = maxed
      ? boost.description
      : `${boost.description} · now ${boost.value} → ${boost.nextValue}`;

    row.append(
      el('div', 'row__icon', BOOST_ICONS[boost.icon] || '✨'),
      el('div', 'row__body', `<div class="row__title">${boost.name}</div><div class="row__sub">${nextLine}</div>`),
      el('div', 'row__side',
        `<div class="row__price ${maxed ? 'is-max' : affordable ? 'is-affordable' : ''}">${maxed ? 'MAX' : short(boost.price)}</div>` +
        `<div class="row__lvl">lvl ${boost.level}${maxed ? '' : ` / ${boost.maxLevel}`}</div>`),
    );
    row.addEventListener('click', () => buyBoost(boost.id));
    list.appendChild(row);
  }
}

function renderCategories() {
  const tabs = $('card-categories');
  tabs.replaceChildren();
  for (const cat of store.categories) {
    const tab = el('button', `tab ${cat.id === store.activeCategory ? 'is-active' : ''}`, cat.name);
    tab.addEventListener('click', () => { store.activeCategory = cat.id; renderCategories(); renderCards(); });
    tabs.appendChild(tab);
  }
}

function renderCards() {
  const list = $('card-list');
  list.replaceChildren();

  const visible = store.cards.filter((c) => c.category === store.activeCategory);
  if (!visible.length) {
    list.appendChild(el('div', 'empty', 'Nothing here yet.'));
    return;
  }

  for (const card of visible) {
    const maxed = card.price == null;
    const affordable = card.unlocked && !maxed && store.balance >= card.price;

    const node = el('button', `card ${card.unlocked ? '' : 'is-locked'}`);
    node.disabled = !card.unlocked || maxed;

    const top = el('div', 'card__top');
    top.append(
      el('div', 'card__icon', CARD_ICONS[card.id] || '⚙️'),
      el('div', '', `<div class="card__name">${card.name}</div><div class="card__lvl">lvl ${card.level}</div>`),
    );

    const profit = el('div', 'card__profit',
      card.level > 0
        ? `Profit <b>+${short(card.profitPerHour)}</b>/hour`
        : `Unlocks <b>+${short(card.profitDelta)}</b>/hour`);

    const buy = el('div', 'card__buy');
    if (!card.unlocked) {
      buy.innerHTML = `<span class="is-locked-text">🔒 ${card.requirement || 'Locked'}</span>`;
    } else if (maxed) {
      buy.innerHTML = '<span>Maxed</span><span>✅</span>';
    } else {
      buy.innerHTML = `<span>+${short(card.profitDelta)}/h</span>` +
                      `<span class="${affordable ? 'is-affordable' : ''}">${short(card.price)}</span>`;
    }

    node.append(top, profit, buy);
    node.addEventListener('click', () => buyCard(card.id));
    list.appendChild(node);
  }
}

function render() {
  if (!store.state) return;
  paintBalance();
  paintEnergy();
  paintTapPower();
  paintHeader();
  paintQuickBoosters();
  renderBoostScreen();
  renderCategories();
  renderCards();
}

// ============================================================
//  Actions
// ============================================================

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) return relogin();
    toast(err.message || 'Something went wrong', 'error');
    notifyHaptic('error');
    return null;
  }
}

function buyBoost(id) {
  return guarded(async () => {
    const payload = await api.post(`/boost/${id}`);
    applyServerState(payload);
    notifyHaptic('success');
    toast('Upgraded!', 'good');
  });
}

function buyCard(id) {
  return guarded(async () => {
    const payload = await api.post(`/card/${id}`);
    applyServerState(payload);
    notifyHaptic('success');
    toast(`+${short(payload.cards.find((c) => c.id === id)?.profitPerHour || 0)}/hour`, 'good');
  });
}

function useBooster(id) {
  return guarded(async () => {
    const payload = await api.post(`/booster/${id}`);
    applyServerState(payload);
    notifyHaptic('success');
    toast(id === 'fullEnergy' ? 'Energy refilled ⚡' : 'Turbo engaged 🚀', 'good');
  });
}

// ============================================================
//  Sheets
// ============================================================

function openSheet(build) {
  const content = $('sheet-content');
  content.replaceChildren();
  build(content);
  $('sheet').hidden = false;
}

function closeSheet() { $('sheet').hidden = true; }
for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', closeSheet);

function openDailySheet() {
  const s = store.state;
  openSheet((root) => {
    root.append(
      el('h2', '', '🎁 Daily reward'),
      el('p', '', s.daily.claimedToday
        ? `Claimed today. Streak: ${s.daily.streak} day${s.daily.streak === 1 ? '' : 's'}. Come back tomorrow to keep it alive.`
        : 'Open the app every day. Miss a day and the streak restarts at day 1.'),
    );

    const days = el('div', 'days');
    s.daily.rewards.forEach((reward, i) => {
      const day = i + 1;
      const done = day <= s.daily.streak && (s.daily.claimedToday || day < s.daily.nextDay);
      const isNext = !s.daily.claimedToday && day === s.daily.nextDay;
      const node = el('div', `day ${done ? 'is-done' : ''} ${isNext ? 'is-next' : ''}`,
        `Day ${day}<b>${short(reward)}</b>`);
      days.appendChild(node);
    });
    root.appendChild(days);

    const btn = el('button', 'btn btn--primary',
      s.daily.claimedToday ? 'Come back tomorrow' : `Claim ${short(s.daily.nextReward)} VIGO`);
    btn.disabled = s.daily.claimedToday;
    btn.addEventListener('click', () => guarded(async () => {
      const payload = await api.post('/daily');
      applyServerState(payload);
      closeSheet();
      notifyHaptic('success');
      toast(`+${fmt(payload.reward)} VIGO · day ${payload.streak}`, 'good');
    }));
    root.appendChild(btn);
  });
}

function openProfitSheet() {
  const s = store.state;
  openSheet((root) => {
    root.append(
      el('h2', '', '⛏️ Passive mining'),
      el('p', '', `Your rigs mine <b>${fmt(s.profitPerHour)}</b> VIGO every hour, even when the app is closed. ` +
                  `Offline earnings are collected for up to ${s.offlineCapHours} hours, so check in regularly.`),
      el('button', 'btn btn--primary', 'Got it'),
    );
    root.lastChild.addEventListener('click', closeSheet);
  });
}

function openWelcomeSheet(mined) {
  openSheet((root) => {
    root.append(
      el('h2', '', '⛏️ While you were away'),
      el('p', '', `Your rigs mined <b>${fmt(mined)}</b> VIGO.`),
      el('button', 'btn btn--primary', 'Collect'),
    );
    root.lastChild.addEventListener('click', closeSheet);
  });
}

$('daily-btn').addEventListener('click', openDailySheet);
$('profit-btn').addEventListener('click', openProfitSheet);
$('qb-energy').addEventListener('click', () => useBooster('fullEnergy'));
$('qb-turbo').addEventListener('click', () => useBooster('turbo'));

// ============================================================
//  Friends & leaderboard
// ============================================================

let inviteLink = null;

async function loadFriends() {
  const data = await guarded(() => api.get('/referrals'));
  if (!data) return;

  inviteLink = data.link;
  $('ref-inviter').textContent = `+${short(data.bonus.inviter)}`;
  $('ref-invitee').textContent = `+${short(data.bonus.invitee)}`;
  $('ref-premium').textContent = `+${short(data.bonus.premiumInviter)}`;
  $('ref-share').textContent = `${Math.round(data.share * 100)}%`;
  $('ref-count').textContent = fmt(data.count);
  $('ref-earned').textContent = fmt(data.earned);

  const list = $('friend-list');
  list.replaceChildren();

  if (!data.friends.length) {
    list.appendChild(el('div', 'empty', 'No friends yet. Invite someone and you both get a bonus.'));
    return;
  }

  for (const friend of data.friends) {
    const row = el('div', 'row');
    row.append(
      el('div', 'row__icon', LEAGUE_ICONS[friend.league] || '👤'),
      el('div', 'row__body',
        `<div class="row__title">${escapeHtml(friend.name)}${friend.isPremium ? ' ⭐' : ''}</div>` +
        `<div class="row__sub">${short(friend.totalEarned)} VIGO mined</div>`),
    );
    list.appendChild(row);
  }
}

async function loadLeaderboard() {
  const data = await guarded(() => api.get('/leaderboard'));
  if (!data) return;

  $('player-count').textContent = fmt(data.totalPlayers);
  const list = $('leaderboard');
  list.replaceChildren();

  const meId = store.state?.user?.id;
  const entries = [...data.top];
  // If the player is outside the top 100, pin their row to the bottom.
  if (data.me && !entries.some((e) => e.id === data.me.id)) entries.push(data.me);

  if (!entries.length) {
    list.appendChild(el('div', 'empty', 'No miners ranked yet.'));
    return;
  }

  for (const entry of entries) {
    const row = el('div', `row ${entry.id === meId ? 'is-me' : ''}`);
    row.append(
      el('div', `rank ${entry.rank <= 3 ? 'is-top' : ''}`,
        entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`),
      el('div', 'row__body',
        `<div class="row__title">${escapeHtml(entry.name)}</div>` +
        `<div class="row__sub">${LEAGUE_ICONS[entry.league] || ''} ${short(entry.profitPerHour)}/hour</div>`),
      el('div', 'row__side', `<div class="row__price">${short(entry.totalEarned)}</div>`),
    );
    list.appendChild(row);
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('invite-btn').addEventListener('click', () => {
  if (!inviteLink) return toast('Invite link is not configured yet', 'error');
  const text = 'Mine VIGO with me — grab your starting bonus ⛏️';
  const share = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else window.open(share, '_blank');
});

$('copy-btn').addEventListener('click', async () => {
  if (!inviteLink) return toast('Invite link is not configured yet', 'error');
  try {
    await navigator.clipboard.writeText(inviteLink);
    toast('Link copied', 'good');
  } catch {
    toast(inviteLink);
  }
});

// ============================================================
//  Navigation
// ============================================================

for (const button of document.querySelectorAll('.nav__item')) {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
}

function switchTab(tab) {
  store.activeTab = tab;
  haptic('soft');

  for (const section of document.querySelectorAll('.screen')) {
    section.hidden = section.dataset.screen !== tab;
  }
  for (const button of document.querySelectorAll('.nav__item')) {
    button.classList.toggle('is-active', button.dataset.tab === tab);
  }

  // These two are fetched on demand rather than pushed with every state sync.
  if (tab === 'friends') loadFriends();
  if (tab === 'top') loadLeaderboard();
}

// ============================================================
//  Boot
// ============================================================

function bootError(message) {
  const node = $('boot-msg');
  node.textContent = message;
  node.classList.add('is-error');
}

/** The referral code, from `startapp=` (mini app) or `?startapp=` (web link). */
function readStartParam() {
  const fromTelegram = tg?.initDataUnsafe?.start_param;
  if (fromTelegram) return fromTelegram;
  return new URLSearchParams(location.search).get('startapp') || null;
}

async function login() {
  const stored = sessionStorage.getItem('vigo_token');
  const body = { initData: tg?.initData || '', startParam: readStartParam() };

  // Dev fallback: /?dev=123 lets the app run in a plain browser when the
  // server has ALLOW_DEV_AUTH=1.
  const devId = new URLSearchParams(location.search).get('dev');
  if (devId && !body.initData) body.devUserId = Number(devId);

  const payload = await api.post('/auth', body);
  api.token = payload.token;
  try { sessionStorage.setItem('vigo_token', payload.token); } catch { /* private mode */ }
  return payload;
}

async function relogin() {
  try {
    const payload = await login();
    applyServerState(payload);
  } catch {
    toast('Session expired — reopen the app', 'error');
  }
}

async function boot() {
  try {
    tg?.ready?.();
    tg?.expand?.();
    try { tg?.disableVerticalSwipes?.(); } catch { /* older Telegram clients */ }
    if (tg?.setHeaderColor) { tg.setHeaderColor('#0b0d12'); tg.setBackgroundColor('#0b0d12'); }

    const payload = await login();
    applyServerState(payload);

    $('boot').hidden = true;
    $('app').hidden = false;

    if (payload.isNew) {
      toast('Welcome to the mine! Tap the coin to start ⛏️', 'good');
    } else if (payload.mined > 0) {
      openWelcomeSheet(payload.mined);
    }
  } catch (err) {
    console.error(err);
    bootError(err.message?.includes('init') || err.code === 'bad_init_data'
      ? 'Please open this game from the Telegram bot.'
      : `Could not connect: ${err.message}`);
  }
}

boot();
