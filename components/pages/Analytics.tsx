"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { HOME_THEME, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedDatePicker } from "@/components/shared/ThemedDatePicker";
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

function accumulateChainGreeks(payload: unknown): Map<number, ChainGreeks> {
  type MgLeg = Record<string, unknown>;
  const data = (payload as { data?: { items?: unknown[]; underlyingPrice?: unknown } })?.data;
  const items = (data?.items as { strikes?: unknown[] }[]) ?? [];
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
// CORE (CB) · Call Wall · Put Wall · Spot for ONE ticker at a time — same shape
// as the Estimated Move card above: a pill row switches the symbol, and the free
// text box adds any other scanner name to that row. These are the same four
// numbers the owner Results → Walls tab prints, off the same tables. Two read
// paths, because neither one alone is sufficient:
//
//   /proxy/walls?date=…   → { tickers: [{ symbol, spot, call_wall, put_wall, cb }] }
//       Sampled from scanner_snapshots onto a 15m slot grid starting 09:29 ET.
//       The ONLY endpoint that returns `cb`, so CORE comes from here or nowhere
//       (/proxy/scanner's SELECT omits the column even though the table has it).
//   /proxy/scanner?any=1  → each symbol's most recent row regardless of date,
//       swept every 2–5m. Fresher spot/walls than the slot grid, and the only
//       one that answers overnight, pre-open and at weekends — but no `cb`.
//
// So scanner wins for spot/call/put and walls supplies CORE. Both are fetched
// once for the whole universe, not per selection — switching the pill is a local
// lookup, so it's instant and costs no extra request.
//
// FUTURES — scanner_snapshots covers cash indices + equities only, no ES/NQ:
//   ESU  levels = SPX levels + the ES−SPX basis from /proxy/es-spx-basis. That
//        module is the one basis source not poisoned by the broker's "SPX" spot
//        (which actually tracks ES); a null basis stays null and blanks the
//        levels, because coercing it to 0 prints SPX strikes ~50pt out of place.
//   NQU  has no NDX→NQ basis module, so it shows live spot only — type NDX into
//        the box for the index-scale levels.
// Both futures spots come from /api/tt-quotes on the front contract.
interface WallsTickerRow {
  symbol: string;
  spot: number | null; call_wall: number | null; put_wall: number | null; cb: number | null;
}
interface WallsResp { ok?: boolean; date?: string; tickers?: WallsTickerRow[]; error?: string }
interface ScannerRow {
  symbol: string; date?: string; stale?: boolean;
  spot: number | null; call_wall: number | null; put_wall: number | null;
}
interface ScannerResp { ok?: boolean; rows?: ScannerRow[]; error?: string }
interface EsBasisResp { basis: number | null; date?: string }

const TL_DEFAULT: readonly string[] = ["ESU", "NQU", "SPX", "SPY", "QQQ"];
// Derived rows: which cash index to borrow levels from (null = no basis exists,
// spot only) and the front contract to quote spot on.
const TL_FUTURES: Record<string, { index: string | null; quote: string }> = {
  ESU: { index: "SPX", quote: "/ESU26" },
  NQU: { index: null, quote: "/NQU26" },
};
const TL_STORE_KEY = "analytics.tickerLevels.extra";

// Previous weekday (ET) as YYYY-MM-DD. Not holiday-aware — it only has to get
// the walls fallback off a weekend/pre-open, and skipping weekends already turns
// a holiday Monday into the Friday before it.
function prevSessionISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() - 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

interface TickerLevelRow {
  symbol: string;
  spot: number | null; core: number | null; call: number | null; put: number | null;
  note: string | null; stale: boolean;
}

function TickerLevelsCard() {
  const today = etDateISO();
  const [tk, setTk] = useState<string>("SPX");
  const [extra, setExtra] = useState<string[]>([]);
  const [input, setInput] = useState("");

  // Restore the trader's own tickers in an effect rather than a useState
  // initializer, so the server render and the first client render match.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(TL_STORE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setExtra(parsed.filter((s): s is string => typeof s === "string"));
    } catch { /* private mode / bad JSON — the defaults are fine */ }
  }, []);
  const persist = (next: string[]) => {
    setExtra(next);
    try { window.localStorage.setItem(TL_STORE_KEY, JSON.stringify(next)); } catch {}
  };

  const { data: walls, loading: wLoading, error: wError, lastUpdated } =
    useLiveData<WallsResp>(`/proxy/walls?date=${today}`, 120_000);
  // The slot grid doesn't start until 09:29 ET, so today's walls are empty
  // pre-open and all weekend — fall back one session so CORE still prints
  // (a holiday Monday resolves to Friday, since prevSessionISO skips weekends).
  const wallsToday = walls?.tickers ?? [];
  const { data: wallsPrev } = useLiveData<WallsResp>(
    walls && wallsToday.length === 0 ? `/proxy/walls?date=${prevSessionISO(today)}` : null, 300_000
  );
  const wallRows = wallsToday.length ? wallsToday : wallsPrev?.tickers ?? [];
  const coreStale = wallsToday.length === 0 && wallRows.length > 0;
  const { data: scan, loading: sLoading, error: sError } =
    useLiveData<ScannerResp>(`/proxy/scanner?any=1&limit=200`, 120_000);
  // Basis moves ~1pt/day and the endpoint caches for an hour — 10m is plenty.
  const { data: esBasis } = useLiveData<EsBasisResp>(`/proxy/es-spx-basis`, 600_000);
  const futSymbols = Object.values(TL_FUTURES).map((f) => f.quote).join(",");
  const { data: quotes } = useLiveData<QuotesResp>(
    `/api/tt-quotes?symbols=${encodeURIComponent(futSymbols)}`, 15_000
  );

  // scanner first (fresher spot/walls), then walls overlays CORE on top.
  const bySymbol = (() => {
    const m = new Map<string, { spot: number | null; call: number | null; put: number | null; core: number | null; stale: boolean }>();
    for (const r of scan?.rows ?? []) {
      m.set(String(r.symbol).toUpperCase(), {
        spot: numOr(r.spot), call: numOr(r.call_wall), put: numOr(r.put_wall),
        core: null, stale: !!r.stale,
      });
    }
    for (const t of wallRows) {
      const k = String(t.symbol).toUpperCase();
      const e = m.get(k);
      if (e) e.core = numOr(t.cb);
      else m.set(k, {
        spot: numOr(t.spot), call: numOr(t.call_wall), put: numOr(t.put_wall),
        core: numOr(t.cb), stale: false,
      });
    }
    return m;
  })();

  const quoteFor = (sym: string): number | null => {
    const it = quotes?.data?.items?.find((i) => String(i.symbol) === sym);
    if (!it) return null;
    const v = numOr(it.last) ?? numOr(it["last-price"]) ?? numOr(it.mark) ?? numOr(it.close);
    return v != null && v > 0 ? v : null;
  };

  const basis = esBasis && typeof esBasis.basis === "number" && isFinite(esBasis.basis) ? esBasis.basis : null;

  const buildRow = (sym: string): TickerLevelRow => {
    const fut = TL_FUTURES[sym];
    if (fut) {
      const spot = quoteFor(fut.quote);
      const src = fut.index ? bySymbol.get(fut.index) : null;
      if (!src || basis == null) {
        return {
          symbol: sym, spot, core: null, call: null, put: null, stale: false,
          note: fut.index ? "waiting on ES−SPX basis" : "no NQ basis — switch to NDX",
        };
      }
      const shift = (n: number | null) => (n == null ? null : n + basis);
      return {
        symbol: sym, spot, core: shift(src.core), call: shift(src.call), put: shift(src.put),
        stale: src.stale,
        note: `${fut.index} ${basis >= 0 ? "+" : "−"}${Math.abs(basis).toFixed(1)} basis`,
      };
    }
    const e = bySymbol.get(sym);
    return {
      symbol: sym, spot: e?.spot ?? null, core: e?.core ?? null, call: e?.call ?? null,
      put: e?.put ?? null, stale: !!e?.stale,
      note: e ? null : "not in the scanner universe",
    };
  };

  const tickers = [...TL_DEFAULT, ...extra];
  const row = buildRow(tk);

  const addTicker = () => {
    const sym = input.trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
    setInput("");
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

  return (
    <Card variant="budget" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, height: 480, overflowY: "auto" }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Ticker Levels</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: row.stale ? T.orange : T.muted, opacity: 0.7 }}>
          {row.stale ? "last sweep" : coreStale ? `core · ${wallsPrev?.date ?? "prev"}` : "core · walls"}
        </span>
      </Row>

      <PillSelect value={tk} options={tickers} onChange={setTk} />
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTicker(); } }}
          placeholder="Other ticker…"
          style={{ ...homeInputStyle, fontSize: 13, padding: "6px 10px", flex: 1, minWidth: 0 }}
        />
        <button onClick={addTicker} style={homeSecondaryButtonStyle}>Add</button>
        {extra.includes(tk) ? (
          <button onClick={() => removeTicker(tk)} style={homeSecondaryButtonStyle} title={`Remove ${tk}`}>×</button>
        ) : null}
      </div>

      {loading || error ? (
        <CardState loading={loading} error={error} empty="No scanner rows yet." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, minWidth: 0 }}>
            <Stat label="Put Wall" value={fmtLvl(row.put)} color={row.put == null ? T.muted : POS_GREEN} size={18} />
            <Stat label="Spot" value={fmtSpot(row.spot)} size={18} />
            <Stat label="Call Wall" value={fmtLvl(row.call)} color={row.call == null ? T.muted : T.orange} size={18} />
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

          {row.note ? (
            <span style={{ fontSize: 11, color: T.muted, opacity: 0.5, fontFamily: "var(--font-mono)" }}>{row.note}</span>
          ) : null}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 9. CONTRACT LOOKUP ────────────────────────────────────────────────────────
// Same model as Owner · Watch: save a contract (ticker/expiry/strike/side),
// it becomes a card, click it to see its live stats. Reuses /api/watch — the
// exact backend the Watch page runs on (probe-rest snapshot + polling).
interface WatchSnapshot {
  ts: number;
  spot: number | null; bid: number | null; ask: number | null;
  mark: number | null; last: number | null;
  iv: number | null; delta: number | null; gamma: number | null;
  theta: number | null; vega: number | null;
  open_interest: number | null; volume: number | null; net_prem: number | null;
  prev_close: number | null;
}
interface WatchRow {
  id: number; ticker: string; expiration: string; strike: number;
  side: string; note: string | null; added_price: number | null; snapshot: WatchSnapshot | null;
}

const wFmt = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "—" : v.toFixed(d));
const wFmtInt = (v: number | null | undefined) => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString());
const wFmtMoney = (v: number | null | undefined) => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};
const wDayChgPct = (mark?: number | null, prev?: number | null) =>
  mark == null || prev == null || !isFinite(mark) || !isFinite(prev) || prev === 0 ? null : ((mark - prev) / prev) * 100;
const wTimeAgo = (ts?: number | null) => {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

const WATCH_REFRESH_MS = 15_000;

function ContractLookupCard() {
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [ticker, setTicker] = useState("");
  const [expiry, setExpiry] = useState("");
  const [strike, setStrike] = useState("");
  const [side, setSide] = useState<"C" | "P">("C");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watch", { cache: "no-store" });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setRows(j.rows || []);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/watch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const j = await res.json();
      if (j.rows) setRows(j.rows);
    } catch { /* keep prior */ }
  }, []);

  useEffect(() => {
    load().then(refresh);
    const id = setInterval(refresh, WATCH_REFRESH_MS);
    return () => clearInterval(id);
  }, [load, refresh]);

  const add = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker.trim() || !expiry || !strike) return;
    setAdding(true);
    try {
      const res = await fetch("/api/watch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", ticker, expiry, strike: Number(strike), side, note }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      setTicker(""); setStrike(""); setNote("");
      await load();
    } catch (e2) {
      setErr(String(e2));
    } finally {
      setAdding(false);
    }
  }, [ticker, expiry, strike, side, note, load]);

  const remove = useCallback(async (id: number, ev: React.MouseEvent) => {
    ev.stopPropagation();
    setRows((r) => r.filter((x) => x.id !== id));
    await fetch("/api/watch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", id }),
    });
  }, []);

  return (
    <Card variant="budget" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 12 }}>
      <Row>
        <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Contract Lookup</span>
        <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: T.muted, opacity: 0.6 }}>
          {rows.length} saved · click a card for stats
        </span>
      </Row>

      <form onSubmit={add} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Ticker</Label>
          <input style={{ ...homeInputStyle, width: 90, color: T.cyan, fontWeight: 700 }} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="SPX" required />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Expiration</Label>
          <ThemedDatePicker value={expiry} onChange={setExpiry} width={150} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Strike</Label>
          <input style={{ ...homeInputStyle, width: 90, color: T.cyan, fontWeight: 700 }} type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} placeholder="6050" required />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Side</Label>
          <PillSelect value={side} options={["C", "P"] as const} onChange={setSide} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Note</Label>
          <input style={{ ...homeInputStyle, width: 140 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
        </div>
        <button type="submit" disabled={adding} style={{ ...homeButtonStyle, padding: "8px 16px", opacity: adding ? 0.6 : 1 }}>
          {adding ? "Saving…" : "+ Save"}
        </button>
      </form>

      <div style={divider} />

      {err && (
        <Placeholder minHeight={40}><span style={{ color: T.red }}>{err}</span></Placeholder>
      )}

      {loading ? (
        <Placeholder>Loading…</Placeholder>
      ) : rows.length === 0 ? (
        <Placeholder>No contracts saved yet — add one above.</Placeholder>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {rows.map((r) => {
            const s = r.snapshot;
            const isOpen = expandedId === r.id;
            const chg = wDayChgPct(s?.mark, s?.prev_close);
            const chgColor = chg == null ? T.muted : chg >= 0 ? POS_GREEN : T.red;
            const npColor = s?.net_prem == null ? T.text : s.net_prem >= 0 ? POS_GREEN : T.red;
            return (
              <div
                key={r.id}
                onClick={() => setExpandedId((cur) => (cur === r.id ? null : r.id))}
                style={{
                  border: `1px solid ${isOpen ? T.cyan : T.border}`, borderRadius: 10, padding: 12, cursor: "pointer",
                  gridColumn: isOpen ? "1 / -1" : undefined,
                }}
              >
                <Row>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{r.ticker}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.side === "C" ? POS_GREEN : T.orange }}>
                      {r.strike}{r.side}
                    </span>
                  </span>
                  <button onClick={(e) => remove(r.id, e)} title="Remove" style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 17 }}>×</button>
                </Row>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {r.expiration}{r.note && <span style={{ fontStyle: "italic" }}> · {r.note}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                  <Value color={T.cyan} size={22}>{wFmt(s?.mark)}</Value>
                  <span style={{ fontSize: 14, fontWeight: 700, color: chgColor, fontFamily: "var(--font-mono)" }}>
                    {chg == null ? "—" : `${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)}%`}
                  </span>
                  {r.added_price != null && (
                    <span style={{ fontSize: 12, color: T.muted, fontFamily: "var(--font-mono)" }}>
                      added @ {wFmt(r.added_price)}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: T.muted }}>Updated {wTimeAgo(s?.ts)}</span>

                {isOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 10, cursor: "default" }}
                  >
                    <Stat label="Spot" value={wFmt(s?.spot)} />
                    <Stat label="Bid" value={wFmt(s?.bid)} />
                    <Stat label="Ask" value={wFmt(s?.ask)} />
                    <Stat label="Delta" value={wFmt(s?.delta, 3)} color={signColor(s?.delta ?? 0)} />
                    <Stat label="Gamma" value={wFmt(s?.gamma, 4)} color={signColor(s?.gamma ?? 0)} />
                    <Stat label="Theta" value={wFmt(s?.theta, 3)} color={signColor(s?.theta ?? 0)} />
                    <Stat label="Vega" value={wFmt(s?.vega, 3)} color={signColor(s?.vega ?? 0)} />
                    <Stat label="IV" value={s?.iv == null ? "—" : `${(s.iv * 100).toFixed(1)}%`} color={T.orange} />
                    <Stat label="OI" value={wFmtInt(s?.open_interest)} />
                    <Stat label="Volume" value={wFmtInt(s?.volume)} />
                    <Stat label="Net Prem" value={wFmtMoney(s?.net_prem)} color={npColor} />
                    <Stat label="Prev Close" value={wFmt(s?.prev_close)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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

        <ContractLookupCard />
      </div>
    </PageShell>
  );
}
