import type { RawOdds } from "../types";

export interface ScrapedOdds {
  bookmaker: string;
  fixtureKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: Date;
  markets: { home: number; draw?: number; away: number };
  sport: string;
  league?: string;
  region?: string;
}

export interface ScraperResult {
  bookmaker: string;
  ok: boolean;
  count: number;
  latencyMs: number;
  error?: string;
  odds: ScrapedOdds[];
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36 Edg/119.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
];

export function pickUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function jitter(maxMs = 500) {
  await new Promise((r) => setTimeout(r, Math.random() * maxMs));
}

export interface FetchJsonOpts {
  timeoutMs?: number;
  headers?: Record<string, string>;
  referer?: string;
}

export async function fetchJson(url: string, opts: FetchJsonOpts = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": pickUA(),
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        ...(opts.referer ? { Referer: opts.referer } : {}),
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) return await res.json();
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error("non-JSON response"); }
  } finally {
    clearTimeout(t);
  }
}

export function canonKey(home: string, away: string): string {
  const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
  return `${norm(home)} vs ${norm(away)}`;
}

/**
 * Convert a ScrapedOdds[] into RawOdds[] consumed by the existing engine.
 * Uses "h2h" market with home/draw/away outcome names matching odds provider convention
 * (home/away carry the actual team names so downstream matcher can align them).
 */
export function toRawOdds(items: ScrapedOdds[]): RawOdds[] {
  const fetchedAt = Date.now();
  return items.map((it, idx) => {
    const outcomes: { name: string; price: number }[] = [
      { name: it.homeTeam, price: it.markets.home },
      { name: it.awayTeam, price: it.markets.away },
    ];
    if (typeof it.markets.draw === "number" && it.markets.draw > 1) {
      outcomes.splice(1, 0, { name: "Draw", price: it.markets.draw });
    }
    return {
      provider: it.bookmaker,
      eventId: `${it.bookmaker}:${it.fixtureKey}:${idx}`,
      sport: it.sport || "soccer",
      homeTeam: it.homeTeam,
      awayTeam: it.awayTeam,
      eventDate: it.commenceTime.toISOString(),
      marketType: "h2h",
      outcomes,
      fetchedAt,
    } satisfies RawOdds;
  });
}

/**
 * Walk an arbitrary JSON tree yielding every object node.
 */
export function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) yield* walk(v);
    return;
  }
  yield node as Record<string, unknown>;
  for (const v of Object.values(node as Record<string, unknown>)) yield* walk(v);
}

/**
 * Best-effort extractor: given an unknown JSON blob from any bookmaker API,
 * heuristically find match objects with home/away/odds and pull them out.
 * Handles the fact that these APIs change shape often — one loose parser beats
 * eight brittle ones.
 */
export function extractMatches(root: unknown, bookmaker: string, sport = "soccer"): ScrapedOdds[] {
  const out: ScrapedOdds[] = [];
  const seen = new Set<string>();
  const teamFields = ["homeTeamName","awayTeamName","homeTeam","awayTeam","home_team","away_team","home","away","team1","team2","competitors","opp1","opp2","Opp1","Opp2","home_name","away_name","name_home","name_away","HomeTeam","AwayTeam"];
  const timeFields = ["estimateStartTime","startTime","commence_time","kickoff","kick_off","start_time","start_date","matchTime","dateTime","date","start","event_time","Time","T"];

  const getStr = (o: Record<string, unknown>, key: string): string | null => {
    const v = o[key];
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nv = (v as Record<string, unknown>).name ?? (v as Record<string, unknown>).Name;
      if (typeof nv === "string") return nv;
    }
    return null;
  };

  const parseTime = (v: unknown): Date | null => {
    if (v == null) return null;
    if (typeof v === "number") {
      // seconds vs ms heuristic
      const ms = v < 1e12 ? v * 1000 : v;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (!isNaN(n) && n > 1_000_000_000) {
        const ms = n < 1e12 ? n * 1000 : n;
        return new Date(ms);
      }
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  const findOdds = (o: Record<string, unknown>): { home: number; draw?: number; away: number } | null => {
    // Common shapes:
    // - markets: [{ outcomes: [{name, odds/price}] }]
    // - odds: { "1": 1.5, "X": 3.2, "2": 2.1 } or { home:.., draw:.., away:.. }
    // - picks: [{ name/odd_key, odd_value }]
    // - E: [{ CE, C, T }]  (1xbet / melbet)
    const oddsObj = (o.odds ?? o.Odds ?? o.market ?? o.mainOdds ?? o.prices) as unknown;
    if (oddsObj && typeof oddsObj === "object" && !Array.isArray(oddsObj)) {
      const m = oddsObj as Record<string, unknown>;
      const h = Number(m["1"] ?? m.home ?? m.Home ?? m.h);
      const d = Number(m["X"] ?? m.draw ?? m.Draw ?? m.x);
      const a = Number(m["2"] ?? m.away ?? m.Away ?? m.a);
      if (h > 1 && a > 1) return { home: h, away: a, ...(d > 1 ? { draw: d } : {}) };
    }
    const markets = (o.markets ?? o.Markets ?? o.market_list) as unknown;
    if (Array.isArray(markets)) {
      for (const mk of markets) {
        if (!mk || typeof mk !== "object") continue;
        const mko = mk as Record<string, unknown>;
        const outcomes = (mko.outcomes ?? mko.selections ?? mko.picks ?? mko.O) as unknown;
        if (!Array.isArray(outcomes)) continue;
        let h = 0, d = 0, a = 0;
        for (const oc of outcomes) {
          if (!oc || typeof oc !== "object") continue;
          const ocr = oc as Record<string, unknown>;
          const name = String(ocr.name ?? ocr.desc ?? ocr.type ?? ocr.selection ?? ocr.T ?? "").toLowerCase();
          const price = Number(ocr.odds ?? ocr.price ?? ocr.value ?? ocr.odd_value ?? ocr.C ?? 0);
          if (!price || price <= 1) continue;
          if (name === "1" || name === "home" || name.startsWith("home")) h = price;
          else if (name === "x" || name === "draw" || name.startsWith("draw")) d = price;
          else if (name === "2" || name === "away" || name.startsWith("away")) a = price;
        }
        if (h > 1 && a > 1) return { home: h, away: a, ...(d > 1 ? { draw: d } : {}) };
      }
    }
    // 1xbet-style flat array E with T (outcome type) + C (coefficient)
    const E = (o.E ?? o.Events ?? o.events) as unknown;
    if (Array.isArray(E)) {
      let h = 0, d = 0, a = 0;
      for (const e of E) {
        if (!e || typeof e !== "object") continue;
        const er = e as Record<string, unknown>;
        const t = Number(er.T);
        const c = Number(er.C);
        if (!c || c <= 1) continue;
        if (t === 1) h = c; else if (t === 2) d = c; else if (t === 3) a = c;
      }
      if (h > 1 && a > 1) return { home: h, away: a, ...(d > 1 ? { draw: d } : {}) };
    }
    return null;
  };

  for (const node of walk(root)) {
    let home: string | null = null;
    let away: string | null = null;
    for (const f of teamFields) {
      const v = getStr(node, f);
      if (v && !home) { home = v; continue; }
      if (v && !away && v !== home) { away = v; break; }
    }
    // Special-case pairs
    if (!home || !away) {
      const h = getStr(node, "homeTeamName") ?? getStr(node, "homeTeam") ?? getStr(node, "home_team") ?? getStr(node, "home");
      const a = getStr(node, "awayTeamName") ?? getStr(node, "awayTeam") ?? getStr(node, "away_team") ?? getStr(node, "away");
      if (h && a) { home = h; away = a; }
    }
    // 1xbet: O1 / O2 team names
    if (!home || !away) {
      const h = getStr(node, "O1");
      const a = getStr(node, "O2");
      if (h && a) { home = h; away = a; }
    }
    if (!home || !away) continue;
    let start: Date | null = null;
    for (const f of timeFields) {
      if (node[f] != null) { start = parseTime(node[f]); if (start) break; }
    }
    if (!start) continue;
    // Ignore matches already started (institutional bar)
    if (start.getTime() <= Date.now()) continue;
    const odds = findOdds(node);
    if (!odds) continue;
    const key = `${bookmaker}|${home.toLowerCase()}|${away.toLowerCase()}|${start.toISOString().slice(0,10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      bookmaker,
      fixtureKey: canonKey(home, away),
      homeTeam: home,
      awayTeam: away,
      commenceTime: start,
      markets: odds,
      sport,
    });
  }
  return out;
}

export async function runScraper(
  bookmaker: string,
  fn: () => Promise<ScrapedOdds[]>,
  timeoutMs = 10_000,
): Promise<ScraperResult> {
  const started = Date.now();
  try {
    const race = await Promise.race([
      fn(),
      new Promise<ScrapedOdds[]>((_, rej) => setTimeout(() => rej(new Error("scraper timeout")), timeoutMs)),
    ]);
    // A scraper that answers with zero rows is NOT healthy — either the endpoint
    // changed shape or it is being blocked. Reporting ok:true here previously hid
    // dead sources behind a green badge.
    if (race.length === 0) {
      return {
        bookmaker,
        ok: false,
        count: 0,
        latencyMs: Date.now() - started,
        error: "returned 0 matches (endpoint blocked or shape changed)",
        odds: [],
      };
    }
    return { bookmaker, ok: true, count: race.length, latencyMs: Date.now() - started, odds: race };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { bookmaker, ok: false, count: 0, latencyMs: Date.now() - started, error: msg, odds: [] };
  }
}