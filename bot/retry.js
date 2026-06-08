import { log } from "./logger.js";

/**
 * Retry an async function with exponential backoff. Returns the result
 * on success or throws the last error after maxAttempts failures.
 *
 *   await withRetry(() => page.goto(url), { label: "goto" })
 */
export async function withRetry(fn, { maxAttempts = 3, backoffMs = 1000, label = "op", onAttemptFail } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      log.warn(`[retry] ${label} attempt ${attempt}/${maxAttempts} failed`, { error: e.message });
      if (onAttemptFail) {
        try { await onAttemptFail(e, attempt); } catch {}
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
  }
  throw lastErr ?? new Error(`${label} failed`);
}