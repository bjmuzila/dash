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
 * renders — GexChart + GexToolbar from /home (the same pair, same props, same
 * controls), EsChartCard (via EsCandlesPage's `embedded` path) from
 * /es-candles, MultGreekClient, EconCalendarPanel, EmCustomer, GexChangeTop,
 * IbStatsTab. They are not reimplementations, so they cannot drift.
 *
 * Only two cards are board-native, because no mountable equivalent exists:
 * the Overview tiles and Key Levels.
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
 * EXPIRY IS BOARD-WIDE, NOT PER-CARD
 * ----------------------------------
 * The GEX card carries the real /home GexToolbar, DTE picker included, and that
 * picker sends SET_EXPIRY through `sendGex`. SET_EXPIRY is per-CONNECTION on a
 * socket every consumer shares, so it retargets the WHOLE board at once — the
 * tiles, Key Levels, the ES card and the Greeks panel all follow it. That is
 * the intended behaviour here (one board, one expiry); it is also why there is
 * no second, independent expiry control anywhere on this page.
 *
 * /home is unaffected: HomeClient still opens its own private /ws/gex
 * connection, so a SET_EXPIRY sent from this board never reaches it.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import DashGrid, { compactLayout, type GridItem } from "@/components/shared/DashGrid";
import LayoutBar from "@/components/shared/LayoutBar";
import { useDashboardLayout } from "@/components/shared/useDashboardLayout";
import { sendGex, subscribeGex, type GexMessage } from "@/lib/gexSocket";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
import { useStrikeGexHistory } from "@/hooks/useStrikeGexHistory";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import {
  computeGEXProfile, findGEXFlip, netGEXOf, formatGEX, formatStrike,
  type ChainRow,
} from "@/lib/calculations/calculations";

/* ── the REAL dashboard components each card mounts ──────────────────────────
   Every card below is the component the corresponding page actually renders —
   not a re-implementation. Where a page delegates to a panel (GexChart under
   /home, EsChartCard under /es-candles, EconCalendarPanel under /analytics) the
   card mounts the PANEL; where the page IS the unit and already has an embed
   contract (EsCandlesPage, MultGreekClient) the card mounts the page in its
   embedded mode.

   Three pages are deliberately absent — /flow, /levels and /traders-dashboard
   each render their own <PageShell> with zero extracted panels, so mounting one
   would nest a page shell inside a tile. Their reusable pieces (FlowTape,
   FlowNetPremPanel) ARE here as cards.
   ─────────────────────────────────────────────────────────────────────────── */
import GexChart, { type GexMode, type DataMode } from "@/components/dashboard/GexChart";
import GexToolbar from "@/components/dashboard/GexToolbar";
import FitScale from "@/components/shared/FitScale";
import EsCandlesPage from "@/components/pages/EsCandles";
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

/**
 * The single ticker the Multi Greek card is pinned to.
 *
 * MODULE SCOPE, not an inline array: MultGreekClient keys its chain-fetch
 * effects off this list, so a fresh array each render would restart the loop
 * every render.
 */
const BOARD_ONE_TICKER = ["SPX"];

/**
 * Ghost-overlay ages, in minutes — the same three /home offers. Module scope for
 * the same reason: useStrikeGexHistory keys its poll off the list.
 */
const GHOST_AGES = [5, 15, 30];

type BoardFeed = {
  chain: ChainRow[];
  spot: number;
  prevClose: number;
  callWall: number | null;
  putWall: number | null;
  flip: number | null;
  totalNetGex: number | null;
  esFut: number;
  /** The expiry the FEED is currently on (what the rows are actually for). */
  expiry: string;
  /**
   * Every expiry the feed offers, newest-first as the server sends them. Feeds
   * the GEX card's DTE picker — the same list /home's picker is built from.
   */
  expirations: string[];
  tape: FlowOrder[];
  connected: boolean;
  hasData: boolean;
};

const EMPTY_FEED: BoardFeed = {
  chain: [], spot: 0, prevClose: 0, callWall: null, putWall: null, flip: null,
  totalNetGex: null, esFut: 0, expiry: "", expirations: [], tape: [],
  connected: false, hasData: false,
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
  const [expirations, setExpirations] = useState<string[]>([]);
  const [tape, setTape] = useState<FlowOrder[]>([]);
  const [connected, setConnected] = useState(false);
  const [hasData, setHasData] = useState(false);

  // Coalescer state lives in refs so the subscribe effect never re-runs.
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      // The gex/snapshot frame carries the calendar alongside the rows — this is
      // where /home's picker gets its list too.
      if (Array.isArray(p.expirations) && p.expirations.length) {
        setExpirations(p.expirations as string[]);
      }
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
            if (Array.isArray(data.expirations) && data.expirations.length) {
              setExpirations(data.expirations as string[]);
            }
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
  // Matches /home's `flipPoint` exactly (findGEXFlip(chartRows, chartSpot)).
  const flip = useMemo(() => findGEXFlip(chain, spot) ?? serverFlip, [chain, spot, serverFlip]);

  // NOTE: the 401-level gamma profile is NOT computed here. It depends on the
  // chart's dataMode, which is now a control on the GEX card's toolbar — so the
  // card computes its own and the board doesn't pay for a basis nobody is on.

  return useMemo(
    () => ({
      chain, spot, prevClose, callWall, putWall, flip, totalNetGex, esFut,
      expiry, expirations, tape, connected, hasData,
    }),
    [chain, spot, prevClose, callWall, putWall, flip, totalNetGex, esFut,
     expiry, expirations, tape, connected, hasData],
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

  // ── /home ─────────────────────────────────────────────────────────────────
  gexchart: {
    label: "GEX chart (with toolbar)",
    // No card header: the card IS the /home GEX panel — GexToolbar on top, the
    // canvas below — and a title bar above the toolbar would just be a third
    // stacked strip. The edit-mode grip strip still floats over it.
    chrome: false,
    // SINGLETON: the DTE picker on the toolbar sends SET_EXPIRY, which is a
    // per-connection command on a socket the whole board shares. Two of these
    // would be two controls fighting over one board-wide setting.
    singleton: true,
    body: () => <GexChartBody />,
    w: 8, h: 13,
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

  // ── /mult-greek, one column ───────────────────────────────────────────────
  // Was the embedded Options Chain page. Replaced by the Multi Greek grid
  // restricted to a SINGLE ticker (`tickers` prop) — same component /mult-greek
  // mounts, same toolbar, expiry picker, Δ stamps, CB/CW/PW badges, intensity,
  // replay and click-through chain, just one panel instead of four. Clicking
  // the panel's expand still opens the full option chain over it, so nothing
  // that was reachable from the old card was lost.
  //
  // Keeps the id `chain` on purpose: card type lives in the grid id, so saved
  // layouts that already have `chain#1` pick this up in place rather than
  // dropping a tile.
  chain: {
    label: "Multi Greek (one ticker)",
    chrome: false,
    // SINGLETON: the page holds a per-browser localStorage key and its own
    // chain/expiration fetch loop. A second instance doubles both.
    singleton: true,
    body: () => <MultGreekClient tickers={BOARD_ONE_TICKER} />,
    w: 6, h: 18,
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
    label: "Multi Greek (all four tickers)",
    chrome: false,
    // Whole page in a tile: four ticker columns plus its own dock. It mounts
    // cleanly (height:100%, all props optional) but wants ~1000px of width —
    // hence the full-width default and the label. The one-ticker version of the
    // same page is the `chain` card above; both mount MultGreekClient, so
    // running both at once means two chain-fetch loops.
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
  { id: "gexchart#1", x: 0, y: 3,  w: 8,  h: 13 },
  { id: "levels#1",   x: 8, y: 3,  w: 4,  h: 7 },
  { id: "gauges#1",   x: 8, y: 10, w: 4,  h: 9 },
  { id: "escandles#1", x: 0, y: 16, w: 8, h: 16 },
  { id: "tape#1",     x: 8, y: 19, w: 4,  h: 12 },
  { id: "chain#1",    x: 0, y: 32, w: 6,  h: 18 },
  { id: "econ#1",     x: 6, y: 32, w: 6,  h: 10 },
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

/* ── GEX card — the /home panel, whole ────────────────────────────────────────
   Toolbar on top, canvas below: the SAME GexToolbar + GexChart pair /home
   renders, wired to the same props with the same defaults, so every control is
   here — DTE picker, Net GEX / Call−Put, OI+Vol / Vol Only / Flow GEX, the
   OI / DEX / Flip overlay toggles, refresh, and the snap + Discord buttons
   pointed at the canvas.

   What differs from /home, and why:
   · The rows come from THIS board's shared socket instead of HomeClient's
     private one — same server, same frames, one connection for the page.
   · The DTE picker is board-wide (SET_EXPIRY is per-connection; see the file
     header). The card shows the picked expiry immediately and settles onto
     whatever the feed confirms.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Expiry values for the picker, filtered exactly like /home's
 * buildExpiryOptions: anything already past is dropped (a stale leading entry
 * the feed hadn't pruned is what used to mislabel the whole picker), capped at
 * the eight nearest.
 */
function usableExpirations(dates: string[]): string[] {
  const today = etYmdToday();
  return dates.filter((d) => daysBetweenYmd(today, d) >= 0).slice(0, 8);
}

/** Today in ET as yyyy-mm-dd — matches the server's todayYmd() convention. */
function etYmdToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return `${map.year}-${map.month}-${map.day}`;
}

/** Calendar days between two yyyy-mm-dd strings, parsed as UTC midnight. */
function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function GexChartBody() {
  const { chain, spot, flip, expiry, expirations } = useFeed();

  // Chart controls — same names, same defaults as HomeClient.
  const [gexMode, setGexMode] = useState<GexMode>("net");
  const [dataMode, setDataMode] = useState<DataMode>("oi-vol");
  const [showOI, setShowOI] = useState(false);
  const [showDex, setShowDex] = useState(false);
  const [showFlipCurve, setShowFlipCurve] = useState(false);
  const [showGhost5, setShowGhost5] = useState(false);
  const [showGhost15, setShowGhost15] = useState(false);
  const [showGhost30, setShowGhost30] = useState(false);

  // Screenshot target: the canvas box only, not the toolbar above it.
  const chartRef = useRef<HTMLDivElement>(null);

  /**
   * The picker's value.
   *
   * The feed is the source of truth, but SET_EXPIRY takes a round trip, so a
   * click would otherwise snap back to the old date for a second and read as
   * "the button didn't work". `pending` holds the user's choice until the feed
   * confirms it (or the server answers with a different date, which then wins).
   */
  const [pending, setPending] = useState<string | null>(null);
  const selectedExpiry = pending ?? expiry;
  useEffect(() => {
    if (pending && expiry && expiry === pending) setPending(null);
  }, [pending, expiry]);

  const handleExpiry = useCallback((next: string) => {
    setPending(next);
    // Queued automatically if the socket isn't OPEN yet — see sendGex.
    sendGex({ type: "SET_EXPIRY", expiry: next });
  }, []);

  // No client-side chain fetch to redo: the server owns the rows. Re-asserting
  // the expiry is what actually makes it push a fresh frame.
  const handleRefresh = useCallback(async () => {
    if (selectedExpiry) sendGex({ type: "SET_EXPIRY", expiry: selectedExpiry });
  }, [selectedExpiry]);

  const expiryValues = useMemo(() => usableExpirations(expirations), [expirations]);

  // Basis-aware, exactly like /home: the profile has to be computed on the mode
  // the bars are drawn on or the flip curve disagrees with the chart under it.
  const profile = useMemo(
    () => (chain.length ? computeGEXProfile(chain, spot, dataMode) : null),
    [chain, spot, dataMode],
  );

  // Ghost baselines are only fetched while a ghost is actually on — passing ""
  // for the expiry is the hook's own "don't poll" signal.
  const anyGhost = showGhost5 || showGhost15 || showGhost30;
  const baselines = useStrikeGexHistory(anyGhost ? selectedExpiry : "", GHOST_AGES, 30_000, true);

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      minHeight: 0, minWidth: 0, overflow: "hidden",
      background: BOARD_THEME.card,
      border: `1px solid ${BOARD_THEME.line}`,
      borderRadius: 14,
    }}>
      {/* Scales down instead of scrolling, so the full control set stays
          reachable in a tile narrower than the /home column. */}
      <FitScale min={0.42}>
        <GexToolbar
          gexMode={gexMode}
          dataMode={dataMode}
          showOI={showOI}
          showDex={showDex}
          showFlipCurve={showFlipCurve}
          expirations={expiryValues}
          selectedExpiry={selectedExpiry}
          onExpiry={handleExpiry}
          onGexMode={setGexMode}
          onDataMode={setDataMode}
          showGhost5={showGhost5}
          showGhost15={showGhost15}
          showGhost30={showGhost30}
          onToggleOI={() => setShowOI((v) => !v)}
          onToggleDex={() => setShowDex((v) => !v)}
          onToggleFlip={() => setShowFlipCurve((v) => !v)}
          onToggleGhost5={() => { setShowGhost5((v) => !v); setShowGhost15(false); setShowGhost30(false); }}
          onToggleGhost15={() => { setShowGhost15((v) => !v); setShowGhost5(false); setShowGhost30(false); }}
          onToggleGhost30={() => { setShowGhost30((v) => !v); setShowGhost5(false); setShowGhost15(false); }}
          onRefresh={handleRefresh}
          containerRef={chartRef}
          discordMessage={`NET GEX • ${selectedExpiry}`}
        />
      </FitScale>

      {/* Same box /home gives the canvas: a flex child with a resolved height,
          NOT itself a flex container — GexChart's root is height:100% and needs
          a definite parent height to measure against. */}
      <div
        ref={chartRef}
        style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative", overflow: "hidden" }}
      >
        {chain.length ? (
          <GexChart
            chain={chain}
            spotPrice={spot}
            flipPoint={flip}
            gexProfile={profile}
            mode={gexMode}
            dataMode={dataMode}
            showOI={showOI}
            showDex={showDex}
            showFlipCurve={showFlipCurve}
            baselines={baselines}
            showGhost5={showGhost5}
            showGhost15={showGhost15}
            showGhost30={showGhost30}
            expiry={selectedExpiry}
            transparentBg
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            <Waiting what="gex rows" />
          </div>
        )}
      </div>
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
