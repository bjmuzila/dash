"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useEsBigTrades } from "@/hooks/useEsBigTrades";
import { findGEXFlip, type ChainRow } from "@/lib/calculations/calculations";
import { BoxSnapBtn, BoxDiscordBtn } from "@/components/shared/DataBox";


function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// One painted heatmap cell: a strike bucket at a given 5-min slot.
type GexCell = { strike: number; net: number };
type GexColumn = { slotTs: number; cells: GexCell[]; max: number; top3: number[] };

// 5-min-binned big-trade bubble (price = ES price, signed = net of merged prints).
type Bubble = {
  slotTs: number; price: number; size: number; side: "buy" | "sell";
  buy: number; sell: number; total: number; net: number;
};
// 5-min net delta bar.
type DeltaBar = { slotTs: number; net: number };

// Volume-by-price profile + value-area levels, derived from candle OHLCV.
type ProfileBin = { price: number; volume: number };
type VolumeProfile = {
  bins: ProfileBin[];      // ascending by price
  maxVol: number;
  poc: number | null;      // point of control (max-volume price)
  vah: number | null;      // value area high
  val: number | null;      // value area low
  lvn: number | null;      // most significant low-volume node inside the range
};

/** Minutes-since-ET-midnight for a slot timestamp. */
function etMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const m: Record<string, string> = {};
  parts.forEach((p) => { m[p.type] = p.value; });
  return Number(m.hour) * 60 + Number(m.minute);
}

/** True if a slot ms timestamp falls in the RTH window (9:30–16:00 ET). */
function isRthSlot(ts: number): boolean {
  const mins = etMinutes(ts);
  return mins >= 570 && mins < 960; // 9:30 = 570, 16:00 = 960
}

/**
 * Bubble scaling group. The 3:45–4:15 ET close (945–975) carries blowout
 * auction volume that would otherwise crush the rest of the RTH session's
 * scaling, so it gets its OWN group.
 *   eod = 15:45–16:15 ET, rth = 9:30–16:00 (excluding eod), ovn = everything else
 */
function bubbleSession(ts: number): "eod" | "rth" | "ovn" {
  const mins = etMinutes(ts);
  if (mins >= 945 && mins < 975) return "eod"; // 15:45 = 945, 16:15 = 975
  if (mins >= 570 && mins < 960) return "rth";
  return "ovn";
}

/**
 * Build a session volume profile from candle OHLCV. Tick volume isn't available
 * per price, so each candle's volume is spread evenly across the price bins its
 * [low, high] range touches (standard candle-based profile approximation).
 * Value area = the contiguous 70% of volume around the POC.
 */
function buildVolumeProfile(
  candles: Array<{ high: number; low: number; close: number; open: number; volume: number }>,
  binSize: number
): VolumeProfile {
  const empty: VolumeProfile = { bins: [], maxVol: 0, poc: null, vah: null, val: null, lvn: null };
  if (!candles.length || !(binSize > 0)) return empty;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!(hi > lo)) return empty;

  const floorBin = (p: number) => Math.floor(p / binSize) * binSize;
  const vol = new Map<number, number>();
  for (const c of candles) {
    const b0 = floorBin(c.low), b1 = floorBin(c.high);
    const n = Math.max(1, Math.round((b1 - b0) / binSize) + 1);
    const per = (c.volume || 0) / n;
    for (let b = b0; b <= b1 + 1e-9; b += binSize) vol.set(b, (vol.get(b) ?? 0) + per);
  }
  const bins: ProfileBin[] = [...vol.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bins.length) return empty;

  let pocIdx = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i].volume > bins[pocIdx].volume) pocIdx = i;
  const total = bins.reduce((s, b) => s + b.volume, 0);
  const target = total * 0.7;

  // Expand around the POC until 70% of volume is captured (value area).
  let loI = pocIdx, hiI = pocIdx, acc = bins[pocIdx].volume;
  while (acc < target && (loI > 0 || hiI < bins.length - 1)) {
    const below = loI > 0 ? bins[loI - 1].volume : -1;
    const above = hiI < bins.length - 1 ? bins[hiI + 1].volume : -1;
    if (above >= below) { hiI++; acc += Math.max(0, above); }
    else { loI--; acc += Math.max(0, below); }
  }

  // LVN: lowest-volume bin inside the traded range (local minimum), excluding edges.
  let lvnIdx = -1;
  for (let i = 1; i < bins.length - 1; i++) {
    if (bins[i].volume < bins[i - 1].volume && bins[i].volume < bins[i + 1].volume) {
      if (lvnIdx < 0 || bins[i].volume < bins[lvnIdx].volume) lvnIdx = i;
    }
  }

  return {
    bins,
    maxVol: bins[pocIdx].volume,
    poc: bins[pocIdx].price,
    vah: bins[hiI].price,
    val: bins[loI].price,
    lvn: lvnIdx >= 0 ? bins[lvnIdx].price : null,
  };
}

// Floor a ms timestamp to its 5-minute ET slot, returned as a UTC ms boundary
// aligned to the candle grid (candles use raw ms flooring of /ES bars).
function slotFloorMs(ts: number): number {
  return Math.floor(ts / 300_000) * 300_000;
}

/**
 * Exact port of the GEX heatmap's metricBg() → returns an rgba string.
 * Positive GEX = cyan (41,182,246), negative = red (255,71,87). The 3 largest
 * magnitudes get rank floors so the dominant walls always stand out; everything
 * else follows a power curve scaled by `intensity`.
 */
function gexColor(value: number, maxValue: number, intensity: number, top3: number[]): string | null {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return null;
  const pos = n >= 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(3)})` : `rgba(255,71,87,${alpha.toFixed(3)})`;
}

export default function EsCandlesPage() {
  usePageLoadStatus({ pageKey: "es-candles", pageLabel: "ES Candles", path: "/es-candles" });

  // Single source of truth: SQL load (today + ~20d history) + live /ws/gex merge.
  const { candles: rows, connected, refresh } = useEsCandles();

  const chartRef = useRef<HTMLDivElement>(null);
  // Capture target for the Snap / Discord buttons (chart + lanes panel).
  const captureRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const spxSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const didFitRef = useRef(false);

  // Heatmap overlay state.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  // Bottom lane canvases (bubbles + delta), x-aligned to the chart time axis.
  const bubbleLaneRef = useRef<HTMLCanvasElement>(null);
  const deltaLaneRef = useRef<HTMLCanvasElement>(null);
  // Bubble hover tooltip state (the bubble under the cursor + its lane x/y).
  const [bubbleHover, setBubbleHover] = useState<{ x: number; y: number; b: Bubble } | null>(null);
  const drawLanesRef = useRef<() => void>(() => {});
  // Today's MVC history: raw SPX strikeOIVol per snapshot. Converted to ES at
  // DRAW time using the live ESU basis (same as the other levels), so the line
  // tracks the current /ESU price — not the stale per-row esPrice.
  const [mvcHistory, setMvcHistory] = useState<Array<{ ts: number; spx: number }>>([]);
  const [showMvcLine, setShowMvcLine] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [intensity, setIntensity] = useState(0.5); // matches the home heatmap slider default
  // Column history keyed by 5-min slot ms. One column per slot; latest slot is
  // updated in place as fresh gex messages arrive within the same 5-min window.
  const columnsRef = useRef<Map<number, GexColumn>>(new Map());
  // Imperative redraw hook set up by the overlay effect; apply() calls it when a
  // new gex snapshot lands so in-place column updates repaint immediately.
  const drawOverlayRef = useRef<() => void>(() => {});
  // Basis (esFut - spx) kept in a ref so the overlay draw reads it without
  // re-subscribing. Updated by the WS listener.
  const basisRef = useRef(0);
  // Front expiry from the live feed; drives the one-time history backfill.
  const [feedExpiry, setFeedExpiry] = useState<string>("");
  // Expirations offered by the feed + the one the heatmap history is showing.
  // Empty selectedExpiry = follow the live front expiry.
  const [expirations, setExpirations] = useState<string[]>([]);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  // Mirror in a ref so the WS handler can decide whether to ingest live columns
  // (only when showing the front expiry — a non-front pick is history-only).
  const selectedExpiryRef = useRef("");
  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  const [dteOpen, setDteOpen] = useState(false);
  const dteBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dteOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (dteBoxRef.current && !dteBoxRef.current.contains(e.target as Node)) setDteOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dteOpen]);

  // DTE relative to today ET (today's expiry = 0DTE, not −1).
  const dteOf = (exp: string): number => {
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    return Math.round((Date.parse(exp + "T00:00:00Z") - Date.parse(todayEt + "T00:00:00Z")) / 86_400_000);
  };

  // Big trades + per-minute delta from the same /ws/gex feed (footprint source).
  const { trades: rawTrades, delta: rawDelta } = useEsBigTrades();
  const [showBubbles, setShowBubbles] = useState(true);
  const [showDelta, setShowDelta] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showLevels, setShowLevels] = useState(false);  // Call/Put/Flip/MVC dashed lines + MVC step line
  const [showSessions, setShowSessions] = useState(false); // prior-day + overnight H/L
  // Bubble size metric: "total" = all volume in the slot, "net" = |buy − sell|.
  const [bubbleMetric, setBubbleMetric] = useState<"total" | "net">("net");

  // Prior-day H/L and overnight H/L from the candle history (ES prices).
  //
  // Overnight = the MOST RECENT completed-or-forming session from one 16:00 ET
  // close to the next 9:30 ET open:
  //   • before 9:30 today        → overnight still building (prior 16:00 → now)
  //   • between 9:30 and 16:00    → overnight FROZEN (prior 16:00 → today 9:30)
  //   • after 16:00 today         → a NEW overnight starts (today 16:00 → now)
  // So ONH/ONL update through the overnight, lock at the 9:30 open, and reset at
  // the next 16:00 close. Depends on `rows` AND a 60s clock so it rolls forward.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setClockTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const sessionLevels = useMemo(() => {
    if (!rows.length) return null;
    void clockTick; // re-evaluate on the clock so the window rolls forward
    const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));

    // Build the ms boundaries for "today" in ET from the current time.
    const now = Date.now();
    const nowMin = etMinutes(now);
    // Midnight-ET ms for a given timestamp (floor to the ET day).
    const etMidnight = (ts: number) => ts - etMinutes(ts) * 60_000 - (new Date(ts).getSeconds() * 1000 + new Date(ts).getMilliseconds());
    const todayMid = etMidnight(now);
    const open0930 = todayMid + 570 * 60_000;
    const close1600 = todayMid + 960 * 60_000;

    // Overnight window [start, end).
    let onStart: number, onEnd: number;
    if (nowMin >= 960) { onStart = close1600; onEnd = now; }          // after close → new O/N
    else if (nowMin >= 570) { onStart = close1600 - 86_400_000; onEnd = open0930; } // RTH → frozen
    else { onStart = close1600 - 86_400_000; onEnd = now; }            // pre-open → building

    // Prior day = the most recent ET day strictly before today.
    const today = dayKey(now);
    const days = [...new Set(rows.map((r) => r.date || dayKey(r.timestamp)))].sort();
    const prevDay = days.filter((d) => d < today).pop();

    let pdh = -Infinity, pdl = Infinity, onh = -Infinity, onl = Infinity;
    for (const r of rows) {
      const d = r.date || dayKey(r.timestamp);
      if (prevDay && d === prevDay) { if (r.high > pdh) pdh = r.high; if (r.low < pdl) pdl = r.low; }
      if (r.timestamp >= onStart && r.timestamp < onEnd) { if (r.high > onh) onh = r.high; if (r.low < onl) onl = r.low; }
    }
    return {
      pdh: Number.isFinite(pdh) ? pdh : null,
      pdl: Number.isFinite(pdl) ? pdl : null,
      onh: Number.isFinite(onh) ? onh : null,
      onl: Number.isFinite(onl) ? onl : null,
    };
  }, [rows, clockTick]);

  // Session volume profile from today's candles (ES price). 1-pt bins.
  const profile = useMemo(() => {
    const today = rows.length ? rows[rows.length - 1].date : "";
    const todays = today ? rows.filter((r) => r.date === today) : rows;
    return buildVolumeProfile(todays, 1);
  }, [rows]);

  // ONE bubble per 5-min slot. side = dominant AGGRESSOR (more buy vs sell vol),
  // size = that dominant side's volume — so a heavy sell slot stays a big red
  // bubble even when net delta is near zero (late sellers being absorbed).
  const bubbles = useMemo<Bubble[]>(() => {
    const bySlot = new Map<number, { buy: number; sell: number; pxVol: number; vol: number }>();
    for (const t of rawTrades) {
      if (!(t.size > 0) || !(t.price > 0)) continue;
      const slotTs = slotFloorMs(t.ts);
      const agg = bySlot.get(slotTs) ?? { buy: 0, sell: 0, pxVol: 0, vol: 0 };
      if (t.side === "buy") agg.buy += t.size; else agg.sell += t.size;
      agg.pxVol += t.price * t.size;
      agg.vol += t.size;
      bySlot.set(slotTs, agg);
    }
    return [...bySlot.entries()].map(([slotTs, a]) => {
      const buyDom = a.buy >= a.sell;
      return {
        slotTs,
        price: a.vol > 0 ? a.pxVol / a.vol : 0,
        size: buyDom ? a.buy : a.sell, // dominant aggressor volume
        side: (buyDom ? "buy" : "sell") as "buy" | "sell",
        buy: a.buy, sell: a.sell, total: a.vol, net: a.buy - a.sell,
      };
    });
  }, [rawTrades]);

  // Bin per-minute delta into 5-min net bars.
  const deltaBars = useMemo<DeltaBar[]>(() => {
    const bySlot = new Map<number, number>();
    for (const d of rawDelta) {
      const slotTs = slotFloorMs(d.ts);
      bySlot.set(slotTs, (bySlot.get(slotTs) ?? 0) + Number(d.net || 0));
    }
    return [...bySlot.entries()].map(([slotTs, net]) => ({ slotTs, net }));
  }, [rawDelta]);

  // Repaint the bubble/delta lanes whenever the binned data changes.
  useEffect(() => { drawLanesRef.current(); }, [bubbles, deltaBars]);

  // GEX levels from /ws/gex. callWall/putWall/gexFlip are SPX-point values; the
  // chart plots ES, so we offset by the live basis (esFut - spx) before drawing.
  // mvc is plumbed but disabled for now (lives in mvc_snapshots, not the feed).
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    gexFlip: number | null;
    mvc: number | null;
    spx: number | null;
    esFut: number | null;
  }>({ callWall: null, putWall: null, gexFlip: null, mvc: null, spx: null, esFut: null });

  const status = connected ? "live" : "offline";

  // Listen to /ws/gex for the GEX levels + ES basis inputs.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
      const spx = Number(d.spot ?? 0);
      const esFut = Number(d.esFut ?? 0);
      const exp = typeof d.expiry === "string" ? d.expiry : "";
      if (exp) setFeedExpiry((cur) => cur || exp);
      if (Array.isArray(d.expirations) && d.expirations.length) {
        setExpirations(d.expirations.map(String));
      }
      // gexFlip isn't sent by the feed — compute it from gexRows like the home
      // page does (zero-crossing of the net-GEX profile nearest spot).
      let computedFlip: number | null = null;
      if (Array.isArray(d.gexRows) && d.gexRows.length) {
        computedFlip = findGEXFlip(d.gexRows as ChainRow[], spx > 0 ? spx : undefined);
      }
      setLevels((prev) => {
        const nextSpx = spx > 0 ? spx : prev.spx;
        const nextEs = esFut > 0 ? esFut : prev.esFut;
        if (nextSpx != null && nextEs != null) basisRef.current = nextEs - nextSpx;
        return {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall:  d.putWall  != null ? Number(d.putWall)  || null : prev.putWall,
          gexFlip:  computedFlip != null ? computedFlip : (d.gexFlip != null ? Number(d.gexFlip) || null : prev.gexFlip),
          mvc:      prev.mvc,
          spx:      nextSpx,
          esFut:    nextEs,
        };
      });

      // Snapshot per-strike GEX into the current 5-min column.
      const gexRows = d.gexRows;
      // Live gexRows are the FRONT expiry. If the DTE picker is on a different
      // expiry, the heatmap is history-only — don't mix live front columns in.
      const liveExpiry = exp || "";
      const ingestLive = !selectedExpiryRef.current || selectedExpiryRef.current === liveExpiry;
      if (ingestLive && Array.isArray(gexRows) && gexRows.length) {
        const cells: GexCell[] = [];
        for (const r of gexRows as Array<Record<string, unknown>>) {
          const strike = Number(r.strike ?? 0);
          // server-v2 emits `netGEX`; legacy/flat rows use `net_gex`/`netGexVal`.
          const net = Number(r.netGEX ?? r.net_gex ?? r.netGexVal ?? 0);
          if (!(strike > 0) || !Number.isFinite(net)) continue;
          cells.push({ strike, net });
        }
        if (cells.length) {
          const absVals = cells.map((c) => Math.abs(c.net)).filter((v) => v > 0);
          const max = absVals.length ? Math.max(...absVals) : 1;
          const top3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
          const slotTs = slotFloorMs(Date.now());
          const map = columnsRef.current;
          map.set(slotTs, { slotTs, cells, max, top3 });
          // Keep ~2 full days of 5-min slots (a 24h day = 288 slots). The old
          // 200 cap chopped off the morning columns mid-session, making the
          // all-day heatmap vanish from the left.
          if (map.size > 600) {
            const oldest = Math.min(...map.keys());
            map.delete(oldest);
          }
          drawOverlayRef.current(); // repaint with the fresh/updated column
        }
      }
    };

    const handle = (raw: string) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(raw); } catch { return; }
      const type = String(msg.type ?? "");
      const d = (msg.data && typeof msg.data === "object" ? msg.data : msg) as Record<string, unknown>;
      if (type === "snapshot" || type === "gex" || type === "GEX_UPDATE" || type === "spot" || type === "aux") apply(d);
    };

    const connect = () => {
      if (dead) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) { ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch {} }
    };
  }, []);

  // Heatmap history backfill. Effective expiry = the DTE picker selection, or
  // the live front expiry when nothing is picked. Re-runs whenever the picker
  // changes: clears the column map and reloads that expiry's day of history.
  const heatmapExpiry = selectedExpiry || feedExpiry;
  useEffect(() => {
    if (!heatmapExpiry) return;
    let cancelled = false;
    // When the picker changes, wipe the existing columns so we don't mix expiries.
    columnsRef.current.clear();
    drawOverlayRef.current();
    (async () => {
      try {
        const res = await fetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&expiry=${encodeURIComponent(heatmapExpiry)}`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        const cols = Array.isArray(json.columns) ? (json.columns as GexColumn[]) : [];
        if (cancelled || !cols.length) return;
        const map = columnsRef.current;
        for (const col of cols) {
          if (!map.has(col.slotTs)) map.set(col.slotTs, col); // live wins on collisions
        }
        drawOverlayRef.current();
      } catch { /* live feed still populates the front expiry going forward */ }
    })();
    return () => { cancelled = true; };
  }, [heatmapExpiry]);

  // Load today's full MVC history (raw SPX strikeOIVol) and refresh every 60s.
  // ES conversion happens at draw time with the live basis.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/snapshots/mvc?limit=1000`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const rows = Array.isArray(json.rows) ? json.rows : [];
        const pts = rows
          .map((r: Record<string, unknown>) => ({
            ts: Number(r.timestamp ?? 0),
            spx: Number(r.strikeOIVol ?? 0),
          }))
          .filter((p: { ts: number; spx: number }) => p.ts > 0 && p.spx > 0)
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);
        if (cancelled) return;
        setMvcHistory(pts);
        // Latest MVC (SPX points) → the legend chip value.
        const latest = pts.length ? pts[pts.length - 1].spx : 0;
        if (latest > 0) setLevels((prev) => ({ ...prev, mvc: latest }));
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let canceled = false;
    const init = async () => {
      const container = chartRef.current;
      if (!container) return;
      if (canceled) return;

      container.innerHTML = "";
      const chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "rgba(255,255,255,.70)",
          fontFamily: "Inter, system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: "rgba(255,255,255,.06)" },
          horzLines: { color: "rgba(255,255,255,.06)" },
        },
        rightPriceScale: {
          borderColor: "rgba(255,255,255,.10)",
        },
        leftPriceScale: {
          visible: true,
          borderColor: "rgba(255,255,255,.10)",
        },
        timeScale: {
          borderColor: "rgba(255,255,255,.10)",
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { visible: false, labelVisible: false },
          horzLine: { visible: false, labelVisible: false },
        },
        localization: {
          priceFormatter: (price: number) => price.toFixed(2),
          timeFormatter: (time: unknown) => {
            if (typeof time === "number") {
              return new Date(time * 1000).toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
              });
            }
            return "";
          },
        },
      });

      const candleSeries = chart.addSeries(CandlestickSeries, {
        wickUpColor: "#30d158",
        upColor: "#30d158",
        wickDownColor: "#ff5b5b",
        downColor: "#ff5b5b",
        borderVisible: false,
      });
      // Invisible companion CANDLE series bound to the LEFT scale, carrying the
      // same OHLC minus basis (= SPX). Because it's the same series type with the
      // same shape, it autoscales identically to the real candles, so the LEFT
      // (SPX) axis lines up pixel-for-pixel with the RIGHT (ES) axis at any zoom.
      const spxSeries = chart.addSeries(CandlestickSeries, {
        priceScaleId: "left",
        upColor: "rgba(0,0,0,0)",
        downColor: "rgba(0,0,0,0)",
        wickUpColor: "rgba(0,0,0,0)",
        wickDownColor: "rgba(0,0,0,0)",
        borderVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chartApiRef.current = chart;
      candleSeriesRef.current = candleSeries;
      spxSeriesRef.current = spxSeries;

      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      });
      ro.observe(container);
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });

      // Double-click anywhere on the chart → recenter: fit all candles in the
      // time axis and snap both price scales back to autoscale (right axis right).
      const onDblClick = () => {
        chart.timeScale().fitContent();
        chart.priceScale("right").applyOptions({ autoScale: true });
        try { chart.priceScale("left").applyOptions({ autoScale: true }); } catch {}
        drawOverlayRef.current();
      };
      container.addEventListener("dblclick", onDblClick);

      return () => {
        ro.disconnect();
        container.removeEventListener("dblclick", onDblClick);
      };
    };

    let cleanup: void | (() => void);
    void init().then((fn) => { cleanup = fn; });

    return () => {
      canceled = true;
      cleanup?.();
      chartApiRef.current?.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      spxSeriesRef.current = null;
    };
  }, []);

  // Feed the invisible SPX companion candles (OHLC − basis) so the LEFT axis
  // reads SPX, aligned to the candles. Re-runs when candles or basis change.
  useEffect(() => {
    const spx = spxSeriesRef.current;
    if (!spx) return;
    const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
    const data: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open - basis,
      high: row.high - basis,
      low: row.low - basis,
      close: row.close - basis,
    }));
    spx.setData(data);
  }, [rows, levels.esFut, levels.spx]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    const candleData: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));

    candleSeries.setData(candleData);
    // Fit once on first data load only — never re-center on live updates so the
    // user's pan/zoom is preserved.
    if (!didFitRef.current && candleData.length) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
    }
  }, [rows]);

  // Draw GEX level lines (Call Wall / Put Wall / Flip / MVC) on the candle series,
  // converting SPX-point levels to ES via the live basis (esFut - spx).
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    // Clear previous lines.
    for (const pl of priceLinesRef.current) { try { series.removePriceLine(pl); } catch {} }
    priceLinesRef.current = [];

    const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
    const toEs = (spxLevel: number | null) => (spxLevel != null ? spxLevel + basis : null);

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [];

    // GEX levels (Call/Put/Flip/MVC) — toggled by showLevels.
    if (showLevels) {
      defs.push(
        { price: toEs(levels.callWall), color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.putWall),  color: "#ff5b5b", title: "Put Wall",  style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.gexFlip),  color: "#f5c518", title: "Flip",      style: LineStyle.Dashed, width: 1 },
        { price: toEs(levels.mvc),      color: "#4aa3ff", title: "MVC",       style: LineStyle.Dashed, width: 1 },
      );
    }

    // Session levels (prior-day + overnight H/L) — already ES prices, no basis.
    if (showSessions && sessionLevels) {
      defs.push(
        { price: sessionLevels.pdh, color: "#9ca3af", title: "PDH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.pdl, color: "#9ca3af", title: "PDL", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onh, color: "#60a5fa", title: "ONH", style: LineStyle.Dotted, width: 1 },
        { price: sessionLevels.onl, color: "#60a5fa", title: "ONL", style: LineStyle.Dotted, width: 1 },
      );
    }

    for (const d of defs) {
      if (d.price == null || !(d.price > 0)) continue;
      const pl = series.createPriceLine({
        price: d.price,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      });
      priceLinesRef.current.push(pl);
    }
  }, [levels, showLevels, showSessions, sessionLevels]);

  // ── Heatmap canvas overlay ────────────────────────────────────────────────
  // Paints one column per 5-min GEX snapshot. Each cell spans its strike bucket
  // vertically (strike → next strike up, converted SPX→ES) and the 5-min slot
  // horizontally, colored by the exact GEX heatmap gradient.
  useEffect(() => {
    const canvas = overlayRef.current;
    const chart = chartApiRef.current;
    const series = candleSeriesRef.current;
    if (!canvas || !chart || !series) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      const parent = canvas.parentElement;
      if (!ctx || !parent) return;

      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ts = chart.timeScale();
      const basis = basisRef.current;
      const SLOT_MS = 300_000;
      // Slot → [leftX, width] in screen px. Null if the slot isn't on screen.
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = ts.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        const xEndRaw = ts.timeToCoordinate(((slotTs + SLOT_MS) / 1000) as UTCTimestamp);
        if (x0 == null) return null;
        const x1 = xEndRaw != null ? xEndRaw : x0 + 8;
        return { left: Math.min(x0, x1), w: Math.max(2, Math.abs(x1 - x0)) };
      };

      // ── 1) GEX heatmap cells ──
      // Rendered to an offscreen buffer, then composited back through a blur so
      // adjacent strike/time cells melt into smooth bands instead of hard tiles.
      if (showHeatmap) {
        const cols = [...columnsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs);

        // Offscreen buffer at the same CSS size (the main ctx is already DPR-
        // scaled, so we draw in CSS px here too).
        const buf = document.createElement("canvas");
        buf.width = Math.max(1, Math.round(w));
        buf.height = Math.max(1, Math.round(h));
        const bctx = buf.getContext("2d");
        if (bctx) {
          for (const col of cols) {
            const sx = slotX(col.slotTs);
            if (!sx) continue;
            const sorted = [...col.cells].sort((a, b) => a.strike - b.strike);
            for (let i = 0; i < sorted.length; i++) {
              const cell = sorted[i];
              const color = gexColor(cell.net, col.max, intensity, col.top3);
              if (!color) continue;
              const nextStrike = i + 1 < sorted.length ? sorted[i + 1].strike : cell.strike + 5;
              const pTop = series.priceToCoordinate(nextStrike + basis);
              const pBot = series.priceToCoordinate(cell.strike + basis);
              if (pTop == null || pBot == null) continue;
              const top = Math.min(pTop, pBot);
              const cellH = Math.max(1, Math.abs(pBot - pTop));
              bctx.fillStyle = color;
              // Slight bleed (+1px each side) so neighbors overlap before blur.
              bctx.fillRect(sx.left - 0.5, top - 0.5, sx.w + 1, cellH + 1);
            }
          }
          // Composite back at reduced opacity: a soft blurred pass for the
          // blend, then a lighter crisp pass. Kept dim so candles read clearly
          // through it (the heatmap is context, not the foreground).
          ctx.save();
          ctx.globalAlpha = 0.6;
          ctx.filter = "blur(2.5px)";
          ctx.drawImage(buf, 0, 0, w, h);
          ctx.filter = "none";
          ctx.globalAlpha = 0.45;
          ctx.drawImage(buf, 0, 0, w, h); // sharp, dimmed
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }

      // ── 2) Right-edge volume profile + value-area lines ──
      if (showProfile && profile.bins.length) {
        // Anchor bars at the plot-area's right edge — NOT the canvas edge — so
        // they never cover the price axis (the right price-scale gutter).
        let scaleW = 0;
        try { scaleW = chart.priceScale("right").width(); } catch {}
        const plotRight = Math.max(0, w - scaleW - 2);
        const maxProfW = Math.min(220, plotRight * 0.28);
        for (const b of profile.bins) {
          const yTop = series.priceToCoordinate(b.price + 1);
          const yBot = series.priceToCoordinate(b.price);
          if (yTop == null || yBot == null) continue;
          const top = Math.min(yTop, yBot);
          const bh = Math.max(1, Math.abs(yBot - yTop) - 0.5);
          const barW = (b.volume / (profile.maxVol || 1)) * maxProfW;
          const inVA = profile.val != null && profile.vah != null && b.price >= profile.val && b.price <= profile.vah;
          const isPoc = profile.poc != null && Math.abs(b.price - profile.poc) < 0.5;
          ctx.fillStyle = isPoc ? "rgba(245,197,24,.85)" : inVA ? "rgba(245,158,11,.55)" : "rgba(255,255,255,.30)";
          ctx.fillRect(plotRight - barW, top, barW, bh);
        }
        // Value-area level lines + labels.
        const lvl = (price: number | null, color: string, label: string) => {
          if (price == null) return;
          const y = series.priceToCoordinate(price);
          if (y == null) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash(label === "LVN" ? [6, 4] : []);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color;
          ctx.font = "10px Inter, system-ui, sans-serif";
          ctx.fillText(label, 6, y - 3);
        };
        lvl(profile.vah, "rgba(255,255,255,.45)", "VAH");
        lvl(profile.poc, "rgba(245,197,24,.9)", "POC");
        lvl(profile.val, "rgba(255,255,255,.45)", "VAL");
        lvl(profile.lvn, "rgba(245,158,11,.9)", "LVN");
      }

      // ── 3) MVC history as horizontal step segments (no vertical connectors) ──
      // Each constant-value run draws as one flat line from its first timestamp
      // to the change point; when MVC jumps we lift the pen (small gap), then
      // start the next flat segment — so you never see the vertical move.
      if (showLevels && showMvcLine && mvcHistory.length) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.95)"; // MVC — thick white
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        const xOf = (t: number) => ts.timeToCoordinate((Math.floor(t / 1000)) as UTCTimestamp);
        let runStartX: number | null = null;
        let runY: number | null = null;
        let prevX: number | null = null;
        const flush = (endX: number | null) => {
          if (runStartX != null && runY != null && endX != null && endX > runStartX) {
            ctx.beginPath(); ctx.moveTo(runStartX, runY); ctx.lineTo(endX, runY); ctx.stroke();
          }
        };
        for (let i = 0; i < mvcHistory.length; i++) {
          const p = mvcHistory[i];
          const x = xOf(p.ts);
          // Convert SPX MVC level → ES using the live ESU basis (esFut − spx),
          // the same basis the Call/Put/Flip lines use.
          const y = series.priceToCoordinate(p.spx + basis);
          if (x == null || y == null) { flush(prevX); runStartX = null; runY = null; prevX = null; continue; }
          if (runY == null) { runStartX = x; runY = y; }
          else if (Math.abs(y - runY) > 0.5) {
            // Value changed: close the previous flat run up to here, leave a gap,
            // start a fresh run at the new level.
            flush(x);
            runStartX = x; runY = y;
          }
          prevX = x;
        }
        // Extend the final run to the latest bar / right edge of data.
        flush(prevX);
        ctx.restore();
      }

    };

    drawOverlayRef.current = draw;

    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(draw);
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    draw();

    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(draw);
      ro.disconnect();
      drawOverlayRef.current = () => {};
    };
  }, [showHeatmap, intensity, rows, showProfile, profile, showMvcLine, showLevels, mvcHistory]);

  // ── Bottom lanes: big-trade bubbles + 5m net delta ────────────────────────
  // Both are x-aligned to the chart time axis via the chart's timeToCoordinate
  // (lane canvases share the chart's width and left edge), like the reference.
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;
    const SLOT_MS = 300_000;

    const sizeCanvas = (cv: HTMLCanvasElement | null) => {
      if (!cv) return null;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      return { ctx, w, h };
    };

    const draw = () => {
      const ts = chart.timeScale();
      // Bar CENTER x for a slot (lightweight-charts maps a time to the candle's
      // center, so this lines a bubble up directly under its candle).
      const barCenter = (slotTs: number): number | null => {
        const x = ts.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        return x == null ? null : x;
      };
      const slotX = (slotTs: number) => {
        const x0 = ts.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        const xEnd = ts.timeToCoordinate(((slotTs + SLOT_MS) / 1000) as UTCTimestamp);
        if (x0 == null) return null;
        const x1 = xEnd != null ? xEnd : x0 + 8;
        return { left: Math.min(x0, x1), w: Math.max(2, Math.abs(x1 - x0)) };
      };
      // Column pitch in px (center-to-center of adjacent 5-min bars). Drives the
      // max bubble radius so bubbles shrink and never overlap when zoomed out.
      const pitch = (() => {
        const sorted = bubbles.map((b) => b.slotTs).sort((x, y) => x - y);
        for (let i = 1; i < sorted.length; i++) {
          const c0 = barCenter(sorted[i - 1]);
          const c1 = barCenter(sorted[i]);
          if (c0 != null && c1 != null && Math.abs(c1 - c0) > 0.5) return Math.abs(c1 - c0);
        }
        return 24;
      })();

      // Bubbles lane: one bubble per 5-min slot. Green = buy aggressor, red =
      // sell. Volume-gated (quiet slots hidden), small + semi-transparent, and
      // offset by side (buys above the line, sells below) so they don't pile up.
      const bub = sizeCanvas(bubbleLaneRef.current);
      if (bub) {
        const { ctx, w, h } = bub;
        const rowY = h / 2;
        ctx.strokeStyle = "rgba(255,255,255,.08)";
        ctx.beginPath(); ctx.moveTo(0, rowY); ctx.lineTo(w, rowY); ctx.stroke();
        if (showBubbles && bubbles.length) {
          // Size metric: total slot volume, or |net delta| (balanced slots stay
          // small even when busy). Color is always the dominant aggressor side.
          const metricOf = (b: Bubble) => (bubbleMetric === "net" ? Math.abs(b.net) : b.total);

          // Smaller + guaranteed gaps: cap diameter well under the column.
          const rCap = Math.max(2.5, Math.min(h * 0.36, pitch * 0.34));
          const rMin = 1;
          // Per-session scaling against each group's OWN distribution. Three
          // groups: rth, overnight, and the 3:45–4:15 close (eod) — the EOD
          // auction blowout is scaled among itself so it doesn't crush RTH.
          const scaleFor = (group: Bubble[]) => {
            const asc = group.map(metricOf).filter((v) => v > 0).sort((a, b) => a - b);
            if (!asc.length) return null;
            const gate = asc[Math.floor(asc.length * 0.6)] ?? 0;            // hide more quiet slots
            const refHi = Math.max(gate + 1, asc[Math.floor(asc.length * 0.97)] ?? asc[asc.length - 1]);
            const span = Math.max(1, refHi - gate);
            return { gate, span };
          };
          const scales: Record<"eod" | "rth" | "ovn", ReturnType<typeof scaleFor>> = {
            eod: scaleFor(bubbles.filter((b) => bubbleSession(b.slotTs) === "eod")),
            rth: scaleFor(bubbles.filter((b) => bubbleSession(b.slotTs) === "rth")),
            ovn: scaleFor(bubbles.filter((b) => bubbleSession(b.slotTs) === "ovn")),
          };

          // Draw smallest first so heavy prints sit on top.
          const ordered = [...bubbles].sort((a, b) => metricOf(a) - metricOf(b));
          for (const b of ordered) {
            const m = metricOf(b);
            const sc = scales[bubbleSession(b.slotTs)];
            if (!sc || m < sc.gate || !(m > 0)) continue; // per-session gate
            const cx = barCenter(b.slotTs);
            if (cx == null) continue;
            const t = Math.min(1, Math.max(0, (m - sc.gate) / sc.span));
            // Power 1.5 → small slots stay tiny, big ones clearly grow (real spread).
            const r = rMin + Math.pow(t, 1.5) * (rCap - rMin);
            const buy = b.side === "buy";
            const fillA = 0.10 + t * 0.32; // semi-transparent; heavier = denser
            ctx.beginPath();
            ctx.arc(cx, rowY, r, 0, Math.PI * 2); // single centerline row
            ctx.fillStyle = buy ? `rgba(48,209,88,${fillA.toFixed(2)})` : `rgba(255,91,91,${fillA.toFixed(2)})`;
            ctx.fill();
            ctx.lineWidth = 0.9;
            ctx.strokeStyle = buy ? "rgba(48,209,88,.6)" : "rgba(255,91,91,.6)";
            ctx.stroke();
          }
        }
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.fillText(`BIG TRADE BUBBLES · size = ${bubbleMetric === "net" ? "net Δ" : "total vol"}`, 6, 12);
      }

      // Delta lane: one net bar per 5-min slot + a cumulative-delta line (running
      // sum of net delta) that resets at each RTH open (9:30 ET).
      const del = sizeCanvas(deltaLaneRef.current);
      if (del) {
        const { ctx, w, h } = del;
        const zeroY = h / 2;
        ctx.strokeStyle = "rgba(255,255,255,.14)";
        ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(w, zeroY); ctx.stroke();
        if (showDelta && deltaBars.length) {
          const sorted = [...deltaBars].sort((a, b) => a.slotTs - b.slotTs);
          const maxAbs = Math.max(1, ...sorted.map((d) => Math.abs(d.net)));

          // ── bars ──
          for (const d of sorted) {
            const sx = slotX(d.slotTs);
            if (!sx) continue;
            const barH = (Math.abs(d.net) / maxAbs) * (h / 2 - 4);
            const up = d.net >= 0;
            ctx.fillStyle = up ? "rgba(48,209,88,.55)" : "rgba(255,91,91,.55)";
            const bx = sx.left + 1, bw = Math.max(1, sx.w - 2);
            if (up) ctx.fillRect(bx, zeroY - barH, bw, barH);
            else ctx.fillRect(bx, zeroY, bw, barH);
          }

          // ── cumulative delta (running sum of net delta), reset at RTH open ──
          // Build running sums with resets, then scale to the lane.
          const dayKey = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ts));
          // Session id = the ET date of the most recent 9:30 open. Slots before
          // 9:30 roll into the PRIOR day's session, so CVD runs continuously
          // through the overnight and only resets when the next 9:30 hits.
          const sessionId = (ts: number) => {
            if (etMinutes(ts) >= 570) return dayKey(ts);
            return dayKey(ts - 86_400_000); // before the open → prior session day
          };
          const cvd: Array<{ slotTs: number; sum: number }> = [];
          let running = 0;
          let prevSession: string | null = null;
          for (const d of sorted) {
            const session = sessionId(d.slotTs);
            if (session !== prevSession) { running = 0; prevSession = session; }
            running += d.net;
            cvd.push({ slotTs: d.slotTs, sum: running });
          }
          const cvdMax = Math.max(1, ...cvd.map((c) => Math.abs(c.sum)));
          const cvdY = (sum: number) => zeroY - (sum / cvdMax) * (h / 2 - 4);

          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,.95)";
          ctx.lineWidth = 1.6;
          ctx.lineJoin = "round";
          let started = false;
          for (const c of cvd) {
            const cx = barCenter(c.slotTs);
            if (cx == null) continue;
            const y = cvdY(c.sum);
            if (!started) { ctx.beginPath(); ctx.moveTo(cx, y); started = true; }
            else ctx.lineTo(cx, y);
          }
          if (started) ctx.stroke();
          ctx.restore();
        }
        ctx.fillStyle = "rgba(255,255,255,.45)";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.fillText("DELTA (5m) · white = Cumulative Delta (RTH reset)", 6, 12);
      }
    };

    drawLanesRef.current = draw;
    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(draw);
    const ro = new ResizeObserver(draw);
    if (bubbleLaneRef.current) ro.observe(bubbleLaneRef.current);
    if (deltaLaneRef.current) ro.observe(deltaLaneRef.current);
    draw();

    // Hover tooltip: pick the bubble whose column center is nearest the cursor.
    const canvas = bubbleLaneRef.current;
    const onMove = (e: MouseEvent) => {
      if (!canvas || !showBubbles || !bubbles.length) { setBubbleHover(null); return; }
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      let best: Bubble | null = null;
      let bestDx = Infinity;
      for (const b of bubbles) {
        const cx = ts.timeToCoordinate((b.slotTs / 1000) as UTCTimestamp);
        if (cx == null) continue;
        const dx = Math.abs(cx - mx);
        if (dx < bestDx) { bestDx = dx; best = b; }
      }
      // Only show when reasonably close to a column (half a pitch).
      if (best && bestDx <= 14) setBubbleHover({ x: mx, y: e.clientY - rect.top, b: best });
      else setBubbleHover(null);
    };
    const onLeave = () => setBubbleHover(null);
    canvas?.addEventListener("mousemove", onMove);
    canvas?.addEventListener("mouseleave", onLeave);

    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(draw);
      ro.disconnect();
      canvas?.removeEventListener("mousemove", onMove);
      canvas?.removeEventListener("mouseleave", onLeave);
      drawLanesRef.current = () => {};
    };
  }, [showBubbles, showDelta, bubbles, deltaBars, rows, bubbleMetric]);

  return (
    <div className="es-candles-root flex h-full flex-col" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.24em]" style={{ color: "#ff5b5b" }}>ES 5m Candles</div>
          <div className="mt-1 text-xs text-white/70">5m ES candles from Postgres, merged live over /ws/gex.</div>
        </div>
        <div className="es-candles-toggles flex items-center gap-3 text-xs">
          <span className="rounded border px-2 py-1" style={{ borderColor: "rgba(255,255,255,.12)", color: status === "live" ? "#30d158" : "#94a3b8" }}>
            {status.toUpperCase()}
          </span>
          <span className="rounded border px-2 py-1 text-white/70" style={{ borderColor: "rgba(255,255,255,.12)" }}>
            {`${rows.length} candles`}
          </span>
          <div ref={dteBoxRef} className="relative">
            <button
              onClick={() => setDteOpen((v) => !v)}
              className="flex items-center gap-2 rounded border px-3 py-1 text-xs"
              style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(255,255,255,.04)", color: "#cbd5e1" }}
              title="Heatmap expiry / DTE"
            >
              <span className="font-mono">
                {selectedExpiry ? `${dteOf(selectedExpiry)}DTE` : "Front"}
              </span>
              <span className="text-white/40" style={{ transform: dteOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▾</span>
            </button>
            {dteOpen ? (
              <div
                className="absolute left-0 z-50 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border py-1 shadow-2xl"
                style={{ borderColor: "rgba(255,255,255,.12)", background: "rgba(12,16,22,.98)", backdropFilter: "blur(8px)" }}
              >
                {[{ value: "", label: "Front (live)", sub: "" }, ...expirations.map((exp) => ({
                  value: exp, label: `${dteOf(exp)}DTE`, sub: exp,
                }))].map((opt) => {
                  const active = selectedExpiry === opt.value;
                  return (
                    <button
                      key={opt.value || "front"}
                      onClick={() => { setSelectedExpiry(opt.value); setDteOpen(false); }}
                      className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs"
                      style={{ background: active ? "rgba(41,182,246,.18)" : "transparent", color: active ? "#7dd3fc" : "rgba(255,255,255,.75)" }}
                    >
                      <span className="font-mono font-semibold">{opt.label}</span>
                      <span className="text-white/35">{opt.sub}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => setShowHeatmap((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showHeatmap ? "#29b6f6" : "#94a3b8" }}
          >
            Heatmap {showHeatmap ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setShowBubbles((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showBubbles ? "#30d158" : "#94a3b8" }}
          >
            Bubbles {showBubbles ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setBubbleMetric((m) => (m === "total" ? "net" : "total"))}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: "#cbd5e1" }}
            title="Bubble size = total volume vs net delta"
          >
            Size: {bubbleMetric === "net" ? "Net Δ" : "Total"}
          </button>
          <button
            onClick={() => setShowDelta((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showDelta ? "#f5c518" : "#94a3b8" }}
          >
            Delta {showDelta ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setShowProfile((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showProfile ? "#f59e0b" : "#94a3b8" }}
          >
            Profile {showProfile ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setShowMvcLine((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showMvcLine ? "#ffffff" : "#94a3b8" }}
          >
            MVC {showMvcLine ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setShowLevels((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showLevels ? "#a78bfa" : "#94a3b8" }}
            title="Call Wall / Put Wall / Flip / MVC lines"
          >
            Levels {showLevels ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => setShowSessions((v) => !v)}
            className="rounded border px-3 py-1 text-xs"
            style={{ borderColor: "rgba(255,255,255,.12)", color: showSessions ? "#60a5fa" : "#94a3b8" }}
            title="Prior-day H/L + overnight H/L"
          >
            PDH/ON {showSessions ? "ON" : "OFF"}
          </button>
          <label className="flex items-center gap-1.5 text-white/55">
            intensity
            <input
              type="range" min={0.05} max={1} step={0.05} value={intensity}
              onChange={(e) => setIntensity(Number(e.target.value))}
              style={{ width: 90 }}
            />
          </label>
          <button onClick={() => void refresh()} className="rounded border px-3 py-1 text-xs" style={{ borderColor: "rgba(255,255,255,.12)", color: "#ffb4b4" }}>
            Refresh
          </button>
          <BoxSnapBtn targetRef={captureRef} label="ES Candles" />
          <BoxDiscordBtn targetRef={captureRef} label="ES Candles" />
        </div>
      </div>


      <div className="flex flex-wrap items-center gap-4 px-4 pb-1 text-xs">
        {(() => {
          const basis = levels.esFut != null && levels.spx != null ? levels.esFut - levels.spx : 0;
          const es = (v: number | null) => (v != null ? (v + basis).toFixed(2) : "—");
          const Chip = ({ c, label, v }: { c: string; label: string; v: number | null }) => (
            <span className="flex items-center gap-1.5">
              <span style={{ display: "inline-block", width: 14, height: 0, borderTop: `2px dashed ${c}` }} />
              <span className="text-white/55">{label}</span>
              <span className="font-mono font-bold" style={{ color: c }}>{es(v)}</span>
            </span>
          );
          return (
            <>
              <Chip c="#30d158" label="Call Wall" v={levels.callWall} />
              <Chip c="#ff5b5b" label="Put Wall" v={levels.putWall} />
              <Chip c="#f5c518" label="Flip" v={levels.gexFlip} />
              <Chip c="#4aa3ff" label="MVC" v={levels.mvc} />
              <span className="text-white/35">basis {basis ? (basis > 0 ? "+" : "") + basis.toFixed(2) : "—"}</span>
            </>
          );
        })()}
      </div>

      <div ref={captureRef} className="flex flex-1 flex-col gap-2 px-4 pb-4" style={{ minHeight: 0 }}>
        {/* Price chart + price-aligned overlay (heatmap, volume profile, VA lines) */}
        <div className="relative flex-1 overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)", minHeight: 320 }}>
          {/* Overlay (heatmap/profile/levels) sits BEHIND the chart so the
              candlesticks always render on the top visible layer. */}
          <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 1 }} />
          <div ref={chartRef} className="absolute inset-0" style={{ zIndex: 2 }} />
          {rows.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {connected ? "Waiting for live 5m ES candles" : "Loading candles…"}
            </div>
          ) : null}
        </div>

        {/* Big-trade bubbles lane (time-aligned to the chart) */}
        <div className="relative rounded-xl border" style={{ height: 86, borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)" }}>
          <canvas ref={bubbleLaneRef} className="absolute inset-0 h-full w-full" />
          {bubbleHover ? (
            <div
              className="pointer-events-none absolute z-20 rounded-lg border px-3 py-2 text-xs shadow-xl"
              style={{
                left: Math.min(Math.max(bubbleHover.x - 70, 4), 9999),
                bottom: 92, // float just above the lane
                borderColor: "rgba(255,255,255,.14)",
                background: "rgba(10,14,20,.96)",
                backdropFilter: "blur(6px)",
                minWidth: 150,
              }}
            >
              <div className="mb-1 font-mono text-[11px] text-white/55">
                {new Date(bubbleHover.b.slotTs).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET
                <span className="ml-2" style={{ color: isRthSlot(bubbleHover.b.slotTs) ? "#30d158" : "#94a3b8" }}>
                  {isRthSlot(bubbleHover.b.slotTs) ? "RTH" : "O/N"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/50">Total</span>
                <span className="font-mono font-bold text-white">{bubbleHover.b.total.toLocaleString("en-US")}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "#30d158" }}>Buy</span>
                <span className="font-mono" style={{ color: "#30d158" }}>{bubbleHover.b.buy.toLocaleString("en-US")}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span style={{ color: "#ff5b5b" }}>Sell</span>
                <span className="font-mono" style={{ color: "#ff5b5b" }}>{bubbleHover.b.sell.toLocaleString("en-US")}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 border-t pt-1" style={{ borderColor: "rgba(255,255,255,.1)" }}>
                <span className="text-white/50">Net Δ</span>
                <span className="font-mono font-bold" style={{ color: bubbleHover.b.net >= 0 ? "#30d158" : "#ff5b5b" }}>
                  {bubbleHover.b.net >= 0 ? "+" : ""}{bubbleHover.b.net.toLocaleString("en-US")}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Delta profile lane (time-aligned to the chart) */}
        <div className="relative overflow-hidden rounded-xl border" style={{ height: 72, borderColor: "rgba(255,255,255,.08)", background: "rgba(255,255,255,.02)" }}>
          <canvas ref={deltaLaneRef} className="absolute inset-0 h-full w-full" />
        </div>
      </div>
    </div>
  );
}
