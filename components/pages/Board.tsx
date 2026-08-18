"use client";

/**
 * Board — the near-black card dashboard.
 *
 * WHAT THIS IS
 * ------------
 * A second customer dashboard built on the SAME grid machinery as the Options
 * board (DashGrid + useDashboardLayout + LayoutBar): drag to move, drag the
 * corner to resize, "+ Add card" to add, ✕ on a card to remove, arrangement
 * saved per user as a named template in `dashboard_layouts`. Card TYPE lives in
 * the id as `type#n`, so adding/removing/duplicating needs no schema change.
 *
 * WHY IT DOESN'T USE PageCard / homeTheme
 * ---------------------------------------
 * This page is the near-black palette trial (BOARD_THEME below) — a flat opaque
 * surface set, deliberately different from homeTheme's frosted translucent
 * panels. It is SCOPED TO THIS PAGE on purpose: nothing else in the app changes
 * while the look is being lived with. If it graduates, the fix is to move these
 * six surface values into homeTheme and delete BOARD_THEME — NOT to start
 * hardcoding hex in other pages. Every color below comes from BOARD_THEME;
 * there are no literal hex values outside that one block.
 *
 * THE CARDS ARE THE REAL PAGES
 * ----------------------------
 * Almost every card mounts the component the matching dashboard page actually
 * renders — GexChart from /home, EsChartCard (via EsCandlesPage's `embedded`
 * path) from /es-candles, OptionsChainPage in its proven embed configuration,
 * EconCalendarPanel, EmCustomer, GexChangeTop, IbStatsTab, MultGreekClient.
 * They are not reimplementations, so they cannot drift from the pages.
 *
 * Only three cards are board-native, because no mountable equivalent exists:
 * the Overview tiles, Key Levels, and Feed Health.
 *
 * DATA — ONE SUBSCRIPTION FOR THE BOARD'S OWN CARDS
 * -------------------------------------------------
 * `useBoardFeed` opens exactly one `subscribeGex` (the shared refcounted
 * /ws/gex) and fans the parsed frames out through context, so the tiles, Key
 * Levels, the GEX chart and the flow tape all read one parse of the ~100KB gex
 * frame instead of four.
 *
 * Mounted components that subscribe on their own (GreeksHomePanel, the gauge
 * rail, EsChartCard) are fine: gexSocket is refcounted and their topic lists
 * are subsets of BOARD_TOPICS, so they ride this same connection.
 *
 * Deliberate non-goal: this page does NOT send SET_EXPIRY. That command is
 * per-CONNECTION on a socket the whole tab shares, so pinning an expiry here
 * would silently retarget every other mounted consumer. The board shows
 * whatever expiry the feed is on and labels it.
 */

import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import DashGrid, { compactLayout, type GridItem } from "@/components/shared/DashGrid";
import LayoutBar from "@/components/shared/LayoutBar";
import { useDashboardLayout } from "@/components/shared/useDashboardLayout";
import { subscribeGex, type GexMessage } from "@/lib/gexSocket";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import {
  computeGEXProfile, findGEXFlip, netGEXOf, formatGEX, formatStrike,
  type ChainRow, type GEXProfile,
} from "@/lib/calculations/calculations";

/* ── the REAL dashboard components each card mounts ──────────────────────────
   Every card below is the component the corresponding page actually renders —
   not a re-implementation. Where a page delegates to a panel (GexChart under
   /home, EsChartCard under /es-candles, EconCalendarPanel under /analytics) the
   card mounts the PANEL; where the page IS the unit and already has an embed
   contract (OptionsChainPage, EsCandlesPage) the card mounts the page in its
   embedded mode.

   Three pages are deliberately absent — /flow, /levels and /traders-dashboard
   each render their own <PageShell> with zero extracted panels, so mounting one
   would nest a page shell inside a tile. Their reusable pieces (FlowTape,
   FlowNetPremPanel) ARE here as cards.
   ─────────────────────────────────────────────────────────────────────────── */
import GexChart from "@/components/dashboard/GexChart";
import EsCandlesPage from "@/components/pages/EsCandles";
import OptionsChainPage from "@/components/pages/OptionsChain";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";
import FlowTape from "@/components/dashboard/FlowTape";
import FlowNetPremPanel from "@/components/dashboard/FlowNetPremPanel";
import GreeksHomePanel from "@/components/dashboard/GreeksHomePanel";
import HomeGaugeRail from "@/components/dashboard/HomeGaugeRail";
import VolGexFlowPanel from "@/components/dashboard/VolGexFlowPanel";
import EmCustomer from "@/components/dashboard/EmCustomer";
import GexChangeTop from "@/components/scanner/GexChangeTop";
import IbStatsTab from "@/components/scanner/IbStatsTab";
import { MultGreekClient } from "@/app/mult-greek/MultGreekClient";

/* ═══════════════════════════════════════════════════════════════════════════
   THEME — the ONLY place this file names a color.
   Six surfaces on one blue-grey hue at six lightness stops, plus the accent
   roles. Tuned in generated/2026-08-18-dark-slate-card-theme.html.
   ═══════════════════════════════════════════════════════════════════════════ */
const BOARD_THEME = {
  app: "#010102",
  rail: "#020203",
  shell: "#020304",
  card: "#0a0b0e",
  card2: "#0d0e12",
  cardHi: "#101115",

  text: "#eceff6",
  text2: "#a8b0c2",
  text3: "#6f7789",

  line: "rgba(255,255,255,0.075)",
  line2: "rgba(255,255,255,0.045)",

  cyan: "#2fd4c6",
  blue: "#4d8dff",
  orange: "#f59f3c",
  red: "#ef5f6b",
  green: "#3ec98a",
  purple: "#9b7cf6",
  yellow: "#ffd45e",
} as const;

/** rgba() off a BOARD_THEME hex — for tints, so no rgba literal is hardcoded. */
function tint(hex: string, a: number): string {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEED
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Frame types every card on this page branches on, declared at MODULE SCOPE.
 *
 * The socket is topic-scoped: the server drops any frame whose type isn't in
 * the union of mounted consumers' lists — INCLUDING the small scalar frames
 * (`spot`, `aux`, `status`), which is why they are listed explicitly. A missing
 * topic does not throw; the panel just goes quietly stale. Erring wide costs a
 * few hundred bytes.
 *
 * `flow` is here for the Tape card. It stays in the list even when that card is
 * removed from the board — the value keys the subscription effect, and making
 * it depend on the card set would reconnect the socket (clearing the replay
 * cache) every time someone adds or drops a card.
 *
 * This set is also a SUPERSET of what the mounted components ask for on their
 * own subscriptions, which is what lets them ride this connection rather than
 * widening it: GreeksHomePanel wants ["gex","spot"], HomeGaugeRail ["gex"],
 * EsChartCard ["gex","spot","aux","status"]. Anything added to this board must
 * be checked against that — a card whose component subscribes UNSCOPED (no
 * topics) drags the whole tab back to the firehose. That is why
 * WhaleOrdersPanel is not offered here.
 */
const BOARD_TOPICS = ["gex", "spot", "aux", "status", "flow"] as const;

/** Coalesce bursts: the feed pushes continuously, one render per window. */
const FRAME_MS = 700;

type BoardFeed = {
  chain: ChainRow[];
  spot: number;
  prevClose: number;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  totalNetGex: number | null;
  esFut: number;
  expiry: string;
  tape: FlowOrder[];
  connected: boolean;
  hasData: boolean;
  /**
   * Epoch ms of the last frame of each type, as a REF rather than state.
   *
   * Only the Feed Health card reads it, and it already ticks its own 1s clock.
   * Publishing these as state would re-render every card on the board at the
   * feed's rate — a diagnostic panel must not become the page's most expensive
   * component.
   */
  lastByTypeRef: { readonly current: Record<string, number> };
  profile: GEXProfile | null;
};

const EMPTY_FEED: BoardFeed = {
  chain: [], spot: 0, prevClose: 0, callWall: null, putWall: null, flip: null,
  totalNetGex: null, esFut: 0, expiry: "", tape: [], connected: false,
  hasData: false, lastByTypeRef: { current: {} }, profile: null,
};

const FeedCtx = createContext<BoardFeed>(EMPTY_FEED);
const useFeed = () => useContext(FeedCtx);

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function useBoardFeed(): BoardFeed {
  const enabled = useWsLifecycle();

  const [chain, setChain] = useState<ChainRow[]>([]);
  const [spot, setSpot] = useState(0);
  const [prevClose, setPrevClose] = useState(0);
  const [callWall, setCallWall] = useState<number | null>(null);
  const [putWall, setPutWall] = useState<number | null>(null);
  const [serverFlip, setServerFlip] = useState<number | null>(null);
  const [totalNetGex, setTotalNetGex] = useState<number | null>(null);
  const [esFut, setEsFut] = useState(0);
  const [expiry, setExpiry] = useState("");
  const [tape, setTape] = useState<FlowOrder[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasData, setHasData] = useState(false);

  // Coalescer state lives in refs so the subscribe effect never re-runs.
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastByTypeRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!enabled) return;

    const apply = (p: Record<string, unknown>) => {
      if (Array.isArray(p.gexRows)) {
        setChain(p.gexRows as ChainRow[]);
        setHasData(true);
      }
      const s = num(p.spot);
      if (s > 0) setSpot(s);
      const pc = num(p.prevClose);
      if (pc > 0) setPrevClose(pc);
      if (p.callWall != null) setCallWall(num(p.callWall) || null);
      if (p.putWall != null) setPutWall(num(p.putWall) || null);
      if (p.gexFlip != null) setServerFlip(num(p.gexFlip) || null);
      if (p.totalNetGex != null) setTotalNetGex(num(p.totalNetGex) || null);
      const es = num(p.esFut);
      if (es > 0) setEsFut(es);
      if (typeof p.expiry === "string" && p.expiry) setExpiry(p.expiry);
    };

    const flush = () => {
      timerRef.current = null;
      const p = pendingRef.current;
      pendingRef.current = null;
      if (p) apply(p);
    };

    const queue = (p: Record<string, unknown>, immediate: boolean) => {
      if (immediate) {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        pendingRef.current = null;
        apply(p);
        return;
      }
      pendingRef.current = { ...(pendingRef.current ?? {}), ...p };
      if (!timerRef.current) timerRef.current = setTimeout(flush, FRAME_MS);
    };

    const off = subscribeGex({
      topics: BOARD_TOPICS,
      onStatus: setConnected,
      onMessage: (msg: GexMessage) => {
        const type = String(msg.type ?? "");
        // server-v2 nests under `data`; legacy frames put fields on the message.
        const data = msg.data && typeof msg.data === "object" ? asRecord(msg.data) : asRecord(msg);
        // Mutated, not published — see BoardFeed.lastByTypeRef.
        lastByTypeRef.current[type] = Date.now();
        switch (type) {
          case "snapshot":
            queue(data, true);
            break;
          case "gex":
          case "GEX_UPDATE":
            queue(data, false);
            break;
          case "spot":
            queue({ spot: data.spot, prevClose: data.prevClose }, false);
            break;
          case "aux":
            queue({ esFut: data.esFut }, false);
            break;
          case "status":
          case "EXPIRATIONS":
            if (typeof data.expiry === "string" && data.expiry) setExpiry(data.expiry);
            break;
          case "flow":
            if (Array.isArray(data.tape)) setTape(data.tape as FlowOrder[]);
            break;
          default:
            break;
        }
      },
    });

    return () => {
      off();
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [enabled]);

  // Prefer the client-side flip: it is derived from the exact rows on screen.
  const flip = useMemo(() => findGEXFlip(chain, spot) ?? serverFlip, [chain, spot, serverFlip]);
  const profile = useMemo(
    () => (chain.length ? computeGEXProfile(chain, spot, "oi-vol") : null),
    [chain, spot],
  );

  return useMemo(
    () => ({
      chain, spot, prevClose, callWall, putWall, flip, totalNetGex, esFut,
      expiry, tape, connected, hasData, lastByTypeRef, profile,
    }),
    [chain, spot, prevClose, callWall, putWall, flip, totalNetGex, esFut,
     expiry, tape, connected, hasData, profile],
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   GRID
   ═══════════════════════════════════════════════════════════════════════════ */

const COLS = 12;
const ROW_H = 28;
const GUTTER = 14;
const STACK_BELOW_PX = 900;

type CardDef = {
  /** Menu label in "+ Add card". */
  label: string;
  /** Header line. Omit together with `chrome: false`. */
  title?: string;
  subtitle?: string;
  body: () => ReactNode;
  /** Default tile size when added from the menu. */
  w: number;
  h: number;
  padding?: number;
  /**
   * false = the component renders its own card shell / page chrome, so it
   * mounts raw and gets only a slim edit-mode strip for the grip and the ✕.
   * Wrapping one of these in a titled card would show two stacked headers.
   */
  chrome?: boolean;
  /**
   * Only one may exist on a board. Used where a second instance would fight the
   * first over a shared persistence namespace or simply makes no sense.
   */
  singleton?: boolean;
};

const CARD_TYPES: Record<string, CardDef> = {
  // ── board-native (no page equivalent) ──────────────────────────────────────
  stats: {
    label: "Overview tiles",
    singleton: true,
    body: () => <StatsBody />,
    w: 12, h: 3, padding: 0,
  },
  levels: {
    label: "Key levels",
    title: "Key Levels",
    body: () => <LevelsBody />,
    w: 4, h: 7,
  },
  health: {
    label: "Feed health",
    title: "Feed Health",
    subtitle: "/ws/gex · topic-scoped",
    body: () => <HealthBody />,
    w: 4, h: 7,
  },

  // ── /home ─────────────────────────────────────────────────────────────────
  gexchart: {
    label: "GEX chart",
    title: "GEX by Strike",
    subtitle: "the /home chart",
    // The real canvas chart. Pure props + its own ResizeObserver, so it fills
    // whatever the tile gives it. `transparentBg` exists for exactly this.
    body: () => <GexChartBody />,
    w: 8, h: 11,
  },
  greeks: {
    label: "Greeks panel",
    title: "Greeks",
    subtitle: "the /home greeks panel",
    // Rides the shared socket with topics ["gex","spot"] — inside BOARD_TOPICS.
    body: () => <GreeksHomePanel />,
    w: 4, h: 10,
  },
  gauges: {
    label: "Gauge rail",
    title: "Gauges",
    // Subscribes ["gex"]. gammaPctVol / ibDirection are optional and only
    // populated on /home from page state this board does not compute.
    body: () => <HomeGaugeRail />,
    w: 4, h: 9,
  },
  volgex: {
    label: "Vol GEX flow",
    title: "Vol GEX Flow",
    body: () => <VolGexFlowPanel />,
    w: 6, h: 9,
  },

  // ── /es-candles ───────────────────────────────────────────────────────────
  escandles: {
    label: "ES candles",
    chrome: false,
    // `embedded` is the page's own first-class embed path — it drops the page
    // shell and returns <EsChartCard slot="embed" …> with its dock inside.
    // SINGLETON because `slot` is a localStorage namespace: two instances would
    // fight over ticker / interval / indicators.
    singleton: true,
    body: () => <EsCandlesPage embedded />,
    w: 8, h: 16,
  },

  // ── /options-chain ────────────────────────────────────────────────────────
  chain: {
    label: "Options chain",
    chrome: false,
    // The real page in its proven embed configuration — the same one /home
    // uses. `ticker` hides the page's own ticker input; showGrandTotal drops
    // the total readout that only makes sense full-page.
    body: () => (
      <div style={{ height: "100%", overflow: "auto" }}>
        <OptionsChainPage expirySelection="key" ticker="SPX" showGrandTotal={false} />
      </div>
    ),
    w: 12, h: 18,
  },

  // ── /flow (the page itself is PageShell-bound; these are its panels) ───────
  tape: {
    label: "Flow tape",
    title: "Flow Tape",
    // Pure props — fed from this board's own socket, no second connection.
    body: () => <TapeBody />,
    w: 6, h: 12,
  },
  netprem: {
    label: "Net premium chart",
    title: "Net Premium",
    body: () => <FlowNetPremPanel />,
    w: 6, h: 9,
  },

  // ── /em ───────────────────────────────────────────────────────────────────
  em: {
    label: "Estimated moves",
    chrome: false,
    // The component /em actually mounts. It carries its own page header (logo +
    // h1) — that is what the page looks like, which is the point.
    body: () => <EmCustomer />,
    w: 6, h: 16,
  },

  // ── /economic-calendar ────────────────────────────────────────────────────
  econ: {
    label: "Economic calendar",
    title: "Economic Calendar",
    subtitle: "today only",
    // The panel /home and /analytics embed, with its designed embed props.
    body: () => <EconCalendarPanel todayOnly hideToolbar />,
    w: 6, h: 10,
  },

  // ── /scanner (PageShell is page-level; every tab body is bare) ─────────────
  scanner: {
    label: "Scanner · GEX change top",
    chrome: false,
    body: () => <GexChangeTop />,
    w: 5, h: 14,
  },
  ibstats: {
    label: "Scanner · IB stats",
    chrome: false,
    body: () => <IbStatsTab />,
    w: 7, h: 14,
  },

  // ── /mult-greek ───────────────────────────────────────────────────────────
  multgreek: {
    label: "Multi Greek (wide)",
    chrome: false,
    // Whole page in a tile: four ticker columns plus its own dock. It mounts
    // cleanly (height:100%, all props optional) but wants ~1000px of width —
    // hence the full-width default and the label.
    singleton: true,
    body: () => <MultGreekClient />,
    w: 12, h: 20,
  },
};

const cardTypeOf = (id: string) => id.split("#")[0];
const canRenderCard = (id: string) => cardTypeOf(id) in CARD_TYPES;
const defOf = (id: string): CardDef | undefined => CARD_TYPES[cardTypeOf(id)];

/** `chain` → `chain#3`, picking the lowest free suffix. */
function nextInstanceId(type: string, layout: GridItem[]): string {
  const taken = new Set(layout.map((i) => i.id));
  for (let n = 1; n < 999; n++) {
    const id = `${type}#${n}`;
    if (!taken.has(id)) return id;
  }
  return `${type}#${layout.length + 1}`;
}

/**
 * Built-in board. Once a user saves a template THEIR card set wins outright —
 * useDashboardLayout does not merge these back in, or every removal would
 * resurrect itself on the next reload.
 */
const DEFAULT_LAYOUT: GridItem[] = [
  { id: "stats#1",    x: 0, y: 0,  w: 12, h: 3 },
  { id: "gexchart#1", x: 0, y: 3,  w: 8,  h: 11 },
  { id: "levels#1",   x: 8, y: 3,  w: 4,  h: 7 },
  { id: "gauges#1",   x: 8, y: 10, w: 4,  h: 9 },
  { id: "escandles#1", x: 0, y: 14, w: 8, h: 16 },
  { id: "tape#1",     x: 8, y: 19, w: 4,  h: 12 },
  { id: "chain#1",    x: 0, y: 30, w: 12, h: 18 },
  { id: "econ#1",     x: 0, y: 48, w: 6,  h: 10 },
  { id: "health#1",   x: 6, y: 48, w: 4,  h: 7 },
];

export default function Board() {
  const L = useDashboardLayout("board", DEFAULT_LAYOUT, canRenderCard);
  const narrow = useIsNarrow(STACK_BELOW_PX);
  const editing = L.editing && !narrow;
  const feed = useBoardFeed();

  const known = L.layout.filter((it) => defOf(it.id));
  const items = narrow ? stackLayout(known) : known;

  const addCard = (type: string) => {
    const def = CARD_TYPES[type];
    if (!def) return;
    const bottom = L.layout.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const id = nextInstanceId(type, L.layout);
    L.setLayout(compactLayout([...L.layout, { id, x: 0, y: bottom, w: def.w, h: def.h }]));
  };

  const removeCard = (id: string) => {
    L.setLayout(compactLayout(L.layout.filter((i) => i.id !== id)));
  };

  const addOptions = Object.entries(CARD_TYPES)
    .filter(([type, def]) => !def.singleton || !L.layout.some((i) => cardTypeOf(i.id) === type))
    .map(([type, def]) => ({ value: type, label: def.label }));

  return (
    <FeedCtx.Provider value={feed}>
      <div
        className={editing ? "no-card-lift" : undefined}
        style={{
          height: "100%",
          width: "100%",
          background: BOARD_THEME.shell,
          color: BOARD_THEME.text,
          overflow: "auto",
          padding: "14px 16px 24px",
          boxSizing: "border-box",
          fontFamily: "var(--font-inter), 'Inter', 'Helvetica Neue', Arial, sans-serif",
        }}
      >
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
              <BoardCard
                key={it.id}
                data-grid-id={it.id}
                editing={editing}
                title={def.title}
                subtitle={def.subtitle}
                chrome={def.chrome !== false}
                padding={def.padding}
                onRemove={removeCard}
              >
                {def.body()}
              </BoardCard>
            );
          })}
        </DashGrid>
      </div>
    </FeedCtx.Provider>
  );
}

/* ── grid plumbing (same contract as the Options board) ───────────────────── */

/** Single-column fallback: reading order preserved, full width, saved heights. */
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
 * `data-grid-id` is NAMED as the data attribute on purpose: DashGrid reads it
 * off the child ELEMENT's props (`child.props["data-grid-id"]`), not off the
 * DOM, so a prop called `id` here would be invisible to it. The header doubles
 * as the drag handle while editing — drag is limited to it so buttons and
 * charts inside a card keep working.
 */
function BoardCard({
  "data-grid-id": id,
  title,
  subtitle,
  editing,
  chrome = true,
  padding = 14,
  onRemove,
  children,
}: {
  "data-grid-id": string;
  title?: string;
  subtitle?: string;
  editing: boolean;
  chrome?: boolean;
  padding?: number;
  onRemove?: (id: string) => void;
  children: ReactNode;
}) {
  const showHeader = title != null || editing;

  const grip = (
    <span aria-hidden title="Drag to move"
      style={{ fontSize: 12, lineHeight: 1, letterSpacing: 1, color: BOARD_THEME.cyan, opacity: 0.8 }}>
      ⠿
    </span>
  );

  const removeBtn = onRemove ? (
    // Sits INSIDE the drag handle — DashGrid's own "ignore interactive
    // elements" check is what stops this click from starting a drag.
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(id); }}
      title="Remove this card"
      aria-label="Remove this card"
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 18, height: 18, marginLeft: "auto", flexShrink: 0, padding: 0,
        borderRadius: 4, border: `1px solid ${BOARD_THEME.line}`,
        background: BOARD_THEME.card2, color: BOARD_THEME.text,
        opacity: 0.7, fontSize: 11, lineHeight: 1, cursor: "pointer",
      }}
    >
      ✕
    </button>
  ) : null;

  // Components that bring their own card/page chrome mount raw. They get only a
  // slim floating strip while editing, instead of a header we own — otherwise
  // every one of them would show two stacked titles.
  if (!chrome) {
    return (
      <div data-grid-id={id} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        {editing && (
          <div
            data-dashgrid-handle=""
            style={{
              position: "absolute", top: 0, left: 0, right: 0, zIndex: 6,
              display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
              cursor: "grab", userSelect: "none",
              background: tint(BOARD_THEME.app, 0.82),
              borderBottom: `1px solid ${BOARD_THEME.line}`,
              borderTopLeftRadius: 12, borderTopRightRadius: 12,
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
    <div data-grid-id={id} style={{ width: "100%", height: "100%" }}>
      <div
        className="card-hover"
        style={{
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          overflow: "hidden",
          background: BOARD_THEME.card,
          border: `1px solid ${BOARD_THEME.line}`,
          borderRadius: 14,
          padding,
        }}
      >
        {showHeader && (
          <div
            data-dashgrid-handle={editing ? "" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: title != null ? 10 : 4,
              flexShrink: 0,
              padding: padding === 0 ? "10px 14px 0" : undefined,
              cursor: editing ? "grab" : undefined,
              userSelect: editing ? "none" : undefined,
            }}
          >
            {editing && grip}
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              {title != null && (
                <div style={{
                  fontSize: 12.5, fontWeight: 700, color: BOARD_THEME.text,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {title}
                </div>
              )}
              {subtitle != null && (
                <div style={{ fontSize: 10, color: BOARD_THEME.text3 }}>{subtitle}</div>
              )}
            </div>
            {editing && removeBtn}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED BITS
   ═══════════════════════════════════════════════════════════════════════════ */

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em", padding: "3px 9px",
      borderRadius: 999, whiteSpace: "nowrap",
      color, background: tint(color, 0.12), border: `1px solid ${tint(color, 0.25)}`,
    }}>
      {children}
    </span>
  );
}

/** Shown instead of a chart/table when the feed hasn't delivered rows yet. */
function Waiting({ what }: { what: string }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: "grid", placeItems: "center",
      fontSize: 11, color: BOARD_THEME.text3, textAlign: "center", padding: 12,
    }}>
      waiting for {what}…
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em",
  textTransform: "uppercase", color: BOARD_THEME.text3, padding: "7px 6px",
  borderBottom: `1px solid ${BOARD_THEME.line}`, position: "sticky", top: 0,
  background: BOARD_THEME.card,
};
const tdStyle: CSSProperties = {
  padding: "6px 6px", borderBottom: `1px solid ${BOARD_THEME.line2}`,
  color: BOARD_THEME.text2, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
};

/* ═══════════════════════════════════════════════════════════════════════════
   CARD BODIES
   ═══════════════════════════════════════════════════════════════════════════ */

function StatsBody() {
  const { spot, prevClose, totalNetGex, flip, callWall, putWall, hasData } = useFeed();
  const chg = spot > 0 && prevClose > 0 ? ((spot - prevClose) / prevClose) * 100 : null;
  const span = callWall != null && putWall != null ? callWall - putWall : null;

  const tiles: { label: string; sub?: string; value: string; color?: string }[] = [
    {
      label: "SPX Spot",
      value: spot > 0 ? formatStrike(spot) : "—",
      sub: chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : undefined,
      color: chg == null ? undefined : chg >= 0 ? BOARD_THEME.green : BOARD_THEME.red,
    },
    {
      label: "Net GEX",
      value: totalNetGex != null ? formatGEX(totalNetGex) : "—",
      color: totalNetGex == null ? undefined : totalNetGex >= 0 ? BOARD_THEME.cyan : BOARD_THEME.red,
    },
    {
      label: "Gamma Flip",
      sub: flip != null && spot > 0 ? `${flip < spot ? "below" : "above"} spot` : undefined,
      value: flip != null ? formatStrike(flip) : "—",
      color: BOARD_THEME.purple,
    },
    {
      label: "Wall Span",
      sub: callWall != null && putWall != null ? `${formatStrike(putWall)} → ${formatStrike(callWall)}` : undefined,
      value: span != null ? formatStrike(span) : "—",
      color: BOARD_THEME.blue,
    },
  ];

  if (!hasData) return <Waiting what="the feed" />;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: 1, background: BOARD_THEME.line2, flex: 1, minHeight: 0,
    }}>
      {tiles.map((t) => (
        <div key={t.label} style={{
          background: BOARD_THEME.card, padding: "10px 15px 12px",
          display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0,
        }}>
          <div style={{ fontSize: 10.5, color: BOARD_THEME.text3, fontWeight: 600 }}>{t.label}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 4 }}>
            <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", color: t.color ?? BOARD_THEME.text }}>
              {t.value}
            </span>
            {t.sub && <span style={{ fontSize: 11, fontWeight: 600, color: t.color ?? BOARD_THEME.text3 }}>{t.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The real /home GEX chart, fed from this board's socket.
 *
 * GexChart is pure props with its own ResizeObserver, so it fills whatever the
 * tile gives it and redraws on resize with no help from us. `transparentBg`
 * drops its opaque background so the card surface shows through — that prop
 * exists for exactly this case.
 *
 * No toolbar: GexToolbar is fully controlled and needs the page's expiry list,
 * mode state and an onRefresh. The chart's own defaults (net / OI+Vol) are the
 * ones /home opens with, and the flip curve is on because the board already
 * computes the profile.
 */
function GexChartBody() {
  const { chain, spot, flip, profile, expiry } = useFeed();
  if (!chain.length) return <Waiting what="gex rows" />;
  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      <GexChart
        chain={chain}
        spotPrice={spot}
        flipPoint={flip}
        gexProfile={profile}
        showFlipCurve
        expiry={expiry}
        transparentBg
      />
    </div>
  );
}

/** The real /flow tape, on this board's frames — no second socket. */
function TapeBody() {
  const { tape, connected } = useFeed();
  if (!tape.length) return <Waiting what="the flow tape" />;
  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <FlowTape orders={tape} connected={connected} />
    </div>
  );
}

function LevelsBody() {
  const { chain, spot, callWall, putWall, flip } = useFeed();

  // Core Bullseye = the strike carrying the most absolute gamma, on the same
  // basis the GEX chart draws with.
  const cb = useMemo(() => {
    if (!chain.length) return null;
    let best: ChainRow | null = null;
    let bestAbs = 0;
    for (const r of chain) {
      const a = Math.abs(netGEXOf(r, "net", spot));
      if (a > bestAbs) { bestAbs = a; best = r; }
    }
    return best ? { strike: best.strike, gex: netGEXOf(best, "net", spot) } : null;
  }, [chain, spot]);

  const gexAt = (strike: number | null): number | null => {
    if (strike == null) return null;
    const r = chain.find((x) => x.strike === strike);
    return r ? netGEXOf(r, "net", spot) : null;
  };

  const rows = [
    { code: "CB", name: "Core Bullseye", color: BOARD_THEME.yellow, strike: cb?.strike ?? null, gex: cb?.gex ?? null },
    { code: "CW", name: "Call Wall", color: BOARD_THEME.blue, strike: callWall, gex: gexAt(callWall) },
    { code: "PW", name: "Put Wall", color: BOARD_THEME.red, strike: putWall, gex: gexAt(putWall) },
    { code: "GF", name: "Gamma Flip", color: BOARD_THEME.purple, strike: flip, gex: null },
  ];

  if (!chain.length) return <Waiting what="levels" />;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {rows.map((r, i) => (
        <div key={r.code} style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 2px",
          borderBottom: i === rows.length - 1 ? "none" : `1px solid ${BOARD_THEME.line2}`,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center",
            fontSize: 9.5, fontWeight: 800, flexShrink: 0,
            background: tint(r.color, 0.15), color: r.color,
          }}>
            {r.code}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: BOARD_THEME.text }}>{r.name}</div>
            <div style={{ fontSize: 9.5, color: BOARD_THEME.text3, marginTop: 1 }}>
              {r.strike != null ? formatStrike(r.strike) : "—"}
              {r.strike != null && spot > 0 && (
                <> · {r.strike > spot ? "+" : ""}{formatStrike(r.strike - spot)} from spot</>
              )}
            </div>
          </div>
          {r.gex != null && <Chip color={r.color}>{formatGEX(r.gex)}</Chip>}
        </div>
      ))}
    </div>
  );
}

/**
 * The gamma profile curve — dealer gamma recomputed at 401 hypothetical spot
 * levels (computeGEXProfile, pure client math on the rows already in memory).
 * Zero crossing is the flip.
 */
function HealthBody() {
  const { connected, lastByTypeRef } = useFeed();
  // Local clock: this card re-renders once a second on its own, and reads the
  // arrival times out of the ref, so the rest of the board never re-renders for it.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stamps = lastByTypeRef.current;
  const age = (t?: number) => (t == null ? null : (now - t) / 1000);
  // `snapshot` isn't a topic — it's the connect frame — but it is the single
  // most useful row here, so it's listed alongside them.
  const rows = ["snapshot", ...BOARD_TOPICS];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <Chip color={connected ? BOARD_THEME.green : BOARD_THEME.red}>
          {connected ? "Connected" : "Disconnected"}
        </Chip>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
        <thead>
          <tr>
            <th style={thStyle}>Frame</th>
            <th style={thStyle}>Last</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const a = age(stamps[t]);
            const color = a == null ? BOARD_THEME.text3 : a < 15 ? BOARD_THEME.green : a < 90 ? BOARD_THEME.orange : BOARD_THEME.red;
            return (
              <tr key={t}>
                <td style={{ ...tdStyle, color: BOARD_THEME.text, fontWeight: 600 }}>{t}</td>
                <td style={tdStyle}>{a == null ? "—" : a < 60 ? `${a.toFixed(1)}s` : `${Math.round(a / 60)}m`}</td>
                <td style={tdStyle}>
                  <Chip color={color}>{a == null ? "none" : a < 15 ? "OK" : a < 90 ? "slow" : "stale"}</Chip>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
