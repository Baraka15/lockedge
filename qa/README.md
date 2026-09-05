# QA / development-only browser checks

Local, on-demand browser tests for **our own app**. Nothing here runs in
production, nothing here is imported by `src/`, and nothing here is deployed —
so it adds **zero always-on cloud cost**.

Puppeteer comes from the official upstream npm package
([`puppeteer`](https://www.npmjs.com/package/puppeteer), source:
<https://github.com/puppeteer/puppeteer>) and is installed as a
**devDependency** only. The upstream repository is not vendored into this
project.

## Hard boundaries (do not cross)

These scripts must never:

- log in to a bookmaker, or open a bookmaker page in a browser;
- select a market, fill a bet slip, enter a stake, or submit a wager;
- attempt CAPTCHA solving, anti-bot evasion, fingerprint spoofing, or any form
  of account-security circumvention;
- navigate off our own origin. `qa/lib/browser.js` enforces this in
  `assertOwnOrigin()` — any cross-origin `goto` throws.

Bookmaker links are checked in `qa/checks/links.js`, which contains **no
Puppeteer import at all**: it only builds the URL from the app's own link module
and confirms it is a well-formed https URL on the expected official host that
answers a request. Bet placement stays manual, by hand, always.

## Setup

Puppeteer downloads its own Chrome on install. If it was skipped:

```bash
bunx puppeteer browsers install chrome
```

Configure the run with environment variables (never commit real credentials):

| Variable       | Default                 | Meaning                                        |
| -------------- | ----------------------- | ---------------------------------------------- |
| `QA_BASE_URL`  | `http://localhost:8080` | App under test (local dev, preview, or live)   |
| `QA_EMAIL`     | —                       | Test account email (required for auth checks)  |
| `QA_PASSWORD`  | —                       | Test account password                          |
| `QA_HEADFUL`   | unset                   | Set to `1` to watch the browser                |
| `QA_SHOT_DIR`  | `qa/screenshots`        | Where screenshots are written                  |
| `QA_SKIP_NETWORK` | unset                | Skip outbound host checks in the link test     |

Use a dedicated test account, not your operator account.

## Running

```bash
# app checks: login, dashboard, realtime rendering, PLACE BET states, ABORT
QA_EMAIL=test@example.com QA_PASSWORD=... bun run qa:app

# against the published site
QA_BASE_URL=https://lockedge.lovable.app QA_EMAIL=... QA_PASSWORD=... bun run qa:app

# bookmaker link generation + reachability (no browser involved)
bun run qa:links

# both
bun run qa
```

Each check prints `[PASS]` / `[FAIL]` and the run exits non-zero if anything
failed, so it drops straight into CI if you ever want it there.

## What `qa:app` verifies

1. `/login` renders the email + password form.
2. Sign-in with a real session leaves `/login` (auth is not bypassed or weakened).
3. `/dashboard` renders content and shows no raw `Failed to fetch` text.
4. The dashboard stays mounted while realtime updates stream in.
5. `PLACE BET` reaches a validation state — either blocked with the exact
   message `ARB INVALID — ODDS CHANGED.` or verified with recalculated stakes.
   `window.open` is stubbed, so bookmaker URLs are **captured and asserted, not
   opened**.
6. `ABORT` clears the workflow.
7. No console errors during the run.

If the feed has no live opportunity at that moment, step 5 reports a fail with
an explanatory note — re-run when an opportunity is on screen.

## Screenshots

Written to `qa/screenshots/` (git-ignored).
