# BetPawa Local Bot

This is the **local execution worker** for the Lovable arbitrage dashboard.
It runs Puppeteer on your machine (Cloudflare Workers cannot run a browser),
polls the cloud database for commands, places bets on BetPawa, and reports
results back to the dashboard.

The cloud side (Agent Command Center → `/agent`) handles arb detection and
command queuing. This bot handles *execution only*.

---

## Architecture

```
 Lovable dashboard  ──insert──▶  agent_commands  ──poll──▶  bot/index.js
                                                            │
                                                            ├─ Puppeteer → BetPawa
                                                            │
 Lovable dashboard  ◀─realtime─  bet_logs, balances, agent_status
```

The bot does three things in parallel:

1. **Command loop** (every 2 s) — pulls pending rows from `agent_commands`
   and executes `start` / `pause` / `resume` / `stop` / `place_bet`
   / `manual` / `mug_bet` / `hedge` / `refresh_balances`.
2. **Heartbeat loop** (every 5 s) — upserts `agent_status` so the dashboard
   knows the bot is alive.
3. **Arb loop** (every 4 s, only when mode = `online`) — pulls unexpired,
   unacknowledged arbs from `arbs`, executes every leg whose `bookmaker`
   is `betpawa`, then marks the arb acknowledged.

Session cookies are cached in `session.json` (TTL 30 min) so the bot only
re-logs in when needed. Each failed bet is retried once.

---

## Setup

```bash
cd bot
cp .env.example .env
# fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BETPAWA_PHONE, BETPAWA_PASSWORD
npm install
npm start
```

To watch the browser instead of running headless:

```bash
npm run dev
```

Logs are written to `bot/logs/bot-YYYY-MM-DD.log` and to stdout.

---

## Where to get values

| Variable | Where |
| --- | --- |
| `SUPABASE_URL` | Lovable Cloud → backend URL (from your dashboard) |
| `SUPABASE_SERVICE_ROLE_KEY` | Lovable Cloud → service role key (treat as secret) |
| `BETPAWA_PHONE` | Your BetPawa account phone (e.g. `2557xxxxxxxx`) |
| `BETPAWA_PASSWORD` | Your BetPawa password |
| `TOTAL_INVESTMENT` | Bankroll cap — informational only |
| `ACCOUNT_LABEL` | Free-form label shown in the dashboard, default `primary` |

> **Never commit `.env` or `session.json`.** Both contain credentials.

---

## Expected `arbs.outcomes` shape

The bot reads each outcome looking for these fields. The cloud-side detector
writes them when an arb leg is on BetPawa:

```jsonc
{
  "outcome": "Home",
  "bookmaker": "betpawa",
  "price": 2.10,
  "stake": 50,
  "event_url": "https://www.betpawa.co.tz/event/12345",
  "outcome_selector": "[data-test-id='price-button-home']",  // optional
  "outcome_label": "Manchester United"                        // fallback
}
```

If `outcome_selector` is missing the bot falls back to clicking the first
price button whose text contains `outcome_label`.

---

## Production

Run under a process manager so it auto-restarts:

```bash
npm install -g pm2
pm2 start index.js --name betpawa-bot
pm2 logs betpawa-bot
```

Stop with `pm2 stop betpawa-bot` or `Ctrl+C` in the foreground.