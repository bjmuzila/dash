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
 * ── SCALE ───────────────────────────────────────────────────────────────────
 * Bars are net GEX (calls +, puts −) and own the vertical axis. The mass line
 * and the fitted normal are drawn in the ABOVE-ZERO half, scaled by one shared
 * factor so their heights are comparable to each other — never to the bars.
 * The axis labels belong to the bars only, which is why the mass/fit pair is
 * labelled in the legend instead.
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

const BASIS_KEY = "cb-premarket-gdist-basis-v1";

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

export const GAMMA_DIST_CSS = `
.gdist{margin-top:14px;border-top:1px solid var(--line);padding:14px 18px 4px}
.gdist .gd-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  flex-wrap:wrap;margin-bottom:10px}
.gdist .gd-lh{display:flex;align-items:baseline;gap:10px;min-width:0;flex-wrap:wrap}
.gdist .gd-lh h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.gdist .gd-sub{font-size:10px;letter-spacing:.04em;color:var(--dim2);
  font-variant-numeric:tabular-nums}
.gdist .gd-wrap{position:relative;width:100%}
.gdist svg{display:block;width:100%;height:auto;touch-action:pan-y}
.gdist .gd-stats{position:absolute;left:10px;top:10px;pointer-events:none;
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:8px 11px;display:grid;grid-template-columns:auto auto;gap:2px 14px;
  font-size:10.5px;font-variant-numeric:tabular-nums;box-shadow:0 8px 22px rgba(0,0,0,.28)}
.gdist .gd-stats .n{color:var(--dim2);white-space:nowrap}
.gdist .gd-stats .v{color:var(--txt);text-align:right;white-space:nowrap}
.gdist .gd-stats .v em{font-style:normal;color:var(--dim2);margin-left:6px}
.gdist .gd-legend{position:absolute;right:10px;top:10px;pointer-events:none;
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:7px 10px;display:flex;flex-direction:column;gap:4px;font-size:10.5px;color:var(--dim)}
.gdist .gd-legend span{display:flex;align-items:center;gap:7px;white-space:nowrap}
.gdist .gd-legend i{display:block;width:16px;height:0;border-top-width:2px;border-top-style:solid;flex:0 0 16px}
.gdist .gd-tip{position:absolute;pointer-events:none;z-index:3;transform:translate(-50%,0);
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:6px 9px;font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--txt);
  box-shadow:0 8px 22px rgba(0,0,0,.3);white-space:nowrap;line-height:1.5}
.gdist .gd-tip b{font-weight:700}
.gdist .gd-tip .r{display:flex;justify-content:space-between;gap:12px;color:var(--dim2)}
.gdist .gd-tip .r span:last-child{color:var(--txt)}
.gdist .gd-foot{font-size:11px;color:var(--dim2);line-height:1.6;margin:8px 0 4px;max-width:96ch}
.gdist .gd-empty{padding:44px 0;text-align:center;color:var(--dim);font-size:12px}
@media (max-width:900px){
  .gdist .gd-stats,.gdist .gd-legend{position:static;margin-bottom:8px;box-shadow:none}
  .gdist .gd-legend{flex-direction:row;gap:12px;flex-wrap:wrap}
}
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

const PAD = { t: 16, r: 16, b: 34, l: 66 };
const H = 430;
/** Strikes further than this from spot are noise on a 0DTE board. */
const BAND_PCT = 0.028;
/** Above this many bars the axis is unreadable, so neighbours are binned. */
const MAX_BARS = 150;

type Bin = { k: number; net: number; mass: number };

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
  // ── basis switch (own key; NOT the page's three-leg lvlBasis) ──────────────
  const [basis, setBasis] = useState<GammaBasis>("oi");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BASIS_KEY) as GammaBasis | null;
      if (saved && saved in BASIS_META) setBasis(saved);
    } catch { /* private mode — the default is fine */ }
  }, []);
  const pickBasis = useCallback((b: GammaBasis) => {
    setBasis(b);
    try { localStorage.setItem(BASIS_KEY, b); } catch { /* nothing to do */ }
  }, []);

  // ── responsive width ──────────────────────────────────────────────────────
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

  // ── bins ──────────────────────────────────────────────────────────────────
  const bins = useMemo<Bin[]>(() => {
    if (!chain.length || !(spot > 0)) return [];
    const lo = spot * (1 - BAND_PCT);
    const hi = spot * (1 + BAND_PCT);

    const raw = chain
      .filter((r) => Number.isFinite(r.strike) && r.strike >= lo && r.strike <= hi)
      .map((r) => ({ k: r.strike, net: rowNet(r, basis, spot), mass: rowMass(r, basis, spot) }))
      .filter((b) => Number.isFinite(b.net) && Number.isFinite(b.mass))
      .sort((a, b) => a.k - b.k);

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
  }, [chain, spot, basis]);

  // ── fit ───────────────────────────────────────────────────────────────────
  const fit = useMemo(() => {
    const totalMass = bins.reduce((s, b) => s + b.mass, 0);
    if (!(totalMass > 0)) return null;
    const mu = bins.reduce((s, b) => s + b.k * b.mass, 0) / totalMass;
    const varr = bins.reduce((s, b) => s + b.mass * (b.k - mu) ** 2, 0) / totalMass;
    const sigma = Math.sqrt(Math.max(varr, 1e-9));
    const inside = bins
      .filter((b) => b.k >= mu - sigma && b.k <= mu + sigma)
      .reduce((s, b) => s + b.mass, 0);
    const netTotal = bins.reduce((s, b) => s + b.net, 0);
    const step = bins.length > 1 ? (bins[bins.length - 1].k - bins[0].k) / (bins.length - 1) : 5;
    return { totalMass, mu, sigma, insidePct: (inside / totalMass) * 100, netTotal, step };
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
    // Zero line splits the plot in proportion to the two sides, but never so
    // far up or down that one side becomes a hairline.
    const frac = Math.min(0.88, Math.max(0.12, maxP / span));
    const zeroY = PAD.t + plotH * frac;

    const x = (k: number) => PAD.l + ((k - k0) / (k1 - k0)) * plotW;
    const yPos = (v: number) => zeroY - (v / (maxP || 1)) * (zeroY - PAD.t);
    const yNeg = (v: number) => zeroY + (Math.abs(v) / (maxN || 1)) * (PAD.t + plotH - zeroY);
    const y = (v: number) => (v >= 0 ? yPos(v) : yNeg(v));

    // ONE factor for the mass line and the fitted curve, so the gap between
    // them is the read. Mass peak fills the above-zero half.
    const maxMass = Math.max(...bins.map((b) => b.mass), 1);
    const mScale = (zeroY - PAD.t) / maxMass;
    const yMass = (m: number) => zeroY - m * mScale;

    const barW = Math.max(1.5, (plotW / bins.length) * 0.68);
    return { k0, k1, plotW, plotH, zeroY, x, y, yMass, maxP, maxN, maxMass, barW };
  }, [bins, fit, W]);

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

  // ── head copy ─────────────────────────────────────────────────────────────
  const meta = BASIS_META[basis];
  const seg = (
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
  );

  if (!bins.length || !fit || !geo) {
    return (
      <div className="gdist">
        <div className="gd-head">
          <div className="gd-lh">
            <h3>Gamma Exposure by Strike</h3>
            <span className="gd-sub">{meta.long}</span>
          </div>
          {seg}
        </div>
        <div className="gd-empty">
          {chain.length === 0
            ? "Waiting for the chain…"
            : basis === "vol"
              ? "No volume on this board yet — the session has not traded. Switch to OI."
              : "No gamma within ±2.8% of spot on this basis."}
        </div>
      </div>
    );
  }

  const { mu, sigma, insidePct, netTotal, totalMass, step } = fit;
  const { zeroY, x, y, yMass, maxP, maxN, barW, k0, k1 } = geo;

  // Fitted normal, on the mass scale: totalMass × step × pdf(k).
  const curve: string = (() => {
    const N = 220;
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

  // X ticks on round strikes, ~7 across.
  const rawStep = (k1 - k0) / 7;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(k0 / tickStep) * tickStep; t <= k1; t += tickStep) ticks.push(t);

  const yTicks = [maxP * 0.5, maxP, -maxN * 0.5, -maxN].filter((v) => Math.abs(v) > 0);

  const lines: { k: number | null | undefined; label: string; color: string; dash: string }[] = [
    { k: putWall, label: `Put wall ${nf0(putWall ?? 0)}`, color: "var(--pw)", dash: "3 3" },
    { k: callWall, label: `Call wall ${nf0(callWall ?? 0)}`, color: "var(--cw)", dash: "3 3" },
    { k: flip, label: `Flip ${nf0(flip ?? 0)}`, color: "var(--violet)", dash: "5 4" },
    { k: spot, label: `Spot ${nf0(spot)}`, color: "var(--txt)", dash: "6 4" },
  ];

  const hv = hover != null ? bins[hover] : null;

  return (
    <div className="gdist">
      <div className="gd-head">
        <div className="gd-lh">
          <h3>Gamma Exposure by Strike</h3>
          <span className="gd-sub">
            {isZeroDte ? "0DTE" : "front"}{expiry ? ` ${expiry}` : ""} · {meta.long} ·{" "}
            {bins.length} bars · ±{(BAND_PCT * 100).toFixed(1)}% of spot
          </span>
        </div>
        {seg}
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
              <text x={PAD.l - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)"
                style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtB(v)}
              </text>
            </g>
          ))}

          {/* zero line */}
          <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--line3)" strokeWidth={1} />
          <text x={PAD.l - 8} y={zeroY + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)">0</text>

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
          <path d={massPath} fill="none" stroke="var(--blue)" strokeWidth={1.6} strokeLinejoin="round" opacity={0.95} />

          {/* level rules */}
          {lines.map((l) =>
            l.k != null && Number.isFinite(l.k) && l.k >= k0 && l.k <= k1 ? (
              <g key={l.label}>
                <line
                  x1={x(l.k)} x2={x(l.k)} y1={PAD.t} y2={H - PAD.b}
                  stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} opacity={0.85}
                />
                <text
                  x={x(l.k)} y={PAD.t - 4}
                  textAnchor={x(l.k) > W - PAD.r - 60 ? "end" : x(l.k) < PAD.l + 60 ? "start" : "middle"}
                  fontSize={9.5} fill={l.color} fontWeight={700}
                  style={{ letterSpacing: ".04em" }}
                >
                  {l.label}
                </text>
              </g>
            ) : null
          )}

          {/* hover guide */}
          {hv && (
            <line x1={x(hv.k)} x2={x(hv.k)} y1={PAD.t} y2={H - PAD.b}
              stroke="var(--cyan)" strokeWidth={1} opacity={0.55} />
          )}

          {/* x axis */}
          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line2)" strokeWidth={1} />
          {ticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - PAD.b + 15} textAnchor="middle" fontSize={10}
              fill="var(--dim2)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {nf0(t)}
            </text>
          ))}
          <text x={PAD.l + (W - PAD.l - PAD.r) / 2} y={H - 3} textAnchor="middle" fontSize={10}
            fill="var(--dim2)" style={{ letterSpacing: ".08em", textTransform: "uppercase" }}>
            Strike
          </text>
        </svg>

        <div className="gd-stats">
          <span className="n">Center of gamma mass</span>
          <span className="v">{nf0(mu)}</span>
          <span className="n">Dispersion (1σ)</span>
          <span className="v">±{nf0(sigma)} pts <em>{nf0(mu - sigma)} – {nf0(mu + sigma)}</em></span>
          <span className="n">Mass inside ±1σ</span>
          <span className="v">{insidePct.toFixed(0)}%</span>
          <span className="n">Net GEX, {nf0(k0)}–{nf0(k1)}</span>
          <span className="v">{fmtB(netTotal)}</span>
          <span className="n">Gamma mass, total</span>
          <span className="v">{fmtB(totalMass, false)}</span>
        </div>

        <div className="gd-legend">
          <span><i style={{ borderTopColor: "var(--amber)" }} />Fitted normal μ={nf0(mu)} σ={nf0(sigma)} pts</span>
          <span><i style={{ borderTopColor: "var(--blue)" }} />Actual gamma mass (|call| + |put|)</span>
        </div>

        {hv && (
          <div
            className="gd-tip"
            style={{
              left: `${(x(hv.k) / W) * 100}%`,
              top: 8,
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
        ({((sigma / spot) * 100).toFixed(2)}% of spot); {insidePct.toFixed(0)}% of the board
        is inside that band, so the distribution is{" "}
        {insidePct >= 80 ? "far more peaked than the fit" : insidePct >= 68 ? "tighter than normal" : "flatter than normal"}.
        {basis === "vol"
          ? " Volume basis — this is today's trading only, so it reads near-empty before 09:30."
          : " OI basis — positioning carried into the session, which is the honest premarket read."}
        {frozen ? " Captured session, not live." : ""}
      </p>
    </div>
  );
}
