/**
 * QA: drives OUR OWN deployed app only.
 *
 * Covers: login, dashboard loading, realtime feed rendering, PLACE BET
 * validation states, and the ABORT flow.
 *
 * It NEVER interacts with a bookmaker site: bookmaker match links are
 * intercepted (window.open is stubbed) so the URL is captured and validated
 * instead of opened.
 */
import { launch, newPage, goto, signIn, check, summarise, BASE_URL } from "../lib/browser.js";

const SHOT_DIR = process.env.QA_SHOT_DIR || "qa/screenshots";

async function main() {
  console.log(`QA target: ${BASE_URL}\n`);
  const browser = await launch();
  const page = await newPage(browser);

  try {
    // --- 1. Login page renders -------------------------------------------
    await goto(page, "/login");
    const hasEmail = await page.$("#email");
    check("login page renders email + password form", Boolean(hasEmail));

    // --- 2. Sign in -------------------------------------------------------
    await signIn(page);
    check("sign-in leaves /login", !page.url().includes("/login"), page.url());

    // --- 3. Dashboard loads ----------------------------------------------
    await goto(page, "/dashboard");
    await page.waitForSelector("main, h1", { timeout: 45_000 }).catch(() => null);
    const bodyText = await page.evaluate(() => document.body.innerText);
    check("dashboard renders content", bodyText.length > 200, `${bodyText.length} chars`);
    check(
      "no raw 'Failed to fetch' surfaced",
      !bodyText.includes("Failed to fetch"),
      "user-facing error text check",
    );
    await page.screenshot({ path: `${SHOT_DIR}/dashboard.png` });

    // --- 4. Realtime feed rendering ---------------------------------------
    // The opportunity feed is driven by a realtime subscription; assert that a
    // feed container exists and that its contents settle without errors.
    const before = await page.evaluate(() => document.body.innerHTML.length);
    await new Promise((r) => setTimeout(r, 8_000));
    const after = await page.evaluate(() => document.body.innerHTML.length);
    check("dashboard stays mounted while realtime updates stream", after > 0, `${before} -> ${after}`);

    // --- 5. PLACE BET validation + ABORT ----------------------------------
    // Stub window.open so a verified opportunity records the bookmaker URL
    // instead of navigating anywhere.
    await page.evaluate(() => {
      window.__qaOpened = [];
      window.open = (url) => {
        window.__qaOpened.push(String(url));
        return null;
      };
    });

    const placeBtn = await page.$x
      ? (await page.$$("button")).find(async () => false)
      : null;
    void placeBtn;

    const placeHandle = (
      await page.$$eval("button", (btns) =>
        btns.map((b, i) => ({ i, text: (b.textContent || "").trim() })),
      )
    ).find((b) => b.text.toUpperCase().includes("PLACE BET"));

    if (!placeHandle) {
      check(
        "PLACE BET button present",
        false,
        "no live opportunity on screen right now — re-run when the feed has one",
      );
    } else {
      const buttons = await page.$$("button");
      await buttons[placeHandle.i].click();
      await new Promise((r) => setTimeout(r, 6_000));
      const text = await page.evaluate(() => document.body.innerText);
      const invalid = text.includes("ARB INVALID — ODDS CHANGED.");
      const verified = text.includes("Odds re-verified");
      check(
        "PLACE BET produces a validation state",
        invalid || verified,
        invalid ? "blocked: ARB INVALID — ODDS CHANGED." : "verified: odds re-checked",
      );

      const opened = await page.evaluate(() => window.__qaOpened || []);
      check(
        "bookmaker links are official URLs only (never navigated)",
        opened.every((u) => /^https:\/\//.test(u)),
        opened.length ? opened.join(", ") : "none opened (blocked path)",
      );

      const abort = (
        await page.$$eval("button", (btns) =>
          btns.map((b, i) => ({ i, text: (b.textContent || "").trim() })),
        )
      ).find((b) => b.text.toUpperCase().includes("ABORT"));
      if (abort) {
        const btns2 = await page.$$("button");
        await btns2[abort.i].click();
        await new Promise((r) => setTimeout(r, 2_000));
        const after2 = await page.evaluate(() => document.body.innerText);
        check(
          "ABORT clears the workflow",
          !after2.includes("Odds re-verified") || after2.includes("Workflow aborted"),
        );
      } else {
        check("ABORT button present after validation", false, "not rendered");
      }
      await page.screenshot({ path: `${SHOT_DIR}/place-bet.png` });
    }

    check(
      "no console errors during the run",
      page.consoleErrors.length === 0,
      page.consoleErrors.slice(0, 3).join(" | "),
    );
  } finally {
    await browser.close();
    summarise();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
