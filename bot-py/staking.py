"""Auto-stake sizing — Python port of bot/staking.js."""
import time
import supabase_rest as sb

_TTL = 15
_cache = {"at": 0, "val": None}

DEFAULTS = {
    "bankroll": 0,
    "max_stake_pct": 2.0,
    "max_stake_abs": 1000.0,
    "min_stake_abs": 1.0,
    "min_edge_pct": 1.0,
    "kelly_fraction": 0.25,
    "auto_stake_enabled": False,
}

def get_settings():
    now = time.time()
    if _cache["val"] and now - _cache["at"] < _TTL:
        return _cache["val"]
    try:
        row = sb.fetch_risk_settings()
    except Exception as e:
        print(f"[risk_settings] fetch failed: {e}")
        row = None
    val = dict(DEFAULTS)
    if row:
        for k in DEFAULTS:
            if row.get(k) is not None:
                val[k] = row[k]
    _cache.update(at=now, val=val)
    return val

def size_stake(leg_odds, edge_pct, settings, total_legs=2):
    if not settings.get("auto_stake_enabled"):
        return None
    try:
        leg_odds = float(leg_odds)
        edge_pct = float(edge_pct)
    except Exception:
        return 0
    if leg_odds <= 1:
        return 0
    if edge_pct < float(settings.get("min_edge_pct", 0)):
        return 0
    bankroll = float(settings.get("bankroll") or 0)
    if bankroll <= 0:
        return 0
    edge = edge_pct / 100.0
    kelly = (edge * float(settings.get("kelly_fraction", 0.25))) / max(total_legs, 1)
    kelly_stake = bankroll * kelly * leg_odds
    pct_cap = bankroll * (float(settings.get("max_stake_pct", 0)) / 100.0)
    stake = min(kelly_stake, pct_cap, float(settings.get("max_stake_abs", 1e12)))
    if stake < float(settings.get("min_stake_abs", 0)):
        return 0
    return int(stake * 100) / 100.0