# BetPawa bot — Pydroid3 edition

A pure-Python port of `bot/` that runs on your **Android phone** via
[Pydroid3](https://play.google.com/store/apps/details?id=ru.iiec.pydroid3).
No Node, no Chromium, no laptop required.

## What it does
- Polls Lovable Cloud for `agent_commands` and open `arbs`
- Sends heartbeats so the dashboard shows you as **online**
- Sizes stakes from your **Risk Settings** (bankroll · Kelly · caps)
- Places bets on BetPawa over plain HTTP (or runs in dry-run mode)

## Setup (5 minutes)
1. Install **Pydroid3** + **Pydroid Repository plugin** from the Play Store.
2. Copy this `bot-py/` folder to your phone (Google Drive, USB, or just
   download from your Lovable project zip).
3. Open Pydroid3 → **☰ → Pip** → install `requests`.
4. Open `local_config.example.py`, **Save as** → `local_config.py`,
   fill in `BETPAWA_PHONE` + `BETPAWA_PASSWORD`. Supabase keys are
   already pre-filled from your Lovable project.
5. Open `index.py` and hit the orange ▶ button.

You should see `BetPawa bot starting agent=pydroid-primary dry_run=True`,
and the Agent Command Center shield should turn **green** within ~5s.

## Safety
- `DRY_RUN = "1"` is the default. The bot will log fake bets to
  `bet_logs` with result `dry_run` so you can verify the full pipeline
  end-to-end before risking real money.
- Flip `DRY_RUN = "0"` in `local_config.py` only after you've:
  - confirmed the dashboard shows the bot online,
  - placed at least one successful dry-run bet,
  - set sensible numbers in **Risk Settings** (bankroll, max stake %, Kelly).

## Risk settings
Open the Lovable dashboard → **Agent Command Center** → **Risk Settings**:
- **Bankroll** — total money the bot is allowed to size against
- **Max stake %** — hard cap as % of bankroll per leg (e.g. 2%)
- **Max stake (abs)** — absolute ceiling per leg (e.g. 1000)
- **Min stake** — skip arbs that would size below this
- **Min edge %** — skip arbs below this implied profit
- **Kelly fraction** — 0.25 = quarter-Kelly (conservative). 1.0 = full Kelly.
- **Auto-stake enabled** — when off, the bot uses the stake suggested by the engine instead.

## Keeping it alive on Android
- Disable battery optimisation for Pydroid3 (Settings → Battery → Pydroid3 → Don't optimise).
- Keep the screen on while the bot runs (Pydroid3 → Settings → Keep screen on).
- For 24/7 use, run the Node version (`bot/`) on a small VPS instead.