// Central place for every tunable number in the game. Anything the client
// renders as a price, a reward or a limit is derived from here so the two
// sides can never disagree about balance.

export const TAP_COST_PER_HIT = 1; // energy spent per unit of tap power

export const BOOSTS = {
  multitap: {
    id: 'multitap',
    name: 'Multitap',
    description: 'Every tap mines +1 VIGO',
    icon: 'multitap',
    maxLevel: 20,
    // level 1 is free (everyone starts there); price is for the *next* level
    price: (level) => Math.round(1000 * Math.pow(2, level - 1)),
    value: (level) => level, // VIGO per tap
  },
  energyLimit: {
    id: 'energyLimit',
    name: 'Energy Limit',
    description: '+500 max energy per level',
    icon: 'battery',
    maxLevel: 20,
    price: (level) => Math.round(1000 * Math.pow(2, level - 1)),
    value: (level) => 500 + 500 * level, // max energy
  },
  rechargeSpeed: {
    id: 'rechargeSpeed',
    name: 'Recharge Speed',
    description: '+1 energy restored per second',
    icon: 'bolt',
    maxLevel: 10,
    price: (level) => Math.round(5000 * Math.pow(3, level - 1)),
    value: (level) => level, // energy per second
  },
};

export const DAILY_BOOSTERS = {
  fullEnergy: { id: 'fullEnergy', name: 'Full Energy', perDay: 6, cooldownSec: 60 },
  turbo: { id: 'turbo', name: 'Turbo', perDay: 3, cooldownSec: 60, durationSec: 20, multiplier: 5 },
};

// Passive income cards. Each upgrade raises profit-per-hour and price.
export const CARDS = [
  // --- Rigs: raw hashing power ---
  { id: 'usb_stick',    name: 'USB Miner',        category: 'rigs',   baseProfit: 20,    basePrice: 500 },
  { id: 'gpu_rig',      name: 'GPU Rig',          category: 'rigs',   baseProfit: 120,   basePrice: 3000 },
  { id: 'asic_s19',     name: 'ASIC S19',         category: 'rigs',   baseProfit: 700,   basePrice: 20000 },
  { id: 'immersion',    name: 'Immersion Tank',   category: 'rigs',   basePrice: 150000, baseProfit: 4200, requires: { card: 'asic_s19', level: 5 } },
  { id: 'quantum',      name: 'Quantum Core',     category: 'rigs',   basePrice: 1200000, baseProfit: 26000, requires: { card: 'immersion', level: 5 } },

  // --- Infrastructure: keeps the rigs alive ---
  { id: 'solar_panel',  name: 'Solar Array',      category: 'infra',  baseProfit: 60,    basePrice: 1500 },
  { id: 'cooling',      name: 'Cooling System',   category: 'infra',  baseProfit: 300,   basePrice: 9000 },
  { id: 'substation',   name: 'Power Substation', category: 'infra',  baseProfit: 1600,  basePrice: 60000 },
  { id: 'datacenter',   name: 'Data Center',      category: 'infra',  basePrice: 400000, baseProfit: 9500, requires: { card: 'substation', level: 5 } },
  { id: 'fusion',       name: 'Fusion Reactor',   category: 'infra',  basePrice: 2500000, baseProfit: 48000, requires: { card: 'datacenter', level: 5 } },

  // --- Team: people who make it scale ---
  { id: 'intern',       name: 'Intern',           category: 'team',   baseProfit: 40,    basePrice: 1000 },
  { id: 'sysadmin',     name: 'Sysadmin',         category: 'team',   baseProfit: 220,   basePrice: 6000 },
  { id: 'trader',       name: 'Quant Trader',     category: 'team',   baseProfit: 1100,  basePrice: 40000 },
  { id: 'cfo',          name: 'CFO',              category: 'team',   basePrice: 250000, baseProfit: 6500, requires: { card: 'trader', level: 5 } },
  { id: 'lobbyist',     name: 'Lobbyist',         category: 'team',   basePrice: 1800000, baseProfit: 34000, requires: { card: 'cfo', level: 5 } },

  // --- Special: unlocked by playing well ---
  { id: 'referral_hub', name: 'Referral Hub',     category: 'special', baseProfit: 900,  basePrice: 30000, requires: { referrals: 3 } },
  { id: 'vigo_vault',   name: 'VIGO Vault',       category: 'special', baseProfit: 3000, basePrice: 180000, requires: { referrals: 10 } },
  { id: 'streak_shrine',name: 'Streak Shrine',    category: 'special', baseProfit: 2000, basePrice: 120000, requires: { streak: 5 } },
];

export const CARD_CATEGORIES = [
  { id: 'rigs', name: 'Rigs' },
  { id: 'infra', name: 'Infra' },
  { id: 'team', name: 'Team' },
  { id: 'special', name: 'Special' },
];

export const CARD_MAX_LEVEL = 25;

export const cardById = new Map(CARDS.map((c) => [c.id, c]));

// Price grows faster than profit, so every card eventually plateaus and the
// player has to broaden their portfolio instead of maxing one thing.
export function cardPrice(card, currentLevel) {
  return Math.round(card.basePrice * Math.pow(1.75, currentLevel));
}

export function cardProfit(card, level) {
  if (level <= 0) return 0;
  return Math.round(card.baseProfit * level * Math.pow(1.12, level - 1));
}

export const OFFLINE_CAP_HOURS = 3;

// Daily login streak. Day 11+ keeps paying the day-10 reward.
export const DAILY_REWARDS = [500, 1000, 2500, 5000, 15000, 25000, 100000, 500000, 1000000, 5000000];

export function dailyReward(streakDay) {
  const idx = Math.min(streakDay, DAILY_REWARDS.length) - 1;
  return DAILY_REWARDS[Math.max(0, idx)];
}

export const REFERRAL_BONUS = { inviter: 5000, invitee: 2500, premiumInviter: 25000, premiumInvitee: 10000 };
// Cut of everything a referral taps that flows back to the inviter.
export const REFERRAL_TAP_SHARE = 0.1;

export const LEAGUES = [
  { id: 'wood',     name: 'Wooden',    min: 0 },
  { id: 'bronze',   name: 'Bronze',    min: 5000 },
  { id: 'silver',   name: 'Silver',    min: 50000 },
  { id: 'gold',     name: 'Gold',      min: 500000 },
  { id: 'platinum', name: 'Platinum',  min: 5000000 },
  { id: 'diamond',  name: 'Diamond',   min: 50000000 },
  { id: 'epic',     name: 'Epic',      min: 250000000 },
  { id: 'legend',   name: 'Legendary', min: 1000000000 },
];

export function leagueFor(totalEarned) {
  let current = LEAGUES[0];
  for (const l of LEAGUES) if (totalEarned >= l.min) current = l;
  return current;
}

// Hard ceiling on how fast a human can tap. Anything above this in a single
// sync batch is clamped rather than rejected, so laggy clients still work.
export const MAX_TAPS_PER_SECOND = 20;
