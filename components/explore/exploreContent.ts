// Shared content for the public /explore/[slug] feature pages. Each entry maps a
// landing-card feature to a full marketing page (sell copy + static teaser).
// Keep slugs in sync with the landing page card links (LandingClient.tsx).
//
// ── 2026-09-05: ICT AND TPO REMOVED, THREE PAGES ADDED (Brandon) ─────────────
//
// `ict` and `tpo` are gone from this map, which is what deletes the pages: the
// route calls notFound() for a slug this object does not carry, and the "Your
// trial unlocks all of these" chip row is derived from EXPLORE_SLUGS, so there
// is nothing left pointing at either one.
//
// TPO in particular had to go: cbedge-v3/src/pages/scanner/scannerNav.ts dropped
// the TPO Structures tab on 2026-09-03 and tombstoned its modules, so this page
// was selling a screen the app no longer has. That is the one mistake a site
// whose entire argument is "we publish what is actually true" cannot make.
//
// The three replacing them are all things v3 ships today:
//   premarket            → cbedge-v3/src/pages/Premarket.tsx
//   top-change-scanner   → the scanner's `gexchangetop` tab
//   watch-scanner        → the scanner's `watch` tab (Watch This / Far CB)
//
// If you add another, the rules for the copy are the same as for everything
// else on the public site: describe what the screen actually computes, and put
// no number in `teaserStats` that is not obviously a shape rather than a claim.
// The graded claims live in ReceiptsStrip, where they come out of the DB.

export type TeaserStat = { label: string; value: string; tone?: "cyan" | "green" | "red" | "purple" };

/**
 * A REAL screen, transcribed as words and numbers.
 *
 * `teaserStats` is four scalars in a 2x2 — enough to say "there are numbers
 * here", not enough to say what the page IS. For the two scanner pages that
 * gap is the whole problem: nobody knows what a "GEX change scanner" puts on
 * screen, and four tiles do not tell them.
 *
 * So these entries carry the actual boards: every column header, in order, and
 * a handful of real rows off them. Deliberately a TABLE and not a screenshot —
 * a screenshot of a dashboard is unreadable on a phone, goes stale the day the
 * layout moves, is invisible to search, and cannot be read by a screen reader.
 * A table is all four of those things fixed, and it is honest in the one way
 * that matters: a reader can see the exact columns they will get.
 *
 * RULES for adding one:
 *   • Transcribe. Every column name must be the one actually rendered, in the
 *     order it is rendered. If a header changes on the page, change it here.
 *   • Rows are a real session, and they include the losers if the board has
 *     losers. `footnote` is where you say what the reader is NOT being shown —
 *     a page whose pitch is "we publish the misses" cannot quietly ship five
 *     A+ rows and leave it at that.
 *   • Numbers are strings. They are transcribed, never computed and never
 *     re-formatted; a value here is a quotation.
 */
export type ExploreExample = {
  /** Heading over the block. Name the screen, not the feature. */
  title: string;
  /** One line saying what the reader is looking at. */
  note?: string;
  /** The board's own header strip, as key/value pairs. */
  summary?: { k: string; v: string }[];
  /** Column headers, in the order the page renders them. */
  columns: string[];
  /** Rows, same order and arity as `columns`. */
  rows: string[][];
  /** 0-based column indexes rendered right-aligned in the mono face. */
  numeric?: number[];
  /** 0-based column indexes rendered as a status/grade chip. */
  pills?: number[];
  /** What this board is NOT showing. Required whenever the rows are a slice. */
  footnote?: string;
};

export type ExploreEntry = {
  slug: string;
  /** Short title used on the landing card + page header. */
  title: string;
  /** One-line tagline under the title. */
  tagline: string;
  /** Longer paragraph(s) explaining the feature. */
  body: string[];
  /** Bullet highlights. */
  highlights: string[];
  /** Frozen sample numbers shown as a "preview" block (clearly static). */
  teaserStats: TeaserStat[];
  /** Label for the preview block. */
  teaserLabel: string;
  /** Real boards from the page, transcribed. See ExploreExample. */
  examples?: ExploreExample[];
};

export const EXPLORE: Record<string, ExploreEntry> = {
  gex: {
    slug: "gex",
    title: "Real-time SPX GEX",
    tagline: "Live gamma exposure profiles and flip levels, straight from the chain.",
    body: [
      "Dealer gamma positioning drives intraday SPX behavior — where price gets pinned, where it accelerates, and where the regime flips from suppressive to explosive. Our GEX engine reads the live options chain and rebuilds the gamma profile continuously, so you see the picture move the moment positioning does.",
      "Net GEX, the gamma flip level, and call/put walls are computed off real chain data and overlaid on price. No lagging snapshots, no end-of-day exports.",
    ],
    highlights: [
      "Live net gamma exposure + gamma flip level",
      "Call wall / put wall key levels overlaid on price",
      "Positive vs negative gamma regime read",
      "Updates continuously through the session",
    ],
    teaserLabel: "Sample session snapshot",
    teaserStats: [
      { label: "Net GEX", value: "+$2.41B", tone: "green" },
      { label: "Gamma Flip", value: "5,985", tone: "cyan" },
      { label: "Call Wall", value: "6,050", tone: "green" },
      { label: "Put Wall", value: "5,900", tone: "red" },
    ],
  },
  "confidence-score": {
    slug: "confidence-score",
    title: "Confidence Score",
    tagline: "Every key level scored 0–100 for Hit, Pivot or Chop.",
    body: [
      "A level is only as useful as your conviction in it. The Confidence Score grades each key level from 0 to 100 and classifies the likely outcome — a clean Hit, a Pivot/reaction, or Chop — by blending live dealer positioning with historical analogs from 2+ years of sessions.",
      "Instead of staring at a wall of numbers, you get a single, honest read on which levels actually matter today.",
    ],
    highlights: [
      "0–100 score on each key level",
      "Hit / Pivot / Chop outcome classification",
      "Live positioning blended with historical analogs",
      "Per-level outcome timeline as the day plays out",
    ],
    teaserLabel: "Sample level scores",
    teaserStats: [
      { label: "5,985 (Flip)", value: "82 · Pivot", tone: "cyan" },
      { label: "6,050 (Call Wall)", value: "74 · Hit", tone: "green" },
      { label: "5,900 (Put Wall)", value: "61 · Chop", tone: "purple" },
      { label: "6,000 (Round)", value: "48 · Chop", tone: "red" },
    ],
  },
  flow: {
    slug: "flow",
    title: "Option Flow & Premium Flow",
    tagline: "Every meaningful print, sized and side-classified, with cumulative net premium drift.",
    body: [
      "Option flow tells you what size is actually doing — not what it's saying. Every print on the tape is bid/ask-classified into a buy or a sell, tagged call or put, and rolled into a directional read: buy calls and sell puts are bullish, buy puts and sell calls are bearish.",
      "The Net Drift chart plots cumulative net call premium against net put premium across the whole 9:30–4:00 session, so you can see the exact minute conviction shows up. Filter by premium floor, size, DTE, expiry and moneyness; flip to Combined to watch the whole market on one tape, or drill a single ticker on its own.",
    ],
    highlights: [
      "Bid/ask side classification — real buys vs sells, not just prints",
      "Cumulative Net Premium (Net Drift) across the full session",
      "Premium split: buy calls / buy puts / sell calls / sell puts",
      "Filters: premium floor, size, DTE, expiry, OTM-only",
      "Combined tape across every ticker, or a single-ticker drill-down",
    ],
    teaserLabel: "Sample session flow",
    teaserStats: [
      { label: "Net Call Premium", value: "+$41.2M", tone: "green" },
      { label: "Net Put Premium", value: "−$28.6M", tone: "red" },
      { label: "Net Drift", value: "+$12.6M", tone: "cyan" },
      { label: "Prints ≥ $50K", value: "1,847", tone: "purple" },
    ],
  },
  premarket: {
    slug: "premarket",
    title: "Premarket Prep",
    tagline: "What regime am I in, where are the walls, what happened overnight — answered before the bell.",
    body: [
      "Premarket Prep is the page you open at 8:00, not 9:31. It answers the three questions that decide how you trade the open: which gamma regime you are walking into, where the levels that matter sit, and what the overnight session already did to them. Everything on it is computed off the same live chain the GEX chart reads, so the board and your prep can never disagree.",
      "The walls come with their own history: each key level carries where it sat at the prior close, so a wall that migrated 40 points overnight says so instead of looking like it was always there. Alongside them are the gamma profile and its distribution curve, the expected-range track, max pain, the 0DTE magnet, DEX and vanna totals, and the overnight ES high, low and prior RTH close.",
      "It runs on every name in the picker — SPX plus the whole watchlist — with the same panels, computed from that ticker's own chain rather than a reduced board. When the bell rings you already know the map; and when the session is over, the Post-Market tab recaps what the day did with it.",
    ],
    highlights: [
      "Regime strip + level rail: the gamma read before the open",
      "Key level tiles with prior-close migration — walls that moved say so",
      "Gamma profile, distribution curve and expected-range track",
      "Max pain, the 0DTE magnet, DEX and vanna totals",
      "Overnight ES high / low and the prior RTH close",
      "Today's catalysts — economic calendar plus the earnings week",
      "Every ticker on the picker, not just SPX — and a Post-Market recap",
    ],
    teaserLabel: "Sample premarket board",
    teaserStats: [
      { label: "Regime", value: "Positive gamma", tone: "green" },
      { label: "Gamma Flip", value: "5,985", tone: "cyan" },
      { label: "Overnight range", value: "5,962–6,014", tone: "purple" },
      { label: "Expected range", value: "±38", tone: "cyan" },
    ],
  },
  "top-change-scanner": {
    slug: "top-change-scanner",
    title: "Top Change Scanner",
    tagline: "The biggest dealer-gamma changes on the board, ranked at the open and graded at the close.",
    body: [
      "A big gamma wall that has been sitting at a strike for a week is information everyone already has. A wall that appeared this morning is not. The Top Change scanner ranks the option board by how much gamma exposure actually MOVED — the strikes and contracts where dealer positioning changed most since the prior session — and puts the leaders on cards you can read in one pass.",
      "Every card is then tracked, not just published. Snapshots accrue through the cash session and each card can be flipped to its own intraday history, so you watch a change either build on itself or fade. The chart is filtered to regular trading hours on purpose: snapshots are recorded around the clock, but a chart that mixes an illiquid 3am print into the day's shape is a chart that lies about the day.",
      "At the close the scorecard freezes and each pick is graded. Until then it says so — \"live · peak so far\" — rather than presenting a mid-session number as a final one.",
    ],
    highlights: [
      "Ranked by CHANGE in dealer gamma, not by static size",
      "One card per leader, readable in a single pass",
      "Per-card intraday history — watch a change build or fade",
      "Cash-session only: overnight prints never distort the shape",
      "A scorecard that freezes at the close and grades every pick",
      "Says \"live · peak so far\" until it is final — no dressed-up mid-day number",
    ],
    teaserLabel: "Sample ranked board",
    teaserStats: [
      { label: "Picks graded", value: "35", tone: "cyan" },
      { label: "Avg peak", value: "+66%", tone: "green" },
      { label: "Closed green", value: "19 of 35", tone: "cyan" },
      { label: "Never green", value: "3 (9%)", tone: "red" },
    ],
    examples: [
      {
        title: "The scorecard — end of day, final",
        note: "Every pick the scanner flagged that session, graded A+ through F, in one table. This is the top of a real board.",
        summary: [
          { k: "Picks", v: "35" },
          { k: "Filter", v: "entry > $0.50 · |Δ| ≥ $500K · |% vs open| ≥ 50%" },
          { k: "Avg peak", v: "+66%" },
          { k: "≥ +25%", v: "17" },
          { k: "≥ +50%", v: "13" },
          { k: "≥ +100%", v: "9" },
          { k: "Closed green", v: "19" },
          { k: "Grades", v: "A+ 8 · A 5 · B 4 · C 6 · D 5 · F 7" },
          { k: "Avg score", v: "57 / 100" },
          { k: "Never green", v: "3 (9%)" },
        ],
        columns: ["Grade", "Symbol", "Contract", "Flagged", "Entry", "Peak", "Peak at", "Peak %", "$/ct", "Close", "Close %", "Low %"],
        numeric: [4, 5, 7, 8, 9, 10, 11],
        pills: [0],
        rows: [
          ["A+", "DELL", "530C 2026-09-04", "10:48 AM", "2.13", "10.75", "12:03 PM", "+406%", "+$863", "2.68", "+26%", "−8%"],
          ["A+", "AVGO", "370C 2026-09-11", "10:48 AM", "1.21", "4.22", "3:26 PM", "+249%", "+$301", "3.45", "+185%", "+0%"],
          ["A+", "SNDK", "1,595C 2026-09-04", "10:45 AM", "5.70", "18.10", "2:54 PM", "+218%", "+$1240", "10.20", "+79%", "−1%"],
          ["A+", "MU", "980C 2026-09-04", "10:44 AM", "1.66", "4.95", "11:03 AM", "+198%", "+$329", "4.70", "+183%", "+0%"],
          ["A+", "NBIS", "215C 2026-09-04", "10:50 AM", "1.03", "2.69", "3:30 PM", "+160%", "+$166", "2.15", "+108%", "+0%"],
        ],
        footnote:
          "These are the first five rows of thirty-five. The same table carries the C, D and F rows and the three that never went green — the header counts them out loud (avg 57/100, never green 3) precisely so a top-of-board screenshot cannot be mistaken for the whole board. Low % is the worst drawdown before the peak, which is the column that decides whether a +400% print was tradeable.",
      },
      {
        title: "One pick, opened",
        note: "Click any row and it opens its own card: the fill, the high, the time of both, and the intraday line between them.",
        columns: ["Field", "What the card shows"],
        rows: [
          ["Contract", "DELL 530C · expires 2026-09-04"],
          ["Flagged", "Sep 3 · 10:48 AM ET"],
          ["Grade", "A+"],
          ["Peak", "▲ 405.9%"],
          ["In", "2.13 at 10:48 AM"],
          ["High", "10.75 at 12:03 PM"],
          ["Per contract", "+$863"],
          ["Now", "2.68 · +26%"],
          ["Chart", "1D intraday line, 10:48 AM → 3:59 PM, range 1.24 → 11.45"],
          ["Chart toggle", "Price (mark) · or Net GEX for the same window"],
          ["Basis", "price (mark) · RTH only"],
        ],
        footnote:
          "The line is the contract's own mark through the cash session, so the entry, the peak and everything the position did in between are one picture rather than three numbers in a row.",
      },
    ],
  },
  "watch-scanner": {
    slug: "watch-scanner",
    title: "Watch Scanner",
    tagline: "Far out-of-the-money contracts quietly building size — flagged as they build, then scored.",
    body: [
      "Somebody paying up for a contract nowhere near the money is making a statement, and it usually shows up long before the move does. The Watch scanner sweeps the far chain on a rolling poll and flags the contracts where size is accumulating — the ones that are becoming a real position rather than a single lottery print.",
      "Flagged contracts go on a watch list you can open row by row: what was there when it was flagged, what it has done since, and where it sits now. Outcomes refresh on their own poll while the tab is in front of you and stop when it isn't, so a window you left open in another tab is not quietly hammering the scanner all afternoon.",
      "And it keeps its own receipts. Every flag is scored and grouped by day, so the list you are looking at today sits directly under the record of how the last ones turned out — including the ones that went nowhere.",
    ],
    highlights: [
      "Rolling sweep of the far chain — size building where it shouldn't be",
      "A watch list of flagged contracts, not a raw print firehose",
      "Row-level detail: what was flagged, and what it has done since",
      "Outcomes graded and grouped by day — the misses stay on the table",
      "Polls pause on a hidden tab; nothing runs when nobody is looking",
    ],
    teaserLabel: "Sample watch list",
    teaserStats: [
      { label: "Opened that day", value: "3", tone: "cyan" },
      { label: "Touched", value: "1", tone: "green" },
      { label: "Expired", value: "0", tone: "purple" },
      { label: "Typical OTM at flag", value: "15–19%", tone: "cyan" },
    ],
    examples: [
      {
        title: "Opened — flagged for the first time on this date",
        note: "A real day off the results-by-day view: 2026-09-02, three opened, one touched, none expired.",
        summary: [
          { k: "Date", v: "2026-09-02" },
          { k: "Opened", v: "3" },
          { k: "Touched", v: "1" },
          { k: "Expired", v: "0" },
        ],
        columns: ["Symbol", "Strike", "Expiry", "Flagged", "Flagged spot", "OTM at flag", "Closest", "Status"],
        numeric: [1, 4, 5, 6],
        pills: [7],
        rows: [
          ["RGTI", "$17", "2026-09-18", "2026-09-02", "$14.65", "16%", "9.1%", "OPEN"],
          ["OPEN", "$3.5", "2026-09-04", "2026-09-02", "$3.04", "15%", "7.1%", "OPEN"],
          ["CRCL", "$100", "2026-09-18", "2026-09-02", "$86.36", "16%", "0.0%", "TOUCHED 2026-09-03"],
        ],
        footnote:
          "OTM at flag is how far away the strike was the moment it was flagged — these are 15–16% out, which is the whole point. Closest is how near spot has come since; 0.0% means it got there. CRCL was flagged on the 2nd at 16% out and touched $100 the next day.",
      },
      {
        title: "Touched — spot reached the flagged strike on this date",
        note: "The same day, read the other way: what resolved today, including flags opened weeks earlier.",
        columns: ["Symbol", "Strike", "Expiry", "Flagged", "Flagged spot", "OTM at flag", "Closest", "Status"],
        numeric: [1, 4, 5, 6],
        pills: [7],
        rows: [
          ["FRMI", "$4.5", "2026-09-11", "2026-08-24", "$5.57", "19%", "0.0%", "TOUCHED 2026-09-02"],
        ],
        footnote:
          "Flagged 2026-08-24, nine days before it resolved. A flag stays on the board until it touches or its expiry passes — the ones that never get there stay in the count instead of being quietly dropped.",
      },
    ],
  },
  "estimated-moves": {
    slug: "estimated-moves",
    title: "Estimated moves",
    tagline: "Weekly estimated-move levels with high-confidence zones.",
    body: [
      "Know the range before the week starts. Estimated-move levels mark where price is statistically expected to travel, with high-confidence zones highlighted — backed by 2+ years of historical data and tracked results, so you can see how the model has actually performed.",
      "Plan entries, exits, and risk around levels that have a track record, not guesses.",
    ],
    highlights: [
      "Weekly estimated-move levels per ticker",
      "High-confidence zones highlighted",
      "Backed by 2+ years of historical data",
      "Tracked results so you can audit performance",
    ],
    teaserLabel: "Sample weekly levels",
    teaserStats: [
      { label: "EM High", value: "6,072", tone: "green" },
      { label: "EM Low", value: "5,908", tone: "red" },
      { label: "High-Conf Zone", value: "5,940–6,040", tone: "cyan" },
      { label: "Hit Rate (2yr)", value: "73%", tone: "purple" },
    ],
  },
  "initial-balance": {
    slug: "initial-balance",
    title: "Initial Balance & Stats",
    tagline: "The first hour sets the day — trade it with the base rates, not a hunch.",
    body: [
      "The Initial Balance — the first two 30-minute periods, 9:30 to 10:30 ET — frames the entire session. Where it breaks, whether the break holds, and how far price extends are not random: they repeat. We grade the IB on every ES and NQ session and keep the receipts, so you walk into the open knowing the actual odds instead of trading on feel.",
      "Each session is auto-scored: IB high/low/mid and width bucket, which side broke first and when, whether the break failed and retested, and how many IB multiples price ran (0.5×, 1.0×, 1.5×, 2.0×). The live RuleBoard reads the forming IB against 90+ trailing sessions and tells you what usually happens next from here.",
    ],
    highlights: [
      "IB high / low / mid + width bucket, graded live",
      "Break side & timing — single break, both sides, or contained",
      "Failure & retest detection with continuation odds",
      "Extension targets: 0.5× / 1.0× / 1.5× / 2.0× IB hit rates",
      "Open type, ORB direction & close-zone stats",
      "Every session recorded — ES & NQ, 90+ days deep",
    ],
    teaserLabel: "Sample session read",
    teaserStats: [
      { label: "IB Width", value: "Wide", tone: "purple" },
      { label: "First Break", value: "Upside 10:12", tone: "green" },
      { label: "Single-break rate", value: "58%", tone: "cyan" },
      { label: "1.0× ext hit", value: "41%", tone: "cyan" },
    ],
  },
};

export const EXPLORE_SLUGS = Object.keys(EXPLORE);
