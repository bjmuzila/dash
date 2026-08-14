import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shareToDiscord } from "../lib/discord";
import { SegGroup } from "../components/DockToolbar";
import { useTickerUniverse, normalizeTicker, LIVE_FEED_TICKER } from "../lib/tickers";
import GexChart from "../gex/GexChart";
import Heatmap from "../gex/Heatmap";
import { type ChainRow } from "../gex/calc";

/* NOTE: the former LiveChartPlaceholder stub has been removed — live GEX now
 * renders via the ported ../gex/GexChart + ../gex/Heatmap components. */


/* ────────────────────────────────────────────────────────────────────────────
 * Social Media (admin) — turns the daily pre-market GEX read into a shareable
 * "<TICKER> · Daily Levels" card for X. A page-level ticker picker (backed by
 * the live scanner universe) drives every data tab; SPX is the default and is
 * the only root served off the live in-memory GEX feed.
 *
 * Left "Daily Input" panel hydrates from live dashboard state via
 * /api/social-media/daily-input?ticker= (spot / prior close / gamma flip / call+put
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
  // `spxSpot` / `spxPrevClose` are the legacy names the API still mirrors; they
  // hold the SELECTED ticker's values, whatever that ticker is.
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
  // ── ticker-wide additions ──────────────────────────────────────────────────
  ticker?: string;
  spot?: number | null;
  prevClose?: number | null;
  coreBullseye?: number | null;
  overnightHigh?: number | null;
  overnightLow?: number | null;
  pdh?: number | null;
  pdl?: number | null;
  pwh?: number | null;
  pwl?: number | null;
  pdDate?: string | null;
  levels?: TickerLevels | null;
  source?: string;
  scannerStale?: boolean | null;
  scannerTs?: string | null;
}

// The published /api/levels row for this ticker (EM, pivot and the no-long /
// no-short zones the /em page and the Pine script read).
export interface TickerLevels {
  label: string | null;
  close: number | null;
  em: number | null;
  up: number | null;
  down: number | null;
  buyNear: number | null;
  buyFar: number | null;
  sellNear: number | null;
  sellFar: number | null;
  pivot: number | null;
  expLabel: string | null;
}

// Everything the daily-input bundle returns that isn't an editable form field.
// Kept beside FormState (which is string-only) and refreshed with it.
export interface TickerStats {
  ticker: string;
  coreBullseye: number | null;
  pdh: number | null;
  pdl: number | null;
  pwh: number | null;
  pwl: number | null;
  pdDate: string | null;
  overnightHigh: number | null;
  overnightLow: number | null;
  levels: TickerLevels | null;
  source: string;
  scannerStale: boolean;
}

export const EMPTY_STATS: TickerStats = {
  ticker: "SPX", coreBullseye: null, pdh: null, pdl: null, pwh: null, pwl: null,
  pdDate: null, overnightHigh: null, overnightLow: null, levels: null,
  source: "", scannerStale: false,
};

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
// Shows the expected range as lower / upper centered on the prior close,
// e.g. "Close 6,012 · ±56 → 5,956 / 6,068". Prompts for a close if missing.
function EmRangeReadout({ form }: { form: FormState }) {
  const band = emBand(form);
  if (!band) {
    const haveClose = Number.isFinite(toNum(form.prevClose)) && toNum(form.prevClose) > 0;
    return (
      <div className="hint">
        {haveClose
          ? "enter an expected move to see the range"
          : "enter the prior close to anchor the EM range"}
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
// Mirrors the published-card design: <TICKER> · Daily Levels header, Estimated Move
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
  ticker: string;
}>(function ShareCard({ form, regime, updated, ticker }, ref) {
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
          <span className="sc-spx">{ticker}</span> <span className="sc-sub">DAILY LEVELS</span>
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

/* ════════════════════════════════════════════════════════════════════════════
 * Tweet Mockup — a shared X-post preview used on every tab. Takes a `getBlob`
 * (however that tab already renders its image — GexCard.renderBlob,
 * ExplainerMockup.renderBlob, the Daily-Levels renderCardBlob, the GEX Data
 * profile canvas, the Brander canvas) and a caption, and shows what the actual
 * tweet would look like: avatar + handle, caption, the rendered image, then
 * Copy / Open X. `refreshKey` re-renders the preview whenever the thing that
 * feeds it changes (e.g. a new image loads) — there's also a manual refresh
 * button since not every state change is worth wiring into a key.
 * ════════════════════════════════════════════════════════════════════════════ */
const TM_CSS = `
  .tm-wrap { border: 1px solid var(--sm-border); border-radius: 12px; background: var(--bg1); padding: 14px 16px; max-width: 480px; }
  .tm-title { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 10px; }
  .tm-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .tm-avatar { width: 36px; height: 36px; border-radius: 9px; background: var(--bg0); border: 1px solid var(--sm-border); object-fit: contain; padding: 3px; flex-shrink: 0; }
  .tm-names { display: flex; flex-direction: column; line-height: 1.25; }
  .tm-name { font-size: 14px; font-weight: 800; color: var(--text1); }
  .tm-handle { font-size: 12px; color: var(--sm-muted); }
  .tm-caption { font-size: 14px; color: var(--text1); line-height: 1.45; white-space: pre-wrap; margin-bottom: 10px; }
  .tm-caption-edit { width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; font-family: inherit; font-size: 14px; line-height: 1.45; color: var(--text1); background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
  .tm-imgbox { border: 1px solid var(--sm-border); border-radius: 10px; overflow: hidden; background: var(--bg0); min-height: 90px; display: flex; align-items: center; justify-content: center; }
  .tm-imgbox img { display: block; width: 100%; height: auto; max-height: 320px; object-fit: contain; }
  .tm-ph { font-size: 12px; color: var(--sm-muted); padding: 20px; text-align: center; }
  .tm-acts { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .tm-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer; padding: 7px 12px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg3, rgba(255,255,255,.05)); color: var(--text1); transition: all .12s; }
  .tm-btn:hover { border-color: var(--cyan); } .tm-btn:disabled { opacity: .5; cursor: default; }
  .tm-btn.x { background: var(--cyan); border-color: var(--cyan); color: #05060a; }
`;

interface TweetMockupProps {
  getBlob: () => Promise<Blob | null>;
  caption: string;
  onCaptionChange?: (v: string) => void;
  refreshKey?: unknown;
  title?: string;
}
function TweetMockup({ getBlob, caption, onCaptionChange, refreshKey, title }: TweetMockupProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<"" | "copied" | "saved" | "err">("");
  const urlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const blob = await getBlob();
      if (blob) {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setPreviewUrl(url);
      }
    } finally {
      setLoading(false);
    }
  }, [getBlob]);

  // Auto-recapture whenever the thing feeding this mockup changes.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const copyImage = useCallback(async (): Promise<boolean> => {
    const blob = await getBlob();
    if (!blob) return false;
    try {
      const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!ClipItem || !navigator.clipboard?.write) throw new Error("no-clip");
      await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
      return true;
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cb-edge-tweet-${todayETStr()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return false;
    }
  }, [getBlob]);

  const onCopy = useCallback(async () => {
    const ok = await copyImage();
    setCopyState(ok ? "copied" : "saved");
    setTimeout(() => setCopyState(""), 1600);
  }, [copyImage]);

  const onOpenX = useCallback(async () => {
    await copyImage();
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`, "_blank", "noopener");
  }, [copyImage, caption]);

  return (
    <div className="tm-wrap">
      <style>{TM_CSS}</style>
      <div className="tm-title">{title || "Tweet preview"}</div>
      <div className="tm-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="tm-avatar" src="/cb-edge-logo.png" alt="CB Edge" />
        <div className="tm-names">
          <span className="tm-name">CB Edge</span>
          <span className="tm-handle">@cbedge · now</span>
        </div>
      </div>
      {onCaptionChange
        ? <textarea className="tm-caption-edit" value={caption} onChange={(e) => onCaptionChange(e.target.value)} />
        : <div className="tm-caption">{caption}</div>}
      <div className="tm-imgbox">
        {previewUrl
          ? <img src={previewUrl} alt="tweet preview" />
          : <div className="tm-ph">{loading ? "Rendering preview…" : "No image yet — hit Refresh"}</div>}
      </div>
      <div className="tm-acts">
        <button type="button" className="tm-btn" onClick={refresh} disabled={loading}>{loading ? "Loading…" : "↻ Refresh"}</button>
        <button type="button" className="tm-btn" onClick={onCopy} disabled={loading}>
          {copyState === "copied" ? "✓ Copied" : copyState === "saved" ? "✓ Saved" : "Copy"}
        </button>
        <button type="button" className="tm-btn x" onClick={onOpenX} disabled={loading}>Open X</button>
      </div>
    </div>
  );
}

/* Heavy/hype card styling for the GEX Image Cards tab. Scoped under .gx-wrap so
   it can't leak into the rest of the page. Cards are true 1600×900 for export. */
const GX_CSS = `
  .gx-wrap { max-width: 1720px; margin: 0 auto; }
  .gx-help { font-size: 12px; color: #9aa4b2; line-height: 1.55; max-width: 1100px; margin: 0 auto 22px; }
  .gx-help b { color: #fff; }
  .gx-stage { display: flex; flex-direction: column; gap: 36px; align-items: center; }
  .gx-cardwrap { position: relative; display: flex; flex-direction: column; gap: 12px; align-items: center; }
  .gx-caprow { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .gx-caplabel { font-size: 12px; color: #9aa4b2; letter-spacing: 0.04em; }
  .gx-dl { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 16px; border-radius: 7px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; transition: all .12s; box-shadow: 0 0 16px rgba(33,158,188,.3); }
  .gx-dl:hover { opacity: .92; } .gx-dl:disabled { opacity: .5; cursor: default; }
  .gx-actions { display:flex; gap:10px; align-items:center; }
  .gx-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 16px; border-radius: 7px; border: 1px solid; transition: all .12s; }
  .gx-btn:hover { opacity:.9; } .gx-btn:disabled { opacity:.5; cursor:default; }
  .gx-btn.copy { background: transparent; border-color: rgba(255,255,255,.22); color:#cfd6df; }
  .gx-btn.x { background:#1d9bf0; border-color:#1d9bf0; color:#fff; box-shadow: 0 0 16px rgba(29,155,240,.3); }
  .gx-btn.load { border-color: var(--cyan); color: var(--cyan); background: transparent; padding: 7px 13px; font-size: 12px; }

  /* fit into viewport but keep true pixels for capture. Outer card is the
     SAME flat panel used everywhere else on the dashboard (homePanelStyle /
     classicCardStyle): a subtle top-center accent glow over the solid panel
     surface, a hairline border, a plain drop shadow. No standalone neon
     gradient, no corner glow blobs, no rainbow top bar. */
  .gx-card { width: 1600px; height: 900px; flex: 0 0 auto; position: relative; overflow: hidden;
    background: radial-gradient(circle at 50% 0%, rgba(33,158,188,0.07) 0%, transparent 55%), var(--bg1);
    border: 1px solid var(--sm-border); border-radius: 18px;
    box-shadow: 0 18px 40px rgba(0,0,0,.22);
    display: flex; flex-direction: column; transform-origin: top center; }
  .gx-card.vertical { width: 900px; height: 1600px; }
  .gx-card.neg { border-color: rgba(239,68,68,0.35); }

  .gx-head { position:absolute; top:0; left:0; right:0; z-index:4; display:grid; grid-template-columns: 1fr auto 1fr; align-items:start; padding: 22px 30px 6px; pointer-events:none; }
  .gx-head-side { display:flex; flex-direction:column; gap:3px; }
  .gx-head-side.left { align-items:flex-start; }
  .gx-head-side.right { align-items:flex-end; position:relative; z-index:6; pointer-events:auto; }
  .gx-date { font-size:20px; font-weight:800; color:#fff; letter-spacing:.01em; }
  .gx-time { font-size: 14px; color:#9aa4b2; letter-spacing:.04em; }
  .gx-logo { position:absolute; top:-30px; left:50%; transform:translateX(-50%); z-index:4; display:flex; align-items:center; justify-content:center; pointer-events:none; }
  .gx-logo img { height:330px; width:auto; object-fit:contain; filter: drop-shadow(0 6px 30px rgba(33,158,188,.32)); }
  .gx-regime { position:absolute; top:26px; right:30px; z-index:6; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; font-size: 14px; font-weight:800; letter-spacing:.06em; padding:8px 13px; border-radius:8px; border:1px solid; pointer-events:auto; }
  .gx-regime.neg { color:#ef4444; border-color: rgba(239,68,68,.5); background: rgba(239,68,68,.10); box-shadow: 0 0 18px rgba(239,68,68,.25) inset; }
  .gx-regime.pos { color:#8ECAE6; border-color: rgba(16,185,129,.5); background: rgba(16,185,129,.10); box-shadow: 0 0 18px rgba(16,185,129,.25) inset; }
  .gx-regime i { width:9px; height:9px; border-radius:50%; background: currentColor; box-shadow: 0 0 10px currentColor; }

  /* chart as a full-bleed UNDERLAY — inset ~1in (96px) from the card edge on
     3 sides. Bottom gets more clearance (150px) than the strip's own 58px
     offset + ~77px pill height so the chart's own strike-number labels (drawn
     near ITS canvas bottom) land above the pill strip instead of under it. */
  .gx-imgwrap { position:absolute; top:96px; right:96px; bottom:150px; left:96px; z-index:1; border:1px solid var(--sm-border); border-radius:16px;
    background:var(--bg0); overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; }
  /* auto-crop the chart's top toolbar: render the image taller than the box and
     pin it to the bottom so the top ~10% (toolbar row) is clipped by overflow.
     Only applies to a user-dropped screenshot — our own live-captured profile/
     heatmap has no toolbar to crop, so it gets a plain contain-fit instead. */
  .gx-imgwrap > img { width:100%; height:112%; object-fit:fill; object-position:center bottom;
    position:absolute; bottom:0; left:0; display:block; }
  .gx-imgwrap.live > img { height:100%; object-fit:contain; object-position:center; }
  .gx-ocr { position:absolute; left:14px; bottom:14px; z-index:3; display:inline-flex; align-items:center; gap:8px;
    font-size:12px; font-weight:700; letter-spacing:.03em; padding:7px 12px; border-radius:7px; border:1px solid rgba(255,255,255,.18);
    background: rgba(5,6,10,.85); color:#9aa4b2; }
  .gx-ocr.busy { color: var(--cyan); border-color: rgba(33,158,188,.4); }
  .gx-ocr.ok { color:#8ECAE6; border-color: rgba(16,185,129,.4); }
  .gx-ocr.warn { color: var(--amber); border-color: rgba(249,115,22,.4); }
  .gx-ocr button { font:inherit; font-size: 12px; cursor:pointer; background:transparent; color: var(--cyan); border:none; text-decoration:underline; padding:0; margin-left:6px; }
  .gx-spin { width:11px; height:11px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation: gxspin .7s linear infinite; }
  @keyframes gxspin { to { transform: rotate(360deg); } }

  .gx-strip { position:absolute; left:0; right:0; bottom:58px; z-index:4; display:flex; align-items:stretch; gap:14px; padding: 0 30px; }
  .gx-pill { flex:1; display:flex; flex-direction:column; gap:8px; justify-content:center; padding:14px 18px;
    border:1px solid var(--sm-border); border-radius:12px;
    background: rgba(5,7,12,.82); backdrop-filter: blur(3px); }
  .gx-pill .k { font-size: 12px; letter-spacing:.12em; text-transform:uppercase; color:#9aa4b2; font-weight:800; }
  .gx-pill .v { display:flex; align-items:baseline; gap:6px; font-size:30px; font-weight:900; letter-spacing:.01em; line-height:1; }
  .gx-pill .v b { font-weight:900; outline:none; }
  .gx-pill .v small { font-size:14px; font-weight:800; color:#9aa4b2; }
  .gx-pill .v b.cyan { color:#219EBC; text-shadow:0 0 18px rgba(33,158,188,.35); }
  .gx-pill .v b.amber { color:#FB8501; text-shadow:0 0 16px rgba(249,115,22,.30); }
  .gx-pill .v b.red { color:#ef4444; text-shadow:0 0 16px rgba(239,68,68,.30); }
  .gx-pill .v b.green { color:#8ECAE6; text-shadow:0 0 16px rgba(16,185,129,.30); }
  .gx-pill.core { flex: 2.4; }
  .gx-pill.core .cv { font-size: 17px; font-weight:600; line-height:1.4; color:#d7dee8; outline:none; }

  .gx-foot { position:absolute; left:0; right:0; bottom:0; z-index:4; display:flex; align-items:center; gap:14px; padding: 10px 34px 20px; pointer-events:none; }
  .gx-foot .brand { font-size: 17px; font-weight:900; letter-spacing:.06em;
    background: linear-gradient(180deg,#e8eef5,#9aa6b5); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .gx-foot .tag { font-size:12px; font-style:italic; color:#9aa4b2; }
  .gx-foot .disc { margin-left:auto; font-size: 12px; color:#6b7686; letter-spacing:.04em; }
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

// Chart card exports landscape (1600×900); the heatmap card exports portrait
// (900×1600) so the taller strike table actually fits instead of getting
// squashed into a 16:9 slot.
const CARD_DIMS: Record<CardKind, { w: number; h: number }> = {
  chart: { w: 1600, h: 900 },
  heat: { w: 900, h: 1600 },
};

const CHART_DEFAULTS: CardFields = { a: "7,346.55", b: "7,330", bSmall: "", c: "−$1.0B", cSmall: "peak", d: "7,250–7,450" };
const HEAT_DEFAULTS: CardFields = { a: "7,345", b: "−$1.26B", bSmall: "7,330", c: "+ below 7,330", cSmall: "", d: "Neg thru body" };

const chartLabels = (ticker: string) => ({ a: `${ticker} SPOT`, b: "CB", c: "NET GEX", d: "RANGE" });
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
  kind, updated, today, regimeNeg, form, coreBehavior, ticker,
}: { kind: CardKind; updated: string; today: string; regimeNeg: boolean; form: FormState; coreBehavior: string; ticker: string }) {
  const dims = CARD_DIMS[kind];
  const [img, setImg] = useState<string | null>(null);
  // "drop" = user-dropped screenshot (gets the toolbar-crop hack); "live" = our
  // own captured profile/heatmap (plain contain-fit, nothing to crop).
  const [imgKind, setImgKind] = useState<"drop" | "live" | null>(null);
  // Button-triggered live render: pull /api/gex and mount the ported dashboard
  // GexChart (kind="chart") / Heatmap (kind="heat") straight into the card's
  // image slot, so html2canvas bakes the live visual into the exported PNG.
  const [live, setLive] = useState<{ chain: ChainRow[]; spot: number; flip: number | null } | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const loadLive = useCallback(async () => {
    setLiveLoading(true);
    try {
      // Ticker-aware sibling of /api/gex — SPX still resolves to the live
      // in-memory feed server-side, any other root is pulled off the chain.
      const res = await fetch(`/api/social-media/gex-chain?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`gex ${res.status}`);
      const d = await res.json();
      const chain = (Array.isArray(d.chain) ? d.chain : []) as ChainRow[];
      setLive({ chain, spot: Number(d.spotPrice ?? 0), flip: d.gexFlip ?? null });
      setImg(null); setImgKind("live");
    } catch (e) {
      console.error("[gex-card live]", e);
    } finally { setLiveLoading(false); }
  }, [ticker]);
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
  const labels = kind === "chart" ? chartLabels(ticker) : HEAT_LABELS;

  // Only lock out future re-seeds from `form` if the value actually changed —
  // a stray click-then-blur on a contentEditable pill (no typing) must not
  // permanently freeze this card away from live Daily-Input/GEX updates.
  const setField = (k: keyof CardFields, v: string) => {
    setFields((f) => {
      if (f[k] === v) return f;
      touchedRef.current = true;
      return { ...f, [k]: v };
    });
  };

  // Render the card node to a PNG blob at its true export size (transform reset
  // so capture is always at true pixels). Shared by Download / Copy / Share-to-X.
  const renderBlob = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current; if (!node) return null;
    const prev = node.style.transform; node.style.transform = "none";
    const html2canvas = await getHtml2Canvas();
    const canvas = await html2canvas(node, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false, width: dims.w, height: dims.h });
    node.style.transform = prev;
    return await new Promise((r) => canvas.toBlob((b: Blob | null) => r(b), "image/png"));
  }, [dims.w, dims.h]);

  // Levels come from dashboard state (the form). The dropped image is just a
  // visual backdrop for the card — no OCR.
  const loadFile = useCallback((file: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const rd = new FileReader();
    rd.onload = (e) => { setImg(String(e.target?.result || "")); setImgKind("drop"); };
    rd.readAsDataURL(file);
  }, []);

  // ── Live profile / heatmap capture ─────────────────────────────────────────
  // STUBBED: the original pulled /api/gex and rendered the mounted GexChart /
  // GexHeatmap into an off-screen host, capturing the live visual into the card.
  // That relies on the dashboard chart components (heavy live-chart stack), so
  // in this standalone app the live-capture button is disabled and the card is
  // built from a dropped/pasted screenshot instead (drag or click the slot).

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
    const text = `Todays $${ticker} Levels\nprovided by https://www.cbedge.net/`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }, [onCopy, ticker]);

  const onPick = () => {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => { if (inp.files?.[0]) loadFile(inp.files[0]); };
    inp.click();
  };

  return (
    <div className="gx-cardwrap">
      <div className="gx-caprow" style={{ width: dims.w }}>
        <div className="gx-caplabel">{kind === "chart" ? "NET GEX chart" : "GEX heatmap"} · {dims.w} × {dims.h}</div>
        <button
          type="button"
          className="gx-btn load"
          onClick={loadLive}
          disabled={liveLoading}
          title={`Render the live ${ticker} GEX profile / heatmap into the card.`}
        >
          {liveLoading ? "Loading…" : live ? "↻ Refresh live" : kind === "chart" ? "⤓ Live GEX profile" : "⤓ Live heatmap"}
        </button>
      </div>
      <div ref={cardRef} className={`gx-card ${regimeNeg ? "neg" : "pos"}${kind === "heat" ? " vertical" : ""}`}>
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
        <div className={`gx-imgwrap${imgKind === "live" ? " live" : ""}`} onClick={img || live ? undefined : onPick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) { setLive(null); loadFile(e.dataTransfer.files[0]); } }}>
          {live
            ? (kind === "chart"
                ? <GexChart chain={live.chain} spotPrice={live.spot} flipPoint={live.flip} transparentBg />
                : <Heatmap chain={live.chain} spot={live.spot} intensity={1} />)
            : img && <img src={img} alt="capture" crossOrigin="anonymous" />}
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

      {/* Live GexChart / Heatmap now render directly in the image slot above
          (button-triggered via "Live GEX profile" / "Live heatmap"); html2canvas
          bakes them into the exported card PNG. */}

      <div className="gx-actions">
        <button type="button" className="gx-btn copy" onClick={onCopy} disabled={busy}>
          {share === "copied" ? "✓ Copied" : share === "saved" ? "✓ Saved" : share === "err" ? "Failed" : "Copy card"}
        </button>
        <button type="button" className="gx-btn x" onClick={onShareX} disabled={busy}>Copy &amp; Open X</button>
        <button type="button" className="gx-dl" onClick={onExport} disabled={busy}>{busy ? "Rendering…" : "Download (PNG)"}</button>
      </div>

      <TweetMockup
        title={kind === "chart" ? "Tweet preview — NET GEX chart" : "Tweet preview — GEX heatmap"}
        getBlob={renderBlob}
        caption={`Todays $${ticker} Levels\nprovided by https://www.cbedge.net/`}
        refreshKey={`${ticker}-${img ?? ""}`}
      />
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
  .xp-dte button { font-family:var(--sm-mono); font-size: 12px; font-weight:700; letter-spacing:.04em; cursor:pointer; padding:6px 13px; border-radius:5px; border:1px solid transparent; background:transparent; color:var(--sm-muted); transition:.12s; }
  .xp-dte button:hover { color:var(--text1); }
  .xp-dte button.on { background:var(--cyan); color:#05060a; border-color:var(--cyan); box-shadow:0 0 12px rgba(33,158,188,.35); }
  .xp-candle-btn { display:inline-flex; align-items:center; gap:7px; font-family:var(--sm-mono); font-size: 12px; font-weight:700; letter-spacing:.04em; cursor:pointer; padding:7px 13px; border-radius:6px; border:1px solid var(--sm-border); background:var(--bg3); color:var(--text1); transition:.12s; }
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

  /* ════ 3-PANEL "GEX READ + TRADE PLAN" DESIGN ════ */
  .xp-card { background: linear-gradient(180deg,#0a0d12 0%,#070a0e 100%);
    border:1px solid rgba(255,255,255,.08); border-radius:14px; padding:18px 20px; }

  /* title bar */
  .xp-titlebar { display:flex; align-items:center; justify-content:center; gap:14px; margin-bottom:16px; }
  .xp-title { font-size:30px; font-weight:900; letter-spacing:.01em; color:#fff; text-transform:uppercase; }
  .xp-title .cy { color:var(--cyan); }
  .xp-chip { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; padding:8px 16px; border:1px solid rgba(255,255,255,.18); border-radius:8px; background:rgba(255,255,255,.02); }
  .xp-chip .lbl { font-size:10px; font-weight:700; letter-spacing:.08em; color:#cfd6df; }
  .xp-chip .val { font-size: 17px; font-weight:900; color:#fff; }
  .xp-chip.amber { border-color:rgba(249,158,11,.6); } .xp-chip.amber .val { color:var(--amber); }
  .xp-chip.cyan { border-color:rgba(33,158,188,.5); } .xp-chip.cyan .val { color:var(--cyan); }
  /* single-line chip (UPDATE): html2canvas ignores flex justify-content, so
     center the lone line with line-height instead of relying on flex. */
  .xp-chip.solo { display:block; text-align:center; line-height:32px; font-size: 14px; font-weight:700; color:#cfd6df; }

  /* 3-column grid. Columns stretch to the SAME height (the matrix sets it), so
     loading the Behavior block scrolls inside the rail instead of growing the
     row and pushing the CB Edge footer down. */
  .xp-grid3 { display:grid; grid-template-columns:1.1fr .85fr 1fr; gap:16px; align-items:stretch; }
  @media (max-width: 1000px){ .xp-grid3 { grid-template-columns:1fr; } .xp-rail { overflow:visible; } }
  .xp-rail { display:flex; flex-direction:column; gap:16px; min-height:0; overflow-y:auto; }

  /* zone cards — boxed annotations styled like the Key Levels boxes, evenly
     spaced down the middle column. */
  .xp-zonecards { display:flex; flex-direction:column; justify-content:space-around; gap:14px; height:100%; padding-top:34px; }
  .xp-zonecard { border:1.5px solid; border-radius:8px; padding:11px 13px; text-align:center; }
  .xp-zonecard .zlabel { font-size:12px; font-weight:900; letter-spacing:.04em; color:currentColor; line-height:1.2; }
  .xp-zonecard .zrange { font-size: 17px; font-weight:900; color:#fff; margin:5px 0 4px; }
  .xp-zonecard .zdesc { font-size:10px; font-weight:600; color:#c7ced8; line-height:1.35; }
  .xp-zonecard.c-green { border-color:rgba(16,185,129,.55); color:var(--sm-green); }
  .xp-zonecard.c-amber { border-color:rgba(249,158,11,.6); color:var(--amber); }
  .xp-zonecard.c-red { border-color:rgba(239,68,68,.55); color:var(--sm-red); }
  .xp-panel { background:rgba(255,255,255,.015); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:12px 14px; }
  .xp-panel-h { display:flex; align-items:center; font-size: 14px; font-weight:800; letter-spacing:.08em; color:#fff; text-align:center; justify-content:center; margin-bottom:10px; }
  .xp-keylevels .xp-panel-h, .xp-tradeplan .xp-panel-h { font-size: 14px; }

  /* PANEL 1 — GEX matrix */
  .xp-mx-head { box-sizing:border-box; display:flex; justify-content:space-between; align-items:flex-end; font-size: 10px; font-weight:700; letter-spacing:.06em; color:#9aa4b2; height:18px; padding:0 4px 4px; }
  .xp-mx-row { box-sizing:border-box; position:relative; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:0 8px; height:22px; border-radius:3px; margin-bottom:1px; font-family:var(--sm-mono); }
  .xp-mx-row .k { font-size:10px; font-weight:700; color:#dfe7f0; }
  .xp-mx-row .v { font-size:10px; font-weight:800; color:#fff; }
  .xp-mx-row.node .k, .xp-mx-row.node .v { color:#1a1205; }
  .xp-mx-row .b { position:absolute; left:46px; font-size: 10px; font-weight:900; padding:0 4px; border-radius:3px; }
  .xp-mx-row .b.g { color:#0a0d12; background:var(--sm-green); }
  .xp-mx-row .b.r { color:#0a0d12; background:var(--sm-red); }
  .xp-matrix-foot { margin-top:8px; text-align:center; font-size: 12px; font-weight:800; letter-spacing:.04em; color:var(--cyan); }

  /* PANEL 2 — GEX profile bars */
  .xp-pf-row { box-sizing:border-box; display:grid; grid-template-columns:34px 1fr; align-items:center; gap:6px; height:22px; margin-bottom:1px; }
  .xp-pf-row .k { font-family:var(--sm-mono); font-size:10px; font-weight:700; color:#dfe7f0; background:rgba(255,255,255,.05); border-radius:3px; text-align:center; padding:1px 0; }
  .xp-pf-row .track { position:relative; height:11px; }
  .xp-pf-row .track i { position:absolute; left:0; top:0; height:11px; border-radius:0 6px 6px 0; display:block; }
  .xp-pf-row .track i.pos { background:rgb(41,182,246); }
  .xp-pf-row .track i.neg { background:rgb(255,71,87); }
  .xp-pf-row .track i.node { background:var(--amber); box-shadow:0 0 8px rgba(249,158,11,.6); }
  .xp-pf-row .pf-tag { position:absolute; right:4px; top:50%; transform:translateY(-50%); font-size: 10px; font-weight:900; letter-spacing:.02em; white-space:nowrap; }
  .pf-tag.c-green { color:var(--sm-green); } .pf-tag.c-red { color:var(--sm-red); } .pf-tag.c-amber { color:var(--amber); }

  /* PANEL 3 — right rail */
  .xp-kl { display:flex; align-items:center; justify-content:space-between; gap:10px; border:1.5px solid; border-radius:8px; padding:11px 15px; margin-bottom:10px; }
  .xp-kl .lbl { font-size: 14px; font-weight:800; letter-spacing:.04em; }
  .xp-kl .v { font-size:22px; font-weight:900; color:#fff; }
  .xp-kl.green { border-color:rgba(16,185,129,.55);} .xp-kl.green .lbl { color:var(--sm-green);}
  .xp-kl.amber { border-color:rgba(249,158,11,.6);} .xp-kl.amber .lbl { color:var(--amber);}
  .xp-kl.cyan { border-color:rgba(33,158,188,.5);} .xp-kl.cyan .lbl { color:var(--cyan);}
  .xp-kl.red { border-color:rgba(239,68,68,.55);} .xp-kl.red .lbl { color:var(--sm-red);}

  .xp-tradeplan .xp-panel-h { justify-content:space-between; }
  .xp-tp { border:1.5px solid; border-radius:8px; padding:12px 15px; margin-bottom:10px; }
  .xp-tp .tp-h { font-size:14px; font-weight:900; letter-spacing:.04em; margin-bottom:6px; }
  .xp-tp .tp-b { font-size: 14px; line-height:1.5; color:#e6ebf2; }
  .xp-tp.green { border-color:rgba(16,185,129,.5);} .xp-tp.green .tp-h { color:var(--sm-green);}
  .xp-tp.red { border-color:rgba(239,68,68,.5);} .xp-tp.red .tp-h { color:var(--sm-red);}
  .xp-tp.amber { border-color:rgba(249,158,11,.55);} .xp-tp.amber .tp-h { color:var(--amber);}

  /* pro insight footer */
  .xp-insight { display:flex; align-items:center; gap:20px; margin-top:18px; min-height:120px; border-top:1px solid rgba(255,255,255,.08); padding:26px 4px; }
  .xp-insight .tag { font-size:22px; font-weight:900; letter-spacing:.04em; color:var(--amber); white-space:nowrap; }
  .xp-insight .txt { font-size: 17px; color:#dfe7f0; line-height:1.5; }
  .xp-insight .txt b { color:var(--amber); }
  .xp-insight .txt .disc { display:block; margin-top:8px; font-size: 14px; color:#9aa4b2; letter-spacing:.04em; }
  .xp-insight .xp-logo { margin-left:auto; height:54px; width:auto; object-fit:contain; flex:0 0 auto; filter:drop-shadow(0 4px 16px rgba(33,158,188,.25)); }

  .xp-gen-btn { font-family:var(--sm-mono); font-size:10px; font-weight:700; letter-spacing:.03em; cursor:pointer; padding:4px 9px; border-radius:5px; border:1px solid var(--cyan); background:transparent; color:var(--cyan); transition:.12s; }
  .xp-gen-btn:hover { background:var(--cyan); color:#05060a; }
  .xp-gen-btn:disabled { opacity:.5; cursor:default; }

  /* candle canvas styles retained (overlay logic still present though hidden) */
  .xp-candles { position:absolute; top:0; z-index:0; opacity:.7; }
`;

function ExplainerMockup({
  form, regime, updated, ladder, dte, onDteChange, gexBasis, onBasisChange, ticker,
}: {
  form: FormState; regime: Regime; updated: string; ladder: GexLadderRow[];
  dte: 0 | 1; onDteChange: (d: 0 | 1) => void;
  gexBasis: "oivol" | "vol"; onBasisChange: (b: "oivol" | "vol") => void;
  ticker: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState<"" | "copied" | "saved" | "err">("");
  const [shot, setShot] = useState<"" | "copied" | "saved" | "err">("");

  // AI-generated trigger map (Anthropic). Null = use the hardcoded fallback copy.
  type AiCase = { odds: number; desc: string };
  type AiMap = { bull: AiCase; base: AiCase; bear: AiCase };
  // Persisted to localStorage so a generated plan survives reloads/sessions and
  // stays until the next time it's generated.
  const AI_MAP_KEY = "cb-edge-trade-plan-v1";
  const [aiMap, setAiMap] = useState<AiMap | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(AI_MAP_KEY);
      const v = raw ? (JSON.parse(raw) as AiMap) : null;
      return v?.bull && v?.base && v?.bear ? v : null;
    } catch { return null; }
  });
  const [aiState, setAiState] = useState<"idle" | "busy" | "err">("idle");

  // Ladder-derived levels, mirrored into a ref so genTriggerMap (declared above
  // the levelStrikes useMemo) can send the SAME numbers the panels display.
  const levelsRef = useRef<{ resistance: number | null; support: number | null; pivot: number | null; node: number | null }>({
    resistance: null, support: null, pivot: null, node: null,
  });
  const genTriggerMap = useCallback(async () => {
    setAiState("busy");
    try {
      const lv = levelsRef.current;
      const body = {
        ticker,
        spxSpot: toNum(form.spot), gammaFlip: lv.pivot ?? toNum(form.flip),
        callWall: lv.resistance ?? toNum(form.call), putWall: lv.support ?? toNum(form.put),
        controlNode: lv.node,
        expectedMove: toNum(form.em),
        emUpper: emBand(form)?.upper ?? null, emLower: emBand(form)?.lower ?? null,
        netGex: form.gex, gammaRegime: regime.label, bias: form.bias,
        date: new Date().toLocaleDateString("en-US"),
      };
      const r = await fetch("/api/social-media/trigger-map", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`trigger-map ${r.status}`);
      const json = await r.json();
      const data = (json?.data ?? json) as AiMap;
      if (data?.bull && data?.base && data?.bear) {
        setAiMap(data);
        try { window.localStorage.setItem(AI_MAP_KEY, JSON.stringify(data)); } catch { /* storage full/blocked */ }
        setAiState("idle");
      }
      else throw new Error("bad shape");
    } catch {
      setAiState("err");
      setTimeout(() => setAiState("idle"), 2000);
    }
  }, [form, regime.label, ticker]);

  // Live SPX candle overlay removed — it depended on the ES-candle WebSocket
  // stream (useEsCandles) and was never rendered in the exported card anyway.
  // Only the scalar levels the panels read are kept.
  const spot = toNum(form.spot);
  const flip = toNum(form.flip);

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
  // Color/length scaling uses the heatmap's robustMax (95th-percentile of |gex|)
  // so one giant strike doesn't wash out the rest — identical to the home heatmap.
  const scaleMax = useMemo(() => {
    const abs = ladderRows.map((r) => Math.abs(r.gx)).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!abs.length) return 1;
    const idx = Math.min(abs.length - 1, Math.floor(abs.length * 0.95));
    return Math.max(1, abs[idx]);
  }, [ladderRows]);
  const renderBlob = useCallback(async (): Promise<Blob | null> => {
    const node = cardRef.current; if (!node) return null;
    const html2canvas = await getHtml2Canvas();
    const canvas = await html2canvas(node, {
      backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false,
      // Skip UI-only controls (e.g. the AI Generate button) in the export.
      ignoreElements: (el: Element) => el.classList?.contains("xp-noexport"),
    });
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
      const canvas = await html2canvas(node, {
        backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false,
        ignoreElements: (el: Element) => el.classList?.contains("xp-noexport"),
      });
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

  // ── Derived values for the GEX Matrix / Profile panels ──────────────────────
  // Net GEX per strike is in $millions (gx). Format as $K like the reference.
  const gexK = (mm: number) => {
    const k = mm * 1000; // $millions → $thousands
    const s = k < 0 ? "-" : "";
    return `${s}$${Math.abs(Math.round(k)).toLocaleString("en-US")}K`;
  };
  // Control node = the strike carrying the peak |net GEX| (largest magnet).
  const controlNode = useMemo(() => {
    if (!ladderRows.length) return null;
    return ladderRows.reduce((b, r) => (Math.abs(r.gx) > Math.abs(b.gx) ? r : b), ladderRows[0]);
  }, [ladderRows]);

  // ── Levels derived FROM THE LADDER so they always have a matrix/profile row ──
  // On this page the Key Levels, matrix badges, and profile tags all read these,
  // not the feed's separate callWall/putWall — guaranteeing they line up exactly.
  //   resistance = strongest +GEX strike  ·  support = strongest −GEX strike
  //   pivot = the gamma-flip strike nearest the control node (sign change)
  const levelStrikes = useMemo(() => {
    if (!ladderRows.length) return { resistance: null as number | null, support: null as number | null, pivot: null as number | null };
    let resistance: number | null = null, resMag = 0;
    let support: number | null = null, supMag = 0;
    for (const r of ladderRows) {
      if (r.gx > resMag) { resMag = r.gx; resistance = r.k; }
      if (r.gx < supMag) { supMag = r.gx; support = r.k; }
    }
    // Pivot: strike just above the sign change closest to the control node.
    const sorted = [...ladderRows].sort((a, b) => a.k - b.k);
    let pivot: number | null = null;
    const anchor = controlNode?.k ?? sorted[Math.floor(sorted.length / 2)].k;
    let bestDist = Infinity;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i].gx, b = sorted[i + 1].gx;
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
        const cross = Math.abs(a) + Math.abs(b) > 0
          ? sorted[i].k + (sorted[i + 1].k - sorted[i].k) * (Math.abs(a) / (Math.abs(a) + Math.abs(b)))
          : sorted[i + 1].k;
        const d = Math.abs(cross - anchor);
        if (d < bestDist) { bestDist = d; pivot = Math.round(cross); }
      }
    }
    return { resistance, support, pivot };
  }, [ladderRows, controlNode]);
  // Mirror the ladder-derived levels into the ref genTriggerMap reads.
  levelsRef.current = {
    resistance: levelStrikes.resistance,
    support: levelStrikes.support,
    pivot: levelStrikes.pivot,
    node: controlNode?.k ?? null,
  };

  // Total net GEX across the visible ladder, in $K.
  const totalNetK = useMemo(
    () => ladderRows.reduce((s, r) => s + r.gx, 0) * 1000,
    [ladderRows],
  );
  const totalNetStr = `${totalNetK >= 0 ? "+" : "-"}$${Math.abs(Math.round(totalNetK)).toLocaleString("en-US")}K`;
  // Top-3 strikes by |gex| → rank map, matching the home heatmap's rank tiers.
  const rankByStrike = useMemo(() => {
    const m = new Map<number, number>();
    [...ladderRows].sort((a, b) => Math.abs(b.gx) - Math.abs(a.gx)).slice(0, 3).forEach((r, i) => m.set(r.k, i + 1));
    return m;
  }, [ladderRows]);
  // EXACT home-heatmap cell color (components/dashboard/GexHeatmap cellBg):
  //   pos = rgba(41,182,246), neg = rgba(255,71,87); rank1/2/3 → .90/.45/.25;
  //   else alpha = min(.18, .02 + ((|n|/robustMax)*intensity)^1.4 * .16), intensity 1.4.
  const HEAT_INTENSITY = 1.4;
  const heatBg = (gx: number, k: number): string => {
    if (!gx) return "transparent";
    const pos = gx >= 0;
    const rank = rankByStrike.get(k) ?? 0;
    if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
    if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
    if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
    const ratio = Math.min(Math.abs(gx) / scaleMax, 1);
    const eased = Math.pow(ratio * HEAT_INTENSITY, 1.4);
    const alpha = Math.min(0.18, 0.02 + eased * 0.16);
    return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
  };
  const snapDate = new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" });

  return (
    <div className="xp-wrap" ref={wrapRef}>
      <style>{XP_CSS}</style>
      <div className="xp-actions" ref={actionsRef}>
        <span className="xp-dte" role="group" aria-label="DTE">
          <button type="button" className={dte === 0 ? "on" : ""} onClick={() => onDteChange(0)}>0DTE</button>
          <button type="button" className={dte === 1 ? "on" : ""} onClick={() => onDteChange(1)}>1DTE</button>
        </span>
        <span className="xp-dte" role="group" aria-label="GEX basis">
          <button type="button" className={gexBasis === "oivol" ? "on" : ""} onClick={() => onBasisChange("oivol")}>OI + VOL</button>
          <button type="button" className={gexBasis === "vol" ? "on" : ""} onClick={() => onBasisChange("vol")}>VOL GEX</button>
        </span>
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
        {/* ── title bar ── */}
        <div className="xp-titlebar">
          <div className="xp-title">CB EDGE <span className="cy">GEX PLAN</span></div>
          <div className="xp-chip solo">UPDATE: {updated || snapDate}</div>
          <div className="xp-chip amber">
            <span className="lbl">CONTROL NODE</span>
            <span className="val">{controlNode ? controlNode.k : "—"}</span>
          </div>
          <div className="xp-chip cyan">
            <span className="lbl">TOTAL NET GEX</span>
            <span className="val">{totalNetStr}</span>
          </div>
          <div className="xp-chip">
            <span className="lbl">GEX BASIS</span>
            <span className="val">{gexBasis === "vol" ? "VOL GEX" : "OI + VOL"}</span>
          </div>
        </div>

        <div className="xp-grid3">
          {/* ── PANEL 1: GEX Matrix (strike + net GEX, color-graded) ── */}
          <div className="xp-panel">
            <div className="xp-panel-h">GEX MATRIX (STRIKE)</div>
            <div className="xp-matrix">
              <div className="xp-mx-head"><span>STRIKE</span><span>NET GEX</span></div>
              {ladderRows.map((r) => {
                const pos = r.gx >= 0;
                const isNode = controlNode && r.k === controlNode.k;
                // Exact home-heatmap gradient; control node keeps the amber magnet tint.
                const bg = isNode ? "rgba(249,158,11,.92)" : heatBg(r.gx, r.k);
                const badge =
                  r.k === levelStrikes.resistance ? "CW"
                  : r.k === levelStrikes.support ? "PW"
                  : r.k === levelStrikes.pivot ? "FLIP" : null;
                return (
                  <div key={r.k} className={`xp-mx-row${isNode ? " node" : ""}`} style={{ background: bg }}>
                    <span className="k">{r.k}</span>
                    {badge && <span className={`b ${pos ? "g" : "r"}`}>{badge}</span>}
                    <span className="v">{gexK(r.gx)}</span>
                  </div>
                );
              })}
            </div>
            <div className="xp-matrix-foot">TOTAL NET GEX: {totalNetStr}</div>
          </div>

          {/* ── PANEL 2: GEX Profile (horizontal net-GEX bars) ── */}
          <div className="xp-panel">
            <div className="xp-panel-h">GEX PROFILE</div>
            <div className="xp-profile">
              {/* spacer matching the matrix's STRIKE/NET GEX header so rows align */}
              <div className="xp-mx-head" aria-hidden="true"><span>&nbsp;</span></div>
              {ladderRows.map((r) => {
                const pos = r.gx >= 0;
                const w = Math.min(100, (Math.abs(r.gx) / scaleMax) * 100);
                const isNode = controlNode && r.k === controlNode.k;
                const badge =
                  r.k === levelStrikes.resistance ? { t: "CW", c: "c-green" }
                  : r.k === levelStrikes.support ? { t: "PW", c: "c-red" }
                  : r.k === levelStrikes.pivot ? { t: "FLIP", c: "c-amber" }
                  : null;
                return (
                  <div key={r.k} className="xp-pf-row">
                    <span className="k">{r.k}</span>
                    <span className="track">
                      <i className={isNode ? "node" : pos ? "pos" : "neg"} style={{ width: `${Math.max(2, w)}%` }} />
                      {badge && <span className={`pf-tag ${badge.c}`}>{badge.t}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── PANEL 3: right rail — key levels + trade plan ── */}
          <div className="xp-rail">
            <div className="xp-panel xp-keylevels">
              <div className="xp-panel-h">KEY LEVELS</div>
              <div className="xp-kl green"><span className="lbl">RESISTANCE</span><span className="v">{levelStrikes.resistance ?? "—"}</span></div>
              <div className="xp-kl amber"><span className="lbl">CONTROL NODE (MAGNET)</span><span className="v">{controlNode ? controlNode.k : "—"}</span></div>
              <div className="xp-kl cyan"><span className="lbl">GAMMA FLIP / PIVOT</span><span className="v">{levelStrikes.pivot ?? "—"}</span></div>
              <div className="xp-kl red"><span className="lbl">SUPPORT</span><span className="v">{levelStrikes.support ?? "—"}</span></div>
            </div>

            <div className="xp-panel xp-tradeplan">
              <div className="xp-panel-h">
                TRADE PLAN
                <button
                  type="button"
                  className="xp-gen-btn xp-noexport"
                  onClick={genTriggerMap}
                  disabled={aiState === "busy"}
                  title="Generate the trade plan with AI from the current levels"
                >
                  {aiState === "busy" ? "Generating…" : aiState === "err" ? "Failed — retry" : aiMap ? "↻ Regenerate" : "✨ Generate"}
                </button>
              </div>
              <div className="xp-tp green">
                <div className="tp-h">▲ BULL CASE {aiMap ? `· ${aiMap.bull.odds}%` : ""}</div>
                <div className="tp-b">{aiMap ? aiMap.bull.desc : <>Holds above {levelStrikes.pivot ?? controlNode?.k ?? "—"} → grind toward {levelStrikes.resistance ?? "—"}; buy dips near the control node.</>}</div>
              </div>
              <div className="xp-tp red">
                <div className="tp-h">▼ BEAR CASE {aiMap ? `· ${aiMap.bear.odds}%` : ""}</div>
                <div className="tp-b">{aiMap ? aiMap.bear.desc : <>Loses {levelStrikes.pivot ?? controlNode?.k ?? "—"} → dealers flip short gamma, momentum unlocks toward {levelStrikes.support ?? "—"}.</>}</div>
              </div>
              <div className="xp-tp amber">
                <div className="tp-h">→ CHOP ZONE {aiMap ? `· ${aiMap.base.odds}%` : ""}</div>
                <div className="tp-b">{aiMap ? aiMap.base.desc : (regime.neg ? "Two-sided trend day — wait for a clean break before committing size." : <>Range {levelStrikes.support ?? "—"}–{levelStrikes.resistance ?? "—"}: two-way action, fake breakouts, scalp the edges.</>)}</div>
              </div>
            </div>

          </div>
        </div>

        {/* ── pro insight footer ── */}
        <div className="xp-insight">
          <span className="tag">CB Edge :</span>
          <span className="txt">
            The <b>{controlNode ? controlNode.k : "control"}</b> node is dominant control — price gravitates there unless a catalyst breaks it.
            {Number.isFinite(flip) ? <> The bigger move only comes if <b>{f(flip)}</b> fails.</> : null}
            <span className="disc">Not financial advice · educational only.</span>
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="xp-logo" src="/cb-edge-logo.png" alt="CB Edge" crossOrigin="anonymous" />
        </div>
      </div>

      <TweetMockup
        title="Tweet preview — GEX read + trade plan"
        getBlob={renderBlob}
        caption={`Todays $${ticker} GEX read + trade plan\nprovided by https://www.cbedge.net/`}
        refreshKey={`${updated}-${controlNode ? controlNode.k : ""}-${aiMap ? "ai" : "static"}`}
      />
    </div>
  );
}

const STORED_POSTS_KEY = "cb-edge-generated-posts-v1";

interface GeneratedPost {
  id: string;
  ts: string;
  tweet: string;
}

function PostGenerator({ form, ticker }: { form: FormState; ticker: string }) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string>("");
  const [posts, setPosts] = useState<GeneratedPost[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORED_POSTS_KEY);
      return raw ? (JSON.parse(raw) as GeneratedPost[]) : [];
    } catch { return []; }
  });

  const savePosts = (next: GeneratedPost[]) => {
    setPosts(next);
    try { window.localStorage.setItem(STORED_POSTS_KEY, JSON.stringify(next)); } catch { /* storage full */ }
  };

  // Live GEX profile for the snapshot. Pulled from /api/gex (same source the
  // dashboard SnapButton uses) and rendered into an off-card GexChart canvas so
  // each post can attach the actual profile image.
  const [gexChain, setGexChain] = useState<unknown[]>([]);
  // Spot + flip captured with the chain so the ported GexChart can draw the
  // spot line and gamma-flip marker (mirrors the dashboard render).
  const [gexSpot, setGexSpot] = useState(0);
  const [gexFlip, setGexFlip] = useState<number | null>(null);
  const [gexLoading, setGexLoading] = useState(false);
  const [snapState, setSnapState] = useState<"" | "saved" | "copied" | "err">("");
  const chartCaptureRef = useRef<HTMLDivElement>(null);
  // Same corner-picker logic as Screenshot Brander — move the CB Edge logo /
  // cbedge.net CTA to any corner of the profile image before copy/download.
  const [logoCorner, setLogoCorner] = useState<BrCorner>("tl");
  const [ctaCorner, setCtaCorner] = useState<BrCorner>("br");

  const loadGex = useCallback(async () => {
    setGexLoading(true);
    try {
      const res = await fetch(`/api/social-media/gex-chain?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`gex ${res.status}`);
      const data = await res.json();
      setGexChain(Array.isArray(data.chain) ? data.chain : []);
      setGexSpot(Number(data.spotPrice ?? 0));
      setGexFlip(data.gexFlip ?? null);
    } catch (e) {
      console.error("[post-gen gex]", e);
    } finally {
      setGexLoading(false);
    }
  }, [ticker]);

  // Draw the mounted GexChart's raw canvas onto an offscreen canvas at native
  // size, then stamp the logo/CTA via the SAME drawBrandStamp function
  // Screenshot Brander uses — so "add/move my logo" behaves identically here.
  const renderBrandedBlob = useCallback(async (): Promise<Blob | null> => {
    const host = chartCaptureRef.current;
    const raw = host?.querySelector<HTMLCanvasElement>("canvas");
    if (!raw) return null;
    const out = document.createElement("canvas");
    out.width = raw.width; out.height = raw.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(raw, 0, 0);
    drawBrandStamp(ctx, out.width, out.height, logoCorner, ctaCorner);
    return await new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
  }, [logoCorner, ctaCorner]);

  // Copy/download the branded profile PNG.
  const snapProfile = useCallback(async (action: "copy" | "download") => {
    const blob = await renderBrandedBlob();
    if (!blob) { setSnapState("err"); setTimeout(() => setSnapState(""), 1800); return; }
    if (action === "copy") {
      try {
        const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
        if (ClipItem && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipItem({ "image/png": blob })]);
          setSnapState("copied"); setTimeout(() => setSnapState(""), 1800); return;
        }
      } catch { /* fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `cb-edge-gex-profile-${todayETStr()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setSnapState("saved"); setTimeout(() => setSnapState(""), 1800);
  }, [renderBrandedBlob]);

  const band = emBand(form);
  const regime = regimeOf(form);

  // Parse a form string field to a number (or null). The form stores everything
  // as strings; the /api/social-media/generate route expects numbers.
  const n = (v: string | undefined): number | null => {
    if (!v) return null;
    const parsed = Number(String(v).replace(/[, ]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/social-media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          spxSpot: n(form.spot),
          spxPrevClose: n(form.prevClose),
          gammaFlip: n(form.flip),
          callWall: n(form.call),
          putWall: n(form.put),
          expectedMove: n(form.em),
          emUpper: band ? band.upper : null,
          emLower: band ? band.lower : null,
          netGex: n(form.gex),
          gammaRegime: regime.label,
          bias: form.bias || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) {
        throw new Error(json.error || `request failed (${res.status})`);
      }
      const { xPost } = json.data as { xPost: string };

      const newPost: GeneratedPost = {
        id: Date.now().toString(),
        ts: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        tweet: xPost,
      };
      savePosts([newPost, ...posts.slice(0, 9)]); // keep last 10
    } catch (e) {
      setError("Generation failed — check data fields and try again.");
      console.error("[post-gen]", e);
    } finally {
      setGenerating(false);
    }
  };

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    });
  };

  const deletePost = (id: string) => savePosts(posts.filter((p) => p.id !== id));

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <style>{`
        .pg-wrap { display: flex; flex-direction: column; gap: 20px; }
        .pg-controls { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
        .pg-type-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .pg-type-label { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); }
        .pg-type-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 14px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--sm-muted); transition: all 0.12s; }
        .pg-type-btn:hover { color: var(--text1); border-color: var(--cyan); }
        .pg-type-btn.on { background: var(--cyan); color: #05060a; border-color: var(--cyan); box-shadow: 0 0 12px rgba(33,158,188,0.35); }
        .pg-corner-row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
        .pg-corner-row label { font-size: 12px; color: var(--sm-muted); display: flex; gap: 7px; align-items: center; }
        .pg-corner-row select { font-family: var(--sm-mono); font-size: 12px; padding: 6px 9px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg0); color: var(--text1); cursor: pointer; }
        .pg-hint { font-size: 12px; color: var(--sm-muted); line-height: 1.5; }
        .pg-hint b { color: var(--text1); }
        .pg-missing { font-family: var(--sm-mono); font-size: 12px; color: var(--amber); }
        .pg-gen-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 11px 20px; border-radius: 6px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; transition: all 0.12s; align-self: flex-start; }
        .pg-gen-btn:hover { opacity: 0.9; }
        .pg-gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .pg-error { font-family: var(--sm-mono); font-size: 12px; color: var(--sm-red); padding: 10px 14px; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px; background: rgba(239,68,68,0.07); }

        .pg-post { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .pg-post-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); }
        .pg-post-type { font-family: var(--sm-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cyan); }
        .pg-post-ts { font-family: var(--sm-mono); font-size: 10px; color: var(--sm-muted); }
        .pg-post-del { margin-left: auto; font-family: var(--sm-mono); font-size: 10px; cursor: pointer; padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.4); background: transparent; color: var(--sm-red); transition: all 0.12s; }
        .pg-post-del:hover { background: rgba(239,68,68,0.1); }
        .pg-post-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
        .pg-tweet-block { background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 14px; }
        .pg-tweet-label { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
        .pg-tweet-text { font-size: 14px; color: var(--text1); line-height: 1.55; white-space: pre-wrap; }
        .pg-char-count { font-family: var(--sm-mono); font-size: 10px; color: var(--sm-muted); }
        .pg-copy-btn { font-family: var(--sm-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 4px 10px; border-radius: 4px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .pg-copy-btn:hover { border-color: var(--cyan); color: var(--cyan); }
        .pg-copy-btn.ok { border-color: var(--sm-green); color: var(--sm-green); }
        .pg-thread-label { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 8px; }
        .pg-thread-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--sm-border); border-radius: 6px; background: var(--bg0); margin-bottom: 6px; }
        .pg-thread-num { font-family: var(--sm-mono); font-size: 10px; font-weight: 700; color: var(--cyan); min-width: 18px; }
        .pg-thread-text { font-size: 14px; color: var(--text1); line-height: 1.5; white-space: pre-wrap; flex: 1; }
        .pg-open-x { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 8px 14px; border-radius: 5px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; transition: all 0.12s; text-decoration: none; display: inline-block; }
        .pg-open-x:hover { opacity: 0.9; }
        .pg-empty { text-align: center; padding: 40px 20px; font-size: 14px; color: var(--sm-muted); background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; }
        .pg-empty b { color: var(--text1); display: block; margin-bottom: 6px; font-size: 14px; }
      `}</style>

      <div className="pg-wrap">
        {/* Controls */}
        <div className="pg-controls">
          {/* Data status */}
          <div className="pg-hint">
            {!form.spot
              ? <span className="pg-missing">⚠ No data loaded — hit "Load data" first, then generate.</span>
              : <span>Using: <b>Spot {form.spot}</b> · Flip {form.flip || "—"} · Call {form.call || "—"} · Put {form.put || "—"} · EM ±{form.em || "—"} · GEX {form.gex || "—"}</span>
            }
          </div>

          <button type="button" className="pg-gen-btn" onClick={generate} disabled={generating || !form.spot}>
            {generating ? "Generating…" : "✨ Generate Post"}
          </button>

          {error && <div className="pg-error">{error}</div>}
        </div>

        {/* GEX profile snapshot — live chart pulled from /api/gex, captured to PNG */}
        <div className="pg-controls">
          <div className="pg-type-row" style={{ justifyContent: "space-between" }}>
            <span className="pg-type-label">GEX Profile · attach to your post</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="pg-type-btn" onClick={loadGex} disabled={gexLoading}>
                {gexLoading ? "Loading…" : gexChain.length ? "↻ Refresh" : "⤓ Load profile"}
              </button>
              <button type="button" className="pg-type-btn" onClick={() => snapProfile("copy")} disabled={!gexChain.length}>
                {snapState === "copied" ? "✓ Copied" : "Copy image"}
              </button>
              <button type="button" className="pg-type-btn on" onClick={() => snapProfile("download")} disabled={!gexChain.length}>
                {snapState === "saved" ? "✓ Saved" : snapState === "err" ? "Failed" : "Download PNG"}
              </button>
            </div>
          </div>
          {gexChain.length > 0 ? (
            <>
              <div className="pg-corner-row">
                <label>Logo corner
                  <select value={logoCorner} onChange={(e) => setLogoCorner(e.target.value as BrCorner)}>
                    {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </label>
                <label>cbedge.net corner
                  <select value={ctaCorner} onChange={(e) => setCtaCorner(e.target.value as BrCorner)}>
                    {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </label>
              </div>
              <div ref={chartCaptureRef} style={{ width: "100%", height: 360, background: "var(--bg0)", borderRadius: 8, overflow: "hidden", marginTop: 10 }}>
                <GexChart chain={gexChain as ChainRow[]} spotPrice={gexSpot} flipPoint={gexFlip} transparentBg />
              </div>
              <div style={{ marginTop: 14 }}>
                <TweetMockup
                  title="Tweet preview — GEX profile"
                  getBlob={renderBrandedBlob}
                  caption={`Todays $${ticker} GEX profile\nprovided by https://www.cbedge.net/`}
                  refreshKey={`${gexChain.length}-${logoCorner}-${ctaCorner}`}
                />
              </div>
            </>
          ) : (
            <div className="pg-hint">Hit <b>Load profile</b> to pull the live GEX profile, then Copy or Download the image to attach to your post.</div>
          )}
        </div>

        {/* Generated posts history */}
        {posts.length === 0 && !generating && (
          <div className="pg-empty">
            <b>No posts yet</b>
            Load your data and hit Generate.
          </div>
        )}

        {posts.map((post) => (
          <div key={post.id} className="pg-post">
            <div className="pg-post-head">
              <span className="pg-post-type">GEX Data</span>
              <span className="pg-post-ts">{post.ts}</span>
              <button type="button" className="pg-post-del" onClick={() => deletePost(post.id)}>✕</button>
            </div>
            <div className="pg-post-body">
              {/* Main tweet */}
              <div className="pg-tweet-block">
                <div className="pg-tweet-label">
                  <span>TWEET <span className="pg-char-count">({post.tweet.length}/280)</span></span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={`pg-copy-btn${copied === `t-${post.id}` ? " ok" : ""}`}
                      onClick={() => copyText(post.tweet, `t-${post.id}`)}
                    >
                      {copied === `t-${post.id}` ? "Copied ✓" : "Copy"}
                    </button>
                    <a
                      className="pg-open-x"
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.tweet)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open X
                    </a>
                  </div>
                </div>
                <div className="pg-tweet-text">{post.tweet}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Day Posts — the "posts throughout the day" workflow. Pick a slot (Premarket
 * Analysis / Midday Update / EOD Summary / Custom), hit Retrieve to pull a live
 * visual (Option Flow, GEX chart, Option Chain, Multi Greeks — the non-GEX ones
 * render the real page in a same-origin ?embed=1 iframe and get captured with
 * html2canvas; the GEX chart grabs the mounted GexChart canvas directly),
 * optionally stamp the CB Edge logo/CTA into a corner (same drawBrandStamp the
 * Brander uses), optionally attach a strike+expiration trade idea, then let
 * /api/social-media/day-post (Anthropic) write the CB Edge-promoting caption.
 * Caption is editable in the tweet mockup; Copy / Open X from there.
 * ════════════════════════════════════════════════════════════════════════════ */
const DP_CSS = `
  .dp-wrap { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; padding-bottom: 40px; }
  .dp-panel { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .dp-label { font-family: var(--sm-mono); font-size: 17px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); }
  .dp-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .dp-btn { font-family: var(--sm-mono); font-size: 14px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 14px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--sm-muted); transition: all 0.12s; }
  .dp-btn:hover { color: var(--text1); border-color: var(--cyan); }
  .dp-btn:disabled { opacity: 0.5; cursor: default; }
  .dp-btn.on { background: var(--cyan); color: #05060a; border-color: var(--cyan); box-shadow: 0 0 12px rgba(33,158,188,0.35); }
  .dp-btn.gen { border-color: var(--cyan); background: var(--cyan); color: #05060a; padding: 10px 18px; font-size: 14px; align-self: flex-start; }
  .dp-row label { font-size: 14px; color: var(--sm-muted); display: flex; gap: 7px; align-items: center; }
  .dp-row select, .dp-row input { font-family: var(--sm-mono); font-size: 14px; padding: 6px 9px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg0); color: var(--text1); }
  .dp-row input { width: 110px; }
  .dp-hint { font-size: 14px; color: var(--sm-muted); line-height: 1.5; }
  .dp-hint b { color: var(--text1); }
  .dp-err { font-family: var(--sm-mono); font-size: 14px; color: var(--sm-red); padding: 10px 14px; border: 1px solid rgba(239,68,68,0.4); border-radius: 6px; background: rgba(239,68,68,0.07); }
  .dp-notes { width: 100%; box-sizing: border-box; resize: vertical; min-height: 48px; font-family: inherit; font-size: 14px; line-height: 1.45; color: var(--text1); background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 8px 10px; }
  .dp-embed { position: relative; border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; background: var(--bg0); }
  .dp-chart-host { width: 100%; height: 360px; background: var(--bg0); border-radius: 8px; overflow: hidden; }
  .dp-cap { border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; background: var(--bg0); }
  .dp-cap img { display: block; width: 100%; height: auto; }
`;

type DaySlot = "premarket" | "midday" | "eod" | "custom";
const DAY_SLOTS: { v: DaySlot; label: string }[] = [
  { v: "premarket", label: "Premarket Analysis" },
  { v: "midday", label: "Midday Update" },
  { v: "eod", label: "EOD Summary" },
  { v: "custom", label: "Custom" },
];

type DayVisual = "gex" | "flow" | "chain" | "greeks" | "candles";
// Embed URLs are ticker-scoped where the target page understands a symbol
// (flow + option chain); /gex, /mult-greek and /es-candles are driven by their
// own pickers inside the iframe.
const dayVisuals = (ticker: string): { v: DayVisual; label: string; embed?: string }[] => [
  { v: "gex", label: "GEX Chart", embed: "/gex?embed=1&chartonly=1" },
  { v: "flow", label: `Option Flow (${ticker} 0DTE OTM)`, embed: `/flow?embed=1&chartonly=1&ticker=${encodeURIComponent(ticker)}&dteMax=0` },
  { v: "chain", label: "Option Chain", embed: `/options-chain?embed=1&symbol=${encodeURIComponent(ticker)}` },
  { v: "greeks", label: "Multi Greeks", embed: "/mult-greek?embed=1" },
  { v: "candles", label: "ES Candles", embed: "/es-candles?embed=1" },
];
// Iframe logical size — desktop layout, scaled down to fit the column.
const DP_EMB_W = 1280;
const DP_EMB_H = 800;

interface DayPost { id: string; ts: string; slot: DaySlot; tweet: string }
const DAY_POSTS_KEY = "cb-edge-day-posts";

function DayPosts({ form, ticker }: { form: FormState; ticker: string }) {
  const DAY_VISUALS = useMemo(() => dayVisuals(ticker), [ticker]);
  const [slot, setSlot] = useState<DaySlot>("premarket");
  const [visual, setVisual] = useState<DayVisual>("gex");
  const [notes, setNotes] = useState("");
  const [caption, setCaption] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // Branding — optional logo/CTA stamp, movable per corner.
  const [brandOn, setBrandOn] = useState(true);
  const [logoCorner, setLogoCorner] = useState<BrCorner>("tl");
  const [ctaCorner, setCtaCorner] = useState<BrCorner>("br");

  // Trade idea.
  const [ideaOn, setIdeaOn] = useState(false);
  const [ideaTicker, setIdeaTicker] = useState(ticker);
  const [ideaStrike, setIdeaStrike] = useState("");
  const [ideaRight, setIdeaRight] = useState<"C" | "P">("C");
  const [ideaExp, setIdeaExp] = useState("");
  const [ideaPrice, setIdeaPrice] = useState("");
  const [ideaNote, setIdeaNote] = useState("");
  const [priceLoading, setPriceLoading] = useState(false);

  // Live contract price via /api/watch?quote= (same /proxy/probe-rest pipeline
  // the Probe tab uses). parseContract normalizes "7/17" → ISO expiry.
  const fetchIdeaPrice = useCallback(async () => {
    const parsed = parseContract(`${ideaTicker} ${ideaStrike}${ideaRight} ${ideaExp}`);
    if (!parsed) { setError("Need ticker, strike and expiration to pull the price."); return; }
    setPriceLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/watch?quote=${encodeURIComponent(parsed.ticker)}&expiry=${encodeURIComponent(parsed.expiry)}` +
        `&side=${parsed.side}&strike=${encodeURIComponent(parsed.strike)}`,
        { cache: "no-store" },
      );
      const json = await res.json();
      const px = json?.mark ?? json?.last ?? null;
      if (!res.ok || !json?.found || px == null) throw new Error(json?.error || "contract not found");
      setIdeaPrice(Number(px).toFixed(2));
    } catch (e) {
      console.error("[day-posts price]", e);
      setError("Couldn't pull the contract price — check ticker/strike/exp.");
    } finally {
      setPriceLoading(false);
    }
  }, [ideaTicker, ideaStrike, ideaRight, ideaExp]);

  // Captured raw visual (unbranded) — frozen copy so live updates don't shift it.
  const rawRef = useRef<HTMLCanvasElement | null>(null);
  const [capturedAt, setCapturedAt] = useState(0);
  const [capUrl, setCapUrl] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  // GEX visual renders inline via the ported dashboard GexChart (the /gex
  // iframe embed does not exist in this standalone owner build). Captured by
  // grabbing the chart canvas directly in capture().
  const [gexLive, setGexLive] = useState<{ chain: ChainRow[]; spot: number; flip: number | null } | null>(null);
  const gexInlineRef = useRef<HTMLDivElement>(null);

  // GEX now renders via the same-origin /gex-embed iframe (see DAY_VISUALS), so
  // every visual — GEX included — captures through the shared iframe path below.
  // Iframe source (gex / flow / chain / greeks) — measured + scaled like GexDock.
  const [iframeOn, setIframeOn] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const embedBoxRef = useRef<HTMLDivElement>(null);
  const [embedW, setEmbedW] = useState(0);
  useEffect(() => {
    const el = embedBoxRef.current;
    if (!el) return;
    const measure = () => setEmbedW(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [iframeOn, visual, gexLive]);
  const embScale = embedW > 0 ? Math.min(1, embedW / DP_EMB_W) : 1;

  const visualDef = DAY_VISUALS.find((v) => v.v === visual)!;

  // Switching source resets the live view (keeps any frozen capture).
  useEffect(() => { setIframeOn(false); setGexLive(null); }, [visual]);

  const retrieve = useCallback(async () => {
    setError("");
    if (visual === "gex") {
      try {
        const res = await fetch(`/api/social-media/gex-chain?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`gex ${res.status}`);
        const d = await res.json();
        setGexLive({ chain: (Array.isArray(d.chain) ? d.chain : []) as ChainRow[], spot: Number(d.spotPrice ?? 0), flip: d.gexFlip ?? null });
        setIframeOn(false);
      } catch (e) { console.error("[day-posts gex]", e); setError("Couldn't load live GEX — try again."); }
      return;
    }
    setIframeOn(true);
  }, [visual, ticker]);

  // Freeze the current live view into rawRef.
  const capture = useCallback(async () => {
    setCapturing(true);
    setError("");
    try {
      if (visual === "gex") {
        const cvs = gexInlineRef.current?.querySelector<HTMLCanvasElement>("canvas");
        if (!cvs) throw new Error("hit Retrieve and let the GEX chart render first");
        const out = document.createElement("canvas");
        out.width = cvs.width; out.height = cvs.height;
        out.getContext("2d")!.drawImage(cvs, 0, 0);
        rawRef.current = out;
        setCapUrl(out.toDataURL("image/png"));
        setCapturedAt(Date.now());
        return;
      }
      const doc = iframeRef.current?.contentDocument;
      if (!doc?.body) throw new Error("view not loaded — hit Retrieve and wait for it to render");
      const html2canvas = await getHtml2Canvas();
      // Chart-only pages tag the exact node to grab (#flow-chart-capture);
      // otherwise fall back to the whole embed body.
      const target = doc.querySelector<HTMLElement>("#flow-chart-capture");
      const canvas = target
        ? await html2canvas(target, { backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false })
        : await html2canvas(doc.body, {
            backgroundColor: "#05060a", scale: 2, useCORS: true, logging: false,
            width: DP_EMB_W, height: DP_EMB_H, windowWidth: DP_EMB_W, windowHeight: DP_EMB_H,
          });
      rawRef.current = canvas;
      setCapUrl(rawRef.current ? rawRef.current.toDataURL("image/png") : null);
      setCapturedAt(Date.now());
    } catch (e) {
      console.error("[day-posts capture]", e);
      setError(String((e as Error)?.message || "capture failed"));
    } finally {
      setCapturing(false);
    }
  }, [visual]);

  // Branded blob for the tweet mockup — re-stamps corners on every render call.
  const renderBrandedBlob = useCallback(async (): Promise<Blob | null> => {
    const src = rawRef.current;
    if (!src) return null;
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    if (brandOn) drawBrandStamp(ctx, out.width, out.height, logoCorner, ctaCorner);
    return await new Promise((r) => out.toBlob((b) => r(b), "image/png"));
  }, [brandOn, logoCorner, ctaCorner]);

  const band = emBand(form);
  const regime = regimeOf(form);
  const n = (v: string | undefined): number | null => {
    if (!v) return null;
    const p = Number(String(v).replace(/[, ]/g, ""));
    return Number.isFinite(p) ? p : null;
  };

  const [posts, setPosts] = useState<DayPost[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(DAY_POSTS_KEY);
      return raw ? (JSON.parse(raw) as DayPost[]) : [];
    } catch { return []; }
  });
  const savePosts = (next: DayPost[]) => {
    setPosts(next);
    try { window.localStorage.setItem(DAY_POSTS_KEY, JSON.stringify(next)); } catch { /* full */ }
  };

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/social-media/day-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          slot,
          notes: notes || null,
          visual: rawRef.current ? visual : null,
          tradeIdea: ideaOn && (ideaStrike || ideaTicker) ? {
            ticker: ideaTicker || ticker, strike: ideaStrike || null,
            right: ideaRight, expiration: ideaExp || null,
            price: ideaPrice || null, note: ideaNote || null,
          } : null,
          spxSpot: n(form.spot),
          spxPrevClose: n(form.prevClose),
          gammaFlip: n(form.flip),
          callWall: n(form.call),
          putWall: n(form.put),
          expectedMove: n(form.em),
          emUpper: band ? band.upper : null,
          emLower: band ? band.lower : null,
          netGex: n(form.gex),
          gammaRegime: regime.label,
          bias: form.bias || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.data?.xPost) throw new Error(json.error || `request failed (${res.status})`);
      const tweet = json.data.xPost as string;
      setCaption(tweet);
      savePosts([{
        id: Date.now().toString(),
        ts: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
        slot, tweet,
      }, ...posts.slice(0, 9)]);
    } catch (e) {
      console.error("[day-posts gen]", e);
      setError("Generation failed — check data and try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="dp-wrap">
      <style>{DP_CSS}</style>

      {/* 1 · slot */}
      <div className="dp-panel">
        <span className="dp-label">1 · Post slot</span>
        <div className="dp-row">
          {DAY_SLOTS.map((s) => (
            <button key={s.v} type="button" className={`dp-btn${slot === s.v ? " on" : ""}`} onClick={() => setSlot(s.v)}>{s.label}</button>
          ))}
        </div>
        <div className="dp-hint">
          {!form.spot
            ? <span style={{ color: "var(--amber)" }}>⚠ No data loaded — hit "Load data" up top so the AI has real levels.</span>
            : <span>Using: <b>Spot {form.spot}</b> · Flip {form.flip || "—"} · Call {form.call || "—"} · Put {form.put || "—"} · EM ±{form.em || "—"} · GEX {form.gex || "—"}</span>}
        </div>
        <textarea className="dp-notes" placeholder="Optional notes / angle for the AI (e.g. 'focus on the failed breakout at the call wall')…" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {/* 2 · visual */}
      <div className="dp-panel">
        <span className="dp-label">2 · Visual · retrieve, then capture</span>
        <div className="dp-row">
          {DAY_VISUALS.map((v) => (
            <button key={v.v} type="button" className={`dp-btn${visual === v.v ? " on" : ""}`} onClick={() => setVisual(v.v)}>{v.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="dp-btn" onClick={retrieve}>⤓ Retrieve</button>
          <button type="button" className="dp-btn on" onClick={capture} disabled={capturing || (!iframeOn && !(visual === "gex" && gexLive))}>
            {capturing ? "Capturing…" : "📸 Capture"}
          </button>
        </div>

        {visual === "gex" && gexLive && (
          <div ref={embedBoxRef} className="dp-embed" style={{ height: DP_EMB_H * embScale, background: "#05060a" }}>
            <div ref={gexInlineRef} style={{ width: DP_EMB_W, height: DP_EMB_H, transform: `scale(${embScale})`, transformOrigin: "top left" }}>
              <GexChart chain={gexLive.chain} spotPrice={gexLive.spot} flipPoint={gexLive.flip} />
            </div>
          </div>
        )}
        {iframeOn && visual !== "gex" && (
          <div ref={embedBoxRef} className="dp-embed" style={{ height: DP_EMB_H * embScale }}>
            <iframe
              ref={iframeRef}
              src={visualDef.embed}
              title={visualDef.label}
              style={{
                width: DP_EMB_W, height: DP_EMB_H, border: "none", display: "block",
                transform: `scale(${embScale})`, transformOrigin: "top left",
              }}
            />
          </div>
        )}
        {!iframeOn && !(visual === "gex" && gexLive) && (
          <div className="dp-hint">Hit <b>Retrieve</b> to load the live {visualDef.label} view, let it render, then <b>Capture</b> freezes it to the post image.</div>
        )}

        {capUrl && (
          <>
            <span className="dp-label" style={{ color: "var(--sm-green, #8ECAE6)" }}>✓ Captured — attached to the tweet preview below</span>
            <div className="dp-cap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capUrl} alt="captured visual" />
            </div>
          </>
        )}

        <div className="dp-row">
          <label>
            <input type="checkbox" style={{ width: "auto" }} checked={brandOn} onChange={(e) => setBrandOn(e.target.checked)} />
            CB Edge logo on image
          </label>
          {brandOn && (
            <>
              <label>Logo corner
                <select value={logoCorner} onChange={(e) => setLogoCorner(e.target.value as BrCorner)}>
                  {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </label>
              <label>cbedge.net corner
                <select value={ctaCorner} onChange={(e) => setCtaCorner(e.target.value as BrCorner)}>
                  {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      {/* 3 · trade idea */}
      <div className="dp-panel">
        <span className="dp-label">3 · Trade idea · optional</span>
        <div className="dp-row">
          <label>
            <input type="checkbox" style={{ width: "auto" }} checked={ideaOn} onChange={(e) => setIdeaOn(e.target.checked)} />
            Include trade idea
          </label>
          {ideaOn && (
            <>
              <label>Ticker <input value={ideaTicker} onChange={(e) => setIdeaTicker(e.target.value.toUpperCase())} style={{ width: 70 }} /></label>
              <label>Strike <input value={ideaStrike} onChange={(e) => setIdeaStrike(e.target.value)} style={{ width: 70 }} placeholder="6400" /></label>
              <label>C/P
                <select value={ideaRight} onChange={(e) => setIdeaRight(e.target.value as "C" | "P")}>
                  <option value="C">Call</option><option value="P">Put</option>
                </select>
              </label>
              <label>Exp <input value={ideaExp} onChange={(e) => setIdeaExp(e.target.value)} style={{ width: 90 }} placeholder="7/17" /></label>
              <label>Price <input value={ideaPrice} onChange={(e) => setIdeaPrice(e.target.value)} style={{ width: 70 }} placeholder="3.10" /></label>
              <button type="button" className="dp-btn" onClick={fetchIdeaPrice} disabled={priceLoading}>
                {priceLoading ? "Pulling…" : "$ Get price"}
              </button>
              <label>Note <input value={ideaNote} onChange={(e) => setIdeaNote(e.target.value)} style={{ width: 200 }} placeholder="watching over the flip" /></label>
            </>
          )}
        </div>
      </div>

      {/* 4 · generate + preview */}
      <div className="dp-panel">
        <span className="dp-label">4 · Generate & post</span>
        <button type="button" className="dp-btn gen" onClick={generate} disabled={generating || !form.spot}>
          {generating ? "Generating…" : "✨ Generate post (AI)"}
        </button>
        {error && <div className="dp-err">{error}</div>}
        {!capturedAt && (
          <div className="dp-hint" style={{ color: "var(--amber)" }}>
            ⚠ No visual attached yet — in section 2 pick a source, hit <b>Retrieve</b>, let it render, then <b>📸 Capture</b> to freeze it onto the post image.
          </div>
        )}
        <TweetMockup
          title={`Tweet preview — ${DAY_SLOTS.find((s) => s.v === slot)?.label}`}
          getBlob={renderBrandedBlob}
          caption={caption || "Generate a post above, or type your own caption here…"}
          onCaptionChange={setCaption}
          refreshKey={`${capturedAt}-${brandOn}-${logoCorner}-${ctaCorner}`}
        />
        <div className="dp-hint"><b>Copy</b> puts the branded image on the clipboard; <b>Open X</b> pre-fills the caption — paste the image into the composer.</div>
      </div>

      {/* history */}
      {posts.length > 0 && (
        <div className="dp-panel">
          <span className="dp-label">Recent day posts</span>
          {posts.map((p) => (
            <div key={p.id} className="dp-row" style={{ alignItems: "flex-start", borderBottom: "1px solid var(--sm-border)", paddingBottom: 8 }}>
              <span className="dp-label" style={{ color: "var(--cyan)", minWidth: 86 }}>{DAY_SLOTS.find((s) => s.v === p.slot)?.label ?? p.slot}</span>
              <span style={{ flex: 1, fontSize: 14, color: "var(--text1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{p.tweet}</span>
              <button type="button" className="dp-btn" onClick={() => setCaption(p.tweet)}>Use</button>
              <button type="button" className="dp-btn" onClick={() => savePosts(posts.filter((x) => x.id !== p.id))}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GexImageCards({ updated, today, form, ticker }: { updated: string; today: string; form: FormState; ticker: string }) {
  const reg = regimeOf(form);
  const neg = reg.neg;
  const stageRef = useRef<HTMLDivElement>(null);
  // Scale cards down to fit the column on screen; export resets transform to none
  // so PNGs are always captured at true pixel size (1600×900 chart, 900×1600
  // heatmap — read per-card off CARD_DIMS via the .vertical class).
  useEffect(() => {
    const fit = () => {
      const stage = stageRef.current; if (!stage) return;
      stage.querySelectorAll<HTMLDivElement>(".gx-card").forEach((c) => {
        const vertical = c.classList.contains("vertical");
        const w = vertical ? CARD_DIMS.heat.w : CARD_DIMS.chart.w;
        const h = vertical ? CARD_DIMS.heat.h : CARD_DIMS.chart.h;
        const avail = Math.min(stage.clientWidth, w);
        const s = Math.min(1, avail / w);
        c.style.transform = s < 1 ? `scale(${s})` : "none";
        c.style.marginBottom = s < 1 ? `${-h * (1 - s)}px` : "0";
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
        The level strip is filled <b>live from the dashboard</b> (Daily Input) — spot, CB - Core Bullseye, net GEX and range. Hit <b>Load profile</b> /
        <b> Get Heatmap</b> to pull the live visual straight from the dashboard, or drop your own screenshot instead. Every value is click-to-edit.
        Then <b>Download</b> for a clean image (1600×900 chart · 900×1600 heatmap).
      </p>
      <div className="gx-stage" ref={stageRef}>
        <GexCard kind="chart" updated={updated} today={today} regimeNeg={neg} form={form} coreBehavior={reg.coreBehavior} ticker={ticker} />
        <GexCard kind="heat" updated={updated} today={today} regimeNeg={neg} form={form} coreBehavior={reg.coreBehavior} ticker={ticker} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Screenshot Brander — stamp the CB Edge logo + tagline + cbedge.net onto ANY
 * uploaded/pasted screenshot (e.g. the ICT chart, heatmap, a greeks card) and
 * push it to X. Draws the image + branding to a <canvas> at its native size, so
 * "Copy + Open X" copies the branded PNG to the clipboard (Ctrl+V into the X
 * composer). Falls back to a PNG download when the browser blocks image copy.
 * ════════════════════════════════════════════════════════════════════════════ */
const BR_CSS = `
  .br-wrap { max-width: 1100px; margin: 0 auto; padding-bottom: 40px; }
  .br-help { font-size:12px; color:#9aa4b2; line-height:1.55; max-width:920px; margin:0 auto 18px; }
  .br-help b { color:#fff; }
  .br-drop { border:1.5px dashed rgba(255,255,255,.20); border-radius:12px; padding:30px; text-align:center; color:#9aa4b2; background:rgba(255,255,255,.02); cursor:pointer; font-size: 14px; transition:.15s; }
  .br-drop.hot { border-color:var(--cyan); color:#fff; background:rgba(33,158,188,.05); }
  .br-drop b { color:#fff; }
  .br-row { display:flex; gap:18px; align-items:center; flex-wrap:wrap; margin:16px 0; }
  .br-row label { font-size:12px; color:#cfd6df; display:flex; gap:7px; align-items:center; }
  .br-row select { font-family:var(--sm-mono); font-size:12px; padding:7px 10px; border-radius:6px; border:1px solid var(--sm-border); background:rgba(0,0,0,.4); color:#fff; cursor:pointer; }
  .br-cap-h { font-size: 12px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:#fff; margin:0 0 6px; }
  .br-cap { width:100%; resize:vertical; min-height:110px; font-family:inherit; font-size: 14px; line-height:1.5; padding:10px 12px; border-radius:8px; border:1px solid var(--sm-border); background:rgba(0,0,0,.4); color:#fff; box-sizing:border-box; }
  .br-acts { display:flex; gap:10px; flex-wrap:wrap; margin:16px 0 8px; }
  .br-btn { font-family:var(--sm-mono); font-size:12px; font-weight:700; letter-spacing:.03em; cursor:pointer; padding:10px 16px; border-radius:7px; border:1px solid var(--sm-border); background:rgba(255,255,255,.05); color:#fff; transition:.12s; }
  .br-btn:hover { opacity:.9; } .br-btn:disabled { opacity:.45; cursor:default; }
  .br-btn.x { background:#1d9bf0; border-color:#1d9bf0; color:#fff; box-shadow:0 0 16px rgba(29,155,240,.3); }
  .br-btn.dl { background:var(--cyan); border-color:var(--cyan); color:#05060a; }
  .br-status { font-size:12px; color:#8ECAE6; margin:0 0 8px; min-height:16px; }
  .br-frame { margin-top:12px; border:1px solid var(--sm-border); border-radius:12px; overflow:hidden; background:#000; min-height:130px; display:flex; align-items:center; justify-content:center; }
  .br-frame canvas { display:block; width:100%; height:auto; }
  .br-frame .ph { font-size:12px; color:#9aa4b2; padding:24px; }
`;

type BrCorner = "tl" | "tr" | "bl" | "br";
const BR_CORNERS: { v: BrCorner; label: string }[] = [
  { v: "tl", label: "top-left" }, { v: "tr", label: "top-right" },
  { v: "bl", label: "bottom-left" }, { v: "br", label: "bottom-right" },
];
const BR_DEFAULT_CAPTION =
  `this isn't just another heatmap.\n\nlive charting, automated strategies, a full trader dashboard, and automated ICT setups + alerts — all in one place.\n\ncbedge.net\n\nCB Edge - "Your Unfair Edge in the Markets"`;

// Stamps the CB Edge wordmark + tagline (at `logoCorner`) and the cbedge.net
// CTA + LIVE dot (at `ctaCorner`) onto an already-drawn canvas, each backed by
// a radial scrim so it reads over any image. Pure function — no React, no
// refs — so both Screenshot Brander AND the GEX Data tab's "add my logo" corner
// picker can call the exact same drawing code onto their own canvas.
function drawBrandStamp(ctx: CanvasRenderingContext2D, W: number, H: number, logoCorner: BrCorner, ctaCorner: BrCorner) {
  const u = W / 1600, P = Math.round(40 * u);
  const scrim = (corner: BrCorner, w: number, h: number) => {
    const x = corner === "tl" || corner === "bl" ? 0 : W - w;
    const y = corner === "tl" || corner === "tr" ? 0 : H - h;
    const gx = x + (corner.includes("l") ? 0 : w), gy = y + (corner.includes("t") ? 0 : h);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h));
    g.addColorStop(0, "rgba(4,6,11,0.76)"); g.addColorStop(1, "rgba(4,6,11,0)");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  };
  // logo
  const logoSize = Math.round(40 * u), tagSize = Math.round(15 * u);
  const lLeft = logoCorner === "tl" || logoCorner === "bl", lTop = logoCorner === "tl" || logoCorner === "tr";
  const lx = lLeft ? P : W - P, ly = lTop ? P + logoSize : H - P - tagSize - Math.round(8 * u);
  scrim(logoCorner, Math.round(390 * u), Math.round(122 * u));
  ctx.textAlign = lLeft ? "left" : "right"; ctx.textBaseline = "alphabetic";
  const grad = ctx.createLinearGradient(0, ly - logoSize, 0, ly + 4);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.45, "#cfd6dd"); grad.addColorStop(0.55, "#7d8792"); grad.addColorStop(1, "#eef1f4");
  ctx.fillStyle = grad; ctx.font = `800 ${logoSize}px Inter, "Segoe UI", Arial`;
  ctx.fillText("CB Edge", lx, ly);
  ctx.fillStyle = "#ffffff"; ctx.font = `italic 500 ${tagSize}px Inter, "Segoe UI", Arial`;
  ctx.fillText("“Real Edge - Real Orderflow”", lx, ly + Math.round(24 * u));
  // cta
  const ctaSize = Math.round(32 * u);
  const cLeft = ctaCorner === "tl" || ctaCorner === "bl", cTop = ctaCorner === "tl" || ctaCorner === "tr";
  const cx = cLeft ? P : W - P, cy = cTop ? P + ctaSize : H - P;
  scrim(ctaCorner, Math.round(320 * u), Math.round(72 * u));
  ctx.textAlign = cLeft ? "left" : "right";
  ctx.fillStyle = "#35D6E8"; ctx.font = `800 ${ctaSize}px Inter, "Segoe UI", Arial`;
  ctx.fillText("cbedge.net", cx, cy);
  const tw = ctx.measureText("cbedge.net").width;
  const dotX = cLeft ? cx + tw + Math.round(20 * u) : cx - tw - Math.round(70 * u);
  ctx.beginPath(); ctx.arc(dotX, cy - ctaSize * 0.32, Math.round(6 * u), 0, 7); ctx.fillStyle = "#8ECAE6"; ctx.fill();
  ctx.textAlign = "left"; ctx.fillStyle = "#8ECAE6"; ctx.font = `700 ${Math.round(18 * u)}px Inter, "Segoe UI", Arial`;
  ctx.fillText("LIVE", dotX + Math.round(12 * u), cy - ctaSize * 0.18);
}

function ScreenshotBrander() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [hasImg, setHasImg] = useState(false);
  const [logoCorner, setLogoCorner] = useState<BrCorner>("tl");
  const [ctaCorner, setCtaCorner] = useState<BrCorner>("br");
  const [caption, setCaption] = useState(BR_DEFAULT_CAPTION);
  const [status, setStatus] = useState("");
  const [hot, setHot] = useState(false);

  const draw = useCallback(() => {
    const cv = canvasRef.current, img = imgRef.current;
    if (!cv || !img) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    drawBrandStamp(ctx, cv.width, cv.height, logoCorner, ctaCorner);
  }, [logoCorner, ctaCorner]);

  useEffect(() => { if (hasImg) draw(); }, [hasImg, draw]);

  const loadFile = useCallback((f?: File | null) => {
    if (!f || !f.type.startsWith("image/")) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { imgRef.current = img; setHasImg(true); setStatus(""); URL.revokeObjectURL(url); };
    img.src = url;
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items; if (!items) return;
      for (const it of Array.from(items)) { if (it.type.startsWith("image/")) { loadFile(it.getAsFile()); break; } }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  const toBlob = () => new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, "image/png"));
  const download = useCallback(async () => {
    const b = await toBlob(); if (!b) return false;
    const a = document.createElement("a"); a.href = URL.createObjectURL(b);
    a.download = `cbedge-branded-${todayETStr()}.png`; document.body.appendChild(a); a.click(); a.remove();
    return true;
  }, []);
  const openX = useCallback(() => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`, "_blank", "noopener");
  }, [caption]);
  const copyAndPost = useCallback(async () => {
    const b = await toBlob(); if (!b) return;
    try {
      const ClipItem = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!ClipItem || !navigator.clipboard?.write) throw new Error("no-clip");
      await navigator.clipboard.write([new ClipItem({ "image/png": b })]);
      openX(); setStatus("Image copied — paste it in the X composer with Ctrl+V.");
    } catch {
      await download(); openX();
      setStatus("Clipboard image copy needs https — downloaded the PNG instead; drag it into X.");
    }
  }, [download, openX]);

  return (
    <div className="br-wrap">
      <style>{BR_CSS}</style>
      <p className="br-help">
        Drop, choose, or <b>paste (Ctrl+V)</b> any dashboard screenshot. It gets the CB Edge logo, tagline
        and cbedge.net stamped on. <b>Copy + Open X</b> puts the branded PNG on your clipboard and opens the
        X composer — paste with Ctrl+V.
      </p>
      <div
        className={`br-drop${hot ? " hot" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setHot(true); }}
        onDragLeave={() => setHot(false)}
        onDrop={(e) => { e.preventDefault(); setHot(false); loadFile(e.dataTransfer.files?.[0]); }}
      >
        Click to choose, drag a screenshot here, or press <b>Ctrl+V</b> to paste
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => loadFile(e.target.files?.[0])} />

      <div className="br-row">
        <label>Logo corner
          <select value={logoCorner} onChange={(e) => setLogoCorner(e.target.value as BrCorner)}>
            {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </label>
        <label>cbedge.net corner
          <select value={ctaCorner} onChange={(e) => setCtaCorner(e.target.value as BrCorner)}>
            {BR_CORNERS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </label>
      </div>

      <div className="br-cap-h">Tweet caption</div>
      <textarea className="br-cap" value={caption} onChange={(e) => setCaption(e.target.value)} />

      <div className="br-acts">
        <button type="button" className="br-btn x" onClick={copyAndPost} disabled={!hasImg}>Copy + Open X</button>
        <button type="button" className="br-btn dl" onClick={download} disabled={!hasImg}>Download PNG</button>
        <button type="button" className="br-btn" onClick={openX}>Open X (text only)</button>
      </div>
      {status && <div className="br-status">{status}</div>}

      <div className="br-frame">
        <canvas ref={canvasRef} style={{ display: hasImg ? "block" : "none" }} />
        {!hasImg && <span className="ph">Branded preview appears here</span>}
      </div>

      {hasImg && (
        <div style={{ marginTop: 16 }}>
          <TweetMockup
            title="Tweet preview — branded screenshot"
            getBlob={toBlob}
            caption={caption}
            refreshKey={`${logoCorner}-${ctaCorner}-${hasImg}`}
          />
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 * Options Probe — type a contract in shorthand ("TSLA 420c 7/17") plus your fill
 * price; it records the entry and tracks the result as it prints. Thin client over
 * the deployed /api/watch pipeline: resolves the contract via /proxy/probe-rest
 * (Theta greeks + TT quote), persists to Postgres, and a server-side recorder
 * keeps filling history during RTH even when this page is closed — the same proxy
 * pipeline the GEX tabs use. Full greeks + price charts live on /owner/watch.
 * ════════════════════════════════════════════════════════════════════════════ */

interface ProbeSnapshot { ts: number | string | null; mark: number | null; last: number | null; bid: number | null; ask: number | null }
interface ProbeRow {
  id: number; ticker: string; expiration: string; strike: number;
  side: string; note: string | null; added_price: number | null; snapshot: ProbeSnapshot | null;
}
interface ParsedContract { ticker: string; strike: number; side: "C" | "P"; expiry: string; atPrice: number | null }

// Parse "TSLA 420c 7/17", "SPX 6000p 12/19/26", "AAPL 250 C 2026-01-16 @ 3.10".
// Returns null until ticker + strike + side + a valid expiry are all present.
function parseContract(raw: string): ParsedContract | null {
  const s = raw.trim();
  if (!s) return null;
  const tickerM = s.match(/^([A-Za-z.]{1,6})/);
  if (!tickerM) return null;
  const ticker = tickerM[1].toUpperCase();

  let strike: number | null = null;
  let side: "C" | "P" | null = null;
  const cs = s.match(/(\d+(?:\.\d+)?)\s*([cCpP])(?![A-Za-z])/); // "420c" / "250 C"
  if (cs) {
    strike = parseFloat(cs[1]);
    side = cs[2].toUpperCase() as "C" | "P";
  } else {
    const rest = s.slice(ticker.length);
    const sideM = rest.match(/\b(call|put|c|p)\b/i);
    const strikeM = rest.match(/(\d+(?:\.\d+)?)/);
    if (sideM) side = /^(c|call)$/i.test(sideM[1]) ? "C" : "P";
    if (strikeM) strike = parseFloat(strikeM[1]);
  }

  let expiry: string | null = null;
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const md = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (iso) {
    expiry = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  } else if (md) {
    const mo = parseInt(md[1], 10), da = parseInt(md[2], 10);
    let yr = md[3] ? parseInt(md[3], 10) : NaN;
    if (md[3] && md[3].length === 2) yr = 2000 + parseInt(md[3], 10);
    if (!Number.isFinite(yr)) {
      const now = new Date();
      yr = now.getFullYear();
      // If the M/D already passed this year, roll it to next year.
      if (new Date(yr, mo - 1, da) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) yr += 1;
    }
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      expiry = `${yr}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
    }
  }

  let atPrice: number | null = null;
  const at = s.match(/@\s*(\d+(?:\.\d+)?)/);
  if (at) atPrice = parseFloat(at[1]);

  if (strike == null || !Number.isFinite(strike) || !side || !expiry) return null;
  return { ticker, strike, side, expiry, atPrice };
}

const OP_CSS = `
  .op-wrap { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; padding-bottom: 44px; }
  .op-card { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
  .op-card-h { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text1); padding: 13px 16px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .op-card-h .sub { font-size: 12px; font-weight: 600; letter-spacing: 0.01em; text-transform: none; color: var(--sm-muted); }
  .op-card-b { padding: 16px; }
  .op-entry { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
  .op-entry .contract { flex: 2; min-width: 220px; }
  .op-entry .price { flex: 1; min-width: 120px; }
  .op-input { width: 100%; box-sizing: border-box; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 6px; padding: 11px 12px; font-family: var(--sm-mono); font-size: 14px; }
  .op-input:focus { outline: none; border-color: var(--cyan); }
  .op-input::placeholder { color: var(--sm-muted); opacity: 0.55; }
  .op-go { font-family: var(--sm-mono); font-size: 12px; font-weight: 800; letter-spacing: 0.04em; cursor: pointer; padding: 0 18px; border-radius: 6px; border: 1px solid var(--cyan); background: var(--cyan); color: #05060a; white-space: nowrap; }
  .op-go:disabled { opacity: 0.45; cursor: default; }
  .op-note-row { margin-top: 10px; }
  .op-preview { margin-top: 11px; font-family: var(--sm-mono); font-size: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .op-chip { padding: 4px 9px; border-radius: 6px; border: 1px solid rgba(33,158,188,0.4); color: var(--cyan); background: rgba(33,158,188,0.08); }
  .op-chip.side-p { border-color: rgba(251,133,1,0.5); color: var(--amber); background: rgba(251,133,1,0.08); }
  .op-hint { color: var(--sm-muted); }
  .op-err { margin-top: 12px; font-size: 12px; color: var(--sm-red); border-left: 2px solid var(--sm-red); padding: 6px 10px; background: rgba(239,68,68,0.06); border-radius: 0 6px 6px 0; }
  .op-btn { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.03em; cursor: pointer; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); }
  .op-btn:hover { border-color: var(--cyan); }
  .op-btn:disabled { opacity: 0.5; cursor: default; }
  .op-link { font-family: var(--sm-mono); font-size: 12px; color: var(--cyan); text-decoration: none; }
  .op-link:hover { text-decoration: underline; }
  .op-row { display: grid; grid-template-columns: 1.3fr 1.25fr 1fr auto; gap: 12px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--sm-border); }
  .op-row:last-child { border-bottom: none; }
  .op-tick { font-size: 17px; font-weight: 800; color: var(--text1); }
  .op-badge { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-left: 6px; }
  .op-badge.c { color: var(--sm-green); background: rgba(142,202,230,0.12); border: 1px solid rgba(142,202,230,0.4); }
  .op-badge.p { color: var(--amber); background: rgba(251,133,1,0.12); border: 1px solid rgba(251,133,1,0.4); }
  .op-rowsub { font-size: 12px; color: var(--sm-muted); margin-top: 3px; font-family: var(--sm-mono); }
  .op-px { font-family: var(--sm-mono); font-size: 14px; color: var(--text1); }
  .op-px .arrow { color: var(--sm-muted); margin: 0 6px; }
  .op-px .lbl { color: var(--sm-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; }
  .op-pnl { font-family: var(--sm-mono); font-size: 14px; font-weight: 800; text-align: right; }
  .op-pnl .d { font-size: 12px; font-weight: 600; display: block; margin-top: 2px; }
  .op-x { background: none; border: none; color: var(--sm-muted); cursor: pointer; font-size: 17px; line-height: 1; padding: 0 2px; justify-self: end; }
  .op-x:hover { color: var(--sm-red); }
  .op-empty { padding: 26px; text-align: center; color: var(--sm-muted); font-size: 14px; }
  .op-note { font-size: 12px; color: var(--sm-muted); line-height: 1.55; margin-top: 12px; }
  .op-shorthand { display: flex; gap: 10px; margin-bottom: 12px; }
  .op-shorthand .op-input { flex: 1; }
  .op-form { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .op-f { display: flex; flex-direction: column; gap: 5px; flex: 1; min-width: 92px; }
  .op-flab { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sm-muted); font-family: var(--sm-mono); }
  .op-flab i { text-transform: none; letter-spacing: 0; opacity: 0.7; font-style: normal; }
  .op-side { display: flex; gap: 6px; }
  .op-sidebtn { flex: 1; font-family: var(--sm-mono); font-size: 12px; font-weight: 700; cursor: pointer; padding: 10px 8px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg0); color: var(--sm-muted); }
  .op-sidebtn.on.c { border-color: rgba(142,202,230,0.6); color: var(--sm-green); background: rgba(142,202,230,0.10); }
  .op-sidebtn.on.p { border-color: rgba(251,133,1,0.6); color: var(--amber); background: rgba(251,133,1,0.10); }
  .op-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .op-tcard { background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px; }
  .op-tcard-h { display: flex; align-items: center; justify-content: space-between; }
  .op-bigrow { margin: 10px 0 8px; }
  .op-big { font-family: var(--sm-mono); font-size: 24px; font-weight: 800; line-height: 1; }
  .op-bigsub { font-family: var(--sm-mono); font-size: 14px; color: var(--text1); margin-top: 6px; }
  .op-bigsub .lbl { color: var(--sm-muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 3px; }
  .op-bigsub .arrow { color: var(--sm-muted); margin: 0 6px; }
  .op-dollars { font-weight: 700; }
  .op-legend { display: flex; align-items: center; gap: 14px; margin-top: 8px; font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); }
  .op-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .op-legend .dot.in { background: transparent; border: 1.5px solid var(--text1); }
  .op-legend .dot.now { background: var(--cyan); }
  .op-legend-ago { margin-left: auto; }
  .op-sparkempty { font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); padding: 16px 0; text-align: center; }
  .op-tcard { cursor: pointer; transition: border-color 0.12s; }
  .op-tcard:hover { border-color: rgba(33,158,188,0.4); }
  .op-tcard.open { border-color: rgba(33,158,188,0.5); }
  .op-chev { color: var(--sm-muted); font-size: 12px; margin-left: 6px; }
  .op-chartwrap { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--sm-border); cursor: default; }
  .op-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
  .op-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
  .op-tgl { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; cursor: pointer; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--sm-border); background: transparent; color: var(--sm-muted); }
  .op-tgl:hover { color: var(--text1); }
  .op-tgl.on { color: var(--text1); background: rgba(255,255,255,0.08); }
  .op-tgl.on.cyan { color: #219EBC; background: rgba(33,158,188,0.12); border-color: rgba(33,158,188,0.4); }
  .op-chartempty { padding: 40px 0; text-align: center; color: var(--sm-muted); font-size: 12px; font-family: var(--sm-mono); }
  .op-charthint { margin-top: 8px; font-family: var(--sm-mono); font-size: 12px; color: var(--sm-muted); letter-spacing: 0.04em; }
`;

type ProbeMetricKey = "mark" | "net_gex" | "delta" | "theta" | "vega" | "iv";
interface ProbeHistSnap { ts: number; mark: number | null; net_gex: number | null; delta: number | null; theta: number | null; vega: number | null; iv: number | null }
const PROBE_METRICS: { key: ProbeMetricKey; label: string; d: number }[] = [
  { key: "mark", label: "Price", d: 2 },
  { key: "net_gex", label: "Net GEX", d: 0 },
  { key: "delta", label: "Δ", d: 3 },
  { key: "theta", label: "Θ", d: 3 },
  { key: "vega", label: "V", d: 3 },
  { key: "iv", label: "IV", d: 4 },
];
const PROBE_RANGES: { key: string; label: string }[] = [
  { key: "1d", label: "1D" }, { key: "3d", label: "3D" }, { key: "1w", label: "1W" }, { key: "1m", label: "1M" },
];

function opFmtGEX(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sign = v >= 0 ? "+" : "−";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  return `${sign}$${(a / 1e3).toFixed(2)}K`;
}
// RTH gate for the chart: keep only 09:30–16:00 ET, Mon–Fri (options don't trade
// overnight, so overnight gaps just add flat dead space).
function opIsRth(ts: number | string | null | undefined): boolean {
  const t = Number(ts);
  if (!Number.isFinite(t)) return false;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(new Date(t));
  const get = (k: string) => p.find((x) => x.type === k)?.value;
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// Full option price-over-time chart — the /owner/watch HistoryChart, ported to
// this page's palette. Plots the chosen metric (Price/Net GEX/greeks/IV).
function ProbeChart({ history, metric }: { history: ProbeHistSnap[]; metric: ProbeMetricKey }) {
  const W = 960, H = 340, PADL = 56, PADR = 16, PADT = 16, PADB = 28;
  const pts = history
    .map((s) => ({ ts: s.ts, v: s[metric] as number | null }))
    .filter((p) => p.v != null && Number.isFinite(p.v as number)) as { ts: number; v: number }[];
  if (pts.length < 2) {
    return <div className="op-chartempty">Not enough history yet — snapshots accrue every refresh (and through RTH server-side).</div>;
  }
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.08; minY -= gpad; maxY += gpad;
  // RTH-only time: x is the point INDEX, not clock time, so overnight/weekend
  // gaps compress out and consecutive RTH sessions sit adjacent.
  const n = pts.length;
  const sx = (i: number) => PADL + (n <= 1 ? 0 : i / (n - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(n - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const dec = PROBE_METRICS.find((m) => m.key === metric)!.d;
  const fmtY = (v: number) => (metric === "net_gex" ? opFmtGEX(v) : v.toFixed(dec));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const multiDay = maxX - minX > 20 * 3600_000;
  const fmtT = (ts: number) => multiDay
    ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="opwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(33,158,188,0.28)" />
          <stop offset="100%" stopColor="rgba(33,158,188,0)" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
          <text x={PADL - 6} y={sy(v) + 3} textAnchor="end" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtY(v)}</text>
        </g>
      ))}
      <text x={PADL} y={H - 6} textAnchor="start" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 6} textAnchor="end" fontSize={11} fill="#ffffff" fontFamily="var(--sm-mono)">{fmtT(maxX)}</text>
      <path d={area} fill="url(#opwg)" />
      <path d={path} fill="none" stroke="#219EBC" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(n - 1)} cy={sy(pts[pts.length - 1].v)} r={3} fill="#219EBC" />
    </svg>
  );
}

// Compact price-over-time sparkline for a tracked contract. The dashed line marks
// the entry (added_price); the hollow dot is where you got IN, the filled dot is
// the current mark (green/red vs entry). Mirrors the /owner/watch history chart.
function ProbeSpark({ points, entry }: { points: { ts: number; mark: number }[]; entry: number | null }) {
  const W = 300, H = 60, PAD = 7;
  if (points.length < 1) {
    return <div className="op-sparkempty">building history — snapshots accrue every refresh</div>;
  }
  const ys = points.map((p) => p.mark);
  const dom = entry != null && Number.isFinite(entry) ? [...ys, entry] : ys;
  let minY = Math.min(...dom), maxY = Math.max(...dom);
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  const padY = (maxY - minY) * 0.14; minY -= padY; maxY += padY;
  // RTH-only time: index-based x (points are already RTH-filtered at the call site).
  const n = points.length;
  const sx = (i: number) => PAD + (n <= 1 ? 0 : i / (n - 1)) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - ((v - minY) / (maxY - minY || 1)) * (H - PAD * 2);
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.mark).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = `${line} L${sx(n - 1).toFixed(1)},${(H - PAD).toFixed(1)} L${sx(0).toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  const up = entry != null ? last.mark - entry : 0;
  const nowColor = entry == null ? "#219EBC" : up > 0 ? "#8ECAE6" : up < 0 ? "#EF4444" : "#9aa4b2";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {entry != null && Number.isFinite(entry) && (
        <line x1={PAD} y1={sy(entry)} x2={W - PAD} y2={sy(entry)} stroke="#9aa4b2" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
      )}
      <path d={area} fill="rgba(33,158,188,0.10)" />
      <path d={line} fill="none" stroke="#219EBC" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {entry != null && Number.isFinite(entry) && (
        <circle cx={sx(0)} cy={sy(entry)} r={3.5} fill="#0d1119" stroke="#ffffff" strokeWidth={1.5} />
      )}
      <circle cx={sx(n - 1)} cy={sy(last.mark)} r={4} fill={nowColor} stroke="#05060a" strokeWidth={1} />
    </svg>
  );
}

function OptionsProbe() {
  const [shorthand, setShorthand] = useState("");
  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState<"C" | "P">("C");
  const [fill, setFill] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<ProbeRow[]>([]);
  const [historyById, setHistoryById] = useState<Record<number, { ts: number; mark: number }[]>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [histFull, setHistFull] = useState<Record<number, ProbeHistSnap[]>>({});
  const [histLoading, setHistLoading] = useState(false);
  const [metric, setMetric] = useState<ProbeMetricKey>("mark");
  const [range, setRange] = useState<string>("1d");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLoad, setLastLoad] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const entryVal = useMemo(() => {
    const n = parseFloat(fill.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [fill]);
  // Ready to add once ticker + a valid ISO expiry + a positive strike are present.
  const canAdd = ticker.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && parseFloat(strike) > 0;

  // Shorthand → fields: "TSLA 420c 7/17" fills the structured inputs below.
  const applyShorthand = useCallback((str: string) => {
    const p = parseContract(str);
    if (!p) { setErr("Couldn't parse — try: TSLA 420c 7/17"); return; }
    setErr(null);
    setTicker(p.ticker);
    setStrike(String(p.strike));
    setSide(p.side);
    setExpiry(p.expiry);
    if (p.atPrice != null) setFill(String(p.atPrice));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watch", { cache: "no-store" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setErr(null);
      setLastLoad(Date.now());
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 20_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [load]);

  // Per-contract mark history for the sparklines. GET ?history=<id> (no range) →
  // the full recorded series; coerce the BIGINT ts (arrives as string) and sort.
  const loadHistories = useCallback(async (ids: number[]) => {
    const entries = await Promise.all(ids.map(async (id) => {
      try {
        const res = await fetch(`/api/watch?history=${id}`, { cache: "no-store" });
        const j = await res.json();
        const pts = (Array.isArray(j.history) ? j.history : [])
          .map((s: { ts: number | string; mark: number | null }) => ({ ts: Number(s.ts), mark: Number(s.mark) }))
          .filter((p: { ts: number; mark: number }) => Number.isFinite(p.ts) && Number.isFinite(p.mark))
          .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);
        return [id, pts] as const;
      } catch {
        return [id, [] as { ts: number; mark: number }[]] as const;
      }
    }));
    setHistoryById((prev) => {
      const next = { ...prev };
      for (const [id, pts] of entries) next[id] = pts;
      return next;
    });
  }, []);

  // Refetch histories only when the SET of tracked ids changes (add/remove) —
  // not on every 20s price poll.
  const idKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = idKey ? idKey.split(",").map(Number) : [];
    if (ids.length) loadHistories(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  // Full snapshot history (all metrics) for the expanded chart, by range — the
  // /owner/watch fetch. RTH-filtered; ts coerced from the BIGINT string.
  const loadFullHistory = useCallback(async (id: number, r: string) => {
    setHistLoading(true);
    try {
      const res = await fetch(`/api/watch?history=${id}&range=${r}`, { cache: "no-store" });
      const j = await res.json();
      const snaps: ProbeHistSnap[] = (Array.isArray(j.history) ? j.history : [])
        .map((s: Record<string, unknown>) => ({
          ts: Number(s.ts),
          mark: s.mark == null ? null : Number(s.mark),
          net_gex: s.net_gex == null ? null : Number(s.net_gex),
          delta: s.delta == null ? null : Number(s.delta),
          theta: s.theta == null ? null : Number(s.theta),
          vega: s.vega == null ? null : Number(s.vega),
          iv: s.iv == null ? null : Number(s.iv),
        }))
        .filter((s: ProbeHistSnap) => Number.isFinite(s.ts) && opIsRth(s.ts))
        .sort((a: ProbeHistSnap, b: ProbeHistSnap) => a.ts - b.ts);
      setHistFull((m) => ({ ...m, [id]: snaps }));
    } catch {
      /* keep prior */
    } finally {
      setHistLoading(false);
    }
  }, []);

  const toggleCard = useCallback((id: number) => {
    setExpandedId((cur) => {
      const next = cur === id ? null : id;
      if (next != null) loadFullHistory(next, range);
      return next;
    });
  }, [loadFullHistory, range]);

  const changeRange = useCallback((r: string) => {
    setRange(r);
    if (expandedId != null) loadFullHistory(expandedId, r);
  }, [expandedId, loadFullHistory]);

  // While a card is expanded, keep its chart current on the same 20s cadence.
  useEffect(() => {
    if (expandedId == null) return;
    const t = setInterval(() => loadFullHistory(expandedId, range), 20_000);
    return () => clearInterval(t);
  }, [expandedId, range, loadFullHistory]);

  const probeAndTrack = useCallback(async () => {
    if (!canAdd) { setErr("Enter ticker, expiry and strike"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          ticker: ticker.trim().toUpperCase(),
          expiry,
          strike: Number(strike),
          side,
          note: note || null,
          addedPrice: entryVal,
        }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      // Keep expiry + side so adding several strikes on the same expiry is quick.
      setShorthand(""); setTicker(""); setStrike(""); setFill(""); setNote("");
      await load();
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setAdding(false);
    }
  }, [canAdd, ticker, expiry, strike, side, note, entryVal, load]);

  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      if (Array.isArray(j.rows)) {
        setRows(j.rows);
        void loadHistories((j.rows as ProbeRow[]).map((x) => x.id));
      }
      setErr(null);
      setLastLoad(Date.now());
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setRefreshing(false);
    }
  }, [loadHistories]);

  const remove = useCallback(async (id: number) => {
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", id }),
      });
    } catch { /* optimistic */ }
  }, []);

  const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Number(v).toFixed(2));
  const fmtExp = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  };
  const ago = (ts: number | string | null | undefined) => {
    const t = Number(ts);
    if (!Number.isFinite(t) || t <= 0) return "—";
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  const upDown = (v: number | null) => (v == null ? "var(--sm-muted)" : v > 0 ? "var(--sm-green)" : v < 0 ? "var(--sm-red)" : "var(--sm-muted)");

  return (
    <div className="op-wrap">
      <style>{OP_CSS}</style>

      {/* Probe entry */}
      <div className="op-card">
        <div className="op-card-h">Probe a contract <span className="sub">records your entry, then tracks the result live</span></div>
        <div className="op-card-b">
          {/* Optional shorthand → fills the fields below */}
          <div className="op-shorthand">
            <input
              className="op-input"
              value={shorthand}
              onChange={(e) => setShorthand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") applyShorthand(shorthand); }}
              placeholder="shortcut: TSLA 420c 7/17  →  Enter to fill"
            />
            <button type="button" className="op-btn" onClick={() => applyShorthand(shorthand)} disabled={!shorthand.trim()}>Fill ↓</button>
          </div>

          <div className="op-form">
            <label className="op-f"><span className="op-flab">Ticker</span>
              <input className="op-input" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="TSLA" />
            </label>
            <label className="op-f"><span className="op-flab">Expiration</span>
              <input className="op-input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ colorScheme: "dark" }} />
            </label>
            <label className="op-f"><span className="op-flab">Strike</span>
              <input className="op-input" type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="420" />
            </label>
            <div className="op-f"><span className="op-flab">Side</span>
              <div className="op-side">
                <button type="button" className={`op-sidebtn${side === "C" ? " on c" : ""}`} onClick={() => setSide("C")}>Call</button>
                <button type="button" className={`op-sidebtn${side === "P" ? " on p" : ""}`} onClick={() => setSide("P")}>Put</button>
              </div>
            </div>
            <label className="op-f"><span className="op-flab">Fill price <i>(opt)</i></span>
              <input className="op-input" value={fill} onChange={(e) => setFill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canAdd && !adding) probeAndTrack(); }} placeholder="live mark" inputMode="decimal" />
            </label>
            <button type="button" className="op-go" onClick={probeAndTrack} disabled={!canAdd || adding}>
              {adding ? "Probing…" : "Probe & Track"}
            </button>
          </div>

          <div className="op-note-row">
            <input className="op-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="note / thesis (optional)" />
          </div>

          <div className="op-preview">
            {canAdd ? (
              <>
                <span className={`op-chip${side === "P" ? " side-p" : ""}`}>
                  {ticker} {parseFloat(strike) % 1 ? strike : Math.round(parseFloat(strike))}{side} · {fmtExp(expiry)}
                </span>
                <span className="op-hint">entry {entryVal != null ? `@ ${entryVal.toFixed(2)}` : "= live mark on add"}</span>
              </>
            ) : (
              <span className="op-hint">fill ticker, expiry &amp; strike — or paste a shortcut like <b>TSLA 420c 7/17</b> above</span>
            )}
          </div>
          {err && <div className="op-err">{err}</div>}
        </div>
      </div>

      {/* Tracked results */}
      <div className="op-card">
        <div className="op-card-h">
          Tracked <span className="sub">{rows.length} contract{rows.length === 1 ? "" : "s"}{lastLoad ? ` · updated ${ago(lastLoad)}` : ""}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
            <span style={{ fontFamily: "var(--sm-mono)", fontSize: 12, color: "var(--sm-muted)" }}>click a card for the full chart</span>
            <button type="button" className="op-btn" onClick={refreshPrices} disabled={refreshing}>{refreshing ? "Refreshing…" : "↻ Refresh"}</button>
          </span>
        </div>
        <div className="op-card-b">
          {loading ? (
            <div className="op-empty">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="op-empty">No contracts yet — probe one above.</div>
          ) : (
            <div className="op-grid">
              {rows.map((r) => {
                const entry = r.added_price;
                const mark = r.snapshot?.mark ?? r.snapshot?.last ?? null;
                const pct = entry != null && mark != null && entry !== 0 ? ((mark - entry) / entry) * 100 : null;
                const dollars = entry != null && mark != null ? (mark - entry) * 100 : null;
                // Line = RTH-only recorded history + the live latest mark appended
                // (only during RTH), so the "now" dot tracks the 20s poll.
                const hist = (historyById[r.id] ?? []).filter((h) => opIsRth(h.ts));
                const liveTs = Number(r.snapshot?.ts);
                const pts = mark != null && Number.isFinite(liveTs) && opIsRth(liveTs) && (!hist.length || liveTs > hist[hist.length - 1].ts)
                  ? [...hist, { ts: liveTs, mark }]
                  : hist;
                const isOpen = expandedId === r.id;
                return (
                  <div
                    key={r.id}
                    className={`op-tcard${isOpen ? " open" : ""}`}
                    onClick={() => toggleCard(r.id)}
                    style={isOpen ? { gridColumn: "1 / -1" } : undefined}
                  >
                    <div className="op-tcard-h">
                      <div>
                        <span className="op-tick">{r.ticker}</span>
                        <span className={`op-badge ${r.side === "C" ? "c" : "p"}`}>{r.strike % 1 ? r.strike : Math.round(r.strike)}{r.side}</span>
                        <span className="op-chev">{isOpen ? "▾" : "▸"}</span>
                      </div>
                      <button type="button" className="op-x" title="Remove" onClick={(e) => { e.stopPropagation(); remove(r.id); }}>×</button>
                    </div>
                    <div className="op-rowsub">{fmtExp(r.expiration)}{r.note ? ` · ${r.note}` : ""}</div>
                    <div className="op-bigrow">
                      <div className="op-big" style={{ color: upDown(pct) }}>
                        {pct == null ? "—" : `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`}
                      </div>
                      <div className="op-bigsub">
                        <span className="lbl">in</span>{px(entry)}<span className="arrow">→</span><span className="lbl">now</span>{px(mark)}
                        <span className="op-dollars" style={{ color: upDown(dollars) }}>
                          {dollars == null ? "" : ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct`}
                        </span>
                      </div>
                    </div>
                    {!isOpen && <ProbeSpark points={pts} entry={entry} />}
                    {!isOpen && (
                      <div className="op-legend">
                        <span><i className="dot in" /> in {px(entry)}</span>
                        <span><i className="dot now" style={{ background: upDown(pct) }} /> now {px(mark)}</span>
                        <span className="op-legend-ago">{ago(r.snapshot?.ts)}</span>
                      </div>
                    )}
                    {isOpen && (
                      <div className="op-chartwrap" onClick={(e) => e.stopPropagation()}>
                        <div className="op-toolbar">
                          <div className="op-toggles">
                            {PROBE_RANGES.map((rg) => (
                              <button key={rg.key} type="button" className={`op-tgl${range === rg.key ? " on" : ""}`} onClick={() => changeRange(rg.key)}>{rg.label}</button>
                            ))}
                          </div>
                          <div className="op-toggles">
                            {PROBE_METRICS.map((m) => (
                              <button key={m.key} type="button" className={`op-tgl${metric === m.key ? " on cyan" : ""}`} onClick={() => setMetric(m.key)}>{m.label}</button>
                            ))}
                          </div>
                        </div>
                        {histLoading && !(histFull[r.id]?.length)
                          ? <div className="op-chartempty">Loading history…</div>
                          : <ProbeChart history={histFull[r.id] ?? []} metric={metric} />}
                        <div className="op-charthint">
                          {metric === "mark" ? "Option price (mark)" : PROBE_METRICS.find((m) => m.key === metric)?.label} · RTH only · entry @ {px(entry)} · {ago(r.snapshot?.ts)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="op-note">
            Entry is the fill price you type, or the live mark at the moment you add it if you leave it blank. Prices, greeks and OI come from Theta + Tastytrade through <b>/proxy/probe-rest</b> — the same pipeline the GEX tabs use — and a server-side recorder keeps snapshotting through the session, so the sparkline keeps filling even with this tab closed. Any ticker works. P&amp;L is per single contract (×100).
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Ticker picker ───────────────────────────────────────────────────────────
// One page-level control that drives every data tab. Backed by the live scanner
// universe (/proxy/scanner-tickers, ~169 symbols) through a <datalist> so it is
// type-ahead searchable without pulling in a combobox dependency, and it still
// accepts a free-typed root the sweep hasn't seen yet.
const TICKER_KEY = "cb-sm-ticker-v1";

function readStoredTicker(): string {
  if (typeof window === "undefined") return "SPX";
  try { return normalizeTicker(window.localStorage.getItem(TICKER_KEY) || "") || "SPX"; }
  catch { return "SPX"; }
}

function TickerPicker({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const { tickers, live } = useTickerUniverse();
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = (raw: string) => {
    const t = normalizeTicker(raw);
    if (!t) { setDraft(value); return; }
    if (t !== value) onChange(t);
    setDraft(t);
  };

  return (
    <span className="sm-ticker" title={live ? `${tickers.length} symbols from the live scanner sweep` : "scanner universe unavailable — showing the cached list"}>
      <label htmlFor="sm-ticker-input">Ticker</label>
      <input
        id="sm-ticker-input"
        list="sm-ticker-list"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }}
      />
      <datalist id="sm-ticker-list">
        {tickers.map((t) => <option key={t} value={t} />)}
      </datalist>
      {value !== LIVE_FEED_TICKER && (
        <button type="button" className="sm-ticker-reset" onClick={() => onChange(LIVE_FEED_TICKER)} title="Back to SPX (live in-memory feed)">↺ SPX</button>
      )}
    </span>
  );
}

// ── Ticker-wide stats block ─────────────────────────────────────────────────
// Everything the daily-input bundle returns that isn't an editable field:
// Core Bullseye, prior-day / prior-week reference levels and the published
// EM / pivot / no-long-no-short zone row. Rendered for EVERY ticker.
function StatsPanel({ stats, ticker }: { stats: TickerStats; ticker: string }) {
  const lv = stats.levels;
  const rows: { k: string; v: string; hint?: string }[] = [
    { k: "Core Bullseye", v: stats.coreBullseye != null ? fmt(stats.coreBullseye) : "—", hint: "scanner sweep" },
    { k: "Prior day H", v: stats.pdh != null ? fmt(stats.pdh) : "—", hint: stats.pdDate ?? undefined },
    { k: "Prior day L", v: stats.pdl != null ? fmt(stats.pdl) : "—", hint: stats.pdDate ?? undefined },
    { k: "Prior week H", v: stats.pwh != null ? fmt(stats.pwh) : "—" },
    { k: "Prior week L", v: stats.pwl != null ? fmt(stats.pwl) : "—" },
    { k: "Pivot", v: lv?.pivot != null ? fmt(lv.pivot) : "—", hint: "published levels" },
    { k: "Published EM", v: lv?.em != null ? `±${fmt(lv.em)}` : "—", hint: lv?.expLabel ?? undefined },
    { k: "EM up / down", v: lv?.up != null && lv?.down != null ? `${fmt(lv.up)} / ${fmt(lv.down)}` : "—" },
    { k: "No-short zone", v: lv?.buyNear != null && lv?.buyFar != null ? `${fmt(lv.buyNear)} → ${fmt(lv.buyFar)}` : "—" },
    { k: "No-long zone", v: lv?.sellNear != null && lv?.sellFar != null ? `${fmt(lv.sellNear)} → ${fmt(lv.sellFar)}` : "—" },
  ];
  return (
    <div className="sm-stats">
      <div className="sm-stats-h">
        <span>{ticker} · all stats</span>
        <small>
          {stats.source === "live-gex" ? "live feed" : stats.source === "chain" ? "live chain" : stats.source || "—"}
          {stats.scannerStale ? " · sweep stale" : ""}
        </small>
      </div>
      <div className="sm-stats-grid">
        {rows.map((r) => (
          <div className="sm-stat" key={r.k}>
            <span className="k">{r.k}</span>
            <span className="v">{r.v}</span>
            {r.hint && <span className="h">{r.hint}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SocialMedia() {
  const [tab, setTab] = useState<"levels" | "cards" | "explainer" | "postgen" | "brander" | "probe" | "dayposts">("levels");
  // The ticker every data tab reads. Persisted so the desk comes back to the
  // symbol it was working on.
  const [ticker, setTicker] = useState<string>(readStoredTicker);
  const [stats, setStats] = useState<TickerStats>(EMPTY_STATS);
  useEffect(() => {
    try { window.localStorage.setItem(TICKER_KEY, ticker); } catch { /* blocked */ }
  }, [ticker]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Live per-strike GEX ladder (netGex in $millions) for the Explainer tab.
  // Kept out of FormState (which is string-only) and refreshed alongside it.
  const [gexLadder, setGexLadder] = useState<GexLadderRow[]>([]);
  // DTE bucket for the Explainer GEX read: 0 = front/0DTE, 1 = next expiration.
  const [dte, setDte] = useState<0 | 1>(0);
  // GEX weighting basis for the Explainer read: "oivol" = open interest + volume
  // combined (default, matches the heatmap / greeks), "vol" = volume-only GEX.
  // Re-pulls the daily-input frame on change.
  const [gexBasis, setGexBasis] = useState<"oivol" | "vol">("oivol");
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

  // ES candle streaming (useEsCandles) is STUBBED in this standalone app — the
  // overnight H/L now comes solely from the daily-input API (d.esOvernightHigh /
  // esOvernightLow) rather than the live 5m ES candle feed + computeRefLevels.

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
      const r = await fetch(
        `/api/social-media/daily-input?ticker=${encodeURIComponent(ticker)}&dte=${dte}&gexBasis=${gexBasis}`,
        { cache: "no-store" },
      );
      if (!r.ok) return;
      const json = await r.json();
      const d = (json?.data ?? json) as DailyInput;
      // GEX ladder isn't user-editable — always refresh it from live state.
      if (Array.isArray(d.gexLadder)) setGexLadder(d.gexLadder);
      // Neither are the reference stats — they have no form fields to dirty.
      setStats({
        ticker: d.ticker ?? ticker,
        coreBullseye: d.coreBullseye ?? null,
        pdh: d.pdh ?? null, pdl: d.pdl ?? null, pwh: d.pwh ?? null, pwl: d.pwl ?? null,
        pdDate: d.pdDate ?? null,
        overnightHigh: d.overnightHigh ?? d.esOvernightHigh ?? null,
        overnightLow: d.overnightLow ?? d.esOvernightLow ?? null,
        levels: d.levels ?? null,
        source: d.source ?? "",
        scannerStale: !!d.scannerStale,
      });
      if (dirtyRef.current) {
        setHydrated(true);
        return;
      }
      const spot = d.spxSpot ?? NaN;
      const flip = d.gammaFlip ?? NaN;
      const netGex = d.netGex ?? NaN;
      // ES overnight H/L comes straight from the daily-input API (the live ES
      // candle feed that used to override it is stubbed in this build).
      // Overnight H/L is an ES-only candle read. For any other root the same
      // slot carries the prior-day range from ref_levels instead (the label in
      // the panel switches to match).
      const ovnHi = d.overnightHigh ?? d.esOvernightHigh ?? d.pdh ?? null;
      const ovnLo = d.overnightLow ?? d.esOvernightLow ?? d.pdl ?? null;
      const ovn = ovnHi != null && ovnLo != null ? `${fmt(ovnHi)} / ${fmt(ovnLo)}` : "";
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
  }, [stampUpdated, dte, gexBasis, ticker]);

  // ON-DEMAND ONLY: nothing fetches on mount. The page loads its data only when
  // the user clicks "Load" / "Refresh". After the first load, changing the DTE
  // toggle re-fetches (a user action); before that, the effect is a no-op.
  const loadedOnceRef = useRef(false);
  useEffect(() => {
    if (loadedOnceRef.current) hydrate();
  }, [hydrate]);

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
    const text = `Todays $${ticker} Levels\nprovided by https://www.cbedge.net/`;
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
      await shareToDiscord({ image: blob, filename: `cb-edge-spx-${todayETStr()}.png` });
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
    loadedOnceRef.current = true; // arm the on-demand DTE-change refetch
    try {
      await hydrate();
    } finally {
      setRefreshing(false);
    }
  }, [hydrate]);

  // Stop all data / disconnect — single switch that returns the page to the cold,
  // fully on-demand state: drops the ES candle socket, forgets loaded data, and
  // re-locks the on-mount no-fetch guard so nothing reconnects on its own.
  const handleStopAll = useCallback(() => {
    setRefreshing(false);
    setHydrated(false);
    loadedOnceRef.current = false; // re-arm "nothing fetches until Load"
    dirtyRef.current = false;
    setGexLadder([]);
    setForm(EMPTY_FORM);
  }, []);

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
          --cyan: var(--accent, #219ebc);
          --amber: var(--yellow, #fb8501);
          --sm-red: var(--red, #ef4444);
          --sm-green: #8ecae6;
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
          /* Match the site-wide background flair (globals.css body): subtle cyan +
             violet radials over the base bg, a touch stronger for this page. */
          background-color: var(--bg0);
          background-image:
            radial-gradient(circle at 15% 50%, rgba(33,158,188, 0.04) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(18,103,131, 0.05) 0%, transparent 50%);
          background-attachment: fixed;
          color: var(--text2);
          font-family: var(--font-inter), "Inter", "Helvetica Neue", Arial, sans-serif;
          padding: 24px;
        }
        #page-social-media, #page-social-media * { font-family: var(--font-inter), "Inter", "Helvetica Neue", Arial, sans-serif; box-sizing: border-box; }

        .sm-head { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--sm-border); padding-bottom: 14px; margin-bottom: 22px; max-width: 1100px; margin-left: auto; margin-right: auto; }
        .sm-head h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; margin: 0; color: var(--text1); }
        .sm-tag { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--amber); border: 1px solid var(--amber); border-radius: 3px; padding: 2px 6px; opacity: 0.85; }
        .sm-tabs { display: inline-flex; gap: 4px; padding: 3px; background: var(--bg2); border: 1px solid var(--sm-border); border-radius: 8px; }
        .sm-tabs button { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 6px 12px; border-radius: 5px; border: 1px solid transparent; background: transparent; color: var(--sm-muted); transition: all 0.12s; }
        .sm-tabs button:hover { color: var(--text1); }
        .sm-tabs button.on { background: var(--cyan); color: #05060a; border-color: var(--cyan); box-shadow: 0 0 12px rgba(33,158,188,0.35); }
        .sm-date { margin-left: auto; font-family: var(--sm-mono); font-size: 14px; color: var(--sm-muted); }
        .sm-refresh { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 12px; border-radius: 5px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .sm-refresh:hover { background: var(--bg4); border-color: var(--cyan); }
        .sm-refresh:active { transform: translateY(1px); }
        .sm-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
        .sm-stop { font-family: var(--sm-mono); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 7px 12px; border-radius: 5px; border: 1px solid rgba(239,68,68,.5); background: rgba(239,68,68,.10); color: var(--sm-red); transition: all 0.12s; margin-left: 6px; }
        .sm-stop:hover { background: rgba(239,68,68,.2); border-color: var(--sm-red); }
        .sm-stop:active { transform: translateY(1px); }
        .sm-stop:disabled { opacity: 0.4; cursor: not-allowed; }
        .sm-ticker { display: inline-flex; align-items: center; gap: 6px; }
        .sm-ticker label { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.10em; text-transform: uppercase; color: var(--sm-muted); }
        .sm-ticker input { width: 88px; font-family: var(--sm-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cyan); background: var(--bg3); border: 1px solid var(--sm-border); border-radius: 5px; padding: 6px 8px; outline: none; transition: border-color 0.12s; }
        .sm-ticker input:focus { border-color: var(--cyan); }
        .sm-ticker-reset { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.06em; cursor: pointer; padding: 5px 7px; border-radius: 4px; border: 1px solid var(--sm-border); background: transparent; color: var(--sm-muted); }
        .sm-ticker-reset:hover { color: var(--cyan); border-color: var(--cyan); }

        .sm-stats { margin-top: 18px; border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .sm-stats-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 8px 12px; background: var(--bg0); border-bottom: 1px solid var(--sm-border); font-family: var(--sm-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cyan); }
        .sm-stats-h small { font-weight: 500; letter-spacing: 0.06em; color: var(--sm-muted); text-transform: none; }
        .sm-stats-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--sm-border); }
        .sm-stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; background: var(--bg1); }
        .sm-stat .k { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sm-muted); }
        .sm-stat .v { font-family: var(--sm-mono); font-size: 14px; font-weight: 700; color: var(--text1); }
        .sm-stat .h { font-size: 9px; letter-spacing: 0.04em; color: var(--sm-muted); opacity: 0.75; }

        .sm-live { font-family: var(--sm-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--cyan); display: flex; align-items: center; gap: 5px; }
        .sm-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); display: inline-block; }

        .sm-grid { display: grid; grid-template-columns: 360px 1fr; gap: 22px; align-items: start; max-width: 1100px; margin: 0 auto; }
        @media (max-width: 820px) { .sm-grid { grid-template-columns: 1fr; } }

        .sm-panel { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 8px; overflow: hidden; }
        .sm-panel-h { font-family: var(--sm-mono); font-size: 17px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sm-muted); padding: 11px 14px; background: var(--bg2); border-bottom: 1px solid var(--sm-border); display: flex; align-items: center; gap: 8px; }
        .sm-panel-b { padding: 16px; }

        .sm-regime { font-family: var(--sm-mono); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--sm-border); }
        .sm-regime.neg { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
        .sm-regime.pos { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.07); }
        .sm-regime-label { font-size: 14px; font-weight: 700; letter-spacing: 0.04em; }
        .sm-regime.neg .sm-regime-label { color: var(--sm-red); }
        .sm-regime.pos .sm-regime-label { color: var(--sm-green); }
        .sm-regime-sub { font-size: 14px; color: var(--sm-muted); margin-top: 4px; }

        .sm-ladder { margin: 4px 0 16px; font-family: var(--sm-mono); font-size: 14px; }
        .sm-ladder-row { display: grid; grid-template-columns: 92px 1fr 72px; align-items: center; gap: 8px; padding: 3px 0; }
        .sm-ladder-row .lab { color: var(--sm-muted); }
        .sm-ladder-row .bar { height: 2px; background: var(--bg4); position: relative; border-radius: 2px; }
        .sm-ladder-row .bar i { position: absolute; top: -3px; height: 8px; width: 8px; border-radius: 50%; transform: translateX(-50%); }
        .sm-ladder-row .val { text-align: right; color: var(--text1); }
        .dot-call i { background: var(--sm-red); }
        .dot-flip i { background: var(--amber); }
        .dot-spot i { background: var(--cyan); box-shadow: 0 0 0 3px rgba(33,158,188,0.18); }
        .dot-put i { background: var(--sm-green); }

        .sm-field { margin-bottom: 11px; }
        .sm-field label { display: block; font-family: var(--sm-mono); font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sm-muted); margin-bottom: 4px; }
        .sm-field input, .sm-field textarea { width: 100%; background: var(--bg0); color: var(--text1); border: 1px solid var(--sm-border); border-radius: 5px; padding: 8px 10px; font-family: var(--sm-mono); font-size: 14px; transition: border-color 0.15s; }
        .sm-field input:focus, .sm-field textarea:focus { outline: none; border-color: var(--cyan); }
        .sm-field textarea { resize: vertical; min-height: 56px; line-height: 1.4; }
        .sm-field .hint { font-size: 14px; color: var(--sm-muted); margin-top: 3px; font-family: var(--sm-mono); }
        .sm-emrange { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; margin-top: 6px; font-family: var(--sm-mono); font-size: 14px; }
        .sm-emrange .lo { color: var(--sm-green); font-weight: 700; }
        .sm-emrange .hi { color: var(--sm-red); font-weight: 700; }
        .sm-emrange .mid { text-align: center; color: var(--sm-muted); font-size: 14px; letter-spacing: 0.04em; }
        .sm-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }


        .sm-out { display: flex; flex-direction: column; gap: 14px; }

        /* ── action buttons under the card ── */
        .sm-share-acts { display: flex; gap: 10px; }
        .sm-btn { font-family: var(--sm-mono); font-size: 14px; font-weight: 700; letter-spacing: 0.04em; cursor: pointer; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--sm-border); background: var(--bg3); color: var(--text1); transition: all 0.12s; }
        .sm-btn:hover { background: var(--bg4); }
        .sm-btn.lg { flex: 1; }
        .sm-btn.x { background: var(--cyan); color: #05060a; border-color: var(--cyan); }
        .sm-btn.x:hover { opacity: 0.9; }
        .sm-btn.discord { background: #5865f2; color: #fff; border-color: #5865f2; }
        .sm-btn.discord:hover { opacity: 0.9; }
        .sm-btn.discord:disabled { opacity: 0.6; cursor: default; }
        .sm-share-hint { font-size: 14px; color: var(--sm-muted); line-height: 1.4; }

        /* ── share card (the exported image) ── */
        .sc-card { background: var(--bg1); border: 1px solid var(--sm-border); border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }
        .sc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--sm-border); padding-bottom: 14px; }
        .sc-title { display: flex; align-items: baseline; gap: 10px; }
        .sc-title .sc-spx { font-size: 26px; font-weight: 800; color: var(--text1); letter-spacing: 0.02em; }
        .sc-title .sc-sub { font-size: 12px; font-weight: 700; letter-spacing: 0.18em; color: var(--sm-muted); }
        .sc-updated { font-size: 12px; color: var(--sm-muted); }

        .sc-section { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-section-h { font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--cyan); margin-bottom: 12px; }
        .sc-em-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
        .sc-em-box { background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 12px; text-align: center; }
        .sc-em-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: var(--sm-muted); margin-bottom: 8px; }
        .sc-em-box .sc-val { font-size: 20px; font-weight: 800; color: var(--text1); letter-spacing: 0.01em; }
        .sc-em-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 12px; color: var(--sm-muted); }

        .sc-regime { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-regime.neg { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.07); }
        .sc-regime.pos { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.07); }
        .sc-regime-label { font-size: 14px; font-weight: 800; letter-spacing: 0.04em; }
        .sc-regime.neg .sc-regime-label { color: var(--sm-red); }
        .sc-regime.pos .sc-regime-label { color: var(--sm-green); }
        .sc-regime-sub { font-size: 12px; color: var(--text1); margin-top: 6px; line-height: 1.45; }
        .sc-regime-bias-h { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: var(--cyan); margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sm-border); }
        .sc-regime-bias { font-size: 12px; font-weight: 700; color: var(--text1); margin-top: 5px; line-height: 1.45; }
        .sc-regime-detail { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sm-border); }
        .sc-regime-item-h { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; color: var(--cyan); }
        .sc-regime-item-v { font-size: 12px; font-weight: 500; color: var(--text1); margin-top: 4px; line-height: 1.4; }

        .sc-levels { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .sc-levels-col { border: 1px solid var(--sm-border); border-radius: 10px; padding: 14px 16px; }
        .sc-levels-h { font-size: 12px; font-weight: 700; letter-spacing: 0.12em; margin-bottom: 12px; color: var(--cyan); }
        .sc-level-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
        .sc-level-row .lab { font-size: 12px; font-weight: 700; color: var(--text1); }
        .sc-level-row .val { font-size: 17px; font-weight: 800; }
        .sc-level-row .val.red { color: var(--sm-red); }
        .sc-level-row .val.green { color: var(--sm-green); }
        .sc-level-row .val.amber { color: var(--amber); }
        .sc-level-row .val.cyan { color: var(--cyan); }

        .sc-ovn { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--bg0); border: 1px solid var(--sm-border); border-radius: 8px; padding: 14px 16px; }
        .sc-ovn .lab { font-size: 12px; font-weight: 700; color: var(--sm-muted); letter-spacing: 0.04em; }
        .sc-ovn .val { font-size: 17px; font-weight: 800; color: var(--text1); }
        .sc-ovn .val .sep { color: var(--sm-muted); margin: 0 6px; }

        .sc-foot { text-align: center; border-top: 1px solid var(--sm-border); padding-top: 16px; }
        .sc-brand { font-size: 17px; font-weight: 800; color: var(--text1); letter-spacing: 0.03em; }
        .sc-disc { font-size: 10px; color: var(--sm-muted); letter-spacing: 0.06em; margin-top: 8px; }
      `}</style>

      <div className="sm-head">
        <h1>Social Media</h1>
        <span className="sm-tag">Admin</span>
        <TickerPicker
          value={ticker}
          onChange={(t) => {
            if (t === ticker) return;
            // A new symbol invalidates every hydrated field, including any the
            // user had edited — clear the dirty guard so the next pull lands.
            dirtyRef.current = false;
            setStats({ ...EMPTY_STATS, ticker: t });
            setGexLadder([]);
            setTicker(t);
          }}
        />
        <SegGroup
          options={[
            { label: "Probe", value: "probe" },
            { label: "Day Posts", value: "dayposts" },
            { label: "Daily Levels", value: "levels" },
            { label: "GEX Image Cards", value: "cards" },
            { label: "Explainer Mockup", value: "explainer" },
            { label: "GEX Data", value: "postgen" },
            { label: "Screenshot Brander", value: "brander" },
          ]}
          active={tab}
          onChange={(v) => setTab(v as "levels" | "cards" | "explainer" | "postgen" | "brander" | "probe" | "dayposts")}
        />
        <span className="sm-live"><i />{refreshing ? "Loading…" : hydrated ? "Loaded" : "Not loaded · on demand"}</span>
        <span className="sm-date">{today}</span>
        <button
          type="button"
          className="sm-refresh"
          onClick={handleRefresh}
          disabled={refreshing}
          title={`Pull ${ticker} stats on demand`}
        >
          {refreshing ? "Loading…" : hydrated ? "↻ Refresh" : "⤓ Load data"}
        </button>
        <button
          type="button"
          className="sm-stop"
          onClick={handleStopAll}
          disabled={!hydrated && !refreshing}
          title="Stop all data and disconnect — returns the page to on-demand idle"
        >
          ◼ Stop data
        </button>
      </div>

      {tab === "cards" && <GexImageCards updated={updatedLabel} today={today} form={form} ticker={ticker} />}
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
          gexBasis={gexBasis}
          onBasisChange={(b) => {
            if (b === gexBasis) return;
            // Switching basis re-pulls the GEX read even after manual edits.
            dirtyRef.current = false;
            setGexBasis(b);
          }}
          ticker={ticker}
        />
      )}
      {tab === "postgen" && <PostGenerator form={form} ticker={ticker} />}
      {tab === "brander" && <ScreenshotBrander />}
      {tab === "probe" && <OptionsProbe />}
      {tab === "dayposts" && <DayPosts key={ticker} form={form} ticker={ticker} />}

      <div className="sm-grid" style={tab !== "levels" ? { display: "none" } : undefined}>
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
                <label>{ticker} Spot</label>
                <input value={form.spot} onChange={(e) => setField("spot", e.target.value)} />
              </div>
              <div className="sm-field">
                <label>{ticker} Prior Close</label>
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
              <label>{ticker === LIVE_FEED_TICKER ? "ES Overnight (H / L)" : "Prior Day (H / L)"}</label>
              <input value={form.ovn} onChange={(e) => setField("ovn", e.target.value)} placeholder="high / low" />
            </div>
            <div className="sm-field">
              <label>Bias · from Greeks flow regime</label>
              <textarea value={form.bias} onChange={(e) => setField("bias", e.target.value)} />
              <div className="hint">pre-filled from options-flow regime — edit on event days</div>
            </div>

            <StatsPanel stats={stats} ticker={ticker} />

          </div>
        </div>

        {/* RIGHT: share card (auto-filled from the left) + copy/X actions */}
        <div className="sm-out">
          <ShareCard ref={cardRef} form={form} regime={regime} updated={updatedLabel} ticker={ticker} />
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

          <TweetMockup
            title="Tweet preview — Daily Levels"
            getBlob={renderCardBlob}
            caption={`Todays $${ticker} Levels\nprovided by https://www.cbedge.net/`}
            refreshKey={`${ticker}-${updatedLabel}-${form.spot}-${form.flip}-${form.call}-${form.put}-${form.gex}`}
          />
        </div>
      </div>
    </div>
  );
}
