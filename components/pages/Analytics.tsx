"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useScannerTickers } from "@/lib/useScannerTickers";
import { HOME_THEME, homeButtonStyle, homeSecondaryButtonStyle, LEVEL_COLORS } from "@/components/shared/homeTheme";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeAmt, type InitialBalance, type AmtResult } from "@/lib/failLevels";
import EconCalendarPanel from "@/components/dashboard/EconCalendarPanel";

/* ────────────────────────────────────────────────────────────────────────────
 * Analytics — strategy builder. UI-only scaffold with MOCK data.
 * Each card below renders its intended shape so we can agree on the layout
 * before wiring real data source-by-source.
 * ──────────────────────────────────────────────────────────────────────────── */

// ── shared inline helpers ───────────────────────────────────────────────────
const T = HOME_THEME;

function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, opacity: 0.7 }}>
      {children}
    </span>
  );
}

function Value({ children, color = T.text, size = 21 }: { children: ReactNode; color?: string; size?: number }) {
  return <span style={{ fontFamily: "var(--font-mono)", fontSize: size, fontWeight: 800, color }}>{children}</span>;
}

// True green for positives on this page only. HOME_THEME.green (#8ECAE6) reads
// as light blue, so for clear pos/neg signal we use a real green here.
const POS_GREEN = "#22C55E";

// Sign → color. Positive = green, negative = red, zero/unknown = muted.
function signColor(n: number): string {
  if (n > 0) return POS_GREEN;
  if (n < 0) return T.red;
  return T.muted;
}
function Stat({ label, value, color, size = 21 }: { label: ReactNode; value: ReactNode; color?: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Label>{label}</Label>
      <Value color={color} size={size}>{value}</Value>
    </div>
  );
}

function Row({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, ...style }}>{children}</div>;
}


function PillSelect<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          style={o === value ? homeButtonStyle : homeSecondaryButtonStyle}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const divider: CSSProperties = { height: 1, background: T.border, margin: "10px 0" };

// Small generic JSON-fetch hook with loading/error + 30s auto-refresh.
function useLiveData<R>(url: string | null, refreshMs = 120_000) {
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null); // ms of last successful fetch

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as R);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    if (!url || !refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, url, refreshMs]);

  return { data, loading, error, lastUpdated, reload: load };
}

// "updated 3:42:18 PM ET" footer — stamped at each card's last successful fetch.
function UpdatedStamp({ at }: { at: number | null }) {
  const text = at == null
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
      }).format(at) + " ET";
  return (
    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.55, marginTop: "auto", paddingTop: 6, textAlign: "right" }}>
      updated {text}
    </span>
  );
}

// ET today (YYYY-MM-DD) — used as the ?date= param for snapshot endpoints.
function etDateISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

// Format a raw GEX/DEX dollar figure into "+1.2B" / "-840M".
function fmtBig(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "-";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

// True only for the first `ms` after mount — used to distinguish "still loading"
// from "loaded but empty" for feeds (like useEsCandles) that don't expose a
// ready flag, so a card with no data eventually shows its placeholder instead of
// spinning forever.
function useGrace(ms = 4000): boolean {
  const [grace, setGrace] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setGrace(false), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return grace;
}

// Dashed placeholder box for empty/no-data states (matches Strategy Output).
function Placeholder({ children, minHeight = 70 }: { children: ReactNode; minHeight?: number }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        minHeight, borderRadius: 10, border: `1px dashed ${T.border}`,
        color: T.muted, fontSize: 12, fontStyle: "italic", textAlign: "center",
        padding: "8px 12px", opacity: 0.8,
      }}
    >
      {children}
    </div>
  );
}

// Loading / error / empty state for a card body. Renders a dashed placeholder so
// a card never looks broken when its feed is empty.
function CardState({ loading, error, empty = "No data yet" }: { loading: boolean; error: string | null; empty?: ReactNode }) {
  if (loading) return <Placeholder>Loading…</Placeholder>;
  if (error) return <Placeholder><span style={{ color: T.red }}>⚠ {error}</span></Placeholder>;
  return <Placeholder>{empty}</Placeholder>;
}

// ── 1. MULTI GREEK ───────────────────────────────────────────────────────────
// Per-strike greek exposure, computed client-side from a /api/chains payload —
// same formula as the options-chain page's parseExpiration (OI+Vol basis).
type GreekKey = "GEX" | "DEX" | "CHEX" | "VEX";
interface PeakGreek { strike: number; value: number }

// Per-strike greek totals from a /api/chains payload. Extracted so the peak-strike
// card and the net-total card share ONE definition of the OI+Vol formula — two
// copies would inevitably drift and print two different GEX numbers for QQQ on
// the same page.
type ChainGreeks = { gex: number; dex: number; chex: number; vex: number };

// `expiry` (optional) narrows the accumulation to ONE expiration-date group.
// The Ticker Lookup card at the bottom of this page needs a per-expiry ladder
// and must not grow its own copy of this formula to get one.
function accumulateChainGreeks(payload: unknown, expiry: string | null = null): Map<number, ChainGreeks> {
  type MgLeg = Record<string, unknown>;
  const data = (payload as { data?: { items?: unknown[]; underlyingPrice?: unknown } })?.data;
  const all = (data?.items as { strikes?: unknown[]; "expiration-date"?: unknown }[]) ?? [];
  const items = expiry == null ? all : all.filter((g) => String(g["expiration-date"]) === expiry);
  const S = numOr(data?.underlyingPrice) ?? 0;
  const acc = new Map<number, ChainGreeks>();
  const n = (o: MgLeg | undefined, k: string) => {
    const v = o?.[k];
    const num = Number(v);
    return v != null && v !== "" && isFinite(num) ? num : 0;
  };
  const cnt = (o: MgLeg | undefined) =>
    o ? (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0) +
        (parseInt(String(o.volume ?? 0), 10) || 0) : 0;

  for (const group of items) {
    for (const s of (group.strikes ?? []) as MgLeg[]) {
      const strike = parseFloat(String(s["strike-price"] ?? 0));
      if (!strike) continue;
      const c = s.call as MgLeg | undefined;
      const p = s.put as MgLeg | undefined;
      const cc = cnt(c), pc = cnt(p);
      if (cc === 0 && pc === 0) continue;
      const e = acc.get(strike) ?? { gex: 0, dex: 0, chex: 0, vex: 0 };
      e.gex += (n(c, "gamma") * cc - n(p, "gamma") * pc) * S * S * 0.01 * 100;
      e.dex += (Math.abs(n(c, "delta")) * cc - Math.abs(n(p, "delta")) * pc) * S * 100;
      e.chex += (-n(c, "theta") * cc + n(p, "theta") * pc) * S * 100;
      e.vex += (n(c, "vega") * cc - n(p, "vega") * pc) * S * 100;
      acc.set(strike, e);
    }
  }
  return acc;
}

// Sum every strike → the four net totals, in RAW dollars (fmtBig-ready). Used
// for the tickers no recorder writes a greeks_ts series for (QQQ / SPY).
function computeNetGreeks(payload: unknown): ChainGreeks | null {
  const acc = accumulateChainGreeks(payload);
  if (!acc.size) return null;
  const t: ChainGreeks = { gex: 0, dex: 0, chex: 0, vex: 0 };
  for (const v of acc.values()) { t.gex += v.gex; t.dex += v.dex; t.chex += v.chex; t.vex += v.vex; }
  return t;
}

function computePeakGreeks(payload: unknown): Record<GreekKey, PeakGreek | null> {
  const acc = accumulateChainGreeks(payload);

  const peakFor = (sel: (v: ChainGreeks) => number): PeakGreek | null => {
    let best: PeakGreek | null = null;
    for (const [strike, v] of acc) {
      const val = sel(v);
      if (best == null || Math.abs(val) > Math.abs(best.value)) best = { strike, value: val };
    }
    return best;
  };

  return {
    GEX: peakFor((v) => v.gex),
    DEX: peakFor((v) => v.dex),
    CHEX: peakFor((v) => v.chex),
    VEX: peakFor((v) => v.vex),
  };
}

function MultiGreekCard() {
  const [tk, setTk] = useState<"SPX" | "QQQ" | "SPY">("SPX");
  const { data, loading, error, lastUpdated } = useLiveData<unknown>(`/api/chains?ticker=${tk}&range=all`, 60_000);
  const peaks = data ? computePeakGreeks(data) : null;
  const order: GreekKey[] = ["GEX", "DEX", "CHEX", "VEX"];
  const hasAny = peaks ? order.some((k) => peaks[k] != null) : false;

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Multi Greek</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>peak strike</span>
      </Row>
      <PillSelect value={tk} options={["SPX", "QQQ", "SPY"] as const} onChange={setTk} />
      {loading || error || !hasAny ? (
        <CardState loading={loading} error={error} empty={`No live chain for ${tk}.`} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {order.map((k) => {
            const pk = peaks![k];
            return (
              <div key={k} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 3 }}>
                <Label>{k} · peak strike</Label>
                <Value color={pk ? signColor(pk.value) : T.muted} size={20}>{pk ? pk.strike.toLocaleString() : "—"}</Value>
                <span style={{ fontSize: 17, color: pk ? signColor(pk.value) : T.muted, opacity: 0.7, fontFamily: "var(--font-mono)" }}>
                  {pk ? fmtBig(pk.value) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 2. ESTIMATED MOVE ─────────────────────────────────────────────────────────
interface LevelsRow {
  close?: string; em?: string; up?: string; down?: string; error?: string;
}
interface QuotesResp { data?: { items?: Array<Record<string, unknown>> } }

// Parse a stored level string ("6,112.5") or any numeric into a number.
const numOr = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : null;
};

type EmTicker = "ESU" | "NQU" | "SPX" | "SPY" | "QQQ";
const EM_TICKERS: readonly EmTicker[] = ["ESU", "NQU", "SPX", "SPY", "QQQ"];
// Futures quote under the front-contract symbol (proxy resolves /NQU26 → live);
// equities/index quote under their plain symbol.
const EM_QUOTE_SYMBOL: Record<EmTicker, string> = {
  ESU: "/ESU26", NQU: "/NQU26", SPX: "SPX", SPY: "SPY", QQQ: "QQQ",
};

function EstimatedMoveCard() {
  const [tk, setTk] = useState<EmTicker>("SPX");
  const { data: lv, loading: lvLoading, error: lvError, lastUpdated } = useLiveData<LevelsRow>(`/api/levels?ticker=${tk}`);
  const { data: q } = useLiveData<QuotesResp>(`/api/tt-quotes?symbols=${encodeURIComponent(EM_QUOTE_SYMBOL[tk])}`, 15_000);

  const up = numOr(lv?.up);
  const down = numOr(lv?.down);
  const close = numOr(lv?.close); // weekly close the EM bands were built from

  // Live spot if a quote is available; else stored close; else the EM midpoint
  // (so futures with no quote/close still render sane bands instead of /0).
  const item = q?.data?.items?.[0];
  const liveSpot =
    numOr(item?.last) ?? numOr(item?.["last-price"]) ?? numOr(item?.mark) ??
    numOr(item?.["mark-price"]) ?? numOr(item?.close);
  const midpoint = up != null && down != null ? (up + down) / 2 : null;
  const spotRaw = liveSpot ?? close ?? midpoint;
  // Reject a non-positive spot (0/blank quote) — fall back to midpoint.
  const spot = spotRaw != null && spotRaw > 0 ? spotRaw : midpoint;
  const spotIsLive = liveSpot != null && liveSpot > 0;

  // Card renders as soon as the EM bands exist — spot falls back to close/mid.
  const ready = up != null && down != null && spot != null && spot > 0;
  const distUp = ready ? up! - spot! : 0;
  const distDown = ready ? spot! - down! : 0;
  const nearerUp = distUp <= distDown;
  const near = nearerUp ? distUp : distDown; // signed gap to nearer band:
  // > 0 = band not yet reached, < 0 = price has crossed it.
  const crossed = near < 0;

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Estimated Move</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>weekly</span>
          <Link
            href="/em"
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
              color: T.cyan, textDecoration: "none", border: `1px solid ${T.border}`,
              borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap",
            }}
          >
            More →
          </Link>
        </div>
      </Row>
      <PillSelect value={tk} options={EM_TICKERS} onChange={setTk} />
      {lvLoading || lvError || !ready ? (
        <CardState loading={lvLoading} error={lvError} empty={`No published EM for ${tk}.`} />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, minWidth: 0 }}>
            <Stat label="EM Up" value={up!.toLocaleString()} color={POS_GREEN} size={18} />
            <Stat label={spotIsLive ? "Spot" : close != null && close > 0 ? "Close" : "Mid"} value={spot!.toLocaleString(undefined, { maximumFractionDigits: 2 })} size={18} />
            <Stat label="EM Down" value={down!.toLocaleString()} color={T.red} size={18} />
          </div>
          <div style={divider} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label>Distance to nearer band ({nearerUp ? "Up" : "Down"}){crossed ? " · crossed" : ""}</Label>
            <Row>
              <Value color={crossed ? T.red : POS_GREEN} size={18}>
                {crossed ? "-" : ""}{Math.abs(near).toLocaleString(undefined, { maximumFractionDigits: 1 })} pts
              </Value>
              <Value color={T.muted} size={14}>
                {((Math.abs(near) / spot!) * 100).toFixed(2)}%
              </Value>
            </Row>
          </div>
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 3. PREMARKET (ES gap logic) ───────────────────────────────────────────────
interface EsGapResp {
  date?: string;
  gap?: {
    prior_close?: number;
    open_0930?: number;
    gap_pts?: number;
    gap_dir?: string;
    pct_filled?: number;
    filled?: boolean | number;
  } | null;
}

interface PremarketSummaryResp {
  summary?: { date?: string; bullets?: string[]; generated_at?: number } | null;
  error?: string;
}

// Current ET wall-clock parts (weekday 0=Sun..6=Sat, minutes-since-midnight).
function nowEtClock(): { dow: number; mins: number; dateISO: string } {
  const now = new Date();
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dow: DOW[get("weekday")] ?? 0,
    mins: Number(get("hour")) * 60 + Number(get("minute")),
    dateISO: etDateISO(),
  };
}

// The next premarket session's date (the cron writes weekdays ~08:00 ET). After
// 4pm ET, or on a weekend, roll forward to the next weekday.
function nextPremarketDate(): string {
  const { dow, mins } = nowEtClock();
  const rollForward = mins >= 16 * 60 || dow === 0 || dow === 6; // after RTH close / weekend
  // Build a Date at noon ET today, then add days until it's a weekday we want.
  const base = new Date(`${etDateISO()}T12:00:00-05:00`);
  let add = rollForward ? 1 : 0;
  // skip weekends
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime() + add * 86400000);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) break;
    add++;
  }
  const target = new Date(base.getTime() + add * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(target);
}

function PremarketCard() {
  // AI 5-bullet read of the global pre-market tape. Written daily by the VPS cron
  // (premarket-summary-generator.js → premarket_summary); the card just reads the
  // latest stored row — same pattern as the Traders Dashboard overview.
  const { data, loading, error, lastUpdated } = useLiveData<PremarketSummaryResp>(
    "/api/premarket-summary",
    5 * 60_000
  );
  // Live ES gap shown as a compact footer.
  const { data: gapData } = useLiveData<EsGapResp>(`/api/es-gap?date=${etDateISO()}`);

  const bullets = data?.summary?.bullets ?? [];
  const sumDate = data?.summary?.date ?? null;
  // The summary is only valid for the upcoming session. Any stored summary whose
  // date isn't the next premarket session is stale (e.g. Friday's read on a
  // Monday pre-open, or the prior session after 4pm) — show the "coming" message.
  const nextDate = nextPremarketDate();
  const isStale = sumDate !== nextDate;
  // Bullets show only 08:00–16:00 ET (isStale rolls to the next session at 4pm).
  // Outside that window — before 8am, after the 4pm close, weekends — show this.
  const emptyMsg = "Summary will be up at 8:00 AM Eastern.";
  const g = gapData?.gap ?? null;
  const gapPts = g?.gap_pts ?? null;
  const up = (gapPts ?? 0) > 0;

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Premarket</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>{isStale ? nextDate : sumDate ?? ""}</span>
      </Row>
      {loading || error || bullets.length === 0 || isStale ? (
        <CardState loading={loading} error={error ?? data?.error ?? null} empty={emptyMsg} />
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.12) transparent" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 17, lineHeight: 1.45, color: T.text }}>{b}</li>
          ))}
        </ul>
      )}
      {gapPts != null && (
        <>
          <div style={divider} />
          <span style={{ fontSize: 14, color: T.muted, opacity: 0.8, fontFamily: "var(--font-mono)" }}>
            /ES gap: <span style={{ color: up ? POS_GREEN : T.red }}>{up ? "+" : ""}{gapPts.toFixed(2)} pts</span>
            {g?.prior_close ? ` (${((gapPts / g.prior_close) * 100).toFixed(2)}%)` : ""}
          </span>
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 4. ECONOMIC CALENDAR ──────────────────────────────────────────────────────
// Delegates to the full EconCalendarPanel (same component the home page uses).
// It includes: colored left-border event rows, A:/F:/P: data, day separators,
// stale-event fading, filter dropdown, and the earnings logo strip at the bottom.
function EconCalendarCard() {
  return (
    <Card variant="budget" padding={0} style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: 480 }}>
      <EconCalendarPanel todayOnly hideToolbar />
    </Card>
  );
}

// ── 5. CONFIDENCE SCORE ───────────────────────────────────────────────────────
interface MvcSegment {
  strike: number;
  from: string;            // "HH:MM" ET when this strike became the MVC
  to: string;              // "HH:MM" ET of its last snapshot
  touched: boolean;
  outcome: "hit" | "pivot" | "chop" | "miss";
}
interface ConfidenceResp {
  level?: number;          // current MVC price level
  price?: number;          // SPX price at the snapshot
  spx?: number;
  thresholds?: { hitPts?: number };
  // score.hit/pivot/chop/break are 0..100 (NOT fractions).
  score?: { hit?: number; pivot?: number; chop?: number; break?: number };
  mvcTimeline?: MvcSegment[];
  error?: string;
}

// "H:MM"/"HH:MM" ET → minutes-of-day.
function hhmmToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// The MVC segment active at a target ET minute (the last one whose window had
// started by then). If the target is before the first snapshot of the day but
// the session has data, fall back to the earliest segment — that's the CB that
// was in force at/around the open, which is what the early checkpoints want.
function segmentAt(timeline: MvcSegment[] | undefined, targetMin: number): MvcSegment | null {
  if (!timeline?.length) return null;
  let best: MvcSegment | null = null;
  for (const seg of timeline) {
    const from = hhmmToMin(seg.from);
    if (from != null && from <= targetMin) best = seg;
  }
  // Target earlier than the first segment's start → use the first segment.
  if (best == null) best = timeline[0];
  return best;
}

// MVC checkpoints the card pins hit/miss against.
const MVC_CHECKPOINTS: Array<{ label: string; min: number }> = [
  { label: "9:45", min: 9 * 60 + 45 },
  { label: "10:30", min: 10 * 60 + 30 },
  { label: "12:00", min: 12 * 60 },
];

// outcome → short label + color. hit/pivot/chop all "engaged" the level; miss = never reached.
function outcomeChip(o: MvcSegment["outcome"] | null): { text: string; color: string } {
  if (o == null) return { text: "—", color: T.muted };
  if (o === "miss") return { text: "MISS", color: T.red };
  if (o === "hit") return { text: "HIT", color: POS_GREEN };
  if (o === "pivot") return { text: "HIT", color: POS_GREEN };
  return { text: "HIT · CHOP", color: T.orange }; // chop
}

// "Xm Ys" elapsed formatter.
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function ConfidenceCard() {
  const [data, setData] = useState<ConfidenceResp | null>(null);
  const [forDate, setForDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // MVC-change tracking: remember the prior level + when it changed, and whether
  // price has reached the new level since (so the timer can stop).
  const prevLevelRef = useRef<number | null>(null);
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const [hitAfterChange, setHitAfterChange] = useState(false);
  const [now, setNow] = useState(Date.now()); // 1s tick for the live elapsed display

  const load = useCallback(async () => {
    setError(null);
    try {
      // Always score today — show empty state if no snapshots yet rather than
      // falling back to a prior session.
      const today = etDateISO();
      const date = today;

      const res = await fetch(`/api/confidence?date=${date}`, { cache: "no-store" });
      const json = (await res.json()) as ConfidenceResp;
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      // Detect MVC level change.
      const newLevel = json.level ?? null;
      const prev = prevLevelRef.current;
      if (newLevel != null && prev != null && Math.round(newLevel) !== Math.round(prev)) {
        setChangedAt(Date.now());
        setHitAfterChange(false);
      }
      // Has price reached the (current) level? Stops the change timer.
      const hitPts = json.thresholds?.hitPts ?? 8;
      const px = json.price ?? json.spx;
      if (newLevel != null && px != null && Math.abs(px - newLevel) <= hitPts) {
        setHitAfterChange(true);
      }
      if (newLevel != null) prevLevelRef.current = newLevel;

      setData(json);
      setForDate(date);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, [load]);

  // 1s clock so the "changed" elapsed timer ticks live (only while running).
  useEffect(() => {
    if (changedAt == null || hitAfterChange) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [changedAt, hitAfterChange]);

  const s = data?.score;
  const score = s?.hit != null ? Math.round(s.hit) : null; // already 0..100
  const mvc = data?.level ?? null;
  const px = data?.price ?? data?.spx ?? null;
  const distToMvc = mvc != null && px != null ? px - mvc : null; // +above / −below
  const today = etDateISO();
  const isStale = false; // always scoring today
  const band =
    s == null ? "—"
    : (s.hit ?? 0) >= (s.pivot ?? 0) && (s.hit ?? 0) >= (s.chop ?? 0) ? "HIT"
    : (s.pivot ?? 0) >= (s.chop ?? 0) ? "PIVOT"
    : "CHOP";
  const bandColor = band === "HIT" ? POS_GREEN : band === "PIVOT" ? T.orange : T.red;
  const showChange = changedAt != null;

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
          Confidence Score
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: T.orange, opacity: 0.85, verticalAlign: "middle" }}>BETA</span>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {forDate && (
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>{forDate}</span>
          )}
          <Link
            href="/confidence-score"
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase",
              color: T.cyan, textDecoration: "none", border: `1px solid ${T.border}`,
              borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap",
            }}
          >
            More →
          </Link>
        </div>
      </Row>
      {loading || error || score == null ? (
        <CardState loading={loading} error={error} empty="Waiting for today's first CB snapshot." />
      ) : (
        <>
          <Row>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <Value color={bandColor} size={34}>{score}</Value>
              <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>/100</span>
            </div>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", color: bandColor }}>{band}</span>
          </Row>
          <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}>
            <div style={{ width: `${score}%`, height: "100%", background: bandColor }} />
          </div>
          <Row>
            <Stat label="Current SPX CB" value={mvc != null ? Math.round(mvc).toLocaleString() : "—"} color={T.cyan} />
            <Stat
              label="Distance to CB"
              value={distToMvc != null ? `${distToMvc >= 0 ? "+" : ""}${distToMvc.toFixed(1)}` : "—"}
              color={distToMvc == null ? T.muted : Math.abs(distToMvc) <= (data?.thresholds?.hitPts ?? 8) ? POS_GREEN : T.text}
            />
          </Row>

          {/* CB at the 9:35 / 10:30 / 12:00 ET checkpoints + hit/miss. */}
          <div style={divider} />
          <Label>CB checkpoints</Label>
          {(() => {
            const nowMin = nowEtMinutesSec().min;
            const isToday = !isStale;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {MVC_CHECKPOINTS.map((cp, ci) => {
                  const seg = segmentAt(data?.mvcTimeline, cp.min);
                  const prevSeg = ci > 0 ? segmentAt(data?.mvcTimeline, MVC_CHECKPOINTS[ci - 1].min) : null;
                  // On today's live session a checkpoint in the future hasn't happened yet.
                  const future = isToday && nowMin < cp.min;
                  // Is this checkpoint's CB the one still LIVE right now? True when it's
                  // today, the checkpoint has passed, and no later checkpoint that has
                  // already occurred changed the strike (i.e. this is the active CB).
                  const laterChanged = isToday && MVC_CHECKPOINTS.some((o, oi) =>
                    oi > ci && nowMin >= o.min && segmentAt(data?.mvcTimeline, o.min)?.strike !== seg?.strike);
                  const live = isToday && !future && !laterChanged;
                  // Did the CB change from the previous checkpoint to this one?
                  const cbChanged = seg != null && prevSeg != null && seg.strike !== prevSeg.strike;
                  // If this checkpoint says "pivot" but a later checkpoint has a lower strike,
                  // it wasn't a pivot — it was just a hit. Override to "HIT" only.
                  const laterLower = seg && ci < MVC_CHECKPOINTS.length - 1
                    ? MVC_CHECKPOINTS.slice(ci + 1).some((o, oi) => {
                        const laterSeg = segmentAt(data?.mvcTimeline, o.min);
                        return laterSeg && laterSeg.strike < seg.strike;
                      })
                    : false;
                  // Priority: future → pending. Past with outcome → show it.
                  // Only fall through to "pending" when the checkpoint has passed
                  // but the segment has no outcome yet (still in-progress).
                  const chip = future
                    ? { text: "pending", color: T.muted }
                    : seg?.outcome === "pivot" && laterLower
                      ? { text: "HIT", color: POS_GREEN }
                      : seg?.outcome != null
                        ? outcomeChip(seg.outcome)
                        : live && cbChanged
                          ? { text: "CB CHANGED · PENDING", color: T.orange }
                          : { text: "pending", color: T.muted };
                  return (
                    <div
                      key={cp.label}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "46px 64px 1fr",
                        alignItems: "center",
                        columnGap: 8,
                        borderBottom: `1px solid ${T.border}`,
                        paddingBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: T.muted }}>{cp.label}</span>
                      <span style={{ textAlign: "right" }}>
                        <Value size={14} color={T.cyan}>{seg ? Math.round(seg.strike).toLocaleString() : "—"}</Value>
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: chip.color, textAlign: "right", whiteSpace: "nowrap" }}>
                        {chip.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {showChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, paddingTop: 2 }}>
              <span style={{ fontWeight: 800, letterSpacing: "0.06em", color: T.orange }}>CB CHANGED</span>
              {hitAfterChange ? (
                <span style={{ color: POS_GREEN, fontWeight: 700 }}>hit ✓</span>
              ) : (
                <span style={{ color: T.muted, fontFamily: "var(--font-mono)" }}>
                  {fmtElapsed(now - changedAt!)} — awaiting hit
                </span>
              )}
            </div>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 6. NET GREEKS (totals + 15m/30m change) ───────────────────────────────────
// greeks_ts row: gex/dex in $B, chex/vex in $M (see /api/snapshots/greeks POST).
interface GreeksTsRow {
  timestamp: number;
  gex: number; dex: number; chex: number; vex: number;
}
interface GreeksTsResp { rows?: GreeksTsRow[] }

// Convert stored greek (B for gex/dex, M for chex/vex) → raw $ for fmtBig.
const GREEK_SCALE: Record<"gex" | "dex" | "chex" | "vex", number> = {
  gex: 1e9, dex: 1e9, chex: 1e6, vex: 1e6,
};

// Find the row whose timestamp is closest to (latestTs - minsAgo), within ±tol.
function rowNearestAgo(rows: GreeksTsRow[], latestTs: number, minsAgo: number, tolMin = 6): GreeksTsRow | null {
  // pg BIGINT timestamps can arrive as strings — coerce so subtraction is numeric.
  const target = Number(latestTs) - minsAgo * 60_000;
  let best: GreeksTsRow | null = null;
  let bestDiff = Infinity;
  for (const r of rows) {
    const diff = Math.abs(Number(r.timestamp) - target);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best && bestDiff <= tolMin * 60_000 ? best : null;
}

// SPX is the only ticker with a recorded series (greeks-ts-writer.js is $SPX-only
// and reads /proxy/gex, which is a single-symbol engine). QQQ and SPY therefore
// come from the live chain instead — same OI+Vol math, but no stored history, so
// they get totals without the Δ15m/Δ30m columns.
type NgTicker = "SPX" | "QQQ" | "SPY";
const NG_TICKERS: readonly NgTicker[] = ["SPX", "QQQ", "SPY"];

function GreeksCard() {
  const [tk, setTk] = useState<NgTicker>("SPX");
  const isSpx = tk === "SPX";
  const today = etDateISO();
  // Today's series (ascending). Empty pre-open / overnight because the writer is
  // RTH-gated — so we fall back to the most recent prior session below.
  const { data, loading, error, lastUpdated } = useLiveData<GreeksTsResp>(
    isSpx ? `/api/snapshots/greeks?date=${today}&limit=5000` : null
  );
  // Latest-available row regardless of date — only used when today has none yet,
  // so the card shows the last session's net greeks instead of going blank.
  const { data: latest } = useLiveData<GreeksTsResp>(isSpx ? `/api/snapshots/greeks?limit=1` : null, 60_000);
  // QQQ / SPY: sum the whole chain live. Same endpoint + formula the Multi Greek
  // card above uses, so the two cards agree on the same ticker.
  const { data: chain, loading: chainLoading, error: chainError, lastUpdated: chainAt } =
    useLiveData<unknown>(isSpx ? null : `/api/chains?ticker=${tk}&range=all`, 60_000);

  const todayRows = data?.rows ?? [];
  const usingFallback = isSpx && todayRows.length === 0 && (latest?.rows?.length ?? 0) > 0;
  // Fallback endpoint returns newest-first (limit 1); today series is ascending.
  const rows = usingFallback ? (latest!.rows as GreeksTsRow[]) : todayRows;
  const spxCur = usingFallback
    ? rows[0]
    : rows.length ? rows[rows.length - 1] : null;
  const staleDate = usingFallback ? (spxCur as GreeksTsRow & { date?: string })?.date ?? null : null;
  // Intraday deltas only make sense on today's live series, not the 1-row fallback.
  const ago15 = spxCur && !usingFallback ? rowNearestAgo(rows, spxCur.timestamp, 15) : null;
  const ago30 = spxCur && !usingFallback ? rowNearestAgo(rows, spxCur.timestamp, 30) : null;

  // Both sources normalised to RAW dollars so the tiles below never branch:
  // greeks_ts stores $B/$M, the chain sum is already raw.
  const cur: ChainGreeks | null = isSpx
    ? spxCur
      ? { gex: spxCur.gex * GREEK_SCALE.gex, dex: spxCur.dex * GREEK_SCALE.dex,
          chex: spxCur.chex * GREEK_SCALE.chex, vex: spxCur.vex * GREEK_SCALE.vex }
      : null
    : chain ? computeNetGreeks(chain) : null;

  const deltaFor = (k: "gex" | "dex" | "chex" | "vex", ago: GreeksTsRow | null) =>
    isSpx && spxCur && ago ? (spxCur[k] - ago[k]) * GREEK_SCALE[k] : null;

  // While the today fetch is still loading we don't yet know if we'll need the
  // fallback — only spin if BOTH have no data.
  const showLoading = (isSpx ? loading : chainLoading) && !cur;
  const showError = isSpx ? error : chainError;

  const keys: Array<{ g: string; k: "gex" | "dex" | "chex" | "vex" }> = [
    { g: "Net GEX", k: "gex" },
    { g: "Net DEX", k: "dex" },
    { g: "Net CHEX", k: "chex" },
    { g: "Net VEX", k: "vex" },
  ];

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Net Greeks</span>
        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>
          {!isSpx ? "live chain" : usingFallback ? `last session · ${staleDate ?? ""}` : "now · Δ15m · Δ30m"}
        </span>
      </Row>
      <PillSelect value={tk} options={NG_TICKERS} onChange={setTk} />
      {showLoading || showError || !cur ? (
        <CardState loading={showLoading} error={showError} empty={isSpx ? "No greeks series yet." : `No live chain for ${tk}.`} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {keys.map(({ g, k }) => {
            const nowVal = cur[k];
            const d15 = deltaFor(k, ago15);
            const d30 = deltaFor(k, ago30);
            return (
              <div key={g} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                <Label>{g}</Label>
                <Value color={nowVal > 0 ? POS_GREEN : nowVal < 0 ? T.red : T.text} size={28}>{fmtBig(nowVal)}</Value>
                <div style={{ display: "flex", gap: 10, fontFamily: "var(--font-mono)", fontSize: 14 }}>
                  <span style={{ opacity: d15 == null ? 0.5 : 1 }}>
                    <span style={{ color: T.text }}>15m</span>{" "}
                    <span style={{ color: d15 == null ? T.muted : signColor(d15) }}>{d15 == null ? "—" : fmtBig(d15)}</span>
                  </span>
                  <span style={{ opacity: d30 == null ? 0.5 : 1 }}>
                    <span style={{ color: T.text }}>30m</span>{" "}
                    <span style={{ color: d30 == null ? T.muted : signColor(d30) }}>{d30 == null ? "—" : fmtBig(d30)}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <UpdatedStamp at={isSpx ? lastUpdated : chainAt} />
    </Card>
  );
}

// ── 7. INITIAL BALANCE ────────────────────────────────────────────────────────
// IB window 09:30–10:30 ET. Returns minutes-of-day in ET + a countdown string to
// the next IB phase ("starts in" before 9:30, "forming — Xm left" until 10:30).
const IB_OPEN_MIN = 9 * 60 + 30;
const IB_END_MIN = 10 * 60 + 30;

// Rule interface & evaluation
interface AppliedRule { title: string; detail: string; color: string; }

function applicableRules(ib: InitialBalance | null): AppliedRule[] {
  if (!ib) return [];
  const out: AppliedRule[] = [];

  const { min } = nowEtMinutesSec();
  const done = min >= IB_END_MIN;
  const tag = done ? "" : " (provisional — IB still forming)";
  const preBreak = !ib.brokeHigh && !ib.brokeLow;

  // Lead notice
  if (!done) {
    out.push({ title: "IB Forming · Provisional Reads", color: "#ffb300",
      detail: `Tracking the 9:30–10:30 ET range live — current IB H/L ${ib.high.toFixed(2)} / ${ib.low.toFixed(2)}. The reads below use the developing range and can still change; they lock at 10:30 ET.` });
  } else {
    out.push({ title: "Inside Day Exception", color: "#219EBC",
      detail: "IB window complete. Only 0.6% of days stay fully inside the IB — plan for at least one breakout." });
  }

  // Timing curve
  const { min: nowMins } = nowEtMinutesSec();
  if (done && !ib.brokeHigh && !ib.brokeLow && nowMins > 11 * 60) {
    out.push({ title: "Timing Curve · Range Mode", color: "#ffffff",
      detail: "Past 11:00 ET with no breakout — 84.1% of breakouts hit by now. Shift from breakout to range/premium-decay playbook." });
  }

  if (ib.brokeHigh && !ib.brokeLow) {
    out.push({ title: "Single-Break Trend Day", color: "#00e676",
      detail: `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break${tag}.` });
  } else if (ib.brokeLow && !ib.brokeHigh) {
    out.push({ title: "Single-Break Trend Day", color: "#00e676",
      detail: `One clean side broken — modern ES regime: 75.59% single-break trend days, 22.05% double-breach risk. Respect the first break${tag}.` });
  } else if (ib.brokeHigh && ib.brokeLow) {
    out.push({ title: "Double Breach (ES)", color: "#ff1744",
      detail: `Both IB sides broken — the ~40% ES double-cross whiplash profile. Trend-continuation conviction is reduced${tag}.` });
  }

  return out;
}

function nowEtMinutesSec(): { min: number; sec: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { min: (g("hour") % 24) * 60 + g("minute"), sec: g("second") };
}

function ibCountdown(): { phase: "pre" | "forming" | "done"; text: string } {
  const { min, sec } = nowEtMinutesSec();
  const fmtMS = (totalSec: number) => {
    const m = Math.floor(totalSec / 60), s = totalSec % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  };
  if (min < IB_OPEN_MIN) {
    const secsTo = (IB_OPEN_MIN - min) * 60 - sec;
    return { phase: "pre", text: `IB forms in ${fmtMS(secsTo)}` };
  }
  if (min < IB_END_MIN) {
    const secsTo = (IB_END_MIN - min) * 60 - sec;
    return { phase: "forming", text: `Forming — ${fmtMS(secsTo)} left` };
  }
  return { phase: "done", text: "IB locked" };
}

function IbCard() {
  const { candles } = useEsCandles(true);
  const grace = useGrace();
  const today = etDateISO();
  const [, tick] = useState(0);
  const [mounted, setMounted] = useState(false);

  // 1s clock so the countdown ticks. setMounted gates the time-dependent
  // countdown to client-only render (fixes SSR hydration mismatch).
  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cd = mounted ? ibCountdown() : { phase: "pre" as const, text: "" };
  // Newest candle ts = the feed's last update.
  const lastUpdated = candles.length ? Number(candles[candles.length - 1].timestamp) : null;

  // ES IB + the day-type / bias read from the shared ES candle feed.
  const { ib, amt } = (() => {
    if (!candles.length) return { ib: null as InitialBalance | null, amt: null as AmtResult | null };
    const esu = candles.filter((c) => (c.symbol ?? "").toUpperCase().includes("ESU"));
    const src = esu.length ? esu : candles;
    const amt = computeAmt(src, today);
    return { ib: amt.ib, amt };
  })();

  const fmt = (n: number | null | undefined) => (n != null ? Math.round(n).toLocaleString() : "—");
  const rangePts = ib ? ib.high - ib.low : null;

  // Calculate applicable rules for this session
  const rules = applicableRules(ib);

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Initial Balance</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>ES</span>
      </Row>

      {/* Countdown bar (9:30–10:30 ET IB window). */}
      <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: cd.phase === "forming" ? T.orange : cd.phase === "done" ? POS_GREEN : T.muted }}>
        {cd.text}
      </div>

      {ib == null ? (
        <CardState
          loading={candles.length === 0 && grace}
          error={null}
          empty={cd.phase === "pre" ? "IB hasn't formed yet — waiting for 9:30 ET open." : "No ES data for this session."}
        />
      ) : (
        <>
          <Row>
            <Stat label="IB High" value={fmt(ib.high)} color={POS_GREEN} />
            <Stat label="IB Mid" value={fmt(ib.mid)} color={T.cyan} />
            <Stat label="IB Low" value={fmt(ib.low)} color={T.red} />
            <Stat label="Range" value={cd.phase === "forming" ? "forming" : rangePts != null ? `${Math.round(rangePts)} pts` : "—"} />
          </Row>
          <div style={divider} />
          {/* IB logic — day-type classification + directional read from the IB. */}
          <Label>IB read</Label>
          {(() => {
            const leanColor = amt?.bias.lean === "long" ? POS_GREEN : amt?.bias.lean === "short" ? T.red : T.muted;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <Row style={{ marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: leanColor }}>{amt?.dayTypeLabel ?? "—"}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: leanColor }}>
                    {amt?.bias.lean ?? "neutral"}
                  </span>
                </Row>
                <span style={{ fontSize: 14, color: T.text, lineHeight: 1.4 }}>{amt?.bias.text}</span>
              </div>
            );
          })()}

          {/* Rules In Play section */}
          {rules.length > 0 && (
            <>
              <div style={divider} />
              <Label>Rules in play ({rules.length})</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflowY: "auto", minHeight: 0 }}>
                {rules.map((rule) => {
                  // Map rule colors to theme tokens
                  const ruleColorMap: Record<string, string> = {
                    "#ffb300": T.orange,
                    "#219EBC": T.cyan,
                    "#00e676": POS_GREEN,
                    "#ff5252": T.red,
                    "#ffffff": T.text,
                    "#ff1744": T.red,
                  };
                  const themeColor = ruleColorMap[rule.color] || T.cyan;
                  return (
                    <div
                      key={rule.title}
                      style={{
                        border: `1px solid ${T.border}`,
                        borderLeft: `3px solid ${themeColor}`,
                        borderRadius: 8,
                        padding: "8px 10px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 800, color: themeColor }}>{rule.title}</span>
                      <span style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>{rule.detail}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 8. TICKER LEVELS ──────────────────────────────────────────────────────────
// Spot · Call Wall · Put Wall · CORE (CB) for ONE ticker at a time. The symbol is
// picked from a searchable dropdown over the whole scanner universe — the same
// picker language as the Options Chain page's ticker menu (frosted panel, cyan
// top accent, star-to-favorite, search-to-filter), so a name that isn't in the
// universe can still be typed in and added. These are the same four numbers the
// owner Results → Walls tab prints, off the same tables. Two read paths, because
// neither one alone is sufficient:
//
//   /proxy/walls?date=…   → { tickers: [{ symbol, spot, call_wall, put_wall, cb }] }
//       Sampled from scanner_snapshots onto a 15m slot grid starting 09:29 ET.
//       The ONLY endpoint that returns `cb`, so CORE comes from here or nowhere
//       (/proxy/scanner's SELECT omits the column even though the table has it).
//   /proxy/scanner?any=1  → each symbol's most recent row regardless of date,
//       swept every 2–5m. Fresher spot/walls than the slot grid — but no `cb`,
//       and rows it carries over from a previous session are flagged `stale`.
//
// So scanner wins for spot/call/put and walls supplies CORE. Both are fetched
// once for the whole universe, not per selection — switching the pill is a local
// lookup, so it's instant and costs no extra request.
//
// TODAY ONLY — nothing on this card is allowed to come from a previous session.
// `stale` scanner rows are dropped rather than shown, and there is no
// prior-session walls fallback: before the recorders have written today (the
// scanner's first sweep, then the 09:29 ET walls slot for CORE) the card says so
// instead of printing yesterday's numbers under a live-looking timestamp.
//
// NO FUTURES — scanner_snapshots covers cash indices + equities only, so ESU/NQU
// were derived rows (SPX + the ES−SPX basis, and spot-only for NQ). They are
// gone: the futures traders read the index levels off the ES chart, and the
// basis-shifted row was one more number to keep honest for no extra signal.
interface WallsTickerRow {
  symbol: string;
  spot: number | null; call_wall: number | null; put_wall: number | null; cb: number | null;
}
interface WallsResp { ok?: boolean; date?: string; tickers?: WallsTickerRow[]; error?: string }
interface ScannerRow {
  symbol: string; date?: string; stale?: boolean; expiry?: string | null;
  spot: number | null; call_wall: number | null; put_wall: number | null;
}
interface ScannerResp { ok?: boolean; rows?: ScannerRow[]; error?: string }

const TL_DEFAULT: readonly string[] = ["SPX", "SPY", "QQQ"];
const TL_STORE_KEY = "analytics.tickerLevels.extra";
const TL_FAV_KEY = "analytics.tickerLevels.favs";

function tlLoadList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const arr: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch { return []; /* private mode / bad JSON — the defaults are fine */ }
}
function tlSaveList(key: string, list: string[]): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* ignore */ }
}

// Searchable symbol picker over the scanner universe, deliberately the same
// component shape and visual language as the Options Chain page's ticker menu:
// a bordered trigger, a portal'd frosted panel with a 2px cyan top accent, a
// search field, star-to-favorite with favorites floated to the top, and
// click-outside / Esc to close. Portal'd because the card clips its overflow.
//
// One thing it does that the chain's picker does not: a query that matches no
// listed symbol offers to ADD it. The scanner universe is not everything the
// walls tables know about (NDX, for instance), so a free-text path has to exist
// — this folds it into the search box rather than a second input under the card.
function TickerLevelsPicker({
  value, options, custom, onSelect, onAdd, onRemove,
}: {
  value: string;
  options: readonly string[];
  custom: readonly string[];
  onSelect: (t: string) => void;
  onAdd: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => { setFavs(tlLoadList(TL_FAV_KEY)); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 3, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const toggleFav = (t: string) =>
    setFavs((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      tlSaveList(TL_FAV_KEY, next);
      return next;
    });

  const favSet = new Set(favs);
  const customSet = new Set(custom);
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const matches = options.filter((t) => !q || t.includes(q));
  const favList = matches.filter((t) => favSet.has(t)).sort();
  const rest = matches.filter((t) => !favSet.has(t)).sort();
  const exact = options.some((t) => t === q);
  const rows: Array<{ t: string; fav: boolean; divider?: boolean }> = [
    ...favList.map((t) => ({ t, fav: true })),
    ...(favList.length && rest.length ? [{ t: "__divider__", fav: false, divider: true }] : []),
    ...rest.map((t) => ({ t, fav: false })),
  ];

  const choose = (t: string) => { onSelect(t); setQuery(""); setOpen(false); };
  const add = () => { if (q && !exact) { onAdd(q); setQuery(""); setOpen(false); } };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-label="Select ticker"
        style={{
          width: "100%", fontSize: 13, fontWeight: 800, padding: "7px 11px",
          border: `1px solid ${T.border}`, borderRadius: 6,
          background: "rgba(255,255,255,0.04)", color: T.cyan,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
          whiteSpace: "nowrap", letterSpacing: "0.08em", textTransform: "uppercase",
        }}
      >
        <span>{value}</span>
        <span style={{ fontSize: 10, opacity: 0.7, color: T.muted }}>▾</span>
      </button>
      {open && rect && createPortal(
        <div ref={menuRef} style={{
          position: "fixed", left: rect.left, top: rect.top, zIndex: 9999,
          width: Math.max(rect.width, 200),
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: `1px solid ${T.border}`, borderTop: `2px solid ${T.cyan}`, borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)", overflow: "hidden",
        }}>
          <div style={{ padding: 6, borderBottom: `1px solid ${T.border}` }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (exact) choose(q);
                else if (rows.length && !rows[0].divider) choose(rows[0].t);
                else add();
              }}
              placeholder="Search or add…"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box", fontSize: 11, fontWeight: 700,
                padding: "5px 8px", border: `1px solid ${T.border}`, borderRadius: 5,
                background: "rgba(255,255,255,0.04)", color: T.text, outline: "none",
                letterSpacing: "0.06em",
              }}
            />
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", padding: "3px 0" }}>
            {q && !exact ? (
              <div
                onClick={add}
                style={{
                  padding: "6px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  color: T.cyan, letterSpacing: "0.04em",
                  borderBottom: rows.length ? `1px solid ${T.border}` : undefined,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                + Add “{q}”
              </div>
            ) : null}
            {rows.length === 0 && !q ? (
              <div style={{ padding: "8px 12px", fontSize: 10, color: T.muted }}>No tickers</div>
            ) : null}
            {rows.map((row) => {
              if (row.divider) {
                return <div key="div" style={{ height: 1, background: T.border, margin: "3px 8px" }} />;
              }
              const active = row.t === value.toUpperCase();
              return (
                <div
                  key={row.t}
                  onClick={() => choose(row.t)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", fontSize: 11, fontWeight: active ? 800 : 600,
                    cursor: "pointer", whiteSpace: "nowrap",
                    color: active ? T.cyan : T.text,
                    background: active ? "rgba(33,158,188,0.10)" : "transparent",
                    letterSpacing: "0.04em",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.15)" : "rgba(255,255,255,0.05)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = active ? "rgba(33,158,188,0.10)" : "transparent")}
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); toggleFav(row.t); }}
                    title={row.fav ? "Unfavorite" : "Favorite"}
                    style={{ cursor: "pointer", fontSize: 12, lineHeight: 1, color: row.fav ? "#ffd600" : "rgba(255,255,255,0.28)" }}
                  >
                    {row.fav ? "★" : "☆"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>{row.t}</span>
                  {customSet.has(row.t) ? (
                    <span
                      onClick={(e) => { e.stopPropagation(); onRemove(row.t); }}
                      title={`Remove ${row.t}`}
                      style={{ cursor: "pointer", fontSize: 12, lineHeight: 1, color: T.muted, opacity: 0.7 }}
                    >
                      ×
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// "Aug 6 · 0DTE" for the expiry the levels were computed on. The scanner always
// takes expirations[0] — the nearest — so this reads 0DTE intraday and rolls to
// the next contract after the close. Which expiry produced a wall is not
// cosmetic: a call wall from tomorrow's chain is a different level from today's.
function expiryLabel(exp: string | null, todayISO: string): string {
  if (!exp) return "exp —";
  const d = new Date(`${exp}T00:00:00Z`);
  if (isNaN(d.getTime())) return `exp ${exp}`;
  const pretty = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(d);
  const dte = Math.round((d.getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000);
  return dte >= 0 ? `${pretty} · ${dte}DTE` : pretty;
}

interface TickerLevelRow {
  symbol: string;
  spot: number | null; core: number | null; call: number | null; put: number | null;
  expiry: string | null; note: string | null;
}

function TickerLevelsCard() {
  const today = etDateISO();
  const [tk, setTk] = useState<string>("SPX");
  const [extra, setExtra] = useState<string[]>([]);

  // Restore the trader's own tickers in an effect rather than a useState
  // initializer, so the server render and the first client render match.
  useEffect(() => { setExtra(tlLoadList(TL_STORE_KEY)); }, []);
  const persist = (next: string[]) => {
    setExtra(next);
    tlSaveList(TL_STORE_KEY, next);
  };

  const { data: walls, loading: wLoading, error: wError, lastUpdated } =
    useLiveData<WallsResp>(`/proxy/walls?date=${today}`, 120_000);
  // Today's slot grid or nothing. It doesn't start until 09:29 ET, so CORE is
  // simply absent pre-open, overnight and at weekends — that is the honest
  // reading. Falling back a session put a stale number where a live one goes.
  const wallRows = walls?.tickers ?? [];
  const corePending = !!walls && wallRows.length === 0;
  const { data: scan, loading: sLoading, error: sError } =
    useLiveData<ScannerResp>(`/proxy/scanner?any=1&limit=200`, 120_000);
  // The dropdown's universe: the scanner's own list (live via /proxy/scanner-
  // tickers with a static fallback) — the same source the Options Chain picker
  // reads, so the two menus can't drift apart.
  const { tickers: scannerTickers } = useScannerTickers();

  // scanner first (fresher spot/walls), then walls overlays CORE on top.
  // `stale` rows are the recorder's own flag for "this is a carried-over row
  // from an earlier date" — they are skipped, not displayed, so an empty map
  // means today's sweep genuinely hasn't landed yet.
  const bySymbol = (() => {
    const m = new Map<string, { spot: number | null; call: number | null; put: number | null; core: number | null; expiry: string | null }>();
    for (const r of scan?.rows ?? []) {
      if (r.stale) continue;
      m.set(String(r.symbol).toUpperCase(), {
        spot: numOr(r.spot), call: numOr(r.call_wall), put: numOr(r.put_wall),
        core: null, expiry: r.expiry || null,
      });
    }
    // /proxy/walls' day summary carries no expiry column, but it samples the very
    // same scanner_snapshots rows — so the scanner's expiry describes CORE too.
    for (const t of wallRows) {
      const k = String(t.symbol).toUpperCase();
      const e = m.get(k);
      if (e) e.core = numOr(t.cb);
      else m.set(k, {
        spot: numOr(t.spot), call: numOr(t.call_wall), put: numOr(t.put_wall),
        core: numOr(t.cb), expiry: null,
      });
    }
    return m;
  })();

  // Every symbol the recorder knows about, stale rows included — the difference
  // between "we don't scan that name" and "today's sweep hasn't reached it yet".
  const knownSymbols = new Set(
    [...(scan?.rows ?? []).map((r) => String(r.symbol).toUpperCase()),
     ...wallRows.map((t) => String(t.symbol).toUpperCase())]
  );

  const buildRow = (sym: string): TickerLevelRow => {
    const e = bySymbol.get(sym);
    return {
      symbol: sym, spot: e?.spot ?? null, core: e?.core ?? null, call: e?.call ?? null,
      put: e?.put ?? null, expiry: e?.expiry ?? null,
      note: e ? null
        : knownSymbols.has(sym) ? "waiting on today's scanner sweep"
        : "not in the scanner universe",
    };
  };

  // Menu contents: the three anchors, whatever the trader added, the whole
  // scanner universe, and the current selection (so a symbol restored from an
  // older save never renders as a trigger with no matching row). De-duped.
  const tickers = Array.from(new Set([...TL_DEFAULT, ...extra, ...scannerTickers, tk.toUpperCase()]));
  const row = buildRow(tk);

  const addTicker = (raw: string) => {
    const sym = raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
    if (!sym) return;
    if (!tickers.includes(sym)) persist([...extra, sym]);
    setTk(sym); // typing a ticker means you want to look at it
  };
  const removeTicker = (sym: string) => {
    persist(extra.filter((s) => s !== sym));
    if (tk === sym) setTk("SPX");
  };

  // Ready once the selected ticker resolved at least a spot — the walls can
  // still be null (futures with no basis) and the card is still worth showing.
  // bySymbol only ever holds today's rows now, so an empty map with the fetches
  // settled is the pre-recorder state, not a failure.
  const loaded = bySymbol.size > 0 || row.spot != null;
  const loading = (wLoading || sLoading) && !loaded;
  const error = loaded ? null : wError ?? sError;

  // Signed gap to the nearer wall: > 0 = not yet reached, < 0 = price through it.
  const distCall = row.spot != null && row.call != null ? row.call - row.spot : null;
  const distPut = row.spot != null && row.put != null ? row.spot - row.put : null;
  const nearerCall = distCall != null && (distPut == null || distCall <= distPut);
  const near = nearerCall ? distCall : distPut;
  const crossed = near != null && near < 0;
  const distCore = row.spot != null && row.core != null ? row.core - row.spot : null;

  const fmtLvl = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const fmtSpot = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

  // Footnote: how the row was derived, plus anything about it that isn't live.
  // The expiry itself lives in the header, where it reads before the numbers do.
  // Core is blank until today's 09:29 ET walls slot has run — say which, so a
  // dash reads as "not recorded yet" rather than "this symbol has no core".
  const coreWaiting = row.core == null && corePending;
  const notes = [
    row.note,
    coreWaiting ? "core pending — first walls run 9:29 AM ET" : null,
  ].filter(Boolean) as string[];

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Ticker Levels</span>
        <span
          style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.7 }}
          title={row.expiry ? `Levels computed on the ${row.expiry} chain` : "No expiry recorded for this symbol"}
        >
          {expiryLabel(row.expiry, today)}
        </span>
      </Row>

      <TickerLevelsPicker
        value={tk}
        options={tickers}
        custom={extra}
        onSelect={setTk}
        onAdd={addTicker}
        onRemove={removeTicker}
      />

      {loading || error ? (
        <CardState loading={loading} error={error} empty="Waiting on today's first recorder run." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, minWidth: 0 }}>
            <Stat label="Spot" value={fmtSpot(row.spot)} size={18} />
            <Stat label="Call Wall" value={fmtLvl(row.call)} color={row.call == null ? T.muted : T.orange} size={18} />
            <Stat label="Put Wall" value={fmtLvl(row.put)} color={row.put == null ? T.muted : POS_GREEN} size={18} />
          </div>

          <div style={divider} />

          <Row>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <Label>Core</Label>
              <Value color={row.core == null ? T.muted : T.cyan} size={22}>{fmtLvl(row.core)}</Value>
            </div>
            <Value color={distCore == null ? T.muted : signColor(distCore)} size={14}>
              {distCore == null ? "—" : `${distCore >= 0 ? "+" : ""}${distCore.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
            </Value>
          </Row>

          <div style={divider} />

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label>Distance to nearer wall ({nearerCall ? "Call" : "Put"}){crossed ? " · through" : ""}</Label>
            <Row>
              <Value color={near == null ? T.muted : crossed ? T.red : POS_GREEN} size={18}>
                {near == null ? "—" : `${crossed ? "-" : ""}${Math.abs(near).toLocaleString(undefined, { maximumFractionDigits: 1 })} pts`}
              </Value>
              <Value color={T.muted} size={14}>
                {near == null || row.spot == null ? "—" : `${((Math.abs(near) / row.spot) * 100).toFixed(2)}%`}
              </Value>
            </Row>
          </div>

          {notes.length ? (
            <span style={{ fontSize: 11, color: coreWaiting ? T.orange : T.muted, opacity: coreWaiting ? 0.75 : 0.5, fontFamily: "var(--font-mono)" }}>
              {notes.join(" · ")}
            </span>
          ) : null}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 9. TICKER LOOKUP (full-width, two panes) ─────────────────────────────────
// Type any optionable ticker → its live GEX ladder, walls and gamma regime, on
// ONE ticker in TWO scopes side by side:
//
//   LEFT   one expiration, picked from the front-of-board pills. Built from
//          /api/chains + accumulateChainGreeks() — the exact same OI+Vol
//          function the Multi Greek card at the top of this page uses, so the
//          per-strike numbers here and up there can never drift apart.
//   RIGHT  THE WHOLE BOARD, MINUS 0DTE. Every listed expiration EXCEPT today's,
//          fetched the way the Options Chain page fetches its columns: the real
//          listing from /api/expirations, then ONE /api/chains call per expiry
//          (`&range=all`), run through the SAME accumulateChainGreeks() as the
//          left pane and summed per strike across expiries.
//
// WHY NOT /proxy/gex-by-strike-multi, WHICH RETURNS EXACTLY THIS LADDER:
// because its numbers did not match the chain. That sweep is ThetaData-sourced
// (fetchGreeksTheta / fetchOpenInterestTheta in eod-gex-recorder). For SPX it is
// fine; for single names it comes back sparse — most near-spot strikes carried
// no OI, so the ladder printed three-figure GEX at the money and its "Core"
// landed on a far wing strike (NVDA at 218 spot: Core 335, flip 59.77, every
// near-spot bar red, while the Options Chain page's ⅀ Total column for the same
// name and session was strongly positive). Two surfaces, same label, different
// answers. This pane now reads the same TastyTrade chain the rest of the app
// prices off, so Ticker Lookup and the Options Chain agree by construction.
//
// COST: one request per expiration instead of one per board. EVERY listed
// expiration is swept — no cap, because "All expirations" has to mean all of
// them; a quarterly 300 days out is exactly the kind of strike that parks a
// wall the front weeklies never show. The cost is paid by refreshing slowly
// (TL_BOARD_REFRESH_MS) and on the manual ↻ button instead of by dropping
// expiries. The header always says how many the ladder actually covers, so a
// chain call that failed shows up as a smaller number rather than silently.
//
// WHY EX-0DTE, ALWAYS: same-day gamma dwarfs the rest of the board and decays to
// nothing by the close, so a board that included it printed walls that were
// really just today's pin. This pane is the STRUCTURAL board; the 0DTE view is
// one click away on the left pane's expiry pills.
//
// The sweep needs a spot to scale gamma by, and it is not the SPX feed's spot
// for anything but SPX — the underlying price from the /api/chains payload is
// passed through, so the right pane is priced off the same number the left one
// is. Until that spot exists the right pane does not fetch at all.
//
// FALLBACK. If the expirations listing or every per-expiry chain call fails, the
// right pane falls back to the front expirations the base /api/chains payload
// already returned — MINUS today's, so the fallback honours the same ex-0DTE
// rule — and SAYS SO in its header. It never silently prints three expiries
// under an "all expirations" label.
interface TlChainLeg { [k: string]: unknown }
interface TlChainStrike { "strike-price"?: unknown; call?: TlChainLeg; put?: TlChainLeg }
interface TlChainGroup { "expiration-date"?: unknown; strikes?: TlChainStrike[] }
interface TlChainResp { data?: { items?: TlChainGroup[]; underlyingPrice?: unknown }; error?: string }

// /api/expirations?ticker=X — the symbol's REAL listed expirations. Same shape
// the Options Chain page reads, so the two pages can't disagree about what a
// ticker trades (NVDA has no Monday weeklies; a fabricated calendar invents
// dates that come back empty).
interface TlExpResp { data?: { items?: Array<{ "expiration-date"?: unknown }> }; error?: string }

// /api/eod-strike-gex-change?symbol=X — the day-over-day ΔGEX series written by
// server-v2/eod-strike-gex-recorder.js (16:05 ET, whole board ex-0DTE, ±40
// strikes around the closing spot, full scanner watchlist).
//
// THE DIFF IS COMPUTED ON THE BACKEND, not here. The browser never fetches
// yesterday's board — that would be a second full sweep per ticker switch. The
// recorder stores one row per (date, symbol, strike) and the read route FULL
// JOINs the two most recent snapshot DATES in Postgres, so this payload already
// carries `chg` per strike.
//
// `prevDate` is the actual previous snapshot date, not calendar yesterday, so a
// holiday or a missed run degrades to "vs the last session we have" instead of
// silently comparing against nothing. Until a second session lands it is null
// and every chg is 0 — the ladder says "no baseline yet" rather than drawing a
// column of zeros that looks like a board that didn't move.
interface TlChangeRow { strike?: unknown; netGex?: unknown; prevNetGex?: unknown; chg?: unknown; hadPrev?: unknown }
interface TlChangeResp {
  ok?: boolean;
  symbol?: string;
  date?: string | null;
  prevDate?: string | null;
  rows?: TlChangeRow[];
  error?: string;
}

const TL_LOOKUP_KEY = "analytics.tickerLookup.recent";
const TL_QUICK: readonly string[] = ["SPX", "SPY", "QQQ", "NVDA", "TSLA"];
// How deep each drawn ladder runs EACH WAY from the strike price is sitting on:
// 20 above + the spot strike + 20 below. The far wings carry no useful gamma and
// a 1500-row SPX board is unreadable, but ten a side cropped walls that were
// still in play on a wide-strike name — twenty reaches them without turning the
// pane into a scroll.
const TL_LADDER_SIDE = 20;
// The board is one /api/chains call per expiration (server-cached 30s), so it
// polls slowly and is otherwise driven by the ↻ button next to the ticker.
const TL_BOARD_REFRESH_MS = 120_000;
// Parallel chain fetches. The board is uncapped — SPX lists 40+ expirations and
// every one of them is fetched — so this is the only throttle: 6 in flight keeps
// a full board inside a few seconds without a ticker switch flooding the proxy.
// (The server-side sweep uses 4; this runs from one browser, not the VPS.)
const TL_BOARD_CONCURRENCY = 6;

// ── Ticker Lookup replay ─────────────────────────────────────────────────────
// Rewinds BOTH panes off one clock: every ladder, level chip, wall and the
// plain-language read below them are rebuilt from a recorded strike_growth
// sweep instead of the live chain. Same recording, same route
// (/proxy/strike-growth/frames-by-expiry) and the same shared-clock shape the
// Multi Greek page's replay uses — one implementation of "what did this look
// like at 10:42", three surfaces reading it.
//
// What is and isn't there, because it shapes the UI below:
//   • The recorder stores the top N strikes per side per expiry per sweep. It
//     is a record of the WALLS, not the whole ladder — a strike that was never
//     a wall renders "—", not 0. ("Not recorded" and "no gamma here" are
//     different answers, and the Δ column already uses that em dash for
//     exactly this reason.)
//   • Only GEX is recorded. ± Move and ATM IV are priced off live marks, so
//     they read "—" while rewound rather than showing today's number on a
//     three-day-old ladder.
//   • The Δ 1D column is an END-OF-DAY series (one row per session close). It
//     has nothing to say about an intraday clock, so it is hidden while rewound.
//   • Cadence is the recorder's sweep (2 min hot lane / 5 min full roster);
//     retention is ~5 trading days.
const TL_REPLAY_SPEEDS = [0.5, 1, 2, 4, 8] as const;
const TL_REPLAY_BASE_MS = 700;

/** One recorded sweep. `cells` is `${expiry}|${strike}` → GEX. */
interface TlReplayFrame {
  ts: string;
  /** Epoch ms of `ts`, precomputed — the clock compares it per step. */
  t: number;
  spot: number;
  cells: Map<string, { net: number; vol: number }>;
  /** The expiries THIS sweep carried — the front one can roll intraday. */
  expiries: string[];
}

/** The loaded session: frames plus the axes they span. */
interface TlReplaySession {
  frames: TlReplayFrame[];
  /** Every strike recorded in ANY frame, ascending — the fixed ladder axis. */
  strikes: number[];
  /** Every expiry recorded in ANY frame, ascending. */
  expiries: string[];
}

/** Snap an epoch ms to its minute — the scrubber's resolution. */
function tlMinute(ms: number): number { return Math.floor(ms / 60_000) * 60_000; }

function fmtTlReplayClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch { return String(ms); }
}

/** Transport / speed button in the replay bar. */
function tlReplayBtn(active: boolean): CSSProperties {
  return {
    height: 24, padding: "0 8px", borderRadius: 6, cursor: "pointer",
    fontSize: 11, fontWeight: 800, fontFamily: "inherit", lineHeight: 1,
    color: active ? "#0b0f1a" : T.text,
    background: active ? T.orange : "rgba(255,255,255,0.05)",
    border: `1px solid ${active ? T.orange : T.border}`,
  };
}

/**
 * Build one pane's ladder from a replay frame.
 *
 * The axis is the SESSION's, not the frame's. The recorder stores the top N
 * strikes a side PER SWEEP, so a frame-built ladder gains and loses rungs on
 * every step and the whole thing shakes under the reader while it plays. Fixed
 * for the session, it is one ladder with values changing on it.
 *
 * `expiries` = the expiries to sum (one for the left pane, the whole board
 * minus 0DTE for the right). Returns the rows, the set of strikes this sweep
 * did not record (the ladder draws those as "—" instead of a zero bar), and
 * `used` — the expiries that actually put a cell into THIS profile.
 *
 * `used` is what the header counts. The session's expiry list is a property of
 * the recording, not of the ladder on screen: an expiry can be in the session
 * and contribute nothing to the sweep you are parked on. The number beside the
 * ladder has to describe the ladder.
 */
function tlReplayRows(
  frame: TlReplayFrame,
  sessionStrikes: number[],
  expiries: string[],
  basis: "net" | "vol" = "net",
): { rows: TlRow[]; missing: Set<number>; used: string[] } {
  const rows: TlRow[] = [];
  const missing = new Set<number>();
  const usedSet = new Set<string>();
  for (const strike of sessionStrikes) {
    let sum = 0;
    let seen = false;
    for (const e of expiries) {
      const cell = frame.cells.get(`${e}|${strike}`);
      if (!cell) continue;
      seen = true;
      usedSet.add(e);
      sum += basis === "vol" ? cell.vol : cell.net;
    }
    if (!seen) missing.add(strike);
    rows.push({ strike, gex: sum });
  }
  return {
    rows: rows.sort((a, b) => a.strike - b.strike),
    missing,
    used: expiries.filter((e) => usedSet.has(e)),
  };
}

/** Sweep timestamps snapped to the minute, deduped and ascending. */
function tlTimelineOf(frames: TlReplayFrame[]): number[] {
  const set = new Set<number>();
  for (const f of frames) set.add(tlMinute(f.t));
  return [...set].sort((a, b) => a - b);
}

/** Every strike the session recorded under `expiries` — one pane's fixed axis. */
function tlSessionAxis(frames: TlReplayFrame[], expiries: string[]): number[] {
  const keep = new Set(expiries);
  const out = new Set<number>();
  for (const f of frames) {
    f.cells.forEach((_v, key) => {
      const bar = key.indexOf("|");
      if (!keep.has(key.slice(0, bar))) return;
      const k = Number(key.slice(bar + 1));
      if (Number.isFinite(k)) out.add(k);
    });
  }
  return [...out].sort((a, b) => a - b);
}

const tlLeg = (o: TlChainLeg | undefined, k: string): number => {
  const v = o?.[k];
  const n = Number(v);
  return v != null && v !== "" && isFinite(n) ? n : 0;
};

// "Aug 8 · 0DTE" for an expiry, relative to today ET.
function tlExpiryChip(exp: string, todayISO: string): string {
  const d = new Date(`${exp}T00:00:00Z`);
  if (isNaN(d.getTime())) return exp;
  const pretty = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(d);
  const dte = Math.round((d.getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000);
  return dte === 0 ? `${pretty} · 0DTE` : dte > 0 ? `${pretty} · ${dte}DTE` : pretty;
}

interface TlRow { strike: number; gex: number }
interface TlLevels {
  callWall: number | null;   // highest +GEX strike — dealers sell into it
  putWall: number | null;    // most −GEX strike — dealers buy under it
  core: number | null;       // highest |GEX| strike (CB) — the magnet
  flip: number | null;       // cumulative-GEX zero crossing — pinning above, trending below
  net: number;               // summed net GEX across the whole ladder
}

// Walls + flip off the FULL ladder (not the drawn window) — a wall two hundred
// points out is still the wall, and cropping the ladder first would invent a
// nearer one.
function tlLevelsFrom(rows: TlRow[], spot: number | null): TlLevels {
  // Top TWO +GEX strikes, not one — see the CB collision rule below.
  let callWall: TlRow | null = null, callWall2: TlRow | null = null;
  let putWall: TlRow | null = null, core: TlRow | null = null;
  let net = 0;
  for (const r of rows) {
    net += r.gex;
    if (r.gex > 0) {
      if (callWall == null || r.gex > callWall.gex) { callWall2 = callWall; callWall = r; }
      else if (callWall2 == null || r.gex > callWall2.gex) callWall2 = r;
    }
    if (r.gex < 0 && (putWall == null || r.gex < putWall.gex)) putWall = r;
    if (core == null || Math.abs(r.gex) > Math.abs(core.gex)) core = r;
  }
  // CB COLLISION RULE. Core is the highest |GEX| strike on the board; when that
  // strike is call-side it IS the highest +GEX strike, so Core and Call wall
  // land on the same number and the card prints one level twice. In that case
  // the call wall steps down to the SECOND highest +GEX strike — the next real
  // ceiling above the magnet. Put wall is untouched: a call-side core can never
  // collide with it.
  if (core != null && callWall != null && core.strike === callWall.strike) {
    callWall = callWall2;
  }
  // Gamma flip — PORT OF server-v2/computation/gex-calculator.js findGexFlip(),
  // which is what /proxy/gex, the EOD recorder and every other GEX surface in
  // this app mean by "flip". Two things it does that a naive sign-change scan
  // does not, and both matter:
  //
  //   1. ONLY the negative→positive crossing counts. Cumulating from the lowest
  //      strike up, dealer gamma starts short (put wing) and turns long; that
  //      one turn is the flip. A later positive→negative dip in the call wing —
  //      one fat short-gamma strike out in the wings — is NOT a flip, and
  //      catching it printed a level hundreds of points above spot.
  //   2. It needs a spot. No spot, no flip, rather than a number computed off
  //      an unpriced ladder.
  let flip: number | null = null;
  if (spot != null && spot > 0) {
    let cum = 0, prevCum = 0, prevK: number | null = null;
    for (const r of rows) {
      prevCum = cum;
      cum += r.gex;
      if (prevK != null && prevCum < 0 && cum >= 0) {
        const range = cum - prevCum;
        flip = Math.abs(range) > 0 ? prevK + (r.strike - prevK) * (-prevCum / range) : r.strike;
        break;
      }
      prevK = r.strike;
    }
  }
  return {
    callWall: callWall?.strike ?? null,
    putWall: putWall?.strike ?? null,
    core: core?.strike ?? null,
    flip,
    net,
  };
}

// ATM straddle mark + ATM IV for one expiry group — the expected move the
// options are actually priced for, not an IV-derived approximation.
function tlAtm(group: TlChainGroup | undefined, spot: number): { move: number | null; iv: number | null } {
  if (!group || !spot) return { move: null, iv: null };
  let best: TlChainStrike | null = null, bestD = Infinity;
  for (const s of group.strikes ?? []) {
    const k = Number(s["strike-price"]);
    if (!isFinite(k) || !k) continue;
    const d = Math.abs(k - spot);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best) return { move: null, iv: null };
  const cm = tlLeg(best.call, "mark"), pm = tlLeg(best.put, "mark");
  const ci = tlLeg(best.call, "implied-volatility"), pi = tlLeg(best.put, "implied-volatility");
  const ivs = [ci, pi].filter((v) => v > 0);
  return {
    move: cm > 0 || pm > 0 ? cm + pm : null,
    iv: ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null,
  };
}

// The drawn window: the strike price is sitting on, plus TL_LADDER_SIDE strikes
// above and below it, redrawn high→low like a DOM. Sliced off the strike INDEX,
// not a point distance — a $2.50-wide chain and a $5-wide chain both give ten
// rungs a side.
function tlWindow(rows: TlRow[], spot: number | null): TlRow[] {
  if (!rows.length) return [];
  const anchor = spot ?? rows[Math.floor(rows.length / 2)].strike;
  let ai = 0;
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].strike - anchor) < Math.abs(rows[ai].strike - anchor)) ai = i;
  }
  return rows
    .slice(Math.max(0, ai - TL_LADDER_SIDE), ai + TL_LADDER_SIDE + 1)
    .slice()
    .sort((a, b) => b.strike - a.strike);
}

// Fixed chip height: 14 (label) + 24 (value) + 15 (dist) + 15 (note)
// + 6 (three 2px gaps) + 16 (padding) + 2 (border) = 92.
// Taller: the chip type went up a size across the board (these are read at a
// glance, often from across the desk or off a recording).
const TL_CHIP_MIN_H = 106;

// Row of level chips. `stretch` keeps every chip the same height, and the
// auto top margin pins the row to the bottom of its pane so the left and
// right panes' rows line up even when their ladders differ in length.
// Three chips now, not four (Gamma flip removed), so each gets more room —
// minmax raised to match, which is what stops three chips wrapping to two rows
// on a narrow pane. `marginTop: auto` pins the row to the BOTTOM of the pane;
// the pane is a fixed height and the ladder above it scrolls, so these sit at
// the same y no matter how many rungs the ladder has.
const TL_CHIP_ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 8,
  alignItems: "stretch",
  marginTop: "auto",
  flexShrink: 0,
};

// Compact chip for a computed level: name, price, and how far spot is from it.
function TlLevelChip({ name, value, spot, color, note }: {
  name: string; value: number | null; spot: number | null; color: string; note: string;
}) {
  const dist = value != null && spot != null ? value - spot : null;
  // Every row is pinned to a fixed line box and clipped to ONE line, so all
  // four chips are the same height no matter how long the note or the
  // distance string is — and the left pane's row matches the right pane's.
  const oneLine: CSSProperties = {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
  };
  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 12, padding: "8px 10px",
      display: "flex", flexDirection: "column", gap: 2, minWidth: 0,
      minHeight: TL_CHIP_MIN_H, boxSizing: "border-box",
    }}>
      <span style={{ ...oneLine, fontSize: 12, lineHeight: "16px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color }} title={name}>{name}</span>
      <span style={{ ...oneLine, display: "block", lineHeight: "30px" }}>
        <Value color={value == null ? T.muted : color} size={26}>
          {value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
        </Value>
      </span>
      <span style={{ ...oneLine, fontSize: 13, lineHeight: "18px", fontFamily: "var(--font-mono)", color: T.text }}>
        {dist == null ? "—" : dist === 0 ? "at price"
          : `${Math.abs(dist).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${dist > 0 ? "above" : "below"}`}
      </span>
      <span style={{ ...oneLine, fontSize: 13, lineHeight: "18px", color: T.text }} title={note}>{note}</span>
    </div>
  );
}

// One pane's ladder. Bars run out from a center rail: +GEX right, −GEX left.
// Level marks are DOTS, not words — the strike column stays a column of
// numbers, and the chips under the ladder name each level.
// `changes` (optional) turns on the day-over-day Δ column: strike → ΔGEX vs the
// previous end-of-day snapshot, already differenced by the backend. Only the
// right pane passes it — the recorder snapshots the BOARD, so hanging a
// board-level Δ off the left pane's single-expiry ladder would print a change
// that doesn't belong to the number beside it.
// `missing` (replay only) = strikes the current sweep did not record. Their row
// is drawn with no bar and an em dash instead of a value: the recorder stores
// walls, not the whole ladder, and a 0 bar there would claim "no gamma at this
// strike" when the honest answer is "not recorded at this moment".
function TlLadder({ rows, spot, levels, changes = null, missing = null }: {
  rows: TlRow[]; spot: number | null; levels: TlLevels;
  changes?: Map<number, number> | null;
  missing?: Set<number> | null;
}) {
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.gex)), 0) || 1;
  const spotRow = spot == null ? null
    : rows.reduce<TlRow | null>((best, r) =>
        best == null || Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best, null);
  const withChg = changes != null;
  const cols = withChg ? "88px 1fr 68px 66px" : "88px 1fr 68px";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 8, paddingBottom: 4 }}>
        <Label>Strike</Label>
        <span style={{ textAlign: "center" }}><Label>Net GEX</Label></span>
        <span style={{ textAlign: "right" }}><Label>Value</Label></span>
        {withChg && <span style={{ textAlign: "right" }}><Label>Δ 1D</Label></span>}
      </div>
      {rows.map((r) => {
        const unrecorded = missing?.has(r.strike) ?? false;
        const pos = r.gex >= 0;
        const pct = Math.max(2, (Math.abs(r.gex) / maxAbs) * 100);
        const isSpot = spotRow != null && r.strike === spotRow.strike;
        const marks: string[] = [];
        if (levels.callWall === r.strike) marks.push(LEVEL_COLORS.cw);
        if (levels.putWall === r.strike) marks.push(LEVEL_COLORS.pw);
        if (levels.core === r.strike) marks.push(LEVEL_COLORS.cb);
        return (
          <div
            key={r.strike}
            style={{
              display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 8,
              padding: "2px 6px", borderRadius: 8,
              border: `1px solid ${isSpot ? T.cyan : "transparent"}`,
              background: isSpot ? "rgba(33,158,188,0.08)" : "transparent",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: isSpot ? 800 : 600, color: isSpot ? T.cyan : T.text }}>
                {r.strike.toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </span>
              {isSpot && <span style={{ fontSize: 9, fontWeight: 800, color: T.cyan, letterSpacing: "0.08em" }}>◀</span>}
              {marks.map((c) => (
                <span key={c} style={{ width: 7, height: 7, borderRadius: 2, background: c, flexShrink: 0 }} />
              ))}
            </span>
            <span style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
              <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                {!unrecorded && !pos && <span style={{ width: `${pct}%`, height: 14, borderRadius: "4px 0 0 4px", background: T.red }} />}
              </span>
              <span style={{ width: 1, height: 18, background: T.border, flexShrink: 0 }} />
              <span style={{ flex: 1, display: "flex" }}>
                {!unrecorded && pos && <span style={{ width: `${pct}%`, height: 14, borderRadius: "0 4px 4px 0", background: POS_GREEN }} />}
              </span>
            </span>
            <span
              title={unrecorded ? "not recorded in this sweep — the recorder stores the walls, not every strike" : undefined}
              style={{
                textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700,
                color: unrecorded ? T.muted : pos ? POS_GREEN : T.red,
                opacity: unrecorded ? 0.5 : 1,
              }}
            >
              {unrecorded ? "—" : fmtBig(r.gex)}
            </span>
            {withChg && (() => {
              const chg = changes?.get(r.strike);
              // undefined = this strike is outside the recorded ±40 window, or
              // no snapshot exists for it yet. Print an em dash, not 0 — "no
              // reading" and "did not move" are different answers and a 0 here
              // would be a lie about a wall that may have moved a long way.
              const has = chg != null && isFinite(chg) && chg !== 0;
              return (
                <span
                  title={chg == null ? "no end-of-day snapshot for this strike" : `${chg > 0 ? "+" : ""}${fmtBig(chg)} vs prior session close`}
                  style={{
                    textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700,
                    color: chg == null ? T.muted : has ? (chg > 0 ? POS_GREEN : T.red) : T.text,
                    opacity: chg == null ? 0.5 : 1,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {chg == null ? "—" : `${chg > 0 ? "+" : chg < 0 ? "−" : ""}${fmtBig(Math.abs(chg))}`}
                </span>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// Exported so OTHER surfaces mount this exact card instead of growing a second
// copy of it. Multi Greek's per-panel 🔍 opens it in an overlay seeded with that
// panel's ticker — one component, two pages, numbers that cannot drift.
//   initialSymbol  what the card opens on (default SPX, this page's case). The
//                  card is uncontrolled after mount, so the trader can switch
//                  symbols inside it without the host yanking it back.
//   embedded       drops the full-width grid span, which is meaningless outside
//                  this page's card grid.
//   initialReplay  open already rewound. /replay mounts this as a replay tab,
//                  where making the user press ⏱ Replay every time is asking
//                  them to confirm the thing they navigated to. Initial state
//                  only — the toggle still works normally after mount.
export function TickerLookupCard({ initialSymbol = "SPX", embedded = false, initialReplay = false }: {
  initialSymbol?: string;
  embedded?: boolean;
  initialReplay?: boolean;
} = {}) {
  const today = etDateISO();
  const [sym, setSym] = useState(() => (initialSymbol || "SPX").trim().toUpperCase() || "SPX");
  const [recent, setRecent] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string | null>(null); // left pane's picked expiration

  // Restore recents in an effect, not a useState initializer, so the server
  // render and the first client render agree.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TL_LOOKUP_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setRecent(parsed.filter((s): s is string => typeof s === "string").slice(0, 8));
    } catch { /* private mode / bad JSON — the quick row is enough */ }
  }, []);

  const lookup = useCallback((raw: string) => {
    const s = raw.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
    if (!s) return;
    setSym(s);
    setExpiry(null); // a new ticker has a different expiry board
    setRecent((prev) => {
      const next = [s, ...prev.filter((x) => x !== s)].slice(0, 8);
      try { window.localStorage.setItem(TL_LOOKUP_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Drop a symbol from the recents the picker offers (its × affordance). The
  // scanner universe is not editable from here — only what this card added.
  const forget = useCallback((raw: string) => {
    const s = raw.trim().toUpperCase();
    setRecent((prev) => {
      const next = prev.filter((x) => x !== s);
      try { window.localStorage.setItem(TL_LOOKUP_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Replay ────────────────────────────────────────────────────────────────
  // See the TL_REPLAY block above for what is and isn't recorded. `replayOn` is
  // the user's intent; every derived value keys off the FRAME, so turning it on
  // for a symbol with no recorded history shows an explicit empty state rather
  // than a silently blank card.
  const [replayOn, setReplayOn] = useState(initialReplay);
  const [replayDates, setReplayDates] = useState<string[]>([]);
  const [replayDate, setReplayDate] = useState("");
  const [replaySession, setReplaySession] = useState<TlReplaySession | null>(null);
  const [replayIdx, setReplayIdx] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayErr, setReplayErr] = useState("");

  // Leaving replay, or switching ticker, drops the loaded session so the next
  // entry can't paint one symbol's frames under another's label.
  useEffect(() => {
    setReplaySession(null); setReplayIdx(0); setReplayPlaying(false); setReplayErr("");
  }, [replayOn, sym]);

  // Which sessions are replay-able for this symbol. Retention is ~5 trading
  // days, so the list is short by design — a rewind, not a history browser.
  useEffect(() => {
    if (!replayOn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/proxy/strike-growth/replay-meta?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        const ds: string[] = Array.isArray(j?.dates) ? j.dates.map((d: unknown) => String(d).slice(0, 10)) : [];
        setReplayDates(ds);
        setReplayDate((cur) => (cur && ds.includes(cur) ? cur : ds[0] ?? ""));
        if (!ds.length) setReplayErr(`No recorded sessions for ${sym}.`);
      } catch {
        if (!cancelled) { setReplayDates([]); setReplayDate(""); setReplayErr("Could not load recorded sessions."); }
      }
    })();
    return () => { cancelled = true; };
  }, [replayOn, sym]);

  // The frames. ONE request per (symbol, session) — the whole day is pulled up
  // front so scrubbing is instant and never re-hits the network mid-drag.
  useEffect(() => {
    if (!replayOn || !replayDate) return;
    let cancelled = false;
    setReplaySession(null); setReplayIdx(0);
    setReplayLoading(true); setReplayErr(""); setReplayPlaying(false);
    (async () => {
      try {
        const res = await fetch(
          `/proxy/strike-growth/frames-by-expiry?symbol=${encodeURIComponent(sym)}&date=${encodeURIComponent(replayDate)}`,
          { cache: "no-store" },
        );
        const j = await res.json().catch(() => null);
        if (cancelled) return;
        if (!j?.ok || !Array.isArray(j.frames) || !j.frames.length) {
          setReplaySession(null);
          setReplayErr(j?.error ? String(j.error) : `No recorded frames for ${sym} on ${replayDate}.`);
          return;
        }
        // Payload is positional (`cells: [expiryIdx, strike, net, vol]`) with
        // `expiries` as the index table — see the route for why.
        const expiryList: string[] = Array.isArray(j.expiries) ? j.expiries.map(String) : [];
        const strikeSet = new Set<number>();
        const expSet = new Set<string>();
        const frames: TlReplayFrame[] = (j.frames as { ts?: unknown; spot?: unknown; cells?: unknown }[])
          .map((f) => {
            const cells = new Map<string, { net: number; vol: number }>();
            const seen = new Set<string>();
            for (const c of ((f.cells ?? []) as number[][])) {
              const exp = expiryList[Number(c[0])];
              const strike = Number(c[1]);
              if (!exp || !isFinite(strike)) continue;
              seen.add(exp); expSet.add(exp); strikeSet.add(strike);
              cells.set(`${exp}|${strike}`, { net: Number(c[2]) || 0, vol: Number(c[3]) || 0 });
            }
            const ts = String(f.ts);
            return {
              ts, t: new Date(ts).getTime(), spot: Number(f.spot) || 0, cells,
              expiries: expiryList.filter((e) => seen.has(e)),
            };
          })
          .filter((f) => isFinite(f.t));
        frames.sort((a, b) => a.t - b.t);
        if (!frames.length) { setReplaySession(null); setReplayErr(`No recorded frames for ${sym} on ${replayDate}.`); return; }
        setReplaySession({
          frames,
          strikes: [...strikeSet].sort((a, b) => a - b),
          expiries: [...expSet].sort(),
        });
        // Land on the LAST sweep: coming off a live card, the nearest thing to
        // what was just on screen is the most recent snapshot. Scrub back.
        setReplayIdx(Math.max(0, tlTimelineOf(frames).length - 1));
      } catch {
        if (!cancelled) { setReplaySession(null); setReplayErr("Could not load frames."); }
      } finally {
        if (!cancelled) setReplayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [replayOn, replayDate, sym]);

  // The scrubber's steps: sweep timestamps snapped to the minute. The recorder
  // sweeps on 2 min / 5 min lanes, so raw timestamps are uneven — snapping
  // gives one readable step per minute of session instead of a ragged axis.
  const replayTimeline = useMemo<number[]>(
    () => (replaySession ? tlTimelineOf(replaySession.frames) : []),
    [replaySession],
  );
  const replayClock = replayTimeline.length
    ? replayTimeline[Math.min(replayIdx, replayTimeline.length - 1)]
    : null;

  /** The last sweep AT OR BEFORE the clock — step-hold, never a future reading. */
  const replayFrame = useMemo<TlReplayFrame | null>(() => {
    if (!replaySession || replayClock == null) return null;
    const cutoff = replayClock + 59_999;
    let pick: TlReplayFrame | null = null;
    for (const f of replaySession.frames) { if (f.t <= cutoff) pick = f; else break; }
    return pick;
  }, [replaySession, replayClock]);

  // Playback. Stops at the last step rather than looping — a session that
  // silently restarts reads as the tape jumping backwards.
  useEffect(() => {
    if (!replayPlaying || replayTimeline.length === 0) return;
    const id = setInterval(() => {
      setReplayIdx((i) => {
        if (i >= replayTimeline.length - 1) { setReplayPlaying(false); return i; }
        return i + 1;
      });
    }, TL_REPLAY_BASE_MS / replaySpeed);
    return () => clearInterval(id);
  }, [replayPlaying, replaySpeed, replayTimeline.length]);

  // The picker's universe: the live scanner list (same source as the Options
  // Chain menu) plus the quick row and anything typed in here before, so a
  // symbol the scanner doesn't carry — NDX, a one-off name — stays reachable.
  const { tickers: scannerTickers } = useScannerTickers();
  const pickerOptions = [...new Set([...scannerTickers, ...TL_QUICK, ...recent, sym])];

  // ── left pane feed: front-of-board chains, per expiry ──────────────────────
  const { data, loading, error, lastUpdated, reload: reloadChain } =
    useLiveData<TlChainResp>(`/api/chains?ticker=${encodeURIComponent(sym)}`, 60_000);

  const groups = (data?.data?.items ?? []).filter((g) => typeof g["expiration-date"] === "string");
  const expiries = groups.map((g) => String(g["expiration-date"]));
  const spot = numOr(data?.data?.underlyingPrice);
  // An expiry the previous ticker had may not exist on this one — fall back to
  // the nearest rather than silently rendering an empty ladder.
  const activeExpiry = expiry != null && expiries.includes(expiry) ? expiry : (expiries[0] ?? null);
  const atmGroup = groups.find((g) => String(g["expiration-date"]) === activeExpiry);

  const leftRows: TlRow[] = [...accumulateChainGreeks(data, activeExpiry).entries()]
    .map(([strike, g]) => ({ strike, gex: g.gex }))
    .filter((r) => isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike);

  // ── right pane feed: the WHOLE board, ex-0DTE ─────────────────────────────
  // The symbol's real listing. Slow poll — a listing changes on the day a new
  // weekly is added, not minute to minute.
  const { data: expResp, reload: reloadExps } =
    useLiveData<TlExpResp>(`/api/expirations?ticker=${encodeURIComponent(sym)}`, 900_000);

  // EVERY listed expiry strictly after today, nearest first — no slice, no cap.
  // ISO dates compare correctly as strings, so `> today` drops both 0DTE and
  // anything stale the listing still carries.
  const boardExpiries = [...new Set((expResp?.data?.items ?? [])
    .map((it) => String(it["expiration-date"] ?? ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > today))].sort();
  // Joined, not the array — an array identity changes every render and would
  // restart the sweep on a loop.
  const boardKey = boardExpiries.join(",");

  const [board, setBoard] = useState<{ rows: TlRow[]; exps: number; sym: string }>({ rows: [], exps: 0, sym: "" });
  const [bLoading, setBLoading] = useState(false);
  const [bError, setBError] = useState<string | null>(null);
  // Monotonic token: a ticker switch mid-sweep must not let the old symbol's
  // chains land in the new symbol's ladder.
  const sweepRef = useRef(0);

  const loadBoard = useCallback(async () => {
    const exps = boardKey ? boardKey.split(",") : [];
    const mine = ++sweepRef.current;
    if (!exps.length) {
      setBoard({ rows: [], exps: 0, sym });
      setBError(null);
      return;
    }
    setBLoading(true);
    const acc = new Map<number, number>();
    let ok = 0;
    let lastErr: string | null = null;
    const queue = [...exps];
    const worker = async () => {
      while (queue.length) {
        const exp = queue.shift();
        if (!exp || sweepRef.current !== mine) return;
        try {
          // Same call the Options Chain page makes for each of its columns —
          // `range=all` so the ladder isn't cropped to a near-spot window.
          const res = await fetch(
            `/api/chains?ticker=${encodeURIComponent(sym)}&expiration=${encodeURIComponent(exp)}&range=all`,
            { cache: "no-store" },
          );
          const json = await res.json();
          if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
          // One expiry at a time through the SAME formula the left pane uses.
          for (const [strike, g] of accumulateChainGreeks(json).entries()) {
            acc.set(strike, (acc.get(strike) ?? 0) + g.gex);
          }
          ok++;
        } catch (e) {
          // One dead expiry must not blank the board — count it out and say so.
          lastErr = String(e);
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(TL_BOARD_CONCURRENCY, exps.length) }, worker),
      );
    } finally {
      if (sweepRef.current === mine) {
        const rows: TlRow[] = [...acc.entries()]
          .map(([strike, gex]) => ({ strike, gex }))
          .filter((r) => isFinite(r.strike) && r.strike > 0 && isFinite(r.gex) && r.gex !== 0)
          .sort((a, b) => a.strike - b.strike);
        setBoard({ rows, exps: ok, sym });
        setBError(ok === 0 ? lastErr : null);
        setBLoading(false);
      }
    }
  }, [sym, boardKey]);

  useEffect(() => {
    // The board sweep is one request PER EXPIRATION and uncapped — SPX lists
    // 40+. Rewound, none of it is on screen, so it is paused rather than
    // hammering the proxy for a pane that is showing a recording. The cheap
    // chain/listing polls stay on so leaving replay doesn't blank the card.
    if (replayOn) return;
    loadBoard();
    const id = setInterval(loadBoard, TL_BOARD_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadBoard, replayOn]);

  // A ladder from a previous ticker is worse than none — gate on the symbol the
  // sweep actually ran for.
  const boardRows: TlRow[] = board.sym === sym ? board.rows : [];

  // ── right pane Δ column: the recorded end-of-day series ───────────────────
  // One cheap call per ticker. It is a DAILY series — the recorder writes once
  // at 16:05 ET — so it polls on the hour rather than with the board, and the
  // card's ↻ button doesn't bother refetching it either. The backend has
  // already differenced the two most recent snapshot dates; nothing here does
  // arithmetic on GEX.
  const { data: chgResp } = useLiveData<TlChangeResp>(
    `/api/eod-strike-gex-change?symbol=${encodeURIComponent(sym)}`, 3_600_000,
  );
  // Gate on the symbol the payload came back for. A ticker switch leaves the
  // previous name's Δ in state for a beat, and a stale Δ hung off a fresh
  // ladder is worse than no Δ at all — the strikes overlap often enough
  // (SPY 600 / QQQ 600) that it would silently render as real.
  const chgOk = chgResp?.ok === true
    && String(chgResp.symbol ?? "").toUpperCase() === sym
    && (chgResp.rows?.length ?? 0) > 0;
  const chgMap: Map<number, number> | null = chgOk
    ? new Map((chgResp?.rows ?? []).flatMap((r) => {
        const k = Number(r.strike);
        const v = Number(r.chg);
        return isFinite(k) && k > 0 && isFinite(v) ? [[k, v] as [number, number]] : [];
      }))
    : null;
  // Null until a SECOND session lands. With one snapshot every chg is 0 by
  // construction, and a column of zeros reads as "the board didn't move"
  // rather than "we don't know yet" — so the column stays off until it can
  // say something true.
  const chgBaseline = chgOk ? (chgResp?.prevDate ?? null) : null;
  const rightChanges = chgBaseline ? chgMap : null;

  // Fallback: the front expirations the base /api/chains payload already gave
  // us, today's dropped so the fallback obeys the same ex-0DTE rule. Summed per
  // strike ACROSS those expiries — accumulateChainGreeks takes one expiry at a
  // time, so the maps are merged here rather than growing a second formula.
  const boardIsFull = boardRows.length > 0;
  const frontExpiries = expiries.filter((e) => e !== today);
  const frontAcc = new Map<number, number>();
  for (const e of frontExpiries) {
    for (const [strike, g] of accumulateChainGreeks(data, e).entries()) {
      frontAcc.set(strike, (frontAcc.get(strike) ?? 0) + g.gex);
    }
  }
  const frontRows: TlRow[] = [...frontAcc.entries()]
    .map(([strike, gex]) => ({ strike, gex }))
    .filter((r) => isFinite(r.gex) && r.gex !== 0)
    .sort((a, b) => a.strike - b.strike);
  const rightRows = boardIsFull ? boardRows : frontRows;

  // ── Live vs rewound: ONE swap, here ───────────────────────────────────────
  // Everything below this block — levels, walls, the drawn window, the chips,
  // the plain-language read — is computed from `viewLeftRows` / `viewRightRows`
  // / `viewSpot` and does not know which mode produced them. That is the whole
  // of replay: the SOURCE of the two ladders changes, nothing downstream does.

  // The session's 0DTE expiry: the one expiring ON the replayed date. A root
  // with no same-day listing that session falls back to its front recorded
  // expiry, so the right pane's ex-0DTE rule means the same thing either way.
  const replayZeroDte = replaySession
    ? (replaySession.expiries.includes(replayDate) ? replayDate : (replaySession.expiries[0] ?? ""))
    : "";
  // Left pane pills: the session's recorded expiries while rewound, the live
  // board's otherwise.
  const viewExpiries = replayOn && replaySession ? replaySession.expiries : expiries;
  const viewActiveExpiry = replayOn && replaySession
    ? (expiry != null && replaySession.expiries.includes(expiry) ? expiry : (replaySession.expiries[0] ?? null))
    : activeExpiry;
  // Right pane scope: every recorded expiry EXCEPT the session's 0DTE — the
  // same "structural board" the live right pane draws.
  const replayBoardExps = useMemo(
    () => (replaySession ? replaySession.expiries.filter((e) => e !== replayZeroDte) : []),
    [replaySession, replayZeroDte],
  );

  // The fixed ladder axes, memoized on the SESSION — not rebuilt per frame.
  // Walking every frame's cells is cheap once and wasteful sixty times a
  // minute at 8× playback. Keyed by joined strings because the expiry arrays
  // are rebuilt each render and their identity would defeat the memo.
  const leftAxisKey = viewActiveExpiry ?? "";
  const leftAxis = useMemo(
    () => (replaySession && leftAxisKey ? tlSessionAxis(replaySession.frames, [leftAxisKey]) : []),
    [replaySession, leftAxisKey],
  );
  const boardAxisKey = replayBoardExps.join(",");
  const rightAxis = useMemo(
    () => (replaySession && boardAxisKey ? tlSessionAxis(replaySession.frames, boardAxisKey.split(",")) : []),
    [replaySession, boardAxisKey],
  );

  const replayLeft = (replayOn && replayFrame && leftAxisKey && leftAxis.length)
    ? tlReplayRows(replayFrame, leftAxis, [leftAxisKey])
    : null;
  const replayRight = (replayOn && replayFrame && replayBoardExps.length && rightAxis.length)
    ? tlReplayRows(replayFrame, rightAxis, replayBoardExps)
    : null;

  const viewSpot = replayOn ? (replayFrame && replayFrame.spot > 0 ? replayFrame.spot : null) : spot;
  const viewLeftRows = replayOn ? (replayLeft?.rows ?? []) : leftRows;
  const viewRightRows = replayOn ? (replayRight?.rows ?? []) : rightRows;

  const leftLevels = tlLevelsFrom(viewLeftRows, viewSpot);
  // Both panes now compute their levels the same way, off ladders built by the
  // same function — no second opinion from a second data source to reconcile.
  const rightLevels = tlLevelsFrom(viewRightRows, viewSpot);
  // ± Move and ATM IV are priced off live marks; nothing in the recording can
  // reconstruct them, so they read "—" while rewound instead of putting today's
  // premium on a three-day-old ladder.
  const atm = replayOn ? { move: null, iv: null } : tlAtm(atmGroup, spot ?? 0);
  const positiveGamma = rightLevels.net >= 0;

  const leftLadder = tlWindow(viewLeftRows, viewSpot);
  const rightLadder = tlWindow(viewRightRows, viewSpot);
  const hasAny = leftLadder.length > 0 || rightLadder.length > 0;

  // The card's top-level gate. Rewound, the live chain's loading/error state is
  // irrelevant — the replay bar reports its own, and blocking on a live fetch
  // would hide a session that loaded fine.
  const gateLoading = replayOn ? replayLoading : loading;
  const gateError = replayOn ? (replayErr || null) : (error ?? data?.error ?? null);
  const gateEmpty = replayOn
    ? `No recorded ladder for ${sym}${replayDate ? ` on ${replayDate}` : ""}.`
    : `No live option chain for ${sym}.`;

  // What the right pane ACTUALLY covers — the count of expiries whose chain came
  // back, not the count requested. Nothing is capped, so a number below the
  // listing means a chain call failed, and the header says which it is rather
  // than implying a complete sweep.
  //
  // Rewound, the same rule: the count is the expiries IN THE PROFILE ON SCREEN
  // (`replayRight.used`), not the session's recorded expiry list. Those two
  // differ whenever a sweep skipped an expiry the session recorded elsewhere,
  // and the session count would then describe the recording rather than the
  // ladder it sits beside. The number now moves with the sweeps as you scrub.
  const replayBoardUsed = replayRight?.used.length ?? 0;
  const boardLabel = replayOn
    ? (replayBoardUsed
        ? `${replayBoardUsed} expiration${replayBoardUsed === 1 ? "" : "s"} · excl. 0DTE${replayZeroDte ? ` (${replayZeroDte})` : ""} · recorded walls only`
        : replayBoardExps.length
        ? `no expirations past 0DTE in this sweep · ${replayBoardExps.length} recorded this session`
        : "no recorded expirations past 0DTE this session")
    : boardIsFull
    ? [
        `${board.exps} expiration${board.exps === 1 ? "" : "s"} · excl. 0DTE`,
        boardExpiries.length > board.exps ? `of ${boardExpiries.length} listed — ${boardExpiries.length - board.exps} chain call(s) failed` : "whole board",
      ].join(" · ")
    : bLoading ? "sweeping the board…"
    : `${frontExpiries.length} front expirations · excl. 0DTE · full board unavailable`;

  // One button, whole card: the base chain, the listing, and the board sweep.
  const refresh = useRefreshButton(useCallback(async () => {
    await Promise.all([reloadChain(), reloadExps(), loadBoard()]);
  }, [reloadChain, reloadExps, loadBoard]));

  return (
    <Card variant="budget" padding={16} style={{ gridColumn: embedded ? undefined : "1 / -1", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls: ticker menu, one refresh for the whole card, the replay
          toggle, and the mark. The identity line that used to sit up here
          moved DOWN to rest directly on top of the ladders — see below. */}
      <Row style={{ flexWrap: "wrap", justifyContent: "flex-end", rowGap: 8 }}>
        {/* Ticker menu + one refresh for the whole card. The picker is the same
            component the Ticker Levels card uses — the searchable, star-to-
            favorite menu modelled on the Options Chain page's TICKERS dropdown —
            so this page has ONE ticker menu, not two that drift. Free text is
            handled by its own search box ("+ Add"), which is why the separate
            input and Look up button are gone. */}
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ minWidth: 132 }}>
            <TickerLevelsPicker
              value={sym}
              options={pickerOptions}
              custom={recent}
              onSelect={lookup}
              onAdd={lookup}
              onRemove={forget}
            />
          </div>
          <button onClick={refresh.trigger} style={refresh.style} title="Re-fetch the chain, the listing and the whole-board sweep">
            {refresh.label}
          </button>
          {/* Replay — rewinds both panes off a recorded session. */}
          <button
            onClick={() => setReplayOn((v) => !v)}
            title="Replay — scrub both ladders back through a recorded session (recorded walls only, ~5 trading days)"
            style={{
              ...(replayOn ? homeButtonStyle : homeSecondaryButtonStyle),
              ...(replayOn ? { background: T.orange, borderColor: T.orange, color: "#0b0f1a" } : { color: T.orange }),
              fontWeight: 800,
            }}
          >⏱ Replay</button>
          {/* Brand, on the toolbar with the rest of the controls.
              `crossOrigin` so html2canvas exports bake it in rather than
              tainting the canvas — same handling the footer uses. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/cb-edge-logo.png"
            alt="CB Edge"
            crossOrigin="anonymous"
            style={{ height: 28, width: "auto", display: "block", flexShrink: 0, opacity: 0.95, marginLeft: 2 }}
          />
        </span>
      </Row>

      {/* Quick row + whatever the trader looked up last. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[...TL_QUICK, ...recent.filter((r) => !TL_QUICK.includes(r))].map((s) => (
          <button key={s} onClick={() => lookup(s)} style={s === sym ? homeButtonStyle : homeSecondaryButtonStyle}>{s}</button>
        ))}
      </div>


      {/* The replay transport sits UNDER the ticker choices, not above
          them: picking a symbol reloads the session, so the control that
          changes what is being replayed belongs before the one that scrubs
          through it. Reading order now matches cause and effect. */}
      {/* ── Replay bar ────────────────────────────────────────────────────
          Session picker · transport · scrubber · speed · the clock being
          shown, then the coverage caveats said OUT LOUD. The ladders below
          look exactly like the live ones, so "recorded walls only" has to be
          stated here or an em-dashed rung reads as a broken card. */}
      {replayOn && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "6px 10px", borderRadius: 10,
          background: "rgba(251,133,1,0.07)", border: `1px solid ${T.orange}55`,
          fontSize: 11, color: T.text,
        }}>
          <span style={{ fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: T.orange, flexShrink: 0 }}>
            Replay
          </span>

          <select
            value={replayDate}
            onChange={(e) => { setReplayPlaying(false); setReplayDate(e.target.value); }}
            disabled={!replayDates.length}
            style={{
              padding: "3px 6px", fontSize: 11, fontWeight: 800, fontFamily: "var(--font-mono)",
              background: "rgba(13,17,25,0.72)", color: T.cyan,
              border: `1px solid ${T.border}`, borderRadius: 6, outline: "none", cursor: "pointer",
            }}
          >
            {replayDates.length === 0 && <option value="">—</option>}
            {replayDates.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <button
            onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.max(0, i - 1)); }}
            disabled={replayIdx <= 0}
            title="Previous minute"
            style={{ ...tlReplayBtn(false), opacity: replayIdx > 0 ? 1 : 0.4 }}
          >◀</button>
          <button
            onClick={() => {
              // Playing from the end shows one step and stops, which reads as
              // broken — rewind to the start first.
              if (replayIdx >= replayTimeline.length - 1) setReplayIdx(0);
              setReplayPlaying((p) => !p);
            }}
            disabled={replayTimeline.length < 2}
            title="Play / pause"
            style={{ ...tlReplayBtn(replayPlaying), padding: "0 12px", opacity: replayTimeline.length > 1 ? 1 : 0.4 }}
          >{replayPlaying ? "❚❚" : "▶"}</button>
          <button
            onClick={() => { setReplayPlaying(false); setReplayIdx((i) => Math.min(replayTimeline.length - 1, i + 1)); }}
            disabled={replayIdx >= replayTimeline.length - 1}
            title="Next minute"
            style={{ ...tlReplayBtn(false), opacity: replayIdx < replayTimeline.length - 1 ? 1 : 0.4 }}
          >▶</button>

          <input
            type="range"
            min={0}
            max={Math.max(0, replayTimeline.length - 1)}
            value={Math.min(replayIdx, Math.max(0, replayTimeline.length - 1))}
            disabled={replayTimeline.length < 2}
            onChange={(e) => { setReplayPlaying(false); setReplayIdx(Number(e.target.value)); }}
            style={{ flex: 1, minWidth: 180, height: 3, accentColor: T.orange }}
          />

          <span style={{ fontSize: 10, fontWeight: 700, opacity: 0.6 }}>Speed</span>
          {TL_REPLAY_SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setReplaySpeed(sp)}
              style={{ ...tlReplayBtn(replaySpeed === sp), height: 22, padding: "0 7px", fontSize: 10 }}
            >{sp}×</button>
          ))}

          <span style={{ color: T.border }}>|</span>

          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900 }}>
            {replayClock != null ? `${fmtTlReplayClock(replayClock)} ET` : "--:--"}
          </span>
          <span style={{ opacity: 0.55 }}>
            {replayTimeline.length ? `${Math.min(replayIdx, replayTimeline.length - 1) + 1} / ${replayTimeline.length}` : ""}
          </span>

          {replayLoading && <span style={{ color: T.cyan, fontWeight: 700 }}>loading…</span>}
          {!!replayErr && <span style={{ color: T.red, fontWeight: 700 }}>{replayErr}</span>}
          {!replayLoading && !replayErr && replayTimeline.length > 0 && (
            <span style={{ opacity: 0.55 }}>
              · recorded walls only · sweeps held to the minute · ± Move, ATM IV and Δ 1D off while rewound
            </span>
          )}
        </div>
      )}

      {gateLoading || gateError || !hasAny ? (
        <CardState
          loading={gateLoading}
          error={gateError}
          empty={gateEmpty}
        />
      ) : (
        <>
          {/* ── The identity line ───────────────────────────────────────
              Everything that says WHAT is on screen: the card name, the
              symbol, spot, gamma regime, ticker + expiry + DTE, the session
              date, the replay clock, what the ex-0DTE board covers, and the
              live-only ± Move / ATM IV.

              It sits HERE — below the replay transport, directly on top of
              the ladders — and not in the card header, because this is the
              line a screen capture has to contain. Cropping to the ladders
              now picks it up; up in the header it was one scroll or one crop
              away from being left out. It also reads in the right order: the
              controls change what is drawn, this states what got drawn. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            paddingBottom: 10, borderBottom: `1px solid ${T.border}`,
          }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
                Ticker Lookup
              </span>
              <span style={{ fontSize: 22, fontWeight: 800, color: T.text }}>${sym}</span>
              <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.text, opacity: 0.6 }}>GEX levels</span>

                  {/* Rewound, this is the spot RECORDED at that sweep — the live
                      quote would put today's price on a past session's ladder. */}
                  <Value color={T.text} size={22}>
                    {viewSpot == null ? "—" : viewSpot.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </Value>
                  <span style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: positiveGamma ? POS_GREEN : T.red,
                    border: `1px solid ${positiveGamma ? POS_GREEN : T.red}`,
                    borderRadius: 999, padding: "3px 10px",
                  }}>
                    {positiveGamma ? "Positive gamma" : "Negative gamma"}
                  </span>
                  {/* Ticker · expiry + DTE · the session on screen · the clock.
                      DTE counts from the replayed date while rewound, same rule as
                      the expiry pills — off today it would label the wrong one. */}
                  <span style={{
                    fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700,
                    letterSpacing: "0.06em", textTransform: "uppercase", color: T.text, opacity: 0.78,
                  }}>
                    {[
                      sym,
                      viewActiveExpiry ? tlExpiryChip(viewActiveExpiry, replayOn && replayDate ? replayDate : today) : null,
                      replayOn ? (replayDate || null) : today,
                      replayOn && replayClock != null ? `${fmtTlReplayClock(replayClock)} ET` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                  {/* What the ex-0DTE board covers — the right ladder's caption,
                      moved up here so it reads as part of the same statement. */}
                  <span style={{
                    fontSize: 11, fontFamily: "var(--font-mono)",
                    color: replayOn || boardIsFull ? T.text : T.orange,
                    opacity: replayOn || boardIsFull ? 0.6 : 0.85,
                  }}>
                    {boardLabel}
                  </span>
                  {/* Live-only: both are priced off live marks, so they read "—"
                      while rewound rather than putting today's premium on a
                      three-day-old ladder. */}
                  <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: T.text, opacity: 0.6 }}>
                    {`± Move ${atm.move == null ? "—" : `±${atm.move.toFixed(2)}`} · ATM IV ${atm.iv == null ? "—" : `${(atm.iv * 100).toFixed(1)}%`}`}
                  </span>
            </span>
          </div>

          {/* The split: picked expiry | whole board. */}
          {/* Fixed height, deliberately. The chip row under each ladder is the
              thing being read at a glance, and it used to slide down the page
              every time the ladder above it gained a rung — a different number
              of strikes on the left than the right, and the two panes' chips
              didn't even line up with each other. The pane height is now fixed,
              the LADDER scrolls inside it (see the scroll wrappers below), and
              the chips are pinned to the bottom by TL_CHIP_ROW's `marginTop:
              auto`. Ladder length no longer moves anything. */}
          <div className="tl-split" style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14,
            alignItems: "stretch", height: "clamp(460px, 64vh, 900px)",
          }}>

            {/* LEFT — one expiration */}
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Row style={{ flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.cyan }}>
                  By expiration
                </span>
                <Stat label="Net GEX" value={fmtBig(leftLevels.net)} color={leftLevels.net >= 0 ? POS_GREEN : T.red} size={16} />
              </Row>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* Rewound, the pills are the expiries the SESSION recorded and
                    their DTE counts from the replayed date — labelling them off
                    today would mark the wrong pill "0DTE". */}
                {viewExpiries.map((e) => (
                  <button key={e} onClick={() => setExpiry(e)} style={viewActiveExpiry === e ? homeButtonStyle : homeSecondaryButtonStyle}>
                    {tlExpiryChip(e, replayOn && replayDate ? replayDate : today)}
                  </button>
                ))}
              </div>
              {/* The ONLY thing that scrolls in this pane. minHeight:0 is what
                  lets it actually shrink inside the flex column instead of
                  pushing the chips out the bottom. */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
                {leftLadder.length === 0 ? (
                  <Placeholder>
                    {replayOn ? "Nothing recorded on this expiry in this session." : "No populated strikes on this expiry."}
                  </Placeholder>
                ) : (
                  <TlLadder rows={leftLadder} spot={viewSpot} levels={leftLevels} missing={replayLeft?.missing ?? null} />
                )}
              </div>
              <div style={TL_CHIP_ROW}>
                <TlLevelChip name="Core (CB)" value={leftLevels.core} spot={viewSpot} color={LEVEL_COLORS.cb} note="biggest magnet" />
                <TlLevelChip name="Call wall" value={leftLevels.callWall} spot={viewSpot} color={LEVEL_COLORS.cw} note="ceiling" />
                <TlLevelChip name="Put wall" value={leftLevels.putWall} spot={viewSpot} color={LEVEL_COLORS.pw} note="floor" />
              </div>
            </div>

            {/* RIGHT — every listed expiration except today's (never 0DTE) */}
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <Row style={{ flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.cyan }}>
                  All expirations · ex-0DTE
                </span>
                <Stat label="Net GEX" value={fmtBig(rightLevels.net)} color={rightLevels.net >= 0 ? POS_GREEN : T.red} size={16} />
              </Row>
              {/* `boardLabel` used to print here. It is on the identity line in
                  the card header now — one statement of what is on screen, in
                  one place, and inside any capture that includes the header. */}
              {/* What the Δ column is measured against, said out loud. The
                  baseline is the previous SNAPSHOT date, which after a holiday
                  or a missed run is not calendar yesterday — printing it is the
                  difference between a trustworthy column and a mystery one. */}
              {/* The Δ column is an end-of-day series — one row per session
                  close. It has nothing to say about an intraday clock, so both
                  the column and this caption are off while rewound. */}
              {!replayOn && (
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: T.text, opacity: 0.6 }}>
                  {chgBaseline
                    ? `Δ 1D vs close ${chgBaseline}`
                    : chgOk
                      ? "Δ 1D — first snapshot recorded, baseline lands next session"
                      : "Δ 1D — no end-of-day history yet"}
                </span>
              )}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
                {rightLadder.length === 0 ? (
                  <CardState
                    loading={replayOn ? replayLoading : bLoading}
                    error={replayOn ? (replayErr || null) : bError}
                    empty={replayOn
                      ? "Nothing recorded past 0DTE in this session."
                      : "No board-wide ladder yet (nothing listed past 0DTE)."}
                  />
                ) : (
                  <TlLadder
                    rows={rightLadder}
                    spot={viewSpot}
                    levels={rightLevels}
                    changes={replayOn ? null : rightChanges}
                    missing={replayRight?.missing ?? null}
                  />
                )}
              </div>
              <div style={TL_CHIP_ROW}>
                <TlLevelChip name="Core (CB)" value={rightLevels.core} spot={viewSpot} color={LEVEL_COLORS.cb} note="biggest magnet" />
                <TlLevelChip name="Call wall" value={rightLevels.callWall} spot={viewSpot} color={LEVEL_COLORS.cw} note="ceiling" />
                <TlLevelChip name="Put wall" value={rightLevels.putWall} spot={viewSpot} color={LEVEL_COLORS.pw} note="floor" />
              </div>
            </div>
          </div>

          {/* Plain-language read — the whole board, which is the regime that
              actually governs how dealers hedge. */}
          <div style={{
            border: `1px solid ${T.border}`,
            borderRadius: 10, padding: "10px 12px", background: "rgba(255,255,255,0.03)",
            fontSize: 14, lineHeight: 1.6, color: T.text,
          }}>
            <span style={{ fontWeight: 800, color: T.cyan }}>The read: </span>
            {positiveGamma
              ? "Net positive gamma across the board — dealers sell rallies and buy dips, so price tends to pin and mean-revert. "
              : "Net negative gamma across the board — dealers chase in both directions, so moves extend and volatility feeds itself. "}
            {rightLevels.core != null && `Core magnet ${rightLevels.core.toLocaleString()}. `}
            {rightLevels.callWall != null && `Call wall ${rightLevels.callWall.toLocaleString()}. `}
            {rightLevels.putWall != null && `Put wall ${rightLevels.putWall.toLocaleString()}. `}
            {rightLevels.flip != null && `Gamma flip ${rightLevels.flip.toLocaleString("en-US", { maximumFractionDigits: 2 })} — pinning above, trending below.`}
          </div>

          <span style={{ fontSize: 11, color: T.text, opacity: 0.45, fontFamily: "var(--font-mono)" }}>
            {replayOn
              ? `OI+Vol basis · recorded strike_growth sweeps${replayDate ? ` for ${replayDate}` : ""} · walls only, not the whole ladder · educational only, not investment advice`
              : "OI+Vol basis · left pane shares Multi Greek's formula · right pane is the server full-board sweep · educational only, not investment advice"}
          </span>
        </>
      )}
      {/* The live fetch stamp says nothing about a rewound card — the replay
          bar's own clock is the timestamp that matters there. */}
      {!replayOn && <UpdatedStamp at={lastUpdated} />}
    </Card>
  );
}

// (SPX Premium Flow card removed — now has its own dedicated page.)

// ── 11. STRATEGY BUILDER (full-width) ────────────────────────────────────────
// Reads the daily AI strategy written by the VPS cron (strategy-generator.js →
// daily_strategy). The page never calls Claude — it just renders the stored
// structured plan for the latest session. Full-width, spans the grid.
interface StrategyLevel { label?: string; price?: string | number; note?: string }
interface StrategyIdea {
  direction?: "long" | "short";
  entry?: string; stop?: string; target?: string; rationale?: string;
}
interface StrategyPlan {
  bias?: "long" | "short" | "neutral";
  headline?: string;
  summary?: string;
  levels?: StrategyLevel[];
  idea?: StrategyIdea;
  triggers?: string[];
  risk?: string;
}
interface StrategyResp {
  strategy?: { date?: string; plan?: StrategyPlan; generated_at?: number } | null;
  error?: string;
}

function biasColor(b?: string): string {
  if (b === "long") return POS_GREEN;
  if (b === "short") return T.red;
  return T.muted;
}

// Strategy prices are always SPX cash (generator is SPX-only). Append an SPX tag
// to a level/entry/stop/target value; blank/missing → em dash.
function withSpx(v?: string | number | null): ReactNode {
  const s = v == null ? "" : String(v).trim();
  if (!s) return "—";
  return (
    <>
      {s}
      <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, opacity: 0.65, marginLeft: 4, letterSpacing: "0.06em" }}>SPX</span>
    </>
  );
}

// Colored section header for the Strategy Builder card.
function SectionTitle({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color }}>
      {children}
    </span>
  );
}

// True while current ET wall-clock is between 09:00 and 16:00 on a weekday.
function isStrategyWindow(): boolean {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const wd = get("weekday");
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  return mins >= 9 * 60 && mins < 16 * 60;
}

function StrategyBuilderCard() {
  // Only fetch during the 9:00–16:00 ET window on weekdays.
  const [active, setActive] = useState(isStrategyWindow);

  // Re-check every minute so the card gates itself in/out without a reload.
  useEffect(() => {
    const id = setInterval(() => setActive(isStrategyWindow()), 60_000);
    return () => clearInterval(id);
  }, []);

  // 5-min poll — the plan only changes once a day, but this keeps a freshly
  // generated plan showing up without a manual reload. Pass null when outside
  // the window so useLiveData skips fetching entirely.
  const { data, loading, error, lastUpdated } = useLiveData<StrategyResp>(active ? "/api/strategy" : null, 5 * 60_000);
  const s = data?.strategy ?? null;
  const plan = s?.plan ?? null;
  const planDate = s?.date ?? null;
  const today = etDateISO();
  const isStale = planDate != null && planDate !== today;

  const ready = !!plan && (!!plan.summary || !!plan.headline);

  return (
    <Card variant="budget" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 12 }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
          Strategy Builder
          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: T.orange, opacity: 0.85, verticalAlign: "middle" }}>NOT FINANCIAL ADVICE</span>
        </span>
        {planDate && active && (
          <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: isStale ? T.orange : T.muted, opacity: 0.7 }}>
            {isStale ? `last · ${planDate}` : planDate}
          </span>
        )}
      </Row>
      {!active ? (
        <Placeholder>Available 9:00 AM – 4:00 PM ET on weekdays.</Placeholder>
      ) : loading || error || !ready ? (
        <CardState
          loading={loading}
          error={error ?? data?.error ?? null}
          empty="No strategy yet — regenerates hourly on weekdays (~7am–4pm ET)."
        />
      ) : (
        <>
          {/* Bias + headline */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 17, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
              color: biasColor(plan!.bias), border: `1px solid ${biasColor(plan!.bias)}`,
              borderRadius: 8, padding: "4px 12px",
            }}>
              {plan!.bias ?? "neutral"}
            </span>
            {plan!.headline && (
              <span style={{ fontSize: 17, fontWeight: 700, color: T.text, flex: 1 }}>{plan!.headline}</span>
            )}
          </div>

          {plan!.summary && (
            <p style={{ fontSize: 14, lineHeight: 1.65, color: T.text, margin: 0, opacity: 0.92 }}>{plan!.summary}</p>
          )}

          <div style={divider} />

          {/* Two columns: levels | trade idea + triggers */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Levels */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SectionTitle color={T.cyan}>Key levels</SectionTitle>
              {(plan!.levels?.length ?? 0) === 0 ? (
                <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>—</span>
              ) : (
                plan!.levels!.map((lv, i) => (
                  <div key={i} style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: T.cyan }}>{lv.label ?? "—"}</span>
                      {lv.price != null && String(lv.price) !== "" && (
                        <>
                          <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>—</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 800, color: T.text }}>
                            {String(lv.price)}
                            <span style={{ fontSize: 10, fontWeight: 700, color: T.muted, opacity: 0.65, marginLeft: 4, letterSpacing: "0.06em" }}>SPX</span>
                          </span>
                        </>
                      )}
                    </div>
                    {lv.note && <span style={{ fontSize: 14, color: T.muted, lineHeight: 1.45 }}>{lv.note}</span>}
                  </div>
                ))
              )}
            </div>

            {/* Trade idea + triggers + risk */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <SectionTitle color={T.orange}>Primary idea</SectionTitle>
              {plan!.idea ? (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  <Row>
                    <span style={{ fontSize: 17, fontWeight: 800, color: biasColor(plan!.idea.direction) }}>
                      {plan!.idea.direction === "long" ? "▲ LONG" : plan!.idea.direction === "short" ? "▼ SHORT" : "—"}
                    </span>
                  </Row>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    <Stat label="Entry" value={withSpx(plan!.idea.entry)} size={16} />
                    <Stat label="Stop" value={withSpx(plan!.idea.stop)} color={T.red} size={16} />
                    <Stat label="Target" value={withSpx(plan!.idea.target)} color={POS_GREEN} size={16} />
                  </div>
                  {plan!.idea.rationale && (
                    <span style={{ fontSize: 14, color: T.muted, lineHeight: 1.5 }}>{plan!.idea.rationale}</span>
                  )}
                </div>
              ) : (
                <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>—</span>
              )}

              <SectionTitle color={T.green}>Confirmation triggers</SectionTitle>
              {(plan!.triggers?.length ?? 0) === 0 ? (
                <span style={{ fontSize: 14, color: T.muted, opacity: 0.6 }}>—</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                  {plan!.triggers!.map((t, i) => (
                    <li key={i} style={{ fontSize: 17, lineHeight: 1.5, color: T.text }}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {plan!.risk && (
            <>
              <div style={divider} />
              <span style={{ fontSize: 17, color: T.muted, lineHeight: 1.55 }}>
                <span style={{ fontWeight: 800, color: T.orange, letterSpacing: "0.06em" }}>RISK · </span>
                {plan!.risk}
              </span>
            </>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  // In the GEX dock the page is iframed at ?embed=1 into a narrow column. The
  // frosted (55%-translucent + backdrop-blur) cards see-through/smear when
  // stacked there, so embed mode renders them opaque + single-column (see
  // .analytics-embed in globals.css).
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") setEmbed(new URLSearchParams(window.location.search).get("embed") === "1");
  }, []);
  return (
    <PageShell>
      <div className={`analytics-grid${embed ? " analytics-embed" : ""}`} style={{ display: "grid", gap: 14, gridTemplateColumns: embed ? "1fr" : "repeat(4, 1fr)", alignItems: "start" }}>
        <MultiGreekCard />
        <EstimatedMoveCard />
        <PremarketCard />
        <EconCalendarCard />
        <ConfidenceCard />
        <GreeksCard />
        <IbCard />
        <TickerLevelsCard />

        {/* Full-width AI daily strategy, synthesized from all cards above. */}
        <StrategyBuilderCard />

        {/* Full-width ticker lookup: any symbol → its live GEX ladder + walls. */}
        <TickerLookupCard />
      </div>
    </PageShell>
  );
}
