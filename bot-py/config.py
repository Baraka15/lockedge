"""Config for the Pydroid3 BetPawa bot.

Pydroid3 has no real .env loader, so we read os.environ first and fall
back to the values written into `local_config.py` next to this file.
Copy `local_config.example.py` to `local_config.py` and edit it once.
"""
import os

try:
    import local_config as _lc  # type: ignore
except Exception:
    _lc = None

def _get(name, default=""):
    v = os.environ.get(name)
    if v:
        return v
    if _lc is not None and hasattr(_lc, name):
        return getattr(_lc, name)
    return default

SUPABASE_URL = _get("SUPABASE_URL") or _get("VITE_SUPABASE_URL")
SUPABASE_KEY = (
    _get("SUPABASE_SERVICE_ROLE_KEY")
    or _get("SUPABASE_ANON_KEY")
    or _get("VITE_SUPABASE_ANON_KEY")
    or _get("VITE_SUPABASE_PUBLISHABLE_KEY")
)

BETPAWA_URL = _get("BETPAWA_URL", "https://www.betpawa.co.tz")
BETPAWA_PHONE = _get("BETPAWA_PHONE")
BETPAWA_PASSWORD = _get("BETPAWA_PASSWORD")

AGENT_ID = _get("AGENT_ID", "pydroid-primary")
ACCOUNT_LABEL = _get("ACCOUNT_LABEL", "primary")
BOOKMAKER = "betpawa"
DRY_RUN = _get("DRY_RUN", "1") not in ("0", "false", "False", "")

COMMAND_POLL_S = 2
HEARTBEAT_S = 5
ARB_POLL_S = 4

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit(
        "Missing Supabase credentials. Edit bot-py/local_config.py and set "
        "SUPABASE_URL and SUPABASE_ANON_KEY (copy from the Lovable dashboard "
        "→ Agent → Copy Bot .env)."
    )