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
 * DATA — ONE SUBSCRIPTION FOR THE WHOLE PAGE
 * ------------------------------------------
 * `useBoardFeed` opens exactly one `subscribeGex` (the shared refcounted
 * /ws/gex) and fans the parsed frames out to every card through context. Cards
 * do NOT subscribe individually — nine cards each calling subscribeGex would
 * each re-parse the same ~100KB gex frame.
 *
 * Deliberate non-goals, so the next person doesn't go looking:
 *   - It does NOT send SET_EXPIRY. That command is per-CONNECTION on a socket
 *     the whole tab shares, so pinning an expiry here would silently retarget
 *     the toolbar and any other mounted consumer. The board shows whatever
 *     expiry the feed is on and labels it.
 *   - There is no ES candle card. The real ES chart (hooks/useEsCandles) is a
 *     large stateful hook with its own topic set and lightweight-charts mount;
 *     wrapping it in a resizable tile is its own change. The Gamma Profile card
 *     covers the "chart" slot with math the page already has client-side.
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
import { useEconCalendar } from "@/hooks/useEconCalendar";
import { useEmLookup, emNumber } from "@/hooks/useEmLookup";
import { isStale } from "@/lib/econCalendar";
import type { FlowOrder } from "@/hooks/useSpxFlow";
import {
  computeGEXProfile, findGEXFlip, netGEXOf, formatGEX, formatStrike,
  type ChainRow, type GEXProfile,
} from "@/lib/calculations/calculations";

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
 * `flow` is here for the Whale Flow card. It stays in the list even when that
 * card is removed from the board — the value keys the subscription effect, and
 * making it depend on the card set would reconnect the socket (clearing the
 * replay cache) every time someone adds or drops a card.
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
  label: string;
  title?: string;
  subtitle?: string;
  body: () => ReactNode;
  w: number;
  h: number;
  padding?: number;
  singleton?: boolean;
};

const CARD_TYPES: Record<string, CardDef> = {
  stats: {
    label: "Overview tiles",
    singleton: true,
    body: () => <StatsBody />,
    w: 12, h: 3, padding: 0,
  },
  gexbars: {
    label: "GEX by strike",
    title: "GEX by Strike",
    subtitle: "net gamma exposure",
    body: () => <GexBarsBody />,
    w: 5, h: 9,
  },
  levels: {
    label: "Key levels",
    title: "Key Levels",
    body: () => <LevelsBody />,
    w: 5, h: 7,
  },
  profile: {
    label: "Gamma profile",
    title: "Gamma Profile",
    subtitle: "$B per 1% move, by spot",
    body: () => <ProfileBody />,
    w: 7, h: 9,
  },
  chain: {
    label: "Options chain",
    title: "Options Chain",
    body: () => <ChainBody />,
    w: 7, h: 11,
  },
  flow: {
    label: "Whale flow",
    title: "Whale Flow",
    subtitle: "largest premium on the tape",
    body: () => <FlowBody />,
    w: 5, h: 9,
  },
  em: {
    label: "Estimated moves",
    title: "Estimated Moves",
    subtitle: "published EM levels",
    body: () => <EmBody />,
    w: 5, h: 8,
  },
  econ: {
    label: "Economic calendar",
    title: "Economic Calendar",
    body: () => <EconBody />,
    w: 7, h: 8,
  },
  health: {
    label: "Feed health",
    title: "Feed Health",
    subtitle: "/ws/gex · topic-scoped",
    body: () => <HealthBody />,
    w: 5, h: 7,
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
  { id: "stats#1",   x: 0, y: 0,  w: 12, h: 3 },
  { id: "gexbars#1", x: 0, y: 3,  w: 5,  h: 9 },
  { id: "profile#1", x: 5, y: 3,  w: 7,  h: 9 },
  { id: "levels#1",  x: 0, y: 12, w: 5,  h: 7 },
  { id: "chain#1",   x: 5, y: 12, w: 7,  h: 11 },
  { id: "flow#1",    x: 0, y: 19, w: 5,  h: 9 },
  { id: "econ#1",    x: 5, y: 23, w: 7,  h: 8 },
  { id: "health#1",  x: 0, y: 28, w: 5,  h: 7 },
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
  padding = 14,
  onRemove,
  children,
}: {
  "data-grid-id": string;
  title?: string;
  subtitle?: string;
  editing: boolean;
  padding?: number;
  onRemove?: (id: string) => void;
  children: ReactNode;
}) {
  const showHeader = title != null || editing;

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
            {editing && (
              <span aria-hidden title="Drag to move"
                style={{ fontSize: 12, lineHeight: 1, letterSpacing: 1, color: BOARD_THEME.cyan, opacity: 0.8 }}>
                ⠿
              </span>
            )}
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
            {editing && onRemove && (
              // Inside the drag handle — DashGrid's "ignore interactive elements"
              // check is what stops this click from starting a drag.
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
            )}
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

/** The N strikes nearest spot, in strike order — what every strike view wants. */
function nearSpot(chain: ChainRow[], spot: number, n: number): ChainRow[] {
  if (!chain.length) return [];
  if (spot <= 0) return [...chain].sort((a, b) => a.strike - b.strike).slice(0, n);
  return [...chain]
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, n)
    .sort((a, b) => a.strike - b.strike);
}

function GexBarsBody() {
  const { chain, spot } = useFeed();
  const rows = useMemo(() => nearSpot(chain, spot, 22), [chain, spot]);

  if (!rows.length) return <Waiting what="gex rows" />;

  const vals = rows.map((r) => netGEXOf(r, "net", spot));
  const max = Math.max(...vals.map(Math.abs), 1);
  const W = 300, H = 140, MID = H / 2;
  const gap = 2;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  // Nearest bar to spot, for the dashed marker.
  const spotIdx = rows.reduce(
    (best, r, i) => (Math.abs(r.strike - spot) < Math.abs(rows[best].strike - spot) ? i : best), 0);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none"
           style={{ flex: 1, minHeight: 0 }}>
        <line x1={0} y1={MID} x2={W} y2={MID} stroke={BOARD_THEME.line} strokeWidth={1} />
        {rows.map((r, i) => {
          const v = vals[i];
          const h = (Math.abs(v) / max) * (MID - 6);
          return (
            <rect
              key={r.strike}
              x={i * (bw + gap)}
              y={v > 0 ? MID - h : MID}
              width={bw}
              height={Math.max(h, 1)}
              rx={2}
              fill={v > 0 ? BOARD_THEME.cyan : BOARD_THEME.red}
              opacity={0.9}
            />
          );
        })}
        {spot > 0 && (
          <line
            x1={spotIdx * (bw + gap) + bw / 2} y1={0}
            x2={spotIdx * (bw + gap) + bw / 2} y2={H}
            stroke={BOARD_THEME.yellow} strokeWidth={1} strokeDasharray="3 3" opacity={0.75}
          />
        )}
      </svg>
      <div style={{
        display: "flex", justifyContent: "space-between", fontSize: 8.5,
        color: BOARD_THEME.text3, marginTop: 4, flexShrink: 0,
      }}>
        <span>{formatStrike(rows[0].strike)}</span>
        <span>{formatStrike(rows[rows.length - 1].strike)}</span>
      </div>
    </div>
  );
}

function LevelsBody() {
  const { chain, spot, callWall, putWall, flip } = useFeed();

  // Core Bullseye = the strike carrying the most absolute gamma. Computed from
  // the rows on screen, same basis as the bars above it.
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
function ProfileBody() {
  const { profile, spot } = useFeed();
  if (!profile || profile.levels.length < 2) return <Waiting what="a gamma profile" />;

  const { levels, values } = profile;
  const W = 400, H = 220, PAD = 6;
  const xMin = levels[0], xMax = levels[levels.length - 1];
  const vMax = Math.max(...values.map(Math.abs), 1e-9);
  const x = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * W;
  const y = (v: number) => PAD + (0.5 - v / (2 * vMax)) * (H - PAD * 2);

  const d = levels.map((lv, i) => `${i === 0 ? "M" : "L"}${x(lv).toFixed(1)},${y(values[i]).toFixed(1)}`).join(" ");
  const zeroY = y(0);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="none"
           style={{ flex: 1, minHeight: 0 }}>
        <path d={`${d} L${W},${zeroY} L0,${zeroY} Z`} fill={tint(BOARD_THEME.cyan, 0.1)} />
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke={BOARD_THEME.line} strokeWidth={1} />
        <path d={d} fill="none" stroke={BOARD_THEME.cyan} strokeWidth={1.8} strokeLinejoin="round" />
        {spot > 0 && spot >= xMin && spot <= xMax && (
          <line x1={x(spot)} y1={0} x2={x(spot)} y2={H}
                stroke={BOARD_THEME.yellow} strokeWidth={1} strokeDasharray="3 3" opacity={0.8} />
        )}
        {profile.flipPoint != null && profile.flipPoint >= xMin && profile.flipPoint <= xMax && (
          <line x1={x(profile.flipPoint)} y1={0} x2={x(profile.flipPoint)} y2={H}
                stroke={BOARD_THEME.purple} strokeWidth={1} strokeDasharray="2 4" opacity={0.9} />
        )}
      </svg>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 9, color: BOARD_THEME.text3, marginTop: 5, flexShrink: 0, gap: 8,
      }}>
        <span>{formatStrike(xMin)}</span>
        <span style={{ color: BOARD_THEME.purple }}>
          flip {profile.flipPoint != null ? formatStrike(profile.flipPoint) : "—"}
        </span>
        <span>{formatStrike(xMax)}</span>
      </div>
    </div>
  );
}

function ChainBody() {
  const { chain, spot, expiry } = useFeed();
  const rows = useMemo(() => nearSpot(chain, spot, 24), [chain, spot]);
  if (!rows.length) return <Waiting what="the chain" />;

  const atm = rows.reduce(
    (best, r, i) => (Math.abs(r.strike - spot) < Math.abs(rows[best].strike - spot) ? i : best), 0);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {expiry && (
        <div style={{ fontSize: 9.5, color: BOARD_THEME.text3, marginBottom: 4 }}>expiry {expiry}</div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
        <thead>
          <tr>
            <th style={thStyle}>Strike</th>
            <th style={thStyle}>Call OI</th>
            <th style={thStyle}>Call Vol</th>
            <th style={thStyle}>Net GEX</th>
            <th style={thStyle}>Put Vol</th>
            <th style={thStyle}>Put OI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const net = netGEXOf(r, "net", spot);
            return (
              <tr key={r.strike} style={i === atm ? { background: BOARD_THEME.card2 } : undefined}>
                <td style={{ ...tdStyle, color: BOARD_THEME.text, fontWeight: 600 }}>
                  {formatStrike(r.strike)}
                </td>
                <td style={tdStyle}>{Math.round(r.callOI ?? 0).toLocaleString()}</td>
                <td style={tdStyle}>{Math.round(r.callVolume ?? 0).toLocaleString()}</td>
                <td style={{ ...tdStyle, color: net >= 0 ? BOARD_THEME.cyan : BOARD_THEME.red }}>
                  {formatGEX(net)}
                </td>
                <td style={tdStyle}>{Math.round(r.putVolume ?? 0).toLocaleString()}</td>
                <td style={tdStyle}>{Math.round(r.putOI ?? 0).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const fmtPrem = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`;

function FlowBody() {
  const { tape } = useFeed();
  // Biggest premium first — the tape arrives oldest-first and unsorted by size.
  const top = useMemo(
    () => [...tape].sort((a, b) => (b.premium || 0) - (a.premium || 0)).slice(0, 14),
    [tape],
  );
  if (!top.length) return <Waiting what="the flow tape" />;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {top.map((o, i) => {
        const call = o.type === "C";
        const color = call ? BOARD_THEME.green : BOARD_THEME.red;
        return (
          <div key={`${o.ts}-${o.symbol}-${i}`} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "7px 2px",
            borderBottom: i === top.length - 1 ? "none" : `1px solid ${BOARD_THEME.line2}`,
          }}>
            <div style={{
              width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center",
              fontSize: 9.5, fontWeight: 800, flexShrink: 0,
              background: tint(color, 0.15), color,
            }}>
              {o.type}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: BOARD_THEME.text,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {o.underlying ?? o.symbol} {formatStrike(o.strike)}{o.type}
              </div>
              <div style={{ fontSize: 9.5, color: BOARD_THEME.text3, marginTop: 1 }}>
                {new Date(o.ts).toLocaleTimeString("en-US", { hour12: false, timeZone: "America/New_York" })}
                {" · "}{o.side}{o.expiration ? ` · ${o.expiration}` : ""}
                {o.size ? ` · ${o.size.toLocaleString()}x` : ""}
              </div>
            </div>
            <Chip color={color}>{fmtPrem(o.premium || 0)}</Chip>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Published EM levels for SPX. `useEmLookup` is the SAME hook the /em page uses
 * — the lookup fires once on mount, and only while this card is on the board.
 */
function EmBody() {
  const em = useEmLookup();
  const { lookup } = em;
  const { spot } = useFeed();

  useEffect(() => { void lookup("SPX"); }, [lookup]);

  if (em.loading && !em.data) return <Waiting what="EM levels" />;
  if (em.error) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: BOARD_THEME.text3, padding: 12, textAlign: "center" }}>
        {em.error}
      </div>
    );
  }
  if (!em.data) return <Waiting what="EM levels" />;

  const emVal = emNumber(em.data.em);
  const close = emNumber(em.data.close);
  const pct = emVal != null && close ? (emVal / close) * 100 : null;

  const rows: { label: string; value: number | null; color: string }[] = [
    { label: "Upper", value: emNumber(em.data.up), color: BOARD_THEME.green },
    { label: "Pivot", value: emNumber(em.data.pivot), color: BOARD_THEME.text2 },
    { label: "Lower", value: emNumber(em.data.down), color: BOARD_THEME.red },
    { label: "Sell zone (near)", value: emNumber(em.data.sell_near), color: BOARD_THEME.orange },
    { label: "Buy zone (near)", value: emNumber(em.data.buy_near), color: BOARD_THEME.blue },
  ];

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {emVal != null ? `±${emVal.toFixed(2)}` : "—"}
        </span>
        {pct != null && <span style={{ fontSize: 11, color: BOARD_THEME.text3 }}>({pct.toFixed(2)}%)</span>}
        {em.data.exp_label && <Chip color={BOARD_THEME.cyan}>{em.data.exp_label}</Chip>}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, i) => (
          <div key={r.label} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 2px", fontSize: 11,
            borderBottom: i === rows.length - 1 ? "none" : `1px solid ${BOARD_THEME.line2}`,
          }}>
            <span style={{ color: BOARD_THEME.text2 }}>{r.label}</span>
            <span style={{ color: r.color, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
              {r.value != null ? formatStrike(r.value) : "—"}
              {r.value != null && spot > 0 && (
                <span style={{ color: BOARD_THEME.text3, fontWeight: 400 }}>
                  {" "}({r.value > spot ? "+" : ""}{Math.round(r.value - spot)})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const IMPACT_COLOR: Record<string, string> = {
  High: BOARD_THEME.red,
  Medium: BOARD_THEME.orange,
  Low: BOARD_THEME.yellow,
  Holiday: BOARD_THEME.text3,
  President: BOARD_THEME.purple,
};

function EconBody() {
  const cal = useEconCalendar();
  // `cal.now` ticks once a minute; deriving the ET date FROM it is what rolls
  // the card over at midnight ET rather than at the device's midnight.
  const today = useMemo(
    () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(cal.now)),
    [cal.now],
  );

  const todays = useMemo(
    () => cal.events.filter((e) => e.date === today).slice(0, 12),
    [cal.events, today],
  );

  if (cal.loading && !cal.events.length) return <Waiting what="the calendar" />;
  if (!todays.length) {
    return (
      <div style={{ flex: 1, display: "grid", placeItems: "center", fontSize: 11, color: BOARD_THEME.text3, textAlign: "center", padding: 12 }}>
        {cal.source === "unavailable" ? "calendar feed unavailable" : "no US events scheduled today"}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
        <thead>
          <tr>
            <th style={thStyle}>Time</th>
            <th style={thStyle}>Event</th>
            <th style={thStyle}>Impact</th>
            <th style={thStyle}>Fcst</th>
            <th style={thStyle}>Prev</th>
            <th style={thStyle}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {todays.map((e, i) => (
            <tr key={`${e.time}-${e.title}-${i}`} style={{ opacity: isStale(e, cal.now) ? 0.45 : 1 }}>
              <td style={tdStyle}>{e.time_formatted || e.time || "—"}</td>
              <td style={{ ...tdStyle, color: BOARD_THEME.text, fontWeight: 600, whiteSpace: "normal" }}>
                {e.title}
              </td>
              <td style={tdStyle}>
                <Chip color={IMPACT_COLOR[e.impact] ?? BOARD_THEME.text3}>{e.impact || "—"}</Chip>
              </td>
              <td style={tdStyle}>{e.forecast || "—"}</td>
              <td style={tdStyle}>{e.previous || "—"}</td>
              <td style={{ ...tdStyle, color: e.actual ? BOARD_THEME.text : BOARD_THEME.text3 }}>
                {e.actual || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cal.warning && (
        <div style={{ fontSize: 9.5, color: BOARD_THEME.orange, marginTop: 6 }}>{cal.warning}</div>
      )}
    </div>
  );
}

/**
 * Feed Health — what this page actually asked the socket for, and when each of
 * those frame types last arrived. The point is diagnosing a silently-stale card
 * (the classic symptom of a missing topic).
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
