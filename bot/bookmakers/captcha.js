/**
 * Shared captcha / anti-bot detection. Pass the active Page and we'll scan
 * the URL + DOM for common challenge markers. Returns { detected, kind }.
 */
const URL_MARKERS = [
  /captcha/i, /challenge/i, /cf-chl/i, /access[-_]?denied/i,
  /unusual[-_ ]traffic/i, /suspicious[-_ ]activity/i,
];
const SELECTOR_MARKERS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="captcha"]',
  'iframe[src*="cloudflare"]',
  '[id*="captcha" i]',
  '[class*="captcha" i]',
  '[data-hcaptcha-widget-id]',
  'div.g-recaptcha',
  'div#cf-please-wait',
];

export async function detectCaptcha(page) {
  if (!page) return { detected: false };
  try {
    const url = page.url() || "";
    for (const re of URL_MARKERS) {
      if (re.test(url)) return { detected: true, kind: "url_marker", url };
    }
    const sel = await page.evaluate((markers) => {
      for (const s of markers) {
        if (document.querySelector(s)) return s;
      }
      const txt = (document.body?.innerText || "").toLowerCase();
      if (/verify you are human|are you a robot|prove you('?| a)re human|unusual traffic|access denied/i.test(txt)) {
        return "body_text";
      }
      return null;
    }, SELECTOR_MARKERS);
    if (sel) return { detected: true, kind: sel, url };
  } catch {}
  return { detected: false };
}

export async function takeScreenshot(page, label) {
  try {
    if (!page) return null;
    const buf = await page.screenshot({ type: "png", fullPage: false });
    return { label, b64: buf.toString("base64").slice(0, 6000) };
  } catch { return null; }
}

// Randomized desktop UAs to rotate after a captcha hit.
export const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

export function pickUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export const VIEWPORTS = [
  { width: 1366, height: 800 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 800 },
];

export function pickViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}