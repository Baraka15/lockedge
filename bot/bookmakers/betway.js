/**
 * BetWay Puppeteer driver. See sportybet.js for the pattern; selectors below
 * are the documented public structure and should be re-verified against the
 * live DOM. BetWay's slip is a slide-out drawer with a multi-step confirm.
 */
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { loadSessionCookies, saveSessionCookies, sb, AGENT_ID } from "../supabase.js";
import { notify } from "../notifications.js";
import { detectCaptcha, takeScreenshot, pickUA, pickViewport } from "./captcha.js";

const URL = process.env.BETWAY_URL || "https://www.betway.co.tz/";
const LOGIN_ID = process.env.BETWAY_EMAIL || process.env.BETWAY_USERNAME;
const PASSWORD = process.env.BETWAY_PASSWORD;
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const SESSION_FILE = path.resolve("session-betway.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 4;
const RELOGIN_BUFFER_MS = 1000 * 60 * 5;
const CAPTCHA_BACKOFF_MS = 1000 * 60 * 15;

export const id = "betway";

let browser = null;
let page = null;
let lastLoginAt = 0;
let pausedUntil = 0;
let captchaCount = 0;

async function bumpCaptcha(reason, kind) {
  captchaCount++;
  pausedUntil = Date.now() + CAPTCHA_BACKOFF_MS;
  const shot = await takeScreenshot(page, "captcha");
  log.error("[betway] CAPTCHA detected", { reason, kind, count: captchaCount });
  try {
    const { data } = await sb.from("agent_status").select("metadata").eq("agent_id", AGENT_ID).maybeSingle();
    const meta = data?.metadata ?? {};
    const cap = { ...(meta.captcha ?? {}), betway: { count: captchaCount, last_at: new Date().toISOString(), kind } };
    await sb.from("agent_status").upsert({
      agent_id: AGENT_ID, status: meta.status ?? "online",
      last_heartbeat: new Date().toISOString(),
      metadata: { ...meta, captcha: cap },
    }, { onConflict: "agent_id" });
  } catch {}
  await notify({
    kind: "captcha_detected",
    title: "🚨 BetWay captcha — paused 15 min",
    body: `Reason: ${reason} (${kind ?? "n/a"}). Will rotate UA + viewport and retry.`,
    payload: { bookmaker: "betway", screenshot_label: shot?.label, kind },
  });
}

async function ensureBrowser() {
  if (browser) return;
  log.info("[betway] launching", { headless: HEADLESS });
  browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  page = await browser.newPage();
  await page.setUserAgent(pickUA());
  await page.setViewport(pickViewport());
  let cookies = null;
  if (fs.existsSync(SESSION_FILE)) {
    try { cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch {}
  }
  if (!cookies?.length) { try { cookies = await loadSessionCookies("betway"); } catch {} }
  if (Array.isArray(cookies) && cookies.length) {
    try { await page.setCookie(...cookies); log.info("[betway] restored cookies", { n: cookies.length }); } catch {}
  }
}

async function rotateProfile() {
  log.warn("[betway] rotating browser profile");
  try { await browser?.close(); } catch {}
  browser = null; page = null;
  await ensureBrowser();
}

async function persistSession() {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    await saveSessionCookies("betway", cookies);
  } catch (e) { log.warn("[betway] persistSession failed", { error: e.message }); }
}

async function isLoggedIn() {
  // SEL: account widget shows when logged in.
  try {
    await page.waitForSelector('[data-testid="balance"], [class*="balance" i], [class*="account-balance" i]', { timeout: 4000 });
    return true;
  } catch { return false; }
}

async function dismissPopups() {
  const closers = [
    'button[aria-label="close" i]',
    'button:has-text("Accept")', 'button:has-text("Accept All")',
    'button:has-text("Got it")', 'button#onetrust-accept-btn-handler',
  ];
  for (const s of closers) {
    try { const el = await page.$(s); if (el) { await el.click({ delay: 30 }); } } catch {}
  }
}

async function guardCaptcha(reason) {
  const c = await detectCaptcha(page);
  if (c.detected) { await bumpCaptcha(reason, c.kind); throw new Error(`captcha:${c.kind}`); }
}

export async function login() {
  if (!LOGIN_ID || !PASSWORD) throw new Error("BETWAY_EMAIL/USERNAME + PASSWORD not set");
  if (Date.now() < pausedUntil) throw new Error("betway paused (captcha backoff)");
  await ensureBrowser();

  const age = Date.now() - lastLoginAt;
  if (age < SESSION_TTL_MS - RELOGIN_BUFFER_MS) {
    try { await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 }); } catch {}
    await dismissPopups();
    await guardCaptcha("session-check");
    if (await isLoggedIn()) return { balance: await readBalance() };
  }

  await withRetry(async () => {
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    await dismissPopups();
    await guardCaptcha("pre-login");
    if (await isLoggedIn()) return;

    // SEL: top-bar login button opens a drawer.
    await page.waitForSelector('[data-testid="login-button"], a[href*="login" i], button:has-text("Log In")', { timeout: 10000 });
    await page.click('[data-testid="login-button"], a[href*="login" i], button:has-text("Log In")');

    await page.waitForSelector('input[name="email"], input[name="username"], input[type="email"]', { timeout: 10000 });
    const userInput = (await page.$('input[name="email"]')) || (await page.$('input[name="username"]')) || (await page.$('input[type="email"]'));
    await userInput.click({ clickCount: 3 });
    await userInput.type(LOGIN_ID, { delay: 40 });
    const passInput = await page.$('input[name="password"], input[type="password"]');
    await passInput.type(PASSWORD, { delay: 40 });
    await page.click('button[type="submit"], [data-testid="login-submit"], button:has-text("Log In")');
    await guardCaptcha("post-submit");
    await page.waitForSelector('[data-testid="balance"], [class*="balance" i]', { timeout: 20000 });
  }, { label: "betway.login", maxAttempts: 2 }).catch(async (e) => {
    if (String(e.message).startsWith("captcha:")) await rotateProfile();
    throw e;
  });

  lastLoginAt = Date.now();
  await persistSession();
  log.info("[betway] login ok");
  return { balance: await readBalance() };
}

export async function readBalance() {
  if (!page) return null;
  try {
    const txt = await page.$eval('[data-testid="balance"], [class*="balance" i]', (el) => el.textContent || "");
    const n = Number(txt.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export async function verifyOdds({ event_url, outcome_selector, outcome_label }) {
  if (!event_url) return { liveOdds: null, found: false };
  await login();
  try {
    await page.goto(event_url, { waitUntil: "networkidle2", timeout: 30000 });
    await guardCaptcha("verifyOdds");
    if (outcome_selector) {
      const txt = await page.$eval(outcome_selector, (el) => el.textContent || "").catch(() => "");
      const n = Number(String(txt).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n) && n > 1) return { liveOdds: n, found: true };
    }
    if (outcome_label) {
      const odds = await page.evaluate((label) => {
        const nodes = Array.from(document.querySelectorAll('[data-testid^="odds"], [class*="odds" i], button[class*="outcome" i]'));
        const hit = nodes.find((n) => (n.textContent || "").toLowerCase().includes(label.toLowerCase()));
        if (!hit) return null;
        const m = (hit.textContent || "").match(/(\d+(?:\.\d+)?)/g);
        return m ? Number(m[m.length - 1]) : null;
      }, outcome_label);
      if (odds && odds > 1) return { liveOdds: odds, found: true };
    }
  } catch (e) {
    log.warn("[betway] verifyOdds failed", { error: e.message });
  }
  return { liveOdds: null, found: false };
}

export async function placeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label }) {
  if (!stake) throw new Error("stake is required");
  if (!event_url) throw new Error("event_url is required");
  if (Date.now() < pausedUntil) throw new Error("betway paused (captcha backoff)");
  await login();

  try {
    await withRetry(async () => {
      await page.goto(event_url, { waitUntil: "networkidle2", timeout: 30000 });
      await dismissPopups();
      await guardCaptcha("placeBet-load");

      if (outcome_selector) {
        await page.waitForSelector(outcome_selector, { timeout: 15000 });
        await page.click(outcome_selector);
      } else if (outcome_label) {
        const handle = await page.evaluateHandle((label) => {
          const nodes = Array.from(document.querySelectorAll('[data-testid^="odds"], [class*="odds" i], button[class*="outcome" i]'));
          return nodes.find((n) => (n.textContent || "").toLowerCase().includes(label.toLowerCase()));
        }, outcome_label);
        const el = handle.asElement();
        if (!el) throw new Error(`outcome not found: ${outcome_label}`);
        await el.click();
      } else {
        throw new Error("need outcome_selector or outcome_label");
      }

      // SEL: bet slip stake input.
      await page.waitForSelector('input[data-testid="betslip-stake"], input[name="stake"], input.bet-slip__stake', { timeout: 15000 });
    }, { label: "betway.openSlip", maxAttempts: 3, backoffMs: 1500 });

    const stakeSel = 'input[data-testid="betslip-stake"], input[name="stake"], input.bet-slip__stake';
    await page.click(stakeSel, { clickCount: 3 });
    await page.type(stakeSel, String(stake), { delay: 25 });

    let finalOdds = odds ?? null;
    try {
      const oddsTxt = await page.$eval('[data-testid="betslip-odds"], .bet-slip__odds', (el) => el.textContent || "");
      const n = Number(oddsTxt.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) finalOdds = n;
    } catch {}

    // Betway sometimes has a two-step confirm: "Review" then "Place".
    const reviewBtn = await page.$('button:has-text("Review Bet"), [data-testid="review-bet"]');
    if (reviewBtn) { try { await reviewBtn.click(); } catch {} }

    await page.waitForSelector('[data-testid="place-bet"], button.bet-slip__place, button:has-text("Place Bet")', { timeout: 10000 });
    await page.click('[data-testid="place-bet"], button.bet-slip__place, button:has-text("Place Bet")');
    await guardCaptcha("post-place");

    let result = "success";
    let betId = null;
    try {
      await page.waitForSelector('[data-testid="bet-confirmation"], .bet-confirmation, [class*="confirm" i], [class*="error" i]', { timeout: 15000 });
      if (await page.$('[class*="error" i]')) result = "failed";
      else {
        betId = await page.$eval('[data-testid="bet-reference"], [class*="reference" i]',
          (el) => (el.textContent || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 32)).catch(() => null);
      }
    } catch {
      result = "partial";
    }

    const balance = await readBalance();
    log.info("[betway] placeBet", { arb_id, outcome, stake, result, betId });
    return { result, odds: finalOdds, balance, betId, receiptUrl: null, actualStake: Number(stake) };
  } catch (e) {
    const shot = await takeScreenshot(page, "placeBet-fail");
    log.error("[betway] placeBet failed", { error: e.message });
    throw Object.assign(new Error(e.message), { screenshot: shot });
  }
}

export async function keepAlive() {
  if (!browser || !page) return;
  if (Date.now() < pausedUntil) return;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await guardCaptcha("keepAlive");
    if (await isLoggedIn()) log.info("[betway] keepAlive ok");
  } catch (e) {
    log.warn("[betway] keepAlive failed", { error: e.message });
  }
}

export async function shutdown() {
  if (browser) { try { await browser.close(); } catch {} browser = null; page = null; }
}