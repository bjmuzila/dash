// Shared content for the public /explore/[slug] feature pages. Each entry maps a
// landing-card feature to a full marketing page (sell copy + static teaser).
// Keep slugs in sync with the landing page card links (LandingClient.tsx).

export type TeaserStat = { label: string; value: string; tone?: "cyan" | "green" | "red" | "purple" };

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
  ict: {
    slug: "ict",
    title: "ICT — Inner Circle Trader",
    tagline: "Live ICT detection on ES & NQ — FVGs, order blocks, liquidity and structure, called as they form.",
    body: [
      "Every Inner Circle Trader concept, detected live on the same 5-minute ES and NQ session feed the desk runs on. Fair Value Gaps, order blocks, buy/sell-side liquidity pools, market-structure shifts (BOS / CHOCH / MSS), the premium/discount dealing range and the OTE band are computed continuously and drawn straight on the chart — no manual mark-ups.",
      "Kill zones, the Silver Bullet window and ICT macros are time-boxed on the chart, a daily-bias read tells you the draw on liquidity, and a live signal panel surfaces inducement, turtle soup, Judas swings, breakers, CISD and the 2022 model as they trigger. A full glossary of every concept sits below — hover any level on the live page for the same definition in context.",
    ],
    highlights: [
      "Live FVG / IFVG, order blocks & breaker blocks",
      "Buy/sell-side liquidity, equal highs/lows & sweeps",
      "Structure shifts: BOS, CHOCH & MSS with displacement",
      "Kill zones, Silver Bullet, macros & Power of 3",
      "Premium/discount range, equilibrium & OTE band",
      "Daily bias + draw-on-liquidity, ES & NQ",
    ],
    teaserLabel: "Sample live read",
    teaserStats: [
      { label: "Daily Bias", value: "Bullish", tone: "green" },
      { label: "Active Window", value: "Silver Bullet", tone: "cyan" },
      { label: "Structure", value: "MSS ↑", tone: "purple" },
      { label: "Liquidity", value: "SSL swept", tone: "red" },
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
  tpo: {
    slug: "tpo",
    title: "TPO & Market Structure",
    tagline: "Market Profile, built live — plus a full-day profile forecast from the open.",
    body: [
      "Market Profile shows you where the market actually spent its time, not just where it closed. Point of Control, the value area (VAH/VAL) and single prints are built continuously from the live ES session, so you watch acceptance, rejection and unfinished business form in real time — the structure the desk trades around.",
      "The edge is the forecast. Once the Initial Balance completes, a k-NN model matches today's shape against years of recorded sessions and projects the full-day profile — predicted POC and value area versus what's realized so far, with a confidence read on how tight the analog set is. You get the day's map at 10:30, not at the close.",
    ],
    highlights: [
      "Live POC, VAH / VAL & value area as the session prints",
      "Single prints & poor highs/lows — unfinished business flagged",
      "Full-day profile forecast from the Initial Balance (k-NN)",
      "Predicted vs realized POC & value area on one axis",
      "Model confidence from analog tightness",
      "Balance / imbalance structure read on ES",
    ],
    teaserLabel: "Sample forecast",
    teaserStats: [
      { label: "POC", value: "5,972", tone: "cyan" },
      { label: "Value Area", value: "5,948–5,996", tone: "green" },
      { label: "Predicted POC", value: "5,978", tone: "purple" },
      { label: "Forecast conf.", value: "71%", tone: "green" },
    ],
  },
};

export const EXPLORE_SLUGS = Object.keys(EXPLORE);
