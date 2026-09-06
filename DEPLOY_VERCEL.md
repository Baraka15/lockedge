# Deploying to Vercel with your own Supabase

This guide describes a clean, self-owned production path: the web app on Vercel,
the database/auth on **your** Supabase project, and the recurring odds scan on a
scheduler you control. No credentials belong in this file or anywhere in the repo.

> Do not switch production over until your own Supabase project is connected and
> its migrations are applied. Until then, keep using the current hosted backend.

---

## 1. Environment variables

Copy `.env.example` to `.env` for local runs, and set the same names in
**Vercel → Project → Settings → Environment Variables** (Production + Preview).

| Name | Scope | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | browser | Your project's API URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | browser | Publishable/anon key (safe to expose) |
| `VITE_SUPABASE_PROJECT_ID` | browser | Project ref |
| `SUPABASE_URL` | server | Same URL, read by server code |
| `SUPABASE_PUBLISHABLE_KEY` | server | Used to verify user bearer tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **Secret.** Bypasses RLS — server only |
| `POLL_SECRET` | server | Optional but recommended; see step 5 |
| `POLL_INTERVAL_MS` | server | Optional, default `2000` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | server | Optional alerts |
| `THEODDSAPI_KEY` | server | Optional odds provider |

`VITE_*` values are inlined at build time — after changing them, redeploy.

---

## 2. Connect your own Supabase

1. Create a project at supabase.com (choose a region close to your users).
2. In this app's **Project Settings → Supabase/Backend**, connect that project so
   the generated client and types point at it.
3. Copy the URL, publishable key and service-role key from your Supabase project
   settings into the Vercel environment variables above. Store the service-role
   key only in Vercel/Supabase secret storage — never in the repo.

---

## 3. Apply the database schema

All schema lives in `supabase/migrations/` and applies in filename order.

```bash
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push           # applies every migration in order
```

Verify afterwards that the expected tables exist (`arbs`, `live_events`,
`master_fixtures`, `executions`, `risk_settings`, `user_roles`, …), that RLS is
enabled on each, and that your account has a row in `user_roles` with the
`operator` (or `admin`) role — most dashboard reads and all execution writes are
gated on `public.is_operator()`.

Enable Realtime for the tables the dashboard subscribes to (`arbs`,
`live_events`, `executions`).

---

## 4. Import the project on Vercel

1. Push this repository to GitHub.
2. Vercel → **Add New → Project → Import Git Repository**.
3. Framework preset: **Other**. Build command `npm run build`, install command
   `npm install`. `vercel.json` already sets these.
4. Add the environment variables from step 1, then deploy.

The build detects Vercel automatically (`VERCEL` env var) and emits the Vercel
server bundle instead of the Cloudflare one — no config change needed. To
reproduce it locally: `DEPLOY_TARGET=vercel npm run build`.

---

## 5. Where the recurring scan runs

**Not on Vercel.** Vercel serves requests; it cannot host a persistent
process, a long-lived worker, or a 24/7 browser. The deployed app only exposes
the scan as an HTTP endpoint — something else must call it on a schedule.

Endpoint: `POST https://<your-domain>/api/public/poll`
Each call runs repeated scan cycles for roughly 50 seconds, then returns.

Set `POLL_SECRET` in Vercel and have the scheduler send
`Authorization: Bearer <POLL_SECRET>`; unauthenticated calls then get a 401.

Pick one scheduler:

**a) Supabase pg_cron + pg_net** (recommended — same project as the data)

In the Supabase SQL editor, enable `pg_cron` and `pg_net`, then schedule a
job that runs every minute and `net.http_post`s to the poll URL with the
Authorization header and a timeout of ~55 s. Keep the secret in Supabase Vault
rather than inline in the job definition.

**b) Supabase scheduled Edge Function** — a tiny function whose only job is to
`fetch()` the poll URL with the header, scheduled every minute. Useful if you
prefer to keep the secret in Edge Function secrets.

**c) Any user-operated scheduler** — GitHub Actions cron, a cheap VPS with
`cron`, Upstash QStash, cron-job.org. All work the same way: one authenticated
HTTP call per minute.

Confirm it is running via `GET /api/engine-status` (`running: true` and a recent
`lastPollAt`) or the dashboard's engine panel.

---

## 6. Puppeteer QA stays local

`qa/` drives only your own deployed app (sign-in, dashboard, realtime rendering,
PLACE BET validation, ABORT, bookmaker-link URL validation). Run it from your
machine with `bun run qa` — see `qa/README.md`. It is a devDependency and is
never invoked by the Vercel build or runtime, so it adds no hosting cost. It
must not be deployed as a scheduled or always-on job, and it never automates
bookmaker sites.

---

## 7. What still depends on the managed backend

The app talks to Supabase exclusively through standard environment variables and
the official `@supabase/supabase-js` client, so pointing it at your own project
is purely configuration. The only platform-specific piece is the build target,
which now switches automatically (step 4). Placement remains manual everywhere;
there is no automated login, slip filling, stake entry or wager submission.
