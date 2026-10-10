"use client";

/**
 * MobileIcons — the bottom tab bar's glyph set.
 *
 * Stroked SVG rather than the emoji the desktop toolbar uses. Emoji render at
 * whatever weight and hue the platform font decides, so a row of six of them on
 * an iPhone reads as a jumble of colors next to a tinted active pill. These are
 * `currentColor`, so the bar tints them with the tab's accent and dims the
 * inactive ones with one opacity value.
 */

export type IconProps = { size?: number };

function Svg({ size = 22, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** GEX profile — a diverging bar histogram around a centre line. */
function BarsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="12" y1="3" x2="12" y2="21" opacity="0.45" />
      <line x1="12" y1="6" x2="18" y2="6" />
      <line x1="12" y1="10" x2="15.5" y2="10" />
      <line x1="12" y1="14" x2="7" y2="14" />
      <line x1="12" y1="18" x2="9.5" y2="18" />
    </Svg>
  );
}

/** Heatmap — a cell grid. */
function GridIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="3" y1="9.3" x2="21" y2="9.3" />
      <line x1="3" y1="14.6" x2="21" y2="14.6" />
      <line x1="10.5" y1="4" x2="10.5" y2="20" />
    </Svg>
  );
}

/** ES candles — two OHLC candles. */
function CandlesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="8" y1="3" x2="8" y2="21" />
      <rect x="5.5" y="7" width="5" height="8" rx="1.2" />
      <line x1="16" y1="5" x2="16" y2="19" />
      <rect x="13.5" y="10" width="5" height="6" rx="1.2" />
    </Svg>
  );
}

/** Option chain — interlocking links. */
function ChainIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 13.5a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 1 0 5.66 5.66l1.5-1.5" />
    </Svg>
  );
}

/** Estimated moves — an up/down range around a level. */
function MovesIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <line x1="4" y1="12" x2="20" y2="12" opacity="0.45" />
      <path d="M12 3.5v5" />
      <path d="M9.5 6 12 3.5 14.5 6" />
      <path d="M12 20.5v-5" />
      <path d="M9.5 18 12 20.5 14.5 18" />
    </Svg>
  );
}

/** Economic calendar. */
function CalendarIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <line x1="3.5" y1="9.6" x2="20.5" y2="9.6" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
      <circle cx="8.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** "Open the full desktop page" — an outward arrow. */
export function ExternalIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M19 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3.5" />
    </Svg>
  );
}

export function ChevronIcon({ size = 16, dir = "down" }: IconProps & { dir?: "down" | "right" }) {
  return (
    <Svg size={size}>
      {dir === "down" ? <path d="M5 9l7 7 7-7" /> : <path d="M9 5l7 7-7 7" />}
    </Svg>
  );
}

export function CloseIcon({ size = 18 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  );
}

export function SearchIcon({ size = 17 }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </Svg>
  );
}

export function RefreshIcon({ size = 16 }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M20 11a8 8 0 1 0-.7 4.5" />
      <path d="M20 5v6h-6" />
    </Svg>
  );
}

const MOBILE_ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  bars: BarsIcon,
  grid: GridIcon,
  candles: CandlesIcon,
  chain: ChainIcon,
  moves: MovesIcon,
  calendar: CalendarIcon,
};

export function TabIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Cmp = MOBILE_ICONS[name] ?? BarsIcon;
  return <Cmp size={size} />;
}
