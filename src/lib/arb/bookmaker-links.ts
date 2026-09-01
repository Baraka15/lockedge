/**
 * Deep links to bookmaker match pages.
 *
 * None of the Uganda/East-Africa books expose a public "prefilled bet slip"
 * URL scheme, so these are deliberately MATCH-PAGE (or match search) links:
 * they land you on the event/search result, and you place the bet by hand.
 */

const encode = (s: string) => encodeURIComponent(s.trim());

type Builder = (query: string) => string;

const BUILDERS: Record<string, Builder> = {
  betpawa: (q) => `https://www.betpawa.ug/search?q=${encode(q)}`,
  betika: (q) => `https://www.betika.com/en-ug/search?query=${encode(q)}`,
  bet22: (q) => `https://22bet.ug/search?query=${encode(q)}`,
  "22bet": (q) => `https://22bet.ug/search?query=${encode(q)}`,
  odibets: (q) => `https://odibets.com/search?q=${encode(q)}`,
  onewin: (q) => `https://1win.ug/en/search?query=${encode(q)}`,
  "1win": (q) => `https://1win.ug/en/search?query=${encode(q)}`,
  onexbet: (q) => `https://1xbet.ug/en/search?query=${encode(q)}`,
  "1xbet": (q) => `https://1xbet.ug/en/search?query=${encode(q)}`,
  melbet: (q) => `https://melbet.ug/en/search?query=${encode(q)}`,
  bangbet: (q) => `https://www.bangbet.com/search?q=${encode(q)}`,
  sportybet: (q) => `https://www.sportybet.com/ug/sport/football?query=${encode(q)}`,
  msport: (q) => `https://www.msport.com/ug/search?keyword=${encode(q)}`,
  betway: (q) => `https://www.betway.co.ug/search?q=${encode(q)}`,
  sportpesa: (q) => `https://www.sportpesa.co.ke/search?q=${encode(q)}`,
};

/**
 * Match-page (or match-search) URL for a bookmaker + event name.
 * Returns null when we have no known public URL scheme for that book.
 */
export function matchPageUrl(bookmaker: string, eventName: string): string | null {
  const key = (bookmaker || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const build = BUILDERS[key];
  if (!build) return null;
  return build(eventName);
}
