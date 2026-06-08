// TODO: implement Betway automation. Copy the structure from betpawa.js:
//   - launch puppeteer
//   - login() reuses session (4h TTL, re-login 5min before expiry)
//   - readBalance() scrapes the balance widget
//   - verifyOdds({event_url, ...}) returns the live odds before confirming
//   - placeBet({...}) returns { result, odds, balance }
//   - keepAlive() pings a lightweight page every 10min
// Until implemented, processArb will skip Betway legs and log a warning.
export const id = "betway";
export async function login() { throw new Error("Betway bot not implemented"); }
export async function readBalance() { return null; }
export async function verifyOdds() { return { liveOdds: null, found: false }; }
export async function placeBet() { throw new Error("Betway bot not implemented"); }
export async function shutdown() {}