/**
 * Device-local PIN quick-unlock.
 *
 * This is a CONVENIENCE LOCK, never authentication: unlocking with the PIN only
 * works when a valid Supabase session already exists on this device. All data
 * access remains gated by Supabase auth + operator row-level security.
 */

const PIN_HASH_KEY = "quick_pin_hash_v1";
const UNLOCK_KEY = "quick_pin_unlocked_v1";
const ATTEMPTS_KEY = "quick_pin_attempts_v1";
const SALT = "lockedge-pin-v1:";

/** Preset PIN (sha256 of SALT + pin). Owner can change or remove it in the app. */
const DEFAULT_PIN_HASH =
  "7125d8a68fd0cc86621a1e9c92cb810e10b781951fb1d12f00f2bb108b9234df";

export const MAX_PIN_ATTEMPTS = 5;

function hasWindow() {
  return typeof window !== "undefined";
}

export async function hashPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(SALT + pin.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getPinHash(): string | null {
  if (!hasWindow()) return null;
  const stored = localStorage.getItem(PIN_HASH_KEY);
  if (stored === "") return null; // explicitly removed by the user
  return stored ?? DEFAULT_PIN_HASH;
}

export function isPinEnabled(): boolean {
  return !!getPinHash();
}

export async function setPin(pin: string): Promise<void> {
  if (!hasWindow()) return;
  localStorage.setItem(PIN_HASH_KEY, await hashPin(pin));
  resetAttempts();
  markUnlocked();
}

export function removePin(): void {
  if (!hasWindow()) return;
  localStorage.setItem(PIN_HASH_KEY, "");
  resetAttempts();
  markUnlocked();
}

export async function verifyPin(pin: string): Promise<boolean> {
  const expected = getPinHash();
  if (!expected) return false;
  const ok = (await hashPin(pin)) === expected;
  if (ok) {
    resetAttempts();
    markUnlocked();
  } else {
    bumpAttempts();
  }
  return ok;
}

export function attemptsLeft(): number {
  if (!hasWindow()) return MAX_PIN_ATTEMPTS;
  const used = Number(sessionStorage.getItem(ATTEMPTS_KEY) ?? "0");
  return Math.max(0, MAX_PIN_ATTEMPTS - used);
}

function bumpAttempts() {
  if (!hasWindow()) return;
  const used = Number(sessionStorage.getItem(ATTEMPTS_KEY) ?? "0") + 1;
  sessionStorage.setItem(ATTEMPTS_KEY, String(used));
}

export function resetAttempts() {
  if (!hasWindow()) return;
  sessionStorage.removeItem(ATTEMPTS_KEY);
}

export function markUnlocked() {
  if (!hasWindow()) return;
  sessionStorage.setItem(UNLOCK_KEY, "1");
}

export function lockNow() {
  if (!hasWindow()) return;
  sessionStorage.removeItem(UNLOCK_KEY);
}

/** True when this browser tab may show protected screens without re-entering the PIN. */
export function isUnlocked(): boolean {
  if (!hasWindow()) return true;
  if (!isPinEnabled()) return true;
  return sessionStorage.getItem(UNLOCK_KEY) === "1";
}