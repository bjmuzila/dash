"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import DashGrid, { compactLayout, type GridItem } from "@/components/shared/DashGrid";
import { useFitUnit } from "@/components/shared/useFitUnit";
import LayoutBar from "@/components/shared/LayoutBar";
import { useDashboardLayout } from "@/components/shared/useDashboardLayout";
import SpxHeatmap from "@/components/spx/SpxHeatmap";
import SectorSunburst from "@/components/dashboard/SectorSunburst";
import GexChangeTop from "@/components/scanner/GexChangeTop";
import IbLevelCanvas from "@/components/scanner/IbLevelCanvas";
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
 * In edit mode each card gets an ✕ to remove it and the bar gets an "Add card"
 * menu, so the board is a SET of cards the user chooses — not a fixed six.
 *
 * Three rules the grid enforces for us:
 *   - Cards never overlap. DashGrid pushes whatever a dragged card lands on
 *     straight down and then floats the board up to close the gap.
 *   - Card CONTENT tracks the card. Bodies are flex-filled; widgets with an
 *     intrinsic size are refitted (the heatmap redraws at a smaller cell, the
 *     wheel's SVG letterboxes) rather than left to overflow.
 *   - Card TYPE lives in the id, as `type#n` (see CARD_TYPES). That keeps the
 *     stored layout a plain {id,x,y,w,h} list — no schema change to support
 *     adding, removing, or duplicating cards.
 *
 * Ticker-bound cards read the symbol from TickerProvider, so the dropdown
 * drives them. Cards marked `universal` in the catalog are market-wide (the
 * sector wheel, the hourly scanner) or instrument-fixed (ES initial balance)
 * and ignore it — their headers say so rather than showing a symbol they
 * aren't actually using.
 */

/** Grid geometry. Row pitch is ROW_H + GUTTER, so h:9 ≈ 380px tall. */
const COLS = 12;
const ROW_H = 28;
const GUTTER = 16;
/** Below this the absolute grid gets too cramped — cards stack full width. */
const STACK_BELOW_PX = 900;

/* ── card catalog ────────────────────────────────────────────────────────── */

type CardDef = {
  /** Menu label in "Add card". */
  label: string;
  /** Ignores the ticker dropdown — market-wide or instrument-fixed. */
  universal?: boolean;
  /** Header line. Ticker-bound cards get the symbol appended. */
  title?: string;
  subtitle?: string;
  /** Card body. Bare cards (`chrome: false`) bring their own Card + header. */
  body: () => ReactNode;
  /** Default tile size when added from the menu. */
  w: number;
  h: number;
  /** false = mount the component raw, it renders its own card shell. */
  chrome?: boolean;
  padding?: number;
  overflow?: "visible";
  /** Only one of these may exist on a board (the ticker picker). */
  singleton?: boolean;
};

/**
 * Every card the page can show. The key is the card TYPE; a card on the board
 * is an INSTANCE of one, with id `type#n`. Add an entry here and it appears in
 * the Add-card menu — nothing else to register.
 */
const CARD_TYPES: Record<string, CardDef> = {
  ticker: {
    label: "Ticker selector",
    universal: true,
    singleton: true,
    body: () => (
      <div style={{ display: "flex", alignItems: "center", height: "100%", minHeight: 0 }}>
        <TickerSelect maxWidth="100%" />
      </div>
    ),
    w: 7, h: 3, padding: 16, overflow: "visible",
  },
  heatmap: {
    label: "Heatmap",
    title: "Heatmap",
    body: () => <HeatmapBody />,
    w: 7, h: 9, padding: 14,
  },
  candles: {
    label: "Candlestick (ES chart)",
    title: "Candlestick",
    subtitle: "ES-based chart",
    body: () => (
      <OptionsPlaceholder label="candles" shape="candles" note="placeholder — chart component goes here" />
    ),
    w: 7, h: 9,
  },
  sunburst: {
    label: "S&P sector wheel",
    universal: true,
    body: () => <SunburstBody />,
    w: 5, h: 10, padding: 14,
  },
  orderflow: {
    label: "Orderflow graph",
    title: "Orderflow Graph",
    subtitle: "cumulative delta",
    body: () => <OptionsPlaceholder label="orderflow" shape="bars" />,
    w: 5, h: 5,
  },
  feed: {
    label: "Live orderflow feed",
    title: "Live Orderflow Feed",
    subtitle: "idle — no stream connected",
    body: () => <OrderflowFeedBody />,
    w: 5, h: 6,
  },
  // GexChangeTop and IbLevelCanvas each render their own <Card> with a title,
  // so they mount bare — wrapping them in a titled GridCard would double the
  // header. chrome:false also means the drag handle is the whole tile top
  // strip rather than a header row we own (see GridCard).
  scanner: {
    label: "Top 5 scanner",
    universal: true,
    chrome: false,
    body: () => <GexChangeTop />,
    w: 5, h: 12,
  },
  ib: {
    label: "Initial balance",
    universal: true,
    chrome: false,
    body: () => <IbLevelCanvas />,
    w: 5, h: 12,
  },
};

const cardTypeOf = (id: string) => id.split("#")[0];
const canRenderCard = (id: string) => cardTypeOf(id) in CARD_TYPES;
const defOf = (id: string): CardDef | undefined => CARD_TYPES[cardTypeOf(id)];

/** `heatmap` → `heatmap#3`, picking the lowest free suffix. */
function nextInstanceId(type: string, layout: GridItem[]): string {
  const taken = new Set(layout.map((i) => i.id));
  for (let n = 1; n < 999; n++) {
    const id = `${type}#${n}`;
    if (!taken.has(id)) return id;
  }
  return `${type}#${Date.now()}`;
}

/**
 * Built-in board — what a user sees before they've saved a template. Once they
 * have one, THEIR card set is authoritative: useDashboardLayout does not merge
 * these back in, or removing a card would just resurrect it on reload.
 */
const DEFAULT_LAYOUT: GridItem[] = [
  { id: "ticker#1",    x: 0, y: 0,  w: 7, h: 3 },
  { id: "heatmap#1",   x: 0, y: 3,  w: 7, h: 9 },
  { id: "candles#1",   x: 0, y: 12, w: 7, h: 9 },
  { id: "sunburst#1",  x: 7, y: 0,  w: 5, h: 10 },
  { id: "orderflow#1", x: 7, y: 10, w: 5, h: 5 },
  { id: "feed#1",      x: 7, y: 15, w: 5, h: 6 },
];

export default function OptionsPage() {
  // The third arg gates what a loaded template may put on the board: an id
  // whose type isn't in CARD_TYPES has no renderer, so it's dropped rather than
  // left as a hole in the grid.
  const L = useDashboardLayout("options", DEFAULT_LAYOUT, canRenderCard);
  const narrow = useIsNarrow(STACK_BELOW_PX);
  const editing = L.editing && !narrow;

  // On phones / narrow windows the 12-col grid isn't usable, so ignore the
  // saved x/w and stack every card full width in its saved reading order.
  // Nothing is written back — the desktop arrangement stays exactly as saved.
  // Only ids the catalog knows how to draw. A template saved when a card type
  // existed (or was named differently) can't wedge an unrenderable tile onto
  // the board — it just doesn't come back.
  const known = L.layout.filter((it) => defOf(it.id));
  const items = narrow ? stackLayout(known) : known;

  const addCard = (type: string) => {
    const def = CARD_TYPES[type];
    if (!def) return;
    const bottom = L.layout.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const id = nextInstanceId(type, L.layout);
    // Dropped in at the bottom-left, then compacted — it lands in the first
    // gap big enough for it rather than always starting a new row.
    L.setLayout(compactLayout([...L.layout, { id, x: 0, y: bottom, w: def.w, h: def.h }]));
  };

  const removeCard = (id: string) => {
    L.setLayout(compactLayout(L.layout.filter((i) => i.id !== id)));
  };

  // Singletons (the ticker picker) drop out of the menu once they're placed.
  const addOptions = Object.entries(CARD_TYPES)
    .filter(([type, def]) => !def.singleton || !L.layout.some((i) => cardTypeOf(i.id) === type))
    .map(([type, def]) => ({ value: type, label: def.label }));

  return (
    <TickerProvider>
      <PageShell className={editing ? "no-card-lift" : undefined}>
        {!narrow && <LayoutBar {...L.bar} addOptions={addOptions} onAdd={addCard} />}

        <DashGrid
          layout={items}
          onLayoutChange={L.setLayout}
          locked={!editing}
          cols={COLS}
          rowH={ROW_H}
          gutter={GUTTER}
          minW={3}
          minH={3}
        >
          {items.map((it) => {
            const def = defOf(it.id)!;
            return (
              <GridCard
                key={it.id}
                data-grid-id={it.id}
                data-grid-overflow={def.overflow}
                editing={editing}
                title={def.title}
                subtitle={def.subtitle}
                universal={def.universal}
                chrome={def.chrome !== false}
                padding={def.padding}
                onRemove={removeCard}
              >
                {def.body()}
              </GridCard>
            );
          })}
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
 *
 * `chrome={false}` is for components that already render their own <Card> with
 * a title (the scanner, the IB canvas). Those mount raw and get a slim edit-mode
 * strip across the top for the grip and the ✕, instead of a header we own —
 * otherwise every one of them would show two stacked titles.
 */
function GridCard({
  "data-grid-id": id,
  "data-grid-overflow": overflow,
  title,
  subtitle,
  universal,
  editing,
  chrome = true,
  padding = 20,
  onRemove,
  children,
}: {
  /**
   * NAMED as the data attributes on purpose. DashGrid reads these off the child
   * ELEMENT's props (child.props["data-grid-id"]), not off the DOM, so a prop
   * called `id`/`overflow` here would be invisible to it — which is exactly the
   * bug that left the ticker card clipped and painting under the heatmap.
   * Same names on the element and on the div = they can't drift apart again.
   */
  "data-grid-id": string;
  "data-grid-overflow"?: "visible";
  title?: string;
  subtitle?: string;
  universal?: boolean;
  editing: boolean;
  chrome?: boolean;
  padding?: number;
  onRemove?: (id: string) => void;
  children: ReactNode;
}) {
  const visible = overflow === "visible";
  const heading = title == null ? null : universal ? title : <TickerTitle label={title} />;
  const showHeader = heading != null || editing;

  const grip = (
    <span
      aria-hidden
      title="Drag to move"
      style={{ fontSize: 12, lineHeight: 1, letterSpacing: 1, color: HOME_THEME.cyan, opacity: 0.8 }}
    >
      ⠿
    </span>
  );

  // Sits inside the drag handle, so DashGrid's own "ignore interactive
  // elements" check is what keeps a click here from starting a drag.
  const removeBtn = onRemove ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(id); }}
      title="Remove this card"
      aria-label="Remove this card"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        marginLeft: "auto",
        flexShrink: 0,
        padding: 0,
        borderRadius: 4,
        border: `1px solid ${HOME_THEME.border}`,
        background: "rgba(255,255,255,0.04)",
        color: HOME_THEME.text,
        opacity: 0.7,
        fontSize: 11,
        lineHeight: 1,
        cursor: "pointer",
      }}
    >
      ✕
    </button>
  ) : null;

  if (!chrome) {
    return (
      <div
        data-grid-id={id}
        style={{ position: "relative", width: "100%", height: "100%", overflow: "auto" }}
      >
        {editing && (
          <div
            data-dashgrid-handle=""
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 6,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 8px",
              cursor: "grab",
              userSelect: "none",
              background: "rgba(5,6,10,0.72)",
              borderBottom: `1px solid ${HOME_THEME.border}`,
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
            }}
          >
            {grip}
            {removeBtn}
          </div>
        )}
        {children}
      </div>
    );
  }

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
              alignItems: "center",
              gap: 8,
              // Tight against the body. The old 14px gap plus the card's own
              // padding was most of the "empty space at the top" of a tile.
              marginBottom: heading != null || subtitle != null ? 8 : 4,
              flexShrink: 0,
              cursor: editing ? "grab" : undefined,
              userSelect: editing ? "none" : undefined,
            }}
          >
            {editing && grip}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              {heading != null && (
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
                  {heading}
                </div>
              )}
              {subtitle != null && <div style={{ fontSize: 12, color: HOME_THEME.green }}>{subtitle}</div>}
            </div>
            {editing && removeBtn}
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

/**
 * Sector wheel that fills its tile.
 *
 * `fill` puts the component's body in a flex column and lets the SVG take the
 * leftover height (preserveAspectRatio keeps it round), so the wheel is as big
 * as the card allows and grows when the card does. `showMovers={false}` drops
 * the Top/Bottom table under it — the wheel already calls out its extremes, and
 * on a resizable tile that table was taking the space the wheel wanted.
 *
 * This replaces the old measure-and-scale approach: no wheel-diameter constant,
 * no transform, so the header and labels stay at full size at any tile size.
 */
function SunburstBody() {
  return <SectorSunburst fill showMovers={false} />;
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
 * It draws on a fixed cell size, so it can't flex on its own. Rather than
 * CSS-scaling a 9px render (blurry when grown, and it scales the mode buttons
 * and year labels too), useFitUnit hands it the CELL SIZE that fits the tile
 * and the grid redraws crisply at that size — bigger squares in a bigger card,
 * smaller in a smaller one.
 */
function HeatmapBody() {
  const { ticker } = useTicker();
  const [boxRef, contentRef, cell] = useFitUnit(9, { min: 3, max: 22 });

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
    <div ref={boxRef} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
      <div ref={contentRef} style={{ width: "max-content" }}>
        <SpxHeatmap cell={cell} />
      </div>
    </div>
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
