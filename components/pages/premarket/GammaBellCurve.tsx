"use client";

/**
 * GAMMA BELL CURVE — the right half of the gamma pair on /premarket.
 *
 * Two stacked panes over ONE strike axis:
 *
 *   TOP     gamma mass per strike (|call GEX| + |put GEX|) as a histogram, with
 *           a LEAST-SQUARES normal drawn through it. "What bell would you draw
 *           through these bars, and how wide is it?"
 *   BOTTOM  net GEX per strike, green above zero and red below, with the long-
 *           gamma / short-gamma sides named on the pane. "Which side of the
 *           board dampens and which amplifies?"
 *
 * Its partner, `GammaDistribution.tsx`, puts net GEX on the main axis with the
 * mass as an overlay. Same numbers, opposite emphasis — which is the point of
 * having both on screen at once. Everything they must agree about lives in
 * `gammaChartKit.ts`.
 *
 * ── WHY LEAST SQUARES AND NOT THE MOMENT FIT ────────────────────────────────
 * The moment fit (Σm·k / Σm and its sd) is dragged around by every far-OTM
 * strike carrying a sliver of gamma. On a 0DTE board that inflates σ and pulls
 * μ off the visible peak, so the drawn curve does not sit on the bars and the
 * printed "σ = N pts" is not the width anyone can see. The least-squares fit
 * answers the question the eye is asking. Both numbers are honest; only one of
 * them describes the picture, and this card prints the one that does. (The
 * method, its weighting, and the fallback are documented in the kit.)
 *
 * ── PAN / ZOOM ──────────────────────────────────────────────────────────────
 * Wheel zooms cursor-anchored, drag pans, a drag in the left gutter scales both
 * panes vertically, double-click resets. GexChart's constants, via the kit.
 *
 * ── SCALES ──────────────────────────────────────────────────────────────────
 * The two panes have SEPARATE y scales and that is deliberate: mass is always
 * positive and the fit lives on it, while net GEX is signed and needs its zero
 * line placed by the pos/neg split. They share only the strike axis, the level
 * rules and the ±1σ band, which is exactly what makes reading down a strike
 * from one pane to the other mean something.
 *
 * Colours come from the `.pmk` custom properties — nothing hardcoded, per
 * AGENTS.md.
 */

import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ChainRow } from "@/lib/calculations/calculations";
import {
  BASIS_META, ZOOM_META,
  MAX_BAND,
  fmtB, nf0,
  foldBins, layoutLevels, lsqGaussian, massInside,
  useGridStep, usePref, useStrikeWindow, useWideBins,
  type Bin, type GammaBasis, type GammaZoom,
} from "@/components/pages/premarket/gammaChartKit";

const BASIS_KEY = "cb-premarket-gbell-basis-v1";
const ZOOM_KEY = "cb-premarket-gbell-zoom-v1";

/** Top pad carries up to THREE packed rows of level labels, hence 58. */
const PAD = { t: 58, r: 18, b: 38, l: 72 };
/** Gap between the mass pane and the net pane. */
const GAP = 16;
/** The mass pane gets the lion's share — it carries the fit. */
const TOP_SHARE = 0.6;

export const GAMMA_BELL_CSS = `
.gdist .gd-pane-l{font-size:9px;letter-spacing:.09em;text-transform:uppercase;font-weight:700}
`;

export default function GammaBellCurve({
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
  const H = Math.round(Math.min(620, Math.max(430, W * 0.62)));
  const plotW = Math.max(80, W - PAD.l - PAD.r);
  const plotH = H - PAD.t - PAD.b;
  const topH = Math.max(60, (plotH - GAP) * TOP_SHARE);
  const botH = Math.max(50, plotH - GAP - topH);
  const topY0 = PAD.t;              // top of the mass pane
  const topY1 = PAD.t + topH;       // baseline of the mass pane
  const botY0 = topY1 + GAP;        // top of the net pane
  const botY1 = botY0 + botH;       // bottom of the net pane

  const wide = useWideBins(chain, spot, basis);
  const gridStep = useGridStep(wide);

  const win = useStrikeWindow({
    spot, wide, zoom, flip, callWall, putWall,
    W, padL: PAD.l, plotW, svgRef,
  });
  const { k0, k1, yScale, dragging, touched, reset } = win;

  const pickZoom = useCallback((z: GammaZoom) => {
    setZoomPref(z);
    reset();
  }, [setZoomPref, reset]);

  const binsAll = useMemo<Bin[]>(() => {
    if (!wide.length || !(k1 > k0)) return [];
    return foldBins(wide.filter((b) => b.k >= k0 - 2 * gridStep && b.k <= k1 + 2 * gridStep));
  }, [wide, k0, k1, gridStep]);
  const binsIn = useMemo(() => binsAll.filter((b) => b.k >= k0 && b.k <= k1), [binsAll, k0, k1]);

  // ── the fit, on what is inside the window ─────────────────────────────────
  const fit = useMemo(() => {
    const g = lsqGaussian(binsIn);
    if (!g) return null;
    return {
      ...g,
      insidePct: massInside(binsIn, g.mu, g.sigma),
      totalMass: binsIn.reduce((s, b) => s + b.mass, 0),
      netTotal: binsIn.reduce((s, b) => s + b.net, 0),
    };
  }, [binsIn]);

  // ── scales ────────────────────────────────────────────────────────────────
  const geo = useMemo(() => {
    if (!binsIn.length || !fit) return null;
    const x = (k: number) => PAD.l + ((k - k0) / (k1 - k0)) * plotW;

    // TOP: mass. The curve's own peak can sit above the tallest bar (or well
    // below it, which is the interesting case), so the pane is scaled to
    // whichever is larger — clipping the fit would hide exactly the mismatch
    // this card exists to show.
    const maxMass = Math.max(...binsIn.map((b) => b.mass), fit.a, 1);
    const massPx = (topH / maxMass) * yScale;
    const yTop = (m: number) => topY1 - m * massPx;

    // BOTTOM: net GEX, one linear scale across both signs.
    const maxP = Math.max(0, ...binsIn.map((b) => b.net));
    const maxN = Math.max(0, ...binsIn.map((b) => -b.net));
    const span = maxP + maxN || 1;
    const zeroY = botY0 + botH * (maxP / span);
    const netPx = (botH / span) * yScale;
    const yNet = (v: number) => zeroY - v * netPx;

    const slot = (plotW / Math.max(1, k1 - k0)) * gridStep;
    const barW = slot > 6 ? Math.max(3, slot - 3) : Math.max(1.5, slot * 0.82);
    return { x, yTop, yNet, maxMass, maxP, maxN, zeroY, barW };
  }, [binsIn, fit, k0, k1, plotW, topH, topY1, botY0, botH, yScale, gridStep]);

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
        <h3>Gamma Bell Curve</h3>
        <span className="gd-sub">
          {isZeroDte ? "0DTE" : "front"}{expiry ? ` ${expiry}` : ""} · {meta.long}
          {fit ? ` · ${fit.lsq ? "least-squares" : "moment"} fit` : ""}
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

  const { a, mu, sigma, lsq, insidePct, totalMass, netTotal } = fit;
  const { x, yTop, yNet, maxMass, maxP, maxN, zeroY, barW } = geo;

  // The fitted bell, drawn at its own amplitude — NOT normalised to the tallest
  // bar. A curve that peaks well under the histogram is the whole read on a
  // 0DTE board: the mass is far more concentrated than any normal.
  const curve = (() => {
    const N = 220;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const k = k0 + ((k1 - k0) * i) / N;
      const v = a * Math.exp(-((k - mu) ** 2) / (2 * sigma * sigma));
      pts.push(`${i === 0 ? "M" : "L"}${x(k).toFixed(2)},${yTop(v).toFixed(2)}`);
    }
    return pts.join(" ");
  })();

  const rawStep = (k1 - k0) / 6;
  const mag = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const tickStep = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep) ?? mag * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(k0 / tickStep) * tickStep; t <= k1; t += tickStep) ticks.push(t);

  const massTicks = [maxMass, maxMass * 0.5];
  const netTicks = [maxP, -maxN].filter((v) => Math.abs(v) > 0);

  const levels = layoutLevels([
    { k: putWall, label: `Put wall ${nf0(putWall ?? 0)}`, color: "var(--pw)", dash: "3 3" },
    { k: callWall, label: `Call wall ${nf0(callWall ?? 0)}`, color: "var(--cw)", dash: "3 3" },
    { k: flip, label: `Flip ${nf0(flip ?? 0)}`, color: "var(--violet)", dash: "5 4" },
    { k: spot, label: `Spot ${nf0(spot)}`, color: "var(--txt)", dash: "6 4" },
  ], { k0, k1, spot, x, W, padL: PAD.l, padR: PAD.r });

  const sigmaL = x(Math.max(k0, mu - sigma));
  const sigmaR = x(Math.min(k1, mu + sigma));

  return (
    <div className="gdist">
      {head}

      <div className="gd-kpis">
        <div className="gd-kpi">
          <div className="n">Curve peak</div>
          <div className="v">{nf0(mu)}</div>
          <div className="m">{mu >= spot ? "+" : "−"}{nf0(Math.abs(mu - spot))} vs spot</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Width 1σ</div>
          <div className="v">±{nf0(sigma)} pts</div>
          <div className="m">{nf0(mu - sigma)} – {nf0(mu + sigma)}</div>
        </div>
        <div className="gd-kpi">
          <div className="n">Mass inside 1σ</div>
          <div className="v">{insidePct.toFixed(0)}%</div>
          <div className="m">{fmtB(totalMass, false)} total</div>
        </div>
      </div>

      <div className="gd-wrap" ref={measure}>
        <svg
          ref={svgRef}
          className={dragging ? "dragging" : undefined}
          viewBox={`0 0 ${W} ${H}`} width={W} height={H}
          role="img"
          aria-label={`Gamma mass per strike on the ${meta.long} basis with a fitted normal curve, over a net GEX pane. Scroll to zoom, drag to pan, double-click to reset.`}
          onPointerDown={win.onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={win.endDrag}
          onPointerCancel={win.endDrag}
          onDoubleClick={reset}
          onMouseLeave={() => { win.endDrag(); setHover(null); }}
        >
          <defs>
            <clipPath id={`gb-top-${clipId}`}>
              <rect x={PAD.l} y={topY0 - 8} width={plotW} height={topH + 8} />
            </clipPath>
            <clipPath id={`gb-bot-${clipId}`}>
              <rect x={PAD.l} y={botY0} width={plotW} height={botH} />
            </clipPath>
          </defs>

          {/* ±1σ band, drawn through BOTH panes — it is the one thing that has
              the same meaning in each, and it is what makes reading a strike
              down from the histogram to the net pane worth doing. */}
          <rect x={sigmaL} y={topY0} width={Math.max(0, sigmaR - sigmaL)} height={botY1 - topY0}
            fill="var(--amberWash)" />

          {/* ── TOP PANE: gamma mass ───────────────────────────────────────── */}
          {massTicks.map((v) => {
            const yy = yTop(v);
            if (yy < topY0 - 2 || yy > topY1) return null;
            return (
              <g key={`m${v}`}>
                <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 9} y={yy + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)"
                  style={{ fontVariantNumeric: "tabular-nums" }}>{fmtB(v, false)}</text>
              </g>
            );
          })}
          <line x1={PAD.l} x2={W - PAD.r} y1={topY1} y2={topY1} stroke="var(--line2)" strokeWidth={1} />
          <text x={PAD.l - 9} y={topY1 + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)">0</text>
          <text x={PAD.l} y={topY0 - 6} fontSize={9} fill="var(--dim2)" className="gd-pane-l">
            Gamma mass
          </text>

          <g clipPath={`url(#gb-top-${clipId})`}>
            {binsAll.map((b) => {
              const yv = yTop(b.mass);
              return (
                <rect key={`m${b.k}`}
                  x={x(b.k) - barW / 2} y={yv}
                  width={barW} height={Math.max(0.6, topY1 - yv)}
                  fill="var(--blue)"
                  opacity={hv == null || hv.k === b.k ? 0.72 : 0.4} />
              );
            })}
            <path d={curve} fill="none" stroke="var(--amber)" strokeWidth={2.2} strokeLinejoin="round" />
          </g>

          {/* ── BOTTOM PANE: net GEX ───────────────────────────────────────── */}
          {netTicks.map((v) => {
            const yy = yNet(v);
            if (yy < botY0 - 2 || yy > botY1 + 2) return null;
            return (
              <g key={`n${v}`}>
                <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} />
                <text x={PAD.l - 9} y={yy + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)"
                  style={{ fontVariantNumeric: "tabular-nums" }}>{fmtB(v)}</text>
              </g>
            );
          })}
          <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} stroke="var(--line3)" strokeWidth={1} />
          <text x={PAD.l - 9} y={zeroY + 3.5} textAnchor="end" fontSize={10} fill="var(--dim2)">0</text>

          <g clipPath={`url(#gb-bot-${clipId})`}>
            {binsAll.map((b) => {
              const pos = b.net >= 0;
              const yv = yNet(b.net);
              return (
                <rect key={`n${b.k}`}
                  x={x(b.k) - barW / 2} y={pos ? yv : zeroY}
                  width={barW} height={Math.max(0.6, Math.abs(yv - zeroY))}
                  fill={pos ? "var(--pos)" : "var(--neg)"}
                  opacity={hv == null || hv.k === b.k ? 0.92 : 0.5} />
              );
            })}
          </g>
          {/* The two sides named on the pane itself, so "green/red" never has
              to be looked up in a legend. */}
          <text x={PAD.l + 6} y={botY0 + 11} fontSize={9} fill="var(--pos)" className="gd-pane-l">
            long gamma · dealers dampen
          </text>
          <text x={PAD.l + 6} y={botY1 - 4} fontSize={9} fill="var(--neg)" className="gd-pane-l">
            short gamma · dealers amplify
          </text>

          {/* ── shared: level rules across both panes ──────────────────────── */}
          {levels.map((l) => {
            const ly = 14 + l.row * 14;
            return (
              <g key={l.label}>
                <line x1={x(l.k)} x2={x(l.k)} y1={topY0 - 6} y2={botY1}
                  stroke={l.color} strokeWidth={1.2} strokeDasharray={l.dash} opacity={0.85} />
                <path d={`M${l.cx.toFixed(1)},${ly + 4} L${l.cx.toFixed(1)},${(topY0 - 12).toFixed(1)} L${x(l.k).toFixed(1)},${topY0 - 6}`}
                  fill="none" stroke={l.color} strokeWidth={1} opacity={0.45} />
                <text x={l.cx} y={ly} textAnchor="middle" fontSize={10} fill={l.color}
                  fontWeight={700} style={{ letterSpacing: ".04em" }}>{l.label}</text>
              </g>
            );
          })}

          {hv && !dragging && (
            <line x1={x(hv.k)} x2={x(hv.k)} y1={topY0 - 6} y2={botY1}
              stroke="var(--cyan)" strokeWidth={1} opacity={0.55} />
          )}

          {/* ── x axis ─────────────────────────────────────────────────────── */}
          <line x1={PAD.l} x2={W - PAD.r} y1={botY1} y2={botY1} stroke="var(--line2)" strokeWidth={1} />
          {ticks.map((t) => (
            <text key={`x${t}`} x={x(t)} y={botY1 + 16} textAnchor="middle" fontSize={10}
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
            <div className="r"><span>mass</span><span>{fmtB(hv.mass, false)}</span></div>
            <div className="r"><span>net</span><span>{fmtB(hv.net)}</span></div>
            <div className="r"><span>fit</span><span>{fmtB(a * Math.exp(-((hv.k - mu) ** 2) / (2 * sigma * sigma)), false)}</span></div>
          </div>
        )}
      </div>

      <p className="gd-foot">
        Bell peaks at <b>{nf0(mu)}</b> with a 1σ width of <b>±{nf0(sigma)}</b> pts
        ({((sigma / spot) * 100).toFixed(2)}% of spot); {insidePct.toFixed(0)}% of the mass
        is inside it, so the board is{" "}
        {insidePct >= 80 ? "far more concentrated than the fitted normal"
          : insidePct >= 68 ? "tighter than normal"
            : "flatter than normal"}.
        {" "}Net GEX over the window is <b>{fmtB(netTotal)}</b>.
        {!lsq ? " Not bell-shaped enough to fit — falling back to the moment curve." : ""}
        {frozen ? " Captured session, not live." : ""}
      </p>
    </div>
  );
}
