// Resilient client-side networking helpers.
//
// Browsers surface every transport-level failure (offline, DNS, TLS, CORS,
// blocked request) as an opaque `TypeError: Failed to fetch`. Showing that
// string to an operator is useless, so every client fetch goes through here
// and gets an explicit timeout plus a human-readable message.

export const NETWORK_MESSAGE =
  "Can't reach the server right now. Check your connection and try again.";
export const TIMEOUT_MESSAGE =
  "The server took too long to respond. Try again in a moment.";

const NETWORK_PATTERNS =
  /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_network|err_internet_disconnected|connection (closed|refused|reset)/i;

/** Turn any thrown value into a message that is safe to show in the UI. */
export function describeNetworkError(err: unknown): string {
  if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") {
    return TIMEOUT_MESSAGE;
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!message) return NETWORK_MESSAGE;
  if (NETWORK_PATTERNS.test(message)) return NETWORK_MESSAGE;
  return message;
}

export function isNetworkFailure(err: unknown): boolean {
  const message = describeNetworkError(err);
  return message === NETWORK_MESSAGE || message === TIMEOUT_MESSAGE;
}

interface FetchJsonOptions extends RequestInit {
  /** Abort after this many ms. Long scans should raise it explicitly. */
  timeoutMs?: number;
}

/**
 * fetch + JSON parse with a timeout and normalised errors.
 * Throws an Error whose `message` is always presentable to the user.
 */
export async function fetchJson<T>(path: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, { ...init, signal: init.signal ?? controller.signal });
  } catch (err) {
    throw new Error(describeNetworkError(err));
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const serverError =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : null;
    throw new Error(serverError ?? `Server error (${response.status}). Please try again.`);
  }

  if (body === null) {
    throw new Error("The server returned an unexpected response. Please try again.");
  }

  return body as T;
}
