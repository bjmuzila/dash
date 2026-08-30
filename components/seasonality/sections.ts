// ─────────────────────────────────────────────────────────────────────────────
// The rail: what sections exist, what they are called, and how they group.
//
// SINGLE SOURCE OF TRUTH for the section list. SeasonalityView builds the rail
// from it and SeasonalityAlmanac keys its section map off the same union, so a
// section cannot exist in the nav without a body or the other way round — that
// mismatch is a blank pane, and a blank pane looks like a broken page rather
// than a missing case.
//
// `hash` is what lands in the URL. Keep those stable once they are public:
// they are what people paste into a DM.
// ─────────────────────────────────────────────────────────────────────────────

export type SectionKey =
  | "season"
  | "month"
  | "six"
  | "decade"
  | "matrix"
  | "tdom"
  | "opex"
  | "eom"
  | "dow"
  | "vix"
  | "jh"
  | "earn"
  | "aapl"
  | "now"
  | "baro"
  | "cycles"
  | "vol";

export type Section = {
  key: SectionKey;
  /** Rail label. Short — the rail is 225px. */
  label: string;
  /** URL hash fragment. Stable once shipped. */
  hash: string;
};

export type SectionGroup = { label: string; items: Section[] };

export const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "The calendar year",
    items: [
      { key: "season", label: "Seasonal vs this year", hash: "seasonal" },
      { key: "month", label: "Month by month", hash: "months" },
      { key: "six", label: "The two half-years", hash: "half-years" },
      { key: "decade", label: "Shape by decade", hash: "decades" },
      { key: "matrix", label: "Every month, every year", hash: "matrix" },
    ],
  },
  {
    label: "Inside the month",
    items: [
      { key: "tdom", label: "Turn of the month", hash: "turn-of-month" },
      { key: "opex", label: "Opex week", hash: "opex" },
      { key: "eom", label: "Last day of the month", hash: "month-end" },
      { key: "dow", label: "Day of week", hash: "day-of-week" },
    ],
  },
  {
    label: "Event triggers",
    items: [
      { key: "vix", label: "After a VIX spike", hash: "vix-spike" },
      { key: "now", label: "Where the calendar stands", hash: "now" },
      { key: "baro", label: "Early-year barometers", hash: "barometers" },
    ],
  },
  {
    // Dated events, not calendar shapes. Everything above answers "what does
    // the market do at THIS TIME OF YEAR"; everything here answers "what does
    // it do around THIS EVENT". They are studies of the same kind — an anchor
    // date, a window before, a window after — so they share a group and a
    // vocabulary, and they are kept out of "Event triggers" because that group
    // is about market-generated conditions rather than scheduled dates.
    label: "Scheduled events",
    items: [
      { key: "jh", label: "Jackson Hole", hash: "jackson-hole" },
      { key: "earn", label: "Earnings reactions", hash: "earnings" },
      { key: "aapl", label: "Apple events", hash: "apple-events" },
    ],
  },
  {
    label: "Long cycles",
    items: [
      { key: "cycles", label: "Presidential & decennial", hash: "cycles" },
      { key: "vol", label: "Volatility by month", hash: "volatility" },
    ],
  },
];

export const SECTIONS: Section[] = SECTION_GROUPS.flatMap((g) => g.items);

/**
 * First paint always starts here — a CONSTANT, never the URL hash or
 * localStorage. Seeding client-only state is how the server renders one section
 * and the client another (React #418). The hash is applied in an effect, after
 * hydration.
 */
export const DEFAULT_SECTION: SectionKey = "season";

export const sectionForHash = (h: string): SectionKey | null =>
  SECTIONS.find((s) => s.hash === h.replace(/^#/, ""))?.key ?? null;

export const hashForSection = (k: SectionKey): string =>
  SECTIONS.find((s) => s.key === k)?.hash ?? "";
