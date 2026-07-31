"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import DashGrid, { type GridItem } from "@/components/shared/DashGrid";
import FitBox from "@/components/shared/FitBox";
import LayoutBar from "@/components/shared/LayoutBar";
import { useDashboardLayout } from "@/components/shared/useDashboardLayout";
import SpxHeatmap from "@/components/spx/SpxHeatmap";
import SectorSunburst from "@/components/dashboard/SectorSunburst";
import { TickerProvider, useTicker } from "./tickerContext";
import TickerSelect from "./TickerSelect";
import OptionsPlaceholder from "./OptionsPlaceholder";

/**
 * Options dashboard.
 *
 * The cards live in a draggable/resizable 12-column grid (DashGrid). "Edit
 * layout" in the bar unlocks drag handles + resize grips; the arrangement is
 * saved to Postgres per user as a named template (dashboard_layouts) through
 * useDashboardLayout, and the default template auto-loads on open.
 *
 * Two rules the grid enforces for us:
 *   - Cards never overlap. DashGrid pushes whatever a dragged card lands on
 *     straight down and then floats the board up to close the gap.
 *   - Card CONTENT tracks the card. Bodies are flex-filled; the two widgets
 *     with an intrinsic size (the heatmap's fixed-cell grid, the sector wheel)
 *     go through FitBox, which scales them to whatever tile they're given.
 *
 * Default arrangement (what a user sees before they've saved anything):
 *
 *   ┌──────────────────────────┬───────────────────────────┐
 *   │ ticker selector          │                           │
 *   │ daily / yearly heatmap   │  S&P 500 sunburst         │
 *   ├──────────────────────────┼───────────────────────────┤
 *   │ candlestick (ES-based)   │  orderflow graph          │
 *   │                          │  live orderflow feed      │
 *   └──────────────────────────┴───────────────────────────┘
 *
 * Every card reads the selected symbol from TickerProvider, so the dropdown
 * drives the whole page. The heatmap and the sector wheel are live; the
 * candlestick and the two orderflow panels are still placeholders — no
 * fetches, sockets, or chart libs behind those yet.
 */

/** Grid geometry. Row pitch is ROW_H + GUTTER, so h:9 ≈ 380px tall. */
const COLS = 12;
const ROW_H = 28;
const GUTTER = 16;
/** Below this the absolute grid gets too cramped — cards stack full width. */
const STACK_BELOW_PX = 900;

/**
 * Built-in arrangement. This is also the reconciliation key: a saved template
 * keeps geometry for ids listed here, unknown ids are dropped, and any id added
 * here later is appended below a user's saved cards rather than lost.
 */
const DEFAULT_LAYOUT: GridItem[] = [
  { id: "ticker",    x: 0, y: 0,  w: 7, h: 3 },
  { id: "heatmap",   x: 0, y: 3,  w: 7, h: 9 },
  { id: "candles",   x: 0, y: 12, w: 7, h: 9 },
  { id: "sunburst",  x: 7, y: 0,  w: 5, h: 10 },
  { id: "orderflow", x: 7, y: 10, w: 5, h: 5 },
  { id: "feed",      x: 7, y: 15, w: 5, h: 6 },
];

export default function OptionsPage() {
  const L = useDashboardLayout("options", DEFAULT_LAYOUT);
  const narrow = useIsNarrow(STACK_BELOW_PX);
  const editing = L.editing && !narrow;

  // On phones / narrow windows the 12-col grid isn't usable, so ignore the
  // saved x/w and stack every card full width in its saved reading order.
  // Nothing is written back — the desktop arrangement stays exactly as saved.
  const layout = narrow ? stackLayout(L.layout) : L.layout;

  return (
    <TickerProvider>
      <PageShell className={editing ? "no-card-lift" : undefined}>
        {!narrow && <LayoutBar {...L.bar} />}

        <DashGrid
          layout={layout}
          onLayoutChange={L.setLayout}
          locked={!editing}
          cols={COLS}
          rowH={ROW_H}
          gutter={GUTTER}
          minW={3}
          minH={3}
        >
          {/* Overflow stays visible here so the ticker dropdown isn't clipped
              by the card's box — DashGrid also raises this tile's z-index. */}
          <GridCard key="ticker" id="ticker" editing={editing} padding={16} overflow="visible">
            <div style={{ display: "flex", alignItems: "center", height: "100%", minHeight: 0 }}>
              <TickerSelect maxWidth="100%" />
            </div>
          </GridCard>

          <GridCard key="heatmap" id="heatmap" editing={editing} title={<TickerTitle label="Heatmap" />}>
            <HeatmapBody />
          </GridCard>

          <GridCard
            key="candles"
            id="candles"
            editing={editing}
            title={<TickerTitle label="Candlestick" />}
            subtitle="ES-based chart"
          >
            <OptionsPlaceholder
              label="candles"
              shape="candles"
              note="placeholder — chart component goes here"
            />
          </GridCard>

          {/* SectorSunburst brings its own header, expand/full-screen and
              snapshot button and self-fetches /api/spx-sunburst, so it drops
              into a bare card. It shows the whole index rather than the
              selected symbol, hence no ticker in the heading. */}
          <GridCard key="sunburst" id="sunburst" editing={editing}>
            <SunburstBody />
          </GridCard>

          <GridCard
            key="orderflow"
            id="orderflow"
            editing={editing}
            title={<TickerTitle label="Orderflow Graph" />}
            subtitle="cumulative delta"
          >
            <OptionsPlaceholder label="orderflow" shape="bars" />
          </GridCard>

          <GridCard
            key="feed"
            id="feed"
            editing={editing}
            title={<TickerTitle label="Live Orderflow Feed" />}
            subtitle="idle — no stream connected"
          >
            <OrderflowFeedBody />
          </GridCard>
        </DashGrid>
      </PageShell>
    </TickerProvider>
  );
}

/* ── grid plumbing ───────────────────────────────────────────────────────── */

/** Single-column fallback: preserve reading order, full width, saved heights. */
function stackLayout(layout: GridItem[]): GridItem[] {
  let y = 0;
  return [...layout]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((it) => {
      const next = { ...it, x: 0, y, w: COLS };
      y += it.h;
      return next;
    });
}

function useIsNarrow(px: number) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [px]);
  return narrow;
}

/**
 * A card sized to its grid cell.
 *
 * `data-grid-id` is how DashGrid matches a child to its layout entry. The
 * header doubles as the drag handle while editing (`data-dashgrid-handle`) —
 * drag is deliberately limited to it so dropdowns, buttons and charts inside a
 * card keep working normally.
 */
function GridCard({
  id,
  title,
  subtitle,
  editing,
  padding = 20,
  overflow,
  children,
}: {
  id: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  editing: boolean;
  padding?: number;
  overflow?: "visible";
  children: ReactNode;
}) {
  const visible = overflow === "visible";
  const showHeader = title != null || editing;
  return (
    <div data-grid-id={id} data-grid-overflow={overflow} style={{ width: "100%", height: "100%" }}>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        padding={padding}
        style={{
          height: "100%",
          // Explicit: the grid sizes this box to the tile, and padding must come
          // out of that height rather than being added to it.
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: visible ? "visible" : "hidden",
        }}
      >
        {showHeader && (
          <div
            data-dashgrid-handle={editing ? "" : undefined}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: title != null || subtitle != null ? 14 : 8,
              flexShrink: 0,
              cursor: editing ? "grab" : undefined,
              userSelect: editing ? "none" : undefined,
            }}
          >
            {editing && (
              <span
                aria-hidden
                title="Drag to move"
                style={{ fontSize: 12, lineHeight: 1, letterSpacing: 1, color: HOME_THEME.cyan, opacity: 0.8 }}
              >
                ⠿
              </span>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              {title != null && (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: HOME_THEME.text,
                    // A narrow tile truncates the heading instead of wrapping it
                    // onto a second line and eating the body's height.
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
                </div>
              )}
              {subtitle != null && <div style={{ fontSize: 12, color: HOME_THEME.green }}>{subtitle}</div>}
            </div>
          </div>
        )}
        {/* Flex column, not a plain block: children get the leftover height to
            stretch into instead of sitting at their natural size in a tile the
            user just made taller. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            // Content flexes first; `auto` is the safety net for a tile dragged
            // smaller than the content's own floor, so it scrolls instead of
            // being clipped by the card edge.
            overflow: visible ? "visible" : "auto",
          }}
        >
          {children}
        </div>
      </Card>
    </div>
  );
}

/* ── card bodies ─────────────────────────────────────────────────────────── */

/** Live px size of an element, for content that has to be told how big to draw. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setSize((s) => {
        const w = el.clientWidth, h = el.clientHeight;
        return Math.abs(s.w - w) > 1 || Math.abs(s.h - h) > 1 ? { w, h } : s;
      });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Sector wheel, sized from the tile rather than from a constant.
 *
 * The wheel's SVG is square at width:100%, so left to itself it renders as tall
 * as the card is wide and overruns everything under it. This used to be handled
 * by a hand-derived SUNBURST_WHEEL_PX that had to be re-tuned whenever the
 * card's chrome changed — and it couldn't follow a resizable tile at all.
 *
 * Now the wheel is a share of the measured tile (WHEEL_SHARE of its height,
 * never wider than the tile), so it grows and shrinks as the card is dragged.
 * The ratio only has to get CLOSE: FitBox wraps the result and scales away any
 * remainder, with a floor that stops the labels from going microscopic.
 */
const WHEEL_SHARE = 0.62;

function SunburstBody() {
  const [ref, { w, h }] = useBoxSize<HTMLDivElement>();
  const wheel = w > 0 && h > 0
    ? Math.max(120, Math.min(w - 8, Math.round(h * WHEEL_SHARE), 560))
    : undefined;
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      <FitBox fluidWidth min={0.5} max={1}>
        <SectorSunburst maxWheel={wheel} />
      </FitBox>
    </div>
  );
}

/** Header text that carries the selected symbol. */
function TickerTitle({ label }: { label: string }) {
  const { ticker } = useTicker();
  return <>{`${label} · ${ticker}`}</>;
}

/**
 * Heatmap stays live — SpxHeatmap pulls /api/spx-heatmap and rolls forward on
 * its own each trading day (SPX only for now).
 *
 * It draws on a fixed 9px cell, so nothing about it responds to the card's
 * size on its own: in a small tile it scrolled, in a large one it sat in the
 * corner. FitBox measures the grid's natural box and scales it to the tile —
 * up to 2x when there's room, down to 0.35 when there isn't.
 */
function HeatmapBody() {
  const { ticker } = useTicker();
  if (ticker !== "SPX") {
    return (
      <OptionsPlaceholder
        label="daily / yearly heatmap"
        shape="rows"
        note="placeholder — heatmap is SPX-only until per-ticker data is wired"
      />
    );
  }
  return (
    <FitBox min={0.35} max={2}>
      <SpxHeatmap />
    </FitBox>
  );
}

const FEED_ROWS = [
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "SWEEP" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "BLOCK" },
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "SPLIT" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "SWEEP" },
  { t: "—:—:—", side: "BUY", qty: "—", px: "—", tag: "BLOCK" },
  { t: "—:—:—", side: "SELL", qty: "—", px: "—", tag: "SPLIT" },
];

const FEED_COLS = "80px 56px 1fr 1fr 76px";

/** Skeleton tape — BUY/SELL colors are a data encoding, tokenized not literal. */
function OrderflowFeedBody() {
  const { ticker } = useTicker();
  return (
    // Column that owns the whole tile: the tape takes the leftover height and
    // its rows share it, so the table grows and shrinks with the card instead
    // of leaving a gap under six fixed-height rows.
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${HOME_THEME.border}`,
          borderRadius: 12,
          // Rows stretch to fill a tall tile and compress in a short one; past
          // their legible floor the tape scrolls rather than spilling out.
          overflowX: "hidden",
          overflowY: "auto",
          fontSize: 11,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: FEED_COLS,
            gap: 8,
            padding: "8px 14px",
            flexShrink: 0,
            color: HOME_THEME.text,
            opacity: 0.55,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            borderBottom: `1px solid ${HOME_THEME.border}`,
          }}
        >
          <span>Time</span>
          <span>Side</span>
          <span>Size</span>
          <span>Price</span>
          <span>Type</span>
        </div>
        {FEED_ROWS.map((r, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: FEED_COLS,
              alignItems: "center",
              gap: 8,
              // Rows divide whatever height the tile has left, down to a legible
              // floor — that's what makes the tape fill a tall card.
              flex: "1 1 0",
              minHeight: 20,
              padding: "0 14px",
              borderBottom: i === FEED_ROWS.length - 1 ? "none" : `1px solid ${HOME_THEME.border}`,
              color: HOME_THEME.text,
              opacity: 0.55,
            }}
          >
            <span>{r.t}</span>
            <span style={{ color: r.side === "BUY" ? HOME_THEME.cyan : HOME_THEME.orange, fontWeight: 800 }}>{r.side}</span>
            <span>{r.qty}</span>
            <span>{r.px}</span>
            <span>{r.tag}</span>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: HOME_THEME.text,
          opacity: 0.5,
          flexShrink: 0,
        }}
      >
        {ticker} — placeholder rows
      </div>
    </div>
  );
}
