"use client";

// ─────────────────────────────────────────────────────────────────────────────
// GexRegimeCard — the "market condition" card for a single ETF (SPY / QQQ),
// recreating the SPX regime tile:
//
//   ┌ Condition header ──────────────────────────────────────────────┐
//   │ Trend-Supportive (Bearish)   ★★★★★  5/5      Updated HH:MM ET   │
//   │  • WAVE bullet   • Path bullet   • Environment bullet           │
//   ├───────────────────────┬────────────────────────────────────────┤
//   │ WAVE                   │ GEX Structure · 0-DTE                   │
//   │  cumulative net call   │  net gamma by strike, green=support/   │
//   │  vs put premium (area) │  resistance, red=magnet (accel zone)   │
//   └───────────────────────┴────────────────────────────────────────┘
//
// Both panels are computed 100% client-side from feeds this app already serves:
//   WAVE          ← /proxy/flow-history?underlying=<sym>  (the same tape the
//                   /test Flow Inventory tab reads; FlowOrder carries premium,
//                   side, type and the underlying `spot` at print time).
//   GEX structure ← /api/chains?ticker=<sym>&range=all    (same endpoint
//                   /mult-greek uses). Per-strike net GEX =
//                     (|callΓ|·callOI − |putΓ|·putOI) · spot² · 0.01 · 100
//                   — identical to MultGreekClient.computeRows(), OI-only so it
//                   reads as classic dealer positioning (SqueezeMetrics style).
//
// NOTE: /proxy/gex is a single shared SPX-only feed, so it can't drive SPY/QQQ.
// That's why the structure panel derives gamma from the per-symbol chain instead.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { HOME_THEME } from "@/components/shared/homeTheme";
import { Card } from "@/components/shared/PageCard";
import type { FlowOrder } from "@/hooks/useSpxFlow";

const GREEN = "#22c55e"; // support / bullish
const RED = "#ef4444"; // magnet / bearish
const AXIS = "rgba(255,255,255,0.10)";
const SUB = "rgba(255,255,255,0.55)";

// ── Time helpers (ET) ────────────────────────────────────────────────────────
function todayEtYmd(): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}
// Epoch ms of today's ET midnight, derived from the current ET wall clock so
// it's correct under both EST and EDT without hardcoding an offset.
function etDayStartMs(): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  const minsSinceEtMidnight = h * 60 + m;
  return Date.now() - minsSinceEtMidnight * 60_000;
}
function etDaysTo(ymd: string): number {
  const today = todayEtYmd();
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}
function fmtEtTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}
function fmtUsdShort(n: number): string {
  const s = n < 0 ? "-" : n > 0 ? "+" : "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${Math.round(a)}`;
}

// ── WAVE: cumulative net directional premium series from the flow tape ────────
// Signed premium per print: bullish (buy call / sell put) adds, bearish
// (buy put / sell call) subtracts — so a falling WAVE = puts dominating.
type WavePoint = { ts: number; cum: number };
// Per-symbol intraday price samples. The flow tape's `spot` is stamped with the
// SPX index price on every underlying, so it can't drive the SPY/QQQ price line;
// instead we sample the correct per-symbol spot (chain underlyingPrice) each poll
// and persist it per symbol+day so the line fills across the session.
type PricePoint = { ts: number; price: number };
function priceKey(sym: string): string { return `regime-price:${sym}:${todayEtYmd()}`; }
function loadPriceSeries(sym: string): PricePoint[] {
  try { const raw = localStorage.getItem(priceKey(sym)); const p = raw ? JSON.parse(raw) : null; return Array.isArray(p) ? p : []; } catch { return []; }
}
function savePriceSeries(sym: string, s: PricePoint[]): void {
  try { localStorage.setItem(priceKey(sym), JSON.stringify(s.slice(-800))); } catch { /* no storage */ }
}
type WaveModel = {
  points: WavePoint[];
  final: number; // last cumulative net premium ($)
  extreme: number; // signed cum value furthest from zero
  gross: number; // Σ|premium| — for dominance normalization
  dir: "bull" | "bear";
  dominance: number; // |final| / gross, 0..1
  unwinding: boolean; // pulled back off its directional extreme
  prints: number;
};

function buildWave(tape: FlowOrder[]): WaveModel | null {
  if (!tape.length) return null;
  const sorted = tape.slice().sort((a, b) => a.ts - b.ts);
  let cum = 0, gross = 0, extreme = 0;
  const points: WavePoint[] = [];
  for (const o of sorted) {
    const prem = o.premium || 0;
    const isPut = o.type === "P";
    const isBuy = o.side === "buy";
    const bullish = (isBuy && !isPut) || (!isBuy && isPut);
    cum += bullish ? prem : -prem;
    gross += prem;
    if (Math.abs(cum) > Math.abs(extreme)) extreme = cum;
    points.push({ ts: o.ts, cum });
  }
  // Downsample to ~140 points so the SVG path stays light.
  const MAX = 140;
  const step = Math.max(1, Math.ceil(points.length / MAX));
  const thin = points.filter((_, i) => i % step === 0 || i === points.length - 1);

  const final = cum;
  const dir: "bull" | "bear" = final >= 0 ? "bull" : "bear";
  const dominance = gross > 0 ? Math.abs(final) / gross : 0;
  // "no signs of unwind" = still within 88% of its directional extreme, same sign.
  const sameSign = Math.sign(final) === Math.sign(extreme) && extreme !== 0;
  const unwinding = !sameSign || Math.abs(final) < 0.88 * Math.abs(extreme);
  return { points: thin, final, extreme, gross, dir, dominance, unwinding, prints: sorted.length };
}

// ── GEX structure: per-strike net gamma from the 0-DTE chain group ────────────
type GexLevel = { strike: number; gex: number };
type GexModel = {
  spot: number;
  expiry: string;
  levels: GexLevel[]; // window around spot, sorted DESC by strike (high on top)
  pos: number;
  neg: number;
  cleanBelow: boolean; // no positive-GEX support within band below spot
  cleanAbove: boolean; // no negative/…; mirror — no positive GEX resistance above
  nearestSupportBelow: number | null;
  nearestResistAbove: number | null;
};

type ChainOpt = { gamma?: unknown; "open-interest"?: unknown; openInterest?: unknown };
type ChainStrike = { "strike-price"?: unknown; call?: ChainOpt; put?: ChainOpt };
type ChainGroup = { "expiration-date"?: unknown; strikes?: ChainStrike[] };

function oiOf(o: ChainOpt | undefined): number {
  if (!o) return 0;
  return parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0;
}
function gammaOf(o: ChainOpt | undefined): number {
  if (!o) return 0;
  return parseFloat(String(o.gamma ?? 0)) || 0;
}

const WINDOW = 12; // strikes shown, centered on spot
const BAND_FRAC = 0.012; // ±1.2% band for "clean path" test

function buildGex(items: ChainGroup[], spot: number): GexModel | null {
  if (!items.length || !(spot > 0)) return null;
  // Pick the 0-DTE group: today's expiry if present, else the soonest future.
  const dated = items
    .map((g) => ({ g, ymd: String(g["expiration-date"] ?? "").slice(0, 10) }))
    .filter((x) => x.ymd)
    .map((x) => ({ ...x, dte: etDaysTo(x.ymd) }))
    .filter((x) => x.dte >= 0)
    .sort((a, b) => a.dte - b.dte);
  const pick = dated[0];
  if (!pick) return null;

  const all: GexLevel[] = [];
  for (const s of pick.g.strikes ?? []) {
    const strike = parseFloat(String(s["strike-price"] ?? 0));
    if (!strike) continue;
    const gex = (Math.abs(gammaOf(s.call)) * oiOf(s.call) - Math.abs(gammaOf(s.put)) * oiOf(s.put)) * spot * spot * 0.01 * 100;
    all.push({ strike, gex });
  }
  if (!all.length) return null;

  // Window = the WINDOW strikes closest to spot, displayed high→low.
  const window = all
    .slice()
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
    .slice(0, WINDOW)
    .sort((a, b) => b.strike - a.strike);

  const pos = window.filter((l) => l.gex > 0).length;
  const neg = window.filter((l) => l.gex < 0).length;

  const band = spot * BAND_FRAC;
  const supBelow = all.filter((l) => l.strike < spot && l.strike >= spot - band && l.gex > 0).sort((a, b) => b.strike - a.strike);
  const resAbove = all.filter((l) => l.strike > spot && l.strike <= spot + band && l.gex > 0).sort((a, b) => a.strike - b.strike);

  return {
    spot,
    expiry: pick.ymd,
    levels: window,
    pos,
    neg,
    cleanBelow: supBelow.length === 0,
    cleanAbove: resAbove.length === 0,
    nearestSupportBelow: supBelow[0]?.strike ?? null,
    nearestResistAbove: resAbove[0]?.strike ?? null,
  };
}

// ── Condition synthesis (label + stars + bullets) ─────────────────────────────
type Condition = {
  label: string;
  tone: string;
  stars: number;
  bullets: string[];
};

function synthesize(wave: WaveModel | null, gex: GexModel | null, symbol: string): Condition {
  if (!wave) {
    return { label: "Awaiting Flow", tone: SUB, stars: 0, bullets: ["No flow tape yet for today's session."] };
  }
  const bear = wave.dir === "bear";
  const dirWord = bear ? "bearish" : "bullish";
  const domWord = wave.dominance >= 0.28 ? "firmly" : wave.dominance >= 0.12 ? "moderately" : "mildly";
  const sideWord = bear ? "puts" : "calls";

  // Path cleanliness in the trade's direction (down for bears, up for bulls).
  const pathClean = gex ? (bear ? gex.cleanBelow : gex.cleanAbove) : false;
  const blocker = gex ? (bear ? gex.nearestSupportBelow : gex.nearestResistAbove) : null;

  // Stars: base on WAVE dominance, +1 when GEX path is clean, −1 when unwinding.
  let stars = wave.dominance >= 0.30 ? 4 : wave.dominance >= 0.18 ? 3 : wave.dominance >= 0.08 ? 2 : 1;
  if (pathClean && gex) stars += 1;
  if (wave.unwinding) stars -= 1;
  stars = Math.max(1, Math.min(5, stars));

  const strong = wave.dominance >= 0.12 && !wave.unwinding;
  let label: string, tone: string;
  if (strong && pathClean) { label = `Trend-Supportive (${bear ? "Bearish" : "Bullish"})`; tone = bear ? RED : GREEN; }
  else if (strong && !pathClean) { label = `Trend-Fighting (${bear ? "Bearish" : "Bullish"})`; tone = HOME_THEME.orange; }
  else { label = "Range-Bound / Chop"; tone = SUB; }

  const bullets: string[] = [];
  bullets.push(
    `WAVE is ${domWord} ${dirWord}; ${sideWord} are dominating${wave.unwinding ? ", but momentum is easing." : " with no signs of unwind."}`
  );
  if (gex) {
    const dirEdge = bear ? "below" : "above";
    if (pathClean) {
      bullets.push(`Path is clean ${dirEdge} spot ${gex.spot.toFixed(2)}; no ${bear ? "positive GEX support" : "positive GEX resistance"} ahead.`);
    } else if (blocker != null) {
      bullets.push(`Positive GEX at ${Math.round(blocker)} sits ${dirEdge} spot ${gex.spot.toFixed(2)} — can stall the move.`);
    } else {
      bullets.push(`Mixed gamma structure around spot ${gex.spot.toFixed(2)} — no clean path yet.`);
    }
  } else {
    bullets.push("0-DTE gamma structure loading…");
  }
  if (strong && pathClean) bullets.push(`Environment supports follow-through on ${dirWord} setups.`);
  else if (strong) bullets.push(`Structure resists the ${dirWord} tilt — fade extensions, size down.`);
  else bullets.push(`No dealer edge to lean on in ${symbol} — treat as two-sided.`);

  return { label, tone, stars, bullets };
}

// ── WAVE chart (SVG): net-premium area (green≥0 / red<0) + price line ─────────
function WaveChart({ wave, price }: { wave: WaveModel; price: PricePoint[] }) {
  const W = 360, H = 240, padL = 6, padR = 60, padT = 14, padB = 22;
  const pts = wave.points;
  const n = pts.length;
  // Shared TIME x-axis across the WAVE session; the price series aligns by ts
  // (both are epoch-ms), so the per-symbol price line lands on the right spot.
  const t0 = pts[0]?.ts ?? 0;
  const t1 = pts[n - 1]?.ts ?? t0 + 1;
  const span = Math.max(1, t1 - t0);
  const xs = (ts: number) => padL + ((ts - t0) / span) * (W - padL - padR);

  const cums = pts.map((p) => p.cum);
  const cumMax = Math.max(1, ...cums, 0);
  const cumMin = Math.min(-1, ...cums, 0);
  const yCum = (v: number) => padT + (1 - (v - cumMin) / (cumMax - cumMin)) * (H - padT - padB);
  const y0 = yCum(0);

  const pr = price.filter((p) => p.price > 0 && p.ts >= t0 && p.ts <= t1);
  const hasPrice = pr.length > 1;
  const prices = pr.map((p) => p.price);
  const pMax = hasPrice ? Math.max(...prices) : 0;
  const pMin = hasPrice ? Math.min(...prices) : 0;
  const yPrice = (v: number) => padT + (1 - (v - pMin) / Math.max(1e-6, pMax - pMin)) * (H - padT - padB);

  // Split the cumulative curve at zero-crossings so the fill/line color flips
  // exactly where the WAVE crosses 0 (green above, red below).
  type Seg = { sign: 1 | -1; d: string; area: string };
  const segs: Seg[] = [];
  let cur: { sign: 1 | -1; pts: { x: number; y: number }[] } | null = null;
  const push = (sign: 1 | -1, x: number, y: number) => {
    if (!cur || cur.sign !== sign) {
      if (cur && cur.pts.length) segs.push(seal(cur));
      cur = { sign, pts: [] };
    }
    cur.pts.push({ x, y });
  };
  const seal = (c: { sign: 1 | -1; pts: { x: number; y: number }[] }): Seg => {
    const line = c.pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const first = c.pts[0], last = c.pts[c.pts.length - 1];
    const area = `${line} L${last.x.toFixed(1)} ${y0.toFixed(1)} L${first.x.toFixed(1)} ${y0.toFixed(1)} Z`;
    return { sign: c.sign, d: line, area };
  };
  for (let i = 0; i < n; i++) {
    const v = cums[i], x = xs(pts[i].ts), y = yCum(v);
    const s: 1 | -1 = v >= 0 ? 1 : -1;
    if (i > 0) {
      const pv = cums[i - 1], px = xs(pts[i - 1].ts);
      if ((pv < 0 && v >= 0) || (pv > 0 && v <= 0)) {
        // interpolate the zero crossing so there's no color seam
        const frac = Math.abs(pv) / Math.max(1e-9, Math.abs(pv) + Math.abs(v));
        const cx = px + (x - px) * frac;
        push((pv < 0 ? -1 : 1) as 1 | -1, cx, y0);
        push(s, cx, y0);
      }
    }
    push(s, x, y);
  }
  if (cur) segs.push(seal(cur));

  const pricePath = hasPrice
    ? pr.map((p, i) => `${i ? "L" : "M"}${xs(p.ts).toFixed(1)} ${yPrice(p.price).toFixed(1)}`).join(" ")
    : "";

  const finalColor = wave.dir === "bull" ? GREEN : RED;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: "block" }}>
      <line x1={padL} x2={W - padR} y1={y0} y2={y0} stroke={AXIS} strokeWidth={1} strokeDasharray="3 3" />
      {segs.map((s, i) => (
        <path key={`a${i}`} d={s.area} fill={s.sign > 0 ? GREEN : RED} opacity={0.14} />
      ))}
      {segs.map((s, i) => (
        <path key={`l${i}`} d={s.d} fill="none" stroke={s.sign > 0 ? GREEN : RED} strokeWidth={2} />
      ))}
      {hasPrice && <path d={pricePath} fill="none" stroke={HOME_THEME.orange} strokeWidth={1.4} opacity={0.9} />}
      {/* left $ axis labels */}
      <text x={padL} y={yCum(cumMax) + 9} fontSize={9} fill={SUB}>{fmtUsdShort(cumMax)}</text>
      <text x={padL} y={y0 - 3} fontSize={9} fill={SUB}>$0</text>
      {cumMin < 0 && <text x={padL} y={yCum(cumMin) - 2} fontSize={9} fill={SUB}>{fmtUsdShort(cumMin)}</text>}
      {/* right price axis labels */}
      {hasPrice && (
        <>
          <text x={W - padR + 4} y={yPrice(pMax) + 4} fontSize={9} fill={HOME_THEME.orange}>{pMax.toFixed(2)}</text>
          <text x={W - padR + 4} y={yPrice(pMin) + 4} fontSize={9} fill={HOME_THEME.orange}>{pMin.toFixed(2)}</text>
        </>
      )}
      {/* current value tag */}
      <text x={W - padR - 4} y={padT + 2} textAnchor="end" fontSize={11} fontWeight={800} fill={finalColor}>
        {fmtUsdShort(wave.final)}
      </text>
    </svg>
  );
}

// ── GEX structure panel (SVG-free, HTML bars) ─────────────────────────────────
function GexStructure({ gex }: { gex: GexModel }) {
  const maxAbs = Math.max(1, ...gex.levels.map((l) => Math.abs(l.gex)));
  // Which displayed strike is nearest spot → gets the "spot" marker row.
  let spotIdx = 0, best = Infinity;
  gex.levels.forEach((l, i) => { const d = Math.abs(l.strike - gex.spot); if (d < best) { best = d; spotIdx = i; } });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: SUB, marginBottom: 4 }}>
        <span>Spot {gex.spot.toFixed(2)} · {gex.levels.length} levels</span>
        <span><span style={{ color: GREEN }}>{gex.pos} pos</span> / <span style={{ color: RED }}>{gex.neg} neg</span></span>
      </div>
      {gex.levels.map((l, i) => {
        const pos = l.gex > 0;
        const frac = Math.abs(l.gex) / maxAbs;
        const isSpot = i === spotIdx;
        return (
          <div
            key={l.strike}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr 78px",
              alignItems: "center",
              gap: 8,
              padding: "3px 6px",
              borderRadius: 4,
              background: isSpot ? "rgba(255,255,255,0.06)" : "transparent",
              outline: isSpot ? `1px solid ${HOME_THEME.orange}66` : "none",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: HOME_THEME.text, fontFamily: "var(--font-mono, monospace)" }}>
              {Math.round(l.strike)}
              {isSpot && <span style={{ color: HOME_THEME.orange, fontSize: 9, marginLeft: 3 }}>◄</span>}
            </span>
            {/* center bar track — grows from the middle */}
            <div style={{ position: "relative", height: 12, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: AXIS }} />
              <div
                style={{
                  position: "absolute",
                  top: 1,
                  bottom: 1,
                  [pos ? "left" : "right"]: "50%",
                  width: `${Math.max(2, frac * 50)}%`,
                  background: pos ? GREEN : RED,
                  borderRadius: 2,
                } as CSSProperties}
              />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, textAlign: "right", color: pos ? GREEN : RED, fontFamily: "var(--font-mono, monospace)" }}>
              {fmtUsdShort(l.gex)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span style={{ letterSpacing: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ color: i <= n ? HOME_THEME.orange : "rgba(255,255,255,0.18)", fontSize: 15 }}>★</span>
      ))}
    </span>
  );
}

// ── Data hook ─────────────────────────────────────────────────────────────────
function useRegimeData(symbol: string) {
  const [wave, setWave] = useState<WaveModel | null>(null);
  const [gex, setGex] = useState<GexModel | null>(null);
  const [price, setPrice] = useState<PricePoint[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  // True once the dxLink 1-min candle feed has populated the price line — while
  // true, the chain-spot fallback stops appending so it doesn't fight the feed.
  const candlesLoaded = useRef(false);

  // PRIMARY price line: real per-symbol 1-min OHLC from the dxLink candle
  // history (SPY{=1m}/QQQ{=1m}, ~1 day back) — a full-session line from the
  // open, not the SPX-tainted flow `spot`. Refresh every 60s to extend the
  // forming bar. Seeds from the persisted fallback series until candles arrive.
  useEffect(() => {
    let alive = true;
    setPrice(loadPriceSeries(symbol));
    candlesLoaded.current = false;
    const loadCandles = async () => {
      try {
        const fromMs = etDayStartMs(); // today's ET midnight — session-only, no overnight
        const j = await fetch(`/proxy/candles-intraday?symbol=${encodeURIComponent(symbol)}&interval=1m&fromMs=${fromMs}`).then((r) => r.json());
        const rows: unknown[] = Array.isArray(j?.candles) ? j.candles : [];
        const pts: PricePoint[] = rows
          .map((c) => { const r = c as { time?: unknown; close?: unknown }; return { ts: Number(r.time), price: Number(r.close) }; })
          .filter((p) => p.ts > 0 && p.price > 0);
        if (alive && pts.length) { candlesLoaded.current = true; setPrice(pts); }
      } catch { /* fall back to chain-spot accumulation below */ }
    };
    loadCandles();
    const id = setInterval(loadCandles, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbol]);

  const load = useCallback(async () => {
    try {
      const [flowRes, chainRes] = await Promise.allSettled([
        fetch(`/proxy/flow-history?underlying=${encodeURIComponent(symbol)}&limit=20000`).then((r) => r.json()),
        fetch(`/api/chains?ticker=${encodeURIComponent(symbol)}&range=all`, { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (flowRes.status === "fulfilled") {
        const tape: FlowOrder[] = Array.isArray(flowRes.value?.tape) ? flowRes.value.tape : [];
        setWave(buildWave(tape));
      }
      if (chainRes.status === "fulfilled") {
        const data = chainRes.value?.data ?? {};
        const spot = parseFloat(String(data.underlyingPrice ?? data["underlying-price"] ?? 0)) || 0;
        const items: ChainGroup[] = Array.isArray(data.items) ? data.items : [];
        setGex(buildGex(items, spot));
        // Fallback price line (only when the dxLink candle feed is unavailable):
        // append the CORRECT per-symbol spot, skipping near-duplicate samples.
        if (spot > 0 && !candlesLoaded.current) {
          setPrice((prev) => {
            const last = prev[prev.length - 1];
            const now = Date.now();
            if (last && now - last.ts < 20_000 && Math.abs(last.price - spot) < 1e-6) return prev;
            const next = [...prev, { ts: now, price: spot }];
            savePriceSeries(symbol, next);
            return next;
          });
        }
      }
      setErr(null);
      setLoadedAt(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [symbol]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { wave, gex, price, err, loadedAt };
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function GexRegimeCard({ symbol, subtitle }: { symbol: string; subtitle?: string }) {
  const { wave, gex, price, err, loadedAt } = useRegimeData(symbol);
  const cond = useMemo(() => synthesize(wave, gex, symbol), [wave, gex, symbol]);

  return (
    <Card variant="budget" title={`${symbol} · Market Condition`} subtitle={subtitle}>
      {/* Condition header */}
      <div
        style={{
          border: `1px solid ${HOME_THEME.border}`,
          borderRadius: 12,
          padding: "12px 14px",
          marginBottom: 14,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: `1px solid ${cond.tone}`,
              color: cond.tone,
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            {cond.label}
          </span>
          <Stars n={cond.stars} />
          {cond.stars > 0 && <span style={{ fontSize: 12, color: SUB }}>{cond.stars}/5</span>}
          <span style={{ marginLeft: "auto", fontSize: 11, color: SUB }}>
            {loadedAt ? `Updated ${fmtEtTime(loadedAt)} ET` : "loading…"}
          </span>
        </div>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {cond.bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 12.5, color: HOME_THEME.text, opacity: 0.9, lineHeight: 1.45 }}>{b}</li>
          ))}
        </ul>
      </div>

      {err && <div style={{ fontSize: 12, color: RED, marginBottom: 10 }}>Feed error: {err}</div>}

      {/* Two panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }} className="regime-panels">
        {/* WAVE */}
        <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.text }}>WAVE</div>
          <div style={{ fontSize: 11, color: SUB, marginBottom: 8 }}>Cumulative net call vs put premium (all expirations).</div>
          {wave ? <WaveChart wave={wave} price={price} /> : <div style={{ fontSize: 12, color: SUB, padding: 24, textAlign: "center" }}>No flow yet.</div>}
        </div>

        {/* GEX Structure */}
        <div style={{ border: `1px solid ${HOME_THEME.border}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: HOME_THEME.text }}>GEX Structure · 0-DTE</div>
          <div style={{ fontSize: 11, color: SUB, marginBottom: 8 }}>
            Net gamma by strike. <span style={{ color: GREEN }}>Green</span> = support/resistance (price stalls). <span style={{ color: RED }}>Red</span> = magnet (acceleration zone).
          </div>
          {gex ? <GexStructure gex={gex} /> : <div style={{ fontSize: 12, color: SUB, padding: 24, textAlign: "center" }}>No 0-DTE chain yet.</div>}
        </div>
      </div>
    </Card>
  );
}
