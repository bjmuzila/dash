"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { HOME_THEME, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeRefLevels, scanToday, computeAmt, detectTriggers, type LevelStatus, type Trigger, type InitialBalance } from "@/lib/failLevels";
import { NqIbLive } from "@/components/insights/NqIbLive";

/* ────────────────────────────────────────────────────────────────────────────
 * Analytics — strategy builder. UI-only scaffold with MOCK data.
 * Each card below renders its intended shape so we can agree on the layout
 * before wiring real data source-by-source.
 * ──────────────────────────────────────────────────────────────────────────── */

// ── shared inline helpers ───────────────────────────────────────────────────
const T = HOME_THEME;

function Label({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, opacity: 0.7 }}>
      {children}
    </span>
  );
}

function Value({ children, color = T.text, size = 16 }: { children: ReactNode; color?: string; size?: number }) {
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
function Stat({ label, value, color, size = 16 }: { label: ReactNode; value: ReactNode; color?: string; size?: number }) {
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
function useLiveData<R>(url: string | null, refreshMs = 30_000) {
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as R);
      setError(null);
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

  return { data, loading, error, reload: load };
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
  const { data, loading, error } = useLiveData<unknown>(`/api/chains?ticker=${tk}&range=all`, 60_000);
  const peaks = data ? computePeakGreeks(data) : null;
  const order: GreekKey[] = ["GEX", "DEX", "CHEX", "VEX"];
  const hasAny = peaks ? order.some((k) => peaks[k] != null) : false;

  return (
    <Card accent="cyan" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.cyan }}>Multi Greek</span>
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
                <span style={{ fontSize: 13, color: pk ? signColor(pk.value) : T.muted, opacity: 0.7, fontFamily: "monospace" }}>
                  {pk ? fmtBig(pk.value) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}
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
  const { data: lv, loading: lvLoading, error: lvError } = useLiveData<LevelsRow>(`/api/levels?ticker=${tk}`);
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
    <Card accent="orange" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.orange }}>Estimated Move</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>weekly</span>
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

function PremarketCard() {
  // AI 5-bullet read of the global pre-market tape. Written daily by the VPS cron
  // (premarket-summary-generator.js → premarket_summary); the card just reads the
  // latest stored row — same pattern as the Traders Dashboard overview.
  const { data, loading, error } = useLiveData<PremarketSummaryResp>(
    "/api/premarket-summary",
    5 * 60_000
  );
  // Live ES gap shown as a compact footer.
  const { data: gapData } = useLiveData<EsGapResp>(`/api/es-gap?date=${etDateISO()}`);

  const bullets = data?.summary?.bullets ?? [];
  const sumDate = data?.summary?.date ?? null;
  const g = gapData?.gap ?? null;
  const gapPts = g?.gap_pts ?? null;
  const up = (gapPts ?? 0) > 0;

  return (
    <Card accent="red" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.red }}>Premarket</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{sumDate ?? ""}</span>
      </Row>
      {loading || error || bullets.length === 0 ? (
        <CardState loading={loading} error={error ?? data?.error ?? null} empty="No premarket summary yet — generates ~8am ET." />
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7, maxHeight: 200, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.12) transparent" }}>
          {bullets.map((b, i) => (
            <li key={i} style={{ fontSize: 13, lineHeight: 1.45, color: T.text }}>{b}</li>
          ))}
        </ul>
      )}
      {gapPts != null && (
        <>
          <div style={divider} />
          <span style={{ fontSize: 12, color: T.muted, opacity: 0.8, fontFamily: "monospace" }}>
            /ES gap: <span style={{ color: up ? POS_GREEN : T.red }}>{up ? "+" : ""}{gapPts.toFixed(2)} pts</span>
            {g?.prior_close ? ` (${((gapPts / g.prior_close) * 100).toFixed(2)}%)` : ""}
          </span>
        </>
      )}
    </Card>
  );
}

// ── 4. ECONOMIC CALENDAR ──────────────────────────────────────────────────────
// Live calendar event shape (from /api/calendar — same source the full
// Economic Calendar page uses).
interface CalEvent {
  date: string;
  time?: string;
  time_formatted?: string;
  title: string;
  country?: string;
  impact?: string;
}

const IMPACT_COLOR: Record<string, string> = {
  High: T.red,
  Medium: T.orange,
  Low: T.muted,
  Holiday: T.muted,
  President: T.purple,
};
const impColor = (i?: string) => IMPACT_COLOR[i ?? ""] ?? T.muted;

function etToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function EconCalendarCard() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      const list: CalEvent[] = Array.isArray(json?.events) ? json.events : Array.isArray(json) ? json : [];
      setEvents(list);
    } catch (e) {
      setError(String(e));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = etToday();
  const todays = events
    .filter((e) => e.date === today)
    .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <Card accent="green" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>Economic Calendar</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{today}</span>
      </Row>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.12) transparent" }}>
        {loading || error || todays.length === 0 ? (
          <CardState loading={loading} error={error} empty="No economic events today." />
        ) : (
          todays.map((e, i) => (
            <Row key={`${e.title}-${i}`} style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
              <span style={{ fontFamily: "monospace", fontSize: 14, color: T.muted }}>{e.time_formatted || e.time || "—"}</span>
              <span style={{ fontSize: 14, flex: 1, textAlign: "left", marginLeft: 10 }}>{e.title}</span>
              <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: impColor(e.impact) }}>{e.impact || ""}</span>
            </Row>
          ))
        )}
      </div>
    </Card>
  );
}

// ── 5. CONFIDENCE SCORE ───────────────────────────────────────────────────────
interface ConfidenceResp {
  level?: number;          // current MVC price level
  price?: number;          // SPX price at the snapshot
  spx?: number;
  thresholds?: { hitPts?: number };
  // score.hit/pivot/chop/break are 0..100 (NOT fractions).
  score?: { hit?: number; pivot?: number; chop?: number; break?: number };
  error?: string;
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

  // MVC-change tracking: remember the prior level + when it changed, and whether
  // price has reached the new level since (so the timer can stop).
  const prevLevelRef = useRef<number | null>(null);
  const [changedAt, setChangedAt] = useState<number | null>(null);
  const [hitAfterChange, setHitAfterChange] = useState(false);
  const [now, setNow] = useState(Date.now()); // 1s tick for the live elapsed display

  const load = useCallback(async () => {
    setError(null);
    try {
      const today = etDateISO();
      // Score today if it has MVC snapshots, else the most recent available
      // (the 11pm pre-open seed, or the last session).
      let date = today;
      const [latestRes, todayRes] = await Promise.all([
        fetch("/api/snapshots/mvc?limit=1", { cache: "no-store" }),
        fetch(`/api/snapshots/mvc?date=${today}&limit=1`, { cache: "no-store" }),
      ]);
      const latest = (await latestRes.json())?.rows?.[0] ?? null;
      const hasToday = ((await todayRes.json())?.rows?.length ?? 0) > 0;
      if (!hasToday && latest?.date) date = String(latest.date);

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
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
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
  const isStale = forDate != null && forDate !== today;
  const band =
    s == null ? "—"
    : (s.hit ?? 0) >= (s.pivot ?? 0) && (s.hit ?? 0) >= (s.chop ?? 0) ? "HIT"
    : (s.pivot ?? 0) >= (s.chop ?? 0) ? "PIVOT"
    : "CHOP";
  const bandColor = band === "HIT" ? POS_GREEN : band === "PIVOT" ? T.orange : T.red;
  const showChange = changedAt != null;

  return (
    <Card accent="green" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green }}>Confidence Score</span>
        {isStale && forDate && (
          <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>pre-open · {forDate}</span>
        )}
      </Row>
      {loading || error || score == null ? (
        <CardState loading={loading} error={error} empty="No MVC snapshot yet for scoring." />
      ) : (
        <>
          <Row>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <Value color={bandColor} size={34}>{score}</Value>
              <span style={{ fontSize: 12, color: T.muted, opacity: 0.6 }}>/100</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.1em", color: bandColor }}>{band}</span>
          </Row>
          <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden" }}>
            <div style={{ width: `${score}%`, height: "100%", background: bandColor }} />
          </div>
          <Row>
            <Stat label="Current SPX MVC" value={mvc != null ? Math.round(mvc).toLocaleString() : "—"} color={T.cyan} />
            <Stat
              label="Distance to MVC"
              value={distToMvc != null ? `${distToMvc >= 0 ? "+" : ""}${distToMvc.toFixed(1)}` : "—"}
              color={distToMvc == null ? T.muted : Math.abs(distToMvc) <= (data?.thresholds?.hitPts ?? 8) ? POS_GREEN : T.text}
            />
          </Row>
          {showChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, paddingTop: 2 }}>
              <span style={{ fontWeight: 800, letterSpacing: "0.06em", color: T.orange }}>MVC CHANGED</span>
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
  const target = latestTs - minsAgo * 60_000;
  let best: GreeksTsRow | null = null;
  let bestDiff = Infinity;
  for (const r of rows) {
    const diff = Math.abs(r.timestamp - target);
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  }
  return best && bestDiff <= tolMin * 60_000 ? best : null;
}

function GreeksCard() {
  const { data, loading, error } = useLiveData<GreeksTsResp>(
    `/api/snapshots/greeks?date=${etDateISO()}&limit=5000`
  );
  const rows = data?.rows ?? [];
  const cur = rows.length ? rows[rows.length - 1] : null; // series is ascending
  const ago15 = cur ? rowNearestAgo(rows, cur.timestamp, 15) : null;
  const ago30 = cur ? rowNearestAgo(rows, cur.timestamp, 30) : null;

  const keys: Array<{ g: string; k: "gex" | "dex" | "chex" | "vex" }> = [
    { g: "Net GEX", k: "gex" },
    { g: "Net DEX", k: "dex" },
    { g: "Net CHEX", k: "chex" },
    { g: "Net VEX", k: "vex" },
  ];

  return (
    <Card accent={POS_GREEN} padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: POS_GREEN }}>Net Greeks</span>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>now · Δ15m · Δ30m</span>
      </Row>
      {loading || error || !cur ? (
        <CardState loading={loading} error={error} empty="No greeks series for today yet." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {keys.map(({ g, k }) => {
            const scale = GREEK_SCALE[k];
            const nowVal = cur[k] * scale;
            const d15 = ago15 ? (cur[k] - ago15[k]) * scale : null;
            const d30 = ago30 ? (cur[k] - ago30[k]) * scale : null;
            return (
              <div key={g} style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                <Label>{g}</Label>
                <Value color={signColor(nowVal)} size={16}>{fmtBig(nowVal)}</Value>
                <div style={{ display: "flex", gap: 10, fontFamily: "monospace", fontSize: 11 }}>
                  <span style={{ color: d15 == null ? T.muted : signColor(d15), opacity: d15 == null ? 0.5 : 1 }}>
                    15m {d15 == null ? "—" : fmtBig(d15)}
                  </span>
                  <span style={{ color: d30 == null ? T.muted : signColor(d30), opacity: d30 == null ? 0.5 : 1 }}>
                    30m {d30 == null ? "—" : fmtBig(d30)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [tab, setTab] = useState<"ESU" | "NQU">("ESU");
  const { candles } = useEsCandles(true);
  const grace = useGrace();
  const today = etDateISO();
  const [, tick] = useState(0);

  // 1s clock so the countdown ticks.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const cd = ibCountdown();

  // ESU IB + setups from the shared ES candle feed (filter to ESU contract).
  const { ib, setups } = (() => {
    if (tab !== "ESU" || !candles.length) return { ib: null as InitialBalance | null, setups: [] as Trigger[] };
    const esu = candles.filter((c) => (c.symbol ?? "").toUpperCase().includes("ESU"));
    const src = esu.length ? esu : candles;
    const amt = computeAmt(src, today);
    const triggers = detectTriggers(src, today, amt).filter((t) => t.active);
    return { ib: amt.ib, setups: triggers };
  })();

  const fmt = (n: number | null | undefined) => (n != null ? Math.round(n).toLocaleString() : "—");
  const rangePts = ib ? ib.high - ib.low : null;

  return (
    <Card accent="purple" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.purple }}>Initial Balance</span>
        <PillSelect value={tab} options={["ESU", "NQU"] as const} onChange={setTab} />
      </Row>

      {/* Countdown bar (both tabs share the 9:30–10:30 ET window). */}
      <div style={{ fontSize: 12, fontFamily: "monospace", color: cd.phase === "forming" ? T.orange : cd.phase === "done" ? POS_GREEN : T.muted }}>
        {cd.text}
      </div>

      {tab === "NQU" ? (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          <NqIbLive />
        </div>
      ) : ib == null ? (
        <CardState
          loading={candles.length === 0 && grace}
          error={null}
          empty={cd.phase === "pre" ? "IB hasn't formed yet — waiting for 9:30 ET open." : "No ES data for this session."}
        />
      ) : (
        <>
          <Row>
            <Stat label="IB High" value={fmt(ib.high)} color={POS_GREEN} />
            <Stat label="IB Low" value={fmt(ib.low)} color={T.red} />
            <Stat label="Range" value={cd.phase === "forming" ? "forming" : rangePts != null ? `${Math.round(rangePts)} pts` : "—"} />
          </Row>
          <div style={divider} />
          <Label>Active setups</Label>
          {setups.length === 0 ? (
            <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>
              {cd.phase === "pre" ? "Waiting for the open." : "No active setups."}
            </span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
              {setups.map((s, i) => {
                const long = s.direction === "long";
                return (
                  <div key={`${s.kind}-${s.ts}-${i}`} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
                    <Row>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>
                        <span style={{ color: long ? POS_GREEN : T.red }}>{long ? "▲" : "▼"}</span> {s.title}
                      </span>
                      <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", color: T.muted }}>{s.ref}</span>
                    </Row>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted }}>
                      entry {fmt(s.entry)} · stop {fmt(s.stop)} · tgt {fmt(s.target)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
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
  // Live + historical 5m ES candles. The hook loads ~20 days from SQLite on
  // mount, so reference levels compute even when the market's closed (weekend);
  // the live spot + in-play status only fill in once the WS feed is streaming.
  const { candles, connected } = useEsCandles(true);
  const grace = useGrace();
  const today = etDateISO();

  const { spot, statuses, hasLiveSpot } = (() => {
    if (!candles.length) {
      return { spot: null as number | null, statuses: [] as LevelStatus[], hasLiveSpot: false };
    }
    // Compute the levels themselves against the most recent session date present
    // (today when streaming; otherwise the last historical date, e.g. Friday).
    const lastDate = candles[candles.length - 1]?.date ?? today;
    const refDate = candles.some((c) => c.date === today) ? today : lastDate;
    const levels = computeRefLevels(candles, refDate);

    const todayBars = candles.filter((c) => (c.date ?? "") === today);
    const liveSpot = todayBars.length ? Number(todayBars[todayBars.length - 1].close) : null;
    // Status scan needs the active session's bars; only meaningful with today's.
    const { statuses } = scanToday(levels, todayBars.length ? todayBars : candles);
    // Fallback spot for distance display when closed = last available close.
    const fallbackSpot = candles.length ? Number(candles[candles.length - 1].close) : null;
    return { spot: liveSpot ?? fallbackSpot, statuses, hasLiveSpot: liveSpot != null };
  })();

  const hasLevels = statuses.length > 0;

  return (
    <Card accent="orange" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.orange }}>Levels & Fails</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: hasLiveSpot ? POS_GREEN : T.muted, opacity: 0.7 }}>
          {hasLiveSpot ? "live · ES" : connected ? "ES · closed" : "loading…"}
        </span>
      </Row>
      {!hasLevels ? (
        <CardState loading={!candles.length && grace} error={null} empty="No ES candles yet — levels populate when the feed streams." />
      ) : (
        <>
          <Stat
            label={hasLiveSpot ? "Spot (ES)" : "Last (ES)"}
            value={spot != null ? spot.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}
            color={T.cyan}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {statuses.map((s) => {
              const dist = spot != null ? spot - s.level.price : null;
              const above = (dist ?? 0) >= 0;
              const inPlay = s.state === "testing" || s.state === "failed";
              // In-play status only meaningful with a live session; closed = idle.
              const lbl = hasLiveSpot ? stateLabel(s.state) : { text: "—", color: T.muted };
              return (
                <Row key={s.level.kind} style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 6 }}>
                  <span style={{ fontSize: 13, flex: 1, textAlign: "left" }}>{s.level.label}</span>
                  <Value size={12}>{s.level.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Value>
                  <Value size={11} color={dist == null ? T.muted : above ? POS_GREEN : T.red}>
                    {dist == null ? "—" : `${above ? "+" : ""}${dist.toFixed(1)}`}
                  </Value>
                  <span style={{ fontSize: 8, fontWeight: 800, textTransform: "uppercase", color: lbl.color, opacity: hasLiveSpot && (inPlay || s.state === "above" || s.state === "below") ? 1 : 0.4, minWidth: 56, textAlign: "right" }}>
                    {lbl.text}
                  </span>
                </Row>
              );
            })}
          </div>
        </>
      )}
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
    <Card accent="red" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 12 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.red }}>Contract Lookup</span>
        {loaded && <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{loaded}</span>}
      </Row>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Ticker</Label>
          <input style={{ ...homeInputStyle, width: 90 }} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Expiration</Label>
          <select style={{ ...homeInputStyle, width: 150 }} value={exp} onChange={(e) => setExp(e.target.value)}>
            {exps.length === 0 && <option value="">—</option>}
            {exps.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label>Strike</Label>
          <input style={{ ...homeInputStyle, width: 90 }} value={strike} onChange={(e) => setStrike(e.target.value.replace(/[^\d.]/g, ""))} />
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
    </Card>
  );
}

// ── PAGE ──────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  return (
    <PageShell>
      <Card
        accent="cyan"
        title="Analytics"
        subtitle="Strategy builder — all cards wired to live data."
        padding="14px 16px"
        style={{ fontSize: 12 }}
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <MultiGreekCard />
        <EstimatedMoveCard />
        <PremarketCard />
        <EconCalendarCard />
        <ConfidenceCard />
        <GreeksCard />
        <IbCard />
        <LevelsCard />
        <ContractLookupCard />

        {/* Combined output — where the strategy is assembled. */}
        <Card accent="green" padding={16} style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: T.green }}>
            Strategy Output
          </span>
          <p className="text-xs" style={{ color: T.text, opacity: 0.8, margin: 0 }}>
            Synthesized signal / bias / plan assembled from the inputs above.
          </p>
          <div
            className="flex items-center justify-center"
            style={{ minHeight: 120, borderRadius: 10, border: `1px dashed ${T.border}`, color: T.muted, fontSize: 11, fontStyle: "italic" }}
          >
            — to be built —
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
