import type { NormalizedOdds, RawOdds } from "./types";
import { canonicalTeam, teamSimilarity } from "./team-aliases";

function clean(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const DRAW_TOKENS = new Set(["draw", "x", "tie", "empate", "d"]);

/**
 * Bookmakers spell the same selection differently ("zhejiang" vs "zhejiang fc"
 * vs "1"). Unless we collapse these onto a single canonical label, the arb
 * calculator sees 4-5 "distinct" outcomes for a 3-way market, finds that no
 * single bookmaker covers them all, and rejects every genuine cross-book arb.
 * So each outcome is snapped to the canonical home name, "draw", or the
 * canonical away name.
 */
function canonOutcomeName(
  rawName: string,
  home: string,
  away: string,
): string {
  const n = clean(rawName);
  if (DRAW_TOKENS.has(n)) return "draw";
  if (n === "1" || n === "home" || n === "home team") return home;
  if (n === "2" || n === "away" || n === "away team") return away;
  const c = canonicalTeam(rawName) || n;
  if (c === home) return home;
  if (c === away) return away;
  const sh = teamSimilarity(c, home);
  const sa = teamSimilarity(c, away);
  if (sh >= 0.6 && sh >= sa) return home;
  if (sa >= 0.6) return away;
  return n;
}

export function normalizeOdds(raw: RawOdds): NormalizedOdds {
  // Aggressive canonicalisation (unicode-fold, strip suffixes, alias map)
  // means slight spelling differences across bookmakers collapse to the
  // same event key without needing fuzzy matching at the group stage.
  const home = canonicalTeam(raw.homeTeam) || clean(raw.homeTeam);
  const away = canonicalTeam(raw.awayTeam) || clean(raw.awayTeam);
  const sport = clean(raw.sport);
  const dateStr = new Date(raw.eventDate).toISOString().slice(0, 10);
  const eventKey = `${sport}|${home}|${away}|${dateStr}`;

  // Canonicalise + dedupe outcomes by name (keep highest price)
  const byName = new Map<string, { name: string; price: number }>();
  for (const o of raw.outcomes) {
    const key =
      raw.marketType === "h2h" ? canonOutcomeName(o.name, home, away) : clean(o.name);
    const existing = byName.get(key);
    if (!existing || o.price > existing.price) {
      byName.set(key, { name: key, price: o.price });
    }
  }

  return {
    eventKey,
    bookmaker: raw.provider,
    sport,
    homeTeam: home,
    awayTeam: away,
    eventDate: raw.eventDate,
    marketType: raw.marketType,
    outcomes: Array.from(byName.values()),
    fetchedAt: raw.fetchedAt,
  };
}