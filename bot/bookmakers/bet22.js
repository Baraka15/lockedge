/**
 * 22Bet Puppeteer driver. Uganda-facing site (https://22bet.ug).
 * Mirrors the betpawa.js pattern: session cookies persisted to disk +
 * Supabase, 4h TTL, withRetry on flaky steps, screenshots on failure.
 *
 * Selectors are based on the public 22bet.ug DOM and may need tuning;
 * keep DRY_RUN on until you've watched a real placement succeed.
 */
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { loadSessionCookies, saveSessionCookies } from "../supabase.js";

const URL = process.env.BET22_URL || "https://22bet.ug";
const USERNAME = process.env.BET22_USERNAME;
const PASSWORD = process.env.BET22_PASSWORD;
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const SESSION_FILE = path.resolve("session-bet22.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 4;
const RELOGIN_BUFFER_MS = 1000 * 60 * 5;

let browser = null;
let page = null;
let lastLoginAt = 0;

export const id = "bet22";

async function ensureBrowser() {
  if (browser) return;
  log.info("[bet22] launching chromium", { headless: HEADLESS });
  browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 800 });

  let cookies = null;
  if (fs.existsSync(SESSION_FILE)) {
    try { cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch {}
  }
  if (!cookies || !cookies.length) {
    try { cookies = await loadSessionCookies("bet22"); } catch {}
  }
  if (Array.isArray(cookies) && cookies.length) {
    try { await page.setCookie(...cookies); log.info("[bet22] restored cookies", { count: cookies.length }); } catch {}
  }
}

async function persistSession() {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    await saveSessionCookies("bet22", cookies);
  } catch (e) {
    log.warn("[bet22] persistSession failed", { error: e.message });
  }
}

async function isLoggedIn() {
  try {
    await page.waitForSelector('.HeaderBalance, [data-test-id="balance"], .user-balance', { timeout: 4000 });
    return true;
  } catch { return false; }
}

export async function login() {
  if (!USERNAME || !PASSWORD) throw new Error("BET22_USERNAME / BET22_PASSWORD not set");
  await ensureBrowser();

  const age = Date.now() - lastLoginAt;
  if (age < SESSION_TTL_MS - RELOGIN_BUFFER_MS) {
    try { await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 }); } catch {}
    if (await isLoggedIn()) {
      return { balance: await readBalance() };
    }
  }

  await withRetry(async () => {
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    if (await isLoggedIn()) return;
    // open login form
    await page.waitForSelector('.HeaderLogin, .login-button, [data-test-id="login-button"]', { timeout: 10000 });
    await page.click('.HeaderLogin, .login-button, [data-test-id="login-button"]');
    await page.waitForSelector('input[name="auth_id"], input[name="login"], input[type="text"]', { timeout: 10000 });
    const userSel = (await page.$('input[name="auth_id"]')) ? 'input[name="auth_id"]'
      : (await page.$('input[name="login"]')) ? 'input[name="login"]'
      : 'input[type="text"]';
    await page.type(userSel, USERNAME, { delay: 30 });
    await page.type('input[name="auth_pass"], input[name="password"], input[type="password"]', PASSWORD, { delay: 30 });
    await page.click('button[type="submit"], .login-form__submit, [data-test-id="submit-login"]');
    await page.waitForSelector('.HeaderBalance, [data-test-id="balance"], .user-balance', { timeout: 20000 });
  }, { label: "bet22.login" });

  lastLoginAt = Date.now();
  await persistSession();
  log.info("[bet22] login ok");
  return { balance: await readBalance() };
}

export async function readBalance() {
  if (!page) return null;
  try {
    const txt = await page.$eval('.HeaderBalance, [data-test-id="balance"], .user-balance',
      (el) => el.textContent || "");
    const num = Number(txt.replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : 0;
  } catch { return null; }
}

export async function verifyOdds({ event_url, outcome_selector, outcome_label }) {
  if (!event_url) return { liveOdds: null, found: false };
  await login();
  try {
    await page.goto(event_url, { waitUntil: "networkidle2", timeout: 30000 });
    if (outcome_selector) {
      const txt = await page.$eval(outcome_selector, (el) => el.textContent || "").catch(() => "");
      const n = Number(String(txt).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n) && n > 1) return { liveOdds: n, found: true };
    }
    if (outcome_label) {
      const odds = await page.evaluate((label) => {
        const nodes = Array.from(document.querySelectorAll('.c-bets__bet, .koeff, button'));
        const hit = nodes.find((n) => (n.textContent || "").trim().toLowerCase().includes(label.toLowerCase()));
        if (!hit) return null;
        const m = (hit.textContent || "").match(/(\d+(?:\.\d+)?)/g);
        return m ? Number(m[m.length - 1]) : null;
      }, outcome_label);
      if (odds && odds > 1) return { liveOdds: odds, found: true };
    }
  } catch (e) {
    log.warn("[bet22] verifyOdds failed", { error: e.message });
  }
  return { liveOdds: null, found: false };
}

export async function placeBet(payload) {
  await login();
  const { event_url, outcome_selector, outcome_label, stake } = payload;
  if (!stake) throw new Error("stake is required");
  if (!event_url) throw new Error("event_url is required");

  try {
    await withRetry(async () => {
      await page.goto(event_url, { waitUntil: "networkidle2", timeout: 30000 });
      if (outcome_selector) {
        await page.waitForSelector(outcome_selector, { timeout: 15000 });
        await page.click(outcome_selector);
      } else if (outcome_label) {
        const handle = await page.evaluateHandle((label) => {
          const nodes = Array.from(document.querySelectorAll('.c-bets__bet, .koeff, button'));
          return nodes.find((n) => (n.textContent || "").trim().toLowerCase().includes(label.toLowerCase()));
        }, outcome_label);
        const el = handle.asElement();
        if (!el) throw new Error(`Outcome label not found: ${outcome_label}`);
        await el.click();
      } else {
        throw new Error("Need outcome_selector or outcome_label");
      }
      await page.waitForSelector('.coupon-sum input, input[name="summ"], input[name="stake"]', { timeout: 15000 });
    }, { label: "bet22.openSlip", maxAttempts: 3, backoffMs: 2000 });

    const stakeSel = (await page.$('.coupon-sum input'))
      ? '.coupon-sum input'
      : (await page.$('input[name="summ"]')) ? 'input[name="summ"]' : 'input[name="stake"]';
    await page.click(stakeSel, { clickCount: 3 });
    await page.type(stakeSel, String(stake), { delay: 20 });

    let finalOdds = payload.odds ?? null;
    try {
      const oddsTxt = await page.$eval('.coupon-total-koeff, .betslip-odds',
        (el) => el.textContent || "");
      const n = Number(oddsTxt.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) finalOdds = n;
    } catch {}

    await page.waitForSelector('.coupon-btn-group__item--accept, .place-bet, [data-test-id="place-bet"]',
      { timeout: 10000 });
    await page.click('.coupon-btn-group__item--accept, .place-bet, [data-test-id="place-bet"]');

    let result = "success";
    try {
      await page.waitForSelector('.coupon-success, .bet-success, .coupon-error, .bet-error', { timeout: 15000 });
      if (await page.$('.coupon-error, .bet-error')) result = "failed";
    } catch {
      result = "partial";
    }

    return { result, odds: finalOdds, balance: await readBalance() };
  } catch (e) {
    log.error("[bet22] placeBet failed", { error: e.message });
    throw e;
  }
}

export async function keepAlive() {
  if (!browser || !page) return;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    if (await isLoggedIn()) log.info("[bet22] keepAlive ping ok");
  } catch (e) {
    log.warn("[bet22] keepAlive failed", { error: e.message });
  }
}

export async function shutdown() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
  }
}