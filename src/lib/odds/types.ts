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
}