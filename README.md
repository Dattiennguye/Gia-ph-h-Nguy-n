# ⛏️ VIGO Miner

A tap-to-earn Telegram Mini App. Tap the coin to mine VIGO, spend it on rigs
that keep mining while you are offline, and climb the leagues.

Built as a plain Node + SQLite server with a dependency-free vanilla-JS client —
no build step, no bundler, no framework.

## Gameplay

| System | How it works |
| --- | --- |
| **Tapping** | Each tap mines `multitap` VIGO and burns the same amount of energy. |
| **Energy** | Regenerates continuously. Max size and refill rate are upgradeable. |
| **Boosters** | *Full Energy* (6/day) refills the bar; *Turbo* (3/day) gives 5× tap power for 20s. |
| **Upgrades** | Multitap, Energy Limit, Recharge Speed — permanent, priced exponentially. |
| **Rigs** | 18 cards across Rigs / Infra / Team / Special that pay VIGO per hour, offline included (capped at 3h). |
| **Unlocks** | Late cards gate behind another card's level, a referral count, or a login streak. |
| **Daily reward** | A 10-day escalating streak, 500 → 5,000,000 VIGO. Miss a day and it restarts. |
| **Referrals** | Both sides get a joining bonus (more for Premium), and the inviter keeps 10% of everything their friends tap. |
| **Leagues** | Eight tiers from Wooden to Legendary, ranked on lifetime earnings. |

Every number lives in [`src/game/rules.js`](src/game/rules.js) — change balance
there and both the server and the client follow.

## Running it

```bash
npm install
cp .env.example .env     # then fill in BOT_TOKEN and WEB_APP_URL
npm start                # the mini app + API on :3000
npm run bot              # the Telegram bot, in a second terminal
npm test                 # 20 end-to-end API tests
```

Requires **Node 22.5+** — the database uses the built-in `node:sqlite`, so
there is nothing to compile.

### Setting up the bot

1. `/newbot` in [@BotFather](https://t.me/BotFather) → copy the token into `BOT_TOKEN`.
2. Serve this app over **HTTPS** (Telegram refuses plain http). While developing:
   `cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`, then put
   that URL in `WEB_APP_URL`.
3. `/newapp` in @BotFather → point it at the same URL, and put its short name in
   `WEB_APP_SHORT_NAME`.
4. Put the bot's username (no `@`) in `BOT_USERNAME` so referral links resolve.

### Playing in a normal browser

Set `ALLOW_DEV_AUTH=1` and open `http://localhost:3000/?dev=123`. That bypasses
the Telegram signature entirely, so keep it off anywhere public.

## How it fits together

```
src/
  index.js        Express: serves /api and the static mini app
  config.js       env → typed config
  db.js           node:sqlite schema, WAL, transaction helper
  auth.js         initData HMAC verification + signed session tokens
  bot.js          grammY bot: /start /stats /invite /top
  game/
    rules.js      all balance numbers, prices, unlock requirements
    engine.js     game state machine — the only thing that writes progress
  routes/api.js   HTTP surface
public/           index.html + styles.css + app.js (the mini app)
test/api.test.js  end-to-end tests over real HTTP
```

## Trust model

The client is treated as hostile; it renders state and reports intent, and the
server decides what actually happened.

- **`initData` is verified** with the documented HMAC-SHA256 scheme, in constant
  time, and rejected once it is older than `INIT_DATA_MAX_AGE`. It is checked
  once at `/api/auth`, which returns a signed, 12-hour session token used for
  everything after that.
- **Time is never taken from the client.** Energy regen and offline mining are
  computed from timestamps stored server-side, so a manipulated device clock
  earns nothing.
- **Taps are clamped, not trusted.** A batch is paid out only up to the energy
  actually available and a 20 taps/second human ceiling; anything above that is
  silently dropped rather than rejected, so laggy clients still work.
- **Prices, unlocks and rewards are re-derived server-side** on every purchase.
  A card that the client thinks is unlocked still fails with `locked` if it isn't.
- **Referrals cannot be self-assigned**, and the joining bonus is paid exactly
  once, inside the same transaction that creates the account.

## API

All routes take `Authorization: Bearer <token>` except `/api/auth` and `/api/health`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth` | Verify `initData`, create the player, return a token + full state |
| `GET` | `/api/state` | Current state, plus anything mined while away |
| `POST` | `/api/tap` | Bank a batch of taps (`{ taps: n }`) |
| `POST` | `/api/boost/:id` | Buy a permanent upgrade |
| `POST` | `/api/card/:id` | Buy or level up a rig |
| `POST` | `/api/booster/:id` | Use a free daily booster |
| `POST` | `/api/daily` | Claim the daily streak reward |
| `GET` | `/api/leaderboard` | Top 100, plus the caller's own rank |
| `GET` | `/api/referrals` | Friend list, totals and invite link |

Errors come back as `{ error: "<code>", message }` with HTTP 400 — for example
`insufficient_funds`, `locked`, `max_level`, `no_charges`, `already_claimed`.
