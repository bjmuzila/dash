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
// CURRENT ISSUE: week of Aug 31 – Sep 4, 2026. Recap covers Aug 24–28 (NVIDIA
// blowout, hot July PCE, and Warsh's first Jackson Hole flipping September from
// a cut to a possible HIKE); the week ahead is ISM Mfg + JOLTS Tue, ADP + Beige
// Book + Broadcom Wed, ISM Services Thu, and the August jobs report Friday.
//
// DASHBOARD PLACEHOLDERS: `DEFAULT_CONF_ROWS` is empty, the two result tiles
// read "[fill before send]", and `showScannerProof` is FALSE — all three render
// as dashed placeholder blocks so nothing stale ships. Fill them from the owner
// Results / Scanner pages. The Core Wall auto-buy table below them IS real.
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
const WALL_CHART_URL = `${SITE_URL}/wall-migration-2026-08-28.png`;
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
  /** The realized move, stated as the contract's own premium. */
  resultFrom: string;
  resultTo: string;
  resultPct: string;
}

/**
 * One Core Wall auto-buy print: the contract the wall bought at a CB window,
 * what it cost, and its intraday high AFTER entry.
 *
 * `peak` IS NOT AN EXIT. It is the highest the contract traded after the buy —
 * you would have had to sell there to get it. The copy under the table says so,
 * and it stays there; a peak column presented as realized P&L is the single
 * easiest way to make this letter dishonest.
 */
export interface AutoBuyRow {
  date: string;
  /** CB window — "9:45", "10:30" or "12:00". */
  time: string;
  /** Contract as the dashboard renders it, e.g. "7750C". */
  contract: string;
  entry: string;
  peak: string;
  /** Time of that high, e.g. "11:01 AM". */
  peakAt: string;
  /** Pre-computed so the template does no arithmetic, e.g. "+441%". */
  gain: string;
}

export interface WeeklyEdgeOpts {
  issueLabel?: string;              // e.g. "Week of Jul 27"
  recapHeadline?: string;
  recapBody?: string[];             // paragraphs
  indexMoves?: IndexMove[];         // S&P/Nasdaq/Dow style tiles
  aheadHeadline?: string;
  calendarEvents?: CalendarEvent[];
  earningsDays?: EarningsDay[];
  aheadNote?: string;
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
  /** Scanner-proof card. Defaults FALSE — opt in once there's a catch to show. */
  showScannerProof?: boolean;
  scannerProof?: Partial<ScannerProof>;
  /** Set false to drop the wall-migration chart. */
  showWallChart?: boolean;
  wallChartUrl?: string;
  wallChartHeadline?: string;
  wallChartNote?: string;
  /** Set false to drop the Core Wall auto-buy table. */
  showAutoBuy?: boolean;
  autoBuyRows?: AutoBuyRow[];
  autoBuyNote?: string;
  ctaUrl?: string;
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
  { name: "S&amp;P 500", pct: "+0.5%" },
  { name: "Nasdaq", pct: "+0.9%" },
  { name: "Russell 2000", pct: "-1.5%" },
];

const DEFAULT_CALENDAR: CalendarEvent[] = [
  { day: "MON 8/31", desc: "Month-end. <strong>Chicago PMI</strong> and the <strong>Dallas Fed</strong> manufacturing survey, plus August auto sales. Light on catalysts — the tape spends it repricing Friday's Warsh speech." },
  { day: "TUE 9/1", desc: "<strong>ISM Manufacturing</strong> and <strong>JOLTS job openings</strong> at 10:00, with construction spending and the final August S&amp;P Global manufacturing PMI. JOLTS is the week's first labour read and it now matters more than it did a week ago. Dell and Palo Alto after the close." },
  { day: "WED 9/2", desc: "<strong>ADP private payrolls</strong> at 8:15, factory orders, and the <strong>Fed's Beige Book</strong>. Then <strong>Broadcom</strong> after the bell — the next real AI-capex read after NVIDIA, alongside Snowflake and HPE." },
  { day: "THU 9/3", desc: "<strong>ISM Services</strong>, <strong>jobless claims</strong>, the trade balance, productivity and unit labour costs, plus Challenger layoffs. The Cleveland and Chicago Fed presidents speak. Lululemon and DocuSign after the close." },
  { day: "FRI 9/4", desc: "<strong>The August jobs report</strong> at 8:30 — payrolls, unemployment rate and average hourly earnings. With September now a live hike-or-hold argument, this is the print the whole week is built around." },
];

const DEFAULT_EARNINGS: EarningsDay[] = [
  { label: "Mon 8/31", tickers: [{ symbol: "SAIC" }] },
  { label: "Tue 9/1", tickers: [{ symbol: "DELL" }, { symbol: "PANW" }, { symbol: "MDB" }, { symbol: "MDT" }, { symbol: "NIO" }, { symbol: "GTLB" }] },
  { label: "Wed 9/2 — Broadcom after the close", tickers: [{ symbol: "AVGO" }, { symbol: "SNOW" }, { symbol: "HPE" }, { symbol: "NTAP" }, { symbol: "OLLI" }] },
  { label: "Thu 9/3", tickers: [{ symbol: "LULU" }, { symbol: "DOCU" }, { symbol: "CIEN" }, { symbol: "CPB" }, { symbol: "ASAN" }] },
  { label: "Fri 9/4", tickers: [{ symbol: "ABM" }] },
];

/**
 * Core Wall auto-buy prints, week of Aug 24–28. These are the FIVE BEST of the
 * fifteen the wall took that week — 6 of the 15 peaked at 2x or better, 14 of 15
 * peaked above entry, and one (8/24 10:30, 7630P) never ticked up at all. The
 * note under the table states that split; do not print the winners without it.
 */
const DEFAULT_AUTO_BUY_ROWS: AutoBuyRow[] = [
  { date: "08-28", time: "10:30", contract: "7750C", entry: "$4.65", peak: "$25.15", peakAt: "11:01 AM", gain: "+441%" },
  { date: "08-26", time: "12:00", contract: "7685C", entry: "$1.83", peak: "$7.70", peakAt: "3:04 PM", gain: "+321%" },
  { date: "08-27", time: "10:30", contract: "7730C", entry: "$4.55", peak: "$14.20", peakAt: "1:10 PM", gain: "+212%" },
  { date: "08-27", time: "9:45", contract: "7725C", entry: "$6.95", peak: "$18.50", peakAt: "1:10 PM", gain: "+166%" },
  { date: "08-28", time: "12:00", contract: "7720P", entry: "$8.75", peak: "$23.00", peakAt: "1:10 PM", gain: "+163%" },
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
  { date: "08-28", s945: "7790", c945: "22.1", hit945: false, s1030: "7750", c1030: "2.5", hit1030: true, s1200: "7720", c1200: "0.3", hit1200: true },
  { date: "08-27", s945: "7725", c945: "0.1", hit945: true, s1030: "7730", c1030: "0.6", hit1030: true, s1200: "7730", c1200: "0.6", hit1200: true },
  { date: "08-26", s945: "7690", c945: "0.5", hit945: true, s1030: "7660", c1030: "0.0", hit1030: true, s1200: "7685", c1200: "0.4", hit1200: true },
  { date: "08-25", s945: "7700", c945: "13.7", hit945: false, s1030: "7650", c1030: "10.7", hit1030: false, s1200: "7680", c1200: "0.6", hit1200: true },
  { date: "08-24", s945: "7630", c945: "9.7", hit945: false, s1030: "7630", c1030: "15.2", hit1030: false, s1200: "7670", c1200: "1.4", hit1200: true },
];

/**
 * The week's scanner example. Flagged Aug 14 on the 2026-08-21 expiry, so the
 * whole run resolved inside the Aug 17–21 week this issue recaps. Same catch as
 * `edge3-annual.ts` → `DEFAULT_PROOF` — keep the two in sync if either changes.
 */
const DEFAULT_SCANNER_PROOF: ScannerProof = {
  rank: "2",
  ticker: "MRNA",
  premium: "0.6M",
  headline: "68",
  expiry: "2026-08-21",
  spot: "63.52",
  captured: "Aug 14 · 2:00 PM ET",
  otm: "7.1%",
  vsOpen: "+11142%",
  score: "44",
  strength: "Very strong",
  resultFrom: "$0.75",
  resultTo: "$95.00",
  resultPct: "+12,567%",
};

function withDefaults(opts: WeeklyEdgeOpts): Required<Pick<WeeklyEdgeOpts,
  "issueLabel" | "recapHeadline" | "recapBody" | "indexMoves" | "aheadHeadline" | "calendarEvents" |
  "earningsDays" | "aheadNote" | "oilHeadline" | "oilPrice" | "oilChangeNote" | "oilBody" |
  "coreBullseyePct" | "coreBullseyeSub" | "estMovePct" | "estMoveSub" |
  "confRows" | "resultsNote" | "estMoveNote" | "showScannerProof" |
  "showWallChart" | "wallChartUrl" | "wallChartHeadline" | "wallChartNote" |
  "showAutoBuy" | "autoBuyRows" | "autoBuyNote" | "ctaUrl" |
  "showAffiliate" | "affiliateHeadline" | "affiliateBody" | "affiliateUrl" | "affiliateBannerUrl" |
  "showTradeify" | "tradeifyHeadline" | "tradeifyBody" | "tradeifyUrl" | "tradeifyCode">>
  // scannerProof is Partial<> on the way in and complete on the way out, so it
  // is intersected rather than Pick'd — Required<Partial<X>> is still Partial<X>.
  & { scannerProof: ScannerProof } {
  return {
    issueLabel: opts.issueLabel || "Week of Aug 31 – Sep 4",
    recapHeadline: opts.recapHeadline || "NVIDIA carried the week. Then Warsh put a rate hike back on the table.",
    recapBody: opts.recapBody || [
      "Two events, and they pulled in opposite directions. NVIDIA reported Wednesday night with $96.2 billion in revenue — about $4 billion past consensus, $89.0 billion of it data centre — and then guided to roughly 70% revenue growth next fiscal year against the 44% the street had penciled in. The stock ran nearly 9% Thursday, its best day since April 2025. Salesforce added about 23% and CrowdStrike about 21% on their own prints. The Nasdaq closed the week +0.9%, the S&amp;P +0.5%.",
      "Friday took some of it back. In his first Jackson Hole keynote as Chair, Kevin Warsh said the Fed's predominant focus right now should be on prices — with July PCE running 3.7% and both headline and core unchanged from June, inflation has stopped improving rather than kept falling. Odds of a September <em>hike</em> jumped from 35% to 57%, short-end yields added about 8bp, and the Russell 2000 finished the week -1.5% while the mega-caps held their gains. Gold fell 3.3%, bitcoin 3.2% to about $78,000, and the VIX closed at 14.35 — a market pricing very little fear into a September meeting that just became a live argument.",
    ],
    indexMoves: opts.indexMoves || DEFAULT_INDEX_MOVES,
    aheadHeadline: opts.aheadHeadline || "Four labour prints in four days, and the August jobs report on Friday",
    calendarEvents: opts.calendarEvents || DEFAULT_CALENDAR,
    earningsDays: opts.earningsDays || DEFAULT_EARNINGS,
    aheadNote: opts.aheadNote || "Warsh changed what this week is about. Seven days ago the argument was how big the September cut would be; it is now whether the Fed hikes, and every labour print between here and Friday feeds it — JOLTS Tuesday, ADP Wednesday, claims and ISM Services Thursday, then the August employment report Friday morning. A hot number and the hike odds keep climbing into the meeting. Broadcom Wednesday night is the separate question: whether NVIDIA's guide was company-specific or the whole AI-capex cycle re-accelerating. Expect the 9:45 window to open into a gap on Wednesday and Friday in particular.",
    oilHeadline: opts.oilHeadline || "The war premium is draining out of crude",
    oilPrice: opts.oilPrice || "$83.44",
    oilChangeNote: opts.oilChangeNote || "WTI, Aug 28 · roughly flat on the week · −1.2% on the month · +30.4% YoY",
    oilBody: opts.oilBody || [
      "This is the first week in months that oil was not the story. Crude finished around $83.44 and barely moved, down about a percent on the month — because the market has quietly re-rated the Iran situation from an imminent threat to physical supply into an economic and sanctions confrontation. Goldman puts Persian Gulf exports back at 15–16 million barrels a day. That is still well under the 22–24 million before the conflict, but it is a long way from March's 5–6 million trough.",
      "Iran and Oman have agreed a revenue-sharing framework for the strait, though Tehran was careful to say that does not mean an immediate reopening, and the administration has shown no interest in reviving the June agreement that collapsed. Chevron and Halliburton caught a bid on reports of expanded Venezuelan production. The practical read for the open: crude is no longer the thing setting overnight gap risk. This week that job belongs to the labour data.",
    ],
    // 10 of 15 inside 5 points: 5/5 at 12:00, 3/5 at 10:30, 2/5 at 9:45. The
    // tile is the clean window; the other two are stated in the note rather
    // than blended into one friendlier average.
    coreBullseyePct: opts.coreBullseyePct || "100%",
    coreBullseyeSub: opts.coreBullseyeSub || "&le;5 pts &middot; 12:00 CB &middot; 5 of 5 sessions",
    // A "loss" here is a BREACH — price left the estimated-move band. Do not
    // write the note as "failed to reach"; that is the opposite of what happens.
    //
    // 82.4% (192-41 of 233 scored) after 41.0% the week before, on a VIX that
    // stayed low both weeks — so low vol alone does not explain either number.
    // What changed is the RANGE: last week the tape kept travelling through
    // narrowed bands, this week it sat between the walls. Note ties it to the
    // wall-migration chart directly BELOW it, which is the same story in a
    // picture — if that section ever moves, fix "the chart below" in the copy.
    // Core Board is 17-3 / 85.0% on 20 of 22 tickers; it rides in the note
    // rather than a third tile, so the tile row stays a clean two-up.
    estMovePct: opts.estMovePct || "82.4%",
    estMoveSub: opts.estMoveSub || "192-41 &middot; 233 of 404 tickers scored",
    confRows: opts.confRows || DEFAULT_CONF_ROWS,
    resultsNote: opts.resultsNote ||
      "A ✓ means the Core read landed within 5 points of where SPX actually printed. Across Aug 24–28 that was 10 of 15 — <strong style=\"color:#ffffff;\">5 of 5 at 12:00</strong>, 3 of 5 at 10:30, and 2 of 5 at 9:45. Widen the tolerance to 15 points and it is 13 of 15: only Friday's 9:45 read (22.1) and Monday's 10:30 (15.2) missed by more than that. The 12:00 read has now gone 10 for 10 inside 5 points across the last two weeks; the 9:45 open is the weak window and has been for a fortnight.",
    estMoveNote: opts.estMoveNote ||
      "Estimated Move turned it around: <strong style=\"color:#ffffff;\">192 wins against 41 losses</strong> on 233 scored names, 82.4% — and <strong style=\"color:#ffffff;\">17-3, 85.0%</strong>, on the 20 scored names of the Core Board. The week before that number was 41.0%, and it went in this letter the same way this one does. The reason for the swing is the chart below. A win is price staying inside the band; with SPX living between the call and put walls all week, the bands mostly held. The week before, the vol crush had narrowed those bands while the tape kept covering the same distance, so price walked out of them early. Same model — the range behaved differently.",
    // OFF for this issue — no scanner catch supplied yet, so the section renders
    // a dashed placeholder instead of last week's MRNA card. Flip to true (or
    // just delete the `showScannerProof: false` at the call site) once there is
    // one, and override `scannerProof` with the new numbers.
    showScannerProof: opts.showScannerProof === true,
    scannerProof: { ...DEFAULT_SCANNER_PROOF, ...(opts.scannerProof || {}) },
    showWallChart: opts.showWallChart !== false,
    wallChartUrl: opts.wallChartUrl || WALL_CHART_URL,
    wallChartHeadline: opts.wallChartHeadline || "Five sessions, and price never left the walls",
    // Empty by design — the chart carries its own legend and axis labels, so a
    // paragraph under it only repeats what the reader can already see. Pass a
    // string to bring the caption back for an issue that needs one.
    wallChartNote: opts.wallChartNote ?? "",
    showAutoBuy: opts.showAutoBuy !== false,
    autoBuyRows: opts.autoBuyRows || DEFAULT_AUTO_BUY_ROWS,
    // Empty by design — no paragraph under the table. The two things that
    // paragraph used to carry are NOT optional, so they moved into the furniture
    // instead of disappearing: "5 of 15" is in the eyebrow, and "peak = intraday
    // high after entry, not an exit" is the PEAK column's own subhead. Pass a
    // string here to bring a caption back.
    autoBuyNote: opts.autoBuyNote ?? "",
    ctaUrl: opts.ctaUrl || PRICING_URL,
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

export const WEEKLY_EDGE_SUBJECT = "The Weekly Edge — Warsh put a September hike back on the table, and jobs Friday decides it";

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
    strip(o.aheadNote),
    "",
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
    ...(o.showWallChart ? [
      "WALL MIGRATION — AUG 24–28",
      strip(o.wallChartHeadline),
      ...(o.wallChartNote ? [strip(o.wallChartNote)] : []),
      o.wallChartUrl,
      "",
    ] : []),
    ...(o.showAutoBuy && o.autoBuyRows.length ? [
      "CORE WALL AUTO BUY — BEST 5 OF 15 LAST WEEK",
      "  (peak = intraday high after entry, not an exit)",
      ...o.autoBuyRows.map((r) =>
        `  ${r.date} ${r.time.padEnd(5)} ${r.contract.padEnd(6)} ${r.entry} -> ${r.peak}  ${r.gain}`
      ),
      ...(o.autoBuyNote ? [strip(o.autoBuyNote)] : []),
      "",
    ] : []),
    ...(o.showScannerProof ? (() => {
      const p = o.scannerProof;
      return [
        "WHAT THE FLOW SCANNER CAUGHT",
        `${p.ticker} — ${p.resultFrom} -> ${p.resultTo} = ${p.resultPct}`,
        `  #${p.rank} ${p.ticker}   ${p.headline}`,
        `  ${p.premium}`,
        `  ${p.expiry} · spot ${p.spot}`,
        `  captured ${p.captured}`,
        `  OTM ${p.otm} · ${p.vsOpen} vs open · score ${p.score}`,
        `  * ${p.strength}`,
        "Off the scanner in real time, not a backtest. One contract is not a track",
        "record, and options can and do go to zero.",
        "",
      ];
    })() : []),
    `Annual access is $400/yr instead of $1,000 with code EDGE3: ${o.ctaUrl}`,
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
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">NVIDIA blew the doors off and Warsh took the September cut away — now four labour prints and Friday's jobs report decide it.</div>
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
              <div style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#d4dde6;margin-top:14px;">${o.aheadNote}</div>
            </td>
          </tr>

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
              ${o.showWallChart ? `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">Wall migration &mdash; Aug 24&ndash;28</div>
              <div style="font:800 15px/1.35 ${SANS};color:#ffffff;margin-bottom:10px;">${o.wallChartHeadline}</div>
              <img src="${wallChart}" alt="SPX wall migration, five sessions to 2026-08-28 — call wall, put wall and spot" width="584" style="display:block;width:100%;max-width:584px;height:auto;border:1px solid rgba(255,255,255,0.10);border-radius:10px;">
              ${o.wallChartNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.wallChartNote}</div>` : ""}` : ""}

              <!-- Core Wall auto-buy. Gold box — the one thing on the page a
                   reader should stop on. The PEAK column is an intraday high,
                   never an exit; the note below the table says so. -->
              ${o.showAutoBuy && o.autoBuyRows.length ? `
              <div style="font:800 10px/1 ${SANS};letter-spacing:0.12em;text-transform:uppercase;color:#6b7d8f;margin:20px 0 10px 0;">Core Wall auto buy — best 5 of 15 last week</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #FFB300;border-radius:12px;background:#080B11;border-collapse:separate;box-shadow:0 0 0 1px rgba(255,179,0,0.18);">
                <tr>
                  <td style="padding:9px 10px 9px 14px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);">Date</td>
                  <td style="padding:9px 10px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);">CB</td>
                  <td style="padding:9px 10px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);">Contract</td>
                  <td align="right" style="padding:9px 10px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);">Entry &rarr; peak<br><span style="font-weight:400;letter-spacing:0.02em;text-transform:none;color:#6b7d8f;">intraday high, not an exit</span></td>
                  <td align="right" style="padding:9px 14px 9px 10px;font:700 9px/1 ${SANS};letter-spacing:0.06em;text-transform:uppercase;color:#9fb3c8;border-bottom:1px solid rgba(255,179,0,0.28);">At peak</td>
                </tr>
                ${o.autoBuyRows.map((r, i) => {
                  const edge = i < o.autoBuyRows.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.06);" : "";
                  return `
                <tr>
                  <td style="padding:9px 10px 9px 14px;font:700 12px/1.4 ${SANS};color:#ffffff;white-space:nowrap;${edge}">${escapeHtml(r.date)}</td>
                  <td style="padding:9px 10px;font:600 12px/1.4 ${SANS};color:#9fb3c8;white-space:nowrap;${edge}">${escapeHtml(r.time)}</td>
                  <td style="padding:9px 10px;font:700 12px/1.4 ${SANS};color:#8ECAE6;white-space:nowrap;${edge}">${escapeHtml(r.contract)}</td>
                  <td align="right" style="padding:9px 10px;font:600 12px/1.4 ${SANS};color:#d4dde6;white-space:nowrap;${edge}">${escapeHtml(r.entry)} <span style="color:#6b7d8f;">&rarr;</span> <span style="color:#ffffff;font-weight:700;">${escapeHtml(r.peak)}</span></td>
                  <td align="right" style="padding:9px 14px 9px 10px;font:800 12px/1.4 ${SANS};color:#00E676;white-space:nowrap;${edge}">${escapeHtml(r.gain)}</td>
                </tr>`;
                }).join("")}
              </table>
              ${o.autoBuyNote ? `<div style="font:400 12px/1.7 ${SANS};color:#6b7d8f;margin-top:10px;">${o.autoBuyNote}</div>` : ""}` : ""}

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
                <tr>
                  <td style="padding:0 18px 16px 18px;">
                    <div style="border-top:1px solid rgba(255,179,0,0.28);padding-top:12px;font:800 16px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
                      ${sp.resultFrom} <span style="color:#6b7d8f;">&rarr;</span> ${sp.resultTo}
                      <span style="color:#00E676;">&nbsp;${sp.resultPct}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <div style="font:400 12px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b7d8f;margin-top:10px;">
                Flagged on the ${sp.expiry} expiry with ${sp.ticker} at ${sp.spot} — off the scanner in real time, not a backtest. One contract is not a track record, and options can and do go to zero.
              </div>` : `
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
                    <div style="font:700 11px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:0.16em;text-transform:uppercase;color:#00E676;">Code EDGE3 · $400/yr instead of $1,000</div>
                    <div style="font:900 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;margin-top:10px;">Jobs Friday, with a hike on the table. <span style="color:#00E676;">Don't trade it blind.</span></div>
                    <div style="font:400 13px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#9fb3c8;margin-top:8px;max-width:460px;">Live GEX levels, Core confidence scoring, the Core Wall auto buy and estimated-move tracking — full annual access for $400 with code <strong style="color:#ffffff;">EDGE3</strong>, instead of $1,000.</div>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;"><tr>
                      <td align="center" style="border-radius:12px;background:#00C853;">
                        <a href="${cta}" style="display:inline-block;padding:14px 34px;font:800 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#04140A;text-decoration:none;border-radius:12px;">Get Annual Access →</a>
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
