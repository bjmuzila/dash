"use client";

/**
 * Footprint — live big-order map for the front ES future (ESU6).
 *
 * Two synced lanes, mirroring the reference design:
 *   • Big Trade Bubbles — each large print is a circle sized by contract count,
 *     green = aggressive buy (lifted ask), red = aggressive sell (hit bid),
 *     laid out left→right in time.
 *   • Delta Profile — per-minute signed volume (buy − sell) as up/down bars.
 *
 * Data comes from server-v2 over /ws/gex via useEsBigTrades (no client compute
 * of the aggressor side — that's classified server-side against the live bid/ask).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePageLoadStatus } from "@/lib/pageStatus";
import { useEsBigTrades, type EsBigTrade, type EsDeltaBucket } from "@/hooks/useEsBigTrades";

const BUY = "#22c55e";
const SELL = "#ef4444";

function etClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "HH:MM" ET for a timestamp — used for the shared time axis on both lanes. */
function etHM(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/**
 * Draw evenly-spaced ET time ticks along the bottom of a lane. `xOf` maps a
 * timestamp to a canvas x. Both lanes call this with the SAME [minTs,maxTs] so
 * their axes line up vertically.
 */
function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  padL: number, chartW: number, bottomY: number,
  minTs: number, maxTs: number,
  ticks = 6,
) {
  if (!(maxTs > minTs)) return;
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.42)";
  ctx.font = `${9 * dpr}px monospace`;
  ctx.textBaseline = "top";
  for (let i = 0; i <= ticks; i++) {
    const f = i / ticks;
    const ts = minTs + f * (maxTs - minTs);
    const x = padL + f * chartW;
    ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
    // Faint vertical guide.
    ctx.strokeStyle = "rgba(255,255,255,.05)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(x, bottomY - 4 * dpr);
    ctx.lineTo(x, bottomY);
    ctx.stroke();
    ctx.fillText(etHM(ts), x, bottomY + 3 * dpr);
  }
  ctx.restore();
}

// ── Big Trade Bubbles canvas ───────────────────────────────────────────────────

interface BubbleHit {
  cx: number; cy: number; r: number; // CSS px
  ts: number; buyVol: number; sellVol: number; total: number; net: number; count: number;
}

function BubblesCanvas({ trades, range, sessionMax }: { trades: EsBigTrade[]; range: { min: number; max: number } | null; sessionMax: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<BubbleHit[]>([]);
  const [hover, setHover] = useState<{ hit: BubbleHit; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    const padL = 8 * dpr, padR = 56 * dpr, padY = 10 * dpr;
    const axisH = 16 * dpr; // room for the time axis at the bottom
    const chartW = W - padL - padR;
    const plotH = H - axisH;
    const midY = plotH / 2;

    // Baseline.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(padL, midY);
    ctx.lineTo(padL + chartW, midY);
    ctx.stroke();
    ctx.restore();

    // Shared time axis (same range as the delta lane).
    const minTs = range?.min ?? (trades[0]?.ts ?? 0);
    const maxTs = range?.max ?? (trades[trades.length - 1]?.ts ?? minTs + 1);
    drawTimeAxis(ctx, dpr, padL, chartW, plotH, minTs, maxTs);

    if (!trades.length) return;

    // ── Aggregate to ONE bubble per 1-minute bar ────────────────────────────
    // Order-flow convention: collapse all big prints in a minute into a single
    // bubble, sized by total volume, colored by the dominant (net) side. Keeps
    // the lane readable instead of stacking dozens of overlapping circles.
    const BUCKET_MS = 60_000;
    const cells = new Map<number, { ts: number; buyVol: number; sellVol: number; count: number }>();
    for (const t of trades) {
      const start = Math.floor(t.ts / BUCKET_MS) * BUCKET_MS;
      const c = cells.get(start) || { ts: start, buyVol: 0, sellVol: 0, count: 0 };
      if (t.side === "buy") c.buyVol += t.size; else c.sellVol += t.size;
      c.count += 1;
      cells.set(start, c);
    }
    const bubbles = [...cells.values()]
      .map((c) => {
        const total = c.buyVol + c.sellVol;
        const net = c.buyVol - c.sellVol;
        return { ts: c.ts, buyVol: c.buyVol, sellVol: c.sellVol, total, net, side: net >= 0 ? "buy" : "sell" as const, count: c.count };
      })
      // Only minutes inside the visible window.
      .filter((b) => b.ts + BUCKET_MS >= minTs && b.ts <= maxTs);

    if (!bubbles.length) return;
    const span = maxTs - minTs || 1;
    // Biggest bubble fills most of the lane height. Allow modest horizontal
    // overlap (slot * 0.85) so VOLUME — not minute spacing — drives the size;
    // this is what real order-flow tools do and keeps big prints prominent.
    const slotW = (BUCKET_MS / span) * chartW;
    const maxR = Math.max(8 * dpr, Math.min(midY - padY, slotW * 0.85)) * 0.75;
    const minR = Math.min(5 * dpr, maxR * 0.35);

    // Area ∝ volume against the SESSION max (passed in), so a bubble's size means
    // the same thing in every window — pan to a quiet stretch and bubbles are
    // genuinely small; pan to the heavy open and they're big. Absolute, not relative.
    const refVol = Math.max(1, sessionMax);
    const radiusFor = (total: number) => {
      const f = Math.min(1, total / refVol);
      return Math.max(minR, Math.sqrt(f) * maxR);
    };

    // Right-edge size scale labels reference the session max.
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.4)";
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${fmtInt(refVol)}`, padL + chartW + 8 * dpr, padY + 4 * dpr);
    ctx.fillText(fmtInt(refVol / 2), padL + chartW + 8 * dpr, midY);
    ctx.fillText("0", padL + chartW + 8 * dpr, plotH - padY - 4 * dpr);
    ctx.restore();

    // Baseline of gray dots: one per minute across the window. Minutes that have
    // a bubble are skipped (the bubble sits there instead).
    const bubbleMinutes = new Set(bubbles.map((b) => Math.floor(b.ts / BUCKET_MS)));
    const firstMin = Math.ceil(minTs / BUCKET_MS) * BUCKET_MS;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.22)";
    for (let t = firstMin; t <= maxTs; t += BUCKET_MS) {
      if (bubbleMinutes.has(Math.floor(t / BUCKET_MS))) continue;
      const x = padL + ((t + BUCKET_MS / 2 - minTs) / span) * chartW;
      ctx.beginPath();
      ctx.arc(x, midY, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const hits: BubbleHit[] = [];
    for (const b of bubbles) {
      const x = padL + ((b.ts + BUCKET_MS / 2 - minTs) / span) * chartW;
      const r = radiusFor(b.total);
      const isBuy = b.side === "buy";
      // Solid gradient orb (diagonal light→deep of the same hue) with a soft
      // colored glow — matching the reference dashboard look.
      const light = isBuy ? "74,222,128" : "248,113,113";  // green-400 / red-400
      const deep  = isBuy ? "21,128,61"  : "185,28,28";     // green-700 / red-700
      const glow  = isBuy ? "34,197,94"  : "239,68,68";     // green-500 / red-500
      const y = midY + (isBuy ? -1 : 1) * (r * 0.18);
      hits.push({ cx: x / dpr, cy: y / dpr, r: r / dpr, ts: b.ts, buyVol: b.buyVol, sellVol: b.sellVol, total: b.total, net: b.net, count: b.count });

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.shadowColor = `rgba(${glow},.55)`;
      ctx.shadowBlur = Math.max(8 * dpr, r * 0.6);
      // Diagonal gradient: bright top-left → deep bottom-right.
      const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
      grad.addColorStop(0, `rgba(${light},1)`);
      grad.addColorStop(1, `rgba(${deep},1)`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }
    hitsRef.current = hits;
  });

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Nearest bubble under the cursor (a little slack for easy hovering).
    let best: BubbleHit | null = null;
    let bestD = Infinity;
    for (const h of hitsRef.current) {
      const d = Math.hypot(mx - h.cx, my - h.cy);
      if (d <= h.r + 4 && d < bestD) { best = h; bestD = d; }
    }
    setHover(best ? { hit: best, x: mx, y: my } : null);
  };

  return (
    <>
      <canvas
        ref={ref}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg px-3 py-2 font-mono text-[11px] leading-relaxed"
          style={{
            left: hover.x + 130 > (ref.current?.clientWidth ?? 9999) ? hover.x - 130 : hover.x + 14,
            top: Math.max(8, hover.y - 78),
            background: "rgba(10,13,20,.96)",
            border: "1px solid rgba(255,255,255,.12)",
            boxShadow: "0 10px 30px rgba(0,0,0,.6)",
            color: "#e6eef5",
            whiteSpace: "nowrap",
          }}
        >
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white/45">{etHM(hover.hit.ts)} ET · {hover.hit.count} prints</div>
          <div style={{ color: BUY }}>Buy &nbsp;{fmtInt(hover.hit.buyVol)}</div>
          <div style={{ color: SELL }}>Sell {fmtInt(hover.hit.sellVol)}</div>
          <div className="mt-1 border-t pt-1" style={{ borderColor: "rgba(255,255,255,.1)" }}>
            Net <span style={{ color: hover.hit.net >= 0 ? BUY : SELL, fontWeight: 700 }}>{hover.hit.net >= 0 ? "+" : ""}{fmtInt(hover.hit.net)}</span>
            <span className="text-white/40"> · {fmtInt(hover.hit.total)} total</span>
          </div>
        </div>
      )}
    </>
  );
}

// ── Delta Profile canvas ───────────────────────────────────────────────────────

function DeltaCanvas({ delta, range, sessionMax }: { delta: EsDeltaBucket[]; range: { min: number; max: number } | null; sessionMax: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.max(1, Math.floor(rect.width * dpr));
    const H = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);

    const padL = 8 * dpr, padR = 56 * dpr, padY = 8 * dpr;
    const axisH = 16 * dpr; // room for the time axis at the bottom
    const chartW = W - padL - padR;
    const plotH = H - axisH;
    const midY = plotH / 2;
    const half = midY - padY;

    // Zero line.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(padL, midY);
    ctx.lineTo(padL + chartW, midY);
    ctx.stroke();
    ctx.restore();

    // Shared time axis (same range as the bubbles lane).
    const minTs = range?.min ?? (delta[0]?.ts ?? 0);
    const maxTs = range?.max ?? ((delta[delta.length - 1]?.ts ?? minTs) + 60_000);
    drawTimeAxis(ctx, dpr, padL, chartW, plotH, minTs, maxTs);

    // Only buckets inside the visible window — scale to what's shown.
    const vis = delta.filter((d) => d.ts + 60_000 >= minTs && d.ts <= maxTs);
    // Bar height scales to the SESSION-wide max, not the visible window — so a bar
    // means the same thing no matter where you've panned (matches the bubbles).
    const maxAbs = Math.max(1, sessionMax);

    // Right-edge scale (+max / 0 / -max).
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${fmtInt(maxAbs)}`, padL + chartW + 8 * dpr, padY + 4 * dpr);
    ctx.fillText("0", padL + chartW + 8 * dpr, midY);
    ctx.fillText(`-${fmtInt(maxAbs)}`, padL + chartW + 8 * dpr, plotH - padY - 4 * dpr);
    ctx.restore();

    if (!vis.length) return;

    // Position each minute bar by its timestamp within the shared window so it
    // sits directly under the matching bubbles. Width tracks the bucket size.
    const span = maxTs - minTs || 1;
    const bucketMs = 60_000;
    const barW = Math.min(14 * dpr, Math.max(3 * dpr, (bucketMs / span) * chartW * 0.7));
    // The last bucket is the currently-forming minute (cumulative-within-minute,
    // still filling). Highlight it so the live build is visible; it resets to 0
    // when the next minute starts.
    const activeTs = delta[delta.length - 1]?.ts ?? -1;
    for (const d of vis) {
      // Center the bar in the middle of its minute.
      const cx = padL + ((d.ts + bucketMs / 2 - minTs) / span) * chartW;
      const x = cx - barW / 2;
      const h = (Math.abs(d.net) / maxAbs) * half;
      const color = d.net >= 0 ? BUY : SELL;
      const active = d.ts === activeTs;
      ctx.save();
      ctx.fillStyle = color + (active ? "ff" : "cc");
      if (active) { ctx.shadowColor = color; ctx.shadowBlur = 6 * dpr; }
      if (d.net >= 0) ctx.fillRect(x, midY - h, barW, h);
      else ctx.fillRect(x, midY, barW, h);
      ctx.restore();
    }
  });

  return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />;
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function FootprintPage() {
  usePageLoadStatus({ pageKey: "footprint", pageLabel: "Footprint", path: "/footprint" });
  const { symbol, updatedAt, trades: rawTrades, delta: rawDelta, connected, seeded } = useEsBigTrades();

  // ── Min-size view filter ────────────────────────────────────────────────────
  // Purely visual: drops prints below `minSize` before anything is drawn. The raw
  // feed (rawTrades/rawDelta) is untouched — clearing the filter restores it all.
  // Default 50 so the page opens on the bigger players, not 1-lot noise.
  const SIZE_MIN = 1;
  const SIZE_MAX = 100;
  const [minSize, setMinSize] = useState(50);

  // Rolling order feed (below the lanes): collapsible, scrollable.
  const [feedOpen, setFeedOpen] = useState(true);

  // Filtered prints used by every downstream view.
  const trades = useMemo(
    () => (minSize > SIZE_MIN ? rawTrades.filter((t) => t.size >= minSize) : rawTrades),
    [rawTrades, minSize],
  );

  // Delta lane must reflect the same filter, so rebuild per-minute buckets from
  // the filtered prints rather than using the server's (unfiltered) delta. When
  // the filter is off, fall back to the server delta verbatim.
  const delta = useMemo<EsDeltaBucket[]>(() => {
    if (minSize <= SIZE_MIN) return rawDelta;
    const cells = new Map<number, { buy: number; sell: number }>();
    for (const t of trades) {
      const k = Math.floor(t.ts / 60_000) * 60_000;
      const c = cells.get(k) || { buy: 0, sell: 0 };
      if (t.side === "buy") c.buy += t.size; else c.sell += t.size;
      cells.set(k, c);
    }
    return [...cells.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ts, c]) => ({ ts, buy: c.buy, sell: c.sell, net: c.buy - c.sell }));
  }, [trades, rawDelta, minSize]);

  const stats = useMemo(() => {
    const buy = trades.filter((t) => t.side === "buy");
    const sell = trades.filter((t) => t.side === "sell");
    const buyVol = buy.reduce((a, t) => a + t.size, 0);
    const sellVol = sell.reduce((a, t) => a + t.size, 0);
    const net = buyVol - sellVol;
    const biggest = trades.reduce<EsBigTrade | null>((m, t) => (!m || t.size > m.size ? t : m), null);
    return { buyCount: buy.length, sellCount: sell.length, buyVol, sellVol, net, biggest };
  }, [trades]);

  const label = symbol ? symbol.replace(/:.*/, "") : "ESU6";

  // Full extent of available data across both series.
  const extent = useMemo(() => {
    const tsList: number[] = [
      ...trades.map((t) => t.ts),
      ...delta.map((d) => d.ts),
      ...delta.map((d) => d.ts + 60_000),
    ];
    if (!tsList.length) return null;
    return { min: Math.min(...tsList), max: Math.max(...tsList) };
  }, [trades, delta]);

  // Session-wide max per-minute volume — the bubble size reference, so a bubble's
  // size means the same thing no matter which window you've panned to.
  const sessionMaxMinuteVol = useMemo(() => {
    const cells = new Map<number, number>();
    for (const t of trades) {
      const k = Math.floor(t.ts / 60_000);
      cells.set(k, (cells.get(k) ?? 0) + t.size);
    }
    return Math.max(1, ...cells.values());
  }, [trades]);

  // Session-wide max |net delta| — same idea for the delta bars: bar height is
  // absolute to the whole session, not re-scaled to the visible window.
  const sessionMaxDelta = useMemo(() => {
    return Math.max(1, ...delta.map((d) => Math.abs(d.net)));
  }, [delta]);

  // ── Viewport: always a 30-minute window; drag right pans into history ───────
  const WINDOW_MS = 30 * 60 * 1000;
  // viewEnd = right edge of the window. null = "follow latest" (live mode).
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const dragRef = useRef<{ x: number; end: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Resolve the active window. When viewEnd is null we follow the newest data.
  const view = useMemo(() => {
    if (!extent) return null;
    const end = viewEnd ?? extent.max;
    const clampedEnd = Math.min(extent.max, Math.max(extent.min + WINDOW_MS, end));
    return { min: clampedEnd - WINDOW_MS, max: clampedEnd };
  }, [extent, viewEnd, WINDOW_MS]);

  const following = viewEnd === null;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!view) return;
    dragRef.current = { x: e.clientX, end: view.max };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [view]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    const panel = panelRef.current;
    if (!d || !panel || !extent) return;
    const w = panel.clientWidth || 1;
    // Drag right → move window back in time (pan to history).
    const deltaMs = ((e.clientX - d.x) / w) * WINDOW_MS;
    const nextEnd = d.end - deltaMs;
    setViewEnd(Math.min(extent.max, Math.max(extent.min + WINDOW_MS, nextEnd)));
  }, [extent, WINDOW_MS]);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  return (
    <div className="flex h-full flex-col" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <div>
          <div className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#38bdf8", boxShadow: "0 0 10px #38bdf8" }} />
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-white/90">
              Footprint <span className="text-white/35">·</span> Big Orders
            </div>
          </div>
          <div className="mt-1 text-xs text-white/55">
            Real-time large prints on the front ES future ({label}) · buy = lifted ask, sell = hit bid.
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {seeded && (
            <span className="rounded border px-2 py-1 font-mono font-bold" style={{ borderColor: "rgba(56,189,248,.45)", color: "#38bdf8", background: "rgba(56,189,248,.1)" }} title="Showing replayed time & sales from a seed file, not the live feed">
              SEEDED
            </span>
          )}
          <span className="rounded border px-2 py-1 font-mono" style={{ borderColor: "rgba(255,255,255,.12)", color: seeded ? "#38bdf8" : connected ? "#22c55e" : "#ef4444", background: seeded ? "rgba(56,189,248,.1)" : connected ? "#0c2a1e" : "#1a0a0a" }}>
            {seeded ? "REPLAY" : connected ? "LIVE" : "WAITING"}
          </span>
          <span className="rounded border px-2 py-1 text-white/70" style={{ borderColor: "rgba(255,255,255,.12)" }}>
            {updatedAt ? etClock(updatedAt) : "—"}
          </span>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <StatCard label="Net Delta (prints)" value={`${stats.net >= 0 ? "+" : ""}${fmtInt(stats.net)}`} color={stats.net >= 0 ? BUY : SELL} sub={`${fmtInt(stats.buyVol)} buy / ${fmtInt(stats.sellVol)} sell`} />
        <StatCard label="Buy Orders" value={fmtInt(stats.buyCount)} color={BUY} sub={`${fmtInt(stats.buyVol)} contracts`} />
        <StatCard label="Sell Orders" value={fmtInt(stats.sellCount)} color={SELL} sub={`${fmtInt(stats.sellVol)} contracts`} />
        <StatCard label="Biggest Print" value={stats.biggest ? fmtInt(stats.biggest.size) : "—"} color={stats.biggest ? (stats.biggest.side === "buy" ? BUY : SELL) : "#94a3b8"} sub={stats.biggest ? `${stats.biggest.side.toUpperCase()} @ ${stats.biggest.price.toFixed(2)}` : "waiting for prints"} />
      </div>

      {/* Min-size filter */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
          Min order size
        </div>
        <input
          type="range"
          min={SIZE_MIN}
          max={SIZE_MAX}
          step={1}
          value={minSize}
          onChange={(e) => setMinSize(Number(e.target.value))}
          className="h-1 w-44 cursor-pointer accent-sky-400"
          style={{ accentColor: "#38bdf8" }}
        />
        <span className="font-mono text-[11px] text-white/70">
          ≥ {fmtInt(minSize)} <span className="text-white/35">contracts</span>
        </span>
        {minSize > SIZE_MIN && (
          <button
            onClick={() => setMinSize(SIZE_MIN)}
            className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
            style={{ border: "1px solid rgba(255,255,255,.15)", color: "#cbd5e1", background: "rgba(255,255,255,.04)" }}
          >
            Clear
          </button>
        )}
        <span className="font-mono text-[10px] text-white/35">
          showing {fmtInt(trades.length)} / {fmtInt(rawTrades.length)} prints
        </span>
      </div>

      {/* Window controls */}
      <div className="flex items-center justify-between px-4 pb-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
          30-min window · drag to pan history
        </div>
        <div className="flex items-center gap-2">
          {view && (
            <span className="font-mono text-[10px] text-white/45">
              {etHM(view.min)} – {etHM(view.max)} ET
            </span>
          )}
          <button
            onClick={() => setViewEnd(null)}
            disabled={following}
            className="rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
            style={{
              border: `1px solid ${following ? "rgba(34,197,94,.4)" : "rgba(255,255,255,.15)"}`,
              color: following ? "#22c55e" : "#cbd5e1",
              background: following ? "rgba(34,197,94,.1)" : "rgba(255,255,255,.04)",
              cursor: following ? "default" : "pointer",
            }}
          >
            {following ? "● Live" : "Jump to latest"}
          </button>
        </div>
      </div>

      {/* Draggable viewport: both lanes share one pan gesture so they stay locked. */}
      <div
        ref={panelRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ cursor: dragRef.current ? "grabbing" : "grab", touchAction: "none" }}
      >
        {/* Big Trade Bubbles lane */}
        <Lane
          title="Big Trade Bubbles"
          subtitle="(real-time)"
          legend={[{ c: BUY, t: "Buys" }, { c: SELL, t: "Sells" }]}
          empty={!trades.length}
          emptyText={connected ? "No big prints yet — waiting for large ES orders" : "Connecting to live feed…"}
        >
          <BubblesCanvas trades={trades} range={view} sessionMax={sessionMaxMinuteVol} />
        </Lane>

        {/* Delta Profile lane */}
        <Lane
          title="Delta Profile"
          subtitle="(real-time · per-minute cumulative)"
          legend={[{ c: BUY, t: "Positive" }, { c: SELL, t: "Negative" }]}
          empty={!delta.length}
          emptyText={connected ? "No delta yet — waiting for ES trade flow" : "Connecting to live feed…"}
        >
          <DeltaCanvas delta={delta} range={view} sessionMax={sessionMaxDelta} />
        </Lane>
      </div>

      {/* Rolling order feed — same min-size filter as the lanes, newest first. */}
      <OrderFeed trades={trades} open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} minSize={minSize} />
    </div>
  );
}

// ── Rolling order feed ────────────────────────────────────────────────────────

function OrderFeed({ trades, open, onToggle, minSize }: {
  trades: EsBigTrade[]; open: boolean; onToggle: () => void; minSize: number;
}) {
  // Newest first. Cap the rendered rows so a full session day stays smooth to scroll.
  const rows = useMemo(() => [...trades].reverse().slice(0, 500), [trades]);

  return (
    <div className="px-4 pb-4">
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: "linear-gradient(180deg, rgba(20,24,33,.65) 0%, rgba(8,11,17,.92) 100%)",
          border: "1px solid rgba(255,255,255,.07)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.05), 0 8px 28px rgba(0,0,0,.45)",
        }}
      >
        {/* Header / collapse toggle */}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.03]"
          style={{ cursor: "pointer" }}
        >
          <div className="flex items-center gap-2">
            <span
              className="inline-block transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", color: "rgba(255,255,255,.5)", fontSize: 10 }}
            >
              ▶
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/90">Order Feed</span>
            <span className="text-[9px] uppercase tracking-[0.14em] text-white/35">
              ≥ {fmtInt(minSize)} contracts · {fmtInt(trades.length)} prints
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-white/45">{open ? "Hide" : "Show"}</span>
        </button>

        {open && (
          <div>
            {/* Column header */}
            <div
              className="grid px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/35"
              style={{ gridTemplateColumns: "84px 1fr 88px 76px", borderTop: "1px solid rgba(255,255,255,.06)" }}
            >
              <span>Time</span>
              <span>Side</span>
              <span className="text-right">Price</span>
              <span className="text-right">Size</span>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-white/35">
                  No prints at ≥ {fmtInt(minSize)} contracts — lower the filter to see more.
                </div>
              ) : (
                rows.map((t, i) => {
                  const isBuy = t.side === "buy";
                  const c = isBuy ? BUY : SELL;
                  return (
                    <div
                      key={`${t.ts}-${i}`}
                      className="grid items-center px-4 py-1 font-mono text-[11px]"
                      style={{
                        gridTemplateColumns: "84px 1fr 88px 76px",
                        borderTop: "1px solid rgba(255,255,255,.03)",
                        background: `linear-gradient(90deg, ${c}10, transparent 60%)`,
                      }}
                    >
                      <span className="text-white/55">{etClock(t.ts)}</span>
                      <span style={{ color: c, fontWeight: 700 }}>{isBuy ? "BUY" : "SELL"}</span>
                      <span className="text-right text-white/70">{t.price.toFixed(2)}</span>
                      <span className="text-right" style={{ color: c, fontWeight: 700 }}>{fmtInt(t.size)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string; color: string; sub: string }) {
  return (
    <div
      className="card-hover relative overflow-hidden rounded-xl p-4"
      style={{
        borderTop: "1px solid rgba(255,255,255,.06)",
        borderRight: "1px solid rgba(255,255,255,.06)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        borderLeft: `3px solid ${color}`,
        background: `linear-gradient(135deg, ${color}1f 0%, rgba(255,255,255,.02) 45%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,.04), 0 0 22px ${color}14`,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: `${color}cc` }}>{label}</div>
      <div className="mt-2 text-3xl font-black" style={{ color, fontFamily: "monospace", textShadow: `0 0 18px ${color}55` }}>{value}</div>
      <div className="mt-1 text-[11px] text-white/55 font-mono">{sub}</div>
    </div>
  );
}

function Lane({ title, subtitle, legend, empty, emptyText, children }: {
  title: string; subtitle: string;
  legend: { c: string; t: string }[];
  empty: boolean; emptyText: string;
  children: ReactNode;
}) {
  return (
    <div className="px-4 pb-4">
      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          height: 240,
          background: "linear-gradient(180deg, rgba(20,24,33,.65) 0%, rgba(8,11,17,.92) 100%)",
          border: "1px solid rgba(255,255,255,.07)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,.05), 0 8px 28px rgba(0,0,0,.45)",
        }}
      >
        {/* Soft top sheen */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)" }} />

        {/* Lane label block */}
        <div className="absolute left-4 top-3 z-10">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/90">{title}</div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-white/35">{subtitle}</div>
          <div className="mt-1.5 flex items-center gap-3">
            {legend.map((l) => (
              <span key={l.t} className="flex items-center gap-1.5 text-[10px] font-medium text-white/55">
                <span style={{ width: 7, height: 7, borderRadius: 999, background: l.c, boxShadow: `0 0 6px ${l.c}` }} />
                {l.t}
              </span>
            ))}
          </div>
        </div>
        {children}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white/35">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
