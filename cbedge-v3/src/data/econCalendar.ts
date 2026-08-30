import { useCallback, useEffect, useMemo, useState } from "react";
import { CAL, T } from "@/design/theme";

/**
 * econCalendar — shared types, ET helpers and filter logic for the economic
 * calendar feed.
 *
 * PROVENANCE: copied verbatim from components/dashboard/EconCalendarPanel.tsx,
 * which is the more complete of the two desktop implementations. The other,
 * components/pages/EconomicCalendar.tsx, holds a drifted duplicate — its
 * `FilterKey` union is missing "all-usd" and "earnings", and its day-separator
 * renderer omits the panel's `.sort()`. Both should be migrated onto this
 * module; the phone view already is, so there are two copies rather than three.
 *
 * Everything here is ET-based on purpose. A trader in London must see the same
 * "TODAY" and the same 30-minute staleness cutoff as one in New York, so every
 * date and clock value round-trips through Intl with timeZone: America/New_York
 * rather than reading the device's local time.
 */

export interface CalEvent {
  date: string;            // YYYY-MM-DD, ET
  time: string;            // HH:MM 24h, ET — the sort/compare key
  time_formatted: string;  // h:MM AM/PM, ET — the display key
  title: string;
  country: string;
  impact: string;          // High | Medium | Low | Holiday | President
  forecast: string;
  previous: string;
  actual: string;
}

export interface EarnRow {
  date: string;            // YYYY-MM-DD, ET
  symbol: string;
  company: string;
  session: "pre" | "after" | "unknown";
  market_cap: number;
  eps_est: string | null;
}

// The impact ramp, straight off tokens.css (--color-impact-*) rather than as
// hex — v2 typed these five values here, which is exactly the kind of second
// palette v3's no-literal rule exists to prevent. The values are unchanged.
export const IMPACT_COLOR: Record<string, string> = {
  High: CAL.high,
  Medium: CAL.medium,
  Low: CAL.low,
  Holiday: CAL.holiday,
  President: CAL.president,
};

export function impactColor(i: string): string {
  return IMPACT_COLOR[i] ?? CAL.low;
}

export function fmtMcap(n: number): string {
  if (!n) return "n/a";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${Math.round(n / 1e9)}B`;
  return `$${Math.round(n / 1e6)}M`;
}

export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

/** Rolling today → today+6, as YYYY-MM-DD ET strings. */
export function etWeekDays(): string[] {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, day] = todayStr.split("-").map(Number);
  // todayStr is Intl-formatted as YYYY-MM-DD, so split("-") always yields 3 parts.
  const base = new Date(y!, m! - 1, day!);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(base);
    x.setDate(base.getDate() + i);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  });
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Mon–Fri (YYYY-MM-DD, ET) of a trading week. `offsetWeeks` 0 = the week
 * containing today, 1 = next week, and so on.
 *
 * Weekends roll FORWARD, matching server-v2/earnings-calendar-recorder.js's
 * weekMonFri: on a Saturday "this week" is the week that starts on Monday, not
 * the one that just ended. The two must agree or the board asks the server for
 * a week it did not store.
 */
export function etMonFri(offsetWeeks = 0): string[] {
  const today = etToday();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const toMon = dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow;
  const mon = addDaysYmd(today, toMon + offsetWeeks * 7);
  return [0, 1, 2, 3, 4].map((i) => addDaysYmd(mon, i));
}

/** ET wall clock as a date string + minutes since midnight. */
export function etNowParts(nowMs: number): { date: string; minutes: number } {
  const d = new Date(nowMs);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const [h, m] = hm.split(":").map(Number);
  // hm is Intl-formatted as HH:MM (hour12: false), so split(":") always yields 2 parts.
  return { date, minutes: h! * 60 + m! };
}

/** An event goes stale 30 minutes after its scheduled start. */
export function isStale(ev: CalEvent, nowMs: number): boolean {
  const { date: etDate, minutes: nowMin } = etNowParts(nowMs);
  if (ev.date < etDate) return true;
  if (ev.date > etDate) return false;
  if (!ev.time) return false;
  const [h, m] = ev.time.split(":").map(Number);
  // ev.time is HH:MM (guarded non-empty above), so split(":") always yields 2 parts.
  const evMin = h! * 60 + m!;
  return nowMin - evMin > 30;
}

export function dayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export function fullDayLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "TODAY";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
}

export type FilterKey =
  | "all-usd"
  | "high-usd"
  | "high"
  | "medium-usd"
  | "medium"
  | "low-usd"
  | "low"
  | "trump"
  | "earnings"
  | "all";

export const FILTER_OPTS: { value: FilterKey; label: string; color: string }[] = [
  { value: "all-usd", label: "All·USD", color: CAL.accent },
  { value: "high-usd", label: "High·USD", color: CAL.high },
  { value: "high", label: "High", color: CAL.high },
  { value: "medium-usd", label: "Medium·USD", color: CAL.medium },
  { value: "medium", label: "Medium", color: CAL.medium },
  { value: "low-usd", label: "Low·USD", color: CAL.low },
  { value: "low", label: "Low", color: CAL.low },
  { value: "trump", label: "TRUMP", color: CAL.president },
  { value: "earnings", label: "Earnings", color: CAL.accent },
  { value: "all", label: "All", color: T.text },
];

export function passes(ev: CalEvent, active: Set<FilterKey>): boolean {
  if (active.has("all")) return true;
  if (active.has("trump") && ev.impact === "President") return true;
  if (active.has("all-usd") && ev.country === "USD") return true;
  if (active.has("high-usd") && ev.impact === "High" && ev.country === "USD") return true;
  if (active.has("high") && ev.impact === "High") return true;
  if (active.has("medium-usd") && ev.impact === "Medium" && ev.country === "USD") return true;
  if (active.has("medium") && ev.impact === "Medium") return true;
  if (active.has("low-usd") && ev.impact === "Low" && ev.country === "USD") return true;
  if (active.has("low") && ev.impact === "Low") return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANTICIPATED EARNINGS
//
//  The recorder now stores EVERY name Nasdaq lists (see its header — the old
//  $25B floor was silently deleting exactly the names anyone wanted). That is
//  ~400–500 rows a day, which no board can render, so the narrowing lives here
//  instead: one shared definition of "the names that matter", used by the week
//  board, the home panel and the phone view alike.
//
//  Two rules, OR'd:
//
//   1. MEGA_CAP — anything at or above $25B is anticipated by definition. This
//      is the old server floor, kept as a display rule where it belongs.
//   2. ANTICIPATED_SYMBOLS — a maintained list of names traders position for
//      regardless of size. This is the half the cap rule cannot express: CRDO,
//      GTLB, PATH, CIEN, FIVE, OLLI, DLTH, DAKT, KNOP are all "most anticipated"
//      board regulars and all far under $25B. Size is not interest.
//
//  Then each day is TOPPED UP to ANTICIPATED_PER_DAY with the largest remaining
//  caps, so a quiet Monday still shows a full column instead of two chips, and
//  a name that is genuinely big but missing from the list below cannot fall
//  through the gap.
//
//  Maintaining the list: add a ticker when it shows up on a most-anticipated
//  board and is under $25B. Removing one is never urgent — a stale entry costs
//  one chip on the day that company reports.
// ─────────────────────────────────────────────────────────────────────────────

/** Anticipated by size alone. Also the old server-side floor. */
export const MEGA_CAP = 25e9;

/** Per-day target for the anticipated view — roughly a full board column. */
export const ANTICIPATED_PER_DAY = 14;

export const ANTICIPATED_SYMBOLS: ReadonlySet<string> = new Set([
  // ── Semis / hardware ──
  "NVDA", "AMD", "AVGO", "MU", "MRVL", "ARM", "INTC", "TSM", "ASML", "QCOM", "TXN", "ADI",
  "ON", "MCHP", "SWKS", "QRVO", "WOLF", "LSCC", "AMBA", "CRDO", "ALAB", "RMBS", "SITM",
  "POWI", "MPWR", "SLAB", "PI", "INDI", "ALGM", "AOSL", "SMCI", "DELL", "HPE", "HPQ",
  "NTAP", "PSTG", "WDC", "STX", "ANET", "CIEN", "JNPR", "INFN", "COMM", "EXTR", "NTGR",
  "AMAT", "LRCX", "KLAC", "ENTG", "TER", "ACLS", "UCTT", "ICHR", "COHU", "FORM", "ONTO",
  "NVMI", "CAMT", "AEIS", "MKSI", "PLAB", "SGH", "VSH", "DIOD",
  // ── Software / SaaS / data ──
  "PLTR", "SNOW", "MDB", "NET", "DDOG", "CRWD", "ZS", "PANW", "S", "OKTA", "TWLO", "GTLB",
  "PATH", "AI", "CFLT", "ESTC", "DOCN", "FSLY", "SUMO", "BRZE", "AMPL", "GLBE", "ASAN",
  "MNDY", "TEAM", "NOW", "CRM", "WDAY", "ADBE", "ORCL", "IBM", "SAP", "INTU", "HUBS",
  "ZI", "BILL", "PCTY", "PAYC", "VEEV", "TYL", "SPSC", "AZPN", "PTC", "ANSS", "CDNS",
  "SNPS", "KEYS", "APPF", "BLKB", "DBX", "BOX", "ZM", "DOCU", "RNG", "FIVN", "NICE",
  "PEGA", "VERX", "NCNO", "OLO", "TOST", "SQ", "XYZ", "SHOP", "WIX", "SQSP", "YEXT",
  "SPRT", "CXM", "KVYO", "ZETA", "APP", "U", "RBLX", "TTD", "MGNI", "CRTO",
  "DV", "PUBM", "IAS", "RZLV", "BBAI", "SOUN", "TEM", "IONQ", "RGTI", "QBTS", "QUBT",
  "AUR", "LAZR", "OUST", "INVZ", "MVIS",
  // ── Internet / media ──
  "META", "GOOGL", "GOOG", "AMZN", "AAPL", "MSFT", "NFLX", "DIS", "PARA", "WBD", "ROKU",
  "SPOT", "SNAP", "PINS", "MTCH", "BMBL", "YELP", "TRIP", "ABNB", "BKNG", "EXPE", "UBER",
  "LYFT", "DASH", "GRAB", "SE", "MELI", "BABA", "JD", "PDD", "BIDU", "NTES", "TCOM",
  "IQ", "BILI", "WB", "TME", "DIDIY", "CANG", "GDS", "VNET", "EDU", "TAL", "ZH",
  // ── EV / auto / mobility ──
  "TSLA", "RIVN", "LCID", "NIO", "XPEV", "LI", "ZK", "PSNY", "GM", "F", "STLA", "HMC",
  "TM", "RACE", "MULN", "GOEV", "FFAI", "NKLA", "WKHS", "HYZN", "BLNK", "CHPT", "EVGO",
  "QS", "MVST", "FREY", "SLDP", "ENVX", "AMPX",
  // ── Crypto / fintech ──
  "COIN", "MARA", "RIOT", "CLSK", "HUT", "BITF", "CIFR", "WULF", "IREN", "HIVE", "BTBT",
  "CAN", "BTDR", "GLXY", "MSTR", "HOOD", "PYPL", "SOFI", "AFRM", "UPST", "LC", "NU",
  "MQ", "DLO", "PAGS", "STNE", "FOUR", "FI", "GPN", "RELY", "FLYW", "EVTC",
  "WEX", "JKHY", "ACIW", "ALLY", "SYF", "COF", "DFS", "AXP",
  // ── Retail / consumer ──
  "LULU", "NKE", "DECK", "ONON", "CROX", "SKX", "BIRD", "VFC", "PVH", "RL", "GPS", "ANF",
  "AEO", "URBN", "BKE", "CHWY", "FIVE", "OLLI", "DLTR", "DG", "TGT", "WMT", "COST", "BJ",
  "KR", "ACI", "SFM", "TJX", "ROST", "BURL", "M", "JWN", "KSS", "DDS", "BBWI", "VSCO",
  "GES", "LEVI", "CATO", "CHS", "TLYS", "ZUMZ", "BOOT", "SCVL", "GCO", "DLTH", "LE",
  "HIBB", "ASO", "DKS", "BGFV", "SPWH", "RCII", "CONN", "WSM", "RH", "ARHS", "LOVE",
  "PRPL", "TPX", "SNBR", "W", "BYON", "ETSY", "EBAY", "REAL", "TDUP", "POSH", "FIGS",
  "YETI", "SWBI", "RGR", "AOUT", "VSTO", "PLNT", "XPOF", "EL", "ELF", "COTY", "IPAR",
  "HELE", "NWL", "CENT", "WOOF", "PETQ", "IDXX", "FRPT", "CHEF", "SFD",
  // ── Restaurants / travel ──
  "CMG", "SBUX", "MCD", "YUM", "QSR", "WEN", "JACK", "SHAK", "CAVA", "SG", "PTLO", "WING",
  "TXRH", "DRI", "EAT", "BLMN", "CAKE", "DENN", "PLAY", "DPZ", "PZZA", "LUV", "DAL",
  "UAL", "AAL", "JBLU", "SAVE", "ALK", "RCL", "CCL", "NCLH", "MAR", "HLT", "H", "WH",
  // ── Food / staples ──
  "CPB", "GIS", "K", "KHC", "HRL", "SJM", "CAG", "MKC", "TSN", "TAP", "STZ", "BF.B",
  "DEO", "KO", "PEP", "MNST", "CELH", "KDP", "SAM", "FIZZ", "POST", "LW", "DAR", "INGR",
  "FLO", "THS", "UTZ", "JJSF", "LANC", "CALM", "VITL", "HAIN", "SMPL", "BRBR",
  // ── Health / medtech / biotech ──
  "MDT", "ISRG", "DXCM", "PODD", "TNDM", "IRTC", "NVRO", "PEN", "GMED", "ATEC", "SYK",
  "BSX", "ABT", "JNJ", "PFE", "MRK", "LLY", "ABBV", "BMY", "AMGN", "GILD", "BIIB",
  "VRTX", "REGN", "MRNA", "NVAX", "BNTX", "PHR", "DOCS", "HIMS", "TDOC", "GDRX", "OSCR",
  "CLOV", "ALHC", "MMED", "BLRX", "SRPT", "ALNY", "IONS", "BEAM", "NTLA", "CRSP",
  "EDIT", "VERV", "RXRX", "ABSI", "SDGR", "TEVA", "VTRS", "OGN", "WLY",
  // ── Industrials / defense / infra ──
  "BA", "GE", "CAT", "DE", "TTC", "HON", "MMM", "EMR", "ETN", "PH", "ROK", "AOS", "GNRC",
  "PWR", "AGX", "FIX", "EME", "MTZ", "PRIM", "ACM", "J", "STRL", "GVA", "TTEK", "WMS",
  "AWI", "TREX", "BLDR", "POOL", "SITE", "FAST", "GWW", "WSO", "MSM", "DXPE", "KMT",
  "LECO", "ITW", "DOV", "IEX", "XYL", "FLS", "PNR", "WTS", "ZWS", "CSWI", "AAON", "LII",
  "TT", "JCI", "CARR", "OTIS", "BRC", "DAKT", "BBCP", "DOO", "SAIC", "LDOS", "BAH",
  "CACI", "PSN", "KTOS", "AVAV", "RKLB", "ASTS", "PL", "SPCE", "LUNR", "RDW", "IOT",
  "HMR", "KNOP", "SSL", "GIII",
  // ── Energy / clean energy ──
  "FCEL", "PLUG", "BE", "BLDP", "HTOO", "ENPH", "SEDG", "RUN", "NOVA", "FSLR", "ARRY",
  "SHLS", "NXT", "CSIQ", "JKS", "DQ", "MAXN", "OKLO", "SMR", "NNE", "LEU", "CCJ", "UEC",
  "GOLD", "NEM", "AEM", "AU", "KGC", "HL", "CDE", "AG", "PAAS", "EXK", "FSM", "MAG",
  // ── Financial / insurance / other ──
  "GS", "MS", "JPM", "BAC", "C", "WFC", "SCHW", "BLK", "BX", "KKR", "APO", "ARES", "OWL",
  "LAZ", "EVR", "PJT", "HLI", "MC", "PIPR", "SF", "JEF", "IBKR", "VIRT", "MKTX", "CBOE",
  "CME", "ICE", "NDAQ", "TW", "COIN",
]);

/** True when a row is "anticipated" on its own merits (size or the list). */
export function isAnticipated(r: EarnRow): boolean {
  return (r.market_cap ?? 0) >= MEGA_CAP || ANTICIPATED_SYMBOLS.has(r.symbol);
}

/**
 * Narrow a full week of rows to the anticipated names, per day.
 *
 * Every row that `isAnticipated` survives, and each day is then topped up with
 * its largest remaining caps until it holds `perDay` names. Order within a day
 * is market cap descending, which is also the order the board's columns want.
 *
 * `perDay <= 0` returns everything, so a caller can offer an "All" view without
 * branching on a different code path.
 */
export function pickAnticipated(rows: EarnRow[], perDay = ANTICIPATED_PER_DAY): EarnRow[] {
  if (perDay <= 0) return rows;

  const byDate = new Map<string, EarnRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }

  const out: EarnRow[] = [];
  for (const list of byDate.values()) {
    const sorted = [...list].sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0));
    const keep: EarnRow[] = [];
    const kept = new Set<string>();
    for (const r of sorted) {
      if (isAnticipated(r)) { keep.push(r); kept.add(r.symbol); }
    }
    for (const r of sorted) {
      if (keep.length >= perDay) break;
      if (kept.has(r.symbol)) continue;
      keep.push(r);
      kept.add(r.symbol);
    }
    out.push(...keep);
  }
  return out;
}

export interface EarnBucket {
  pre: EarnRow[];
  after: EarnRow[];
  tbd: EarnRow[];
}

/**
 * date → { pre, after, tbd } earnings buckets.
 *
 * `tbd` did not used to exist: any row whose session was neither "pre" nor
 * "after" was DROPPED here and never rendered on any surface. That is not a
 * rare edge — Nasdaq marks the large majority of its calendar
 * "time-not-supplied" (on a typical day ~380 of ~490 rows), and that includes
 * real large caps.
 *
 * The bucket is kept SEPARATE rather than folded into pre/after on purpose:
 * guessing a session would put names on the wrong side of the close, which is
 * worse than saying the time is unconfirmed. The recorder's daily 06:30 ET
 * re-sweep is what drains this bucket as Nasdaq confirms times through the week.
 */
export function groupEarningsByDate(rows: EarnRow[]): Map<string, EarnBucket> {
  const map = new Map<string, EarnBucket>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { pre: [], after: [], tbd: [] });
    const b = map.get(r.date)!;
    if (r.session === "pre") b.pre.push(r);
    else if (r.session === "after") b.after.push(r);
    else b.tbd.push(r);
  }
  return map;
}

/** Total names in a bucket, across all three sessions. */
export function bucketCount(b: EarnBucket | undefined | null): number {
  return b ? b.pre.length + b.after.length + b.tbd.length : 0;
}


// ─────────────────────────────────────────────────────────────────────────────
//  THE HOOK — the calendar feed, fetched once and shaped for rendering.
//
//  Three endpoints in parallel:
//    /api/calendar         economic events (ForexFactory + the presidential feed)
//    /api/calendar-quote   the decorative quote of the day
//    /proxy/earnings-week  Mon-Fri of this week AND next, EVERY name Nasdaq lists
//
//  That last one returns ~2,500 rows across two weeks and the narrowing happens
//  HERE via pickAnticipated, so `earnings` / `earnByDate` stay board-sized while
//  `earningsAll` keeps the raw feed available for a surface that wants to widen
//  without another fetch.
//
//  FAILURE SEMANTICS WORTH KNOWING: /api/calendar answers HTTP 200 with an empty
//  events array when the upstream is down, so `res.ok` tells you nothing. The
//  real signal is `source` ("forexfactory" | "cache" | "saved" | "unavailable")
//  and `warning`, both surfaced here so a view can say "feed is stale" instead
//  of "no events this week".
//
//  The data does not poll — economic events are scheduled days ahead and the
//  server caches for 30 minutes. What ticks is `now`, once a minute, purely so
//  the staleness cutoff re-evaluates and events fade as they pass.
// ─────────────────────────────────────────────────────────────────────────────

const CLOCK_MS = 60_000;

export type EconCalendarState = {
  events: CalEvent[];
  /** Anticipated names only (see perDay). This is what a view should render. */
  earnings: EarnRow[];
  /** The unnarrowed feed - every name Nasdaq listed for both weeks. */
  earningsAll: EarnRow[];
  /** pre / after / tbd - see EarnBucket. `tbd` is the unconfirmed-time bucket. */
  earnByDate: Map<string, EarnBucket>;
  quote: string | null;
  /** Where /api/calendar got its data. "unavailable" means the feed is down. */
  source: string | null;
  warning: string | null;
  error: string | null;
  loading: boolean;
  /** Ticks once a minute; feed it to isStale(). */
  now: number;
  reload: () => Promise<void>;
};

export function useEconCalendar(
  opts: {
    withQuote?: boolean;
    /** 'this' | 'next' | 'both' - Mon-Fri range asked of the server. */
    week?: "this" | "next" | "both";
    /** Anticipated names per day. 0 = no narrowing (see pickAnticipated). */
    perDay?: number;
  } = {},
): EconCalendarState {
  const { withQuote = true, week = "both", perDay = ANTICIPATED_PER_DAY } = opts;
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [earnings, setEarnings] = useState<EarnRow[]>([]);
  const [quote, setQuote] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    setError(null);
    setWarning(null);
    setSource(null);
    try {
      const [econRes, qRes, earnRes] = await Promise.all([
        fetch("/api/calendar", { cache: "no-store" }),
        withQuote ? fetch("/api/calendar-quote", { cache: "no-store" }) : Promise.resolve(null),
        fetch(`/proxy/earnings-week?week=${week}`, { cache: "no-store" }),
      ]);

      const econJson = (await econRes.json().catch(() => null)) as
        | { source?: string; warning?: string; error?: string; events?: CalEvent[] }
        | CalEvent[]
        | null;
      if (!econRes.ok) {
        setError((econJson as { error?: string } | null)?.error ?? `HTTP ${econRes.status}`);
        setEvents([]);
      } else {
        const obj = (econJson ?? {}) as { source?: string; warning?: string; events?: CalEvent[] };
        setSource(obj.source ?? null);
        setWarning(obj.warning ?? null);
        const list: CalEvent[] = Array.isArray(obj.events)
          ? obj.events
          : Array.isArray(econJson)
            ? (econJson as CalEvent[])
            : [];
        setEvents(
          [...list].sort((a, b) =>
            a.date !== b.date ? a.date.localeCompare(b.date) : a.time.localeCompare(b.time),
          ),
        );
      }

      if (qRes && qRes.ok) {
        const qj = (await qRes.json().catch(() => null)) as { quote?: string } | null;
        if (qj?.quote) setQuote(qj.quote);
      }
      if (earnRes.ok) {
        const ej = (await earnRes.json().catch(() => null)) as { rows?: EarnRow[] } | null;
        setEarnings(Array.isArray(ej?.rows) ? ej.rows : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Calendar request failed");
    }
  }, [withQuote, week]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  // Narrow ONCE, here, so every consumer shows the same names and nobody
  // re-derives "which of these matter" per surface.
  const shown = useMemo(() => pickAnticipated(earnings, perDay), [earnings, perDay]);
  const earnByDate = useMemo(() => groupEarningsByDate(shown), [shown]);

  return {
    events,
    earnings: shown,
    earningsAll: earnings,
    earnByDate,
    quote,
    source,
    warning,
    error,
    loading,
    now,
    reload,
  };
}
