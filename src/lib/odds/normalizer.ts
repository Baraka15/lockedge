import type { NormalizedOdds, RawOdds } from "./types";

function clean(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeOdds(raw: RawOdds): NormalizedOdds {
  const home = clean(raw.homeTeam);
  const away = clean(raw.awayTeam);
  const sport = clean(raw.sport);
  const dateStr = new Date(raw.eventDate).toISOString().slice(0, 10);
  const eventKey = `${sport}|${home}|${away}|${dateStr}`;

  // Dedupe outcomes by name (keep highest price)
  const byName = new Map<string, { name: string; price: number }>();
  for (const o of raw.outcomes) {
    const key = clean(o.name);
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