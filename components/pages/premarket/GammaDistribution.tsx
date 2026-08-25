"use client";

/**
 * NET GEX BY STRIKE — the left half of the gamma pair on /premarket.
 *
 * The ladder higher up the page answers "how big is each strike". This answers
 * "which side of the board is long gamma and which is short, and where does it
 * flip" — net GEX bars on a strike axis, with the real gamma-mass curve laid
 * over them for context. Its partner, `GammaBellCurve.tsx`, draws the mass on
 * its own axis with a least-squares normal through it; the two sit side by side
 * because they answer different halves of the same question.
 *
 * Everything the two must agree about — the OI/VOL definitions, gamma mass, the
 * ±3% board, the AUTO window, the pan/zoom hands — lives in `gammaChartKit.ts`
 * and is imported, never re-typed here.
 *
 * ── THE OI / VOL SWITCH ─────────────────────────────────────────────────────
 *   OI only   γ × OI     × S²  — positioning carried INTO the session; the
 *                               honest premarket read, since the volume leg is
 *                               ~nothing before 09:30.
 *   Vol only  γ × Volume × S²  — what is being traded TODAY.
 *
 * Deliberately NOT wired to the page's `lvlBasis`: that switch has three legs
 * and drives the Key Levels tiles, so folding them together would mean changing
 * the tiles to change this chart.
 *
 * ── PAN / ZOOM ──────────────────────────────────────────────────────────────
 * Wheel zooms (cursor-anchored), drag pans, a drag in the left gutter scales
 * the bars vertically, double-click resets to the Range tab. Same constants as
 * components/dashboard/GexChart.tsx, on purpose.
 *
 * ── SCALE ───────────────────────────────────────────────────────────────────
 * Bars are net GEX (calls +, puts −) on ONE linear scale across both sides —
 * a −500M bar must not look the same size as a +4B one, which is exactly what
 * separate per-side scales did. The mass line is drawn in the above-zero half
 * on its own factor, so it is a shape, not a second dollar axis; the y labels
 * belong to the bars only, which is why the mass line is named in the legend.
 * Both scales fit what is INSIDE the window, so zooming a quiet wing resolves
 * it instead of leaving it flat under the peak.
 *
 * Colours come from the `.pmk` custom properties (interpolated from
 * components/shared/homeTheme in Premarket.tsx) — nothing hardcoded, per
 * AGENTS.md.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ChainRow } from "@/lib/calculations/calculations";
import {
  BASIS_META, ZOOM_META,
  MAX_BAND,
  fmtB, nf0,
  foldBins, layoutLevels, moments, useGridStep, usePref, useStrikeWindow, useWideBins,
  type Bin, type GammaBasis, type GammaZoom,
} from "@/components/pages/premarket/gammaChartKit";

const BASIS_KEY = "cb-premarket-gdist-basis-v1";
const ZOOM_KEY = "cb-premarket-gdist-zoom-v1";

/** Top pad carries up to THREE packed rows of level labels, hence 58. */
const PAD = { t: 58, r: 18, b: 38, l: 72 };

export const GAMMA_DIST_CSS = `
/* THE PAIR. Two charts of the same board, side by side on a wide screen and
   stacked below 1500px — under that each half is too narrow for a strike axis
   with four level labels on it, and a cramped pair is worse than one column. */
.gd-pair{display:grid;grid-template-columns:1fr 1fr;gap:0;
  border-top:1px solid var(--line);margin-top:14px}
.gd-pair>.gdist{margin-top:0;border-top:0;min-width:0}
.gd-pair>.gdist+.gdist{border-left:1px solid var(--line)}
@media (max-width:1500px){
  .gd-pair{grid-template-columns:1fr}
  .gd-pair>.gdist+.gdist{border-left:0;border-top:1px solid var(--line)}
}

.gdist{margin-top:14px;border-top:1px solid var(--line);padding:14px 18px 6px}
.gdist .gd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  flex-wrap:wrap;margin-bottom:9px}
.gdist .gd-lh{display:flex;align-items:baseline;gap:9px;min-width:0;flex-wrap:wrap}
.gdist .gd-lh h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.gdist .gd-sub{font-size:10px;letter-spacing:.04em;color:var(--dim2);
  font-variant-numeric:tabular-nums}
.gdist .gd-rh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.gdist .gd-ctl{display:flex;align-items:center;gap:5px}
.gdist .gd-ctl>b{font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim2);
  font-weight:600}
.gdist .gd-reset{background:transparent;border:1px solid var(--amberEdge);color:var(--amber);
  font:inherit;font-size:10px;letter-spacing:.05em;padding:3px 9px;border-radius:var(--r2);
  cursor:pointer;white-space:nowrap}
.gdist .gd-reset:hover{background:var(--amberWash)}

/* KPI STRIP — the stats that used to float over the plot, unstacked above it. */
.gdist .gd-kpis{display:grid;grid-template-columns:repeat(var(--gd-cols,3),minmax(0,1fr));
  gap:7px;margin-bottom:9px}
.gdist .gd-kpi{border:1px solid var(--line);border-radius:var(--r2);background:var(--sunken);
  padding:6px 9px;min-width:0}
.gdist .gd-kpi .n{font-size:9px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gdist .gd-kpi .v{font-size:13.5px;font-weight:650;color:var(--txt);margin-top:2px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.gdist .gd-kpi .m{font-size:9.5px;color:var(--dim2);font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.gdist .gd-legend{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:10px;
  color:var(--dim);font-variant-numeric:tabular-nums}
.gdist .gd-legend span{display:flex;align-items:center;gap:6px;white-space:nowrap}
.gdist .gd-legend i{display:block;width:14px;height:0;border-top-width:2px;border-top-style:solid;flex:0 0 14px}
.gdist .gd-legend i.sw{height:9px;border:0;border-radius:2px;width:11px;flex:0 0 11px}

.gdist .gd-wrap{position:relative;width:100%}
/* pan-y keeps the PAGE scrollable under a vertical flick on a phone while a
   horizontal drag still pans the chart. */
.gdist svg{display:block;width:100%;height:auto;touch-action:pan-y;cursor:grab;
  user-select:none;-webkit-user-select:none}
.gdist svg.dragging{cursor:grabbing}
.gdist .gd-tip{position:absolute;pointer-events:none;z-index:3;transform:translateX(-50%);
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:6px 9px;font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--txt);
  box-shadow:0 8px 22px rgba(0,0,0,.35);white-space:nowrap;line-height:1.55}
.gdist .gd-tip b{font-weight:700}
.gdist .gd-tip .r{display:flex;justify-content:space-between;gap:14px;color:var(--dim2)}
.gdist .gd-tip .r span:last-child{color:var(--txt)}
.gdist .gd-foot{font-size:11px;color:var(--dim2);line-height:1.6;margin:9px 0 4px}
.gdist .gd-foot b{color:var(--dim);font-weight:650}
.gdist .gd-empty{padding:48px 0;text-align:center;color:var(--dim);font-size:12px}
@media (max-width:820px){ .gdist .gd-kpis{--gd-cols:2} }
`;

export default function GammaDistribution({
  chain, spot, expiry, isZeroDte, flip, callWall, putWall, frozen,
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
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [basis, pickBasis] = usePref<GammaBasis>(BASIS_KEY, "oi", BASIS_META);
  const [zoom, setZoomPref] = usePref<GammaZoom>(ZOOM_KEY, "auto", ZOOM_META);

  // ── responsive box ────────────────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [W, setW] = useState(760);
  const measure = useCallback((el: HTMLDivElement | null) => {
    wrapRef.current = el;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = e?.contentRect?.width ?? 0;
      if (w > 0) setW(Math.max(320, Math.round(w)));
    });
    ro.observe(el);
  }, []);
  /** Height follows width so the plot keeps a shape instead of letterboxing. */
  const H = Math.round(Math.min(620, Math.max(430, W * 0.62)));
  const plotW = Math.max(80, W - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;

  const wide = useWideBins(chain, spot, basis);
  const gridStep = useGridStep(wide);

  const win = useStrikeWindow({
    spot, wide, zoom, flip, callWall, putWall,
    W, padL: PAD.l, plotW, svgRef,
  });
  const { k0, k1, yScale, dragging, touched, reset } = win;

  const pickZoom = useCallback((z: GammaZoom) => {
    setZoomPref(z);
    reset(); // a Range tab is an explicit "show me THIS band"
  }, [setZoomPref, reset]);

  // ── bins: everything drawn (a margin past each edge, clipped) and the subset
  //    INSIDE the window, which is what the scales and stats fit to ──────────
  const binsAll = useMemo<Bin[]>(() => {
    if (!wide.length || !(k1 > k0)) return [];
    return foldBins(wide.filter((b) => b.k >= k0 - 2 * gridStep && b.k <= k1 + 2 * gridStep));
  }, [wide, k0, k1, gridStep]);
  const binsIn = useMemo(() => binsAll.filter((b) => b.k >= k0 && b.k <= k1), [binsAll, k0, k1]);

  const fit = useMemo(() => {
    const m = moments(binsIn);
    if (!m) return null;
    const inside = binsIn
      .filter((b) => b.k >= m.mu - m.sigma && b.k <= m.mu + m.sigma)
      .reduce((s, b) => s + b.mass, 0);
    return {
      mu: m.mu, sigma: m.sigma, totalMass: m.total,
      insidePct: (inside / m.total) * 100,
      netTotal: binsIn.reduce((s, b) => s + b.net, 0),
    };
  }, [binsIn]);

  // ── scales ────────────────────────────────────────────────────────────────
  const geo = useMemo(() => {
    if (!binsIn.length) return null;
    const maxP = Math.max(0, ...binsIn.map((b) => b.net));
    const maxN = Math.max(0, ...binsIn.map((b) => -b.net));
    const span = maxP + maxN || 1;
    // ONE linear scale across both sides — the zero line sits wherever the
    // pos/neg split puts it, and a small put side gets a small strip, which is
    // the truth. (Per-side scales made a −500M bar as tall as a +4B one.)
    const zeroY = PAD.t + plotH * (maxP / span);
    const pxPerDollar = (plotH / span) * yScale;
    const x = (k: number) => PAD.l + ((k - k0) / (k1 - k0)) * plotW;
    const y = (v: number) => zeroY - v * pxPerDollar;
    const maxMass = Math.max(...binsIn.map((b) => b.mass), 1);
    const mScale = ((zeroY - PAD.t) / maxMass) * yScale;
    const yMass = (m: number) => zeroY - m * mScale;
    const slot = (plotW / Math.max(1, k1 - k0)) * gridStep;
    const barW = slot > 6 ? Math.max(3, slot - 3) : Math.max(1.5, slot * 0.82);
    return { zeroY, x, y, yMass, maxP, maxN, barW };
  }, [binsIn, k0, k1, plotW, plotH, yScale, gridStep]);

  // ── hover ─────────────────────────────────────────────────────────────────
  const [hover, setHover] = useState<number | null>(null);
  const onPointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (win.onPointerMove(e)) { setHover(null); return; }
    if (!geo || !binsIn.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    if (px < PAD.l || px > W - PAD.r) { setHover(null); return; }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < binsIn.length; i++) {
      const d = Math.abs(geo.x(binsIn[i].k) - px);
      if (d < bestD) { bestD = d; best = i; }
    }
    setHover(best);
  }, [win, geo, binsIn, W]);
  const hv = hover != null && hover < binsIn.length ? binsIn[hover] : null;

  // ── head ──────────────────────────────────────────────────────────────────
  const meta = BASIS_META[basis];
  const head = (
    <div className="gd-head">
      <div className="gd-lh">
        <h3>Net GEX by Strike</h3>
        <span className="gd-sub">
          {isZeroDte ? "0DTE" : "front"} · {meta.long}
          {binsIn.length ? ` · ${nf0(k0)} – ${nf0(k1)}` : ""}
          {yScale !== 1 ? ` · y ×${yScale.toFixed(2)}` : ""}
        </span>
      </div>
      <div className="gd-rh">
        {touched && (
          <button type="button" className="gd-reset" onClick={reset}
            title="Back to the Range tab's window and y-scale (or just double-click the chart)">
            ⤾ reset
          </button>
        )}
        <div className="gd-ctl">
          <b>Range</b>
          <div className="seg" role="group" aria-label="Strike window">
            {(Object.keys(ZOOM_META) as GammaZoom[]).map((z) => (
              <button key={z} type="button"
                className={zoom === z && !touched ? "on" : ""}
                aria-pressed={zoom === z && !touched}
                title={ZOOM_META[z].hint}
                onClick={() => pickZoom(z)}>
                {ZOOM_META[z].tab}
              </button>
            ))}
          </div>
        </div>
        <div className="gd-ctl">
          <b>Basis</b>
          <div className="seg" role="group" aria-label="Gamma basis">
            {(Object.keys(BASIS_META) as GammaBasis[]).map((b) => (
              <button key={b} type="button"
                className={basis === b ? "on" : ""}
                aria-pressed={basis === b}
                title={BASIS_META[b].hint}
                onClick={() => pickBasis(b)}>
                {BASIS_META[b].tab}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (!binsIn.length || !fit || !geo) {
    return (
      <div className="gdist">
        {head}
        <div className="gd-empty">
          {chain.length === 0
            ? "Waiting for the chain…"
            : basis === "vol"
              ? "No volume on this board yet — the session has not traded. Switch to OI."
              : touched
                ? "Nothing in this window — double-click to reset the view."
                : `No gamma within ±${(MAX_BAND * 100).toFixed(0)}% of spot on this basis.`}
        </div>
      </div>
    );
  }

  const { mu, sigma, insidePct, netTotal, totalMass } = fit;
  const { zeroY, x, y, yMass, maxP, maxN, barW } = geo;

  const massPath = binsAll
    .map((b, i) => `${i === 0 ? "M" : "L"}${x(b.k).toFixed(2)},${yMass(b.mass).toFixed(2)}`)
    .join(" ");

  const rawStep = (k1 - k0) / 6;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(k0 / tickStep) * tickStep; t <= k1; t += tickStep) ticks.push(t);

  const yTicks = [maxP, maxP * 0.5, -maxN * 0.5, -maxN].filter((v) => Math.abs(v) > 0);

  const levels = layoutLevels([
    { k: putWall, label: `Put wall ${nf0(putWall ?? 0)}`, color: "var(--pw)", dash: "3 3" },
    { k: callWall, label: `Call wall ${nf0(callWall ?? 0)}`, color: "var(--cw)", dash: "3 3" },
    { k: flip, label: `Flip ${nf0(flip ?? 0)}`, color: "var(--violet)", dash: "5 4" },
    { k: spot, label: `Spot ${nf0(spot)}`, color: "var(--txt)", dash: "6 4" },
  ], { k0, k1, spot, x, W, padL: PAD.l, padR: PAD.r });

  return (
    <div className="gdist">
      {head}

      <div className="gd-kpis">
        <div className="gd-kpi">
          <div className="n">Net GEX, window</div>
          <div className={`v ${netTotal >= 0 ? "chg-pos" : "chg-neg"}`}>{fmtB(netTotal)}</div>
          <div className="m">{netTotal >= 0 ? "dealers dampen" : "dealers amplify"}</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Center of mass</div>
          <div className="v">{nf0(mu)}</div>
          <div className="m">{mu >= spot ? "+" : "−"}{nf0(Math.abs(mu - spot))} vs spot</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Gamma mass, total</div>
          <div className="v">{fmtB(totalMass, false)}</div>
          <div className="m">{meta.long}</div>
        </div>
      </div>

      <div className="gd-wrap" ref={measure}>
        <svg
          ref={svgRef}
          className={dragging ? "dragging" : undefined}
          viewBox={`0 0 ${W} ${H}`} width={W} height={H}
          role="img"
          aria-label={`Net gamma exposure per strike on the ${meta.long} basis. Scroll to zoom, drag to pan, double-click to reset.`}
          onPointerDown={win.onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={win.endDrag}
          onPointerCancel={win.endDrag}
          onDoubleClick={reset}
          onMouseLeave={() => { win.endDrag(); setHover(null); }}
        >
          <defs>
            {/* Data is clipped to the plot so a pan or a y-scale drag cannot
                spill bars over the axes and labels. */}
            <clipPath id={`gd-clip-${clipId}`}>
              <rect x={PAD.l} y={PAD.t - 8} width={plotW} height={plotH + 8} />
            </clipPath>
          </defs>

          <rect
            x={x(Math.max(k0, mu - sigma))} y={PAD.t}
            width={Math.max(0, x(Math.min(k1, mu + sigma)) - x(Math.max(k0, mu - sigma)))}
            height={plotH} fill="var(--amberWash)"
          />

          {yTicks.map((v) => {
            const yy = y(v);
            if (yy < PAD.t - 2 || yy > H - PAD.b + 2) return null;
            return (
              <g key={`y${v}`}>
                <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 9} y={yy + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)"
                  style={{ fontVariantNumeric: "tabular-nums" }}>{fmtB(v)}</text>
              </g>
            );
          })}

          <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--line3)" strokeWidth={1} />
          <text x={PAD.l - 9} y={zeroY + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)">0</text>

          <g clipPath={`url(#gd-clip-${clipId})`}>
            {binsAll.map((b) => {
              const pos = b.net >= 0;
              const yv = y(b.net);
              return (
                <rect key={b.k}
                  x={x(b.k) - barW / 2} y={pos ? yv : zeroY}
                  width={barW} height={Math.max(0.6, Math.abs(yv - zeroY))}
                  fill={pos ? "var(--pos)" : "var(--neg)"}
                  opacity={hv == null || hv.k === b.k ? 0.92 : 0.5} />
              );
            })}
            <path d={massPath} fill="none" stroke="var(--blue)" strokeWidth={1.7}
              strokeLinejoin="round" opacity={0.95} />
          </g>

          {levels.map((l) => {
            const ly = 14 + l.row * 14;
            return (
              <g key={l.label}>
                <line x1={x(l.k)} x2={x(l.k)} y1={PAD.t - 6} y2={H - PAD.b}
                  stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} opacity={0.85} />
                <path d={`M${l.cx.toFixed(1)},${ly + 4} L${l.cx.toFixed(1)},${(PAD.t - 12).toFixed(1)} L${x(l.k).toFixed(1)},${PAD.t - 6}`}
                  fill="none" stroke={l.color} strokeWidth={1} opacity={0.45} />
                <text x={l.cx} y={ly} textAnchor="middle" fontSize={10} fill={l.color}
                  fontWeight={700} style={{ letterSpacing: ".04em" }}>{l.label}</text>
              </g>
            );
          })}

          {hv && !dragging && (
            <line x1={x(hv.k)} x2={x(hv.k)} y1={PAD.t - 6} y2={H - PAD.b}
              stroke="var(--cyan)" strokeWidth={1} opacity={0.55} />
          )}

          <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line2)" strokeWidth={1} />
          {ticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - PAD.b + 16} textAnchor="middle" fontSize={10}
              fill="var(--dim2)" style={{ fontVariantNumeric: "tabular-nums" }}>{nf0(t)}</text>
          ))}
          <text x={PAD.l + plotW / 2} y={H - 5} textAnchor="middle" fontSize={9}
            fill="var(--dim2)" style={{ letterSpacing: ".1em", textTransform: "uppercase" }}>Strike</text>
          <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize={9} fill="var(--dim2)" opacity={0.7}>
            scroll=zoom · drag=pan · dbl=reset
          </text>
        </svg>

        {hv && !dragging && (
          <div className="gd-tip"
            style={{ left: `clamp(76px, ${((x(hv.k) / W) * 100).toFixed(2)}%, calc(100% - 76px))`, top: 4 }}>
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
        {" "}Mass centres on <b>{nf0(mu)}</b>, {insidePct.toFixed(0)}% of it inside ±{nf0(sigma)} pts.
        {touched ? " View pinned — double-click to follow spot again." : ""}
        {frozen ? " Captured session, not live." : ""}
      </p>
    </div>
  );
}
