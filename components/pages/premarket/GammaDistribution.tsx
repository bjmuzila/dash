"use client";

/**
 * GAMMA DISTRIBUTION BY STRIKE — the wide card on /premarket.
 *
 * The ladder above it answers "how big is each strike". This answers a
 * different question: "where is the gamma actually CONCENTRATED, and how tight
 * is it?" Net GEX bars on a strike axis, the real gamma-mass curve over the top,
 * and a normal curve fitted to that mass so the shape has something to be read
 * against. A 0DTE board is usually far more peaked than the fit — that gap IS
 * the read, which is why both curves are drawn on ONE scale rather than each
 * normalised to its own peak.
 *
 * ── THE OI / VOL SWITCH ─────────────────────────────────────────────────────
 * Two bases, and they are genuinely two different boards:
 *
 *   OI only   γ × OI     × S²  — positioning carried INTO the session. The
 *                               honest premarket read: before 09:30 the volume
 *                               leg is ~nothing, so OI is the whole picture.
 *   Vol only  γ × Volume × S²  — what is being traded TODAY. Near-empty
 *                               pre-open, and the cleanest read on intraday
 *                               repositioning once the session is running.
 *
 * OI-only is `net − vol`, the same subtraction `oiLeg()` in Premarket.tsx uses,
 * so this card and the Key Levels tiles can never disagree about what "OI" is.
 * Deliberately NOT wired to the page's `lvlBasis`: that switch has three legs
 * and drives the levels; this one is a property of this chart and persists on
 * its own key.
 *
 * ── THE X WINDOW IS THE WHOLE ERGONOMIC PROBLEM ─────────────────────────────
 * A fixed ±2.8% band is ±215 points on a 7,670 SPX. On a 0DTE board the mass
 * has a 1σ of ~25 points, so EVERYTHING lives in the middle 12% of the axis and
 * the other 88% is a flat line — the chart reads as cramped no matter how tall
 * the card is, because the problem is horizontal, not vertical.
 *
 * So AUTO is the default and it is width-adaptive: σ is measured on a wide ±3%
 * pass, and the drawn window is spot ± max(4.5σ, 0.35% of spot), then widened
 * just enough to keep spot, flip and both walls on screen, then clamped to ±3%.
 * The peak fills the card instead of hiding in it. 1% / 2% / 3% are there for
 * anyone who wants a fixed band (and for comparing two sessions on one scale),
 * and the choice persists.
 *
 * ── LAYOUT: NOTHING FLOATS OVER THE PLOT ────────────────────────────────────
 * Stats and legend sit in their own strips ABOVE the plot, never inside the
 * SVG. The tooltip is the only floating thing, and it has nothing to collide
 * with. Level labels are packed greedily into up to three rows in the top pad:
 * spot, flip and both walls routinely land within a few points of each other,
 * and one row turns into an unreadable smear.
 *
 * ── SCALE ───────────────────────────────────────────────────────────────────
 * Bars are net GEX (calls +, puts −) on ONE linear scale across both sides —
 * a −500M bar must not look the same size as a +4B one, which is exactly what
 * separate per-side scales did. The mass line and the fitted normal are drawn
 * in the above-zero half on their own shared factor, so their heights are
 * comparable to each other and never to the bars. The axis labels belong to the
 * bars only, which is why the mass/fit pair is labelled in the legend instead.
 *
 * Colours/typography come from the `.pmk` custom properties (which are
 * interpolated from components/shared/homeTheme in Premarket.tsx) — nothing is
 * hardcoded here, per AGENTS.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  callGEXOf,
  putGEXOf,
  netGEXOf,
  type ChainRow,
} from "@/lib/calculations/calculations";

export type GammaBasis = "oi" | "vol";
/** "auto" = spot ± 4.5σ (see the header); the rest are ±N% of spot. */
export type GammaZoom = "auto" | "1" | "2" | "3";

const BASIS_KEY = "cb-premarket-gdist-basis-v1";
const ZOOM_KEY = "cb-premarket-gdist-zoom-v1";

const BASIS_META: Record<GammaBasis, { tab: string; long: string; hint: string }> = {
  oi: {
    tab: "OI",
    long: "OI only",
    hint: "γ × OI × S². Positioning carried into the session — the honest premarket read, since the volume leg is ~empty before 09:30.",
  },
  vol: {
    tab: "VOL",
    long: "Volume only",
    hint: "γ × Volume × S². Today's trading only — near zero before 09:30, and the cleanest read on intraday repositioning once the session runs.",
  },
};

const ZOOM_META: Record<GammaZoom, { tab: string; hint: string }> = {
  auto: { tab: "AUTO", hint: "Spot ± 4.5σ of the gamma mass, widened to keep spot, flip and both walls on screen. The peak fills the card instead of hiding in the middle of a 400-point axis." },
  "1": { tab: "±1%", hint: "Fixed ±1% of spot." },
  "2": { tab: "±2%", hint: "Fixed ±2% of spot." },
  "3": { tab: "±3%", hint: "Fixed ±3% of spot — the whole board this card ever reads." },
};

export const GAMMA_DIST_CSS = `
.gdist{margin-top:14px;border-top:1px solid var(--line);padding:14px 18px 6px}
.gdist .gd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  flex-wrap:wrap;margin-bottom:10px}
.gdist .gd-lh{display:flex;align-items:baseline;gap:10px;min-width:0;flex-wrap:wrap}
.gdist .gd-lh h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.gdist .gd-sub{font-size:10px;letter-spacing:.04em;color:var(--dim2);
  font-variant-numeric:tabular-nums}
.gdist .gd-rh{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.gdist .gd-ctl{display:flex;align-items:center;gap:6px}
.gdist .gd-ctl>b{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim2);
  font-weight:600}

/* KPI STRIP — the old floating stats card, unstacked. Five facts on one line
   above the plot, so nothing sits on top of the drawing. */
.gdist .gd-kpis{display:grid;grid-template-columns:repeat(var(--gd-cols,5),minmax(0,1fr));
  gap:8px;margin-bottom:10px}
.gdist .gd-kpi{border:1px solid var(--line);border-radius:var(--r2);background:var(--sunken);
  padding:7px 10px;min-width:0}
.gdist .gd-kpi .n{font-size:9.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gdist .gd-kpi .v{font-size:14px;font-weight:650;color:var(--txt);margin-top:2px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.gdist .gd-kpi .m{font-size:10px;color:var(--dim2);font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.gdist .gd-legend{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:10.5px;
  color:var(--dim);font-variant-numeric:tabular-nums}
.gdist .gd-legend span{display:flex;align-items:center;gap:7px;white-space:nowrap}
.gdist .gd-legend i{display:block;width:16px;height:0;border-top-width:2px;border-top-style:solid;flex:0 0 16px}

.gdist .gd-wrap{position:relative;width:100%}
.gdist svg{display:block;width:100%;height:auto;touch-action:pan-y}
.gdist .gd-tip{position:absolute;pointer-events:none;z-index:3;transform:translateX(-50%);
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:6px 9px;font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--txt);
  box-shadow:0 8px 22px rgba(0,0,0,.35);white-space:nowrap;line-height:1.55}
.gdist .gd-tip b{font-weight:700}
.gdist .gd-tip .r{display:flex;justify-content:space-between;gap:14px;color:var(--dim2)}
.gdist .gd-tip .r span:last-child{color:var(--txt)}
.gdist .gd-foot{font-size:11px;color:var(--dim2);line-height:1.6;margin:9px 0 4px;max-width:104ch}
.gdist .gd-foot b{color:var(--dim);font-weight:650}
.gdist .gd-empty{padding:48px 0;text-align:center;color:var(--dim);font-size:12px}
@media (max-width:1100px){ .gdist .gd-kpis{--gd-cols:3} }
@media (max-width:680px){ .gdist .gd-kpis{--gd-cols:2} }
`;

// ── formatting ───────────────────────────────────────────────────────────────

function fmtB(v: number, sign = true): string {
  const a = Math.abs(v);
  const s = v < 0 ? "−" : sign ? "+" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
}

const nf0 = (v: number) => Math.round(v).toLocaleString("en-US");

// ── per-row legs on the selected basis ───────────────────────────────────────

/**
 * Net GEX for one row on `basis`.
 * OI-only is net − vol, which is also correct for the server-summed rows
 * netGEXOf() falls back on (netGEX is the OI leg, netVolGEX the vol leg).
 */
function rowNet(r: ChainRow, basis: GammaBasis, spot: number): number {
  const vol = netGEXOf(r, "vol", spot);
  return basis === "vol" ? vol : netGEXOf(r, "net", spot) - vol;
}

/**
 * Gamma MASS for one row: |call GEX| + |put GEX| on `basis` — how much gamma is
 * parked at the strike regardless of which way it points. A pre-summed row has
 * no legs to split, so it contributes |net| instead of being silently dropped.
 */
function rowMass(r: ChainRow, basis: GammaBasis, spot: number): number {
  if (r.callGamma == null && r.putGamma == null && (r.netGEX != null || r.netVolGEX != null)) {
    return Math.abs(rowNet(r, basis, spot));
  }
  const c = basis === "vol"
    ? callGEXOf(r, "vol", spot)
    : callGEXOf(r, "net", spot) - callGEXOf(r, "vol", spot);
  const p = basis === "vol"
    ? putGEXOf(r, "vol", spot)
    : putGEXOf(r, "net", spot) - putGEXOf(r, "vol", spot);
  return Math.abs(c) + Math.abs(p);
}

// ── geometry ─────────────────────────────────────────────────────────────────

/** Top pad carries up to THREE packed rows of level labels, hence 58. */
const PAD = { t: 58, r: 18, b: 38, l: 72 };
/** The widest this card ever reads — the σ pass and the ±3% tab both use it. */
const MAX_BAND = 0.03;
/** Above this many bars the axis is unreadable, so neighbours are binned. */
const MAX_BARS = 150;

type Bin = { k: number; net: number; mass: number };

/** Mass-weighted mean and sd of a bin set. */
function moments(rows: Bin[]): { mu: number; sigma: number; total: number } | null {
  const total = rows.reduce((s, b) => s + b.mass, 0);
  if (!(total > 0)) return null;
  const mu = rows.reduce((s, b) => s + b.k * b.mass, 0) / total;
  const varr = rows.reduce((s, b) => s + b.mass * (b.k - mu) ** 2, 0) / total;
  return { mu, sigma: Math.sqrt(Math.max(varr, 1e-9)), total };
}

export default function GammaDistribution({
  chain,
  spot,
  expiry,
  isZeroDte,
  flip,
  callWall,
  putWall,
  frozen,
}: {
  chain: ChainRow[];
  spot: number;
  expiry?: string | null;
  isZeroDte?: boolean;
  flip?: number | null;
  callWall?: number | null;
  putWall?: number | null;
  /** A captured past session — the footer says so instead of implying live. */
  frozen?: boolean;
}) {
  // ── switches (own keys; NOT the page's three-leg lvlBasis) ────────────────
  const [basis, setBasis] = useState<GammaBasis>("oi");
  const [zoom, setZoom] = useState<GammaZoom>("auto");
  useEffect(() => {
    try {
      const b = localStorage.getItem(BASIS_KEY) as GammaBasis | null;
      if (b && b in BASIS_META) setBasis(b);
      const z = localStorage.getItem(ZOOM_KEY) as GammaZoom | null;
      if (z && z in ZOOM_META) setZoom(z);
    } catch { /* private mode — the defaults are fine */ }
  }, []);
  const pickBasis = useCallback((b: GammaBasis) => {
    setBasis(b);
    try { localStorage.setItem(BASIS_KEY, b); } catch { /* nothing to do */ }
  }, []);
  const pickZoom = useCallback((z: GammaZoom) => {
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, z); } catch { /* nothing to do */ }
  }, []);

  // ── responsive box ────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [W, setW] = useState(1100);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect?.width ?? 0;
      if (w > 0) setW(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Height follows width so the plot keeps a shape instead of letterboxing. */
  const H = Math.round(Math.min(620, Math.max(430, W * 0.42)));

  // ── WIDE pass: every strike this card would ever read (±3% of spot) ───────
  // Kept separate from the drawn set because the AUTO window is derived FROM
  // it: measuring σ inside an already-narrow window would let the window
  // collapse onto itself on the next render.
  const wide = useMemo<Bin[]>(() => {
    if (!chain.length || !(spot > 0)) return [];
    const lo = spot * (1 - MAX_BAND);
    const hi = spot * (1 + MAX_BAND);
    return chain
      .filter((r) => Number.isFinite(r.strike) && r.strike >= lo && r.strike <= hi)
      .map((r) => ({ k: r.strike, net: rowNet(r, basis, spot), mass: rowMass(r, basis, spot) }))
      .filter((b) => Number.isFinite(b.net) && Number.isFinite(b.mass))
      .sort((a, b) => a.k - b.k);
  }, [chain, spot, basis]);

  // ── the drawn window ──────────────────────────────────────────────────────
  const half = useMemo(() => {
    if (!(spot > 0)) return 0;
    if (zoom !== "auto") return spot * (Number(zoom) / 100);
    const m = moments(wide);
    // No mass to measure (a vol board before the open): fall back to a band
    // wide enough to be a chart rather than a sliver.
    let h = m ? Math.max(4.5 * m.sigma, spot * 0.0035) : spot * 0.01;
    // Widen just enough to keep the levels on screen — a chart that hides the
    // call wall to look tidy is worse than a slightly wider one.
    for (const lv of [flip, callWall, putWall]) {
      if (lv != null && Number.isFinite(lv)) h = Math.max(h, Math.abs(lv - spot) * 1.12);
    }
    if (m) h = Math.max(h, Math.abs(m.mu - spot) + 2 * m.sigma);
    return Math.min(h, spot * MAX_BAND);
  }, [wide, zoom, spot, flip, callWall, putWall]);

  const bins = useMemo<Bin[]>(() => {
    if (!wide.length || !(half > 0)) return [];
    const raw = wide.filter((b) => b.k >= spot - half && b.k <= spot + half);
    if (raw.length <= MAX_BARS) return raw;

    // Too many strikes to draw one bar each: fold neighbours into equal-width
    // buckets. Sums, not averages — a bucket must carry the same dollars its
    // strikes did or the totals stop matching the ladder.
    const k0 = raw[0].k;
    const k1 = raw[raw.length - 1].k;
    const step = (k1 - k0) / MAX_BARS || 1;
    const out: Bin[] = [];
    for (const b of raw) {
      const idx = Math.min(MAX_BARS - 1, Math.floor((b.k - k0) / step));
      const kMid = k0 + (idx + 0.5) * step;
      const last = out[out.length - 1];
      if (last && Math.abs(last.k - kMid) < 1e-9) {
        last.net += b.net; last.mass += b.mass;
      } else {
        out.push({ k: kMid, net: b.net, mass: b.mass });
      }
    }
    return out;
  }, [wide, half, spot]);

  // ── fit, on what is DRAWN (so the stats describe the picture) ─────────────
  const fit = useMemo(() => {
    const m = moments(bins);
    if (!m) return null;
    const inside = bins
      .filter((b) => b.k >= m.mu - m.sigma && b.k <= m.mu + m.sigma)
      .reduce((s, b) => s + b.mass, 0);
    const netTotal = bins.reduce((s, b) => s + b.net, 0);
    const step = bins.length > 1 ? (bins[bins.length - 1].k - bins[0].k) / (bins.length - 1) : 5;
    return {
      totalMass: m.total, mu: m.mu, sigma: m.sigma,
      insidePct: (inside / m.total) * 100, netTotal, step,
    };
  }, [bins]);

  // ── scales ────────────────────────────────────────────────────────────────
  const geo = useMemo(() => {
    if (!bins.length || !fit) return null;
    const k0 = bins[0].k - fit.step / 2;
    const k1 = bins[bins.length - 1].k + fit.step / 2;
    const plotW = Math.max(80, W - PAD.l - PAD.r);
    const plotH = H - PAD.t - PAD.b;

    const maxP = Math.max(0, ...bins.map((b) => b.net));
    const maxN = Math.max(0, ...bins.map((b) => -b.net));
    const span = maxP + maxN || 1;

    // ONE linear scale across both sides. The zero line therefore sits wherever
    // the pos/neg split puts it — a small put side gets a small strip, which is
    // the truth. (Per-side scales made a −500M bar as tall as a +4B one.)
    const zeroY = PAD.t + plotH * (maxP / span);
    const pxPerDollar = plotH / span;

    const x = (k: number) => PAD.l + ((k - k0) / (k1 - k0)) * plotW;
    const y = (v: number) => zeroY - v * pxPerDollar;

    // Mass line + fitted normal share ONE factor of their own, filling the
    // above-zero half. Comparable to each other; never to the bars.
    const maxMass = Math.max(...bins.map((b) => b.mass), 1);
    const mScale = (zeroY - PAD.t) / maxMass;
    const yMass = (m: number) => zeroY - m * mScale;

    // Bars get a real gap once there is room for one; below ~4px they butt up
    // against each other rather than dissolving into hairlines.
    const slot = plotW / bins.length;
    const barW = slot > 6 ? Math.max(3, slot - 3) : Math.max(1.5, slot * 0.82);
    return { k0, k1, plotW, plotH, zeroY, x, y, yMass, maxP, maxN, maxMass, barW };
  }, [bins, fit, W, H]);

  // ── hover ─────────────────────────────────────────────────────────────────
  const [hover, setHover] = useState<number | null>(null);
  const onMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (!geo || !bins.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.l || px > W - PAD.r) { setHover(null); return; }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < bins.length; i++) {
      const d = Math.abs(geo.x(bins[i].k) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }, [geo, bins, W]);

  // ── head ──────────────────────────────────────────────────────────────────
  const meta = BASIS_META[basis];
  const head = (
    <div className="gd-head">
      <div className="gd-lh">
        <h3>Gamma Exposure by Strike</h3>
        <span className="gd-sub">
          {isZeroDte ? "0DTE" : "front"}{expiry ? ` ${expiry}` : ""} · {meta.long}
          {bins.length
            ? ` · ${bins.length} bars · ${nf0(spot - half)} – ${nf0(spot + half)} (±${((half / spot) * 100).toFixed(2)}%)`
            : ""}
        </span>
      </div>
      <div className="gd-rh">
        {bins.length > 0 && (
          <div className="gd-legend">
            <span><i style={{ borderTopColor: "var(--amber)" }} />Fitted normal</span>
            <span><i style={{ borderTopColor: "var(--blue)" }} />Gamma mass (|call| + |put|)</span>
          </div>
        )}
        <div className="gd-ctl">
          <b>Range</b>
          <div className="seg" role="group" aria-label="Strike window">
            {(Object.keys(ZOOM_META) as GammaZoom[]).map((z) => (
              <button
                key={z}
                type="button"
                className={zoom === z ? "on" : ""}
                aria-pressed={zoom === z}
                title={ZOOM_META[z].hint}
                onClick={() => pickZoom(z)}
              >
                {ZOOM_META[z].tab}
              </button>
            ))}
          </div>
        </div>
        <div className="gd-ctl">
          <b>Basis</b>
          <div className="seg" role="group" aria-label="Gamma distribution basis">
            {(Object.keys(BASIS_META) as GammaBasis[]).map((b) => (
              <button
                key={b}
                type="button"
                className={basis === b ? "on" : ""}
                aria-pressed={basis === b}
                title={BASIS_META[b].hint}
                onClick={() => pickBasis(b)}
              >
                {BASIS_META[b].tab}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (!bins.length || !fit || !geo) {
    return (
      <div className="gdist">
        {head}
        <div className="gd-empty">
          {chain.length === 0
            ? "Waiting for the chain…"
            : basis === "vol"
              ? "No volume on this board yet — the session has not traded. Switch to OI."
              : "No gamma within ±3% of spot on this basis."}
        </div>
      </div>
    );
  }

  const { mu, sigma, insidePct, netTotal, totalMass, step } = fit;
  const { zeroY, x, y, yMass, maxP, maxN, barW, k0, k1 } = geo;

  // Fitted normal, on the mass scale: totalMass × step × pdf(k).
  const curve: string = (() => {
    const N = 240;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const k = k0 + ((k1 - k0) * i) / N;
      const pdf = Math.exp(-((k - mu) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
      pts.push(`${i === 0 ? "M" : "L"}${x(k).toFixed(2)},${yMass(pdf * totalMass * step).toFixed(2)}`);
    }
    return pts.join(" ");
  })();

  const massPath = bins
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(b.k).toFixed(2)},${yMass(b.mass).toFixed(2)}`)
    .join(" ");

  // X ticks on round strikes, ~8 across.
  const rawStep = (k1 - k0) / 8;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(k0 / tickStep) * tickStep; t <= k1; t += tickStep) ticks.push(t);

  const yTicks = [maxP, maxP * 0.5, -maxN * 0.5, -maxN].filter((v) => Math.abs(v) > 0);

  // Level rules and their labels.
  //
  // Two things are happening here, and both exist because spot, flip and both
  // walls routinely land within a few points of each other on a 0DTE board —
  // which put all four labels in one pile over the middle of the chart, exactly
  // where the peak is ("Put wallSpot 7,670" / "FliCall wall 7,675").
  //
  // 1. FAN OUT FROM THE MIDDLE. Each label is pushed to its own side of spot —
  //    strikes below spot hang to the LEFT of their rule, strikes above hang to
  //    the RIGHT, spot itself stays centred. So the labels open away from the
  //    centre of the card instead of stacking on top of it.
  // 2. THEN PACK. Whatever still overlaps after the fan-out is dropped to the
  //    next of three rows by a greedy first-fit on estimated width. A leader
  //    line runs from each label back to its own rule, so a label that had to
  //    move is still unambiguously attached.
  const rowEnd = [-Infinity, -Infinity, -Infinity];
  const levels = ([
    { k: putWall, label: `Put wall ${nf0(putWall ?? 0)}`, color: "var(--pw)", dash: "3 3" },
    { k: callWall, label: `Call wall ${nf0(callWall ?? 0)}`, color: "var(--cw)", dash: "3 3" },
    { k: flip, label: `Flip ${nf0(flip ?? 0)}`, color: "var(--violet)", dash: "5 4" },
    { k: spot, label: `Spot ${nf0(spot)}`, color: "var(--txt)", dash: "6 4" },
  ] as { k: number | null | undefined; label: string; color: string; dash: string }[])
    .filter((l): l is { k: number; label: string; color: string; dash: string } =>
      l.k != null && Number.isFinite(l.k) && l.k >= k0 && l.k <= k1)
    .map((l) => {
      const w = l.label.length * 5.5 + 10;
      // Fan: −1 below spot, +1 above, 0 for spot itself.
      const dir = Math.abs(l.k - spot) < 1e-9 ? 0 : l.k < spot ? -1 : 1;
      const want = x(l.k) + dir * (w / 2 + 12);
      const cx = Math.min(Math.max(want, PAD.l + w / 2), W - PAD.r - w / 2);
      return { ...l, w, cx };
    })
    .sort((a, b) => a.cx - b.cx)
    .map((l, i) => {
      const left = l.cx - l.w / 2;
      let row = rowEnd.findIndex((end) => left > end + 6);
      if (row < 0) row = i % 3;
      rowEnd[row] = left + l.w;
      return { ...l, row };
    });

  const hv = hover != null ? bins[hover] : null;
  const shape = insidePct >= 80 ? "far more peaked than the fit"
    : insidePct >= 68 ? "tighter than normal"
      : "flatter than normal";

  return (
    <div className="gdist">
      {head}

      <div className="gd-kpis">
        <div className="gd-kpi">
          <div className="n">Center of gamma mass</div>
          <div className="v">{nf0(mu)}</div>
          <div className="m">{mu >= spot ? "+" : "−"}{nf0(Math.abs(mu - spot))} vs spot</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Dispersion (1σ)</div>
          <div className="v">±{nf0(sigma)} pts</div>
          <div className="m">{nf0(mu - sigma)} – {nf0(mu + sigma)}</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Mass inside ±1σ</div>
          <div className="v">{insidePct.toFixed(0)}%</div>
          <div className="m">{shape}</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Net GEX, window</div>
          <div className={`v ${netTotal >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtB(netTotal)}</div>
          <div className="m">{nf0(k0)} – {nf0(k1)}</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Gamma mass, total</div>
          <div className="v">{fmtB(totalMass, false)}</div>
          <div className="m">{meta.long}</div>
        </div>
      </div>

      <div className="gd-wrap" ref={wrapRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label={`Net gamma exposure per strike on the ${meta.long} basis, with a normal curve fitted to the gamma-mass distribution`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* ±1σ band */}
          <rect
            x={x(Math.max(k0, mu - sigma))}
            y={PAD.t}
            width={Math.max(0, x(Math.min(k1, mu + sigma)) - x(Math.max(k0, mu - sigma)))}
            height={H - PAD.t - PAD.b}
            fill="var(--amberWash)"
          />

          {/* y grid + labels (bars only — the mass/fit pair has its own scale) */}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.l - 9} y={y(v) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--dim2)"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtB(v)}
              </text>
            </g>
          ))}

          {/* zero line */}
          <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--line3)" strokeWidth={1} />
          <text x={PAD.l - 9} y={zeroY + 3.5} textAnchor="end" fontSize={10.5} fill="var(--dim2)">0</text>

          {/* bars */}
          {bins.map((b) => {
            const pos = b.net >= 0;
            const yv = y(b.net);
            const h = Math.max(0.6, Math.abs(yv - zeroY));
            return (
              <rect
                key={b.k}
                x={x(b.k) - barW / 2}
                y={pos ? yv : zeroY}
                width={barW}
                height={h}
                fill={pos ? "var(--pos)" : "var(--neg)"}
                opacity={hover == null || bins[hover].k === b.k ? 0.92 : 0.5}
              />
            );
          })}

          {/* fitted normal, then the real mass on top of it */}
          <path d={curve} fill="none" stroke="var(--amber)" strokeWidth={2.2} strokeLinejoin="round" />
          <path d={massPath} fill="none" stroke="var(--blue)" strokeWidth={1.7} strokeLinejoin="round" opacity={0.95} />

          {/* level rules; labels packed into up to three rows, each with a
              leader down to its rule so a shifted label still reads as its own */}
          {levels.map((l) => {
            const ly = 14 + l.row * 14;
            return (
              <g key={l.label}>
                <line
                  x1={x(l.k)} x2={x(l.k)} y1={PAD.t - 6} y2={H - PAD.b}
                  stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} opacity={0.85}
                />
                <path
                  d={`M${l.cx.toFixed(1)},${ly + 4} L${l.cx.toFixed(1)},${(PAD.t - 12).toFixed(1)} L${x(l.k).toFixed(1)},${PAD.t - 6}`}
                  fill="none" stroke={l.color} strokeWidth={1} opacity={0.45}
                />
                <text
                  x={l.cx} y={ly} textAnchor="middle"
                  fontSize={10} fill={l.color} fontWeight={700}
                  style={{ letterSpacing: ".04em" }}
                >
                  {l.label}
                </text>
              </g>
            );
          })}

          {/* hover guide */}
          {hv && (
            <line x1={x(hv.k)} x2={x(hv.k)} y1={PAD.t - 6} y2={H - PAD.b}
              stroke="var(--cyan)" strokeWidth={1} opacity={0.55} />
          )}

          {/* x axis */}
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line2)" strokeWidth={1} />
          {ticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={10.5}
              fill="var(--dim2)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {nf0(t)}
            </text>
          ))}
          <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - 5} textAnchor="middle" fontSize={9.5}
            fill="var(--dim2)" style={{ letterSpacing: ".1em", textTransform: "uppercase" }}>
            Strike
          </text>
        </svg>

        {hv && (
          <div
            className="gd-tip"
            style={{
              // Clamped so a bar at either end cannot push the card outside the
              // plot; the transform keeps it centred everywhere in between.
              left: `clamp(76px, ${((x(hv.k) / W) * 100).toFixed(2)}%, calc(100% - 76px))`,
              top: 4,
            }}
          >
            <b>{nf0(hv.k)}</b>
            <div className="r"><span>net</span><span>{fmtB(hv.net)}</span></div>
            <div className="r"><span>mass</span><span>{fmtB(hv.mass, false)}</span></div>
            <div className="r"><span>vs spot</span><span>{hv.k >= spot ? "+" : "−"}{nf0(Math.abs(hv.k - spot))}</span></div>
          </div>
        )}
      </div>

      <p className="gd-foot">
        {netTotal >= 0
          ? "Net long gamma across the window — dealers dampen, and moves toward the peak get sold into."
          : "Net short gamma across the window — dealers amplify, and a move away from the peak feeds itself."}
        {" "}Mass sits at <b>{nf0(mu)}</b> with a 1σ spread of <b>±{nf0(sigma)}</b> pts
        ({((sigma / spot) * 100).toFixed(2)}% of spot); {insidePct.toFixed(0)}% of the drawn
        board is inside that band, so the distribution is {shape}.
        {basis === "vol"
          ? " Volume basis — this is today's trading only, so it reads near-empty before 09:30."
          : " OI basis — positioning carried into the session, which is the honest premarket read."}
        {zoom === "auto" ? " Range is auto-fitted to the mass; the tabs pin it to a fixed band." : ""}
        {frozen ? " Captured session, not live." : ""}
      </p>
    </div>
  );
}
