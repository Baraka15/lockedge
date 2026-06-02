import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger.js";

const URL = process.env.BETPAWA_URL || "https://www.betpawa.co.tz";
const PHONE = process.env.BETPAWA_PHONE;
const PASSWORD = process.env.BETPAWA_PASSWORD;
const HEADLESS = (process.env.HEADLESS ?? "true") !== "false";
const SESSION_FILE = path.resolve("session.json");

let browser = null;
let page = null;
let lastLoginAt = 0;
const SESSION_TTL_MS = 1000 * 60 * 30; // 30 min

async function ensureBrowser() {
  if (browser) return;
  log.info("Launching Chromium", { headless: HEADLESS });
  browser = await puppeteer.launch({
    headless: HEADLESS ? "new" : false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 800 });

  // restore cookies if available
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
        log.info("Restored session cookies", { count: cookies.length });
      }
    } catch (e) {
      log.warn("Failed to restore cookies", { error: e.message });
    }
  }
}

async function saveSession() {
  try {
    const cookies = await page.cookies();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies, null, 2));
  } catch (e) {
    log.warn("Failed to save cookies", { error: e.message });
  }
}

async function isLoggedIn() {
  try {
    await page.waitForSelector('[data-test-id="balanceButton"]', { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

export async function login() {
  if (!PHONE || !PASSWORD) throw new Error("BETPAWA_PHONE / BETPAWA_PASSWORD not set");
  await ensureBrowser();

  if (Date.now() - lastLoginAt < SESSION_TTL_MS) {
    await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
    if (await isLoggedIn()) {
      log.info("Session still valid, skipping login");
      return await readBalance();
    }
  }

  log.info("Logging into BetPawa");
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });

  if (await isLoggedIn()) {
    lastLoginAt = Date.now();
    return await readBalance();
  }

  await page.waitForSelector('[data-test-id="loginButton"]', { timeout: 10000 });
  await page.click('[data-test-id="loginButton"]');
  await page.waitForSelector('[data-test-id="phoneNumberInput"]', { timeout: 10000 });
  await page.type('[data-test-id="phoneNumberInput"]', PHONE, { delay: 30 });
  await page.type('[data-test-id="passwordInput"]', PASSWORD, { delay: 30 });
  await page.click('[data-test-id="logInButton"]');
  await page.waitForSelector('[data-test-id="balanceButton"]', { timeout: 20000 });

  lastLoginAt = Date.now();
  await saveSession();
  log.info("Login successful");
  return await readBalance();
}

export async function readBalance() {
  try {
    const txt = await page.$eval('[data-test-id="balanceButton"]', (el) => el.textContent || "");
    const num = Number(txt.replace(/[^0-9.]/g, ""));
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}

/**
 * Place a bet on a specific market URL.
 * payload: { event_url, outcome_selector?, outcome_label?, stake, odds?, arb_id? }
 *
 * BetPawa UI flow:
 *  1. navigate to event page
 *  2. click the outcome cell (matched by data-test-id or visible label)
 *  3. fill the betslip stake input
 *  4. confirm
 */
export async function placeBet(payload) {
  await login();

  const { event_url, outcome_selector, outcome_label, stake } = payload;
  if (!stake) throw new Error("stake is required");
  if (!event_url) throw new Error("event_url is required");

  log.info("Navigating to event", { event_url });
  await page.goto(event_url, { waitUntil: "networkidle2", timeout: 30000 });

  // Click outcome
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

  // Fill stake on betslip
  await page.waitForSelector('input[data-test-id="stake-input"], input[name="stake"]', { timeout: 15000 });
  const stakeSel = (await page.$('input[data-test-id="stake-input"]'))
    ? 'input[data-test-id="stake-input"]'
    : 'input[name="stake"]';

  await page.click(stakeSel, { clickCount: 3 });
  await page.type(stakeSel, String(stake), { delay: 20 });

  // Read final odds from betslip if available
  let finalOdds = payload.odds ?? null;
  try {
    const oddsTxt = await page.$eval('[data-test-id="betslip-odds"]', (el) => el.textContent || "");
    const n = Number(oddsTxt.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(n)) finalOdds = n;
  } catch {}

  // Confirm
  await page.waitForSelector('[data-test-id="place-bet-button"]', { timeout: 10000 });
  await page.click('[data-test-id="place-bet-button"]');

  // Confirmation modal
  let result = "success";
  try {
    await page.waitForSelector('[data-test-id="bet-placed-success"], [data-test-id="bet-placed-error"]', {
      timeout: 15000,
    });
    const err = await page.$('[data-test-id="bet-placed-error"]');
    if (err) result = "failed";
  } catch {
    result = "partial";
  }

  const balance = await readBalance();
  log.info("Bet attempt complete", { result, finalOdds, stake, balance });

  return { result, odds: finalOdds, balance };
}

export async function shutdown() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
  }
}