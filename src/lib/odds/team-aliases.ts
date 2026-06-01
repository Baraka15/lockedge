// Canonical team aliases. Keys are lowercase aliases; values are canonical
// lowercase names. Used after suffix-stripping & unicode normalisation.
const RAW_ALIASES: Record<string, string> = {
  // EPL / English football
  "man utd": "manchester united",
  "man united": "manchester united",
  "manchester utd": "manchester united",
  "man city": "manchester city",
  "spurs": "tottenham hotspur",
  "tottenham": "tottenham hotspur",
  "wolves": "wolverhampton wanderers",
  "wolverhampton": "wolverhampton wanderers",
  "newcastle": "newcastle united",
  "leeds": "leeds united",
  "west ham": "west ham united",
  "brighton": "brighton hove albion",
  "brighton hove": "brighton hove albion",
  "leicester": "leicester city",

  // La Liga
  "atletico": "atletico madrid",
  "athletic": "athletic bilbao",
  "athletic club": "athletic bilbao",
  "real": "real madrid",

  // Italy / Germany / France
  "inter": "internazionale",
  "inter milan": "internazionale",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "bayern": "bayern munich",
  "borussia dortmund": "borussia dortmund",
  "bvb": "borussia dortmund",

  // NBA short codes
  "lakers": "los angeles lakers",
  "la lakers": "los angeles lakers",
  "clippers": "los angeles clippers",
  "la clippers": "los angeles clippers",
  "warriors": "golden state warriors",
  "celtics": "boston celtics",
  "heat": "miami heat",
  "nets": "brooklyn nets",
  "knicks": "new york knicks",
  "sixers": "philadelphia 76ers",
  "76ers": "philadelphia 76ers",
  "mavs": "dallas mavericks",
  "mavericks": "dallas mavericks",
  "nuggets": "denver nuggets",
  "thunder": "oklahoma city thunder",
  "okc": "oklahoma city thunder",
  "blazers": "portland trail blazers",
  "trail blazers": "portland trail blazers",
  "wolves nba": "minnesota timberwolves",
  "timberwolves": "minnesota timberwolves",
  "cavs": "cleveland cavaliers",
  "sixers nba": "philadelphia 76ers",
};

// Suffixes/prefixes commonly attached to club names that should be stripped
// when comparing, but only as standalone trailing/leading tokens.
const STRIP_TOKENS = new Set([
  "fc",
  "cf",
  "afc",
  "sc",
  "ac",
  "if",
  "bk",
  "club",
  "the",
  "1.",
  "calcio",
]);

function unicodeFold(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Aggressive canonicalisation: unicode-fold, lowercase, strip punctuation,
 * collapse whitespace, drop common suffix/prefix tokens (FC, AFC, SC, ...).
 */
export function canonicalTeam(raw: string): string {
  if (!raw) return "";
  let s = unicodeFold(raw).toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^\p{L}\p{N}\s.]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Drop common stripped tokens (anywhere in the name, since they're stop-words)
  const tokens = s.split(" ").filter((t) => !STRIP_TOKENS.has(t));
  let cleaned = tokens.join(" ").trim();
  if (!cleaned) cleaned = s;

  // Resolve alias on the cleaned form, then on the raw lowercase form
  if (RAW_ALIASES[cleaned]) cleaned = RAW_ALIASES[cleaned];
  else if (RAW_ALIASES[s]) cleaned = RAW_ALIASES[s];

  return cleaned;
}

/**
 * Similarity in [0,1] between two team names after canonicalisation.
 * Uses token-set overlap (Jaccard) blended with character-level similarity
 * so "manchester united" ↔ "man united" scores high without matching across
 * unrelated teams.
 */
export function teamSimilarity(a: string, b: string): number {
  const ca = canonicalTeam(a);
  const cb = canonicalTeam(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const ta = new Set(ca.split(" ").filter(Boolean));
  const tb = new Set(cb.split(" ").filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const jaccard = union === 0 ? 0 : inter / union;

  // Dice coefficient on character bigrams adds robustness to small typos.
  const bigrams = (s: string) => {
    const out = new Set<string>();
    const clean = s.replace(/\s+/g, "");
    for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
    return out;
  };
  const ba = bigrams(ca);
  const bb = bigrams(cb);
  const bInter = [...ba].filter((g) => bb.has(g)).length;
  const dice = ba.size + bb.size === 0 ? 0 : (2 * bInter) / (ba.size + bb.size);

  return Math.max(jaccard, dice);
}