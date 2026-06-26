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
  greeks: {
    slug: "greeks",
    title: "Greeks & exposure",
    tagline: "DEX, VEX and charm intraday — dealer positioning in one view.",
    body: [
      "Gamma is only part of the story. Delta exposure (DEX), vanna/vega exposure (VEX), and charm tell you how dealer hedging will shift as price, volatility, and time move. We compute them intraday and put the full dealer-positioning picture in a single view.",
      "See where hedging flows will likely add fuel or apply brakes — before the move, not after.",
    ],
    highlights: [
      "Intraday DEX, VEX and charm",
      "Full dealer-positioning picture in one screen",
      "Spot how hedging flows shift with price & vol",
      "Built on the same live chain as GEX",
    ],
    teaserLabel: "Sample exposure read",
    teaserStats: [
      { label: "Net DEX", value: "-$1.18B", tone: "red" },
      { label: "Net VEX", value: "+$340M", tone: "green" },
      { label: "Charm (to close)", value: "+$92M", tone: "cyan" },
      { label: "Regime", value: "Short gamma", tone: "purple" },
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
};

export const EXPLORE_SLUGS = Object.keys(EXPLORE);
