"""BetPawa HTTP client — best-effort mobile-friendly automation.

Pydroid3 can't run Puppeteer/Chromium. This client uses `requests`
against the BetPawa mobile-web endpoints. The exact bet-placement API
changes from country to country; the structure below mirrors the flow
used by Swai-D/bet-bot but speaks HTTP instead of clicking the DOM.

If a real bet call fails (HTML form, captcha, JS-rendered page), the
bot logs the leg with result="failed" and keeps running, so it is
ALWAYS safe to leave DRY_RUN=1 until you've confirmed your country's
endpoints.
"""
import re
import requests
from config import BETPAWA_URL, BETPAWA_PHONE, BETPAWA_PASSWORD, DRY_RUN

_session = requests.Session()
_session.headers.update({
    "User-Agent": "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
})
_logged_in = False

def login():
    """Login once and reuse the cookie jar. Returns True on success."""
    global _logged_in
    if _logged_in:
        return True
    if not BETPAWA_PHONE or not BETPAWA_PASSWORD:
        print("[betpawa] no credentials configured — DRY_RUN forced on")
        return False
    try:
        # Warm the session (sets CSRF / device cookies).
        _session.get(f"{BETPAWA_URL}/login", timeout=15)
        r = _session.post(
            f"{BETPAWA_URL}/api/login",
            json={"phone": BETPAWA_PHONE, "password": BETPAWA_PASSWORD},
            timeout=15,
        )
        if r.status_code == 200 and "token" in (r.text or "").lower():
            _logged_in = True
            return True
        print(f"[betpawa] login HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        print(f"[betpawa] login error: {e}")
    return False

def read_balance():
    if DRY_RUN or not _logged_in:
        return None
    try:
        r = _session.get(f"{BETPAWA_URL}/api/account/balance", timeout=15)
        if r.status_code == 200:
            data = r.json()
            return float(data.get("balance") or data.get("amount") or 0)
    except Exception as e:
        print(f"[betpawa] balance error: {e}")
    return None

def place_bet(arb_id, outcome, stake, odds, event_url=None, outcome_selector=None, outcome_label=None):
    """Return (result, balance_or_none).

    result ∈ {"success", "failed", "dry_run"}.
    """
    if DRY_RUN:
        print(f"[DRY_RUN] would place {outcome} stake={stake} @ {odds}")
        return ("dry_run", None)
    if not login():
        return ("failed", None)
    try:
        # Pull event page to discover the selection id.
        sel_id = outcome_selector
        if not sel_id and event_url:
            page = _session.get(event_url, timeout=15).text
            m = re.search(r'data-selection-id="(\d+)"[^>]*>\s*' + re.escape(outcome_label or outcome), page)
            if m:
                sel_id = m.group(1)
        if not sel_id:
            return ("failed", None)
        payload = {
            "stake": float(stake),
            "selections": [{"id": sel_id, "odds": float(odds)}],
            "acceptOddsChange": False,
        }
        r = _session.post(f"{BETPAWA_URL}/api/bets", json=payload, timeout=20)
        if r.status_code in (200, 201):
            bal = None
            try:
                bal = float(r.json().get("balance"))
            except Exception:
                pass
            return ("success", bal)
        print(f"[betpawa] place_bet HTTP {r.status_code}: {r.text[:120]}")
    except Exception as e:
        print(f"[betpawa] place_bet error: {e}")
    return ("failed", None)