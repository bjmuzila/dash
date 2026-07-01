"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { HOME_THEME, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { ThemedSelect } from "@/components/shared/ThemedSelect";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeRefLevels, scanToday, computeAmt, detectTriggers, type LevelStatus, type Trigger, type InitialBalance, type AmtResult } from "@/lib/failLevels";
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
    <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, opacity: 0.7 }}>
      {children}
    </span>
  );
}

function Value({ children, color = T.text, size = 21 }: { children: ReactNode; color?: string; size?: number }) {
  return <span style={{ fontFamily: "monospace", fontSize: size, fontWeight: 800, color }}>{children}</span>;
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
    <span style={{ fontSize: 9, fontFamily: "monospace", color: T.muted, opacity: 0.55, marginTop: "auto", paddingTop: 6, textAlign: "right" }}>
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

function computePeakGreeks(payload: unknown): Record<GreekKey, PeakGreek | null> {
  type MgLeg = Record<string, unknown>;
  const data = (payload as { data?: { items?: unknown[]; underlyingPrice?: unknown } })?.data;
  const items = (data?.items as { strikes?: unknown[] }[]) ?? [];
  const S = numOr(data?.underlyingPrice) ?? 0;
  const acc = new Map<number, { gex: number; dex: number; chex: number; vex: number }>();
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

  const peakFor = (sel: (v: { gex: number; dex: number; chex: number; vex: number }) => number): PeakGreek | null => {
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
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Multi Greek</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>peak strike</span>
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
                <span style={{ fontSize: 16, color: pk ? signColor(pk.value) : T.muted, opacity: 0.7, fontFamily: "monospace" }}>
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
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Estimated Move</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>weekly</span>
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
          <Row>
            <Stat label="EM Up" value={up!.toLocaleString()} color={POS_GREEN} />
            <Stat label={spotIsLive ? "Spot" : close != null && close > 0 ? "Close" : "Mid"} value={spot!.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
            <Stat label="EM Down" value={down!.toLocaleString()} color={T.red} />
          </Row>
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
  const emptyMsg = isStale && sumDate
    ? `Coming 8:00 AM ET for ${nextDate}.`
    : "No premarket summary yet — generates ~8am ET.";
  const g = gapData?.gap ?? null;
  const gapPts = g?.gap_pts ?? null;
  const up = (gapPts ?? 0) > 0;

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Premarket</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{isStale ? nextDate : sumDate ?? ""}</span>
      </Row>
      {loading || error || bullets.length === 0 || isStale ? (
        <CardState loading={loading} error={error ?? data?.error ?? null} empty={emptyMsg} />
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, maxHeight: 200, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.12) transparent" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 16, lineHeight: 1.45, color: T.text }}>{b}</li>
          ))}
        </ul>
      )}
      {gapPts != null && (
        <>
          <div style={divider} />
          <span style={{ fontSize: 14, color: T.muted, opacity: 0.8, fontFamily: "monospace" }}>
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
    <Card accent="cyan" padding={0} style={{ display: "flex", flexDirection: "column", overflow: "hidden", height: 420 }}>
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
  if (o === "pivot") return { text: "HIT · PIVOT", color: POS_GREEN };
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
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
          Confidence Score
          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: T.orange, opacity: 0.85, verticalAlign: "middle" }}>BETA</span>
        </span>
        {forDate && (
          <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{forDate}</span>
        )}
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
            <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", color: bandColor }}>{band}</span>
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
                  // Priority: future → pending. Past with outcome → show it.
                  // Only fall through to "pending" when the checkpoint has passed
                  // but the segment has no outcome yet (still in-progress).
                  const chip = future
                    ? { text: "pending", color: T.muted }
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
                      <span style={{ fontSize: 15, fontFamily: "monospace", color: T.muted }}>{cp.label}</span>
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
                <span style={{ color: T.muted, fontFamily: "monospace" }}>
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

function GreeksCard() {
  const today = etDateISO();
  // Today's series (ascending). Empty pre-open / overnight because the writer is
  // RTH-gated — so we fall back to the most recent prior session below.
  const { data, loading, error, lastUpdated } = useLiveData<GreeksTsResp>(
    `/api/snapshots/greeks?date=${today}&limit=5000`
  );
  // Latest-available row regardless of date — only used when today has none yet,
  // so the card shows the last session's net greeks instead of going blank.
  const { data: latest } = useLiveData<GreeksTsResp>(`/api/snapshots/greeks?limit=1`, 60_000);

  const todayRows = data?.rows ?? [];
  const usingFallback = todayRows.length === 0 && (latest?.rows?.length ?? 0) > 0;
  // Fallback endpoint returns newest-first (limit 1); today series is ascending.
  const rows = usingFallback ? (latest!.rows as GreeksTsRow[]) : todayRows;
  const cur = usingFallback
    ? rows[0]
    : rows.length ? rows[rows.length - 1] : null;
  const staleDate = usingFallback ? (cur as GreeksTsRow & { date?: string })?.date ?? null : null;
  // While the today fetch is still loading we don't yet know if we'll need the
  // fallback — only spin if BOTH have no data.
  const showLoading = loading && !cur;
  // Intraday deltas only make sense on today's live series, not the 1-row fallback.
  const ago15 = cur && !usingFallback ? rowNearestAgo(rows, cur.timestamp, 15) : null;
  const ago30 = cur && !usingFallback ? rowNearestAgo(rows, cur.timestamp, 30) : null;

  const keys: Array<{ g: string; k: "gex" | "dex" | "chex" | "vex" }> = [
    { g: "Net GEX", k: "gex" },
    { g: "Net DEX", k: "dex" },
    { g: "Net CHEX", k: "chex" },
    { g: "Net VEX", k: "vex" },
  ];

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Net Greeks</span>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>
          {usingFallback ? `last session · ${staleDate ?? ""}` : "now · Δ15m · Δ30m"}
        </span>
      </Row>
      {showLoading || error || !cur ? (
        <CardState loading={showLoading} error={error} empty="No greeks series yet." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {keys.map(({ g, k }) => {
            const scale = GREEK_SCALE[k];
            const nowVal = cur[k] * scale;
            const d15 = ago15 ? (cur[k] - ago15[k]) * scale : null;
            const d30 = ago30 ? (cur[k] - ago30[k]) * scale : null;
            return (
              <div key={g} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
                <Label>{g}</Label>
                <Value color={nowVal > 0 ? POS_GREEN : nowVal < 0 ? T.red : T.text} size={28}>{fmtBig(nowVal)}</Value>
                <div style={{ display: "flex", gap: 10, fontFamily: "monospace", fontSize: 13 }}>
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
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 7. INITIAL BALANCE ────────────────────────────────────────────────────────
// IB window 09:30–10:30 ET. Returns minutes-of-day in ET + a countdown string to
// the next IB phase ("starts in" before 9:30, "forming — Xm left" until 10:30).
const IB_OPEN_MIN = 9 * 60 + 30;
const IB_END_MIN = 10 * 60 + 30;

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

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Initial Balance</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>ES</span>
      </Row>

      {/* Countdown bar (9:30–10:30 ET IB window). */}
      <div style={{ fontSize: 12, fontFamily: "monospace", color: cd.phase === "forming" ? T.orange : cd.phase === "done" ? POS_GREEN : T.muted }}>
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
            // Where is price relative to the IB right now?
            const breakState = !ib.locked && cd.phase !== "done"
              ? "IB still forming"
              : ib.brokeHigh && ib.brokeLow
                ? "Probed both extremes — two-sided"
                : ib.brokeHigh
                  ? "Range extension ↑ above IB high"
                  : ib.brokeLow
                    ? "Range extension ↓ below IB low"
                    : "Holding inside IB";
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Row>
                  <span style={{ fontSize: 15, fontWeight: 800, color: leanColor }}>{amt?.dayTypeLabel ?? "—"}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: leanColor }}>
                    {amt?.bias.lean ?? "neutral"}
                  </span>
                </Row>
                <span style={{ fontSize: 15, color: T.muted, lineHeight: 1.5 }}>{amt?.dayTypeDetail}</span>
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, opacity: 0.7 }}>{breakState}</span>
                  <span style={{ fontSize: 16, color: T.text, lineHeight: 1.5 }}>{amt?.bias.text}</span>
                </div>
              </div>
            );
          })()}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 8. LEVELS & FAILS ─────────────────────────────────────────────────────────
// Map a level's live fail-scan state to a short label + color.
function stateLabel(st: LevelStatus["state"]): { text: string; color: string } {
  switch (st) {
    case "testing": return { text: "testing", color: T.orange };
    case "failed": return { text: "failed", color: T.red };
    case "above": return { text: "above", color: POS_GREEN };
    case "below": return { text: "below", color: T.red };
    default: return { text: "—", color: T.muted };
  }
}

function LevelsCard() {
  // Live + historical 5m ES candles. `candles` from the hook is TODAY-only;
  // `historical` holds ~20 prior days from SQLite. PDH/PDL/PWH/PWL only compute
  // when the prior-session/week RTH bars are present, so we feed the COMBINED set
  // into computeRefLevels — otherwise only Overnight H/L (which live in today's
  // pre-open bars) would ever appear.
  const { candles, historical, connected } = useEsCandles(true);
  const grace = useGrace();
  const today = etDateISO();
  const lastUpdated = candles.length ? Number(candles[candles.length - 1].timestamp) : null;

  const { spot, statuses, hasLiveSpot, setups } = (() => {
    // De-dup historical + today by slotKey (today wins) so reference levels see
    // both the prior sessions/week AND today's overnight block.
    const merged = (() => {
      const map = new Map<string, (typeof candles)[number]>();
      for (const c of historical as unknown as typeof candles) {
        if (c?.slotKey) map.set(c.slotKey, c);
      }
      for (const c of candles) if (c?.slotKey) map.set(c.slotKey, c);
      return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
    })();

    if (!merged.length) {
      return { spot: null as number | null, statuses: [] as LevelStatus[], hasLiveSpot: false, setups: [] as Trigger[] };
    }
    // Compute the levels against the most recent session date present (today when
    // streaming; otherwise the last historical date, e.g. Friday).
    const lastDate = merged[merged.length - 1]?.date ?? today;
    const refDate = merged.some((c) => c.date === today) ? today : lastDate;
    const levels = computeRefLevels(merged, refDate);

    const todayBars = candles.filter((c) => (c.date ?? "") === today);
    const liveSpot = todayBars.length ? Number(todayBars[todayBars.length - 1].close) : null;
    // Status scan needs the active session's bars; only meaningful with today's.
    const { statuses } = scanToday(levels, todayBars.length ? todayBars : merged);
    // Active setups (entry/stop/target triggers) — same source as the IB card,
    // computed off the same ES feed so the Levels card surfaces them too.
    const amt = computeAmt(todayBars.length ? todayBars : merged, refDate);
    const setups = detectTriggers(todayBars.length ? todayBars : merged, refDate, amt).filter((t) => t.active);
    // Fallback spot for distance display when closed = last available close.
    const fallbackSpot = merged.length ? Number(merged[merged.length - 1].close) : null;
    return { spot: liveSpot ?? fallbackSpot, statuses, hasLiveSpot: liveSpot != null, setups };
  })();

  const hasLevels = statuses.length > 0;

  // Are we currently inside the RTH session (09:30–16:00 ET)? Overnight H/L are
  // still "forming" until the cash open; after the open they go live.
  const rthNow = (() => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    const wd = get("weekday");
    if (wd === "Sat" || wd === "Sun") return false;
    const mins = Number(get("hour")) * 60 + Number(get("minute"));
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  })();

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Levels & Fails</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: hasLiveSpot ? POS_GREEN : T.muted, opacity: 0.7 }}>
          {hasLiveSpot ? "live · ES" : connected ? "ES · closed" : "loading…"}
        </span>
      </Row>
      {!hasLevels ? (
        <CardState loading={!candles.length && grace} error={null} empty="No ES candles yet — levels populate when the feed streams." />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...statuses].sort((a, b) => b.level.price - a.level.price).map((s) => {
              const dist = spot != null ? spot - s.level.price : null;
              const above = (dist ?? 0) >= 0;
              const inPlay = s.state === "testing" || s.state === "failed";
              const isOn = s.level.kind === "onHigh" || s.level.kind === "onLow";
              // ON High/Low keep building through the overnight session — show
              // "forming" until the 9:30 ET cash open, regardless of live spot.
              const lbl = isOn && !rthNow
                ? { text: "forming", color: T.orange }
                : hasLiveSpot
                  ? stateLabel(s.state)
                  : { text: "—", color: T.muted };
              const showStrong = hasLiveSpot && (inPlay || s.state === "above" || s.state === "below");
              return (
                <Row key={s.level.kind} style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
                  <span style={{ fontSize: 16, flex: 1, textAlign: "left" }}>{s.level.label}</span>
                  <Value size={12}>{s.level.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Value>
                  <Value size={11} color={dist == null ? T.muted : above ? POS_GREEN : T.red}>
                    {dist == null ? "—" : `${above ? "+" : ""}${dist.toFixed(2)}`}
                  </Value>
                  <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: lbl.color, opacity: showStrong || (isOn && !rthNow) ? 1 : 0.4, minWidth: 56, textAlign: "right" }}>
                    {lbl.text}
                  </span>
                </Row>
              );
            })}
          </div>

          {/* Active setups — entry/stop/target triggers off the live ES feed. */}
          <div style={divider} />
          <Label>Active setups</Label>
          {setups.length === 0 ? (
            <span style={{ fontSize: 15, color: T.muted, opacity: 0.6 }}>
              {rthNow ? "No active setups." : "Waiting for the open."}
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {setups.map((s, i) => {
                const long = s.direction === "long";
                const fmt = (n: number | null | undefined) => (n != null ? Math.round(n).toLocaleString() : "—");
                return (
                  <div key={`${s.kind}-${s.ts}-${i}`} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                    <Row>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>
                        <span style={{ color: long ? POS_GREEN : T.red }}>{long ? "▲" : "▼"}</span> {s.title}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: T.muted }}>{s.ref}</span>
                    </Row>
                    <span style={{ fontSize: 12, fontFamily: "monospace", color: T.muted }}>
                      entry {fmt(s.entry)} · stop {fmt(s.stop)} · tgt {fmt(s.target)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 9. CONTRACT LOOKUP ────────────────────────────────────────────────────────
// Uses /proxy/probe-rest — the SAME path the /dev page uses: chain → resolve
// strike → market-data, returning per-strike COMPUTED greek exposures
// (gex=γ·OI·S², dex=δ·OI·100·S, vex=vega·OI·100·S, charm/vanna), plus the
// raw feeds (Quote / Trade / Summary / Greeks).
type Probe = Record<string, unknown>;
interface ProbeResult {
  feeds?: Record<string, Probe>;
  exposures?: Probe;
}

function pnum(o: Probe | undefined, ...keys: string[]): number | null {
  if (!o) return null;
  for (const k of keys) {
    const v = o[k];
    const n = Number(v);
    if (v != null && v !== "" && isFinite(n)) return n;
  }
  return null;
}

// Compact signed exposure formatter (B/M/K) — mirrors /dev's fmtExp.
function fmtExpVal(v: number | null): string {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(2)}`;
}

function ContractLookupCard() {
  const [ticker, setTicker] = useState("SPX");
  const [exps, setExps] = useState<string[]>([]);
  const [exp, setExp] = useState("");
  const [strike, setStrike] = useState("6050");
  const [side, setSide] = useState<"C" | "P">("C");

  const [result, setResult] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [expOpen, setExpOpen] = useState(false);

  // Real listed expirations for the active ticker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
        const j = await r.json();
        const items: Array<Record<string, unknown>> = j?.data?.items ?? [];
        const seen = new Set<string>();
        const list = items
          .map((it) => String(it["expiration-date"] ?? ""))
          .filter((d) => d && !seen.has(d) && (seen.add(d), true))
          .sort();
        if (cancelled) return;
        setExps(list);
        if (list.length && !list.includes(exp)) setExp(list[0]);
      } catch { /* keep prior */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const lookup = useCallback(async () => {
    const k = parseFloat(strike);
    if (!ticker || !exp || !isFinite(k)) return;
    setLoading(true);
    setError(null);
    try {
      // Same call /dev makes (one side at a time).
      const url = `/proxy/probe-rest?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(exp)}&type=${side}&strike=${encodeURIComponent(strike)}`;
      const r = await fetch(url, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      if (!d?.found) {
        throw new Error(
          d?.status === "no-strike" ? `No ${strike} strike for ${ticker} ${exp}`
          : d?.status === "no-expiry" ? `No expiry ${exp} for ${ticker}`
          : d?.error || `No data (${d?.status ?? "?"})`
        );
      }
      setResult(d.result as ProbeResult);
      setLoaded(`${ticker} ${exp} ${strike}${side}`);
      setLastUpdated(Date.now());
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, exp, strike, side]);

  const feeds = result?.feeds ?? {};
  const ex = result?.exposures ?? {};
  const quote = feeds.Quote, trade = feeds.Trade, summary = feeds.Summary, greeks = feeds.Greeks;

  const bid = pnum(quote, "bidPrice", "bid", "bid-price");
  const ask = pnum(quote, "askPrice", "ask", "ask-price");
  const mark = pnum(quote, "markPrice", "mark", "mark-price") ?? pnum(trade, "price", "last", "last-price");
  const oi = pnum(summary, "openInterest", "open-interest");
  const vol = pnum(trade, "volume") ?? pnum(summary, "volume");
  const iv = pnum(greeks, "iv", "volatility", "impliedVolatility");
  const fmtUsd = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

  // Strike-computed exposures (signed), as on /dev.
  const exposureRows: Array<{ label: string; key: string }> = [
    { label: "GEX (γ·OI·S²)", key: "gex" },
    { label: "DEX (δ·OI·100·S)", key: "dex" },
    { label: "VEX (vega·OI·100·S)", key: "vex" },
    { label: "Theta exp", key: "thetaExp" },
    { label: "Charm exp", key: "charmExp" },
    { label: "Vanna exp", key: "vannaExp" },
  ];

  return (
    <Card accent="cyan" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 12, position: "relative", zIndex: expOpen ? 80 : "auto" }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Contract Lookup</span>
        {loaded && <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{loaded}</span>}
      </Row>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Ticker</Label>
          <input style={{ ...homeInputStyle, width: 90, color: T.cyan, fontWeight: 700 }} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Expiration</Label>
          <ThemedSelect
            width={150}
            value={exp}
            placeholder="—"
            options={exps.map((d) => ({ value: d, label: d }))}
            onChange={setExp}
            onOpenChange={setExpOpen}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Strike</Label>
          <input style={{ ...homeInputStyle, width: 90, color: T.cyan, fontWeight: 700 }} value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Side</Label>
          <PillSelect value={side} options={["C", "P"] as const} onChange={setSide} />
        </div>
        <button onClick={lookup} disabled={loading} style={{ ...homeButtonStyle, padding: "8px 16px" }}>
          {loading ? "…" : "Look up"}
        </button>
      </div>
      <div style={divider} />
      {error ? (
        <CardState loading={false} error={error} />
      ) : !result ? (
        <CardState loading={false} error={null} empty="Choose a contract and press Look up." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
            <Stat label="Mark" value={fmtUsd(mark)} color={T.cyan} />
            <Stat label="Bid / Ask" value={bid != null && ask != null ? `${bid.toFixed(2)} / ${ask.toFixed(2)}` : "—"} />
            <Stat label="Volume" value={vol != null ? vol.toLocaleString() : "—"} />
            <Stat label="Open Interest" value={oi != null ? oi.toLocaleString() : "—"} />
            <Stat label="IV" value={iv != null ? `${(iv * (iv <= 1 ? 100 : 1)).toFixed(1)}%` : "—"} color={T.orange} />
          </div>
          <Label>Greeks · strike-computed exposures</Label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
            {exposureRows.map(({ label, key }) => {
              const v = pnum(ex, key);
              return <Stat key={key} label={label} value={fmtExpVal(v)} color={v == null ? T.muted : signColor(v)} />;
            })}
          </div>
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

// ── 10. SPX PREMIUM SPARKLINE ─────────────────────────────────────────────────
// Reads from /api/snapshots/premium — rows written by the server-v2 premium-flow
// writer every ~30s during RTH. Each row: {timestamp, callPremium, putPremium,
// netPremium, spxPrice}. Displays a session sparkline of netPremium (calls−puts)
// plus current call/put/net totals.
//
// NOTE: The server-side writer uses `state.spxPrice` to classify OTM strikes.
// The attached logic fix requires that assignment to be dynamic (every ES tick),
// not frozen on first tick, so OTM detection stays accurate as the market moves.
// That fix lives in server-v2 (spxPrice assignment) — this card just reads the
// stored series.
interface PremiumRow {
  timestamp: number;
  callPremium: number;
  putPremium: number;
  netPremium: number;
  spxPrice: number;
}
interface PremiumResp { rows?: PremiumRow[] }

// SVG sparkline — renders a path from a series of (x, y) points.
function Sparkline({
  rows, width = 320, height = 72,
}: {
  rows: PremiumRow[]; width?: number; height?: number;
}) {
  if (rows.length < 2) return (
    <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 12, color: T.muted, opacity: 0.5 }}>Not enough data points yet.</span>
    </div>
  );

  const vals = rows.map((r) => r.netPremium);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const PAD = 4;
  const W = width - PAD * 2;
  const H = height - PAD * 2;

  // Map to SVG coords; Y inverted (SVG 0,0 top-left).
  const pts = rows.map((r, i) => {
    const x = PAD + (i / (rows.length - 1)) * W;
    const y = PAD + H - ((r.netPremium - min) / range) * H;
    return `${x},${y}`;
  });

  // Zero line (if it's in range).
  const zeroY = PAD + H - ((0 - min) / range) * H;
  const showZero = zeroY >= PAD && zeroY <= PAD + H;
  const lastVal = vals[vals.length - 1];
  const lineColor = lastVal >= 0 ? POS_GREEN : T.red;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      {showZero && (
        <line
          x1={PAD} y1={zeroY} x2={PAD + W} y2={zeroY}
          stroke={T.border} strokeWidth={1} strokeDasharray="3,3"
        />
      )}
      {/* Fill under the line */}
      <defs>
        <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
          <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon
        points={`${PAD},${PAD + H} ${pts.join(" ")} ${PAD + W},${PAD + H}`}
        fill="url(#pf-fill)"
      />
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dot at latest value */}
      {(() => {
        const [lx, ly] = (pts[pts.length - 1] ?? "0,0").split(",").map(Number);
        return <circle cx={lx} cy={ly} r={3} fill={lineColor} />;
      })()}
    </svg>
  );
}

// Format premium dollar values ($1.2M / $840K / etc.).
function fmtPrem(n: number): string {
  const sign = n >= 0 ? "+" : "-";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
}
function fmtPremAbs(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `$${(a / 1_000).toFixed(1)}K`;
  return `$${a.toFixed(0)}`;
}

function SpxPremiumSparklineCard() {
  const today = etDateISO();
  const { data, loading, error, lastUpdated, reload } =
    useLiveData<PremiumResp>(`/api/snapshots/premium?date=${today}&limit=2000`, 30_000);

  const rows = (data?.rows ?? []).map((r) => ({
    ...r,
    timestamp: Number(r.timestamp),
    callPremium: Number(r.callPremium),
    putPremium: Number(r.putPremium),
    netPremium: Number(r.netPremium),
    spxPrice: Number(r.spxPrice),
  }));

  const cur = rows.length ? rows[rows.length - 1] : null;
  const net = cur?.netPremium ?? null;
  const call = cur?.callPremium ?? null;
  const put = cur?.putPremium ?? null;
  const spx = cur?.spxPrice ?? null;
  const netColor = net == null ? T.muted : net >= 0 ? POS_GREEN : T.red;

  // Session high / low net.
  const netVals = rows.map((r) => r.netPremium);
  const sessionHigh = netVals.length ? Math.max(...netVals) : null;
  const sessionLow  = netVals.length ? Math.min(...netVals) : null;

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
          SPX Premium Flow
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {spx != null && (
            <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>
              SPX {spx.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </span>
          )}
          <button
            onClick={reload}
            style={{ fontSize: 9, padding: "2px 8px", border: `1px solid ${T.border}`, borderRadius: 4, background: "transparent", color: T.muted, cursor: "pointer" }}
          >↺</button>
        </div>
      </Row>

      {/* Net premium headline */}
      {net != null ? (
        <Row>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Label>Net (Calls − Puts)</Label>
            <Value color={netColor} size={30}>{fmtPrem(net)}</Value>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: POS_GREEN }}>▲ calls {fmtPremAbs(call ?? 0)}</span>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: T.red }}>▼ puts {fmtPremAbs(put ?? 0)}</span>
          </div>
        </Row>
      ) : null}

      {/* Sparkline */}
      {loading || error || rows.length === 0 ? (
        <CardState loading={loading} error={error} empty="No SPX premium data yet — populates during RTH." />
      ) : (
        <Sparkline rows={rows} height={72} />
      )}

      {/* Session range */}
      {sessionHigh != null && sessionLow != null && (
        <>
          <div style={divider} />
          <Row>
            <Stat label="Session High" value={fmtPrem(sessionHigh)} color={POS_GREEN} size={14} />
            <Stat label="Session Low" value={fmtPrem(sessionLow)} color={T.red} size={14} />
            <Stat label="Ticks" value={rows.length.toString()} size={14} />
          </Row>
        </>
      )}

      <UpdatedStamp at={lastUpdated} />
    </Card>
  );
}

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
    <Card accent="cyan" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 12 }}>
      <Row>
        <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>
          Strategy Builder
          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: T.orange, opacity: 0.85, verticalAlign: "middle" }}>NOT FINANCIAL ADVICE</span>
        </span>
        {planDate && active && (
          <span style={{ fontSize: 11, fontFamily: "monospace", color: isStale ? T.orange : T.muted, opacity: 0.7 }}>
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
              fontSize: 16, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
              color: biasColor(plan!.bias), border: `1px solid ${biasColor(plan!.bias)}`,
              borderRadius: 8, padding: "4px 12px",
            }}>
              {plan!.bias ?? "neutral"}
            </span>
            {plan!.headline && (
              <span style={{ fontSize: 18, fontWeight: 700, color: T.text, flex: 1 }}>{plan!.headline}</span>
            )}
          </div>

          {plan!.summary && (
            <p style={{ fontSize: 15, lineHeight: 1.65, color: T.text, margin: 0, opacity: 0.92 }}>{plan!.summary}</p>
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
                    <Row>
                      <span style={{ fontSize: 15, fontWeight: 700, color: T.cyan }}>{lv.label ?? "—"}</span>
                      <Value size={15} color={T.text}>{lv.price != null ? String(lv.price) : "—"}</Value>
                    </Row>
                    {lv.note && <span style={{ fontSize: 15, color: T.muted, lineHeight: 1.45 }}>{lv.note}</span>}
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
                    <span style={{ fontSize: 16, fontWeight: 800, color: biasColor(plan!.idea.direction) }}>
                      {plan!.idea.direction === "long" ? "▲ LONG" : plan!.idea.direction === "short" ? "▼ SHORT" : "—"}
                    </span>
                  </Row>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    <Stat label="Entry" value={plan!.idea.entry ?? "—"} size={16} />
                    <Stat label="Stop" value={plan!.idea.stop ?? "—"} color={T.red} size={16} />
                    <Stat label="Target" value={plan!.idea.target ?? "—"} color={POS_GREEN} size={16} />
                  </div>
                  {plan!.idea.rationale && (
                    <span style={{ fontSize: 15, color: T.muted, lineHeight: 1.5 }}>{plan!.idea.rationale}</span>
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
                    <li key={i} style={{ fontSize: 16, lineHeight: 1.5, color: T.text }}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {plan!.risk && (
            <>
              <div style={divider} />
              <span style={{ fontSize: 16, color: T.muted, lineHeight: 1.55 }}>
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
  return (
    <PageShell>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <MultiGreekCard />
        <EstimatedMoveCard />
        <PremarketCard />
        <EconCalendarCard />
        <ConfidenceCard />
        <GreeksCard />
        <IbCard />
        <LevelsCard />
        <SpxPremiumSparklineCard />

        {/* Full-width AI daily strategy, synthesized from all cards above. */}
        <StrategyBuilderCard />

        <ContractLookupCard />
      </div>
    </PageShell>
  );
}
