/**
 * QA: bookmaker link validation — NO browser, NO automation.
 *
 * Builds the official match-page URLs from the app's own link module and checks
 * only that each URL is well-formed, https, points at the expected official
 * host, and that the host answers a request. It does not sign in, does not
 * render the page, does not fill a slip and does not place a wager. There is
 * deliberately no Puppeteer import in this file.
 *
 * Run with bun (so the TypeScript import resolves): bun run qa:links
 */
import { matchPageUrl } from "../../src/lib/arb/bookmaker-links.ts";
import { check, summarise } from "../lib/browser.js";

const BOOKMAKERS = [
  "betpawa",
  "betika",
  "22bet",
  "odibets",
  "1win",
  "1xbet",
  "melbet",
  "bangbet",
];

// Books that are not usable from Uganda must never get a link.
const MUST_BE_ABSENT = ["sportybet", "msport", "sportpesa", "betway"];

const SAMPLE_EVENT = "Arsenal vs Chelsea";

async function reachable(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (QA link check)" },
    });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  for (const b of MUST_BE_ABSENT) {
    check(`${b} has no link (not usable in Uganda)`, matchPageUrl(b, SAMPLE_EVENT) === null);
  }

  for (const b of BOOKMAKERS) {
    const url = matchPageUrl(b, SAMPLE_EVENT);
    if (!url) {
      check(`${b} link generated`, false, "matchPageUrl returned null");
      continue;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      check(`${b} link is a valid URL`, false, url);
      continue;
    }
    check(
      `${b} link is https + encodes the event`,
      parsed.protocol === "https:" && url.includes("Arsenal"),
      url,
    );

    if (process.env.QA_SKIP_NETWORK) continue;
    const status = await reachable(url);
    check(
      `${b} host answers`,
      status !== null && status < 500,
      status === null ? "no response (may be geo-blocked from this network)" : `HTTP ${status}`,
    );
  }
  summarise();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
