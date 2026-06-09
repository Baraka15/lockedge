/**
 * SportyBet Puppeteer driver.
 *
 * NOTE on selectors: SportyBet ships a SPA whose markup changes per release
 * and per-country domain. The selectors below cover the documented public
 * structure as of the last verified pass. Each `// SEL:` marker is a place
 * you should re-verify against the live DOM before going live — open dev
 * tools, copy the actual attribute/class, paste it in.
 *
 * Login flow: country splash (sometimes) → top-right "Login" → form with
 * phone or email + password → balance widget visible in the header.
 * Bet flow: top search → click match → click outcome on the market grid
 * → bet slip drawer → stake input → "Place Bet" → success modal.
 */
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { loadSessionCookies, saveSessionCookies, sb, AGENT_ID } from "../supabase.js";
import { notify } from "../notifications.js";
import { detectCaptcha, takeScreenshot, pickUA, pickViewport } from "./captcha.js";

const URL = process.env.SPORTYBET_URL || "https://www.sportybet.com/ug/";
const LOGIN_ID = process.env.SPORTYBET_PHONE || process.env.SPORTYBET_EMAIL;
const PASSWORD = process.env.SPORTYBET_PASSWORD;
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const SESSION_FILE = path.resolve("session-sportybet.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 4;
const RELOGIN_BUFFER_MS = 1000 * 60 * 5;
const CAPTCHA_BACKOFF_MS = 1000 * 60 * 15;

export const id = "sportybet";

let browser = null;
let page = null;
let lastLoginAt = 0;
let pausedUntil = 0;
let captchaCount = 0;

async function bumpCaptcha(reason, kind) {
  captchaCount++;
  pausedUntil = Date.now() + CAPTCHA_BACKOFF_MS;
  const shot = await takeScreenshot(page, "captcha");
  log.error("[sportybet] CAPTCHA detected", { reason, kind, count: captchaCount });
  try {
    const { data } = await sb.from("agent_status").select("metadata").eq("agent_id", AGENT_ID).maybeSingle();
    const meta = data?.metadata ?? {};
    const cap = { ...(meta.captcha ?? {}), sportybet: { count: captchaCount, last_at: new Date().toISOString(), kind } };
    await sb.from("agent_status").upsert({
      agent_id: AGENT_ID, status: meta.status ?? "online",
      last_heartbeat: new Date().toISOString(),
      metadata: { ...meta, captcha: cap },
    }, { onConflict: "agent_id" });
  } catch {}
  await notify({
    kind: "captcha_detected",
    title: "🚨 SportyBet captcha — paused 15 min",
    body: `Reason: ${reason} (${kind ?? "n/a"}). Will rotate UA + viewport and retry.`,
    payload: { bookmaker: "sportybet", screenshot_label: shot?.label, kind },
  });
}

async function ensureBrowser() {
  if (browser) return;
  log.info("[sportybet] launching", { headless: HEADLESS });
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
  if (!cookies?.length) {
    try { cookies = await loadSessionCookies("sportybet"); } catch {}
  }
  if (Array.isArray(cookies) && cookies.length) {
    try { await page.setCookie(...cookies); log.info("[sportybet] restored cookies", { n: cookies.length }); } catch {}
  }
}

async function rotateProfile() {
  log.warn("[sportybet] rotating browser profile (UA + viewport)");
  try { await browser?.close(); } catch {}
  browser = null; page = null;
  await ensureBrowser();
}

async function persistSession() {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    await saveSessionCookies("sportybet", cookies);
  } catch (e) {
    log.warn("[sportybet] persistSession failed", { error: e.message });
  }
}

async function isLoggedIn() {
  // SEL: header balance widget.
  try {
    await page.waitForSelector('.m-balance, .balance, [class*="balance" i]', { timeout: 4000 });
    return true;
  } catch { return false; }
}

async function dismissPopups() {
  // SEL: cookie banner / country picker / "got it" buttons.
  const closeSelectors = [
    'button.m-cookie__close', 'button[aria-label="close" i]',
    'button:has-text("Accept")', 'button:has-text("Got it")', 'button:has-text("Continue")',
  ];
  for (const s of closeSelectors) {
    try {
      const el = await page.$(s);
      if (el) { await el.click({ delay: 30 }); await page.waitForTimeout?.(300); }
    } catch {}
  }
}

async function guardCaptcha(reason) {
  const c = await detectCaptcha(page);
  if (c.detected) {
    await bumpCaptcha(reason, c.kind);
    throw new Error(`captcha:${c.kind}`);
  }
}

export async function login() {
  if (!LOGIN_ID || !PASSWORD) throw new Error("SPORTYBET_PHONE/EMAIL + PASSWORD not set");
  if (Date.now() < pausedUntil) throw new Error("sportybet paused (captcha backoff)");
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

    // SEL: top-right login button.
    await page.waitForSelector('.m-header__btn--login, a[href*="login" i], button:has-text("Login")', { timeout: 10000 });
    await page.click('.m-header__btn--login, a[href*="login" i], button:has-text("Login")');

    // SEL: phone/email input + password input.
    await page.waitForSelector('input[name="phone"], input[name="username"], input[type="tel"]', { timeout: 10000 });
    const userInput = (await page.$('input[name="phone"]')) || (await page.$('input[name="username"]')) || (await page.$('input[type="tel"]'));
    await userInput.click({ clickCount: 3 });
    await userInput.type(LOGIN_ID, { delay: 40 });
    const passInput = await page.$('input[name="password"], input[type="password"]');
    await passInput.type(PASSWORD, { delay: 40 });

    // SEL: submit button.
    await page.click('button[type="submit"], button.m-login__submit, button:has-text("Log in")');
    await guardCaptcha("post-submit");
    await page.waitForSelector('.m-balance, .balance, [class*="balance" i]', { timeout: 20000 });
  }, { label: "sportybet.login", maxAttempts: 2 }).catch(async (e) => {
    if (String(e.message).startsWith("captcha:")) await rotateProfile();
    throw e;
  });

  lastLoginAt = Date.now();
  await persistSession();
  log.info("[sportybet] login ok");
  return { balance: await readBalance() };
}

export async function readBalance() {
  if (!page) return null;
  try {
    const txt = await page.$eval('.m-balance, .balance, [class*="balance" i]', (el) => el.textContent || "");
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
        // SEL: market grid buttons — class names vary per market type.
        const nodes = Array.from(document.querySelectorAll('.m-market__odds, .m-outcomes__item, button[class*="odd" i]'));
        const hit = nodes.find((n) => (n.textContent || "").toLowerCase().includes(label.toLowerCase()));
        if (!hit) return null;
        const m = (hit.textContent || "").match(/(\d+(?:\.\d+)?)/g);
        return m ? Number(m[m.length - 1]) : null;
      }, outcome_label);
      if (odds && odds > 1) return { liveOdds: odds, found: true };
    }
  } catch (e) {
    log.warn("[sportybet] verifyOdds failed", { error: e.message });
  }
  return { liveOdds: null, found: false };
}

export async function placeBet({ arb_id, outcome, stake, odds, event_url, outcome_selector, outcome_label }) {
  if (!stake) throw new Error("stake is required");
  if (!event_url) throw new Error("event_url is required");
  if (Date.now() < pausedUntil) throw new Error("sportybet paused (captcha backoff)");
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
          const nodes = Array.from(document.querySelectorAll('.m-market__odds, .m-outcomes__item, button[class*="odd" i]'));
          return nodes.find((n) => (n.textContent || "").toLowerCase().includes(label.toLowerCase()));
        }, outcome_label);
        const el = handle.asElement();
        if (!el) throw new Error(`outcome not found: ${outcome_label}`);
        await el.click();
      } else {
        throw new Error("need outcome_selector or outcome_label");
      }

      // SEL: stake input inside bet slip drawer.
      await page.waitForSelector('input.m-bet-slip__input, input[name="stake"], input[placeholder*="amount" i]', { timeout: 15000 });
    }, { label: "sportybet.openSlip", maxAttempts: 3, backoffMs: 1500 });

    const stakeSel = 'input.m-bet-slip__input, input[name="stake"], input[placeholder*="amount" i]';
    await page.click(stakeSel, { clickCount: 3 });
    await page.type(stakeSel, String(stake), { delay: 25 });

    let finalOdds = odds ?? null;
    try {
      const oddsTxt = await page.$eval('.m-bet-slip__odd, .m-bet-slip__total-odd', (el) => el.textContent || "");
      const n = Number(oddsTxt.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) finalOdds = n;
    } catch {}

    // SEL: place-bet button.
    await page.waitForSelector('.m-bet-slip__place, button.m-bet-slip__place-btn, button:has-text("Place Bet")', { timeout: 10000 });
    await page.click('.m-bet-slip__place, button.m-bet-slip__place-btn, button:has-text("Place Bet")');
    await guardCaptcha("post-place");

    let result = "success";
    let betId = null;
    try {
      await page.waitForSelector('.m-bet-success, .m-bet-fail, [class*="success" i], [class*="error" i]', { timeout: 15000 });
      if (await page.$('.m-bet-fail, [class*="error" i]')) result = "failed";
      else {
        // Pull the bet/receipt id when shown.
        betId = await page.$eval('.m-bet-success [class*="id" i], .m-bet-success [class*="code" i]',
          (el) => (el.textContent || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 32)).catch(() => null);
      }
    } catch {
      result = "partial";
    }

    const balance = await readBalance();
    log.info("[sportybet] placeBet", { arb_id, outcome, stake, result, betId });
    return { result, odds: finalOdds, balance, betId, receiptUrl: null, actualStake: Number(stake) };
  } catch (e) {
    const shot = await takeScreenshot(page, "placeBet-fail");
    log.error("[sportybet] placeBet failed", { error: e.message });
    throw Object.assign(new Error(e.message), { screenshot: shot });
  }
}

export async function keepAlive() {
  if (!browser || !page) return;
  if (Date.now() < pausedUntil) return;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await guardCaptcha("keepAlive");
    if (await isLoggedIn()) log.info("[sportybet] keepAlive ok");
  } catch (e) {
    log.warn("[sportybet] keepAlive failed", { error: e.message });
  }
}

export async function shutdown() {
  if (browser) { try { await browser.close(); } catch {} browser = null; page = null; }
}