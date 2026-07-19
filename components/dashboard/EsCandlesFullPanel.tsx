"use client";

// EsCandlesFullPanel — the "exact chart" from the full /es-candles page,
// self-contained for the HOME2 dashboard tab grid: live ES 5m candlesticks
// PLUS the GEX overlay (Call Wall / Put Wall from the live feed; Gamma Flip and
// CB from the mvc_snapshots recorder — see snapLevels), the
// GEX heatmap behind the candles, and the vertical GEX-by-strike rail, fed by
// the same useEsCandles hook + the same /ws/gex level stream the full page
// uses. No toolbar / Dock / nav chrome, and no TPO/volume-profile/session-H-L
// extras — those live behind buttons on the full page. The heatmap here is
// locked to the live front (current/closest) expiry only: no DTE picker, no
// multi-expiry backfill — it ingests the front-expiry columns the feed sends
// plus a 1-day front-expiry history backfill so the band is populated on load.
// Zero required props; fills whatever box it's placed in (ResizeObserver).

import { useCallback, useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from "lightweight-charts";
import type { UTCTimestamp, IChartApi, ISeriesApi, IPriceLine, CandlestickData } from "lightweight-charts";
import { useEsCandles } from "@/hooks/useEsCandles";
import { useWsLifecycle } from "@/hooks/useWsLifecycle";
// findGEXFlip is intentionally NOT imported: the flip is no longer recomputed
// from live gexRows on this panel — it (and CB) come from the CB snapshot below.
import { HOME_THEME } from "@/components/shared/homeTheme";

function toChartTime(ts: number): UTCTimestamp {
  return Math.floor(ts / 1000) as UTCTimestamp;
}

// ── GEX heatmap (front/current expiry only) ────────────────────────────────
// One painted cell = a strike bucket at a 5-min slot. netOiVol = gamma×(OI+vol).
// Ported from app/es-candles/page.tsx, trimmed to the single Vol+OI metric (no
// toggle) since this embed follows the live front expiry only.
type GexCell = { strike: number; netOiVol: number };
type GexColumn = { slotTs: number; cells: GexCell[] };
const SLOT_MS = 300_000; // 5-min candle grid
const HEATMAP_INTENSITY = 0.65; // matches the full page's default slider value
function slotFloorMs(ts: number): number {
  return Math.floor(ts / SLOT_MS) * SLOT_MS;
}

/**
 * GEX heatmap color: positive GEX = cyan, negative = red. The 3 largest
 * magnitudes per column get fixed rank floors so the dominant walls stand out;
 * everything else follows a curve scaled by `intensity`. Copied verbatim from
 * the full /es-candles page so the two surfaces read identically.
 */
function gexColor(value: number, maxValue: number, intensity: number, top3: number[]): string | null {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return null;
  const pos = n >= 0;
  const rank = top3.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.55)" : "rgba(255,71,87,0.55)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.35)" : "rgba(255,71,87,0.35)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio, 0.6);
  const alpha = Math.min(0.30, 0.04 + eased * (intensity || 0.1) * 0.26);
  return pos ? `rgba(41,182,246,${alpha.toFixed(3)})` : `rgba(255,71,87,${alpha.toFixed(3)})`;
}

export default function EsCandlesFullPanel() {
  const esShouldConnect = useWsLifecycle();
  const esShouldConnectRef = useRef(esShouldConnect);
  esShouldConnectRef.current = esShouldConnect;

  const { sessionCandles: rows, connected } = useEsCandles();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Keyed by title so a level can be UPDATED in place (applyOptions) instead of
  // destroyed + recreated — recreating relays out the price axis and nudged the
  // whole chart on every frame.
  const priceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  const didFitRef = useRef(false);
  const lastFitDayRef = useRef("");

  const railDrawRef = useRef<() => void>(() => {});

  // ── Heatmap state (front/current expiry only) ──
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const columnsRef = useRef<Map<number, GexColumn>>(new Map()); // keyed by 5-min slot
  const drawOverlayRef = useRef<() => void>(() => {});
  const hmScaleWRef = useRef(0);            // cached right-axis gutter width
  const hmBufRef = useRef<HTMLCanvasElement | null>(null); // reused offscreen heatmap buffer
  const candleBandRef = useRef<{ lo: number; hi: number } | null>(null); // visible ES band
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [feedExpiry, setFeedExpiry] = useState(""); // live front expiry → drives backfill

  // GEX levels + basis, mirrors app/es-candles/page.tsx `levels` state.
  // Walls only — the flip and CB come from the snapshot (see snapLevels).
  const [levels, setLevels] = useState<{
    callWall: number | null;
    putWall: number | null;
    spx: number | null;
    esFut: number | null;
    basis: number | null;
  }>({ callWall: null, putWall: null, spx: null, esFut: null, basis: null });

  // Flip + CB, sourced from the CB snapshot table (mvc_snapshots) rather than
  // recomputed from live gexRows on every WS frame. These are slow structural
  // levels — the recorder writes them every 30m RTH, so a 60s poll is already
  // finer than the data. strikeOIVol = the CB strike, gexFlip = the flip, both
  // in SPX space (converted to ES at publish time with effectiveBasis).
  const [snapLevels, setSnapLevels] = useState<{ cb: number | null; gexFlip: number | null }>(
    { cb: null, gexFlip: null }
  );
  const basisRef = useRef(0);

  const effectiveBasis = useCallback(() => basisRef.current, []);

  // ── Chart setup (once) ──────────────────────────────────────────────────
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
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
      rightPriceScale: { visible: true, borderColor: "rgba(255,255,255,.10)" },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "rgba(255,255,255,.10)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: unknown, tickMarkType: number) => {
          if (typeof t !== "number") return "";
          const d = new Date(t * 1000);
          if (tickMarkType === 2 || tickMarkType === 3) {
            return d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
          }
          return d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
        },
      },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        priceFormatter: (price: number) => price.toFixed(2),
        timeFormatter: (time: unknown) =>
          typeof time === "number"
            ? new Date(time * 1000).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })
            : "",
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      wickUpColor: "#30d158",
      upColor: "#30d158",
      wickDownColor: "#ff5b5b",
      downColor: "#ff5b5b",
      borderVisible: false,
    });
    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;

    let lastW = 0, lastH = 0;
    const ro = new ResizeObserver(() => {
      const w = Math.round(container.clientWidth);
      const h = Math.round(container.clientHeight);
      if (w <= 0 || h <= 0 || (w === lastW && h === lastH)) return;
      const wasCollapsed = lastW <= 0 || lastH <= 0;
      lastW = w; lastH = h;
      chart.applyOptions({ width: w, height: h });
      if (wasCollapsed) chart.timeScale().fitContent();
      railDrawRef.current();
    });
    ro.observe(container);
    lastW = Math.round(container.clientWidth);
    lastH = Math.round(container.clientHeight);
    chart.applyOptions({ width: lastW, height: lastH });

    // Poll on rAF until the container has a real size (it starts at 0 inside
    // a grid cell that lays out after mount) — same guard as EsCandlesCard.
    let rafId = 0;
    let tries = 0;
    const pump = () => {
      const w = Math.round(container.clientWidth);
      const h = Math.round(container.clientHeight);
      if (w > 0 && h > 0 && (w !== lastW || h !== lastH || !didFitRef.current)) {
        lastW = w; lastH = h;
        chart.applyOptions({ width: w, height: h });
        chart.timeScale().fitContent();
        railDrawRef.current();
      }
      tries++;
      if ((w === 0 || h === 0) && tries < 120) rafId = requestAnimationFrame(pump);
    };
    rafId = requestAnimationFrame(pump);

    const onDblClick = () => {
      chart.timeScale().fitContent();
      chart.priceScale("right").applyOptions({ autoScale: true });
      railDrawRef.current();
    };
    container.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      container.removeEventListener("dblclick", onDblClick);
      chart.remove();
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      // chart.remove() destroys the series and every price line with it. Drop the
      // handles too — otherwise a remount would applyOptions() onto dead lines and
      // never re-create them.
      priceLinesRef.current.clear();
      didFitRef.current = false;
    };
  }, []);

  // ── Feed candle data ────────────────────────────────────────────────────
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartApiRef.current;
    if (!candleSeries || !chart) return;

    const candleData: CandlestickData[] = rows.map((row) => ({
      time: toChartTime(row.timestamp),
      open: row.open, high: row.high, low: row.low, close: row.close,
    }));
    candleSeries.setData(candleData);

    // Track the ES price band the candles occupy so the heatmap can fade cells
    // by distance from it (far GEX walls read as faint context, not loud bars).
    if (candleData.length) {
      let lo = Infinity, hi = -Infinity;
      for (const r of rows) { if (r.low < lo) lo = r.low; if (r.high > hi) hi = r.high; }
      candleBandRef.current = Number.isFinite(lo) ? { lo, hi } : null;
    } else {
      candleBandRef.current = null;
    }

    const lastDay = candleData.length ? rows[rows.length - 1].date : "";
    if (candleData.length && (!didFitRef.current || lastDay !== lastFitDayRef.current)) {
      chart.timeScale().fitContent();
      didFitRef.current = true;
      lastFitDayRef.current = lastDay;
    }
    drawOverlayRef.current();
    railDrawRef.current();
  }, [rows]);

  // ── /ws/gex: GEX levels (Call Wall / Put Wall / Flip) + basis + rail rows ─
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let dead = false;

    const apply = (d: Record<string, unknown>) => {
      const spx = Number(d.spot ?? 0);
      const esFut = Number(d.esFut ?? 0);
      const rawBasis = Number(d.basis);
      const dBasis = Number.isFinite(rawBasis) && Math.abs(rawBasis) > 0.01 ? rawBasis : null;
      // Live gexRows are always the FRONT (current/closest) expiry — capture it
      // once to seed the 1-day history backfill for the same contract.
      const exp = typeof d.expiry === "string" ? d.expiry : "";
      if (exp) setFeedExpiry((cur) => cur || exp);

      setLevels((prev) => {
        const nextSpx = spx > 0 ? spx : prev.spx;
        const nextEs = esFut > 0 ? esFut : prev.esFut;
        const nextBasis = dBasis != null ? dBasis : prev.basis;
        if (nextBasis != null && !basisRef.current) basisRef.current = nextBasis;
        else if (!basisRef.current && nextSpx != null && nextEs != null) basisRef.current = nextEs - nextSpx;
        return {
          callWall: d.callWall != null ? Number(d.callWall) || null : prev.callWall,
          putWall: d.putWall != null ? Number(d.putWall) || null : prev.putWall,
          basis: nextBasis,
          spx: nextSpx,
          esFut: nextEs,
        };
      });

      const gexRows = d.gexRows;
      if (Array.isArray(gexRows) && gexRows.length) {
        const cells: GexCell[] = [];
        for (const r of gexRows as Array<Record<string, unknown>>) {
          const strike = Number(r.strike ?? 0);
          const netOi = Number(r.netGEX ?? r.net_gex ?? r.netGexVal ?? 0);
          const netVol = Number(r.netVolGEX ?? 0);
          if (!(strike > 0)) continue;
          const net = (Number.isFinite(netOi) ? netOi : 0) + (Number.isFinite(netVol) ? netVol : 0);
          cells.push({ strike, netOiVol: net });
        }
        // Snapshot the front-expiry per-strike net into the current 5-min column.
        if (cells.length) {
          const slotTs = slotFloorMs(Date.now());
          const map = columnsRef.current;
          map.set(slotTs, { slotTs, cells });
          if (map.size > 10000) map.delete(Math.min(...map.keys())); // cap history
          drawOverlayRef.current();
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
      if (dead || !esShouldConnectRef.current) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try { ws = new WebSocket(`${proto}//${window.location.host}/ws/gex`); }
      catch { schedule(); return; }
      ws.onmessage = (e) => handle(String(e.data));
      ws.onerror = () => { try { ws?.close(); } catch {} };
      ws.onclose = () => { if (!dead) schedule(); };
    };
    const schedule = () => {
      if (dead || !esShouldConnectRef.current) return;
      if (retry) clearTimeout(retry);
      retry = setTimeout(connect, 2500);
    };

    if (esShouldConnect) connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onmessage = ws.onerror = ws.onclose = null;
        if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => { try { ws?.close(); } catch {} };
        else { ws.onopen = null; try { ws.close(); } catch {} }
      }
    };
  }, [esShouldConnect]);

  // ── Price-line values: ES-tick quantized, republished at most once a minute ──
  // `levels` gets a NEW object identity on every /ws/gex frame because spx/esFut
  // tick continuously — even when the walls and flip haven't moved. That churned
  // the price lines (and the axis labels, which resize the price scale → the plot
  // width shifts → the chart visibly nudges). These levels don't move fast enough
  // to justify sub-minute updates, so: snap to 0.25 (the ES tick — a level between
  // ticks isn't tradeable anyway), recompute on a 1-min cadence, and only publish
  // when a quantized value actually CHANGED.
  const ES_TICK = 0.25;
  const toTick = (v: number) => Math.round(v / ES_TICK) * ES_TICK;

  const [lineLevels, setLineLevels] = useState<{ callWall: number | null; putWall: number | null; gexFlip: number | null; cb: number | null }>(
    { callWall: null, putWall: null, gexFlip: null, cb: null }
  );
  const levelsRef = useRef(levels);
  useEffect(() => { levelsRef.current = levels; }, [levels]);
  const snapLevelsRef = useRef(snapLevels);
  useEffect(() => { snapLevelsRef.current = snapLevels; }, [snapLevels]);

  // ── CB snapshot poll: the flip + CB source of truth ───────────────────────
  // limit=1 because getMvcSnapshots is ORDER BY timestamp DESC — row[0] is the
  // newest. No live recompute: these levels are structural, and deriving the
  // flip per-frame off gexRows is what made it twitch.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/snapshots/mvc?limit=1", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const r = Array.isArray(json.rows) && json.rows.length ? json.rows[0] : null;
        if (!r || cancelled) return;
        const num = (v: unknown) => { const n = Number(v ?? 0); return n > 0 ? n : null; };
        const next = { cb: num(r.strikeOIVol), gexFlip: num(r.gexFlip) };
        setSnapLevels((prev) => (prev.cb === next.cb && prev.gexFlip === next.gexFlip ? prev : next));
      } catch { /* keep last */ }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Flips false→true exactly once, when the first real level lands — that
  // re-runs the effect below so the lines paint immediately instead of waiting
  // out the first 60s interval.
  const hasLevels =
    levels.callWall != null || levels.putWall != null || snapLevels.cb != null || snapLevels.gexFlip != null;

  useEffect(() => {
    const publish = () => {
      const l = levelsRef.current;
      const s = snapLevelsRef.current;
      const b = effectiveBasis();
      const es = (spxLevel: number | null) => (spxLevel != null ? toTick(spxLevel + b) : null);
      const next = { callWall: es(l.callWall), putWall: es(l.putWall), gexFlip: es(s.gexFlip), cb: es(s.cb) };
      // Identity-stable when nothing moved → the draw effect doesn't re-fire.
      setLineLevels((prev) =>
        prev.callWall === next.callWall && prev.putWall === next.putWall &&
        prev.gexFlip === next.gexFlip && prev.cb === next.cb
          ? prev
          : next
      );
    };
    publish();
    const id = setInterval(publish, 60_000);
    return () => clearInterval(id);
  }, [effectiveBasis, hasLevels]);

  // ── Draw GEX level price lines (Call Wall / Put Wall / Flip) ────────────
  // Update in place; only create/remove when a level appears or disappears.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const defs: Array<{ price: number | null; color: string; title: string; style: LineStyle; width: 1 | 2 }> = [
      { price: lineLevels.callWall, color: "#30d158", title: "Call Wall", style: LineStyle.Dashed, width: 1 },
      { price: lineLevels.putWall, color: "#ff5b5b", title: "Put Wall", style: LineStyle.Dashed, width: 1 },
      { price: lineLevels.gexFlip, color: "#f5c518", title: "Flip", style: LineStyle.Dashed, width: 1 },
      { price: lineLevels.cb, color: "#ffffff", title: "CB", style: LineStyle.Solid, width: 1 },
    ];

    const lines = priceLinesRef.current;
    for (const d of defs) {
      const live = d.price != null && d.price > 0;
      const existing = lines.get(d.title);
      if (!live) {
        if (existing) { try { series.removePriceLine(existing); } catch {} lines.delete(d.title); }
        continue;
      }
      if (existing) {
        try { existing.applyOptions({ price: d.price as number }); } catch {}
        continue;
      }
      lines.set(d.title, series.createPriceLine({
        price: d.price as number,
        color: d.color,
        lineWidth: d.width,
        lineStyle: d.style,
        axisLabelVisible: true,
        title: d.title,
      }));
    }
  }, [lineLevels]);

  // ── Heatmap history backfill (front/current expiry, 1 day) ────────────────
  // Seeded once the live feed reports its front expiry. Uses anyExpiry=1 so the
  // rolling 0DTE front contract matches by time window (same as the full page's
  // front mode) — this is the current/closest contract, not a multi-expiry mix.
  useEffect(() => {
    if (!feedExpiry) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=1440&expiry=${encodeURIComponent(feedExpiry)}&anyExpiry=1`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();
        type RawCol = { slotTs: number; cells: Array<{ strike: number; net: number }> };
        const raw = Array.isArray(json.columns) ? (json.columns as RawCol[]) : [];
        if (cancelled || !raw.length) return;
        const map = columnsRef.current;
        // History rows are 1-min granular; snap to the 5-min grid, newest wins.
        const sortedRaw = [...raw].sort((a, b) => b.slotTs - a.slotTs);
        for (const col of sortedRaw) {
          const slotTs = slotFloorMs(col.slotTs);
          if (map.has(slotTs)) continue; // live columns win on collision
          const cells: GexCell[] = col.cells
            .filter((c) => c.strike > 0 && Number.isFinite(c.net))
            .map((c) => ({ strike: c.strike, netOiVol: c.net }));
          map.set(slotTs, { slotTs, cells });
        }
        drawOverlayRef.current();
      } catch { /* live feed still populates the front expiry going forward */ }
    })();
    return () => { cancelled = true; };
  }, [feedExpiry]);

  // ── Heatmap canvas overlay ────────────────────────────────────────────────
  // Paints one column per 5-min GEX snapshot behind the candles. Each cell spans
  // its strike bucket (strike → next strike up, SPX→ES via basis) and its 5-min
  // slot, colored by gexColor and faded by distance from the candle band. Ported
  // from app/es-candles/page.tsx (heatmap layer only).
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
      if (!showHeatmap) return;

      const cols = [...columnsRef.current.values()].sort((a, b) => a.slotTs - b.slotTs);
      if (!cols.length) return;

      const timeScale = chart.timeScale();
      const basis = basisRef.current;
      const slotX = (slotTs: number): { left: number; w: number } | null => {
        const x0 = timeScale.timeToCoordinate((slotTs / 1000) as UTCTimestamp);
        const xEndRaw = timeScale.timeToCoordinate(((slotTs + SLOT_MS) / 1000) as UTCTimestamp);
        if (x0 == null) return null;
        const x1 = xEndRaw != null ? xEndRaw : x0 + 8;
        return { left: Math.min(x0, x1), w: Math.max(2, Math.abs(x1 - x0)) };
      };

      // Stretch the latest column to the plot's right edge (canvas minus the
      // price-axis gutter). Cache the gutter width, only accepting >=1px changes
      // so the live price label's sub-pixel wobble doesn't shimmer the band edge.
      let measuredScaleW = 0;
      try { measuredScaleW = chart.priceScale("right").width(); } catch {}
      if (Math.abs(measuredScaleW - hmScaleWRef.current) >= 1) hmScaleWRef.current = measuredScaleW;
      const hmPlotRight = Math.max(0, w - hmScaleWRef.current - 1);
      const lastSlotTs = cols[cols.length - 1].slotTs;

      // Draw to an offscreen buffer, then composite through a blur so adjacent
      // cells melt into smooth bands instead of hard tiles. The buffer is
      // allocated ONCE and reused — a fresh full-viewport canvas per rAF was pure
      // allocation + GC churn while panning. Setting width/height clears it, so
      // only touch those on a real size change; otherwise clearRect.
      const bw = Math.max(1, Math.round(w));
      const bh = Math.max(1, Math.round(h));
      if (!hmBufRef.current) hmBufRef.current = document.createElement("canvas");
      const buf = hmBufRef.current;
      const bctx = buf.getContext("2d");
      if (buf.width !== bw || buf.height !== bh) {
        buf.width = bw;
        buf.height = bh;
      } else {
        bctx?.clearRect(0, 0, bw, bh);
      }
      if (bctx) {
        const band = candleBandRef.current;
        const fadeSpan = 30; // ES points to fade to ~floor past the band edge
        const distFade = (esStrike: number): number => {
          if (!band) return 1;
          const d = esStrike < band.lo ? band.lo - esStrike
                  : esStrike > band.hi ? esStrike - band.hi : 0;
          if (d <= 0) return 1;
          return Math.max(0.12, 1 - d / fadeSpan);
        };
        for (let ci = 0; ci < cols.length; ci++) {
          const col = cols[ci];
          const sx = slotX(col.slotTs);
          if (!sx) continue;
          // Carry each column forward to the next stored column's left edge so
          // skipped (unchanged) slots leave no gaps; the last one runs to the axis.
          if (col.slotTs === lastSlotTs && hmPlotRight > sx.left) {
            sx.w = hmPlotRight - sx.left;
          } else if (ci + 1 < cols.length) {
            const nextX = slotX(cols[ci + 1].slotTs);
            if (nextX && nextX.left > sx.left) sx.w = nextX.left - sx.left;
          }
          // CULL to the visible plot. slotX only returns null for times the chart
          // doesn't know about — a column scrolled off-screen still resolves to an
          // off-screen coordinate, so without this every stored column ran its full
          // per-cell loop to paint nothing. Must come AFTER the carry-forward above
          // (that's what sets the real width).
          if (sx.left + sx.w < -2 || sx.left > hmPlotRight + 2) continue;
          const absVals = col.cells.map((c) => Math.abs(c.netOiVol)).filter((v) => v > 0);
          const colMax = absVals.length ? Math.max(...absVals) : 1;
          const colTop3 = [...absVals].sort((a, b) => b - a).slice(0, 3);
          const sorted = [...col.cells].sort((a, b) => a.strike - b.strike);
          for (let i = 0; i < sorted.length; i++) {
            const cell = sorted[i];
            const color = gexColor(cell.netOiVol, colMax, HEATMAP_INTENSITY, colTop3);
            if (!color) continue;
            const fade = distFade(cell.strike + basis);
            if (fade <= 0) continue;
            const faded = fade >= 0.999
              ? color
              : color.replace(/,([0-9.]+)\)$/, (_m, a) => `,${(parseFloat(a) * fade).toFixed(3)})`);
            const nextStrike = i + 1 < sorted.length ? sorted[i + 1].strike : cell.strike + 5;
            const pTop = series.priceToCoordinate(nextStrike + basis);
            const pBot = series.priceToCoordinate(cell.strike + basis);
            if (pTop == null || pBot == null) continue;
            const top = Math.min(pTop, pBot);
            const cellH = Math.max(1, Math.abs(pBot - pTop));
            bctx.fillStyle = faded;
            bctx.fillRect(sx.left - 0.5, top - 0.5, sx.w + 1, cellH + 1);
          }
        }
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.filter = "blur(2.5px)";
        ctx.drawImage(buf, 0, 0, w, h);
        ctx.filter = "none";
        ctx.globalAlpha = 0.45;
        ctx.drawImage(buf, 0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    };

    drawOverlayRef.current = draw;

    // Coalesce every repaint trigger through one rAF so the layout settles to a
    // fixed point before we paint (the overlay reads the right-axis width, which
    // shifts the plot width, which fires a range-change → avoid the ping-pong).
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; draw(); railDrawRef.current(); });
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(schedule);
    const ro = new ResizeObserver(schedule);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    draw();

    // No Y-axis range-change event exists in lightweight-charts, so mirror the
    // full page and repaint on pointer/wheel over the chart to track vertical
    // drag-zoom of the price scale in real time.
    const container = chartContainerRef.current;
    container?.addEventListener("wheel", schedule, { passive: true });
    container?.addEventListener("pointermove", schedule);
    container?.addEventListener("pointerup", schedule);

    return () => {
      cancelAnimationFrame(raf);
      timeScale.unsubscribeVisibleLogicalRangeChange(schedule);
      ro.disconnect();
      container?.removeEventListener("wheel", schedule);
      container?.removeEventListener("pointermove", schedule);
      container?.removeEventListener("pointerup", schedule);
      drawOverlayRef.current = () => {};
    };
  }, [showHeatmap]);

  const last = rows.length ? rows[rows.length - 1] : null;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, display: "flex" }}>
      <div style={{ position: "relative", flex: 1, minWidth: 0, minHeight: 0 }}>
        {/* Heatmap sits BEHIND the chart; the chart's transparent background
            lets it show through so candles always read on the top layer. */}
        <canvas ref={overlayRef} style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }} />
        <div ref={chartContainerRef} style={{ position: "absolute", inset: 0, zIndex: 2 }} />
        {/* Heatmap on/off — front (current/closest) expiry GEX only. */}
        <button
          onClick={() => setShowHeatmap((v) => !v)}
          title={showHeatmap ? "Hide GEX heatmap" : "Show GEX heatmap"}
          style={{
            position: "absolute", right: 8, top: 6, zIndex: 3,
            fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase",
            padding: "3px 8px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${showHeatmap ? "rgba(41,182,246,0.5)" : HOME_THEME.border}`,
            background: showHeatmap ? "rgba(41,182,246,0.16)" : "rgba(5,8,13,.6)",
            color: showHeatmap ? "rgba(41,182,246,1)" : HOME_THEME.muted,
          }}
        >
          Heatmap
        </button>
        {rows.length === 0 && (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", color: "#6f7d8c", fontSize: 12 }}>
            {connected ? "Loading ES candles…" : "Connecting…"}
          </div>
        )}
        {last && (
          <div
            style={{
              position: "absolute", left: 8, top: 6, zIndex: 3, fontSize: 12,
              fontFamily: "var(--font-mono)", color: HOME_THEME.text,
              background: "rgba(5,8,13,.6)", padding: "2px 7px", borderRadius: 6,
              pointerEvents: "none",
            }}
          >
            ES {last.close.toFixed(2)}
          </div>
        )}
      </div>
    </div>
  );
}
