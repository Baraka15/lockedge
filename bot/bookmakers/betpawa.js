import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { withRetry } from "../retry.js";
import { loadSessionCookies, saveSessionCookies } from "../supabase.js";

const URL = process.env.BETPAWA_URL || "https://www.betpawa.co.tz";
const PHONE = process.env.BETPAWA_PHONE || process.env.BETPAWA_EMAIL;
const PASSWORD = process.env.BETPAWA_PASSWORD;
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const SESSION_FILE = path.resolve("session.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 4; // 4h
const RELOGIN_BUFFER_MS = 1000 * 60 * 5; // re-login 5min before expiry

let browser = null;
let page = null;
let lastLoginAt = 0;

async function screenshotToBase64(label) {
  try {
    if (!page) return null;
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return { label, b64: buf.toString("base64").slice(0, 4000) }; // truncate
  } catch { return null; }
}

async function ensureBrowser() {
  if (browser) return;
  log.info("[betpawa] launching chromium", { headless: HEADLESS });
  browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 800 });

  // 1) try local file
  let cookies = null;
  if (fs.existsSync(SESSION_FILE)) {
    try { cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch {}
  }
  // 2) fall back to Supabase-stored cookies (resume after crash)
  if (!cookies || !cookies.length) {
    try { cookies = await loadSessionCookies("betpawa"); } catch {}
  }
  if (Array.isArray(cookies) && cookies.length) {
    try { await page.setCookie(...cookies); log.info("[betpawa] restored cookies", { count: cookies.length }); } catch {}
  }
}

async function persistSession() {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
    await saveSessionCookies("betpawa", cookies);
  } catch (e) {
    log.warn("[betpawa] persistSession failed", { error: e.message });
  }
}

async function isLoggedIn() {
  try {
    await page.waitForSelector('[data-test-id="balanceButton"]', { timeout: 4000 });
    return true;
  } catch { return false; }
}

export const id = "betpawa";

export async function login() {
  if (!PHONE || !PASSWORD) throw new Error("BETPAWA_PHONE / BETPAWA_PASSWORD not set");
  await ensureBrowser();

  const age = Date.now() - lastLoginAt;
  const sessionFresh = age < SESSION_TTL_MS - RELOGIN_BUFFER_MS;
  if (sessionFresh) {
    try { await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 }); } catch {}
    if (await isLoggedIn()) {
      const bal = await readBalance();
      return { balance: bal };
    }
  }

  await withRetry(async () => {
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    if (await isLoggedIn()) return;
    await page.waitForSelector('[data-test-id="loginButton"]', { timeout: 10000 });
    await page.click('[data-test-id="loginButton"]');
    await page.waitForSelector('[data-test-id="phoneNumberInput"]', { timeout: 10000 });
    await page.type('[data-test-id="phoneNumberInput"]', PHONE, { delay: 30 });
    await page.type('[data-test-id="passwordInput"]', PASSWORD, { delay: 30 });
    await page.click('[data-test-id="logInButton"]');
    await page.waitForSelector('[data-test-id="balanceButton"]', { timeout: 20000 });
  }, { label: "betpawa.login" });

  lastLoginAt = Date.now();
  await persistSession();
  log.info("[betpawa] login ok");
  const bal = await readBalance();
  return { balance: bal };
}

export async function readBalance() {
  if (!page) return null;
  try {
    const txt = await page.$eval('[data-test-id="balanceButton"]', (el) => el.textContent || "");
    const num = Number(txt.replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : 0;
  } catch { return null; }
}

/**
 * Navigate to an event and scrape the live odds for the target outcome.
 * Returns { liveOdds, found }. liveOdds is null when scraping fails.
 */
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
        const nodes = Array.from(document.querySelectorAll('[data-test-id^="price-button-"], button'));
        const hit = nodes.find((n) => (n.textContent || "").trim().toLowerCase().includes(label.toLowerCase()));
        if (!hit) return null;
        const m = (hit.textContent || "").match(/(\d+(?:\.\d+)?)/g);
        if (!m) return null;
        const candidate = Number(m[m.length - 1]);
        return Number.isFinite(candidate) ? candidate : null;
      }, outcome_label);
      if (odds && odds > 1) return { liveOdds: odds, found: true };
    }
  } catch (e) {
    log.warn("[betpawa] verifyOdds failed", { error: e.message });
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
          const nodes = Array.from(document.querySelectorAll('[data-test-id^="price-button-"], button'));
          return nodes.find((n) => (n.textContent || "").trim().toLowerCase().includes(label.toLowerCase()));
        }, outcome_label);
        const el = handle.asElement();
        if (!el) throw new Error(`Outcome label not found: ${outcome_label}`);
        await el.click();
      } else {
        throw new Error("Need outcome_selector or outcome_label");
      }
      await page.waitForSelector('input[data-test-id="stake-input"], input[name="stake"]', { timeout: 15000 });
    }, { label: "betpawa.openSlip", maxAttempts: 3, backoffMs: 2000 });

    const stakeSel = (await page.$('input[data-test-id="stake-input"]'))
      ? 'input[data-test-id="stake-input"]'
      : 'input[name="stake"]';
    await page.click(stakeSel, { clickCount: 3 });
    await page.type(stakeSel, String(stake), { delay: 20 });

    let finalOdds = payload.odds ?? null;
    try {
      const oddsTxt = await page.$eval('[data-test-id="betslip-odds"]', (el) => el.textContent || "");
      const n = Number(oddsTxt.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) finalOdds = n;
    } catch {}

    await page.waitForSelector('[data-test-id="place-bet-button"]', { timeout: 10000 });
    await page.click('[data-test-id="place-bet-button"]');

    let result = "success";
    try {
      await page.waitForSelector('[data-test-id="bet-placed-success"], [data-test-id="bet-placed-error"]', { timeout: 15000 });
      if (await page.$('[data-test-id="bet-placed-error"]')) result = "failed";
    } catch {
      result = "partial";
    }

    const balance = await readBalance();
    return { result, odds: finalOdds, balance };
  } catch (e) {
    const shot = await screenshotToBase64("placeBet-fail");
    log.error("[betpawa] placeBet failed", { error: e.message, screenshot: shot?.label });
    throw e;
  }
}

export async function keepAlive() {
  if (!browser || !page) return;
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    if (await isLoggedIn()) log.info("[betpawa] keepAlive ping ok");
  } catch (e) {
    log.warn("[betpawa] keepAlive failed", { error: e.message });
  }
}

export async function shutdown() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
  }
}