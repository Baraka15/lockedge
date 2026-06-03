"""Tiny Supabase REST wrapper — no SDK, just `requests`.

Pydroid3 ships requests but not supabase-py, so this module talks to
PostgREST directly. Same auth model as the JS SDK: apikey + Bearer.
"""
import json
import time
import requests
from config import SUPABASE_URL, SUPABASE_KEY, AGENT_ID, ACCOUNT_LABEL, BOOKMAKER

BASE = SUPABASE_URL.rstrip("/") + "/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

def _req(method, path, **kw):
    url = BASE + path
    headers = dict(HEADERS)
    headers.update(kw.pop("headers", {}))
    r = requests.request(method, url, headers=headers, timeout=20, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{method} {path} -> {r.status_code} {r.text[:200]}")
    return r.json() if r.text else None

# ---------- agent_status ----------
def push_heartbeat(status, metadata=None):
    body = [{
        "agent_id": AGENT_ID,
        "status": status,
        "last_heartbeat": _now_iso(),
        "version": "py-1.0.0",
        "metadata": metadata or {},
    }]
    return _req(
        "POST", "/agent_status",
        headers={"Prefer": "resolution=merge-duplicates"},
        data=json.dumps(body),
        params={"on_conflict": "agent_id"},
    )

# ---------- agent_commands ----------
def fetch_pending_commands(limit=10):
    return _req(
        "GET", "/agent_commands",
        params={
            "status": "eq.pending",
            "order": "created_at.asc",
            "limit": str(limit),
            "select": "*",
        },
    ) or []

def mark_command(cmd_id, status):
    return _req(
        "PATCH", "/agent_commands",
        params={"id": f"eq.{cmd_id}"},
        data=json.dumps({"status": status, "executed_at": _now_iso()}),
    )

# ---------- arbs ----------
def fetch_open_arbs(limit=5):
    return _req(
        "GET", "/arbs",
        params={
            "is_acknowledged": "eq.false",
            "expires_at": f"gt.{_now_iso()}",
            "order": "detected_at.asc",
            "limit": str(limit),
            "select": "*",
        },
    ) or []

def ack_arb(arb_id):
    return _req(
        "PATCH", "/arbs",
        params={"id": f"eq.{arb_id}"},
        data=json.dumps({"is_acknowledged": True}),
    )

# ---------- bet_logs ----------
def log_bet(arb_id, outcome, odds, stake, result, details=None, bet_type="back"):
    row = {
        "arb_id": arb_id,
        "account_label": ACCOUNT_LABEL,
        "bookmaker": BOOKMAKER,
        "outcome": outcome,
        "bet_type": bet_type,
        "odds": odds,
        "stake": stake,
        "result": result,
        "details": details or {},
    }
    return _req("POST", "/bet_logs", data=json.dumps([row]))

# ---------- balances ----------
def upsert_balance(balance, pending=0):
    body = [{
        "bookmaker": BOOKMAKER,
        "account_label": ACCOUNT_LABEL,
        "balance": balance,
        "pending_returns": pending,
        "last_updated": _now_iso(),
    }]
    return _req(
        "POST", "/balances",
        headers={"Prefer": "resolution=merge-duplicates"},
        params={"on_conflict": "bookmaker,account_label"},
        data=json.dumps(body),
    )

# ---------- risk_settings ----------
def fetch_risk_settings():
    rows = _req(
        "GET", "/risk_settings",
        params={"account_label": f"eq.{ACCOUNT_LABEL}", "select": "*", "limit": "1"},
    ) or []
    return rows[0] if rows else None

def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())