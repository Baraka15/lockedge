export interface RawOdds {
  provider: string;
  eventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  eventDate: string;
  marketType: "h2h" | "spreads" | "totals";
  outcomes: { name: string; price: number }[];
  fetchedAt: number;
}

export interface NormalizedOdds {
  eventKey: string;
  bookmaker: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  eventDate: string;
  marketType: string;
  outcomes: { name: string; price: number }[];
  fetchedAt: number;
}

export interface MasterFixture {
  id: string;
  sport: string;
  home_team: string;
  away_team: string;
  event_date: string;
}

export interface ArbOpportunity {
  id: string;
  eventName: string;
  marketType: string;
  outcomes: {
    name: string;
    odds: number;
    bookmaker: string;
    stake: number;
  }[];
  totalArbPercent: number;
  requiredTotalStake: number;
  detectedAt: string;
  expiresAt: string;
  isAcknowledged: boolean;
  dedupKey: string;
  /**
   * "sure"  — sum(1/odds) < 1, mathematically risk-free.
   * "value" — near-arb (book margin under ~1.5%). Not risk-free, but the
   *           lowest-hold prices in the market: used to keep turnover and
   *           betting patterns looking recreational between real sure bets.
   */
  tier: "sure" | "value";
  /** Book margin in % (0 for a sure bet, positive for a value play). */
  bookMarginPct: number;
}