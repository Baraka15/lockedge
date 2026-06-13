# Lockedge Arbitrage Bot v3 - Production Deployment

## Overview

**Zero-risk arbitrage betting bot** optimized for Uganda market (BetPawa, 22Bet, SportPesa, Betway).

- **Bankroll**: 250,000 UGX
- **Daily Target**: 5% growth (~12,500 UGX)
- **Min Edge**: 0.8% (won't place below)
- **Strong Arbs**: 1.5%+ (aggressive staking)
- **Exposure Limit**: 40% of bankroll across open arbs
- **Emergency Stop**: -8% daily loss triggers pause

## Quick Start

### 1. Environment Setup

```bash
cp bot/.env.example bot/.env
# Edit bot/.env with your credentials
```

**Required:**
- Supabase credentials (for state & logging)
- At least 2 bookmaker credentials (BetPawa + 22Bet recommended)
- Telegram token & chat ID (for alerts)

### 2. Install & Run

```bash
npm install
node bot/index.js
```

### 3. Send Commands via Telegram or DB

```sql
-- Resume bot (starts scanning for arbs)
INSERT INTO commands (action) VALUES ('resume');

-- Pause bot
INSERT INTO commands (action) VALUES ('pause');

-- Stop bot (graceful shutdown)
INSERT INTO commands (action) VALUES ('stop');
```

## Architecture

### Core Files

| File | Purpose |
|------|----------|
| `bot/staking.js` | Advanced Kelly calculator, exposure control, performance tracking |
| `bot/index.js` | Main loop: command handler, parallel arb processor, hedging |
| `bot/bookmakers/*.js` | Bookmaker drivers (BetPawa, 22Bet, SportPesa, Betway) |
| `bot/notifications.js` | Telegram alerts |
| `bot/logger.js` | Structured logging |
| `bot/balance-sync.js` | Real-time balance polling |
| `bot/supabase.js` | Database layer |

### Staking Logic

**Fractional Kelly with Dynamic Boosts:**

```
Base Kelly = 0.28 (conservative)

Boosts:
1. Edge Boost: 1x to 2x (stronger edges = higher stakes)
2. Multi-Leg Bonus: 1.2x for 3+ legs (safer)
3. Strong Arb Bonus: 1.15x for 1.5%+ edge
4. Performance Boost: 0.8x to 1.2x (adjust based on daily gains)

Final Kelly = Base × Edge × Multi-Leg × Strong-Arb × Performance
Stake = Bankroll × Final Kelly × Odds

Caps: min 5k UGX, max 80k UGX, max 35% of bankroll
```

### Exposure Control

- **Max Exposure**: 40% of bankroll (100k UGX) across all open arbs
- **Max Open Arbs**: 8 simultaneous arbs
- **Real-time Tracking**: Query DB before each placement
- **Auto-Hedge**: If some legs fail, hedge the placed legs

### Real-Time Protection

1. **Odds Drift Detection** (1% tolerance)
   - If odds move >1% before placement → skip or abort
   - Alert user of drift amount

2. **Partial Fill Hedging**
   - If only some legs place → calculate hedge stake
   - Hedge 50% of placed exposure

3. **Consecutive Failure Tracking**
   - After 3 failures → auto-pause
   - Reset on successful placement

4. **Daily Loss Stop**
   - If daily loss > -8% → emergency pause
   - Human review required to resume

## Monitoring

### Telegram Alerts

- 🚀 **Startup**: Bot initialized
- ✅ **Placement**: Arb placed successfully (with stake & projected ROI)
- ⚠️ **Odds Drift**: Live odds moved beyond tolerance
- 🛡️ **Hedge**: Rescue hedge placed for partial fill
- ⛔ **Auto-Pause**: Too many failures or excessive loss
- 📊 **Status**: Mode changes (pause/resume/stop)
- 📈 **Daily Report**: End-of-day performance

### Database Queries

```sql
-- Check today's bets
SELECT * FROM bet_log WHERE DATE(created_at) = TODAY();

-- Check open arb sessions
SELECT * FROM bet_sessions WHERE status != 'complete';

-- Check balance history
SELECT * FROM balance_history ORDER BY created_at DESC LIMIT 10;

-- Send commands
INSERT INTO commands (action, params) VALUES ('pause', '{}');
```

## Risk Management

### Zero-Risk Surebets Only

- Won't place if edge < 0.8%
- Won't place if exposure limit would be exceeded
- Won't place if odds drift detected
- Automatic hedging on partial fills

### Conservative Defaults

- Fractional Kelly (0.28) instead of full Kelly
- 3x redundancy on failed placements (2 retries)
- 8-second timeout per arb (prevents hanging)
- Daily exposure logging

## Advanced Customization

### Adjust Risk Settings in Supabase

```json
{
  "account_label": "uganda-main",
  "bankroll": 250000,
  "kelly_fraction": 0.28,
  "min_edge_pct": 0.8,
  "max_stake_pct": 35,
  "max_bankroll_exposure_pct": 40,
  "odds_drift_tolerance_pct": 1.0,
  "daily_loss_stop_pct": -8.0
}
```

### Customize Bookmakers

Each driver is independent. To add a new bookmaker:

1. Create `bot/bookmakers/mynewbm.js`
2. Export: `id`, `name`, `isConfigured()`, `placeBet()`, `verifyOdds()`, `getBalance()`, `shutdown()`
3. Add to `bot/bookmakers/index.js`
4. Add env vars to `.env`

## Troubleshooting

### "Bot not placing arbs"
- Check mode is "running" (not "paused")
- Verify bookmaker credentials are correct
- Check Supabase connection
- Look for edge < 0.8% in logs
- Check exposure hasn't exceeded 40%

### "Telegram not sending"
- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
- Test with: `curl -X POST https://api.telegram.org/botXXX/sendMessage -d 'chat_id=YYY&text=test'`

### "Placement failures"
- Check bookmaker availability: `curl https://bookmaker.com/health`
- Verify credentials aren't expired
- Check firewall/IP whitelisting
- Look for rate limiting in logs

## Performance Expectations

**Conservative Scenario (0.8% edge, 2-leg arbs):**
- Daily income: ~2,000-5,000 UGX (0.8-2%)
- Weekly: ~14,000-35,000 UGX
- Monthly: ~60,000-150,000 UGX

**Optimal Scenario (1.5%+ edge, 3-leg arbs):**
- Daily income: ~5,000-12,500 UGX (2-5%)
- Weekly: ~35,000-87,500 UGX
- Monthly: ~150,000-375,000 UGX

*Results depend on arb availability and market conditions.*

## Safety First

✅ **Always enabled:**
- Zero-risk surebets only
- Real-time exposure tracking
- Odds drift protection
- Automatic hedging
- Emergency stop on excessive loss
- Detailed logging & alerts

⚠️ **Never:**
- Run without Telegram alerts configured
- Place without real bankroll verification
- Disable exposure limits
- Use full Kelly (use 0.2-0.3)
- Place bets manually while bot is running

---

**Questions?** Check logs in `bot/logs/` or review recent Telegram alerts.
