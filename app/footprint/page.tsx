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

// ── Trading sessions (ET) ─────────────────────────────────────────────────────
// Day (RTH):       09:30 – 17:30
// Overnight (ETH): 18:00 – 09:30 (wraps midnight)
// 17:30 – 18:00 is a dead zone, excluded from both.
type Session = "day" | "overnight";

/** Minutes-since-ET-midnight for a timestamp. */
function etMinutes(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

const DAY_OPEN = 9 * 60 + 30;   // 09:30
const DAY_CLOSE = 17 * 60 + 30; // 17:30
const ETH_OPEN = 18 * 60;       // 18:00

/** Which session a timestamp belongs to, or null if in the 17:30–18:00 dead zone. */
function sessionOf(ts: number): Session | null {
  const mins = etMinutes(ts);
  if (mins >= DAY_OPEN && mins < DAY_CLOSE) return "day";
  if (mins >= ETH_OPEN || mins < DAY_OPEN) return "overnight";
  return null; // 17:30–18:00
}

/** "HH:MM" ET for a timestamp — used for the shared time axis on both lanes. */
function etHM(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Order-feed aggregation (shared by the feed + the Biggest Print card) ───────
type FeedMode = "raw" | "agg";
interface FeedRow { ts: number; side: "buy" | "sell"; price: number; size: number; count: number; }
const FEED_AGG_MS = 1000;

/**
 * Combine same-side prints within each FEED_AGG_MS window into one row (last price
 * wins). In "raw" mode each print maps to its own row. Returned newest-first.
 */
function aggregatePrints(prints: EsBigTrade[], mode: FeedMode): FeedRow[] {
  if (mode === "raw") {
    return prints.map((t) => ({ ts: t.ts, side: t.side, price: t.price, size: t.size, count: 1 }));
  }
  const cells = new Map<string, FeedRow>();
  for (const t of prints) {
    const win = Math.floor(t.ts / FEED_AGG_MS) * FEED_AGG_MS;
    const key = `${win}:${t.side}`;
    const c = cells.get(key);
    if (c) {
      c.size += t.size;
      c.count += 1;
      if (t.ts >= c.ts) { c.ts = t.ts; c.price = t.price; }
    } else {
      cells.set(key, { ts: t.ts, side: t.side, price: t.price, size: t.size, count: 1 });
    }
  }
  return [...cells.values()].sort((a, b) => b.ts - a.ts);
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
  ctx.fillStyle = "#ffffff";
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

type BubbleMetric = "total" | "net";

function BubblesCanvas({ trades, range, sessionMax, metric }: { trades: EsBigTrade[]; range: { min: number; max: number } | null; sessionMax: number; metric: BubbleMetric }) {
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
    // Keep a tiny visible floor so a 1-contract minute is still clickable, but make
    // it genuinely small (was 0.35*maxR, which flattened the whole size range).
    const minR = Math.min(3 * dpr, maxR * 0.08);

    // Area ∝ the chosen metric against the SESSION max, so a bubble's size means the
    // same thing in every window. metric="total" → buy+sell volume; "net" → |buy−sell|,
    // which matches the Delta Profile bar so a small bar reads as a small bubble.
    const refVol = Math.max(1, sessionMax);
    const radiusFor = (value: number) => {
      const f = Math.min(1, value / refVol);
      return Math.max(minR, Math.sqrt(f) * maxR);
    };
    const sizeOf = (b: { total: number; net: number }) =>
      metric === "net" ? Math.abs(b.net) : b.total;

    // Right-edge size scale labels reference the session max.
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${fmtInt(refVol)}`, padL + chartW + 8 * dpr, padY + 4 * dpr);
    ctx.fillText(metric === "net" ? "|net|" : "vol", padL + chartW + 8 * dpr, midY);
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
      const r = radiusFor(sizeOf(b));
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
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white">{etHM(hover.hit.ts)} ET · {hover.hit.count} prints</div>
          <div style={{ color: BUY }}>Buy &nbsp;{fmtInt(hover.hit.buyVol)}</div>
          <div style={{ color: SELL }}>Sell {fmtInt(hover.hit.sellVol)}</div>
          <div className="mt-1 border-t pt-1" style={{ borderColor: "rgba(255,255,255,.1)" }}>
            Net <span style={{ color: hover.hit.net >= 0 ? BUY : SELL, fontWeight: 700 }}>{hover.hit.net >= 0 ? "+" : ""}{fmtInt(hover.hit.net)}</span>
            <span className="text-white"> · {fmtInt(hover.hit.total)} total</span>
          </div>
        </div>
      )}
    </>
  );
}

// ── Delta Profile canvas ───────────────────────────────────────────────────────

interface DeltaHit {
  cx: number; // bar center, CSS px
  hw: number; // half-width hit slack, CSS px
  ts: number; buy: number; sell: number; net: number;
}

function DeltaCanvas({ delta, range, sessionMax }: { delta: EsDeltaBucket[]; range: { min: number; max: number } | null; sessionMax: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<DeltaHit[]>([]);
  const [hover, setHover] = useState<{ hit: DeltaHit; x: number; y: number } | null>(null);

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
    ctx.fillStyle = "#ffffff";
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
    const hits: DeltaHit[] = [];
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
      // Hit slot spans the full minute width so the whole column is hoverable,
      // not just the (possibly thin) bar.
      const slotHalf = Math.max(barW, (bucketMs / span) * chartW) / 2;
      hits.push({ cx: cx / dpr, hw: slotHalf / dpr, ts: d.ts, buy: d.buy, sell: d.sell, net: d.net });
    }
    hitsRef.current = hits;
  });

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best: DeltaHit | null = null;
    let bestD = Infinity;
    for (const h of hitsRef.current) {
      const d = Math.abs(mx - h.cx);
      if (d <= h.hw && d < bestD) { best = h; bestD = d; }
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
          <div className="mb-1 text-[10px] uppercase tracking-wider text-white">{etHM(hover.hit.ts)} ET</div>
          <div style={{ color: BUY }}>Buy &nbsp;{fmtInt(hover.hit.buy)}</div>
          <div style={{ color: SELL }}>Sell {fmtInt(hover.hit.sell)}</div>
          <div className="mt-1 border-t pt-1" style={{ borderColor: "rgba(255,255,255,.1)" }}>
            Net <span style={{ color: hover.hit.net >= 0 ? BUY : SELL, fontWeight: 700 }}>{hover.hit.net >= 0 ? "+" : ""}{fmtInt(hover.hit.net)}</span>
            <span className="text-white"> · {fmtInt(hover.hit.buy + hover.hit.sell)} total</span>
          </div>
        </div>
      )}
    </>
  );
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
  const [minSize, setMinSize] = useState(SIZE_MIN);

  // Rolling order feed (below the lanes): collapsible, scrollable.
  const [feedOpen, setFeedOpen] = useState(true);
  // Feed mode lifted to the page so the Biggest Print card can match it:
  // "raw" = per-tick, "agg" = same-side prints combined per 1000ms.
  const [feedMode, setFeedMode] = useState<FeedMode>("raw");

  // What drives bubble size: "total" (buy+sell) or "net" (|buy−sell|, matches the
  // Delta Profile bar so a small bar reads as a small bubble).
  const [bubbleMetric, setBubbleMetric] = useState<BubbleMetric>("net");

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

  // Current session (by `updatedAt`, the live clock). In the 17:30–18:00 dead zone
  // we report the Day session that just closed.
  const currentSession: Session = useMemo(() => {
    const now = updatedAt || Date.now();
    return sessionOf(now) ?? "day";
  }, [updatedAt]);

  // Stats reflect ONLY the current session's prints (Day 9:30–17:30 ET, or
  // Overnight 18:00–9:30 ET). Prints outside the active session are excluded.
  const stats = useMemo(() => {
    const inSession = trades.filter((t) => sessionOf(t.ts) === currentSession);
    const buy = inSession.filter((t) => t.side === "buy");
    const sell = inSession.filter((t) => t.side === "sell");
    const buyVol = buy.reduce((a, t) => a + t.size, 0);
    const sellVol = sell.reduce((a, t) => a + t.size, 0);
    const net = buyVol - sellVol;
    // Biggest "print" follows the feed mode: in agg mode it's the largest same-side
    // 1s-combined order; in raw mode it's the largest single tick.
    const biggest = aggregatePrints(inSession, feedMode)
      .reduce<FeedRow | null>((m, r) => (!m || r.size > m.size ? r : m), null);
    return { buyCount: buy.length, sellCount: sell.length, buyVol, sellVol, net, biggest };
  }, [trades, currentSession, feedMode]);

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

  // Session-wide per-minute maxima, computed from the SAME filtered prints the
  // bubbles use, so the size scale matches whichever metric is selected:
  //   total = max(buy+sell) per minute   ·   net = max|buy−sell| per minute
  const { sessionMaxMinuteVol, sessionMaxMinuteNet } = useMemo(() => {
    const cells = new Map<number, { buy: number; sell: number }>();
    for (const t of trades) {
      const k = Math.floor(t.ts / 60_000);
      const c = cells.get(k) || { buy: 0, sell: 0 };
      if (t.side === "buy") c.buy += t.size; else c.sell += t.size;
      cells.set(k, c);
    }
    let maxTot = 1, maxNet = 1;
    for (const c of cells.values()) {
      maxTot = Math.max(maxTot, c.buy + c.sell);
      maxNet = Math.max(maxNet, Math.abs(c.buy - c.sell));
    }
    return { sessionMaxMinuteVol: maxTot, sessionMaxMinuteNet: maxNet };
  }, [trades]);

  // Session-wide max |net delta| — same idea for the delta bars: bar height is
  // absolute to the whole session, not re-scaled to the visible window.
  const sessionMaxDelta = useMemo(() => {
    return Math.max(1, ...delta.map((d) => Math.abs(d.net)));
  }, [delta]);

  // ── Viewport: a time window you can pan (drag) and zoom (mouse wheel) ────────
  // windowMs is the visible span; wheel compresses/expands it between 5m and 8h.
  const WINDOW_MIN_MS = 5 * 60 * 1000;
  const WINDOW_MAX_MS = 8 * 60 * 60 * 1000;
  const [windowMs, setWindowMs] = useState(60 * 60 * 1000);
  const WINDOW_MS = windowMs;
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

  // Mouse wheel zooms the time window (compress/expand the x-axis). Must be a
  // NON-PASSIVE native listener — React's onWheel is passive, so preventDefault()
  // there is ignored and the page scrolls instead of zooming. We keep the latest
  // zoom inputs in a ref so the native listener (attached once) reads fresh values.
  const wheelState = useRef({ extent, view, windowMs });
  wheelState.current = { extent, view, windowMs };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handler = (e: WheelEvent) => {
      const { extent: ext, view: v, windowMs: wms } = wheelState.current;
      if (!ext || !v) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const w = rect.width || 1;
      const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / w)); // 0..1 across panel
      const cursorTs = v.min + fx * (v.max - v.min);                    // ts under cursor

      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // down = wider, up = narrower
      const nextSpan = Math.min(WINDOW_MAX_MS, Math.max(WINDOW_MIN_MS, wms * factor));
      if (nextSpan === wms) return;

      const rawEnd = cursorTs + (1 - fx) * nextSpan;
      const clampedEnd = Math.min(ext.max, Math.max(ext.min + nextSpan, rawEnd));
      setWindowMs(nextSpan);
      setViewEnd(clampedEnd >= ext.max ? null : clampedEnd);
    };
    panel.addEventListener("wheel", handler, { passive: false });
    return () => panel.removeEventListener("wheel", handler);
  }, [WINDOW_MIN_MS, WINDOW_MAX_MS]);

  return (
    <div className="flex h-full flex-col overflow-y-auto" style={{ background: "linear-gradient(180deg,#06080d,#0b1018)" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.08)" }}>
        <div>
          <div className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#38bdf8", boxShadow: "0 0 10px #38bdf8" }} />
            <div className="text-xs font-bold uppercase tracking-[0.24em] text-white">
              Footprint <span className="text-white">·</span> Big Orders
            </div>
          </div>
          <div className="mt-1 text-xs text-white">
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
          <span className="rounded border px-2 py-1 text-white" style={{ borderColor: "rgba(255,255,255,.12)" }}>
            {updatedAt ? etClock(updatedAt) : "—"}
          </span>
        </div>
      </div>

      {/* Session label */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-white">Session</span>
        <span
          className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{
            color: currentSession === "day" ? "#38bdf8" : "#a78bfa",
            background: currentSession === "day" ? "rgba(56,189,248,.12)" : "rgba(167,139,250,.12)",
            border: `1px solid ${currentSession === "day" ? "rgba(56,189,248,.4)" : "rgba(167,139,250,.4)"}`,
          }}
        >
          {currentSession === "day" ? "Day · 9:30–5:30 ET" : "Overnight · 6:00pm–9:30am ET"}
        </span>
      </div>

      {/* Stat strip — current session only */}
      <div className="grid gap-3 px-4 pb-4 pt-2 md:grid-cols-4">
        <StatCard label="Net Delta (prints)" value={`${stats.net >= 0 ? "+" : ""}${fmtInt(stats.net)}`} color={stats.net >= 0 ? BUY : SELL} sub={`${fmtInt(stats.buyVol)} buy / ${fmtInt(stats.sellVol)} sell`} />
        <StatCard label="Buy Orders" value={fmtInt(stats.buyCount)} color={BUY} sub={`${fmtInt(stats.buyVol)} contracts`} />
        <StatCard label="Sell Orders" value={fmtInt(stats.sellCount)} color={SELL} sub={`${fmtInt(stats.sellVol)} contracts`} />
        <StatCard label={feedMode === "agg" ? "Biggest Order (1s)" : "Biggest Print"} value={stats.biggest ? fmtInt(stats.biggest.size) : "—"} color={stats.biggest ? (stats.biggest.side === "buy" ? BUY : SELL) : "#94a3b8"} sub={stats.biggest ? `${stats.biggest.side.toUpperCase()} @ ${stats.biggest.price.toFixed(2)}` : "waiting for prints"} />
      </div>

      {/* Min-size filter */}
      <div className="flex flex-wrap items-center gap-3 px-4 pb-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-white">
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
        <span className="font-mono text-[11px] text-white">
          ≥ {fmtInt(minSize)} <span className="text-white">contracts</span>
        </span>
        <span className="font-mono text-[10px] text-white">
          showing {fmtInt(trades.length)} / {fmtInt(rawTrades.length)} prints
        </span>
      </div>

      {/* Window controls */}
      <div className="flex items-center justify-between px-4 pb-1">
        <div className="text-[10px] uppercase tracking-[0.16em] text-white">
          {windowMs >= 60 * 60 * 1000
            ? `${(windowMs / 3_600_000).toFixed(windowMs % 3_600_000 ? 1 : 0)}-hr window`
            : `${Math.round(windowMs / 60_000)}-min window`} · drag to pan · scroll to zoom
        </div>
        <div className="flex items-center gap-2">
          {view && (
            <span className="font-mono text-[10px] text-white">
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

      {/* Draggable + zoomable viewport: both lanes share one pan/zoom gesture. */}
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
          headerRight={
            <div className="flex items-center gap-1 rounded-md p-0.5" style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)" }}>
              {(["net", "total"] as BubbleMetric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setBubbleMetric(m)}
                  className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors"
                  style={{
                    color: bubbleMetric === m ? "#0b1018" : "#ffffff",
                    background: bubbleMetric === m ? "#38bdf8" : "transparent",
                  }}
                  title={m === "net" ? "Size by net (buy−sell) — matches the Delta Profile bar" : "Size by total volume (buy+sell)"}
                >
                  {m}
                </button>
              ))}
            </div>
          }
        >
          <BubblesCanvas
            trades={trades}
            range={view}
            metric={bubbleMetric}
            sessionMax={bubbleMetric === "net" ? sessionMaxMinuteNet : sessionMaxMinuteVol}
          />
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

      {/* Rolling order feed. Aggregates from RAW prints so a big order that filled
          as many small ticks isn't lost to the size filter before being combined;
          the min-size filter is applied AFTER aggregation. */}
      <OrderFeed rawTrades={rawTrades} open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} minSize={minSize} mode={feedMode} setMode={setFeedMode} />
    </div>
  );
}

// ── Rolling order feed ────────────────────────────────────────────────────────

function OrderFeed({ rawTrades, open, onToggle, minSize, mode, setMode }: {
  rawTrades: EsBigTrade[]; open: boolean; onToggle: () => void; minSize: number;
  mode: FeedMode; setMode: (m: FeedMode) => void;
}) {
  // Aggregate (or not) from RAW prints, THEN filter the resulting rows by min size —
  // so an order built from sub-threshold ticks still shows once combined.
  const rows = useMemo<FeedRow[]>(() => {
    return aggregatePrints(rawTrades, mode)
      .filter((r) => r.size >= minSize)
      .slice(0, 500);
  }, [rawTrades, mode, minSize]);

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
        <div className="flex w-full items-center justify-between px-4 py-3">
          <button
            onClick={onToggle}
            className="flex items-center gap-2 transition-colors hover:opacity-80"
            style={{ cursor: "pointer" }}
          >
            <span
              className="inline-block transition-transform"
              style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", color: "#ffffff", fontSize: 10 }}
            >
              ▶
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-white">Order Feed</span>
            <span className="text-[9px] uppercase tracking-[0.14em] text-white">
              ≥ {fmtInt(minSize)} contracts · {fmtInt(rows.length)} {mode === "agg" ? "orders" : "prints"}
            </span>
          </button>
          <div className="flex items-center gap-3">
            {open && (
              <div className="flex items-center gap-1 rounded-md p-0.5" style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)" }}>
                {([["raw", "Raw"], ["agg", "1s"]] as [FeedMode, string][]).map(([m, lbl]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors"
                    style={{
                      color: mode === m ? "#0b1018" : "#ffffff",
                      background: mode === m ? "#38bdf8" : "transparent",
                    }}
                    title={m === "raw" ? "Every print" : "Combine prints within each 1000ms window"}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            <button onClick={onToggle} className="text-[10px] uppercase tracking-wider text-white" style={{ cursor: "pointer" }}>
              {open ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {open && (
          <div>
            {/* Column header */}
            <div
              className="grid px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white"
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
                <div className="px-4 py-6 text-center text-xs text-white">
                  No prints at ≥ {fmtInt(minSize)} contracts — lower the filter to see more.
                </div>
              ) : (
                rows.map((t, i) => {
                  const isBuy = t.side === "buy";
                  const c = isBuy ? BUY : SELL;
                  return (
                    <div
                      key={`${t.ts}-${t.side}-${i}`}
                      className="grid items-center px-4 py-1 font-mono text-[11px]"
                      style={{
                        gridTemplateColumns: "84px 1fr 88px 76px",
                        borderTop: "1px solid rgba(255,255,255,.03)",
                        background: `linear-gradient(90deg, ${c}10, transparent 60%)`,
                      }}
                    >
                      <span className="text-white">{etClock(t.ts)}</span>
                      <span style={{ color: c, fontWeight: 700 }}>
                        {isBuy ? "BUY" : "SELL"}
                        {mode === "agg" && t.count > 1 && (
                          <span className="ml-1 text-white" style={{ fontWeight: 400, opacity: 0.6 }}>×{t.count}</span>
                        )}
                      </span>
                      <span className="text-right text-white">{t.price.toFixed(2)}</span>
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
      <div className="mt-1 text-[11px] text-white font-mono">{sub}</div>
    </div>
  );
}

function Lane({ title, subtitle, legend, empty, emptyText, headerRight, children }: {
  title: string; subtitle: string;
  legend: { c: string; t: string }[];
  empty: boolean; emptyText: string;
  headerRight?: ReactNode;
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

        {/* Optional top-right control (e.g. bubble metric toggle) */}
        {headerRight && <div className="absolute right-14 top-3 z-20">{headerRight}</div>}

        {/* Lane label block */}
        <div className="absolute left-4 top-3 z-10">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white">{title}</div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-white">{subtitle}</div>
          <div className="mt-1.5 flex items-center gap-3">
            {legend.map((l) => (
              <span key={l.t} className="flex items-center gap-1.5 text-[10px] font-medium text-white">
                <span style={{ width: 7, height: 7, borderRadius: 999, background: l.c, boxShadow: `0 0 6px ${l.c}` }} />
                {l.t}
              </span>
            ))}
          </div>
        </div>
        {children}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-white">
            {emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
