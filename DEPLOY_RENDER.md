# Deploying to Render with your own Supabase

Primary external deployment path: the web app runs on Render, the database and
auth live in **your** Supabase project, and the recurring odds scan runs on a
scheduler you control. No credentials belong in this file or anywhere in the repo.

> Do not switch production over until your own Supabase project is connected and
> its migrations are applied. Until then, keep using the current hosted backend.

---

## 1. Connect your own Supabase

1. Create a project at supabase.com (pick a region close to your users).
2. In this app's **Project Settings → Supabase/Backend**, connect that project so
   the generated client and types point at it.
3. Copy its API URL, publishable (anon) key and service-role key. Paste them only
   into Render's Environment tab — never into files in this repository.

## 2. Apply the database schema

All schema lives in `supabase/migrations/` and applies in filename order.

```bash
npm i -g supabase           # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push            # applies every migration in order
```

Then verify in your project:

- the tables exist (`arbs`, `live_events`, `master_fixtures`, `executions`,
  `risk_settings`, `user_roles`, …) and RLS is enabled on each;
- your account has a row in `user_roles` with role `operator` or `admin` — most
  dashboard reads and all execution writes are gated on `public.is_operator()`;
- Realtime is enabled for `arbs`, `live_events` and `executions`.

## 3. Import the repo on Render

1. Push this repository to GitHub.
2. Render → **New → Blueprint**, select the repo. `render.yaml` at the root
   defines the service, so Render fills everything in. (Prefer manual setup?
   New → Web Service, runtime **Node**, and use the commands below.)

| Setting | Value |
| --- | --- |
| Build command | `npm install && npm run build` |
| Start command | `npm run start` |
| Health check path | `/api/engine-status` |
| Node version | 22 (`NODE_VERSION`) |

The build reads `DEPLOY_TARGET=node-server` (already set in `render.yaml`) and
produces a standard Node server at `dist/server/index.mjs`, which `npm run start`
launches on Render's `PORT`. Nothing in the runtime depends on Lovable Cloud —
all backend access goes through `@supabase/supabase-js` and the environment
variables below.

## 4. Environment variables

Set these in Render → your service → **Environment**. `render.yaml` lists them
with `sync: false`, meaning you supply the values in the dashboard.

| Name | Scope | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | Your project's API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Publishable/anon key (safe to expose) |
| `VITE_SUPABASE_PROJECT_ID` | browser | Project ref |
| `SUPABASE_URL` | server | Same URL, read by server code |
| `SUPABASE_PUBLISHABLE_KEY` | server | Verifies user bearer tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Secret.** Bypasses RLS — server only |
| `POLL_SECRET` | server | Recommended; protects the scan endpoint (step 5) |
| `POLL_INTERVAL_MS` | server | Optional, default `2000` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | server | Optional alerts |
| `THEODDSAPI_KEY` | server | Optional odds provider |
| `NODE_VERSION` | build | `22` |
| `DEPLOY_TARGET` | build | `node-server` |

`VITE_*` values are inlined at build time — after changing one, trigger a
redeploy so the browser bundle picks it up. `.env.example` mirrors this list for
local development.

## 5. Where the recurring scan runs

**Render's free instance type sleeps after ~15 minutes without traffic and cold
starts on the next request.** A sleeping service cannot scan reliably: cycles are
missed, and the first request after a sleep is slow enough to lose short-lived
opportunities. Two honest options:

- **Paid always-on instance** (Starter or above) — no sleeping, and the health
  check keeps the service warm. This is what `render.yaml` sets (`plan: starter`).
- **Free instance for the dashboard only**, accepting that scans lag and gap.

Either way, the scan is triggered over HTTP by a scheduler you operate — the web
service itself does not loop forever in the background:

```
POST https://<your-service>.onrender.com/api/public/poll
Authorization: Bearer <POLL_SECRET>
```

Each call runs repeated scan cycles for roughly 50 seconds, then returns. Set
`POLL_SECRET` in Render; unauthenticated calls are rejected with 401.

Pick one scheduler:

**a) Supabase pg_cron + pg_net** (recommended — lives beside your data). In the
Supabase SQL editor enable `pg_cron` and `pg_net`, then schedule a job that runs
every minute and `net.http_post`s to the poll URL with the Authorization header
and a ~55 s timeout. Keep the secret in Supabase Vault, not inline in the job.
Running every minute means 1,440 calls a day; that cadence is what keeps the feed
real-time, and it does keep the database busy continuously, so expect steady
usage rather than idle. A 5-minute cadence costs far less but can miss edges that
only live for seconds.

**b) Supabase scheduled Edge Function** — a tiny function that `fetch`es the poll
URL with the header, scheduled every minute. Useful if you prefer keeping the
secret in Edge Function secrets.

**c) Render Cron Job** (paid) or any user-operated scheduler — GitHub Actions
cron, a small VPS with `cron`, Upstash QStash, cron-job.org. All do the same
thing: one authenticated HTTP call per minute.

Confirm it is live via `GET /api/engine-status` (`running: true` with a recent
`lastPollAt`) or the dashboard's engine panel.

## 6. Custom domain

Render → service → **Settings → Custom Domains → Add**. Add the hostname, then
create the DNS record Render shows: `CNAME` → `<service>.onrender.com` for a
subdomain such as `app.example.com`, or an `ALIAS`/`ANAME`/`A` record at the apex
if your DNS provider supports flattening. TLS certificates are issued and renewed
automatically once DNS resolves. Afterwards, add the domain to your Supabase
project's **Authentication → URL Configuration** (Site URL plus redirect URLs) so
sign-in and password-reset links point at the new host.

## 7. Puppeteer QA stays local

`qa/` drives only your own deployed app (sign-in, dashboard, realtime rendering,
PLACE BET validation, ABORT, bookmaker-link URL validation). Run it from your
machine with `bun run qa` — see `qa/README.md`. It is a devDependency, is never
invoked by the Render build or runtime, and must not be deployed as a background
or scheduled job. Render cannot host a persistent 24/7 browser process for this,
and it never automates bookmaker sites.

## 8. Notes

- Placement remains manual everywhere: no automated bookmaker login, slip
  filling, stake entry or wager submission exists in the codebase.
- Deploying to Vercel instead? See `DEPLOY_VERCEL.md`. Same environment
  variables; the same scheduler caveat applies, and Vercel additionally cannot
  host any persistent process at all.
