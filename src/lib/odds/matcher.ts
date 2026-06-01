import type { MasterFixture, NormalizedOdds } from "./types";
import { canonicalTeam, teamSimilarity } from "./team-aliases";

const STRICT_THRESHOLD = 0.85;

/**
 * Strict event grouping:
 *  - normalizer already aliased + canonicalised team names so identical
 *    pairs collapse exactly.
 *  - when master fixtures are available, we only adopt a fixture's
 *    canonical key when BOTH home AND away similarity exceed 0.85.
 *  - we then sanity-check every odds row in a group to confirm bookmakers
 *    agree on which side is home — mismatches are dropped.
 */
export function matchFixtures(
  normalized: NormalizedOdds[],
  fixtures: MasterFixture[],
): Map<string, NormalizedOdds[]> {
  const groups = new Map<string, NormalizedOdds[]>();

  // Pre-canonicalise fixtures and filter out completed ones.
  type CFix = {
    f: MasterFixture;
    sport: string;
    home: string;
    away: string;
    dateStr: string;
  };
  const activeFixtures: CFix[] = fixtures
    .filter((f) => !("is_completed" in f) || !(f as unknown as { is_completed?: boolean }).is_completed)
    .map((f) => ({
      f,
      sport: f.sport.toLowerCase(),
      home: canonicalTeam(f.home_team),
      away: canonicalTeam(f.away_team),
      dateStr: new Date(f.event_date).toISOString().slice(0, 10),
    }));

  for (const odds of normalized) {
    const dateStr = new Date(odds.eventDate).toISOString().slice(0, 10);
    let key = odds.eventKey;
    let canonHome = odds.homeTeam;
    let canonAway = odds.awayTeam;

    // Strict bidirectional match against master fixtures, same sport + date.
    const candidates = activeFixtures.filter(
      (c) => c.sport === odds.sport.toLowerCase() && c.dateStr === dateStr,
    );
    let best: { fix: CFix; score: number } | null = null;
    for (const c of candidates) {
      const hh = teamSimilarity(odds.homeTeam, c.home);
      const aa = teamSimilarity(odds.awayTeam, c.away);
      if (hh >= STRICT_THRESHOLD && aa >= STRICT_THRESHOLD) {
        const score = hh + aa;
        if (!best || score > best.score) best = { fix: c, score };
      }
    }
    if (best) {
      canonHome = best.fix.home;
      canonAway = best.fix.away;
      key = `${best.fix.sport}|${canonHome}|${canonAway}|${best.fix.dateStr}`;
    }

    const groupKey = `${key}::${odds.marketType}`;
    const list = groups.get(groupKey) ?? [];
    // Sanity check: only accept this odds row into the group if its home/away
    // orientation agrees with the group's first member. If reversed, skip it
    // entirely rather than create a contaminated arb.
    if (list.length) {
      const ref = list[0];
      const sameOrientation =
        teamSimilarity(ref.homeTeam, canonHome) >= STRICT_THRESHOLD &&
        teamSimilarity(ref.awayTeam, canonAway) >= STRICT_THRESHOLD;
      if (!sameOrientation) {
        console.warn(
          `[matcher] dropped odds with reversed orientation for ${groupKey} (${odds.bookmaker})`,
        );
        continue;
      }
    }
    list.push(odds);
    groups.set(groupKey, list);
  }

  return groups;
}