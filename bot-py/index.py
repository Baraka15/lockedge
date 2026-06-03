"""Pydroid3-friendly BetPawa bot.

Run in Pydroid3:
    1. Pip install: `requests`
    2. Open this folder, edit `local_config.example.py` → save as `local_config.py`
    3. Press the orange ► button on `index.py`

The bot polls Lovable Cloud for commands + open arbs, sizes stakes
from your `risk_settings` (bankroll / Kelly / caps), and either dry-runs
or places real bets on BetPawa.
"""
import time
import traceback
import supabase_rest as sb
import staking
import betpawa
from config import (
    AGENT_ID, ACCOUNT_LABEL, DRY_RUN,
    COMMAND_POLL_S, HEARTBEAT_S, ARB_POLL_S,
)

mode = "paused"   # online | paused | error
stopping = False

def log(msg, **kw):
    extra = " ".join(f"{k}={v}" for k, v in kw.items())
    print(f"[{time.strftime('%H:%M:%S')}] {msg} {extra}".rstrip())

# --------------- execution ---------------
def execute_bet(arb_id, outcome, stake, odds, event_url=None, outcome_selector=None, outcome_label=None):
    last_err = None
    for attempt in (1, 2):
        try:
            result, balance = betpawa.place_bet(
                arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label,
            )
            sb.log_bet(arb_id, outcome, odds, stake, result,
                       details={"attempt": attempt, "event_url": event_url, "dry_run": bool(DRY_RUN)})
            if balance is not None:
                try: sb.upsert_balance(balance)
                except Exception as e: log("upsert_balance failed", error=str(e))
            if result in ("success", "dry_run"):
                return result
        except Exception as e:
            last_err = e
            log("bet attempt failed", attempt=attempt, error=str(e))
    sb.log_bet(arb_id, outcome, odds, stake, "failed",
               details={"error": str(last_err) if last_err else "unknown"})
    return "failed"

def process_arb(arb):
    log("Processing arb", id=arb["id"], event=arb.get("event_name"))
    outcomes = arb.get("outcomes") or []
    settings = staking.get_settings()
    edge_pct = float(arb.get("total_arb_percent") or 0)
    if settings.get("auto_stake_enabled") and edge_pct < float(settings.get("min_edge_pct", 0)):
        log("Skipping arb below min edge", edge=edge_pct, min=settings["min_edge_pct"])
        sb.ack_arb(arb["id"]); return
    for o in outcomes:
        if stopping or mode != "online": return
        if (o.get("bookmaker") or "").lower() != "betpawa":
            log("Skipping non-betpawa leg", bookmaker=o.get("bookmaker"))
            continue
        leg_odds = o.get("price") or o.get("odds") or 0
        auto = staking.size_stake(leg_odds, edge_pct, settings, total_legs=len(outcomes))
        stake = auto if auto is not None else float(o.get("stake") or o.get("recommended_stake") or 0)
        if stake <= 0:
            log("Stake sized to zero — skipping leg", outcome=o.get("outcome"))
            continue
        execute_bet(
            arb["id"], o.get("outcome"), stake, leg_odds,
            event_url=o.get("event_url"),
            outcome_selector=o.get("outcome_selector"),
            outcome_label=o.get("outcome_label") or o.get("outcome"),
        )
    sb.ack_arb(arb["id"])

# --------------- commands ---------------
def handle_command(cmd):
    global mode
    log("Command", id=cmd["id"], command=cmd["command"])
    try:
        c = cmd["command"]
        if c in ("start", "resume"):
            mode = "online"; sb.push_heartbeat("online", {"reason": c})
        elif c in ("pause", "stop"):
            mode = "paused"; sb.push_heartbeat("paused", {"reason": c})
        elif c == "refresh_balances":
            betpawa.login()
            bal = betpawa.read_balance()
            if bal is not None: sb.upsert_balance(bal)
        elif c in ("place_bet", "manual", "mug_bet", "hedge"):
            p = cmd.get("payload") or {}
            execute_bet(
                p.get("arb_id"), p.get("outcome", "manual"),
                float(p.get("stake") or 0), float(p.get("odds") or 0),
                event_url=p.get("event_url"),
                outcome_selector=p.get("outcome_selector"),
                outcome_label=p.get("outcome_label"),
            )
        else:
            log("Unknown command", command=c)
        sb.mark_command(cmd["id"], "executed")
    except Exception as e:
        log("Command failed", id=cmd["id"], error=str(e))
        try: sb.mark_command(cmd["id"], "failed")
        except Exception: pass

# --------------- main loop (single-thread, mobile-friendly) ---------------
def main():
    log("BetPawa bot starting", agent=AGENT_ID, dry_run=bool(DRY_RUN))
    sb.push_heartbeat(mode, {"boot": True, "runtime": "pydroid3"})
    last_hb = 0; last_arb = 0; last_cmd = 0
    while not stopping:
        now = time.time()
        try:
            if now - last_cmd >= COMMAND_POLL_S:
                last_cmd = now
                for c in sb.fetch_pending_commands():
                    handle_command(c)
            if now - last_hb >= HEARTBEAT_S:
                last_hb = now
                sb.push_heartbeat(mode)
            if now - last_arb >= ARB_POLL_S and mode == "online":
                last_arb = now
                for a in sb.fetch_open_arbs():
                    if mode != "online": break
                    process_arb(a)
        except KeyboardInterrupt:
            break
        except Exception as e:
            log("loop error", error=str(e))
            traceback.print_exc()
        time.sleep(0.5)
    try: sb.push_heartbeat("offline", {"reason": "shutdown"})
    except Exception: pass
    log("Bot stopped.")

if __name__ == "__main__":
    main()