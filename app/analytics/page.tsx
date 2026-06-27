"use client";

import { useState, useEffect, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { HOME_THEME, homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import { useEsCandles } from "@/hooks/useEsCandles";
import { computeRefLevels, scanToday, type LevelStatus } from "@/lib/failLevels";

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

// Loading / error inline state for a card body.
function CardState({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) return <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>Loading…</span>;
  if (error) return <span style={{ fontSize: 13, color: T.red }}>⚠ {error}</span>;
  return <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>No data.</span>;
}

// ── 1. MULTI GREEK ───────────────────────────────────────────────────────────
// Per-strike greek exposure, computed client-side from a /api/chains payload —
// same formula as the options-chain page's parseExpiration (OI+Vol basis).
type GreekKey = "GEX" | "DEX" | "CHEX" | "VEX";
interface PeakGreek { strike: number; value: number }

function computePeakGreeks(payload: unknown): Record<GreekKey, PeakGreek | null> {
  const data = (payload as { data?: { items?: unknown[]; underlyingPrice?: unknown } })?.data;
  const items = (data?.items as { strikes?: unknown[] }[]) ?? [];
  const S = numOr(data?.underlyingPrice) ?? 0;
  const acc = new Map<number, { gex: number; dex: number; chex: number; vex: number }>();
  const n = (o: Leg | undefined, k: string) => legNum(o, k);
  const cnt = (o: Leg | undefined) =>
    o ? (parseInt(String(o["open-interest"] ?? (o as Record<string, unknown>).openInterest ?? 0), 10) || 0) +
        (parseInt(String((o as Record<string, unknown>).volume ?? 0), 10) || 0) : 0;

  for (const group of items) {
    for (const s of (group.strikes ?? []) as Leg[]) {
      const strike = parseFloat(String(s["strike-price"] ?? 0));
      if (!strike) continue;
      const c = s.call as Leg | undefined;
      const p = s.put as Leg | undefined;
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
        <CardState loading={loading} error={error} />
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
        <CardState loading={lvLoading} error={lvError} />
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

function PremarketCard() {
  const { data, loading, error } = useLiveData<EsGapResp>(`/api/es-gap?date=${etDateISO()}`);
  const g = data?.gap ?? null;
  const prevClose = g?.prior_close ?? null;
  const open = g?.open_0930 ?? null;
  const gapPts = g?.gap_pts ?? null;
  const up = (gapPts ?? 0) > 0;
  const pctFilled = g?.pct_filled != null ? Math.round(Number(g.pct_filled) * (g.pct_filled <= 1 ? 100 : 1)) : null;
  const filled = g?.filled === true || g?.filled === 1;

  return (
    <Card accent="red" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.red }}>Premarket</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>/ES gap</span>
      </Row>
      {loading || error || g == null || gapPts == null ? (
        <CardState loading={loading} error={error} />
      ) : (
        <>
          <Row>
            <Stat label="Prev Close" value={prevClose != null ? prevClose.toLocaleString() : "—"} />
            <Stat label="9:30 Open" value={open != null ? open.toLocaleString() : "—"} />
          </Row>
          <div style={divider} />
          <Row>
            <Stat label="Gap" value={`${up ? "+" : ""}${gapPts.toFixed(2)} pts`} color={up ? POS_GREEN : T.red} size={18} />
            <Stat
              label="Gap %"
              value={prevClose ? `${((gapPts / prevClose) * 100).toFixed(2)}%` : "—"}
              color={up ? POS_GREEN : T.red}
            />
          </Row>
          <span style={{ fontSize: 13, color: T.muted, opacity: 0.8 }}>
            {up ? "Gap UP" : "Gap DOWN"}
            {pctFilled != null && ` · ${pctFilled}% filled`}
            {filled && " · FILLED"}
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {loading ? (
          <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>Loading…</span>
        ) : error ? (
          <span style={{ fontSize: 13, color: T.red }}>⚠ {error}</span>
        ) : todays.length === 0 ? (
          <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>No events today.</span>
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
        <CardState loading={loading} error={error} />
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
        <CardState loading={loading} error={error} />
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
interface IbResp {
  row?: {
    high?: number;
    low?: number;
    range?: number;
    mid?: number;
    locked?: number | boolean;
    symbol?: string;
  } | null;
}

function IbCard() {
  const { data, loading, error } = useLiveData<IbResp>(`/api/snapshots/ib?date=${etDateISO()}`);
  const row = data?.row ?? null;
  const ibHigh = row?.high ?? null;
  const ibLow = row?.low ?? null;
  const range = row?.range ?? (ibHigh != null && ibLow != null ? ibHigh - ibLow : null);
  const locked = row?.locked === 1 || row?.locked === true;
  const fmt = (n: number | null) => (n != null ? Math.round(n).toLocaleString() : "—");

  return (
    <Card accent="purple" padding={16} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Row>
        <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.purple }}>Initial Balance</span>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: T.muted, opacity: 0.6 }}>{locked ? "locked" : "forming"}</span>
      </Row>
      {loading || error || row == null || ibHigh == null || ibLow == null ? (
        <CardState loading={loading} error={error} />
      ) : (
        <>
          <Row>
            <Stat label="IB High" value={fmt(ibHigh)} color={POS_GREEN} />
            <Stat label="IB Low" value={fmt(ibLow)} color={T.red} />
            <Stat label="Range" value={range != null ? `${Math.round(range)} pts` : "—"} />
          </Row>
          <div style={divider} />
          <Label>Possible outcomes</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <Row><span style={{ fontSize: 13 }}>IB Extension Up (range × 2)</span><Value color={POS_GREEN} size={14}>{range != null ? fmt(ibHigh + range) : "—"}</Value></Row>
            <Row><span style={{ fontSize: 13 }}>IB Extension Down (range × 2)</span><Value color={T.red} size={14}>{range != null ? fmt(ibLow - range) : "—"}</Value></Row>
            <Row><span style={{ fontSize: 13 }}>IB Mid</span><Value color={T.muted} size={14}>{fmt(row?.mid ?? (ibHigh + ibLow) / 2)}</Value></Row>
          </div>
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
        <CardState loading={!candles.length} error={null} />
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
type Leg = Record<string, unknown>;
interface ContractResult {
  bid: number; ask: number; mark: number; last: number;
  volume: number; oi: number;
  delta: number; gamma: number; theta: number; vega: number; iv: number;
}

function legNum(o: Leg | undefined, ...keys: string[]): number {
  if (!o) return 0;
  for (const k of keys) {
    const v = Number(o[k]);
    if (isFinite(v) && o[k] != null && o[k] !== "") return v;
  }
  return 0;
}

// Find the call/put leg for a strike in a /api/chains payload and normalize it.
function extractContract(payload: unknown, strike: number, side: "C" | "P"): ContractResult | null {
  const data = (payload as { data?: { items?: unknown[] } })?.data;
  const items = (data?.items as { strikes?: unknown[] }[]) ?? [];
  for (const group of items) {
    for (const s of (group.strikes ?? []) as Leg[]) {
      if (parseFloat(String(s["strike-price"] ?? 0)) !== strike) continue;
      const leg = (side === "C" ? s.call : s.put) as Leg | undefined;
      if (!leg) return null;
      return {
        bid: legNum(leg, "bid", "bidPrice", "bid-price"),
        ask: legNum(leg, "ask", "askPrice", "ask-price"),
        mark: legNum(leg, "mark", "mark-price", "mid-price", "midPrice"),
        last: legNum(leg, "last", "last-price", "lastPrice"),
        volume: legNum(leg, "volume"),
        oi: legNum(leg, "open-interest", "openInterest"),
        delta: legNum(leg, "delta"),
        gamma: legNum(leg, "gamma"),
        theta: legNum(leg, "theta"),
        vega: legNum(leg, "vega"),
        iv: legNum(leg, "iv", "implied-volatility", "impliedVolatility"),
      };
    }
  }
  return null;
}

function ContractLookupCard() {
  const [ticker, setTicker] = useState("SPX");
  const [exps, setExps] = useState<string[]>([]);
  const [exp, setExp] = useState("");
  const [strike, setStrike] = useState("6050");
  const [side, setSide] = useState<"C" | "P">("C");

  const [result, setResult] = useState<ContractResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null); // label of last lookup

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
      const r = await fetch(
        `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(exp)}&range=all`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const c = extractContract(j, k, side);
      if (!c) throw new Error(`No ${strike}${side} contract in ${ticker} ${exp}`);
      setResult(c);
      setLoaded(`${ticker} ${exp} ${strike}${side}`);
    } catch (e) {
      setError(String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [ticker, exp, strike, side]);

  const mid = result ? (result.mark || (result.bid + result.ask) / 2) : 0;
  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  // Per-contract $ greeks (×100 multiplier).
  const dollarGreek = (g: number) => `${g >= 0 ? "+" : "-"}$${Math.abs(g * 100).toFixed(0)}`;

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
          <input style={{ ...homeInputStyle, width: 90 }} value={strike} onChange={(e) => setStrike(e.target.value)} />
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
        <span style={{ fontSize: 13, color: T.red }}>⚠ {error}</span>
      ) : !result ? (
        <span style={{ fontSize: 13, color: T.muted, opacity: 0.6 }}>Choose a contract and press Look up.</span>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
            <Stat label="Mid" value={fmtUsd(mid)} color={T.cyan} />
            <Stat label="Bid / Ask" value={`${result.bid.toFixed(2)} / ${result.ask.toFixed(2)}`} />
            <Stat label="Volume" value={result.volume.toLocaleString()} />
            <Stat label="Open Interest" value={result.oi.toLocaleString()} />
            <Stat label="Last" value={result.last ? fmtUsd(result.last) : "—"} />
            <Stat label="IV" value={result.iv ? `${(result.iv * (result.iv <= 1 ? 100 : 1)).toFixed(1)}%` : "—"} color={T.orange} />
          </div>
          <Label>Greeks · $ per contract</Label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
            <Stat label="Delta" value={result.delta.toFixed(2)} color={signColor(result.delta)} />
            <Stat label="Gamma $" value={dollarGreek(result.gamma)} color={signColor(result.gamma)} />
            <Stat label="Theta $/day" value={dollarGreek(result.theta)} color={signColor(result.theta)} />
            <Stat label="Vega $" value={dollarGreek(result.vega)} color={signColor(result.vega)} />
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
