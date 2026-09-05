/**
 * Shared Puppeteer helpers for QA scripts.
 *
 * SCOPE LIMIT (enforced by convention and by `assertOwnOrigin` below):
 * these scripts only ever drive OUR OWN app. Bookmaker domains are never
 * navigated, logged into, or interacted with — see qa/checks/links.js, which
 * validates bookmaker URLs over plain HTTP HEAD/GET without a browser.
 */
import puppeteer from "puppeteer";

export const BASE_URL = (process.env.QA_BASE_URL || "http://localhost:8080").replace(/\/$/, "");

export function assertOwnOrigin(url) {
  const target = new URL(url, BASE_URL);
  const base = new URL(BASE_URL);
  if (target.origin !== base.origin) {
    throw new Error(
      `Refusing to navigate off our own origin (${base.origin}): ${target.origin}. ` +
        `QA scripts must never drive third-party sites.`,
    );
  }
  return target.toString();
}

export async function launch() {
  return puppeteer.launch({
    headless: process.env.QA_HEADFUL ? false : true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 1600 },
  });
}

export async function newPage(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.consoleErrors = consoleErrors;
  return page;
}

export async function goto(page, path) {
  const url = assertOwnOrigin(path);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return url;
}

/** Sign in with email + password using env credentials. */
export async function signIn(page) {
  const email = process.env.QA_EMAIL;
  const password = process.env.QA_PASSWORD;
  if (!email || !password) {
    throw new Error("Set QA_EMAIL and QA_PASSWORD (a test account) before running auth checks.");
  }
  await goto(page, "/login");
  await page.waitForSelector("#email", { timeout: 30_000 });
  await page.type("#email", email, { delay: 10 });
  await page.type("#password", password, { delay: 10 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null),
  ]);
  // Client-side routing may not fire a navigation event; poll the URL instead.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!page.url().includes("/login")) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Still on /login after sign-in attempt (url: ${page.url()})`);
}

/** Tiny assertion helpers so scripts read like a checklist. */
export const results = [];
export function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}
export function summarise() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}
