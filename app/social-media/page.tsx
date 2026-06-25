"use client";

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeRefLevels } from "@/lib/failLevels";

/* ────────────────────────────────────────────────────────────────────────────
 * Social Media (admin) — turns the daily pre-market GEX read into a shareable
 * "SPX · Daily Levels" card for X.
 *
 * Left "Daily Input" panel hydrates from live dashboard state via
 * /api/social-media/daily-input (SPX spot / prior close / gamma flip / call+put
 * walls / expected move / net GEX / ES overnight H-L) and seeds the Bias field
 * from the options-flow regime. Every field stays editable for event-day edits.
 *
 * Right column renders the share card (auto-filled from the left, EM range
 * computed off the prior-day close). Two actions: "Copy card" renders the card
 * to a PNG via html2canvas and writes the IMAGE to the clipboard; "Copy & Open
 * X" copies the image and opens the X composer to paste it. Both fall back to a
 * PNG download when the browser blocks clipboard image writes.
 *
 * Themed with the dashboard's tokens. The page aliases the legacy v2 names the
 * design reference used (--bg0/--bg1/--cyan/--text2…) onto the real global
 * stylesheet tokens (--bg/--surface/--accent/--text…) so nothing hardcodes a
 * new color and the names resolve on this route.
 * ──────────────────────────────────────────────────────────────────────────── */

// Dynamic html2canvas import (same pattern as EstimatedMoves) — keeps it out of
// the initial bundle and off the server.
async function getHtml2Canvas() {
  const mod = await import("html2canvas" as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (mod as any).default ?? mod;
}

interface DailyInput {
  spxSpot: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;
  expectedMove: number | null;
  expectedMoveExpiry: string | null;
  netGex: number | null;
  esOvernightHigh: number | null;
  esOvernightLow: number | null;
  spxPrevClose: number | null;
  emUpper: number | null;
  emLower: number | null;
  gexLadder?: { strike: number; netGex: number }[];
}

// Per-strike net GEX (netGex in $millions) for the Explainer ladder.
export interface GexLadderRow { strike: number; netGex: number }

// Editable form state — strings so partial edits never coerce to NaN mid-type.
interface FormState {
  spot: string;
  prevClose: string;
  flip: string;
  call: string;
  put: string;
  em: string;
  gex: string;
  ovn: string;
  bias: string;
}

const EMPTY_FORM: FormState = {
  spot: "",
  prevClose: "",
  flip: "",
  call: "",
  put: "",
  em: "",
  gex: "",
  ovn: "",
  bias: "",
};

// EM band off the prior-day close: [lower, upper] = close ∓ EM. Returns null
// when either input is missing/non-numeric.
function emBand(form: FormState): { lower: number; upper: number } | null {
  const close = toNum(form.prevClose);
  const em = toNum(form.em);
  if (!Number.isFinite(close) || !Number.isFinite(em) || close <= 0 || em <= 0) return null;
  return { lower: close - em, upper: close + em };
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  return parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// Today's date in ET as YYYY-MM-DD — matches the fails page / failLevels window.
function todayETStr(): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  p.forEach((x) => { m[x.type] = x.value; });
  return `${m.year}-${m.month}-${m.day}`;
}

// ── Bias from the options-flow regime ────────────────────────────────────────
// Net GEX sign is the source of truth for the regime label (it must always
// agree with the net GEX value the card shows). Spot-vs-flip is context only.
function deriveBias(netGex: number, spot: number, flip: number): string {
  const negative = Number.isFinite(netGex) && netGex < 0;
  const underFlip = Number.isFinite(spot) && Number.isFinite(flip) && spot < flip;
  if (negative) {
    return "Negative-gamma regime — dealers amplify moves; downside breaks can extend, momentum over mean-reversion.";
  }
  return underFlip
    ? "Positive-gamma regime — dealers dampen moves; mean-reversion favored, though spot under the flip keeps a downside tilt until it reclaims."
    : "Positive-gamma regime — dealers dampen moves; fade extremes, expect mean-reversion while spot holds over the flip.";
}

// ── Gamma regime (strip) ─────────────────────────────────────────────────────
// Regime is decided by the SIGN OF NET GEX so the label can never contradict the
// net GEX value on the card. Spot-vs-flip is shown as a context line (and flags
// the case where the two disagree) but does not flip the label.
interface Regime {
  neg: boolean;
  label: string;
  sub: string;
  coreBehavior: string;
  priceAction: string;
  tradingImplications: string;
}
function regimeOf(form: FormState): Regime {
  const spot = toNum(form.spot);
  const flip = toNum(form.flip);
  const gex = toNum(form.gex);
  const negative = Number.isFinite(gex) && gex < 0;
  const haveFlip = Number.isFinite(spot) && Number.isFinite(flip);
  const underFlip = haveFlip && spot < flip;

  if (negative) {
    return {
      neg: true,
      label: "NEGATIVE GAMMA",
      sub: underFlip
        ? "Net GEX negative · spot under the flip — dealers amplify moves, plan for trend not chop."
        : "Net GEX negative — dealers amplify moves; plan for trend, not chop.",
      coreBehavior:
        "Dealers are short gamma — they hedge with the move, selling weakness and buying strength, which adds fuel rather than absorbing it.",
      priceAction:
        "Expect trend over chop: wider ranges, faster impulse legs, and breaks of key levels that extend rather than mean-revert.",
      tradingImplications:
        "Favor momentum and breakout continuation; trade with the trend, give stops room, and fade extremes only at the call/put walls.",
    };
  }
  return {
    neg: false,
    label: "POSITIVE GAMMA",
    sub: underFlip
      ? "Net GEX positive · spot still under the flip — dampening in play, but watch for a flip reclaim."
      : "Net GEX positive · spot over the flip — dealers dampen moves, fade extremes.",
    coreBehavior:
      "Dealers are long gamma — they hedge against the move, buying dips and selling rips, which absorbs volatility and pins price.",
    priceAction:
      "Expect mean-reversion and compression: tighter ranges, fading impulses, and price gravitating back toward the gamma flip / high-OI strikes.",
    tradingImplications:
      underFlip
        ? "Fade extremes back toward the flip, but stay nimble — a reclaim of the flip removes the dampening and can release a trend."
        : "Fade extremes and sell premium into the walls; expect rotational, range-bound trade until the flip breaks.",
  };
}

// ── EM range readout (off the prior-day close) ───────────────────────────────
// Shows the expected range as lower / upper centered on the SPX prior close,
// e.g. "Close 6,012 · ±56 → 5,956 / 6,068". Prompts for a close if missing.
function EmRangeReadout({ form }: { form: FormState }) {
  const band = emBand(form);
  if (!band) {
    const haveClose = Number.isFinite(toNum(form.prevClose)) && toNum(form.prevClose) > 0;
    return (
      <div className="hint">
        {haveClose
          ? "enter an expected move to see the range"
          : "enter SPX prior close to anchor the EM range"}
      </div>
    );
  }
  const close = toNum(form.prevClose);
  const em = toNum(form.em);
  return (
    <div className="sm-emrange">
      <span className="lo">{fmt(band.lower)}</span>
      <span className="mid">
        Close {fmt(close)} · ±{fmt(em)}
      </span>
      <span className="hi">{fmt(band.upper)}</span>
    </div>
  );
}

// ── Level ladder ─────────────────────────────────────────────────────────────
function LevelLadder({ form }: { form: FormState }) {
  const pts = useMemo(() => {
    const raw = [
      { k: "call", lab: "Call wall", v: toNum(form.call) },
      { k: "flip", lab: "Gamma flip", v: toNum(form.flip) },
      { k: "spot", lab: "Spot", v: toNum(form.spot) },
      { k: "put", lab: "Put wall", v: toNum(form.put) },
    ].filter((p) => Number.isFinite(p.v));
    raw.sort((a, b) => b.v - a.v);
    return raw;
  }, [form.call, form.flip, form.spot, form.put]);

  if (!pts.length) return null;
  const vals = pts.map((p) => p.v);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const span = hi - lo || 1;

  return (
    <div className="sm-ladder">
      {pts.map((p) => {
        const pct = ((p.v - lo) / span) * 100;
        return (
          <div key={p.k} className={`sm-ladder-row dot-${p.k}`}>
            <span className="lab">{p.lab}</span>
            <span className="bar">
              <i style={{ left: `${pct.toFixed(1)}%` }} />
            </span>
            <span className="val">{p.v.toLocaleString("en-US")}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Share card (the shareable image) ─────────────────────────────────────────
// Mirrors the published-card design: SPX · Daily Levels header, Estimated Move
// row (Spot box = prior close, EM, Up, Down off the close), regime strip,
// Upside/Downside levels, Overnight Action, CB Edge footer + disclaimer. Pure
// presentational; html2canvas captures the forwarded ref.
function ShareValue({ v, color }: { v: string; color?: string }) {
  return <div className="sc-val" style={color ? { color } : undefined}>{v || "—"}</div>;
}

const ShareCard = forwardRef<HTMLDivElement, {
  form: FormState;
  regime: Regime;
  updated: string;
}>(function ShareCard({ form, regime, updated }, ref) {
  const band = emBand(form);
  const close = toNum(form.prevClose);
  const em = toNum(form.em);
  const closeStr = Number.isFinite(close) && close > 0 ? fmt(close) : "—";
  const emStr = Number.isFinite(em) && em > 0 ? fmt(em) : "—";
  const ovnParts = form.ovn.split("/");
  const ovnHigh = (ovnParts[0] ?? "").trim();
  const ovnLow = (ovnParts[1] ?? "").trim();

  return (
    <div ref={ref} className={`sc-card ${regime.neg ? "neg" : "pos"}`}>
      {/* header */}
      <div className="sc-head">
        <div className="sc-title">
          <span className="sc-spx">SPX</span> <span className="sc-sub">DAILY LEVELS</span>
        </div>
        <div className="sc-updated">{updated ? `Updated ${updated}` : ""}</div>
      </div>

      {/* Estimated move row */}
      <div className="sc-section">
        <div className="sc-section-h">ESTIMATED MOVE</div>
        <div className="sc-em-grid">
          <div className="sc-em-box">
            <div className="sc-em-label">CLOSE</div>
            <ShareValue v={closeStr} />
          </div>
          <div className="sc-em-box">
            <div className="sc-em-label">EM</div>
            <ShareValue v={emStr} color="var(--amber)" />
          </div>
          <div className="sc-em-box">
            <div className="sc-em-label">UP</div>
            <ShareValue v={band ? fmt(band.upper) : "—"} color="var(--sm-green)" />
          </div>
          <div className="sc-em-box">
            <div className="sc-em-label">DOWN</div>
            <ShareValue v={band ? fmt(band.lower) : "—"} color="var(--sm-red)" />
          </div>
        </div>
      </div>

      {/* regime strip */}
      <div className={`sc-regime ${regime.neg ? "neg" : "pos"}`}>
        <div className="sc-regime-label">{regime.label}</div>
        <div className="sc-regime-sub">{regime.sub}</div>
        <div className="sc-regime-bias-h">BIAS</div>
        <div className="sc-regime-bias">{form.bias || "—"}</div>
        <div className="sc-regime-detail">
          <div className="sc-regime-item">
            <div className="sc-regime-item-h">CORE BEHAVIOR</div>
            <div className="sc-regime-item-v">{regime.coreBehavior}</div>
          </div>
          <div className="sc-regime-item">
            <div className="sc-regime-item-h">PRICE ACTION EXPECTED</div>
            <div className="sc-regime-item-v">{regime.priceAction}</div>
          </div>
          <div className="sc-regime-item">
            <div className="sc-regime-item-h">TRADING IMPLICATIONS</div>
            <div className="sc-regime-item-v">{regime.tradingImplications}</div>
          </div>
        </div>
      </div>

      {/* levels */}
      <div className="sc-levels">
        <div className="sc-levels-col">
          <div className="sc-levels-h up">UPSIDE / RESISTANCE</div>
          <div className="sc-level-row">
            <span className="lab">CALL WALL</span>
            <span className="val red">{form.call ? fmt(toNum(form.call)) : "—"}</span>
          </div>
          <div className="sc-level-row">
            <span className="lab">GAMMA FLIP</span>
            <span className="val amber">{form.flip ? fmt(toNum(form.flip)) : "—"}</span>
          </div>
        </div>
        <div className="sc-levels-col">
          <div className="sc-levels-h down">DOWNSIDE / SUPPORT</div>
          <div className="sc-level-row">
            <span className="lab">PUT WALL</span>
            <span className="val green">{form.put ? fmt(toNum(form.put)) : "—"}</span>
          </div>
          <div className="sc-level-row">
            <span className="lab">NET GEX</span>
            <span className="val cyan">{form.gex || "—"}</span>
          </div>
        </div>
      </div>

      {/* overnight */}
      <div className="sc-section">
        <div className="sc-section-h">OVERNIGHT ACTION</div>
        <div className="sc-ovn">
          <span className="lab">ES OVERNIGHT (HIGH / LOW)</span>
          <span className="val">{ovnHigh || "—"} <span className="sep">/</span> {ovnLow || "—"}</span>
        </div>
      </div>

      {/* footer */}
      <div className="sc-foot">
        <div className="sc-brand">CB Edge</div>
        <div className="sc-disc">LEVELS ARE PUBLISHED DAILY AND ARE INFORMATIONAL ONLY — NOT FINANCIAL ADVICE.</div>
      </div>
    </div>
  );
});

/* Heavy/hype card styling for the GEX Image Cards tab. Scoped under .gx-wrap so
   it can't leak into the rest of the page. Cards are true 1600×900 for export. */
const GX_CSS = `
  .gx-wrap { max-width: 1720px; margin: 0 auto; }
  .gx-help { font-size: 12px; color: #9aa4b2; line-height: 1.55; max-width: 1100px; margin: 0 auto 22px; }
  .gx-help b { color: #fff; }
  .gx-stage { display: flex; flex-direction: column; gap: 36px; align-items: center; }
  .gx-cardwrap { display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .gx-caplabel { font-size: 12px; color: #9aa4b2; letter-spacing: 0.04em; align-self: flex-start; margin-left: 4px; }
  .gx-dl { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 16px; border-radius: 7px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; transition: all .12s; box-shadow: 0 0 16px rgba(0,240,255,.3); }
  .gx-dl:hover { opacity: .92; } .gx-dl:disabled { opacity: .5; cursor: default; }
  .gx-actions { display:flex; gap:10px; align-items:center; }
  .gx-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 16px; border-radius: 7px; border: 1px solid; transition: all .12s; }
  .gx-btn:hover { opacity:.9; } .gx-btn:disabled { opacity:.5; cursor:default; }
  .gx-btn.copy { background: transparent; border-color: rgba(255,255,255,.22); color:#cfd6df; }
  .gx-btn.x { background:#1d9bf0; border-color:#1d9bf0; color:#fff; box-shadow: 0 0 16px rgba(29,155,240,.3); }

  /* fit into viewport but keep true pixels for capture */
  .gx-card { width: 1600px; height: 900px; flex: 0 0 auto; position: relative; overflow: hidden;
    background:
      radial-gradient(900px 380px at 18% -8%, rgba(0,240,255,.10), transparent 60%),
      radial-gradient(820px 420px at 92% 112%, rgba(249,115,22,.10), transparent 60%),
      linear-gradient(180deg, #0a0e16 0%, #05060a 60%, #04050a 100%);
    border: 1px solid var(--sm-border); border-radius: 22px;
    box-shadow: 0 0 0 1px rgba(0,240,255,.05), 0 40px 120px rgba(0,0,0,.65);
    display: flex; flex-direction: column; transform-origin: top center; }
  .gx-card.neg { box-shadow: 0 0 0 1px rgba(239,68,68,.10), 0 40px 120px rgba(0,0,0,.65); }
  .gx-card::before { content:""; position:absolute; top:0; left:0; right:0; height:4px;
    background: linear-gradient(90deg, var(--cyan), rgba(0,240,255,0) 38%, rgba(249,115,22,0) 62%, var(--amber)); opacity:.9; }
  .gx-glow { position:absolute; width:420px; height:420px; border-radius:50%; filter: blur(90px); pointer-events:none; z-index:0; }
  .gx-glow.tl { top:-160px; left:-120px; background: rgba(0,240,255,.18); }
  .gx-glow.br { bottom:-180px; right:-140px; background: rgba(249,115,22,.16); }
  .gx-card.neg .gx-glow.br { background: rgba(239,68,68,.16); }

  .gx-head { position:absolute; top:0; left:0; right:0; z-index:4; display:grid; grid-template-columns: 1fr auto 1fr; align-items:start; padding: 22px 30px 6px; pointer-events:none; }
  .gx-head-side { display:flex; flex-direction:column; gap:3px; }
  .gx-head-side.left { align-items:flex-start; }
  .gx-head-side.right { align-items:flex-end; position:relative; z-index:6; pointer-events:auto; }
  .gx-date { font-size:20px; font-weight:800; color:#fff; letter-spacing:.01em; }
  .gx-time { font-size:13px; color:#9aa4b2; letter-spacing:.04em; }
  .gx-logo { position:absolute; top:-30px; left:50%; transform:translateX(-50%); z-index:4; display:flex; align-items:center; justify-content:center; pointer-events:none; }
  .gx-logo img { height:330px; width:auto; object-fit:contain; filter: drop-shadow(0 6px 30px rgba(0,240,255,.32)); }
  .gx-regime { position:absolute; top:26px; right:30px; z-index:6; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; font-size:13px; font-weight:800; letter-spacing:.06em; padding:8px 13px; border-radius:8px; border:1px solid; pointer-events:auto; }
  .gx-regime.neg { color:#ef4444; border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.10); box-shadow: 0 0 18px rgba(239,68,68,.25) inset; }
  .gx-regime.pos { color:#10b981; border-color: rgba(16,185,129,.5); background: rgba(16,185,129,.10); box-shadow: 0 0 18px rgba(16,185,129,.25) inset; }
  .gx-regime i { width:9px; height:9px; border-radius:50%; background: currentColor; box-shadow: 0 0 10px currentColor; }

  /* chart as a full-bleed UNDERLAY — inset ~1in (96px) from the card edge,
     sits behind all the text/pills (low z-index). */
  .gx-imgwrap { position:absolute; inset:96px; z-index:1; border:1px solid var(--sm-border); border-radius:16px;
    background:#06080e; overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  /* auto-crop the chart's top toolbar: render the image taller than the box and
     pin it to the bottom so the top ~10% (toolbar row) is clipped by overflow. */
  .gx-imgwrap > img { width:100%; height:112%; object-fit:fill; object-position:center bottom;
    position:absolute; bottom:0; left:0; display:block; }
  .gx-drop { position:absolute; inset:10px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px;
    border:2px dashed rgba(255,255,255,.18); border-radius:12px; color:#9aa4b2; font-size:16px; text-align:center; transition:.15s; }
  .gx-imgwrap:hover .gx-drop { border-color: var(--cyan); color:#fff; background: rgba(0,240,255,.03); }
  .gx-drop .big { font-size:20px; font-weight:800; color:#fff; }
  .gx-ocr { position:absolute; left:14px; bottom:14px; z-index:3; display:inline-flex; align-items:center; gap:8px;
    font-size:12px; font-weight:700; letter-spacing:.03em; padding:7px 12px; border-radius:7px; border:1px solid rgba(255,255,255,.18);
    background: rgba(5,6,10,.85); color:#9aa4b2; }
  .gx-ocr.busy { color: var(--cyan); border-color: rgba(0,240,255,.4); }
  .gx-ocr.ok { color:#10b981; border-color: rgba(16,185,129,.4); }
  .gx-ocr.warn { color: var(--amber); border-color: rgba(249,115,22,.4); }
  .gx-ocr button { font:inherit; font-size:11px; cursor:pointer; background:transparent; color: var(--cyan); border:none; text-decoration:underline; padding:0; margin-left:6px; }
  .gx-spin { width:11px; height:11px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation: gxspin .7s linear infinite; }
  @keyframes gxspin { to { transform: rotate(360deg); } }

  .gx-strip { position:absolute; left:0; right:0; bottom:58px; z-index:4; display:flex; align-items:stretch; gap:14px; padding: 0 30px; }
  .gx-pill { flex:1; display:flex; flex-direction:column; gap:8px; justify-content:center; padding:14px 18px;
    border:1px solid var(--sm-border); border-radius:12px;
    background: rgba(5,7,12,.82); backdrop-filter: blur(3px); }
  .gx-pill .k { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9aa4b2; font-weight:800; }
  .gx-pill .v { display:flex; align-items:baseline; gap:6px; font-size:30px; font-weight:900; letter-spacing:.01em; line-height:1; }
  .gx-pill .v b { font-weight:900; outline:none; }
  .gx-pill .v small { font-size:14px; font-weight:800; color:#9aa4b2; }
  .gx-pill .v b.cyan { color:#00f0ff; text-shadow:0 0 18px rgba(0,240,255,.35); }
  .gx-pill .v b.amber { color:#f97316; text-shadow:0 0 16px rgba(249,115,22,.30); }
  .gx-pill .v b.red { color:#ef4444; text-shadow:0 0 16px rgba(239,68,68,.30); }
  .gx-pill .v b.green { color:#10b981; text-shadow:0 0 16px rgba(16,185,129,.30); }
  .gx-pill.core { flex: 2.4; }
  .gx-pill.core .cv { font-size:16px; font-weight:600; line-height:1.4; color:#d7dee8; outline:none; }

  .gx-foot { position:absolute; left:0; right:0; bottom:0; z-index:4; display:flex; align-items:center; gap:14px; padding: 10px 34px 20px; pointer-events:none; }
  .gx-foot .brand { font-size:16px; font-weight:900; letter-spacing:.06em;
    background: linear-gradient(180deg,#e8eef5,#9aa6b5); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .gx-foot .tag { font-size:12px; font-style:italic; color:#9aa4b2; }
  .gx-foot .disc { margin-left:auto; font-size:11px; color:#6b7686; letter-spacing:.04em; }
`;

/* ════════════════════════════════════════════════════════════════════════════
 * GEX Image Cards — branded 1600×900 social cards built around a screenshot of
 * the live NET GEX chart and the GEX heatmap. The levels strip is filled from
 * dashboard state (the Daily Input form); a dropped capture is just the visual
 * backdrop. Every field stays click-to-edit. Heavy/hype styling, real CB Edge
 * chrome logo centered up top, fixed footer (no overlap). Exports each card to
 * PNG via html2canvas at 2×.
 * ════════════════════════════════════════════════════════════════════════════ */

type CardKind = "chart" | "heat";
interface CardFields { a: string; b: string; bSmall: string; c: string; cSmall: string; d: string; }

const CHART_DEFAULTS: CardFields = { a: "7,346.55", b: "7,330", bSmall: "", c: "−$1.0B", cSmall: "peak", d: "7,250–7,450" };
const HEAT_DEFAULTS: CardFields = { a: "7,345", b: "−$1.26B", bSmall: "7,330", c: "+ below 7,330", cSmall: "", d: "Neg thru body" };

const CHART_LABELS = { a: "SPX SPOT", b: "MVC", c: "NET GEX", d: "RANGE" };
const HEAT_LABELS = { a: "ATM STRIKE", b: "LARGEST NEG GEX", c: "NET VEX FLIP", d: "DEX" };

// Seed card fields from the live Daily-Input form so the card is correct WITHOUT
// any OCR. OCR (on image drop) still overrides these. Falls back to the static
// demo defaults for any field the form doesn't provide.
function fieldsFromForm(kind: CardKind, form: FormState): CardFields {
  const base = kind === "chart" ? CHART_DEFAULTS : HEAT_DEFAULTS;
  const band = emBand(form);
  const range = band ? `${fmt(band.lower, 0)}–${fmt(band.upper, 0)}` : base.d;
  const spotStr = form.spot ? fmt(toNum(form.spot)) : base.a;
  const putStr = form.put ? fmt(toNum(form.put)) : "";
  const gexStr = form.gex || base.c;
  if (kind === "chart") {
    return { a: spotStr, b: putStr || base.b, bSmall: "", c: gexStr, cSmall: "peak", d: range };
  }
  return {
    a: spotStr, b: gexStr, bSmall: putStr || base.bSmall,
    c: putStr ? `+ below ${putStr}` : base.c, cSmall: "", d: base.d,
  };
}

function GexCard({
  kind, updated, today, regimeNeg, form, coreBehavior,
}: { kind: CardKind; updated: string; today: string; regimeNeg: boolean; form: FormState; coreBehavior: string }) {
  const [img, setImg] = useState<string | null>(null);
  const [fields, setFields] = useState<CardFields>(() => fieldsFromForm(kind, form));
  // Re-seed from form until the user has dropped an image / edited a field.
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!touchedRef.current) setFields(fieldsFromForm(kind, form));
  }, [kind, form]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<"" | "copied" | "saved" | "err">("");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashShareReset = useCallback(() => {
    if (shareTimer.current) clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(() => setShare(""), 1600);
  }, []);
  const labels = kind === "chart" ? CHART_LABELS : HEAT_LABELS;

  const setField = (k: keyof CardFields, v: string) => { touchedRef.current = true; setFields((f) => ({ ...f, [k]: v })); };

  // Render the card node to a 1600×900 PNG blob (transform reset so capture is
  // always at true pixels). Shared by Download / Copy / Share-to-X.
  const renderBlob = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current; if (!node) return null;
    const prev = node.style.transform; node.style.transform = "none";
    const html2canvas = await getHtml2Canvas();
    const canvas = await html2canvas(node, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false, width: 1600, height: 900 });
    node.style.transform = prev;
    return await new Promise((r) => canvas.toBlob((b: Blob | null) => r(b), "image/png"));
  }, []);

  // Levels come from dashboard state (the form). The dropped image is just a
  // visual backdrop for the card — no OCR.
  const loadFile = useCallback((file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = (e) => setImg(String(e.target?.result || ""));
    rd.readAsDataURL(file);
  }, []);

  const onExport = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderBlob();
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `cb-edge-${kind === "chart" ? "netgex" : "heatmap"}-${todayETStr()}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } finally { setBusy(false); }
  }, [kind, renderBlob]);

  // Copy the card PNG to the clipboard; falls back to a download when the
  // browser blocks image writes. Mirrors the Daily-Levels share logic.
  const onCopy = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderBlob();
      if (!blob) { setShare("err"); return; }
      try {
        const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (ClipItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
          setShare("copied");
          return;
        }
      } catch { /* fall through to download */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cb-edge-${kind === "chart" ? "netgex" : "heatmap"}-${todayETStr()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setShare("saved");
    } finally { setBusy(false); flashShareReset(); }
  }, [kind, renderBlob]);

  // Copy the image, then open the X composer with a prefilled caption (X's intent
  // API can't pre-attach the image, so the user pastes the copied card).
  const onShareX = useCallback(async () => {
    await onCopy();
    const text = `Todays $SPX Levels\nprovided by https://www.cbedge.net/`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }, [onCopy]);

  const onPick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => { if (inp.files?.[0]) loadFile(inp.files[0]); };
    inp.click();
  };

  return (
    <div className="gx-cardwrap">
      <div className="gx-caplabel">{kind === "chart" ? "NET GEX chart" : "GEX heatmap"} · 1600 × 900</div>
      <div ref={cardRef} className={`gx-card ${regimeNeg ? "neg" : "pos"}`}>
        {/* hype glow corners */}
        <span className="gx-glow tl" /><span className="gx-glow br" />

        {/* header: date left · centered chrome logo · regime right */}
        <div className="gx-head">
          <div className="gx-head-side left">
            <div className="gx-date">{today}</div>
            <div className="gx-time">{updated || "15:33 ET"}</div>
          </div>
          <div className="gx-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cb-edge-logo.png" alt="CB Edge" crossOrigin="anonymous" />
          </div>
          <div className="gx-head-side right" />
        </div>
        <span className={`gx-regime ${regimeNeg ? "neg" : "pos"}`}><i />{regimeNeg ? "NEGATIVE GAMMA" : "POSITIVE GAMMA"}</span>

        {/* image slot */}
        <div className="gx-imgwrap" onClick={img ? undefined : onPick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) loadFile(e.dataTransfer.files[0]); }}>
          {img
            ? <img src={img} alt="capture" crossOrigin="anonymous" />
            : <div className="gx-drop"><div className="big">Drop {kind === "chart" ? "NET GEX chart" : "GEX heatmap"} image</div><div>optional — levels come from the dashboard</div></div>}
        </div>

        {/* levels strip — main value is editable; the small sub-label is a
            separate non-editable span so editing can't absorb/duplicate it. */}
        <div className="gx-strip">
          <div className="gx-pill"><span className="k">{labels.a}</span><span className="v"><b className="cyan" contentEditable suppressContentEditableWarning onBlur={(e) => setField("a", e.currentTarget.textContent || "")}>{fields.a}</b></span></div>
          <div className="gx-pill"><span className="k">{labels.b}</span><span className="v"><b className="amber" contentEditable suppressContentEditableWarning onBlur={(e) => setField("b", e.currentTarget.textContent || "")}>{fields.b}</b>{fields.bSmall && <small>{fields.bSmall}</small>}</span></div>
          <div className="gx-pill"><span className="k">{labels.c}</span><span className="v"><b className="red" contentEditable suppressContentEditableWarning onBlur={(e) => setField("c", e.currentTarget.textContent || "")}>{fields.c}</b>{fields.cSmall && <small>{fields.cSmall}</small>}</span></div>
          <div className="gx-pill core"><span className="k">CORE BEHAVIOR</span><span className="cv">{coreBehavior}</span></div>
        </div>

        {/* footer (in-flow — cannot overlap the strip) */}
        <div className="gx-foot">
          <span className="brand">CB EDGE</span>
          <span className="tag">“Real Edge — Real Orderflow”</span>
          <span className="disc">Informational only — not financial advice.</span>
        </div>
      </div>
      <div className="gx-actions">
        <button type="button" className="gx-btn copy" onClick={onCopy} disabled={busy}>
          {share === "copied" ? "✓ Copied" : share === "saved" ? "✓ Saved" : share === "err" ? "Failed" : "Copy card"}
        </button>
        <button type="button" className="gx-btn x" onClick={onShareX} disabled={busy}>Copy &amp; Open X</button>
        <button type="button" className="gx-dl" onClick={onExport} disabled={busy}>{busy ? "Rendering…" : "Download (PNG)"}</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Explainer Mockup — the annotated "trader read" layout: a 0DTE NET GEX ladder
 * on the left, a level chart in the middle (call wall / resistance-flip / put
 * wall lines, shaded EM range band, spot dot) and a trigger map (Bull / Base /
 * Bear) on the right. Everything is filled live from the Daily-Input `form`.
 * Exports to PNG via html2canvas. Scoped under .xp-wrap so styles don't leak.
 * ════════════════════════════════════════════════════════════════════════════ */
const XP_CSS = `
  .xp-wrap { max-width: 1180px; margin: 0 auto; padding-bottom: 48px; }
  /* Every bit of text in the Explainer is white (no gray). */
  .xp-wrap, .xp-wrap * { color: #ffffff; }
  .xp-actions { display:flex; gap:10px; align-items:center; margin-bottom:14px; }
  .xp-actions-sp { flex:1; }
  .xp-dte { display:inline-flex; gap:3px; padding:3px; background:var(--bg2); border:1px solid var(--sm-border); border-radius:7px; }
  .xp-dte button { font-family:var(--sm-mono); font-size:11px; font-weight:700; letter-spacing:.04em; cursor:pointer; padding:6px 13px; border-radius:5px; border:1px solid transparent; background:transparent; color:var(--sm-muted); transition:.12s; }
  .xp-dte button:hover { color:var(--text1); }
  .xp-dte button.on { background:var(--cyan); color:#05060a; border-color:var(--cyan); box-shadow:0 0 12px rgba(0,240,255,.35); }
  .xp-candle-btn { display:inline-flex; align-items:center; gap:7px; font-family:var(--sm-mono); font-size:11px; font-weight:700; letter-spacing:.04em; cursor:pointer; padding:7px 13px; border-radius:6px; border:1px solid var(--sm-border); background:var(--bg3); color:var(--text1); transition:.12s; }
  .xp-candle-btn:hover { border-color:var(--cyan); }
  .xp-candle-btn.on { border-color:var(--sm-green); color:var(--sm-green); }
  .xp-candle-btn i { width:8px; height:8px; border-radius:50%; display:inline-block; }
  .xp-candle-btn i.off { background:var(--sm-muted); opacity:.5; }
  .xp-candle-btn i.wait { background:var(--amber); box-shadow:0 0 8px var(--amber); }
  .xp-candle-btn i.live { background:var(--sm-green); box-shadow:0 0 8px var(--sm-green); }
  .xp-btn { font-family: var(--sm-mono); font-size:12px; font-weight:700; letter-spacing:.04em; cursor:pointer; padding:9px 14px; border-radius:6px; border:1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition:.12s; }
  .xp-btn:hover { background: var(--bg4); border-color: var(--cyan); }
  .xp-btn.x { background: var(--cyan); color:#05060a; border-color: var(--cyan); }
  .xp-btn:disabled { opacity:.5; cursor:default; }

  .xp-card { background:
      radial-gradient(700px 320px at 14% -6%, rgba(0,240,255,.07), transparent 60%),
      radial-gradient(640px 340px at 94% 110%, rgba(249,115,22,.06), transparent 60%),
      var(--bg1);
    border:1px solid var(--sm-border); border-radius:16px; padding:26px 28px; }
  .xp-head { display:flex; align-items:baseline; gap:14px; border-bottom:1px solid var(--sm-border); padding-bottom:16px; margin-bottom:18px; }
  .xp-head .ttl { font-size:24px; font-weight:800; color:var(--text1); letter-spacing:.01em; }
  .xp-head .sub { font-size:12px; font-weight:700; letter-spacing:.18em; color:var(--sm-muted); }
  .xp-head .upd { margin-left:auto; font-size:12px; color:var(--sm-muted); }
  .xp-watch { font-size:13px; color:var(--text1); line-height:1.5; margin-bottom:18px; max-width:760px; }
  .xp-watch b { color:var(--cyan); }

  /* top metric strip */
  .xp-strip { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:22px; }
  .xp-stat { background:var(--bg0); border:1px solid var(--sm-border); border-radius:10px; padding:12px 14px; text-align:center; }
  .xp-stat .k { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--sm-muted); margin-bottom:7px; }
  .xp-stat .v { font-size:21px; font-weight:800; color:var(--text1); line-height:1; }
  .xp-stat .v.cyan { color:var(--cyan); } .xp-stat .v.amber { color:var(--amber); }

  .xp-main { display:grid; grid-template-columns:200px 1fr 250px; gap:20px; align-items:stretch; }
  @media (max-width: 900px){ .xp-main { grid-template-columns:1fr; } }

  /* GEX ladder */
  .xp-ladder-h { font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sm-muted); margin-bottom:10px; }
  .xp-ladder-row { display:grid; grid-template-columns:42px 1fr 56px; align-items:center; gap:8px; height:18px; font-family:var(--sm-mono); font-size:11px; }
  .xp-ladder-row .strk { color:var(--text1); }
  .xp-ladder-row.spot { background:rgba(0,240,255,.12); border-radius:4px; }
  .xp-ladder-row.peak .bar i { box-shadow:0 0 8px var(--amber); }
  .xp-ladder-row .bar { height:9px; position:relative; }
  .xp-ladder-row .bar i { position:absolute; top:0; height:9px; border-radius:2px; display:block; }
  .xp-ladder-row .bar i.pos { background:var(--sm-green); left:50%; }
  .xp-ladder-row .bar i.neg { background:var(--sm-red); right:50%; }
  .xp-ladder-row .gx { text-align:right; }
  .xp-ladder-row .gx.pos { color:var(--sm-green); } .xp-ladder-row .gx.neg { color:var(--sm-red); }
  .xp-ladder-mid { border-top:1px dashed var(--sm-border); margin:5px 0; }

  /* level chart — fixed height so it always fits its box; content clipped to the
     rounded border. */
  .xp-chart { position:relative; box-sizing:border-box; border:1px solid var(--sm-border); border-radius:12px; background:var(--bg0); height:380px; padding:22px 0; overflow:hidden; }
  .xp-candles { position:absolute; inset:0; width:100%; height:100%; z-index:0; opacity:.7; border-radius:12px; }
  .xp-candles .up .wick, .xp-candles .up .body { fill:var(--sm-green); }
  .xp-candles .dn .wick, .xp-candles .dn .body { fill:var(--sm-red); }
  .xp-candles rect { stroke:none; }
  /* level lines / band / spot sit ABOVE the candle underlay */
  .xp-chart .xp-line, .xp-chart .xp-band, .xp-chart .xp-spot { z-index:2; }
  .xp-line { position:absolute; left:0; right:0; height:0; display:flex; align-items:center; }
  .xp-line .rule { flex:1; height:0; border-top:2px solid; }
  .xp-line.flip .rule { border-top-style:dotted; }
  .xp-line .tag { position:absolute; right:12px; top:-9px; font-size:11px; font-weight:800; letter-spacing:.02em; background:var(--bg0); padding:0 6px; }
  .xp-line .px { position:absolute; left:10px; top:-9px; font-family:var(--sm-mono); font-size:11px; font-weight:700; background:var(--bg0); padding:0 4px; }
  .xp-band { position:absolute; left:0; right:0; background:rgba(124,124,255,.10); border-top:1px dashed rgba(124,124,255,.4); border-bottom:1px dashed rgba(124,124,255,.4); }
  .xp-spot { position:absolute; right:46px; width:11px; height:11px; border-radius:50%; background:var(--cyan); box-shadow:0 0 0 4px rgba(0,240,255,.2),0 0 12px var(--cyan); transform:translateY(-50%); }
  .c-red { color:var(--sm-red); border-color:var(--sm-red)!important; }
  .c-green { color:var(--sm-green); border-color:var(--sm-green)!important; }
  .c-amber { color:var(--amber); border-color:var(--amber)!important; }

  /* trigger map */
  .xp-trig-h { font-size:11px; font-weight:700; letter-spacing:.1em; color:var(--sm-muted); margin-bottom:10px; }
  .xp-case { border:1px solid var(--sm-border); border-radius:10px; padding:12px 13px; margin-bottom:10px; }
  .xp-case .top { display:flex; align-items:center; gap:7px; margin-bottom:7px; }
  .xp-case .nm { font-size:12px; font-weight:800; letter-spacing:.06em; }
  .xp-case .pct { margin-left:auto; font-size:14px; font-weight:800; color:var(--text1); }
  .xp-case .desc { font-size:11px; color:var(--text1); line-height:1.45; }
  .xp-case.bull { border-color:rgba(16,185,129,.4);} .xp-case.bull .nm { color:var(--sm-green);}
  .xp-case.base .nm { color:var(--sm-muted);}
  .xp-case.bear { border-color:rgba(239,68,68,.4);} .xp-case.bear .nm { color:var(--sm-red);}
  .xp-foot { display:flex; align-items:center; gap:12px; border-top:1px solid var(--sm-border); margin-top:20px; padding-top:14px; }
  .xp-foot .brand { font-size:16px; font-weight:800; color:var(--text1); letter-spacing:.03em; }
  .xp-foot .disc { margin-left:auto; font-size:10px; color:var(--sm-muted); letter-spacing:.05em; }
`;

interface SpxCandle { t: number; o: number; h: number; l: number; c: number }

function ExplainerMockup({
  form, regime, updated, ladder, dte, onDteChange,
  candles, candlesOn, candlesConnected, onToggleCandles,
}: {
  form: FormState; regime: Regime; updated: string; ladder: GexLadderRow[];
  dte: 0 | 1; onDteChange: (d: 0 | 1) => void;
  candles: SpxCandle[]; candlesOn: boolean; candlesConnected: boolean; onToggleCandles: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<"" | "copied" | "saved" | "err">("");
  const [shot, setShot] = useState<"" | "copied" | "saved" | "err">("");

  const spot = toNum(form.spot);
  const flip = toNum(form.flip);
  const call = toNum(form.call);
  const put = toNum(form.put);
  const band = emBand(form);

  // y-axis scale spanning all levels (+ a small pad) → percent positions. When
  // the candle overlay is on, include candle highs/lows so the bars fit the axis.
  const all = [call, flip, put, spot, band?.upper, band?.lower].filter(
    (v): v is number => Number.isFinite(v as number),
  );
  if (candlesOn && candles.length) {
    for (const c of candles) { all.push(c.h, c.l); }
  }
  const hi = all.length ? Math.max(...all) : 1;
  const lo = all.length ? Math.min(...all) : 0;
  const pad = (hi - lo) * 0.12 || 1;
  const top = hi + pad;
  const bot = lo - pad;
  const yPct = (v: number) => ((top - v) / (top - bot)) * 100; // 0..100, numeric
  const yOf = (v: number) => `${yPct(v).toFixed(2)}%`;

  // Candle geometry in a 0..100 × 0..100 viewBox (SVG scales to the chart box).
  // x spreads evenly across the session; a green/red body + high-low wick each.
  const candleGeo = useMemo(() => {
    if (!candlesOn || !candles.length) return [];
    const n = candles.length;
    const slot = 100 / n;
    const bodyW = Math.max(0.6, Math.min(slot * 0.7, 3.2));
    return candles.map((c, i) => {
      const cx = slot * (i + 0.5);
      const up = c.c >= c.o;
      const yHigh = yPct(c.h);
      const yLow = yPct(c.l);
      const yOpen = yPct(c.o);
      const yClose = yPct(c.c);
      const bodyTop = Math.min(yOpen, yClose);
      const bodyBot = Math.max(yOpen, yClose);
      const wickW = Math.max(0.18, bodyW * 0.16);
      return { cx, bodyW, wickW, yHigh, yLow, bodyTop, bodyH: Math.max(0.4, bodyBot - bodyTop), up };
    });
  }, [candlesOn, candles, top, bot]);

  // GEX ladder rows. Prefer the LIVE per-strike ladder from the dashboard
  // (netGex in $millions, already windowed ±8 around ATM, high→low). Fall back to
  // a visual taper centered on spot only when live data hasn't loaded yet.
  const ladderRows = useMemo<{ k: number; gx: number }[]>(() => {
    if (ladder && ladder.length) {
      return ladder.map((r) => ({ k: Math.round(r.strike), gx: r.netGex }));
    }
    const center = Math.round(Number.isFinite(spot) ? spot : 740);
    const rows: { k: number; gx: number }[] = [];
    for (let i = 4; i >= -4; i--) {
      const k = center + i;
      const dist = Math.abs(i);
      const mag = Math.max(8, 280 - dist * 55 - (dist > 1 ? dist * 20 : 0));
      rows.push({ k, gx: (k >= center ? 1 : -1) * mag });
    }
    return rows;
  }, [ladder, spot]);
  const isLiveLadder = !!(ladder && ladder.length);
  const maxMag = Math.max(...ladderRows.map((r) => Math.abs(r.gx)), 1);
  // The "spot row" to highlight = the ladder strike nearest live spot.
  const centerK = useMemo(() => {
    if (!ladderRows.length) return Math.round(Number.isFinite(spot) ? spot : 740);
    if (!Number.isFinite(spot)) return ladderRows[Math.floor(ladderRows.length / 2)].k;
    return ladderRows.reduce((best, r) => (Math.abs(r.k - spot) < Math.abs(best - spot) ? r.k : best), ladderRows[0].k);
  }, [ladderRows, spot]);

  const renderBlob = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current; if (!node) return null;
    const html2canvas = await getHtml2Canvas();
    const canvas = await html2canvas(node, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false });
    return await new Promise((r) => canvas.toBlob((b: Blob | null) => r(b), "image/png"));
  }, []);
  const onDownload = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderBlob(); if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cb-edge-explainer-${todayETStr()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally { setBusy(false); }
  }, [renderBlob]);
  const onCopy = useCallback(async () => {
    setBusy(true);
    try {
      const blob = await renderBlob(); if (!blob) { setShare("err"); return; }
      try {
        const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (ClipItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
          setShare("copied"); return;
        }
      } catch { /* fall through */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cb-edge-explainer-${todayETStr()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setShare("saved");
    } finally { setBusy(false); setTimeout(() => setShare(""), 1600); }
  }, [renderBlob]);

  // Full-tab screenshot: capture the whole Explainer wrap (toggle + card +
  // everything) to a PNG and write it to the clipboard. The action bar itself is
  // hidden during capture so the buttons don't appear in the screenshot; falls
  // back to a download when the browser blocks clipboard image writes.
  const onCopyScreenshot = useCallback(async () => {
    const node = wrapRef.current; if (!node) { setShot("err"); return; }
    setBusy(true);
    const actions = actionsRef.current;
    const prevDisplay = actions?.style.display ?? "";
    if (actions) actions.style.display = "none";
    try {
      const html2canvas = await getHtml2Canvas();
      const canvas = await html2canvas(node, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false });
      const blob: Blob | null = await new Promise((r) => canvas.toBlob((b: Blob | null) => r(b), "image/png"));
      if (!blob) { setShot("err"); return; }
      try {
        const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (ClipItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
          setShot("copied"); return;
        }
      } catch { /* fall through to download */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cb-edge-explainer-screenshot-${todayETStr()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setShot("saved");
    } catch {
      setShot("err");
    } finally {
      if (actions) actions.style.display = prevDisplay;
      setBusy(false);
      setTimeout(() => setShot(""), 1600);
    }
  }, []);

  const f = (v: number) => (Number.isFinite(v) ? fmt(v) : "—");

  return (
    <div className="xp-wrap" ref={wrapRef}>
      <style>{XP_CSS}</style>
      <div className="xp-actions" ref={actionsRef}>
        <span className="xp-dte" role="group" aria-label="DTE">
          <button type="button" className={dte === 0 ? "on" : ""} onClick={() => onDteChange(0)}>0DTE</button>
          <button type="button" className={dte === 1 ? "on" : ""} onClick={() => onDteChange(1)}>1DTE</button>
        </span>
        <button
          type="button"
          className={`xp-candle-btn${candlesOn ? " on" : ""}`}
          onClick={onToggleCandles}
          title="Connect the ES feed and overlay today's candles converted to SPX prices"
        >
          <i className={candlesOn ? (candlesConnected ? "live" : "wait") : "off"} />
          {candlesOn ? (candlesConnected ? "Candles · live" : "Candles · connecting…") : "Candles · off"}
        </button>
        <span className="xp-actions-sp" />
        <button type="button" className="xp-btn" onClick={onCopyScreenshot} disabled={busy}>
          {shot === "copied" ? "✓ Copied" : shot === "saved" ? "✓ Saved" : shot === "err" ? "Failed" : "Copy screenshot"}
        </button>
        <button type="button" className="xp-btn" onClick={onCopy} disabled={busy}>
          {share === "copied" ? "✓ Copied" : share === "saved" ? "✓ Saved" : share === "err" ? "Failed" : "Copy image"}
        </button>
        <button type="button" className="xp-btn x" onClick={onDownload} disabled={busy}>{busy ? "Rendering…" : "Download (PNG)"}</button>
      </div>

      <div ref={cardRef} className="xp-card">
        <div className="xp-head">
          <span className="ttl">Environment: {regime.neg ? "trend regime" : "decision point"}</span>
          <span className="sub">SPX · {dte === 1 ? "1DTE" : "0DTE"} GEX READ</span>
          <span className="upd">{updated ? `Updated ${updated}` : ""}</span>
        </div>
        <div className="xp-watch">
          <b>Watch:</b> {regime.neg ? "momentum and breakout continuation — trade with the trend." : "acceptance before the regime resolves — let price confirm a break before pressing."} {regime.sub}
        </div>

        {/* metric strip */}
        <div className="xp-strip">
          <div className="xp-stat"><div className="k">spot</div><div className="v cyan">{f(spot)}</div></div>
          <div className="xp-stat"><div className="k">gamma flip</div><div className="v">{f(flip)}</div></div>
          <div className="xp-stat"><div className="k">net gex</div><div className="v amber">{form.gex || "—"}</div></div>
          <div className="xp-stat"><div className="k">call wall</div><div className="v">{f(call)}</div></div>
          <div className="xp-stat"><div className="k">put wall</div><div className="v">{f(put)}</div></div>
        </div>

        <div className="xp-main">
          {/* GEX ladder */}
          <div>
            <div className="xp-ladder-h">{dte === 1 ? "1DTE" : "0DTE"} NET GEX{isLiveLadder ? "" : " · est"}</div>
            {ladderRows.map((r) => {
              const w = (Math.abs(r.gx) / maxMag) * 46;
              const isSpot = r.k === centerK;
              const isPeak = Math.abs(r.gx) === maxMag;
              const mag = Math.abs(r.gx);
              const magStr = mag >= 100 ? mag.toFixed(0) : mag >= 10 ? mag.toFixed(0) : mag.toFixed(1);
              return (
                <div key={r.k} className={`xp-ladder-row${isSpot ? " spot" : ""}${isPeak ? " peak" : ""}`}>
                  <span className="strk">{r.k}</span>
                  <span className="bar"><i className={r.gx >= 0 ? "pos" : "neg"} style={{ width: `${w}%` }} /></span>
                  <span className={`gx ${r.gx >= 0 ? "pos" : "neg"}`}>{r.gx >= 0 ? "+" : "−"}{magStr}M</span>
                </div>
              );
            })}
          </div>

          {/* level chart */}
          <div className="xp-chart">
            {/* ES→SPX candle underlay (on-demand). Drawn behind the level lines/
                band so the GEX levels stay readable on top. */}
            {candlesOn && candleGeo.length > 0 && (
              <svg className="xp-candles" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {candleGeo.map((g, i) => (
                  <g key={i} className={g.up ? "up" : "dn"}>
                    <rect x={g.cx - g.wickW / 2} y={g.yHigh} width={g.wickW} height={Math.max(0.2, g.yLow - g.yHigh)} className="wick" />
                    <rect x={g.cx - g.bodyW / 2} y={g.bodyTop} width={g.bodyW} height={g.bodyH} className="body" />
                  </g>
                ))}
              </svg>
            )}
            {band && (
              <div className="xp-band" style={{ top: yOf(band.upper), height: `calc(${yOf(band.lower)} - ${yOf(band.upper)})` }} />
            )}
            {Number.isFinite(call) && (
              <div className="xp-line" style={{ top: yOf(call) }}>
                <span className="rule c-red" /><span className="px c-red">{f(call)}</span><span className="tag c-red">CALL WALL · resistance</span>
              </div>
            )}
            {Number.isFinite(flip) && (
              <div className="xp-line flip" style={{ top: yOf(flip) }}>
                <span className="rule c-amber" /><span className="px c-amber">{f(flip)}</span><span className="tag c-amber">GAMMA FLIP · {regime.neg ? "below = unstable" : "structure shifts"}</span>
              </div>
            )}
            {Number.isFinite(put) && (
              <div className="xp-line" style={{ top: yOf(put) }}>
                <span className="rule c-green" /><span className="px c-green">{f(put)}</span><span className="tag c-green">PUT WALL · support</span>
              </div>
            )}
            {Number.isFinite(spot) && <div className="xp-spot" style={{ top: yOf(spot) }} />}
          </div>

          {/* trigger map */}
          <div>
            <div className="xp-trig-h">TRIGGER MAP · how to trade it</div>
            <div className="xp-case bull">
              <div className="top"><span className="nm">▲ BULL CASE</span><span className="pct">{regime.neg ? "35%" : "30%"}</span></div>
              <div className="desc">Spot accepts above {f(Number.isFinite(flip) ? flip : call)} on volume and holds through first retest → long toward {f(call)}.</div>
            </div>
            <div className="xp-case base">
              <div className="top"><span className="nm">→ BASE CASE</span><span className="pct">{regime.neg ? "30%" : "40%"}</span></div>
              <div className="desc">{regime.neg ? "Two-sided trend day — wait for a clean break of the flip before committing size." : `Range between ${f(put)} and ${f(call)} persists into midday with no decisive break — stay patient.`}</div>
            </div>
            <div className="xp-case bear">
              <div className="top"><span className="nm">▼ BEAR CASE</span><span className="pct">{regime.neg ? "35%" : "30%"}</span></div>
              <div className="desc">Loses {f(Number.isFinite(flip) ? flip : put)} and holds below on two consecutive 5-min closes → short toward {f(put)}.</div>
            </div>
          </div>
        </div>

        <div className="xp-foot">
          <span className="brand">CB Edge</span>
          <span className="disc">SETUP IS A REGIME MATCH, NOT PROBABILITY OR ADVICE — INFORMATIONAL ONLY.</span>
        </div>
      </div>
    </div>
  );
}

function GexImageCards({ updated, today, form }: { updated: string; today: string; form: FormState }) {
  const reg = regimeOf(form);
  const neg = reg.neg;
  const stageRef = useRef<HTMLDivElement>(null);
  // Scale cards down to fit the column on screen; export resets transform to none
  // so PNGs are always captured at true 1600×900.
  useEffect(() => {
    const fit = () => {
      const stage = stageRef.current; if (!stage) return;
      const avail = Math.min(stage.clientWidth, 1600);
      const s = Math.min(1, avail / 1600);
      stage.querySelectorAll<HTMLDivElement>(".gx-card").forEach((c) => {
        c.style.transform = s < 1 ? `scale(${s})` : "none";
        c.style.marginBottom = s < 1 ? `${-900 * (1 - s)}px` : "0";
      });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div className="gx-wrap">
      <style>{GX_CSS}</style>
      <p className="gx-help">
        The level strip is filled <b>live from the dashboard</b> (Daily Input) — spot, MVC, net GEX and range. Drop a NET GEX chart / heatmap
        screenshot into a card only for the <b>visual</b> (optional). Every value is click-to-edit. Then <b>Download</b> for a clean 1600×900 image.
      </p>
      <div className="gx-stage" ref={stageRef}>
        <GexCard kind="chart" updated={updated} today={today} regimeNeg={neg} form={form} coreBehavior={reg.coreBehavior} />
        <GexCard kind="heat" updated={updated} today={today} regimeNeg={neg} form={form} coreBehavior={reg.coreBehavior} />
      </div>
    </div>
  );
}

export default function SocialMediaPage() {
  const [tab, setTab] = useState<"levels" | "cards" | "explainer">("levels");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Live per-strike GEX ladder (netGex in $millions) for the Explainer tab.
  // Kept out of FormState (which is string-only) and refreshed alongside it.
  const [gexLadder, setGexLadder] = useState<GexLadderRow[]>([]);
  // DTE bucket for the Explainer GEX read: 0 = front/0DTE, 1 = next expiration.
  const [dte, setDte] = useState<0 | 1>(0);
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Share-card capture target + transient button status ("" | "copied" | "opened" | "saved" | "error").
  const cardRef = useRef<HTMLDivElement>(null);
  const [shareState, setShareState] = useState<"" | "copied" | "opened" | "saved" | "error">("");
  const [discordState, setDiscordState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const discordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (shareTimer.current) clearTimeout(shareTimer.current);
    if (discordTimer.current) clearTimeout(discordTimer.current);
  }, []);
  // Once the user edits a field we stop overwriting it on the next hydrate poll.
  const dirtyRef = useRef(false);

  // ES candle connection is ON DEMAND for the Explainer overlay. Off by default
  // so the page opens no /ws/gex socket until the user turns candles on; the
  // overnight H/L then falls back to the daily-input API value. Turning it on
  // connects live and also feeds the SPX-converted candle overlay.
  const [candlesOn, setCandlesOn] = useState(false);

  // ES overnight H/L sourced exactly like the Fails page: live + historical 5m ES
  // candles → computeRefLevels → onHigh/onLow (prior 18:00 ET → 09:30 ET globex).
  // Raw ESU futures points, same unit the Fails page and the daily-input API use.
  const { candles: liveCandles, sessionCandles, historical, connected: candlesConnected, refresh: refreshCandles } = useEsCandles(candlesOn);
  const esOvernight = useMemo<{ high: number | null; low: number | null }>(() => {
    const map = new Map<string, (typeof liveCandles)[number]>();
    for (const c of historical) map.set(c.slotKey, c as (typeof liveCandles)[number]);
    for (const c of liveCandles) map.set(c.slotKey, c); // today's live bar wins
    const merged = [...map.values()];
    const esu = merged.filter((c) => (c.symbol ?? "").toUpperCase().includes("ESU"));
    const pool = esu.length ? esu : merged;
    const levels = computeRefLevels(pool, todayETStr());
    const onHigh = levels.find((l) => l.kind === "onHigh")?.price ?? null;
    const onLow = levels.find((l) => l.kind === "onLow")?.price ?? null;
    return { high: onHigh, low: onLow };
  }, [liveCandles, historical]);
  const ovnFromCandles = useMemo(
    () =>
      esOvernight.high != null && esOvernight.low != null
        ? `${fmt(esOvernight.high)} / ${fmt(esOvernight.low)}`
        : "",
    [esOvernight.high, esOvernight.low],
  );
  // Latest candle-derived overnight string, read inside hydrate() without making
  // it a dependency (keeps the API fetch from re-firing on every candle tick).
  const ovnRef = useRef(ovnFromCandles);
  ovnRef.current = ovnFromCandles;

  const today = useMemo(
    () => new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }),
    []
  );

  // SPX-converted candle series for the Explainer overlay. ES candles are raw
  // futures points; SPX price = ES − basis, where basis = (latest ES close) −
  // (live SPX spot from the form). Only today's RTH-onward session is shown so
  // the overlay aligns with the GEX level axis. Empty until candles are on.
  const spxCandles = useMemo<{ t: number; o: number; h: number; l: number; c: number }[]>(() => {
    if (!candlesOn || !sessionCandles?.length) return [];
    const spxSpot = toNum(form.spot);
    const sorted = [...sessionCandles].sort((a, b) => a.timestamp - b.timestamp);
    const lastEs = Number(sorted[sorted.length - 1]?.close ?? 0);
    // basis = esFut − spx; fall back to 0 when spot isn't a usable number.
    const basis = Number.isFinite(spxSpot) && spxSpot > 0 && lastEs > 0 ? lastEs - spxSpot : 0;
    return sorted
      .map((c) => ({
        t: c.timestamp,
        o: Number(c.open) - basis,
        h: Number(c.high) - basis,
        l: Number(c.low) - basis,
        c: Number(c.close) - basis,
      }))
      .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c) && c.h > 0);
  }, [candlesOn, sessionCandles, form.spot]);
  // "Updated Jun 24, 12:04 PM" stamp on the share card. Recomputed on each
  // hydrate/refresh so the card reflects when the data was last pulled.
  const [updatedLabel, setUpdatedLabel] = useState("");
  const stampUpdated = useCallback(() => {
    setUpdatedLabel(
      new Date().toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    );
  }, []);

  const setField = (key: keyof FormState, value: string) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  // Hydrate the Daily Input from live dashboard state. Runs on mount and lets
  // the user freeze it by editing (dirtyRef) — a re-hydrate won't clobber edits.
  const hydrate = useCallback(async () => {
    try {
      const r = await fetch(`/api/social-media/daily-input?dte=${dte}`, { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json();
      const d = (json?.data ?? json) as DailyInput;
      // GEX ladder isn't user-editable — always refresh it from live state.
      if (Array.isArray(d.gexLadder)) setGexLadder(d.gexLadder);
      if (dirtyRef.current) {
        setHydrated(true);
        return;
      }
      const spot = d.spxSpot ?? NaN;
      const flip = d.gammaFlip ?? NaN;
      const netGex = d.netGex ?? NaN;
      // ES overnight comes from the Fails-page candle logic. Fall back to the
      // daily-input API value only if the candle feed hasn't produced one yet.
      const ovn =
        ovnRef.current ||
        (d.esOvernightHigh != null && d.esOvernightLow != null
          ? `${fmt(d.esOvernightHigh)} / ${fmt(d.esOvernightLow)}`
          : "");
      setForm({
        spot: d.spxSpot != null ? fmt(d.spxSpot) : "",
        prevClose: d.spxPrevClose != null ? fmt(d.spxPrevClose) : "",
        flip: d.gammaFlip != null ? fmt(d.gammaFlip) : "",
        call: d.callWall != null ? fmt(d.callWall) : "",
        put: d.putWall != null ? fmt(d.putWall) : "",
        em: d.expectedMove != null ? fmt(d.expectedMove) : "",
        gex: d.netGex != null ? `${d.netGex >= 0 ? "+" : ""}${fmt(d.netGex, 2)}B` : "",
        ovn,
        bias:
          Number.isFinite(netGex) || (Number.isFinite(spot) && Number.isFinite(flip))
            ? deriveBias(netGex, spot, flip)
            : "",
      });
      stampUpdated();
      setHydrated(true);
    } catch {
      setHydrated(true);
    }
  }, [stampUpdated, dte]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Keep the ES Overnight field tracking the live candle feed (Fails-page logic).
  // Updates as new globex bars arrive, but never clobbers a manual edit.
  useEffect(() => {
    if (dirtyRef.current || !ovnFromCandles) return;
    setForm((f) => (f.ovn === ovnFromCandles ? f : { ...f, ovn: ovnFromCandles }));
  }, [ovnFromCandles]);

  const regime = regimeOf(form);

  const flashShare = (s: "copied" | "opened" | "saved" | "error") => {
    setShareState(s);
    if (shareTimer.current) clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(() => setShareState(""), 1600);
  };

  // Render the share card to a PNG blob via html2canvas (already a dependency,
  // used by EstimatedMoves). Captured at 2x for a crisp image on X.
  const renderCardBlob = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current;
    if (!node) return null;
    const html2canvas = await getHtml2Canvas();
    const canvas = await html2canvas(node, {
      backgroundColor: "#05060a",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b: Blob | null) => resolve(b), "image/png")
    );
  }, []);

  // Copy the card image to the clipboard (Chromium/HTTPS). Returns true on
  // success; callers fall back to a download when the image write isn't allowed.
  const copyCardImage = useCallback(async (): Promise<boolean> => {
    try {
      const blob = await renderCardBlob();
      if (!blob) return false;
      const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!ClipItem || !navigator.clipboard?.write) return false;
      await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
      return true;
    } catch {
      return false;
    }
  }, [renderCardBlob]);

  // Download fallback — saves the card as a PNG the user can attach manually.
  const downloadCard = useCallback(async (): Promise<boolean> => {
    try {
      const blob = await renderCardBlob();
      if (!blob) return false;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cb-edge-spx-${todayETStr()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch {
      return false;
    }
  }, [renderCardBlob]);

  const onCopyCard = useCallback(async () => {
    const ok = await copyCardImage();
    if (ok) { flashShare("copied"); return; }
    const dl = await downloadCard();
    flashShare(dl ? "saved" : "error");
  }, [copyCardImage, downloadCard]);

  const onCopyAndOpenX = useCallback(async () => {
    const ok = await copyCardImage();
    if (!ok) await downloadCard();
    // Open the X composer with a prefilled caption (text only — X's intent API
    // cannot pre-attach the image, so the user still pastes the copied card).
    const text = `Todays $SPX Levels\nprovided by https://www.cbedge.net/`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener",
    );
    flashShare(ok ? "opened" : "saved");
  }, [copyCardImage, downloadCard]);

  // Share the rendered card PNG (image only) to Discord via the server-side
  // webhook proxy (/api/discord-share → DISCORD_WEBHOOK_URL).
  const onShareDiscord = useCallback(async () => {
    if (discordState === "busy") return;
    setDiscordState("busy");
    try {
      const blob = await renderCardBlob();
      if (!blob) throw new Error("render failed");
      const fd = new FormData();
      fd.append("payload_json", JSON.stringify({}));
      fd.append("files[0]", blob, `cb-edge-spx-${todayETStr()}.png`);
      const res = await fetch("/api/discord-share", { method: "POST", body: fd });
      if (!res.ok) throw new Error(`discord ${res.status}`);
      setDiscordState("ok");
    } catch (e) {
      console.error("[social-media discord]", e);
      setDiscordState("err");
    } finally {
      if (discordTimer.current) clearTimeout(discordTimer.current);
      discordTimer.current = setTimeout(() => setDiscordState("idle"), 1800);
    }
  }, [discordState, renderCardBlob]);

  // Manual refresh — re-pulls the dashboard stats (and ES candles) and lets the
  // Daily Input repopulate from live state. Clears the dirty flag so an explicit
  // refresh overrides earlier auto-fill edits; manual typing after still sticks.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    dirtyRef.current = false;
    try {
      await Promise.all([hydrate(), Promise.resolve(refreshCandles?.())]);
    } finally {
      setRefreshing(false);
    }
  }, [hydrate, refreshCandles]);

  return (
    <div id="page-social-media" className="sm-page">
      <style>{`
        /* Alias the design-reference token names onto the real global tokens so
           nothing introduces a new color and the names resolve on this route. */
        #page-social-media {
          --bg0: var(--bg, #05060a);
          --bg1: var(--surface-solid, #0d1119);
          --bg2: #161b22;
          --bg3: #21262d;
          --bg4: #2d333b;
          --cyan: var(--accent, #00f0ff);
          --amber: var(--yellow, #f97316);
          --sm-red: var(--red, #ef4444);
          --sm-green: #10b981;
          --text1: var(--text, #ffffff);
          --text2: #ffffff;
          --sm-muted: #ffffff;
          --sm-border: var(--border, rgba(255,255,255,0.1));
          /* Arial across the whole page: the label tokens that used to map to a
             monospace stack now resolve to Arial, so every element that
             references --sm-mono renders in Arial without per-rule overrides. */
          --sm-mono: Arial, "Helvetica Neue", sans-serif;

          flex: 1;
          min-height: 0;
          overflow-y: auto;
          background: var(--bg0);
          color: var(--text2);
          font-family: Arial, "Helvetica Neue", sans-serif;
          padding: 24px;
        }
        #page-social-media, #page-social-media * { font-family: Arial, "Helvetica Neue", sans-serif; box-sizing: border-box; }

        .sm-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--sm-border); padding-bottom: 14px; margin-bottom: 22px; max-width: 1100px; margin-left: auto; margin-right: auto; }
        .sm-head h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; margin: 0; color: var(--text1); }
        .sm-tag { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--amber); border: 1px solid var(--amber); border-radius: 3px; padding: 2px 6px; opacity: 0.85; }
        .sm-tabs { display: inline-flex; gap: 4px; padding: 3px; background: var(--bg2); border: 1px solid var(--sm-border); border-radius: 8px; }
        .sm-tabs button { font-family: var(--sm-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 6px 12px; border-radius: 5px; border: 1px solid transparent; background: transparent; color: var(--sm-muted); transition: all 0.12s; }
        .sm-tabs button:hover { color: var(--text1); }
        .sm-tabs button.on { background: var(--cyan); color: #05060a; border-color: var(--cyan); box-shadow: 0 0 12px rgba(0,240,255,0.35); }
        .sm-date { margin-left: auto; font-family: var(--sm-mono); font-size: 13px; color: var(--sm-muted); }
        .sm-refresh { font-family: var(--sm-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 12px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .sm-refresh:hover { background: var(--bg4); border-color: var(--cyan); }
        .sm-refresh:active { transform: translateY(1px); }
        .sm-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
        .sm-live { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cyan); display: flex; align-items: center; gap: 5px; }
        .sm-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); display: inline-block; }

        .sm-grid { display: grid; grid-template-columns: 360px 1fr; gap: 22px; align-items: start; max-width: 1100px; margin: 0 auto; }
        @media (max-width: 820px) { .sm-grid { grid-template-columns: 1fr; } }

        .sm-panel { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .sm-panel-h { font-family: var(--sm-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); padding: 11px 14px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); display: flex; align-items: center; gap: 8px; }
        .sm-panel-b { padding: 16px; }

        .sm-regime { font-family: var(--sm-mono); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--sm-border); }
        .sm-regime.neg { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
        .sm-regime.pos { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.07); }
        .sm-regime-label { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
        .sm-regime.neg .sm-regime-label { color: var(--sm-red); }
        .sm-regime.pos .sm-regime-label { color: var(--sm-green); }
        .sm-regime-sub { font-size: 11px; color: var(--sm-muted); margin-top: 4px; }

        .sm-ladder { margin: 4px 0 16px; font-family: var(--sm-mono); font-size: 11px; }
        .sm-ladder-row { display: grid; grid-template-columns: 92px 1fr 72px; align-items: center; gap: 8px; padding: 3px 0; }
        .sm-ladder-row .lab { color: var(--sm-muted); }
        .sm-ladder-row .bar { height: 2px; background: var(--bg4); position: relative; border-radius: 2px; }
        .sm-ladder-row .bar i { position: absolute; top: -3px; height: 8px; width: 8px; border-radius: 50%; transform: translateX(-50%); }
        .sm-ladder-row .val { text-align: right; color: var(--text1); }
        .dot-call i { background: var(--sm-red); }
        .dot-flip i { background: var(--amber); }
        .dot-spot i { background: var(--cyan); box-shadow: 0 0 0 3px rgba(0,240,255,0.18); }
        .dot-put i { background: var(--sm-green); }

        .sm-field { margin-bottom: 11px; }
        .sm-field label { display: block; font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 4px; }
        .sm-field input, .sm-field textarea { width: 100%; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 5px; padding: 8px 10px; font-family: var(--sm-mono); font-size: 13px; transition: border-color 0.15s; }
        .sm-field input:focus, .sm-field textarea:focus { outline: none; border-color: var(--cyan); }
        .sm-field textarea { resize: vertical; min-height: 56px; line-height: 1.4; }
        .sm-field .hint { font-size: 10px; color: var(--sm-muted); margin-top: 3px; font-family: var(--sm-mono); }
        .sm-emrange { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; margin-top: 6px; font-family: var(--sm-mono); font-size: 12px; }
        .sm-emrange .lo { color: var(--sm-green); font-weight: 700; }
        .sm-emrange .hi { color: var(--sm-red); font-weight: 700; }
        .sm-emrange .mid { text-align: center; color: var(--sm-muted); font-size: 10px; letter-spacing: 0.04em; }
        .sm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }


        .sm-out { display: flex; flex-direction: column; gap: 14px; }

        /* ── action buttons under the card ── */
        .sm-share-acts { display: flex; gap: 10px; }
        .sm-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .sm-btn:hover { background: var(--bg4); }
        .sm-btn.lg { flex: 1; }
        .sm-btn.x { background: var(--cyan); color: #05060a; border-color: var(--cyan); }
        .sm-btn.x:hover { opacity: 0.9; }
        .sm-btn.discord { background: #5865f2; color: #fff; border-color: #5865f2; }
        .sm-btn.discord:hover { opacity: 0.9; }
        .sm-btn.discord:disabled { opacity: 0.6; cursor: default; }
        .sm-share-hint { font-size: 11px; color: var(--sm-muted); line-height: 1.4; }

        /* ── share card (the exported image) ── */
        .sc-card { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }
        .sc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--sm-border); padding-bottom: 14px; }
        .sc-title { display: flex; align-items: baseline; gap: 10px; }
        .sc-title .sc-spx { font-size: 26px; font-weight: 800; color: var(--text1); letter-spacing: 0.02em; }
        .sc-title .sc-sub { font-size: 12px; font-weight: 700; letter-spacing: 0.18em; color: var(--sm-muted); }
        .sc-updated { font-size: 12px; color: var(--sm-muted); }

        .sc-section { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-section-h { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; color: var(--cyan); margin-bottom: 12px; }
        .sc-em-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .sc-em-box { background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 12px; text-align: center; }
        .sc-em-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--sm-muted); margin-bottom: 8px; }
        .sc-em-box .sc-val { font-size: 20px; font-weight: 800; color: var(--text1); letter-spacing: 0.01em; }
        .sc-em-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 11px; color: var(--sm-muted); }

        .sc-regime { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-regime.neg { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
        .sc-regime.pos { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.07); }
        .sc-regime-label { font-size: 13px; font-weight: 800; letter-spacing: 0.04em; }
        .sc-regime.neg .sc-regime-label { color: var(--sm-red); }
        .sc-regime.pos .sc-regime-label { color: var(--sm-green); }
        .sc-regime-sub { font-size: 12px; color: var(--text1); margin-top: 6px; line-height: 1.45; }
        .sc-regime-bias-h { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--cyan); margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sm-border); }
        .sc-regime-bias { font-size: 12px; font-weight: 700; color: var(--text1); margin-top: 5px; line-height: 1.45; }
        .sc-regime-detail { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sm-border); }
        .sc-regime-item-h { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; color: var(--cyan); }
        .sc-regime-item-v { font-size: 11px; font-weight: 500; color: var(--text1); margin-top: 4px; line-height: 1.4; }

        .sc-levels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sc-levels-col { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-levels-h { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; margin-bottom: 12px; color: var(--cyan); }
        .sc-level-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
        .sc-level-row .lab { font-size: 12px; font-weight: 700; color: var(--text1); }
        .sc-level-row .val { font-size: 16px; font-weight: 800; }
        .sc-level-row .val.red { color: var(--sm-red); }
        .sc-level-row .val.green { color: var(--sm-green); }
        .sc-level-row .val.amber { color: var(--amber); }
        .sc-level-row .val.cyan { color: var(--cyan); }

        .sc-ovn { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 14px 16px; }
        .sc-ovn .lab { font-size: 12px; font-weight: 700; color: var(--sm-muted); letter-spacing: 0.04em; }
        .sc-ovn .val { font-size: 16px; font-weight: 800; color: var(--text1); }
        .sc-ovn .val .sep { color: var(--sm-muted); margin: 0 6px; }

        .sc-foot { text-align: center; border-top: 1px solid var(--sm-border); padding-top: 16px; }
        .sc-brand { font-size: 17px; font-weight: 800; color: var(--text1); letter-spacing: 0.03em; }
        .sc-disc { font-size: 10px; color: var(--sm-muted); letter-spacing: 0.06em; margin-top: 8px; }
      `}</style>

      <div className="sm-head">
        <h1>Social Media</h1>
        <span className="sm-tag">Admin</span>
        <span className="sm-tabs">
          <button type="button" className={tab === "levels" ? "on" : ""} onClick={() => setTab("levels")}>Daily Levels</button>
          <button type="button" className={tab === "cards" ? "on" : ""} onClick={() => setTab("cards")}>GEX Image Cards</button>
          <button type="button" className={tab === "explainer" ? "on" : ""} onClick={() => setTab("explainer")}>Explainer Mockup</button>
        </span>
        <span className="sm-live"><i />{hydrated ? "Live state" : "Hydrating…"}</span>
        <span className="sm-date">{today}</span>
        <button
          type="button"
          className="sm-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Re-pull live dashboard stats & ES overnight"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {tab === "cards" && <GexImageCards updated={updatedLabel} today={today} form={form} />}
      {tab === "explainer" && (
        <ExplainerMockup
          form={form}
          regime={regime}
          updated={updatedLabel}
          ladder={gexLadder}
          dte={dte}
          onDteChange={(d) => {
            if (d === dte) return;
            // Switching expiry should re-pull GEX-derived fields even if the form
            // was edited — clear the dirty guard so the new expiry repopulates.
            dirtyRef.current = false;
            setDte(d);
          }}
          candles={spxCandles}
          candlesOn={candlesOn}
          candlesConnected={candlesConnected}
          onToggleCandles={() => setCandlesOn((v) => !v)}
        />
      )}

      <div className="sm-grid" style={tab === "cards" || tab === "explainer" ? { display: "none" } : undefined}>
        {/* LEFT: dashboard-derived input */}
        <div className="sm-panel">
          <div className="sm-panel-h">Daily Input · from dashboard state</div>
          <div className="sm-panel-b">
            <div className={`sm-regime ${regime.neg ? "neg" : "pos"}`}>
              <div className="sm-regime-label">{regime.label}</div>
              <div className="sm-regime-sub">{regime.sub}</div>
            </div>

            <LevelLadder form={form} />

            <div className="sm-row2">
              <div className="sm-field">
                <label>SPX Spot</label>
                <input value={form.spot} onChange={(e) => setField("spot", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>SPX Prior Close</label>
                <input value={form.prevClose} onChange={(e) => setField("prevClose", e.target.value)} />
              </div>
            </div>
            <div className="sm-row2">
              <div className="sm-field">
                <label>Gamma Flip</label>
                <input value={form.flip} onChange={(e) => setField("flip", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>Net GEX</label>
                <input value={form.gex} onChange={(e) => setField("gex", e.target.value)} />
              </div>
            </div>
            <div className="sm-row2">
              <div className="sm-field">
                <label>Call Wall</label>
                <input value={form.call} onChange={(e) => setField("call", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>Put Wall</label>
                <input value={form.put} onChange={(e) => setField("put", e.target.value)} />
              </div>
            </div>
            <div className="sm-field">
              <label>Expected Move ±</label>
              <input value={form.em} onChange={(e) => setField("em", e.target.value)} />
              <EmRangeReadout form={form} />
            </div>
            <div className="sm-field">
              <label>ES Overnight (H / L)</label>
              <input value={form.ovn} onChange={(e) => setField("ovn", e.target.value)} placeholder="high / low" />
            </div>
            <div className="sm-field">
              <label>Bias · from Greeks flow regime</label>
              <textarea value={form.bias} onChange={(e) => setField("bias", e.target.value)} />
              <div className="hint">pre-filled from options-flow regime — edit on event days</div>
            </div>

          </div>
        </div>

        {/* RIGHT: share card (auto-filled from the left) + copy/X actions */}
        <div className="sm-out">
          <ShareCard ref={cardRef} form={form} regime={regime} updated={updatedLabel} />
          <div className="sm-share-acts">
            <button type="button" className="sm-btn lg" onClick={onCopyCard}>
              {shareState === "copied" ? "Copied ✓" : shareState === "saved" ? "Saved PNG ✓" : shareState === "error" ? "Copy failed" : "Copy card"}
            </button>
            <button type="button" className="sm-btn lg x" onClick={onCopyAndOpenX}>
              {shareState === "opened" ? "Opened X ✓" : "Copy & Open X"}
            </button>
            <button type="button" className="sm-btn lg discord" onClick={onShareDiscord} disabled={discordState === "busy"}>
              {discordState === "busy" ? "Posting…" : discordState === "ok" ? "Posted ✓" : discordState === "err" ? "Failed" : "Share to Discord"}
            </button>
          </div>
          <div className="sm-share-hint">
            Copies the card image to your clipboard — paste (Ctrl+V) into the X composer. If your browser blocks image copy, it downloads a PNG to attach.
          </div>
        </div>
      </div>
    </div>
  );
}
