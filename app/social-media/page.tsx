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

// Tesseract.js loaded from CDN on first use (keeps it out of the bundle). Used by
// the GEX Image Cards tab to OCR a dropped chart/heatmap capture and auto-fill levels.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tessPromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTesseract(): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (_tessPromise) return _tessPromise;
  _tessPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.0/tesseract.min.js";
    s.async = true;
    s.onload = () => resolve(w.Tesseract);
    s.onerror = () => reject(new Error("tesseract load failed"));
    document.head.appendChild(s);
  });
  return _tessPromise;
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
}

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
function regimeOf(form: FormState): { neg: boolean; label: string; sub: string } {
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
    };
  }
  return {
    neg: false,
    label: "POSITIVE GAMMA",
    sub: underFlip
      ? "Net GEX positive · spot still under the flip — dampening in play, but watch for a flip reclaim."
      : "Net GEX positive · spot over the flip — dealers dampen moves, fade extremes.",
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
  regime: { neg: boolean; label: string; sub: string };
  updated: string;
}>(function ShareCard({ form, regime, updated }, ref) {
  const band = emBand(form);
  const close = toNum(form.prevClose);
  const em = toNum(form.em);
  const closeStr = Number.isFinite(close) && close > 0 ? fmt(close) : "—";
  const emStr = Number.isFinite(em) && em > 0 ? fmt(em) : "—";
  const subLine =
    Number.isFinite(close) && Number.isFinite(em) && close > 0 && em > 0
      ? `Close ${fmt(close)} ±${fmt(em)}`
      : "Close —";
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
        <div className="sc-em-foot">
          <span>IMPLIED MOVE</span>
          <span>{subLine}</span>
          <span>OFF PRIOR CLOSE</span>
        </div>
      </div>

      {/* regime strip */}
      <div className={`sc-regime ${regime.neg ? "neg" : "pos"}`}>
        <div className="sc-regime-label">{regime.label}</div>
        <div className="sc-regime-sub">{regime.sub}</div>
        <div className="sc-regime-bias-h">BIAS</div>
        <div className="sc-regime-bias">{form.bias || "—"}</div>
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

  .gx-head { position:relative; z-index:2; display:grid; grid-template-columns: 1fr auto 1fr; align-items:center; padding: 26px 40px 6px; }
  .gx-head-side { display:flex; flex-direction:column; gap:3px; }
  .gx-head-side.left { align-items:flex-start; }
  .gx-head-side.right { align-items:flex-end; }
  .gx-date { font-size:20px; font-weight:800; color:#fff; letter-spacing:.01em; }
  .gx-time { font-size:13px; color:#9aa4b2; letter-spacing:.04em; }
  .gx-logo { display:flex; align-items:center; justify-content:center; }
  .gx-logo img { height:74px; width:auto; object-fit:contain; filter: drop-shadow(0 4px 18px rgba(0,240,255,.25)); }
  .gx-regime { display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:800; letter-spacing:.06em; padding:8px 13px; border-radius:8px; border:1px solid; }
  .gx-regime.neg { color:#ef4444; border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.10); box-shadow: 0 0 18px rgba(239,68,68,.25) inset; }
  .gx-regime.pos { color:#10b981; border-color: rgba(16,185,129,.5); background: rgba(16,185,129,.10); box-shadow: 0 0 18px rgba(16,185,129,.25) inset; }
  .gx-regime i { width:9px; height:9px; border-radius:50%; background: currentColor; box-shadow: 0 0 10px currentColor; }

  .gx-title { position:relative; z-index:2; display:flex; align-items:baseline; gap:12px; padding: 8px 40px 14px; }
  .gx-title .tk { font-size:34px; font-weight:900; letter-spacing:.02em;
    background: linear-gradient(180deg, #7df9ff, #00f0ff); -webkit-background-clip:text; background-clip:text; color: transparent;
    text-shadow: 0 0 26px rgba(0,240,255,.35); }
  .gx-title .dot { font-size:30px; color:#3a4456; }
  .gx-title .nm { font-size:30px; font-weight:900; color:#fff; letter-spacing:.03em; }
  .gx-title .sub { margin-left:auto; font-size:13px; letter-spacing:.22em; text-transform:uppercase; color:#9aa4b2; font-weight:700; }

  .gx-imgwrap { position:relative; z-index:2; flex:1; margin: 0 40px; border:1px solid var(--sm-border); border-radius:14px;
    background:#06080e; overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  .gx-imgwrap > img { width:100%; height:100%; object-fit:contain; display:block; }
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

  .gx-strip { position:relative; z-index:2; display:flex; align-items:stretch; gap:14px; padding: 18px 40px 12px; }
  .gx-pill { flex:1; display:flex; flex-direction:column; gap:8px; justify-content:center; padding:14px 18px;
    border:1px solid var(--sm-border); border-radius:12px;
    background: linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0)); }
  .gx-pill .k { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:#9aa4b2; font-weight:800; }
  .gx-pill .v { display:flex; align-items:baseline; gap:6px; font-size:30px; font-weight:900; letter-spacing:.01em; line-height:1; }
  .gx-pill .v b { font-weight:900; outline:none; }
  .gx-pill .v small { font-size:14px; font-weight:800; color:#9aa4b2; }
  .gx-pill .v b.cyan { color:#00f0ff; text-shadow:0 0 18px rgba(0,240,255,.35); }
  .gx-pill .v b.amber { color:#f97316; text-shadow:0 0 16px rgba(249,115,22,.30); }
  .gx-pill .v b.red { color:#ef4444; text-shadow:0 0 16px rgba(239,68,68,.30); }
  .gx-pill .v b.green { color:#10b981; text-shadow:0 0 16px rgba(16,185,129,.30); }

  .gx-foot { position:relative; z-index:2; display:flex; align-items:center; gap:14px; padding: 10px 40px 22px; }
  .gx-foot .brand { font-size:16px; font-weight:900; letter-spacing:.06em;
    background: linear-gradient(180deg,#e8eef5,#9aa6b5); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .gx-foot .tag { font-size:12px; font-style:italic; color:#9aa4b2; }
  .gx-foot .disc { margin-left:auto; font-size:11px; color:#6b7686; letter-spacing:.04em; }
`;

/* ════════════════════════════════════════════════════════════════════════════
 * GEX Image Cards — branded 1600×900 social cards built around a screenshot of
 * the live NET GEX chart and the GEX heatmap. Drop a capture into a card → it
 * OCRs the image (Tesseract) and auto-fills the levels strip; every field stays
 * click-to-edit. Heavy/hype styling, real CB Edge chrome logo centered up top,
 * fixed footer (no overlap). Exports each card to PNG via html2canvas at 2×.
 * ════════════════════════════════════════════════════════════════════════════ */

// money magnitudes like -1.26B / -$812.57M (keep the decimal)
function magNum(s: string): number { return parseFloat(String(s).replace(/[^0-9.\-]/g, "")); }
function fmtStrikeN(n: number): string | null { return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : null; }

// Strike token → integer. The dashboard renders strikes dot-thousands ("7.330"),
// so normalize "7.330"/"7,330"/"7345"/"7,344.05" → 7330/7345/7344.
function strikeNum(tok: string): number {
  const t = String(tok).trim();
  let m = t.match(/^([0-9]{1,2})[.,]([0-9]{3})$/); if (m) return parseInt(m[1] + m[2], 10);
  m = t.match(/^([0-9]{1,2})[.,]([0-9]{3})[.,]([0-9]{1,2})$/); if (m) return parseInt(m[1] + m[2], 10);
  m = t.match(/^([0-9]{4,5})$/); if (m) return parseInt(m[1], 10);
  const d = t.replace(/[^0-9]/g, ""); return d ? parseInt(d.slice(0, 5), 10) : NaN;
}

interface ChartRead { spot?: string; mvc?: string; }
function parseChartText(text: string): ChartRead {
  const out: ChartRead = {};
  const mSpx = text.match(/SPX[^0-9]{0,4}([0-9][0-9.,]{3,})/i);
  if (mSpx) { const n = parseFloat(mSpx[1].replace(/,/g, "")); if (n > 1000 && n < 100000) out.spot = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  const mMvc = text.match(/MVC[^0-9]{0,4}([0-9][0-9.,]{2,})/i);
  if (mMvc) { const s = strikeNum(mMvc[1]); if (s > 1000 && s < 100000) out.mvc = fmtStrikeN(s) ?? undefined; }
  return out;
}

interface HeatRead { atm?: string; gex?: string; gexStrike?: string; }
// ATM = row tagged ATM. Largest negative = most-negative value in the FIRST money
// column after the strike (Net GEX) — not any negative on the row (DEX is usually
// the biggest negative and would otherwise win).
function parseHeatmapText(text: string): HeatRead {
  const out: HeatRead = {};
  const lines = text.split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i].match(/([0-9][.,]?[0-9]{3})\s*ATM|ATM\s*([0-9][.,]?[0-9]{3})/i);
    if (a) { const sa = strikeNum(a[1] || a[2]); if (sa > 1000 && sa < 100000) { out.atm = fmtStrikeN(sa) ?? undefined; break; } }
  }
  let worst: { gex: number; strike: number | null; label: string | null } = { gex: Infinity, strike: null, label: null };
  for (let j = 0; j < lines.length; j++) {
    const ln = lines[j].trim();
    const ms = ln.match(/^([0-9]{1,2}[.,][0-9]{3}|[0-9]{4,5})\b/);
    if (!ms) continue;
    const strike = strikeNum(ms[1]); if (!(strike > 1000 && strike < 100000)) continue;
    const rest = ln.slice(ms[0].length);
    const mg = rest.match(/([+\-]?\s*\$?\s*[0-9][0-9.,]*\s*[BMK])/i);
    if (!mg) continue;
    const raw = mg[1].toUpperCase().replace(/\s+/g, "");
    let val = magNum(raw); if (/M/.test(raw)) val /= 1000; else if (/K/.test(raw)) val /= 1e6;
    if (/^-/.test(raw) && val < worst.gex) worst = { gex: val, strike, label: raw.replace("$", "") };
  }
  if (worst.strike != null && worst.label) {
    out.gex = /B$/.test(worst.label) ? worst.label.replace("-", "−") : worst.gex.toFixed(2).replace("-", "−") + "B";
    out.gexStrike = fmtStrikeN(worst.strike) ?? undefined;
  }
  return out;
}

// Upscale a capture before OCR — small dashboard text reads far better at 2×.
function upscaleForOcr(dataUrl: string): Promise<HTMLCanvasElement | string> {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      const s = im.naturalWidth < 1400 ? 2 : 1;
      const cv = document.createElement("canvas");
      cv.width = im.naturalWidth * s; cv.height = im.naturalHeight * s;
      const cx = cv.getContext("2d"); if (cx) { cx.imageSmoothingEnabled = true; cx.drawImage(im, 0, 0, cv.width, cv.height); }
      res(cv);
    };
    im.onerror = () => res(dataUrl);
    im.src = dataUrl;
  });
}

type CardKind = "chart" | "heat";
interface CardFields { a: string; b: string; bSmall: string; c: string; cSmall: string; d: string; }

const CHART_DEFAULTS: CardFields = { a: "7,346.55", b: "7,330", bSmall: "", c: "−$1.0B", cSmall: "peak", d: "7,250–7,450" };
const HEAT_DEFAULTS: CardFields = { a: "7,345", b: "−$1.26B", bSmall: "7,330", c: "+ below 7,330", cSmall: "", d: "Neg thru body" };

const CHART_LABELS = { a: "SPX SPOT", b: "MVC", c: "NET GEX", d: "RANGE" };
const HEAT_LABELS = { a: "ATM STRIKE", b: "LARGEST NEG GEX", c: "NET VEX FLIP", d: "DEX" };

function GexCard({
  kind, updated, today, regimeNeg,
}: { kind: CardKind; updated: string; today: string; regimeNeg: boolean }) {
  const [img, setImg] = useState<string | null>(null);
  const [fields, setFields] = useState<CardFields>(kind === "chart" ? CHART_DEFAULTS : HEAT_DEFAULTS);
  const [ocr, setOcr] = useState<{ cls: string; msg: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const labels = kind === "chart" ? CHART_LABELS : HEAT_LABELS;

  const setField = (k: keyof CardFields, v: string) => setFields((f) => ({ ...f, [k]: v }));

  const runOcr = useCallback(async (dataUrl: string) => {
    setOcr({ cls: "busy", msg: "Reading levels…" });
    try {
      const Tesseract = await getTesseract();
      const src = await upscaleForOcr(dataUrl);
      const res = await Tesseract.recognize(src, "eng");
      const text: string = res?.data?.text ?? "";
      // Compute `got` synchronously from the parse result (not inside the state
      // updater, which runs async) so the status message is always correct.
      let got = 0;
      if (kind === "chart") {
        const c = parseChartText(text);
        if (c.spot) got++;
        if (c.mvc) got++;
        setFields((f) => ({ ...f, ...(c.spot ? { a: c.spot } : {}), ...(c.mvc ? { b: c.mvc } : {}) }));
      } else {
        const h = parseHeatmapText(text);
        if (h.atm) got++;
        if (h.gex) got++;
        setFields((f) => ({
          ...f,
          ...(h.atm ? { a: h.atm } : {}),
          ...(h.gex ? { b: h.gex, bSmall: h.gexStrike ?? "" } : {}),
          ...(h.gex && h.gexStrike ? { c: `+ below ${h.gexStrike}` } : {}),
        }));
      }
      setOcr(got ? { cls: "ok", msg: `✓ Read ${got} value${got > 1 ? "s" : ""} — verify & edit` } : { cls: "warn", msg: "Couldn’t read levels — type them" });
    } catch {
      setOcr({ cls: "warn", msg: "OCR failed — type levels manually" });
    }
  }, [kind]);

  const loadFile = useCallback((file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = (e) => { const url = String(e.target?.result || ""); setImg(url); runOcr(url); };
    rd.readAsDataURL(file);
  }, [runOcr]);

  const onExport = useCallback(async () => {
    const node = cardRef.current; if (!node) return;
    setBusy(true);
    try {
      const prev = node.style.transform; node.style.transform = "none";
      const html2canvas = await getHtml2Canvas();
      const canvas = await html2canvas(node, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false, width: 1600, height: 900 });
      node.style.transform = prev;
      const blob: Blob | null = await new Promise((r) => canvas.toBlob((b: Blob | null) => r(b), "image/png"));
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `cb-edge-${kind === "chart" ? "netgex" : "heatmap"}-${todayETStr()}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
    } finally { setBusy(false); }
  }, [kind]);

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
          <div className="gx-head-side right">
            <span className={`gx-regime ${regimeNeg ? "neg" : "pos"}`}><i />{regimeNeg ? "NEGATIVE GAMMA" : "POSITIVE GAMMA"}</span>
          </div>
        </div>

        {/* title band */}
        <div className="gx-title">
          <span className="tk">SPX</span>
          <span className="dot">·</span>
          <span className="nm">{kind === "chart" ? "NET GEX" : "GEX HEATMAP"}</span>
          <span className="sub">{kind === "chart" ? "Gamma Exposure by Strike" : "Net GEX · Vol GEX · DEX · Net VEX"}</span>
        </div>

        {/* image slot */}
        <div className="gx-imgwrap" onClick={img ? undefined : onPick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) loadFile(e.dataTransfer.files[0]); }}>
          {img
            ? <img src={img} alt="capture" crossOrigin="anonymous" />
            : <div className="gx-drop"><div className="big">Drop {kind === "chart" ? "NET GEX chart" : "GEX heatmap"} here</div><div>or click to choose a file</div></div>}
          {ocr && <div className={`gx-ocr ${ocr.cls}`}>{ocr.cls === "busy" && <span className="gx-spin" />}{ocr.msg}{ocr.cls !== "busy" && img && <button type="button" onClick={(e) => { e.stopPropagation(); if (img) runOcr(img); }}>Re-run</button>}</div>}
        </div>

        {/* levels strip — main value is editable; the small sub-label is a
            separate non-editable span so editing can't absorb/duplicate it. */}
        <div className="gx-strip">
          <div className="gx-pill"><span className="k">{labels.a}</span><span className="v"><b className="cyan" contentEditable suppressContentEditableWarning onBlur={(e) => setField("a", e.currentTarget.textContent || "")}>{fields.a}</b></span></div>
          <div className="gx-pill"><span className="k">{labels.b}</span><span className="v"><b className="amber" contentEditable suppressContentEditableWarning onBlur={(e) => setField("b", e.currentTarget.textContent || "")}>{fields.b}</b>{fields.bSmall && <small>{fields.bSmall}</small>}</span></div>
          <div className="gx-pill"><span className="k">{labels.c}</span><span className="v"><b className="red" contentEditable suppressContentEditableWarning onBlur={(e) => setField("c", e.currentTarget.textContent || "")}>{fields.c}</b>{fields.cSmall && <small>{fields.cSmall}</small>}</span></div>
          <div className="gx-pill"><span className="k">{labels.d}</span><span className="v"><b className="green" contentEditable suppressContentEditableWarning onBlur={(e) => setField("d", e.currentTarget.textContent || "")}>{fields.d}</b></span></div>
        </div>

        {/* footer (in-flow — cannot overlap the strip) */}
        <div className="gx-foot">
          <span className="brand">CB EDGE</span>
          <span className="tag">“Real Edge — Real Orderflow”</span>
          <span className="disc">Informational only — not financial advice.</span>
        </div>
      </div>
      <button type="button" className="gx-dl" onClick={onExport} disabled={busy}>{busy ? "Rendering…" : "Download this card (PNG)"}</button>
    </div>
  );
}

function GexImageCards({ updated, today, form }: { updated: string; today: string; form: FormState }) {
  const neg = regimeOf(form).neg;
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
        Drop your screenshot into each card (or click it). On drop the page <b>auto-reads the levels</b> from the image (OCR) and fills the strip —
        spot/MVC from the chart, ATM strike &amp; largest negative GEX from the heatmap. <b>OCR can misread, so verify each value</b> — every field is click-to-edit, with a Re-run link.
        Then <b>Download</b> for a clean 1600×900 image. First OCR run loads the engine (a few seconds).
      </p>
      <div className="gx-stage" ref={stageRef}>
        <GexCard kind="chart" updated={updated} today={today} regimeNeg={neg} />
        <GexCard kind="heat" updated={updated} today={today} regimeNeg={neg} />
      </div>
    </div>
  );
}

export default function SocialMediaPage() {
  const [tab, setTab] = useState<"levels" | "cards">("levels");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Share-card capture target + transient button status ("" | "copied" | "opened" | "saved" | "error").
  const cardRef = useRef<HTMLDivElement>(null);
  const [shareState, setShareState] = useState<"" | "copied" | "opened" | "saved" | "error">("");
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (shareTimer.current) clearTimeout(shareTimer.current); }, []);
  // Once the user edits a field we stop overwriting it on the next hydrate poll.
  const dirtyRef = useRef(false);

  // ES overnight H/L sourced exactly like the Fails page: live + historical 5m ES
  // candles → computeRefLevels → onHigh/onLow (prior 18:00 ET → 09:30 ET globex).
  // Raw ESU futures points, same unit the Fails page and the daily-input API use.
  const { candles: liveCandles, historical, refresh: refreshCandles } = useEsCandles();
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
      const r = await fetch("/api/social-media/daily-input", { cache: "no-store" });
      if (!r.ok) return;
      const json = await r.json();
      const d = (json?.data ?? json) as DailyInput;
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
  }, [stampUpdated]);

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
    // Open the X composer; the user pastes (or attaches) the card, then adds copy.
    window.open("https://twitter.com/intent/tweet", "_blank", "noopener");
    flashShare(ok ? "opened" : "saved");
  }, [copyCardImage, downloadCard]);

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
        .sc-regime-bias-h { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--sm-muted); margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sm-border); }
        .sc-regime-bias { font-size: 12px; font-weight: 700; color: var(--text1); margin-top: 5px; line-height: 1.45; }

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

      <div className="sm-grid" style={tab === "cards" ? { display: "none" } : undefined}>
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
          </div>
          <div className="sm-share-hint">
            Copies the card image to your clipboard — paste (Ctrl+V) into the X composer. If your browser blocks image copy, it downloads a PNG to attach.
          </div>
        </div>
      </div>
    </div>
  );
}
