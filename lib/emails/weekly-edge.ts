// Weekly newsletter — "The Weekly Edge". Recaps last week's market action,
// previews this week's catalysts (FOMC, earnings, econ data), covers the
// oil/geopolitical situation, and closes with the CB Edge dashboard scorecard
// (Core, Estimated Move) as social proof + a CTA. NOTE: the metric is called
// "Core" in all customer-facing copy — the opts are still named
// coreBullseye* so call sites do not churn, but nothing rendered says
// "Bullseye". Keep it that way.
//
// Data-driven via opts — every number below is a parameter so this template
// gets reused week to week without touching markup. Sensible defaults are
// filled in from the most recent week so a blank call still renders.
//
// CURRENT ISSUE: week of Sep 14-18, 2026. Recap covers Sep 8-11 (sticky core
// CPI at +0.3%, hike odds to ~90%, the 10-year knocking on 5%); the week ahead
// is the FOMC decision + dot plot Wednesday at 2:00 with retail sales that
// morning, and QUARTERLY EXPIRATION Friday.
//
// DASHBOARD PLACEHOLDERS: every stat block is empty and renders as a dashed
// "[ADD ...]" box - the two result tiles, the confidence table, the auto-buy
// rows, the scanner catch and the core-migration chart. Fill from the owner
// Results / Scanner pages before sending. An unfilled stat reads as an obvious
// blank, never as last week's number.
//
// Same brand shell/conventions as cb-confidence.ts (see EMAILS_HANDOFF.md),
// with one deliberate deviation: logo is TOP-LEFT (not centered) per request.
// Palette: bg #05060A · panel #0D1119 · cyan #219EBC · accent #8ECAE6 ·
// green #00E676 · amber #FFB300 · red #FF4757.

import { unsubscribeUrl, UNSUB_URL_PLACEHOLDER } from "@/lib/unsubscribe";

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://cbedge.net").replace(/\/$/, "");
const LOGO_URL = `${SITE_URL}/cb-edge-logo.png`;
const PRICING_URL = `${SITE_URL}/pricing`;
/** Affiliate portal. Its own subdomain/container — NOT a route under SITE_URL. */
const AFFILIATE_URL = "https://affiliate.cbedge.net";
/** Banner art lives in `public/`, so it is served from the main site root. */
const AFFILIATE_BANNER_URL = `${SITE_URL}/affiliate-program-banner.jpg`;
/**
 * Wall-migration chart for the recapped week, also out of `public/`. DATED
 * FILENAME on purpose — a new one ships each issue, so a generic name would
 * overwrite the art in every previously sent letter still sitting in inboxes.
 */
const WALL_CHART_URL = `${SITE_URL}/core-migration-2026-09-11.png`;
/**
 * Tradeify partner link. Third-party host, so `lib/emails/utm.ts` leaves it
 * alone by design (rule 4: never tag someone else's site) — the `?ref=Bzila`
 * is the attribution and must survive untouched.
 */
const TRADEIFY_URL = "https://tradeify.co/?ref=Bzila";
const TRADEIFY_CODE = "BZILA";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

/** Same stack the rest of the file spells out inline; newer blocks use this. */
const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

export interface IndexMove { name: string; pct: string; }
export interface CalendarEvent { day: string; desc: string; }
/** One pull-quote in the AI band. `quote` must stay verbatim and attributed. */
export interface StoryQuote { quote: string; name: string; org: string; }
export interface EarningsTicker { symbol: string; logoUrl?: string; }
export interface EarningsDay { label: string; tickers: EarningsTicker[]; }
export interface ConfRow { date: string; s945: string; c945: string; s1030: string; c1030: string; s1200: string; c1200: string; hit945: boolean; hit1030: boolean; hit1200: boolean; }

/**
 * A flow-scanner card, reproduced in HTML rather than screenshotted so it stays
 * crisp and dark-mode-safe. Same shape and field names as the one in
 * `edge3-annual.ts` — if you change the real scanner card, change both.
 */
export interface ScannerProof {
  /** Rank badge shown before the ticker, e.g. "2". */
  rank: string;
  ticker: string;
  /** Premium on the sweep, as rendered on the card, e.g. "0.6M". */
  premium: string;
  /** Right-hand number on the card header, e.g. "68". */
  headline: string;
  expiry: string;
  /** Spot at capture. */
  spot: string;
  /** When the scanner flagged it, e.g. "Aug 14 · 2:00 PM ET". */
  captured: string;
  otm: string;
  vsOpen: string;
  score: string;
  strength: string;
  /**
   * The move, stated as the contract's own premium. OPTIONAL — leave all three
   * as "" when no price line was captured and the result row is dropped
   * entirely.
   *
   * NEVER SYNTHESISE THIS FROM `vsOpen`. "+406% vs open" is a scanner metric
   * about unusual activity against open interest; it is NOT what the contract
   * returned. Presenting one as the other would be a fabricated performance
   * claim.
   */
  resultFrom: string;
  resultTo: string;
  resultPct: string;
}

/**
 * One Core Wall auto-buy print.
 *
 * TWO DIFFERENT NUMBERS, AND THEY MUST NOT BE CONFLATED:
 *  - `close` / `realizedPct` / `dollars` — the REAL result. Bought at the CB
 *    window, held to the bell, sold at the close. This is what the dashboard's
 *    P/L column reports and it is the number the letter leads with.
 *  - `peak` / `peakPct` — the intraday high on the way. NOT an exit. Nobody
 *    sells the high; it is context for how the trade travelled, nothing more.
 *
 * The table headers label both explicitly. Never present `peakPct` as the
 * result, and never drop the labels to save a line — a peak shown as realized
 * P&L is the single easiest way to make this letter dishonest.
 */
/**
 * One GEX-scanner flag. `peak` is the contract's intraday high AFTER the flag,
 * exactly as on the auto-buy table — not an exit, and the column header says so.
 */
export interface GexScannerRow {
  /** Scanner grade, e.g. "A+" or "B". */
  grade: string;
  symbol: string;
  /** Strike + right, e.g. "875P". */
  contract: string;
  /** Contract expiry, e.g. "2026-08-31". */
  expiry: string;
  /** When the scanner flagged it, e.g. "10:47 AM". */
  flagged: string;
  entry: string;
  peak: string;
  peakAt: string;
  /** Pre-computed, e.g. "+219%". */
  gain: string;
}

export interface AutoBuyRow {
  date: string;
  /** CB window — "9:45", "10:30" or "12:00". */
  time: string;
  /** Contract as the dashboard renders it, e.g. "7720C". */
  contract: string;
  /** Fill price at the window. */
  entry: string;
  /**
   * THE ACTUAL EXIT — the dashboard's "sold"/CLOSE price at the bell.
   * OPTIONAL: some exports only carry entry + peak. When close is omitted on
   * ANY row the table drops the Realized column entirely and presents itself as
   * peak-only, rather than showing a blank cell that a reader fills in with an
   * assumption. Half a realized column is worse than none.
   */
  close?: string;
  /** Realized return from entry to close, e.g. "+808%". */
  realizedPct?: string;
  /** Realized dollars per contract, e.g. "+$2,465". */
  dollars?: string;
  /** Intraday high after entry — NOT an exit. */
  peak: string;
  /** Time of that high, e.g. "2:02 PM". */
  peakAt: string;
  /** Return at that high, e.g. "+1,069%". */
  peakPct: string;
}

export interface WeeklyEdgeOpts {
  issueLabel?: string;              // e.g. "Week of Jul 27"
  recapHeadline?: string;
  recapBody?: string[];             // paragraphs
  indexMoves?: IndexMove[];         // S&P/Nasdaq/Dow style tiles
  aheadHeadline?: string;
  calendarEvents?: CalendarEvent[];
  earningsDays?: EarningsDay[];
  /** "" hides the paragraph under the week-ahead calendar. */
  aheadNote?: string;
  /** Set false to drop the AI-story band. */
  showAiStory?: boolean;
  aiStoryEyebrow?: string;
  aiStoryHeadline?: string;
  aiStoryQuotes?: StoryQuote[];
  /** Body paragraphs under the quotes. */
  aiStoryBody?: string[];
  /** Smaller muted counter-read line. Keep it — see the note in withDefaults. */
  aiStoryCounter?: string;
  oilHeadline?: string;
  oilPrice?: string;
  oilChangeNote?: string;
  oilBody?: string[];
  coreBullseyePct?: string;
  coreBullseyeSub?: string;
  estMovePct?: string;
  estMoveSub?: string;
  confRows?: ConfRow[];
  resultsNote?: string;
  /** Second paragraph under the results table — the Estimated Move read. */
  estMoveNote?: string;
  /** Scanner-proof card. */
  showScannerProof?: boolean;
  scannerProof?: Partial<ScannerProof>;
  /** Caption under the scanner card. "" hides it. */
  scannerProofNote?: string;
  /** GEX-scanner table. Empty array renders the dashed placeholder instead. */
  gexScannerRows?: GexScannerRow[];
  gexScannerLabel?: string;
  gexScannerNote?: string;
  /** Set false to drop the wall-migration chart. */
  showWallChart?: boolean;
  /** Empty string renders the dashed placeholder instead of a broken image. */
  wallChartUrl?: string;
  wallChartLabel?: string;
  wallChartHeadline?: string;
  wallChartNote?: string;
  /** Set false to drop the Core Wall auto-buy table. */
  showAutoBuy?: boolean;
  autoBuyRows?: AutoBuyRow[];
  autoBuyLabel?: string;
  autoBuyNote?: string;
  ctaUrl?: string;
  /** Headline pricing. No promo code — the price IS the price. */
  priceMonthly?: string;
  priceAnnual?: string;
  /** Set false to drop the affiliate-program band entirely. */
  showAffiliate?: boolean;
  affiliateHeadline?: string;
  affiliateBody?: string[];
  affiliateUrl?: string;
  affiliateBannerUrl?: string;
  /** Set false to drop the Tradeify partner band entirely. */
  showTradeify?: boolean;
  tradeifyHeadline?: string;
  tradeifyBody?: string;
  tradeifyUrl?: string;
  tradeifyCode?: string;
  /** Recipient email — when set, renders a real tokenized unsubscribe link. */
  email?: string | null;
}

// Russell rather than the Dow this week on purpose: the gap between mega-cap AI
// and small caps IS the story, and a flat Dow tile would hide it.
const DEFAULT_INDEX_MOVES: IndexMove[] = [
  { name: "S&amp;P 500", pct: "-0.8%" },
  { name: "Nasdaq", pct: "-0.7%" },
  { name: "Dow", pct: "-1.6%" },
];

const DEFAULT_CALENDAR: CalendarEvent[] = [
  { day: "MON 9/14", desc: "Nothing on the calendar. The tape spends the day positioning into Wednesday." },
  { day: "TUE 9/15", desc: "<strong>Empire State Manufacturing</strong> at 8:30, and the <strong>FOMC's two-day meeting begins</strong>. Trip.com reports after the close." },
  { day: "WED 9/16", desc: "<strong>August retail sales</strong> plus import and export prices at 8:30. Then the whole week: the <strong>FOMC statement and the dot plot at 2:00</strong>, and <strong>Chair Warsh's press conference at 2:30</strong>. General Mills before the bell, Lennar after it — a homebuilder reporting into 7%+ mortgage rates, hours after the Fed speaks." },
  { day: "THU 9/17", desc: "<strong>Jobless claims</strong>, housing starts and building permits at 8:30, pending home sales at 10:00 — the first full session to trade the decision rather than anticipate it. Darden and Carnival before the bell, <strong>FedEx</strong> after the close." },
  { day: "FRI 9/18", desc: "Industrial production at 9:15 and Leading Indicators at 10:00 — and <strong>quarterly expiration</strong>. Quad witching, the biggest gamma roll of the quarter." },
];


// Only two days have names worth showing. A grid padded out with filler on a
// holiday-shortened week reads as a busier calendar than the week actually is.
// The Fed is the event, but this is not an empty earnings week — FedEx Thursday
// night is a real macro read on freight, and Lennar reports hours after the
// decision with mortgage rates over 7%.
//
// SOURCING CAVEAT: Kiplinger's day-by-day calendar gives PLAY / TCOM / LEN /
// CCL. GIS, DRI and FDX come from a second source whose weekday labels were
// wrong (it called Sep 17 a Wednesday), so those three are placed on their
// customary slots — GIS Wed BMO, DRI Thu BMO, FDX Thu AMC. VERIFY before send.
const DEFAULT_EARNINGS: EarningsDay[] = [
  { label: "Mon 9/14", tickers: [{ symbol: "PLAY" }] },
  { label: "Tue 9/15", tickers: [{ symbol: "TCOM" }] },
  { label: "Wed 9/16 — Lennar reports after the Fed", tickers: [{ symbol: "GIS" }, { symbol: "LEN" }] },
  { label: "Thu 9/17 — FedEx after the close", tickers: [{ symbol: "FDX" }, { symbol: "DRI" }, { symbol: "CCL" }] },
];




/**
 * GEX-scanner flags from Friday 8/28 that worked. All three are PUTS, which is
 * the day: Warsh spoke, the tape rolled over, and the scanner was leaning the
 * right way. Filtered to winners — the section label says so.
 */
const DEFAULT_GEX_SCANNER_ROWS: GexScannerRow[] = [];



/**
 * Core Wall auto-buy prints, week of Aug 24–28. These are the FIVE BEST of the
 * fifteen the wall took that week — 6 of the 15 peaked at 2x or better, 14 of 15
 * peaked above entry, and one (8/24 10:30, 7630P) never ticked up at all. The
 * note under the table states that split; do not print the winners without it.
 */
const DEFAULT_AUTO_BUY_ROWS: AutoBuyRow[] = [
  { date: "09-09", time: "9:45", contract: "7630P", entry: "$4.95", peak: "$11.55", peakAt: "11:27 AM", peakPct: "+133%" },
  { date: "09-09", time: "10:30", contract: "7630P", entry: "$3.45", peak: "$13.70", peakAt: "11:25 AM", peakPct: "+297%" },
  { date: "09-09", time: "12:00", contract: "7630P", entry: "$6.25", peak: "$9.45", peakAt: "12:20 PM", peakPct: "+51%" },
];



/**
 * Daily Core rows, newest first, off the owner Results page.
 *
 * Aug 24–28. An empty array renders the dashed "[ADD CB EDGE SCREENSHOT /
 * CONFIDENCE TABLE HERE]" placeholder instead — use that rather than shipping a
 * stale week.
 *
 * THE ✓/✗ IS THE ≤5-POINT COLUMN. The Results page scores three thresholds per
 * window (≤5 / ≤10 / ≤15); this table has room for one, and every previous
 * issue used ≤5, so ≤5 it stays — do not switch to ≤15 to flatter a week.
 * Where ≤5 hides something, say it in `resultsNote` rather than letting the
 * table imply a clean whiff. This week that matters twice: 8/25 10:30 (10.7)
 * and 8/24 9:45 (9.7) both cleared ≤15, and only 8/28 9:45 (22.1) and 8/24
 * 10:30 (15.2) missed every threshold.
 */
const DEFAULT_CONF_ROWS: ConfRow[] = [
  { date: "09-11", s945: "7700", c945: "24.5", hit945: false, s1030: "7700", c1030: "24.5", hit1030: false, s1200: "7680", c1200: "4.5", hit1200: true },
  { date: "09-10", s945: "7590", c945: "0.1", hit945: true, s1030: "7620", c1030: "10.3", hit1030: false, s1200: "7590", c1200: "0.1", hit1200: true },
  { date: "09-09", s945: "7630", c945: "0.4", hit945: true, s1030: "7630", c1030: "0.4", hit1030: true, s1200: "7630", c1200: "0.4", hit1200: true },
  // 12:00 landed 5.0 away and scored a MISS — the <=5 test is strict, not
  // rounded. Left as the dashboard scored it; resultsNote calls it out.
  { date: "09-08", s945: "7650", c945: "21.7", hit945: false, s1030: "7675", c1030: "3.3", hit1030: true, s1200: "7700", c1200: "5.0", hit1200: false },
];



/**
 * The week's scanner example. Flagged Aug 14 on the 2026-08-21 expiry, so the
 * whole run resolved inside the Aug 17–21 week this issue recaps. Same catch as
 * `edge3-annual.ts` → `DEFAULT_PROOF` — keep the two in sync if either changes.
 */
const DEFAULT_SCANNER_PROOF: ScannerProof = {
  rank: "3",
  ticker: "AMD",
  premium: "1.8M",
  headline: "520",
  expiry: "2026-09-09",
  spot: "493.51",
  captured: "Sep 8 · 10:15 AM ET",
  otm: "5.4%",
  vsOpen: "+406%",
  score: "8",
  strength: "Very strong",
  // No price line supplied for this catch, so NO RESULT ROW. See the note on
  // the interface: an absent result is rendered as absent, never inferred from
  // the card's own metrics.
  resultFrom: "",
  resultTo: "",
  resultPct: "",
};

function withDefaults(opts: WeeklyEdgeOpts): Required<Pick<WeeklyEdgeOpts,
  "issueLabel" | "recapHeadline" | "recapBody" | "indexMoves" | "aheadHeadline" | "calendarEvents" |
  "earningsDays" | "aheadNote" |
  "showAiStory" | "aiStoryEyebrow" | "aiStoryHeadline" | "aiStoryQuotes" | "aiStoryBody" | "aiStoryCounter" | "oilHeadline" | "oilPrice" | "oilChangeNote" | "oilBody" |
  "coreBullseyePct" | "coreBullseyeSub" | "estMovePct" | "estMoveSub" |
  "confRows" | "resultsNote" | "estMoveNote" | "showScannerProof" | "scannerProofNote" |
  "gexScannerRows" | "gexScannerLabel" | "gexScannerNote" |
  "showWallChart" | "wallChartUrl" | "wallChartLabel" | "wallChartHeadline" | "wallChartNote" |
  "showAutoBuy" | "autoBuyRows" | "autoBuyLabel" | "autoBuyNote" | "ctaUrl" | "priceMonthly" | "priceAnnual" |
  "showAffiliate" | "affiliateHeadline" | "affiliateBody" | "affiliateUrl" | "affiliateBannerUrl" |
  "showTradeify" | "tradeifyHeadline" | "tradeifyBody" | "tradeifyUrl" | "tradeifyCode">>
  // scannerProof is Partial<> on the way in and complete on the way out, so it
  // is intersected rather than Pick'd — Required<Partial<X>> is still Partial<X>.
  & { scannerProof: ScannerProof } {
  return {
    issueLabel: opts.issueLabel || "Week of Sep 14–18",
    recapHeadline: opts.recapHeadline || "Core CPI came in hot, and the 10-year went looking for 5%",
    recapBody: opts.recapBody || [
      "Four sessions, and Friday was the only green one. The S&amp;P finished the week -0.8%, the Nasdaq -0.7%, the Dow -1.6%, with Friday's bounce snapping a four-day losing streak. August CPI itself was fine — +0.4% on the month, 3.4% year over year, both in line. <strong style=\"color:#ffffff;\">Core was the problem: +0.3% against +0.2% expected.</strong> That is the number the Fed actually reacts to, and odds of a hike at this week's meeting went to roughly 90%.",
      "The bond market did the moving. The 10-year pushed toward 5%, Germany's went through 3.51% and Japan's hit 2.985% — its highest since 1996. The consumer is not enjoying it either: preliminary Michigan sentiment came in at 47.8 against 51.0 expected. The bright spot was Oracle, where cloud revenue grew 62% year over year and dragged the rest of the AI-infrastructure complex up with it. Energy did the other half of the damage — more on that below.",
    ],
    indexMoves: opts.indexMoves || DEFAULT_INDEX_MOVES,
    aheadHeadline: opts.aheadHeadline || "The Fed decides Wednesday at 2:00, and Friday is quarterly expiration",
    calendarEvents: opts.calendarEvents || DEFAULT_CALENDAR,
    earningsDays: opts.earningsDays || DEFAULT_EARNINGS,
    // Sourced Sep 12-13 across Axios, ABC News, CNBC and the Washington Post.
    // Every quote here is verbatim from those reports — "take over the entire
    // internet", "pace the frontier", "Dario is right". Do not paraphrase them
    // into something punchier; they are quotes and they are attributed.
    // The Palihapitiya criticism stays in. Three CEOs agreeing is the story,
    // but printing it without the obvious counter-read — that a slowdown suits
    // the incumbent proposing it — would be carrying their water.
    aheadNote: opts.aheadNote ?? "",
    showAiStory: opts.showAiStory !== false,
    aiStoryEyebrow: opts.aiStoryEyebrow || "The AI trade",
    aiStoryHeadline: opts.aiStoryHeadline || "Three CEOs who compete on this just agreed to slow it down",
    // VERBATIM AND ATTRIBUTED. Sourced Sep 12–13 from Axios, ABC News, CNBC and
    // the Washington Post. Do not tighten these into punchier lines — they are
    // quotations with names on them.
    aiStoryQuotes: opts.aiStoryQuotes || [
      { quote: "We must slow the pace at which we improve the capabilities of AI models.", name: "Dario Amodei", org: "Anthropic" },
      { quote: "I agree with Dario that we need to pace the frontier.", name: "Sam Altman", org: "OpenAI" },
      { quote: "Dario is right.", name: "Elon Musk", org: "xAI" },
    ],
    aiStoryBody: opts.aiStoryBody || [
      "Amodei's warning on Friday was that AI agents could &ldquo;take over the entire internet&rdquo; inside six to twelve months. Altman and Musk agreed the same afternoon. Nothing proposed is binding.",
      "<strong style=\"color:#ffffff;\">What it means for the tape:</strong> the AI-capex complex is what has carried this market — it is most of why the Nasdaq held up through August, and it is why Oracle moved the whole group last week. That complex now has its own founders arguing publicly for a slower build, landing in the same four-day week as a Fed decision and a quarterly expiration.",
    ],
    // KEEP THIS. Three competing CEOs agreeing is the story; printing it without
    // the cui-bono objection would be carrying their water.
    aiStoryCounter: opts.aiStoryCounter ??
      "Not everyone read it as altruism — Chamath Palihapitiya argued the essay conveniently concentrates power with Anthropic, and the administration has shown no appetite for slowing anything down.",
    oilHeadline: opts.oilHeadline || "Crude is back over $100",
    oilPrice: opts.oilPrice || "$100.05",
    oilChangeNote: opts.oilChangeNote || "WTI, Sep 11 · roughly +8% on the week · refiners at 52-week highs",
    oilBody: opts.oilBody || [
      "WTI closed the week at $100.05, up about 8% and back over the hundred handle after recovering from Thursday's dip. Refiners pushed to 52-week highs on it. Two weeks ago this letter had crude at $83 and the war premium draining away; it is now $100 with the premium fully back on, which is a useful reminder of how fast that particular read can go stale.",
      "The part that matters for Wednesday: this is the same energy complex doing most of the lifting inside the CPI print the Fed is about to respond to. Crude at $100 alongside core running +0.3% is the hawkish argument delivered in two numbers, and it is why the dot plot is the thing to watch rather than the hike itself.",
    ],
    // 7 of 12 inside 5 points — the weakest week this letter has printed. Tile
    // is the best window (12:00, 3 of 4). Do NOT widen the threshold to make it
    // look better; the note carries the bad number in full.
    coreBullseyePct: opts.coreBullseyePct || "75%",
    coreBullseyeSub: opts.coreBullseyeSub || "&le;5 pts &middot; 12:00 CB &middot; 3 of 4 sessions",
    // A "loss" here is a BREACH — price left the estimated-move band. Do not
    // write the note as "failed to reach"; that is the opposite of what happens.
    // What decides the week is whether the RANGE stays inside the band, not the
    // VIX level on its own. Expiration week and an FOMC day both widen realized
    // range, so expect pressure on this number.
    // CORE BOARD ONLY this week (22 names). The prior three issues quoted the
    // full 404-ticker universe. DIFFERENT DENOMINATOR — the sub says so, and so
    // does the note, because 71.7% -> 70.0% looks like a flat week and is not a
    // like-for-like comparison. If the all-tickers number turns up, use that in
    // the tile and keep Core Board in the note, as previous issues did.
    estMovePct: opts.estMovePct || "70.0%",
    estMoveSub: opts.estMoveSub || "Core Board &middot; 14-6 &middot; 20 of 22 scored",
    confRows: opts.confRows || DEFAULT_CONF_ROWS,
    resultsNote: opts.resultsNote ||
      "A ✓ means the Core read landed within 5 points of where SPX actually printed. Over the four sessions of Sep 8–11 that was <strong style=\"color:#ffffff;\">7 of 12</strong> — 3 of 4 at 12:00, 2 of 4 at both 9:45 and 10:30. That is the weakest week since this letter started printing the table, and the rows show where it went: Friday's CPI open put both morning windows 24.5 points out, and Tuesday's 9:45 missed by 21.7. The two middle sessions went 5 of 6 between them. One more worth flagging — Tuesday's 12:00 landed 5.0 points away and scored as a miss. The test is strict, not rounded, and it stays that way in a bad week as well as a good one.",
    estMoveNote: opts.estMoveNote ||
      "Estimated Move on the Core Board: <strong style=\"color:#ffffff;\">14 wins against 6 losses</strong> across the 22 names, 70.0%. A win is price staying inside the band, so the number tracks how far the tape actually travelled versus what implied vol said it would. One clarification, because it matters for anyone keeping score: last week's letter quoted 71.7% on the full 404-ticker universe, and this week's 70.0% is the 22-name Core Board. Similar figures, different measurements — not a flat week.",
    // Flip to `!== false` (or pass showScannerProof: true) once a catch is in;
    // until then the section renders its dashed placeholder rather than
    // carrying last issue's DELL card forward into a new letter.
    showScannerProof: opts.showScannerProof !== false,
    scannerProof: { ...DEFAULT_SCANNER_PROOF, ...(opts.scannerProof || {}) },
    // Names the flag time, the high AND where it last marked. The high is the
    // headline number on the dashboard card, so it is the one a reader will
    // check — but a high is not an exit, and $15.65 is the honest second half
    // of that sentence. Do not print the 1,019% without the $15.65.
    scannerProofNote: opts.scannerProofNote ??
      "Flagged <strong style=\"color:#ffffff;\">Sep 8 at 10:15 AM</strong> with AMD at 493.51 — a 520 call 5.4% out of the money on the very next day's expiry, graded A+ on 1.8M in premium. The scanner's claim is the flag and the timestamp, both of which are on the card. One contract is not a track record, and options can and do go to zero.",
    gexScannerRows: opts.gexScannerRows || DEFAULT_GEX_SCANNER_ROWS,
    // The label says "winners" out loud. That is the denominator disclosure for
    // a filtered list — do not soften it to "flags" or "catches", which would
    // read as if these were all of them.
    gexScannerLabel: opts.gexScannerLabel || "GEX scanner — this week's winners",
    // The one caption in this band — it says what the table cannot: the
    // direction was right BEFORE the move, and the timestamps prove it. Rewrite
    // it for the new rows; if it no longer states something the columns miss,
    // leave it "" rather than filling space.
    gexScannerNote: opts.gexScannerNote ?? "",
    showWallChart: opts.showWallChart !== false,
    // Dated file, one per issue. Next week: save the new PNG to public/ under a
    // new date and repoint WALL_CHART_URL — never reuse a filename, or every
    // already-delivered letter silently starts showing the newer chart.
    // "" renders the dashed placeholder. Save this week's PNG to public/ under a
    // NEW dated name and point this at it — WALL_CHART_URL still holds LAST
    // week's file and reusing it would show the wrong five sessions.
    wallChartUrl: opts.wallChartUrl ?? WALL_CHART_URL,
    // SPANS SEP 4, NOT SEP 8. The chart's own first panel is FRIDAY 9/4 — five
    // sessions back from 9/11 reaches past the Labor Day holiday. Labelling it
    // "Sep 8–11" would contradict the day labels printed inside the image.
    wallChartLabel: opts.wallChartLabel || "Core migration — five sessions, Sep 4 to Sep 11",
    wallChartHeadline: opts.wallChartHeadline || "Four sessions of the walls stepping down, then Friday's CPI gap",
    wallChartNote: opts.wallChartNote ?? "",
    showAutoBuy: opts.showAutoBuy !== false,
    autoBuyRows: opts.autoBuyRows || DEFAULT_AUTO_BUY_ROWS,
    autoBuyLabel: opts.autoBuyLabel || "Core Wall auto buy — Wednesday Sep 9",
    autoBuyNote: opts.autoBuyNote ??
      "All three windows bought the same put on Wednesday. The 10:30 fill at <strong style=\"color:#ffffff;\">$3.45</strong> was the best of them and produced the biggest move; the 12:00 paid $6.25 for the same contract two hours later and got the least out of it. Same read, three entries, three very different outcomes.",
    ctaUrl: opts.ctaUrl || PRICING_URL,
    // NO PROMO CODE. Pricing is $50/mo or $500/yr flat — do not reintroduce
    // EDGE3, a struck-through list price, or "instead of $1,000". That offer is
    // retired; a letter still quoting it sends people to a checkout that
    // disagrees with the email, which is the worst kind of copy bug.
    priceMonthly: opts.priceMonthly || "$50",
    priceAnnual: opts.priceAnnual || "$500",
    // `!== false` rather than `||` — the band is on by default, and passing
    // showAffiliate: false has to actually turn it off.
    showAffiliate: opts.showAffiliate !== false,
    affiliateHeadline: opts.affiliateHeadline || "The CB Edge affiliate program is live",
    affiliateBody: opts.affiliateBody || [
      "One flat rate — <strong style=\"color:#ffffff;\">20% of every payment</strong>, on the first invoice and on every renewal for as long as that member stays subscribed. No tiers, no volume ladder to climb.",
      "Sales attribute either by your code at checkout or by a 60-day cookie on your link, with the code winning if both apply. Commission holds 30 days to clear refunds, then pays out by Stripe, PayPal or Zelle. Applying takes about two minutes and review is usually same-day.",
    ],
    affiliateUrl: opts.affiliateUrl || AFFILIATE_URL,
    affiliateBannerUrl: opts.affiliateBannerUrl || AFFILIATE_BANNER_URL,
    showTradeify: opts.showTradeify !== false,
    tradeifyHeadline: opts.tradeifyHeadline || "Trading these levels funded? My Tradeify code is BZILA",
    tradeifyBody: opts.tradeifyBody ||
      "Tradeify is the futures prop firm I use. Sign up through the link below, or enter code <strong style=\"color:#ffffff;\">BZILA</strong> at checkout.",
    tradeifyUrl: opts.tradeifyUrl || TRADEIFY_URL,
    tradeifyCode: opts.tradeifyCode || TRADEIFY_CODE,
  };
}

export const WEEKLY_EDGE_SUBJECT = "The Weekly Edge — the Fed decides Wednesday, and Friday is quad witching";

/** Plain-text fallback. */
export function weeklyEdgeText(opts: WeeklyEdgeOpts = {}): string {
  const o = withDefaults(opts);
  // Strip tags AND decode the handful of entities the HTML copy carries, so the
  // plain-text part doesn't ship literal "S&amp;P 500" to text-only clients.
  const strip = (s: string) =>
    s.replace(/<[^>]+>/g, "")
     .replace(/&middot;/g, "·")
     .replace(/&nbsp;/g, " ")
     .replace(/&le;/g, "≤")
     .replace(/&ge;/g, "≥")
     .replace(/&rarr;/g, "→")
     .replace(/&lt;/g, "<")
     .replace(/&gt;/g, ">")
     .replace(/&quot;/g, '"')
     .replace(/&#39;/g, "'")
     .replace(/&amp;/g, "&");
  return [
    `THE WEEKLY EDGE — ${o.issueLabel.toUpperCase()}`,
    "",
    "LAST WEEK RECAP",
    strip(o.recapHeadline),
    ...o.indexMoves.map((m) => `${strip(m.name)}: ${m.pct}`),
    "",
    ...o.recapBody.map(strip),
    "",
    "THIS WEEK AHEAD",
    strip(o.aheadHeadline),
    ...o.calendarEvents.map((e) => `${e.day} — ${strip(e.desc)}`),
    "",
    ...o.earningsDays.map((d) => `${strip(d.label)}: ${d.tickers.map((t) => t.symbol).join(", ")}`),
    "",
    ...(o.aheadNote ? [strip(o.aheadNote), ""] : []),
    ...(o.showAiStory && o.aiStoryQuotes.length ? [
      strip(o.aiStoryEyebrow).toUpperCase(),
      strip(o.aiStoryHeadline),
      "",
      ...o.aiStoryQuotes.flatMap((q) => [`  "${strip(q.quote)}"`, `    — ${q.name}, ${q.org}`, ""]),
      ...o.aiStoryBody.map(strip),
      ...(o.aiStoryCounter ? [strip(o.aiStoryCounter)] : []),
      "",
    ] : []),
    "OIL & THE WAR SITUATION",
    strip(o.oilHeadline),
    `${o.oilPrice} — ${o.oilChangeNote}`,
    ...o.oilBody.map(strip),
    "",
    "CB EDGE — THIS WEEK'S RESULTS",
    `Core: ${o.coreBullseyePct} (${strip(o.coreBullseyeSub)})`,
    `Estimated Move: ${o.estMovePct} (${strip(o.estMoveSub)})`,
    strip(o.resultsNote),
    "",
    strip(o.estMoveNote),
    "",
    ...(o.showWallChart && o.wallChartUrl ? [
      strip(o.wallChartLabel).toUpperCase(),
      strip(o.wallChartHeadline),
      ...(o.wallChartNote ? [strip(o.wallChartNote)] : []),
      o.wallChartUrl,
      "",
    ] : []),
    ...(o.showAutoBuy && o.autoBuyRows.length ? [
      strip(o.autoBuyLabel).toUpperCase(),
      o.autoBuyRows.every((r) => !!r.close)
        ? "  (realized = bought at the CB window, sold at the close. peak = intraday high, not an exit)"
        : "  (peak = intraday high after entry, not an exit)",
      ...o.autoBuyRows.map((r) =>
        r.close
          ? `  ${r.date} ${r.time.padEnd(5)} ${r.contract}  ${r.entry} -> ${r.close}  ${r.realizedPct} (${r.dollars}/ct)  · peak ${r.peak} ${r.peakPct} ${r.peakAt}`
          : `  ${r.date} ${r.time.padEnd(5)} ${r.contract}  ${r.entry} -> ${r.peak} ${r.peakPct} (${r.peakAt})`
      ),
      ...(o.autoBuyNote ? [strip(o.autoBuyNote)] : []),
      "",
    ] : []),
    ...(o.showScannerProof ? (() => {
      const q = o.scannerProof;
      return [
        "WHAT THE FLOW SCANNER CAUGHT",
        ...(q.resultFrom && q.resultTo
          ? [`${q.ticker} — ${q.resultFrom} -> ${q.resultTo} = ${q.resultPct} (high, not an exit)`]
          : []),
        `  #${q.rank} ${q.ticker}   ${q.headline}`,
        `  ${q.premium}`,
        `  ${q.expiry} · spot ${q.spot}`,
        `  captured ${q.captured}`,
        `  OTM ${q.otm} · ${q.vsOpen} vs open · score ${q.score}`,
        `  * ${q.strength}`,
        ...(o.scannerProofNote ? [strip(o.scannerProofNote)] : []),
        "",
      ];
    })() : []),
    ...(!o.showScannerProof && o.gexScannerRows.length ? [
      strip(o.gexScannerLabel).toUpperCase(),
      "  (peak = intraday high after the flag, not an exit)",
      ...o.gexScannerRows.map((r) =>
        `  [${r.grade}] ${r.symbol} ${r.contract} ${r.expiry} · flagged ${r.flagged} · ${r.entry} -> ${r.peak} (${r.peakAt})  ${r.gain}`
      ),
      ...(o.gexScannerNote ? [strip(o.gexScannerNote)] : []),
      "",
    ] : []),
    `${o.priceMonthly}/month or ${o.priceAnnual}/year — no code needed: ${o.ctaUrl}`,
    "",
    ...(o.showAffiliate ? [
      "NEW — AFFILIATE PROGRAM",
      strip(o.affiliateHeadline),
      ...o.affiliateBody.map(strip),
      `Apply for a code: ${o.affiliateUrl}`,
      "",
    ] : []),
    ...(o.showTradeify ? [
      "PARTNER · TRADEIFY",
      strip(o.tradeifyHeadline),
      strip(o.tradeifyBody),
      `${o.tradeifyUrl} (affiliate link — CB Edge earns a commission if you sign up)`,
      "",
    ] : []),
    "— The CB Edge Team",
    "",
    "cbedge.net · not financial advice",
    "",
    "—",
    `Unsubscribe: ${opts.email ? unsubscribeUrl(opts.email) : UNSUB_URL_PLACEHOLDER}`,
  ].join("\n");
}

/** Branded HTML weekly newsletter email. */
export function weeklyEdgeEmail(opts: WeeklyEdgeOpts = {}): string {
  const o = withDefaults(opts);
  const cta = escapeHtml(o.ctaUrl);
  const affiliateHref = escapeHtml(o.affiliateUrl);
  const affiliateBanner = escapeHtml(o.affiliateBannerUrl);
  const tradeifyHref = escapeHtml(o.tradeifyUrl);
  const wallChart = escapeHtml(o.wallChartUrl);
  // Every scanner field is interpolated into the card below, so escape once
  // here rather than at each of the dozen call sites.
  const sp = Object.fromEntries(
    Object.entries(o.scannerProof).map(([k, v]) => [k, escapeHtml(String(v))])
  ) as unknown as ScannerProof;
  const unsubHref = opts.email ? escapeHtml(unsubscribeUrl(opts.email)) : UNSUB_URL_PLACEHOLDER;

  const indexTile = (m: IndexMove) => {
    const down = m.pct.trim().startsWith("-");
    const color = down ? "#FF4757" : "#00E676";
    return `
              <td width="33%" style="padding:0 5px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                  <tr><td align="center" style="padding:12px 8px;">
                    <div style="font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6b7d8f;">${m.name}</div>
                    <div style="font:800 20px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${color};margin-top:6px;">${escapeHtml(m.pct)}</div>
                  </td></tr>
                </table>
              </td>`;
  };

  const eventRow = (e: CalendarEvent) => `
            <tr>
              <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);" valign="top">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="70" valign="top" style="font:800 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#219EBC;">${e.day}</td>
                  <td valign="top" style="font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;">${e.desc}</td>
                </tr></table>
              </td>
            </tr>`;

  const earningsTile = (t: EarningsTicker) => {
    const logo = t.logoUrl || `https://logos.stocktwits-cdn.com/${encodeURIComponent(t.symbol)}.png?w=64`;
    return `
              <td width="64" style="padding:0 5px 10px 5px;" align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td width="44" height="44" align="center" valign="middle" style="border-radius:9px;background:#ffffff;overflow:hidden;">
                    <img src="${logo}" width="44" height="44" alt="${escapeHtml(t.symbol)}" style="display:block;width:44px;height:44px;object-fit:cover;border:0;border-radius:9px;">
                  </td>
                </tr></table>
                <div style="font:800 9px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.04em;color:#9fb3c8;">${escapeHtml(t.symbol)}</div>
              </td>`;
  };

  const earningsDay = (d: EarningsDay) => `
            <div style="font:800 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;color:#6b7d8f;margin:14px 0 8px 0;">${d.label}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${d.tickers.map(earningsTile).join("")}
            </tr></table>`;

  const confCell = (val: string, hit: boolean) => `<span style="color:${hit ? "#219EBC" : "#FF4757"};font-weight:700;">${escapeHtml(val)} ${hit ? "✓" : "✗"}</span>`;

  const confHeaderRow = `
              <tr>
                <td rowspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:left;border-bottom:1px solid rgba(255,255,255,0.10);">Date</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">9:45 CB</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">10:30 CB</td>
                <td colspan="2" style="padding:8px 6px;font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">12:00 CB</td>
              </tr>
              <tr>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Strike</td>
                <td style="padding:5px 6px;font:700 8px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-transform:uppercase;color:#6b7d8f;text-align:center;border-bottom:1px solid rgba(255,255,255,0.10);">Closest</td>
              </tr>`;

  const confBodyRows = o.confRows.map((r, i) => `
              <tr>
                <td style="padding:7px 6px;font:700 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.date)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s945)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c945, r.hit945)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s1030)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c1030, r.hit1030)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${escapeHtml(r.s1200)}</td>
                <td style="padding:7px 6px;font:600 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center;${i < o.confRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : ""}">${confCell(r.c1200, r.hit1200)}</td>
              </tr>`).join("");

  const resultTile = (label: string, pct: string, sub: string, color: string, width: string = "33%") => `
              <td width="${width}" valign="top" style="padding:0 5px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                  <tr><td align="center" style="padding:14px 8px;">
                    <div style="font:700 9px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#6b7d8f;">${label}</div>
                    <div style="font:800 22px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${color};margin-top:8px;">${pct}</div>
                    <div style="font:500 10px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:4px;">${sub}</div>
                  </td></tr>
                </table>
              </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(WEEKLY_EDGE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:#05060A;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Core CPI ran hot, the 10-year is knocking on 5%, and crude is back over $100 — into a Fed decision and a quarterly expiration.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#05060A;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:#0D1119;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;">
          <tr><td style="height:4px;background:linear-gradient(90deg,rgba(56,189,248,0) 0%,#38BDF8 50%,rgba(56,189,248,0) 100%);font-size:0;line-height:0;">&nbsp;</td></tr>

          <!-- HEADER: logo top-left + issue tag top-right -->
          <tr>
            <td style="padding:26px 28px 4px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
                <td align="left" valign="middle">
                  <img src="${LOGO_URL}" alt="CB Edge" width="150" style="display:block;width:150px;max-width:60%;height:auto;border:0;">
                </td>
                <td align="right" valign="middle">
                  <span style="display:inline-block;font:700 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#9fb3c8;border:1px solid rgba(255,255,255,0.14);border-radius:20px;padding:6px 12px;">${escapeHtml(o.issueLabel)}</span>
                </td>
              </tr></table>
              <div style="font:900 24px/1.25 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:16px;">The Weekly Edge</div>
              <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:4px;">Last week's recap, this week's catalysts, and where CB Edge called it right.</div>
            </td>
          </tr>

          <!-- LAST WEEK RECAP -->
          <tr>
            <td style="padding:22px 28px 0 28px;border-top:1px solid rgba(255,255,255,0.08);margin-top:18px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#38BDF8;margin-top:18px;">● Last Week Recap</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.recapHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                ${o.indexMoves.map(indexTile).join("")}
              </tr></table>
              ${o.recapBody.map((p) => `<div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;">${p}</div>`).join("")}
            </td>
          </tr>

          <!-- THIS WEEK AHEAD -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#38BDF8;">● This Week Ahead</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.aheadHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">
                ${o.calendarEvents.map(eventRow).join("")}
              </table>
              ${o.earningsDays.map(earningsDay).join("")}
              ${o.aheadNote ? `<div style="font:400 13px/1.65 ${SANS};color:#d4dde6;margin-top:14px;">${o.aheadNote}</div>` : ""}
            </td>
          </tr>

          <!-- THE AI TRADE — pull-quote band. Three short quotations carry this
               better than a paragraph would: the whole point is that three
               rivals said the same thing, and seeing the names stacked makes
               that argument visually instead of asking the reader to parse it. -->
          ${o.showAiStory && o.aiStoryQuotes.length ? `
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 ${SANS};letter-spacing:0.14em;text-transform:uppercase;color:#38BDF8;">&#9679; ${escapeHtml(o.aiStoryEyebrow)}</div>
              <div style="font:800 17px/1.35 ${SANS};color:#ffffff;margin-top:8px;">${o.aiStoryHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;">
                ${o.aiStoryQuotes.map((q, i) => `
                <tr>
                  <td style="padding:${i ? "8px" : "0"} 0 0 0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                      <tr>
                        <td style="padding:13px 16px;">
                          <div style="font:600 14px/1.5 ${SANS};color:#ffffff;">&ldquo;${q.quote}&rdquo;</div>
                          <div style="font:700 10px/1 ${SANS};letter-spacing:0.08em;text-transform:uppercase;color:#9fb3c8;padding-top:9px;">${escapeHtml(q.name)} <span style="color:#6b7d8f;font-weight:400;">&middot; ${escapeHtml(q.org)}</span></div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`).join("")}
              </table>
              ${o.aiStoryBody.map((para) => `<div style="font:400 13px/1.65 ${SANS};color:#d4dde6;margin-top:12px;">${para}</div>`).join("")}
              ${o.aiStoryCounter ? `<div style="font:400 12px/1.6 ${SANS};color:#6b7d8f;margin-top:12px;">${o.aiStoryCounter}</div>` : ""}
            </td>
          </tr>` : ""}

          <!-- OIL & WAR -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#FB8501;">● Oil &amp; The War Situation</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.oilHeadline}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:16px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                    <td style="font:800 24px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FFB300;padding-right:10px;">${escapeHtml(o.oilPrice)}</td>
                    <td style="font:400 11px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;">${escapeHtml(o.oilChangeNote)}</td>
                  </tr></table>
                  ${o.oilBody.map((p) => `<div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:10px;">${p}</div>`).join("")}
                </td></tr>
              </table>
            </td>
          </tr>

          <!-- CB EDGE RESULTS -->
          <tr>
            <td style="padding:24px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#00E676;">● CB Edge — This Week's Results</div>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">The dashboard called it — here's the scorecard</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                ${resultTile("Core", o.coreBullseyePct, o.coreBullseyeSub, "#38BDF8", "50%")}
                ${resultTile("Estimated Move", o.estMovePct, o.estMoveSub, "#00E676", "50%")}
              </tr></table>

              ${o.confRows.length ? `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border:1px solid rgba(255,255,255,0.10);border-radius:10px;background:rgba(255,255,255,0.02);border-collapse:separate;">
                ${confHeaderRow}
                ${confBodyRows}
              </table>` : `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border:1px dashed rgba(255,255,255,0.18);border-radius:10px;">
                <tr><td align="center" style="padding:22px 16px;font:600 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">[ADD CB EDGE SCREENSHOT / CONFIDENCE TABLE HERE]</td></tr>
              </table>`}
              <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:14px;">${o.resultsNote}</div>
              <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:12px;">${o.estMoveNote}</div>

              <!-- Wall migration. The chart IS the argument for the section, so
                   it sits above the auto-buy table: here are the walls, then
                   here is what the wall bought inside them. -->
              ${o.showWallChart ? (o.wallChartUrl ? `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">${escapeHtml(o.wallChartLabel)}</div>
              <div style="font:800 15px/1.35 ${SANS};color:#ffffff;margin-bottom:10px;">${o.wallChartHeadline}</div>
              <img src="${wallChart}" alt="SPX core migration, five sessions to 2026-09-11 — put wall, call wall, CORE and spot" width="584" style="display:block;width:100%;max-width:584px;height:auto;border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
              ${o.wallChartNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.wallChartNote}</div>` : ""}` : `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">${escapeHtml(o.wallChartLabel)}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px dashed rgba(255,255,255,0.18);border-radius:10px;">
                <tr><td align="center" style="padding:34px 16px;font:600 12px/1.5 ${SANS};color:#6b7d8f;">[ADD WALL-MIGRATION CHART &mdash; save a dated PNG to public/ and set wallChartUrl]</td></tr>
              </table>`) : ""}

              <!-- Core Wall auto-buy. Gold box — the one thing on the page a
                   reader should stop on. The PEAK column is an intraday high,
                   never an exit; the note below the table says so. -->
              ${o.showAutoBuy ? (o.autoBuyRows.length ? `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">${escapeHtml(o.autoBuyLabel)}</div>
              ${(() => {
                // All-or-nothing: the Realized column appears only when EVERY
                // row has a close. A mixed table would invite the reader to
                // read a peak as a result on the rows that lack one.
                const realized = o.autoBuyRows.every((r) => !!r.close);
                const hdr = `padding:9px 8px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);`;
                const sub = `font-weight:400;letter-spacing:0.02em;text-transform:none;color:#6b7d8f;`;
                return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #FFB300;border-radius:12px;background:#080B11;border-collapse:separate;box-shadow:0 0 0 1px rgba(255,179,0,0.18);">
                <tr>
                  <td style="${hdr}padding-left:14px;">CB</td>
                  <td style="${hdr}">Contract</td>
                  <td align="right" style="${hdr}">In &rarr; ${realized ? "sold" : "peak"}<br><span style="${sub}">${realized ? "held to the close" : "intraday high, not an exit"}</span></td>
                  ${realized ? `<td align="right" style="${hdr}">Realized</td>` : ""}
                  <td align="right" style="${hdr}padding-right:14px;">${realized ? "Peak<br><span style=\"" + sub + "\">not an exit</span>" : "At peak"}</td>
                </tr>
                ${o.autoBuyRows.map((r, i) => {
                  const edge = i < o.autoBuyRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : "";
                  const cell = `padding:10px 8px;font:600 12px/1.4 ${SANS};white-space:nowrap;${edge}`;
                  return `
                <tr>
                  <td style="${cell}padding-left:14px;font-weight:700;color:#ffffff;">${escapeHtml(r.time)}<br><span style="font-weight:400;font-size:10px;color:#6b7d8f;">${escapeHtml(r.date)}</span></td>
                  <td style="${cell}font-weight:700;color:#8ECAE6;">${escapeHtml(r.contract)}</td>
                  <td align="right" style="${cell}color:#d4dde6;">${escapeHtml(r.entry)} <span style="color:#6b7d8f;">&rarr;</span> <span style="color:#ffffff;font-weight:700;">${escapeHtml(realized ? (r.close as string) : r.peak)}</span></td>
                  ${realized ? `<td align="right" style="${cell}font:800 13px/1.3 ${SANS};color:#00E676;">${escapeHtml(r.realizedPct as string)}<br><span style="font-weight:600;font-size:10px;color:#9fb3c8;">${escapeHtml(r.dollars as string)}/ct</span></td>` : ""}
                  <td align="right" style="${cell}padding-right:14px;${realized ? "color:#9fb3c8;" : "font:800 13px/1.3 " + SANS + ";color:#00E676;"}">${realized ? escapeHtml(r.peak) + `<br><span style="font-weight:400;font-size:10px;color:#6b7d8f;">${escapeHtml(r.peakPct)} &middot; ${escapeHtml(r.peakAt)}</span>` : escapeHtml(r.peakPct) + `<br><span style="font-weight:400;font-size:10px;color:#6b7d8f;">${escapeHtml(r.peakAt)}</span>`}</td>
                </tr>`;
                }).join("")}
              </table>`;
              })()}
              ${o.autoBuyNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.autoBuyNote}</div>` : ""}` : `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">Core Wall auto buy</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px dashed rgba(255,255,255,0.18);border-radius:10px;">
                <tr><td align="center" style="padding:22px 16px;font:600 12px/1.5 ${SANS};color:#6b7d8f;">[ADD AUTO-BUY ROWS &mdash; and set the eyebrow to "best N of M"]</td></tr>
              </table>`) : ""}

              ${o.showScannerProof ? `
              <!-- Flow-scanner example. The card is rebuilt in HTML, not
                   screenshotted, so it stays sharp and matches the palette. -->
              <div style="font:800 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">What the flow scanner caught</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #FFB300;border-radius:12px;background:#080B11;box-shadow:0 0 0 1px rgba(255,179,0,0.18);">
                <tr>
                  <td style="padding:16px 18px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font:800 14px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
                          <span style="color:#6b7d8f;font-weight:700;">${sp.rank}</span>&nbsp;&nbsp;${sp.ticker}
                        </td>
                        <td align="right" style="font:600 13px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">${sp.headline}</td>
                      </tr>
                    </table>
                    <div style="font:900 22px/1.2 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#219EBC;padding-top:8px;">${sp.premium}</div>
                    <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;padding-top:6px;">${sp.expiry} &middot; spot ${sp.spot}</div>
                    <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">captured ${sp.captured}</div>
                    <div style="font:600 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding-top:10px;">
                      <span style="color:#F2A65A;">OTM ${sp.otm}</span>
                      <span style="color:#8ECAE6;padding-left:10px;">${sp.vsOpen} vs open</span>
                      <span style="color:#6b7d8f;padding-left:10px;">score ${sp.score}</span>
                    </div>
                    <div style="font:800 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#F2A65A;padding-top:8px;">&#9733; ${sp.strength}</div>
                  </td>
                </tr>
                ${sp.resultFrom && sp.resultTo ? `
                <tr>
                  <td style="padding:0 18px 16px 18px;">
                    <div style="border-top:1px solid rgba(255,179,0,0.28);padding-top:12px;font:800 16px/1.3 ${SANS};color:#ffffff;">
                      ${sp.resultFrom} <span style="color:#6b7d8f;">&rarr;</span> ${sp.resultTo}
                      <span style="color:#00E676;">&nbsp;${sp.resultPct}</span>
                    </div>
                  </td>
                </tr>` : ""}
              </table>
              ${o.scannerProofNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.scannerProofNote}</div>` : ""}` : o.gexScannerRows.length ? `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">${escapeHtml(o.gexScannerLabel)}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:#080B11;border-collapse:separate;">
                <tr>
                  <td style="padding:9px 8px 9px 14px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,255,255,0.10);">Grade</td>
                  <td style="padding:9px 8px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,255,255,0.10);">Contract</td>
                  <td align="right" style="padding:9px 8px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,255,255,0.10);">Flagged</td>
                  <td align="right" style="padding:9px 8px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,255,255,0.10);">Entry &rarr; peak<br><span style="font-weight:400;letter-spacing:0.02em;text-transform:none;color:#6b7d8f;">intraday high, not an exit</span></td>
                  <td align="right" style="padding:9px 14px 9px 8px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,255,255,0.10);">At peak</td>
                </tr>
                ${o.gexScannerRows.map((r, i) => {
                  const edge = i < o.gexScannerRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : "";
                  // A+ gets the accent; anything else stays grey. The grade is
                  // the scanner's own conviction and shouldn't be flattened.
                  const top = r.grade.startsWith("A");
                  return `
                <tr>
                  <td style="padding:9px 8px 9px 14px;${edge}">
                    <span style="display:inline-block;padding:3px 7px;border-radius:6px;font:800 10px/1 ${SANS};color:${top ? "#8ECAE6" : "#9fb3c8"};background:${top ? "rgba(142,202,230,0.14)" : "rgba(255,255,255,0.05)"};border:1px solid ${top ? "rgba(142,202,230,0.35)" : "rgba(255,255,255,0.10)"};">${escapeHtml(r.grade)}</span>
                  </td>
                  <td style="padding:9px 8px;font:700 12px/1.4 ${SANS};color:#ffffff;white-space:nowrap;${edge}">${escapeHtml(r.symbol)} <span style="color:#F2A65A;">${escapeHtml(r.contract)}</span><br><span style="font-weight:400;font-size:10px;color:#6b7d8f;">${escapeHtml(r.expiry)}</span></td>
                  <td align="right" style="padding:9px 8px;font:600 12px/1.4 ${SANS};color:#9fb3c8;white-space:nowrap;${edge}">${escapeHtml(r.flagged)}</td>
                  <td align="right" style="padding:9px 8px;font:600 12px/1.4 ${SANS};color:#d4dde6;white-space:nowrap;${edge}">${escapeHtml(r.entry)} <span style="color:#6b7d8f;">&rarr;</span> <span style="color:#ffffff;font-weight:700;">${escapeHtml(r.peak)}</span><br><span style="font-weight:400;font-size:10px;color:#6b7d8f;">peak ${escapeHtml(r.peakAt)}</span></td>
                  <td align="right" style="padding:9px 14px 9px 8px;font:800 12px/1.4 ${SANS};color:#00E676;white-space:nowrap;${edge}">${escapeHtml(r.gain)}</td>
                </tr>`;
                }).join("")}
              </table>
              ${o.gexScannerNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.gexScannerNote}</div>` : ""}` : `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">What the flow scanner caught</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px dashed rgba(255,255,255,0.18);border-radius:10px;">
                <tr><td align="center" style="padding:22px 16px;font:600 12px/1.5 ${SANS};color:#6b7d8f;">[ADD THIS WEEK'S SCANNER CATCH]</td></tr>
              </table>`}
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:26px 28px 6px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(0,230,118,0.35);border-radius:16px;background:radial-gradient(circle at 50% 0%,rgba(0,230,118,0.14) 0%,transparent 70%),rgba(0,230,118,0.04);">
                <tr>
                  <td align="center" style="padding:26px 20px;">
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#00E676;">${escapeHtml(o.priceMonthly)}/month &middot; ${escapeHtml(o.priceAnnual)}/year</div>
                    <div style="font:900 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">Fed Wednesday, expiration Friday. <span style="color:#00E676;">Don't trade it blind.</span></div>
                    <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;max-width:460px;">Live GEX levels, Core confidence scoring, the Core Wall auto buy and estimated-move tracking. <strong style="color:#ffffff;">${escapeHtml(o.priceMonthly)} a month, or ${escapeHtml(o.priceAnnual)} a year.</strong> No code, no promo, nothing expiring at midnight.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
                      <td align="center" style="border-radius:12px;background:#00C853;">
                        <a href="${cta}" style="display:inline-block;padding:14px 34px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#04140A;text-decoration:none;border-radius:12px;">Get Access →</a>
                      </td>
                    </tr></table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- AFFILIATE PROGRAM — the "one more thing" band. Sits AFTER the
               pricing CTA on purpose so it never competes with it. -->
          ${o.showAffiliate ? `
          <tr>
            <td style="padding:22px 28px 0 28px;">
              <div style="font:800 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#FB8501;">● New — Affiliate Program</div>
              <a href="${affiliateHref}" style="display:block;text-decoration:none;margin-top:12px;">
                <img src="${affiliateBanner}" alt="CB Edge affiliate program now open — earn up to 20% recurring commission" width="584" style="display:block;width:100%;max-width:584px;height:auto;border:0;border-radius:12px;">
              </a>
              <div style="font:800 17px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:14px;">${o.affiliateHeadline}</div>
              ${o.affiliateBody.map((p) => `<div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:10px;">${p}</div>`).join("")}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr>
                <td align="center" style="border-radius:10px;border:1px solid rgba(251,133,1,0.45);background:rgba(251,133,1,0.10);">
                  <a href="${affiliateHref}" style="display:inline-block;padding:12px 26px;font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#FB8501;text-decoration:none;border-radius:10px;">Apply for a code →</a>
                </td>
              </tr></table>
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:10px;">${escapeHtml(o.affiliateUrl.replace(/^https?:\/\//, ""))}</div>
            </td>
          </tr>` : ""}

          <!-- TRADEIFY — partner line. Compact card, not a full band: it sits
               below the affiliate program and must not out-shout it. -->
          ${o.showTradeify ? `
          <tr>
            <td style="padding:22px 28px 0 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid rgba(255,255,255,0.10);border-radius:12px;background:rgba(255,255,255,0.02);">
                <tr><td style="padding:18px 18px;">
                  <div style="font:800 10px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#8ECAE6;">Partner · Tradeify</div>
                  <div style="font:800 15px/1.35 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:8px;">${o.tradeifyHeadline}</div>
                  <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:8px;">${o.tradeifyBody}</div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr>
                    <td align="center" style="border-radius:10px;border:1px solid rgba(142,202,230,0.45);background:rgba(142,202,230,0.10);">
                      <a href="${tradeifyHref}" style="display:inline-block;padding:11px 24px;font:800 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#8ECAE6;text-decoration:none;border-radius:10px;">Get funded with code ${escapeHtml(o.tradeifyCode)} →</a>
                    </td>
                  </tr></table>
                  <div style="font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:10px;">
                    <a href="${tradeifyHref}" style="color:#6b7d8f;text-decoration:underline;">${escapeHtml(o.tradeifyUrl.replace(/^https?:\/\//, ""))}</a>
                    &nbsp;·&nbsp;Affiliate link — CB Edge earns a commission if you sign up.
                  </div>
                </td></tr>
              </table>
            </td>
          </tr>` : ""}

          <tr>
            <td align="center" style="padding:18px 28px 30px 28px;">
              <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">— The CB Edge Team</div>
            </td>
          </tr>
        </table>

        <!-- footer -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;">
          <tr>
            <td align="center" style="padding:18px 32px;">
              <div style="font:400 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;">
                <a href="${unsubHref}" style="color:#8ECAE6;text-decoration:underline;font-size:14px;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#6b7d8f;text-decoration:underline;font-size:14px;">cbedge.net</a>
                <br>
                <span style="color:#5a6b7d;">Market analytics, not financial advice.</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
