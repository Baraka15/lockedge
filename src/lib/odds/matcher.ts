import Fuse from "fuse.js";
import type { MasterFixture, NormalizedOdds } from "./types";

/**
 * Groups normalized odds by event. When master fixtures are available, fuzzy
 * matches team names against them so slight spelling differences across
 * bookmakers collapse to the same event. Falls back to the raw eventKey.
 */
export function matchFixtures(
  normalized: NormalizedOdds[],
  fixtures: MasterFixture[],
): Map<string, NormalizedOdds[]> {
  const groups = new Map<string, NormalizedOdds[]>();

  const fuse = fixtures.length
    ? new Fuse(fixtures, {
        keys: ["home_team", "away_team"],
        threshold: 0.35,
        includeScore: true,
      })
    : null;

  for (const odds of normalized) {
    let key = odds.eventKey;

    if (fuse) {
      const dateStr = new Date(odds.eventDate).toISOString().slice(0, 10);
      const hits = fuse.search(`${odds.homeTeam} ${odds.awayTeam}`);
      const sameDate = hits.find(
        (h) =>
          new Date(h.item.event_date).toISOString().slice(0, 10) === dateStr &&
          h.item.sport.toLowerCase() === odds.sport.toLowerCase(),
      );
      if (sameDate) {
        const f = sameDate.item;
        key = `${f.sport.toLowerCase()}|${f.home_team.toLowerCase()}|${f.away_team.toLowerCase()}|${new Date(
          f.event_date,
        )
          .toISOString()
          .slice(0, 10)}`;
      }
    }

    const market = odds.marketType;
    const groupKey = `${key}::${market}`;
    const list = groups.get(groupKey) ?? [];
    list.push(odds);
    groups.set(groupKey, list);
  }

  return groups;
}