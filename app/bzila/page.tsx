"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useSpxFlow } from "@/hooks/useSpxFlow";

type StrikeMode = "rolling" | "change";
type StrikeBucket = "above" | "below";
type BzilaSession = "rth" | "ext";

interface GexHistPoint {
  ts: number;
  date?: string;
  session?: BzilaSession;
  call: number;
  put: number;
  net: number;
  spot: number;
}

interface ChainGexRow {
  strike: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
}

interface TrackedStrikeRow extends ChainGexRow {
  bucket: StrikeBucket;
  rankIndex: number;
  change15s: number;
}

interface ColoredTrackedStrikeRow extends TrackedStrikeRow {
  color: string;
}

interface BzilaStrikeHistoryRow {
  id?: number;
  timestamp: number;
  date: string;
  session?: BzilaSession;
  expiry: string;
  spot: number;
  strike: number;
  bucket: StrikeBucket;
  rank_index: number;
  call_gex: number;
  put_gex: number;
  net_gex: number;
  net_gex_change: number;
}

interface StrikeChartPoint {
  ts: number;
  date?: string;
  session?: BzilaSession;
  spot: number;
  expiry: string;
  values: Record<number, number>;
  changes: Record<number, number>;
}

interface SessionCycle {
  activeSession: BzilaSession;
  sessionDates: Record<BzilaSession, string>;
}

const REFRESH_MS = 5_000;
const SAMPLE_MS = 15_000;
const PANEL_BG = "#0d1520";
const PANEL_BORDER = "#1a2a3a";
const CARD_BORDER = "#14202e";
const CHART_BG = "#0a0e14";
const STRIKE_COLORS = [
  "#38bdf8",
  "#22c55e",
  "#f97316",
  "#facc15",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#f59e0b",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#c084fc",
  "#f87171",
  "#4ade80",
  "#06b6d4",
  "#eab308",
  "#818cf8",
  "#14b8a6",
  "#fb923c",
  "#93c5fd",
] as const;

const cardLabel: CSSProperties = {
  fontSize: 9,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  marginBottom: 4,
};

function fmtCompactNumber(value: number, divisor = 1): string {
  return (value / divisor).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  });
}

function fmtMoney(n: number): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return sign + "$" + fmtCompactNumber(abs, 1e9) + "B";
  if (abs >= 1e6) return sign + "$" + fmtCompactNumber(abs, 1e6) + "M";
  if (abs >= 1e3) return sign + "$" + fmtCompactNumber(abs, 1e3) + "K";
  return sign + "$" + fmtCompactNumber(abs);
}

function fmtSignedMoney(n: number): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "$0";
  return (value >= 0 ? "+" : "-") + fmtMoney(Math.abs(value));
}

function fmtPrice(n: number): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getEtParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);

  const out: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(out.year ?? 0),
    month: Number(out.month ?? 0),
    day: Number(out.day ?? 0),
    hour: Number(out.hour ?? 0),
    minute: Number(out.minute ?? 0),
    second: Number(out.second ?? 0),
    weekday: weekdayMap[out.weekday ?? ""] ?? -1,
  };
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getSessionCycle(date = new Date()): SessionCycle {
  const et = getEtParts(date);
  const today = `${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}`;
  const previous = shiftIsoDate(today, -1);
  const mins = et.hour * 60 + et.minute;

  if (mins < 570) {
    return {
      activeSession: "ext",
      sessionDates: { rth: previous, ext: previous },
    };
  }

  if (mins < 1020) {
    return {
      activeSession: "rth",
      sessionDates: { rth: today, ext: previous },
    };
  }

  return {
    activeSession: "ext",
    sessionDates: { rth: today, ext: today },
  };
}

function getTargetExpiryIso(): string {
  const et = getEtParts();
  const mins = et.hour * 60 + et.minute;
  const base = new Date(Date.UTC(et.year, et.month - 1, et.day, 12, 0, 0));

  if (mins >= 960) {
    do {
      base.setUTCDate(base.getUTCDate() + 1);
    } while (base.getUTCDay() === 0 || base.getUTCDay() === 6);
  }

  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

function normalizeChainRows(rows: unknown[]): ChainGexRow[] {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row as Record<string, unknown>)
    .filter((row) => Number.isFinite(Number(row?.strike)))
    .map((row) => {
      const callGEX = Number(row.callGEX ?? 0);
      const putGEX = Math.abs(Number(row.putGEX ?? 0));
      return {
        strike: Number(row.strike),
        callGEX,
        putGEX,
        netGEX: callGEX - putGEX,
      };
    })
    .sort((a, b) => a.strike - b.strike);
}

async function loadGexChain(expiry?: string): Promise<{ rows: ChainGexRow[]; spot: number }> {
  const url = expiry
    ? `/api/gex?expiry=${encodeURIComponent(expiry)}`
    : `/api/gex`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { rows: [], spot: 0 };

  const data = await res.json();
  const chainRows = Array.isArray(data?.chain)
    ? data.chain
    : Array.isArray(data?.data?.chain)
      ? data.data.chain
      : Array.isArray(data?.data?.items)
        ? data.data.items
        : [];

  const spot = Number(
    data?.spotPrice
      ?? data?.data?.spotPrice
      ?? data?.data?.underlyingPrice
      ?? data?.underlyingPrice
      ?? 0
  );

  return { rows: normalizeChainRows(chainRows), spot };
}

function selectTrackedRows(rows: ChainGexRow[], spot: number, lastKnownNet: Record<number, number>): TrackedStrikeRow[] {
  const selectBucket = (bucket: StrikeBucket, filterFn: (row: ChainGexRow) => boolean) =>
    rows
      .filter(filterFn)
      .sort((a, b) => Math.abs(b.netGEX) - Math.abs(a.netGEX))
      .slice(0, 10)
      .map((row, index) => ({
        ...row,
        bucket,
        rankIndex: index + 1,
        change15s: Number.isFinite(lastKnownNet[row.strike]) ? row.netGEX - lastKnownNet[row.strike] : 0,
      }));

  const above = selectBucket("above", (row) => row.strike >= spot);
  const below = selectBucket("below", (row) => row.strike < spot);

  return [...above, ...below];
}

function buildLastKnownNetMap(rows: BzilaStrikeHistoryRow[]): Record<number, number> {
  const latestByStrike = new Map<number, { ts: number; net: number }>();
  for (const row of rows) {
    const current = latestByStrike.get(row.strike);
    if (!current || row.timestamp >= current.ts) {
      latestByStrike.set(row.strike, { ts: row.timestamp, net: row.net_gex });
    }
  }

  const out: Record<number, number> = {};
  for (const [strike, value] of latestByStrike.entries()) {
    out[strike] = value.net;
  }
  return out;
}

function groupStrikeHistory(rows: BzilaStrikeHistoryRow[]): StrikeChartPoint[] {
  const byTs = new Map<number, StrikeChartPoint>();

  for (const row of rows) {
    let point = byTs.get(row.timestamp);
    if (!point) {
      point = {
        ts: row.timestamp,
        date: row.date,
        session: row.session,
        spot: row.spot,
        expiry: row.expiry,
        values: {},
        changes: {},
      };
      byTs.set(row.timestamp, point);
    }

    point.spot = row.spot || point.spot;
    point.date = row.date || point.date;
    point.session = row.session || point.session;
    point.expiry = row.expiry || point.expiry;
    point.values[row.strike] = row.net_gex;
    point.changes[row.strike] = row.net_gex_change;
  }

  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function extractLatestTrackedRows(rows: BzilaStrikeHistoryRow[]): TrackedStrikeRow[] {
  if (!rows.length) return [];
  const latestTs = Math.max(...rows.map((row) => row.timestamp));
  return rows
    .filter((row) => row.timestamp === latestTs)
    .map((row) => ({
      strike: row.strike,
      callGEX: row.call_gex,
      putGEX: row.put_gex,
      netGEX: row.net_gex,
      bucket: row.bucket,
      rankIndex: row.rank_index,
      change15s: row.net_gex_change,
    }))
    .sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
      return a.rankIndex - b.rankIndex;
    });
}

async function loadAggregateHistory(date: string, session: BzilaSession): Promise<GexHistPoint[]> {
  try {
    const res = await fetch(`/api/snapshots/bzila-gex-history?date=${date}&session=${session}`, { cache: "no-store" });
    const json = await res.json();
    return Array.isArray(json.rows)
      ? (json.rows as Array<Record<string, unknown>>).map((row) => ({
          ts: Number(row.timestamp ?? row.ts ?? 0),
          date: String(row.date ?? date),
          session: (row.session === "ext" ? "ext" : "rth") as BzilaSession,
          call: Number(row.call ?? 0),
          put: Number(row.put ?? 0),
          net: Number(row.net ?? 0),
          spot: Number(row.spot ?? 0),
        }))
      : [];
  } catch {
    return [];
  }
}

async function saveAggregatePoint(point: GexHistPoint, date: string, session: BzilaSession): Promise<void> {
  await fetch("/api/snapshots/bzila-gex-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: point.ts,
      date,
      session,
      call: point.call,
      put: point.put,
      net: point.net,
      spot: point.spot,
    }),
  });
}

async function loadStrikeHistory(date: string, session: BzilaSession): Promise<BzilaStrikeHistoryRow[]> {
  try {
    const res = await fetch(`/api/snapshots/bzila-strikes?date=${date}&session=${session}&limit=5000`, { cache: "no-store" });
    const json = await res.json();
    return Array.isArray(json.rows)
      ? (json.rows as Array<Record<string, unknown>>).map((row) => ({
          timestamp: Number(row.timestamp ?? 0),
          date: String(row.date ?? date),
          expiry: String(row.expiry ?? ""),
          spot: Number(row.spot ?? 0),
          strike: Number(row.strike ?? 0),
          bucket: row.bucket === "below" ? "below" : "above",
          rank_index: Number(row.rank_index ?? 0),
          call_gex: Number(row.call_gex ?? 0),
          put_gex: Number(row.put_gex ?? 0),
          net_gex: Number(row.net_gex ?? 0),
          net_gex_change: Number(row.net_gex_change ?? 0),
          session: (row.session === "ext" ? "ext" : "rth") as BzilaSession,
        }))
      : [];
  } catch {
    return [];
  }
}

async function saveStrikeRows(rows: BzilaStrikeHistoryRow[]): Promise<void> {
  await fetch("/api/snapshots/bzila-strikes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
}

function StatTile({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div
      style={{
        padding: 10,
        borderRight: `1px solid ${PANEL_BORDER}`,
        minWidth: 0,
      }}
    >
      <div style={cardLabel}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      {sub ? <div style={{ marginTop: 4, color: "#64748b", fontSize: 10 }}>{sub}</div> : null}
    </div>
  );
}

function sessionTitle(session: BzilaSession): string {
  return session === "rth" ? "RTH" : "EXT";
}

function sessionWindowLabel(session: BzilaSession): string {
  return session === "rth" ? "09:30 ET - 17:00 ET" : "17:00 ET - 09:30 ET";
}

function StrikeBucketChart({
  title,
  accent,
  rows,
  points,
  mode,
  hiddenStrikes,
  onToggleStrike,
}: {
  title: string;
  accent: string;
  rows: ColoredTrackedStrikeRow[];
  points: StrikeChartPoint[];
  mode: StrikeMode;
  hiddenStrikes: number[];
  onToggleStrike: (strike: number) => void;
}) {
  const key = mode === "rolling" ? "values" : "changes";
  const visibleRows = rows.filter((row) => !hiddenStrikes.includes(row.strike));
  const values = points.flatMap((point) =>
    visibleRows
      .map((row) => point[key][row.strike])
      .filter((value): value is number => Number.isFinite(value))
  );

  const chart = useMemo(() => {
    const width = 520;
    const height = 220;
    const pad = { l: 12, r: 72, t: 16, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;

    if (!points.length || !visibleRows.length || !values.length) {
      return null;
    }

    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = Math.max(Math.abs(max - min), 1);
    const top = max + range * 0.12;
    const bottom = min - range * 0.12;
    const xAt = (index: number) => pad.l + (points.length === 1 ? plotW / 2 : (plotW * index) / (points.length - 1));
    const yAt = (value: number) => pad.t + ((top - value) / Math.max(top - bottom, 1)) * plotH;
    const yTicks = [top, (top + bottom) / 2, 0, bottom];
    const tickCount = Math.min(points.length, 4);
    const step = Math.max(1, Math.floor(points.length / Math.max(1, tickCount - 1)));

    const series = visibleRows.map((row) => {
      // Keep a strike's last known value across gaps so the time series stays readable
      // even when that strike falls out of the current top-10 snapshot for a few samples.
      let lastValue: number | null = null;
      const coords = points
        .map((point, index) => {
          const nextValue = point[key][row.strike];
          if (Number.isFinite(nextValue)) {
            lastValue = nextValue;
          }
          if (lastValue === null || !Number.isFinite(lastValue)) return null;
          return { x: xAt(index), y: yAt(lastValue as number), value: lastValue };
        })
        .filter((entry): entry is { x: number; y: number; value: number } => Boolean(entry));

      if (!coords.length) return null;

      return {
        row,
        path: coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" "),
        last: coords[coords.length - 1],
      };
    }).filter((entry): entry is { row: ColoredTrackedStrikeRow; path: string; last: { x: number; y: number; value: number } } => Boolean(entry));

    return { width, height, pad, plotW, plotH, xAt, yAt, yTicks, step, top, bottom, series };
  }, [key, points, values, visibleRows]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: CHART_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: `1px solid ${CARD_BORDER}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div>
          <div style={{ ...cardLabel, marginBottom: 2 }}>{title}</div>
          <div style={{ color: accent, fontSize: 12, fontWeight: 700 }}>{rows.length} tracked</div>
        </div>
        <div style={{ color: "#64748b", fontSize: 10 }}>{mode === "rolling" ? "Rolling net GEX" : "15s net GEX change"}</div>
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 11 }}>Waiting for strike selection...</div>
        ) : !chart ? (
          <div style={{ color: "#64748b", fontSize: 11 }}>
            {visibleRows.length ? "Waiting for chart history..." : "All strikes hidden. Click a legend item to show one again."}
          </div>
        ) : (
          <>
            <div style={{ position: "relative", height: 220, border: `1px solid ${CARD_BORDER}`, borderRadius: 8, overflow: "hidden", background: "#09111b" }}>
              <svg viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ width: "100%", height: "100%", display: "block" }}>
                <rect x="0" y="0" width={chart.width} height={chart.height} fill="#09111b" />
                {[0, 1, 2, 3, 4].map((tick) => {
                  const y = chart.pad.t + (chart.plotH * tick) / 4;
                  return <line key={tick} x1={chart.pad.l} y1={y} x2={chart.width - chart.pad.r} y2={y} stroke="#162130" strokeWidth="1" />;
                })}
                <line
                  x1={chart.pad.l}
                  y1={chart.yAt(0)}
                  x2={chart.width - chart.pad.r}
                  y2={chart.yAt(0)}
                  stroke="#334155"
                  strokeWidth="1"
                />

                {chart.series.map((entry) => (
                  <g key={`${entry.row.bucket}-${entry.row.strike}`}>
                    <path d={entry.path} fill="none" stroke={entry.row.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={entry.last.x} cy={entry.last.y} r="2.5" fill={entry.row.color} />
                  </g>
                ))}

                {chart.yTicks.map((value, index) => (
                  <text
                    key={index}
                    x={chart.width - chart.pad.r + 8}
                    y={chart.yAt(value)}
                    fill="#94a3b8"
                    fontSize="10"
                    fontFamily="monospace"
                    dominantBaseline="middle"
                  >
                    {fmtSignedMoney(value)}
                  </text>
                ))}

                {points.map((point, index) => {
                  if (index % chart.step !== 0 && index !== points.length - 1) return null;
                  return (
                    <text
                      key={point.ts}
                      x={chart.xAt(index)}
                      y={chart.height - 8}
                      fill="#94a3b8"
                      fontSize="10"
                      fontFamily="monospace"
                      textAnchor="middle"
                    >
                      {new Date(point.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </text>
                  );
                })}
              </svg>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {rows.map((row) => {
                const hidden = hiddenStrikes.includes(row.strike);
                return (
                  <button
                    key={`${row.bucket}-${row.strike}`}
                    onClick={() => onToggleStrike(row.strike)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      border: `1px solid ${hidden ? "#243244" : row.color}`,
                      background: hidden ? "#0a1018" : "rgba(15,23,42,0.95)",
                      color: hidden ? "#64748b" : "#e2e8f0",
                      borderRadius: 999,
                      padding: "5px 8px",
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: "monospace",
                      opacity: hidden ? 0.55 : 1,
                    }}
                    title={hidden ? "Show strike" : "Hide strike"}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color, display: "inline-block" }} />
                    <span>{fmtPrice(row.strike)}</span>
                    <span style={{ color: row.netGEX >= 0 ? "#22c55e" : "#f97316" }}>{fmtSignedMoney(row.netGEX)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function BzilaPage() {
  const { flow } = useSpxFlow(true);
  const initialCycle = useMemo(() => getSessionCycle(), []);
  const [mode, setMode] = useState<StrikeMode>("rolling");
  const [selectedSession, setSelectedSession] = useState<BzilaSession>(initialCycle.activeSession);
  const [sessionCycle, setSessionCycle] = useState<SessionCycle>(initialCycle);
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [allRows, setAllRows] = useState<ChainGexRow[]>([]);
  const [trackedRows, setTrackedRows] = useState<TrackedStrikeRow[]>([]);
  const [aggregateHistory, setAggregateHistory] = useState<GexHistPoint[]>([]);
  const [strikeHistoryRows, setStrikeHistoryRows] = useState<BzilaStrikeHistoryRow[]>([]);
  const [expiry, setExpiry] = useState("");
  const [lastLiveTs, setLastLiveTs] = useState(0);
  const [lastLiveSpot, setLastLiveSpot] = useState(0);
  const [strikeTooltip, setStrikeTooltip] = useState<{ x: number; y: number; point: StrikeChartPoint } | null>(null);
  const [aggregateTooltip, setAggregateTooltip] = useState<{ x: number; y: number; point: GexHistPoint } | null>(null);
  const [shotState, setShotState] = useState<Record<string, string>>({});
  const [hiddenBucketStrikes, setHiddenBucketStrikes] = useState<Record<StrikeBucket, number[]>>({
    above: [],
    below: [],
  });

  const layoutRef = useRef<HTMLDivElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const aggregateCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastPersistRef = useRef(0);
  const lastKnownNetRef = useRef<Record<number, number>>({});
  const aggregateHistoryRef = useRef<GexHistPoint[]>([]);
  const strikeHistoryRowsRef = useRef<BzilaStrikeHistoryRow[]>([]);
  const priceFallbackRef = useRef({ spx: 0, es: 0 });
  const liveSessionRef = useRef<{ session: BzilaSession; date: string }>({
    session: initialCycle.activeSession,
    date: initialCycle.sessionDates[initialCycle.activeSession],
  });

  const isStacked = viewportWidth < 1240;
  const isMobile = viewportWidth < 860;
  const selectedSessionDate = sessionCycle.sessionDates[selectedSession];
  const viewingActiveSession =
    selectedSession === sessionCycle.activeSession &&
    selectedSessionDate === sessionCycle.sessionDates[sessionCycle.activeSession];

  useEffect(() => {
    const syncSize = () => setViewportWidth(window.innerWidth);
    syncSize();
    window.addEventListener("resize", syncSize);
    return () => window.removeEventListener("resize", syncSize);
  }, []);

  useEffect(() => {
    let alive = true;

    Promise.all([loadAggregateHistory(selectedSessionDate, selectedSession), loadStrikeHistory(selectedSessionDate, selectedSession)])
      .then(([aggregateRows, strikeRows]) => {
        if (!alive) return;
        aggregateHistoryRef.current = aggregateRows;
        strikeHistoryRowsRef.current = strikeRows;
        setAggregateHistory(aggregateRows);
        setStrikeHistoryRows(strikeRows);
        setAllRows([]);
        lastPersistRef.current = Math.max(
          aggregateRows[aggregateRows.length - 1]?.ts ?? 0,
          strikeRows[strikeRows.length - 1]?.timestamp ?? 0,
          0
        );
        lastKnownNetRef.current = buildLastKnownNetMap(strikeRows);

        const latestTracked = extractLatestTrackedRows(strikeRows);
        setTrackedRows(latestTracked);
        const latestStrikeRow = strikeRows[strikeRows.length - 1];
        if (latestStrikeRow) {
          setLastLiveSpot(latestStrikeRow.spot);
          setExpiry(latestStrikeRow.expiry);
          setLastLiveTs(latestStrikeRow.timestamp);
        } else if (aggregateRows.length) {
          setLastLiveSpot(Number(aggregateRows[aggregateRows.length - 1]?.spot ?? 0));
          setExpiry("");
          setLastLiveTs(Number(aggregateRows[aggregateRows.length - 1]?.ts ?? 0));
        } else {
          setLastLiveSpot(0);
          setExpiry("");
          setLastLiveTs(0);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [selectedSession, selectedSessionDate]);

  const latestStoredTrackedRows = useMemo(() => extractLatestTrackedRows(strikeHistoryRows), [strikeHistoryRows]);
  const displayTrackedRows = trackedRows.length ? trackedRows : latestStoredTrackedRows;
  const strikePoints = useMemo(() => {
    const points = groupStrikeHistory(strikeHistoryRows);
    if (viewingActiveSession && displayTrackedRows.length && lastLiveTs > (points[points.length - 1]?.ts ?? 0)) {
      points.push({
        ts: lastLiveTs,
        date: selectedSessionDate,
        session: selectedSession,
        spot: lastLiveSpot,
        expiry,
        values: Object.fromEntries(displayTrackedRows.map((row) => [row.strike, row.netGEX])),
        changes: Object.fromEntries(displayTrackedRows.map((row) => [row.strike, row.change15s])),
      });
    }
    return points;
  }, [displayTrackedRows, expiry, lastLiveSpot, lastLiveTs, selectedSession, selectedSessionDate, strikeHistoryRows, viewingActiveSession]);

  const trackedStrikeOrder = useMemo(
    () =>
      displayTrackedRows.map((row) => ({
        strike: row.strike,
        bucket: row.bucket,
        color: STRIKE_COLORS[(row.rankIndex - 1) + (row.bucket === "below" ? 10 : 0)] ?? "#38bdf8",
      })),
    [displayTrackedRows]
  );

  const coloredTrackedRows = useMemo<ColoredTrackedStrikeRow[]>(
    () =>
      displayTrackedRows.map((row) => ({
        ...row,
        color: STRIKE_COLORS[(row.rankIndex - 1) + (row.bucket === "below" ? 10 : 0)] ?? "#38bdf8",
      })),
    [displayTrackedRows]
  );

  const aboveRows = useMemo(
    () => coloredTrackedRows.filter((row) => row.bucket === "above").sort((a, b) => a.rankIndex - b.rankIndex),
    [coloredTrackedRows]
  );
  const belowRows = useMemo(
    () => coloredTrackedRows.filter((row) => row.bucket === "below").sort((a, b) => a.rankIndex - b.rankIndex),
    [coloredTrackedRows]
  );

  const currentSpot = lastLiveSpot || strikePoints[strikePoints.length - 1]?.spot || flow.spxPrice || flow.esPrice || 0;
  const latestAggregate = aggregateHistory[aggregateHistory.length - 1];
  const totalCallGEX = allRows.reduce((sum, row) => sum + row.callGEX, 0);
  const totalPutGEX = allRows.reduce((sum, row) => sum + row.putGEX, 0);
  const totalNetGEX = totalCallGEX - totalPutGEX;
  const displayCallGex = viewingActiveSession && allRows.length ? totalCallGEX : Number(latestAggregate?.call ?? 0);
  const displayPutGex = viewingActiveSession && allRows.length ? totalPutGEX : Number(latestAggregate?.put ?? 0);
  const displayNetGex = viewingActiveSession && allRows.length ? totalNetGEX : Number(latestAggregate?.net ?? 0);
  const status = flow.connected
    ? { text: "LIVE", bg: "#065f46", fg: "#6ee7b7" }
    : { text: "CONNECTING", bg: "#7f1d1d", fg: "#fca5a5" };

  priceFallbackRef.current = { spx: flow.spxPrice, es: flow.esPrice };

  useEffect(() => {
    setHiddenBucketStrikes((current) => ({
      above: current.above.filter((strike) => aboveRows.some((row) => row.strike === strike)),
      below: current.below.filter((strike) => belowRows.some((row) => row.strike === strike)),
    }));
  }, [aboveRows, belowRows]);

  useEffect(() => {
    let alive = true;

    const refresh = async () => {
      const cycle = getSessionCycle();
      const liveSession = cycle.activeSession;
      const liveDate = cycle.sessionDates[liveSession];
      setSessionCycle((current) =>
        current.activeSession === cycle.activeSession &&
        current.sessionDates.rth === cycle.sessionDates.rth &&
        current.sessionDates.ext === cycle.sessionDates.ext
          ? current
          : cycle
      );

      if (liveSessionRef.current.session !== liveSession || liveSessionRef.current.date !== liveDate) {
        liveSessionRef.current = { session: liveSession, date: liveDate };
        lastPersistRef.current = 0;
        lastKnownNetRef.current = {};
        if (selectedSession === liveSession) {
          aggregateHistoryRef.current = [];
          strikeHistoryRowsRef.current = [];
          setAggregateHistory([]);
          setStrikeHistoryRows([]);
          setTrackedRows([]);
          setAllRows([]);
          setLastLiveTs(0);
        }
      }

      const targetExpiry = getTargetExpiryIso();
      try {
        const primary = await loadGexChain(targetExpiry);
        const fallback = primary.rows.length && primary.spot > 0 ? primary : await loadGexChain();
        const rows = fallback.rows.length ? fallback.rows : primary.rows;
        const spot = Number((fallback.spot || primary.spot) ?? priceFallbackRef.current.spx ?? priceFallbackRef.current.es ?? 0);
        if (!alive || !rows.length || !(spot > 0)) return;

        const selectedRows = selectTrackedRows(rows, spot, lastKnownNetRef.current);
        const now = Date.now();

        if (selectedSession === liveSession) {
          setAllRows(rows);
          setTrackedRows(selectedRows);
          setExpiry(targetExpiry);
          setLastLiveSpot(spot);
          setLastLiveTs(now);
        }

        const shouldPersist =
          now - lastPersistRef.current >= SAMPLE_MS ||
          strikeHistoryRowsRef.current.length === 0 ||
          aggregateHistoryRef.current.length === 0;

        if (!shouldPersist) return;

        const aggregatePoint: GexHistPoint = {
          ts: now,
          date: liveDate,
          session: liveSession,
          call: rows.reduce((sum, row) => sum + row.callGEX, 0),
          put: rows.reduce((sum, row) => sum + row.putGEX, 0),
          net: rows.reduce((sum, row) => sum + row.netGEX, 0),
          spot,
        };

        const strikePayload: BzilaStrikeHistoryRow[] = selectedRows.map((row) => ({
          timestamp: now,
          date: liveDate,
          session: liveSession,
          expiry: targetExpiry,
          spot,
          strike: row.strike,
          bucket: row.bucket,
          rank_index: row.rankIndex,
          call_gex: row.callGEX,
          put_gex: row.putGEX,
          net_gex: row.netGEX,
          net_gex_change: row.change15s,
        }));

        try {
          await Promise.all([
            saveAggregatePoint(aggregatePoint, liveDate, liveSession),
            saveStrikeRows(strikePayload),
          ]);
        } catch {
          // Keep the live chart moving even if persistence is temporarily unavailable.
        }

        lastPersistRef.current = now;
        lastKnownNetRef.current = {
          ...lastKnownNetRef.current,
          ...Object.fromEntries(selectedRows.map((row) => [row.strike, row.netGEX])),
        };

        const nextAggregateHistory = [...aggregateHistoryRef.current, aggregatePoint];
        const nextStrikeHistoryRows = [...strikeHistoryRowsRef.current, ...strikePayload];

        aggregateHistoryRef.current = nextAggregateHistory;
        strikeHistoryRowsRef.current = nextStrikeHistoryRows;
        if (selectedSession === liveSession) {
          setAggregateHistory(nextAggregateHistory);
          setStrikeHistoryRows(nextStrikeHistoryRows);
        }
      } catch {
        // Ignore transient fetch failures; the next poll can recover.
      }
    };

    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [selectedSession]);

  const drawAggregateChart = useCallback(() => {
    const canvas = aggregateCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, width, height);

    const series = aggregateHistory;
    if (!series.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for stored SPX GEX history...", width / 2, height / 2);
      return;
    }

    const pad = { l: 12, r: 66, t: 24, b: 32 };
    const plotW = Math.max(1, width - pad.l - pad.r);
    const plotH = Math.max(1, height - pad.t - pad.b);
    const values = series.map((point) => point.net);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = Math.max(Math.abs(max - min), 1);
    const top = max + range * 0.1;
    const bottom = min - range * 0.1;

    const xAt = (index: number) => pad.l + (series.length === 1 ? plotW / 2 : (plotW * index) / (series.length - 1));
    const yAt = (value: number) => pad.t + ((top - value) / Math.max(top - bottom, 1)) * plotH;
    const zeroY = yAt(0);

    ctx.strokeStyle = "#162130";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (plotH * i) / 4;
      ctx.moveTo(pad.l, y);
      ctx.lineTo(width - pad.r, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(width - pad.r, zeroY);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    series.forEach((point, index) => {
      const x = xAt(index);
      const y = yAt(point.net);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    [top, (top + bottom) / 2, 0, bottom].forEach((value) => {
      ctx.fillText(fmtSignedMoney(value), width - pad.r + 8, yAt(value));
    });

    const tickCount = Math.min(series.length, 4);
    const step = Math.max(1, Math.floor(series.length / Math.max(1, tickCount - 1)));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < series.length; i += step) {
      ctx.fillText(
        new Date(series[i].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        xAt(i),
        height - pad.b + 6
      );
    }
    if ((series.length - 1) % step !== 0) {
      ctx.fillText(
        new Date(series[series.length - 1].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        xAt(series.length - 1),
        height - pad.b + 6
      );
    }

    const latest = series[series.length - 1];
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = "#00e5ff";
    ctx.fillText("SPX GEX HISTORY", pad.l, 6);
    ctx.textAlign = "right";
    ctx.fillStyle = latest.net >= 0 ? "#22c55e" : "#f97316";
    ctx.fillText(fmtSignedMoney(latest.net), width - pad.r, 6);
  }, [aggregateHistory]);

  const drawStrikeChart = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;

    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, width, height);

    if (!strikePoints.length || !trackedStrikeOrder.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for top 10 above / below spot snapshots...", width / 2, height / 2);
      return;
    }

    const pad = { l: 16, r: 84, t: 28, b: 42 };
    const plotW = Math.max(1, width - pad.l - pad.r);
    const plotH = Math.max(1, height - pad.t - pad.b);
    const key = mode === "rolling" ? "values" : "changes";
    const values = strikePoints.flatMap((point) =>
      trackedStrikeOrder
        .map((strikeRow) => point[key][strikeRow.strike])
        .filter((value): value is number => Number.isFinite(value))
    );

    if (!values.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Waiting for strike-series values...", width / 2, height / 2);
      return;
    }

    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = Math.max(Math.abs(max - min), 1);
    const top = max + range * 0.12;
    const bottom = min - range * 0.12;
    const xAt = (index: number) => pad.l + (strikePoints.length === 1 ? plotW / 2 : (plotW * index) / (strikePoints.length - 1));
    const yAt = (value: number) => pad.t + ((top - value) / Math.max(top - bottom, 1)) * plotH;
    const zeroY = yAt(0);

    ctx.strokeStyle = "#162130";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (plotH * i) / 5;
      ctx.moveTo(pad.l, y);
      ctx.lineTo(width - pad.r, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#334155";
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(width - pad.r, zeroY);
    ctx.stroke();

    trackedStrikeOrder.forEach((strikeRow) => {
      ctx.save();
      ctx.strokeStyle = strikeRow.color;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();

      let drew = false;
      strikePoints.forEach((point, index) => {
        const value = point[key][strikeRow.strike];
        if (!Number.isFinite(value)) {
          drew = false;
          return;
        }
        const x = xAt(index);
        const y = yAt(value);
        if (!drew) {
          ctx.moveTo(x, y);
          drew = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
      ctx.restore();

      const lastPoint = [...strikePoints].reverse().find((point) => Number.isFinite(point[key][strikeRow.strike]));
      if (lastPoint) {
        const lastIndex = strikePoints.findIndex((point) => point.ts === lastPoint.ts);
        ctx.fillStyle = strikeRow.color;
        ctx.beginPath();
        ctx.arc(xAt(lastIndex), yAt(lastPoint[key][strikeRow.strike]), 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const yTicks = [top, top * 0.5, 0, bottom * 0.5, bottom];
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    yTicks.forEach((value) => {
      ctx.fillText(fmtSignedMoney(value), width - pad.r + 8, yAt(value));
    });

    const tickCount = Math.min(strikePoints.length, isMobile ? 4 : 6);
    const step = Math.max(1, Math.floor(strikePoints.length / Math.max(1, tickCount - 1)));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < strikePoints.length; i += step) {
      ctx.fillText(
        new Date(strikePoints[i].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        xAt(i),
        height - pad.b + 8
      );
    }
    if ((strikePoints.length - 1) % step !== 0) {
      ctx.fillText(
        new Date(strikePoints[strikePoints.length - 1].ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        xAt(strikePoints.length - 1),
        height - pad.b + 8
      );
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "bold 12px monospace";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(mode === "rolling" ? "ROLLING NET GEX" : "NET GEX CHANGE (15S)", pad.l, 8);
    ctx.textAlign = "right";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${trackedStrikeOrder.length} strikes | spot ${fmtPrice(currentSpot)}`, width - pad.r, 8);
  }, [currentSpot, isMobile, mode, strikePoints, trackedStrikeOrder]);

  useEffect(() => {
    drawStrikeChart();
    drawAggregateChart();
  }, [drawAggregateChart, drawStrikeChart]);

  useEffect(() => {
    const onResize = () => {
      drawStrikeChart();
      drawAggregateChart();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawAggregateChart, drawStrikeChart]);

  const onMainCanvasMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!strikePoints.length || !mainCanvasRef.current) {
      setStrikeTooltip(null);
      return;
    }

    const rect = mainCanvasRef.current.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - 16 - 84);
    const idx =
      strikePoints.length === 1
        ? 0
        : Math.max(0, Math.min(strikePoints.length - 1, Math.round(((event.clientX - rect.left - 16) / plotW) * (strikePoints.length - 1))));

    setStrikeTooltip({
      x: event.clientX + 12,
      y: event.clientY + 12,
      point: strikePoints[idx],
    });
  };

  const onAggregateCanvasMove = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!aggregateHistory.length || !aggregateCanvasRef.current) {
      setAggregateTooltip(null);
      return;
    }

    const rect = aggregateCanvasRef.current.getBoundingClientRect();
    const plotW = Math.max(1, rect.width - 12 - 66);
    const idx =
      aggregateHistory.length === 1
        ? 0
        : Math.max(0, Math.min(aggregateHistory.length - 1, Math.round(((event.clientX - rect.left - 12) / plotW) * (aggregateHistory.length - 1))));

    setAggregateTooltip({
      x: event.clientX + 12,
      y: event.clientY + 12,
      point: aggregateHistory[idx],
    });
  };

  async function captureBlob(): Promise<Blob> {
    const layout = layoutRef.current;
    if (layout) {
      try {
        const win = window as unknown as {
          html2canvas?: (element: HTMLElement, options: object) => Promise<HTMLCanvasElement>;
        };

        if (!win.html2canvas) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            script.onload = () => window.setTimeout(resolve, 100);
            script.onerror = () => reject(new Error("html2canvas load failed"));
            document.head.appendChild(script);
          });
        }

        const shot = await win.html2canvas!(layout, {
          backgroundColor: "#0a0f16",
          scale: 2,
          useCORS: true,
          logging: false,
        });

        return await new Promise((resolve, reject) => {
          shot.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Screenshot failed"))), "image/png");
        });
      } catch {
        // Fall back to the main chart canvas.
      }
    }

    const canvas = mainCanvasRef.current;
    if (!canvas) throw new Error("Canvas not found");
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Screenshot failed"))), "image/png");
    });
  }

  function flashBtn(key: string, state: string) {
    setShotState((current) => ({ ...current, [key]: state }));
    if (state !== "loading") {
      window.setTimeout(() => {
        setShotState((current) => ({ ...current, [key]: "" }));
      }, 1500);
    }
  }

  async function copyScreenshot() {
    flashBtn("copy", "loading");
    try {
      const blob = await captureBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flashBtn("copy", "ok");
    } catch {
      flashBtn("copy", "err");
    }
  }

  async function share(platform: "x" | "discord") {
    if (platform === "x") {
      try {
        const blob = await captureBlob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } catch {
        // Open X anyway.
      }
      window.open(
        `https://twitter.com/intent/tweet?text=${encodeURIComponent("SPX BZILA flow | top net GEX strike map")}`,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    flashBtn("discord", "loading");
    try {
      const blob = await captureBlob();
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ content: "SPX BZILA flow | top net GEX strike map" }));
      form.append("files[0]", blob, "bzila-flow-net-gex.png");
      const res = await fetch("/api/discord-share", { method: "POST", body: form });
      if (!res.ok) throw new Error("Discord webhook failed");
      flashBtn("discord", "ok");
    } catch {
      flashBtn("discord", "err");
    }
  }

  const btnText = (key: string, normal: string) => {
    const state = shotState[key];
    return state === "loading" ? "..." : state === "ok" ? "✓" : state === "err" ? "✕" : normal;
  };

  const toggleBucketStrike = useCallback((bucket: StrikeBucket, strike: number) => {
    setHiddenBucketStrikes((current) => {
      const bucketStrikes = current[bucket];
      const nextBucketStrikes = bucketStrikes.includes(strike)
        ? bucketStrikes.filter((value) => value !== strike)
        : [...bucketStrikes, strike];
      return {
        ...current,
        [bucket]: nextBucketStrikes,
      };
    });
  }, []);

  const shotBtnStyle = (color: string): CSSProperties => ({
    fontSize: 9,
    padding: "2px 8px",
    border: "none",
    borderRadius: 2,
    background: "transparent",
    color,
    cursor: "pointer",
    fontFamily: "Arial",
    fontWeight: 700,
  });

  const tooltipRows = useMemo(() => {
    if (!strikeTooltip) return [];
    const lookup = new Map(displayTrackedRows.map((row) => [row.strike, row]));
    return displayTrackedRows
      .map((row) => ({
        strike: row.strike,
        bucket: row.bucket,
        value: mode === "rolling" ? strikeTooltip.point.values[row.strike] : strikeTooltip.point.changes[row.strike],
      }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8)
      .map((row) => ({
        ...row,
        color: lookup.get(row.strike)?.bucket === "above" ? "#38bdf8" : "#f97316",
      }));
  }, [displayTrackedRows, mode, strikeTooltip]);

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden", background: "#0a0f16" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: PANEL_BG,
          borderBottom: `1px solid ${PANEL_BORDER}`,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <svg style={{ width: 24, height: 24, color: "#10b981" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>Bzila Flow</h1>
            <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
              Top 10 net GEX strikes above and below spot, sampled every 15 seconds into SQLite.
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 4,
              background: status.bg,
              color: status.fg,
              fontWeight: 700,
            }}
          >
            {status.text}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: "#94a3b8", fontSize: 11 }}>
          <span>Session {sessionTitle(selectedSession)} {selectedSessionDate}</span>
          <span>Expiry {expiry || getTargetExpiryIso()}</span>
          <span>Spot {fmtPrice(currentSpot)}</span>
          <span>{displayTrackedRows.length} strikes tracked</span>
          <span>Chart mode {mode === "rolling" ? "rolling net GEX" : "15s change"}</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 12 }}>
        <div
          ref={layoutRef}
          style={{
            display: "flex",
            flexDirection: isStacked ? "column" : "row",
            gap: 12,
            minHeight: isStacked ? undefined : "100%",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              background: PANEL_BG,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 8,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderBottom: `1px solid ${PANEL_BORDER}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#10b981" }}>Strike Net GEX Map</h2>
                <span style={{ color: "#64748b", fontSize: 10 }}>Time on bottom axis, values on right axis</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", background: "#08111b", borderRadius: 5, padding: 3, border: `1px solid ${CARD_BORDER}` }}>
                  {(["rth", "ext"] as BzilaSession[]).map((session) => {
                    const active = selectedSession === session;
                    return (
                      <button
                        key={session}
                        onClick={() => setSelectedSession(session)}
                        style={{
                          padding: "7px 10px",
                          border: "none",
                          borderRadius: 4,
                          background: active ? "#102031" : "transparent",
                          color: active ? "#e2e8f0" : "#64748b",
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        title={`${sessionTitle(session)} | ${sessionWindowLabel(session)} | resets fresh at ${session === "rth" ? "09:30 ET" : "17:00 ET"}`}
                      >
                        {sessionTitle(session)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", background: "#08111b", borderRadius: 5, padding: 3, border: `1px solid ${CARD_BORDER}` }}>
                  <button
                    onClick={() => setMode("rolling")}
                    style={{
                      padding: "7px 10px",
                      border: "none",
                      borderRadius: 4,
                      background: mode === "rolling" ? "#102031" : "transparent",
                      color: mode === "rolling" ? "#e2e8f0" : "#64748b",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    Rolling Net GEX
                  </button>
                  <button
                    onClick={() => setMode("change")}
                    style={{
                      padding: "7px 10px",
                      border: "none",
                      borderRadius: 4,
                      background: mode === "change" ? "#102031" : "transparent",
                      color: mode === "change" ? "#e2e8f0" : "#64748b",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    15s Change
                  </button>
                </div>

                <div style={{ display: "flex", gap: 2, background: "#070c14", borderRadius: 2, padding: 2 }}>
                  <button
                    onClick={copyScreenshot}
                    title="Copy screenshot"
                    style={shotBtnStyle(shotState.copy === "ok" ? "#00e676" : shotState.copy === "err" ? "#ff4757" : "#00e5ff")}
                  >
                    {btnText("copy", "COPY")}
                  </button>
                  <button onClick={() => share("x")} title="Copy and open X" style={shotBtnStyle("#00e5ff")}>
                    ✕
                  </button>
                  <button
                    onClick={() => share("discord")}
                    title="Post to Discord"
                    style={shotBtnStyle(shotState.discord === "ok" ? "#00e676" : shotState.discord === "err" ? "#ff4757" : "#7289da")}
                  >
                    {btnText("discord", "💬")}
                  </button>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr",
                borderBottom: `1px solid ${PANEL_BORDER}`,
              }}
            >
              <StatTile label="Call GEX" value={aggregateHistory.length || allRows.length ? fmtSignedMoney(displayCallGex) : "-"} color="#22c55e" />
              <StatTile label="Put GEX" value={aggregateHistory.length || allRows.length ? fmtSignedMoney(displayPutGex) : "-"} color="#f97316" />
              <StatTile label="Net GEX" value={aggregateHistory.length || allRows.length ? fmtSignedMoney(displayNetGex) : "-"} color={displayNetGex >= 0 ? "#22c55e" : "#f97316"} />
              <StatTile
                label="Session Window"
                value={sessionTitle(selectedSession)}
                color={selectedSession === "rth" ? "#38bdf8" : "#f97316"}
                sub={sessionWindowLabel(selectedSession)}
              />
            </div>

            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {trackedStrikeOrder.map((row) => (
                  <div
                    key={`${row.bucket}-${row.strike}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "5px 8px",
                      borderRadius: 999,
                      border: `1px solid ${CARD_BORDER}`,
                      background: "#09111b",
                      color: "#cbd5e1",
                      fontSize: 10,
                      fontFamily: "monospace",
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: row.color, display: "inline-block" }} />
                    <span>{fmtPrice(row.strike)}</span>
                    <span style={{ color: row.bucket === "above" ? "#38bdf8" : "#f97316" }}>{row.bucket}</span>
                  </div>
                ))}
              </div>

              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: isStacked ? 420 : 560,
                  border: `1px solid ${CARD_BORDER}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: CHART_BG,
                }}
              >
                <canvas
                  ref={mainCanvasRef}
                  onMouseMove={onMainCanvasMove}
                  onMouseLeave={() => setStrikeTooltip(null)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              </div>
            </div>
          </div>

          <div
            style={{
              width: isStacked ? "100%" : 396,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              minHeight: isStacked ? undefined : 0,
            }}
          >
            <div
              style={{
                background: PANEL_BG,
                border: `1px solid ${PANEL_BORDER}`,
                borderRadius: 8,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  padding: "10px 12px",
                  borderBottom: `1px solid ${PANEL_BORDER}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={cardLabel}>Stored Aggregate History</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 12 }}>Call vs put GEX history</div>
                </div>
                <div style={{ color: "#64748b", fontSize: 10 }}>
                  {aggregateHistory.length ? `${aggregateHistory.length} snaps` : "Waiting"}
                </div>
              </div>
              <div style={{ position: "relative", height: 260, borderTop: `1px solid ${CARD_BORDER}` }}>
                <canvas
                  ref={aggregateCanvasRef}
                  onMouseMove={onAggregateCanvasMove}
                  onMouseLeave={() => setAggregateTooltip(null)}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                gap: 12,
                minHeight: 0,
              }}
            >
              <StrikeBucketChart
                title="Above Spot"
                accent="#38bdf8"
                rows={aboveRows}
                points={strikePoints}
                mode={mode}
                hiddenStrikes={hiddenBucketStrikes.above}
                onToggleStrike={(strike) => toggleBucketStrike("above", strike)}
              />
              <StrikeBucketChart
                title="Below Spot"
                accent="#f97316"
                rows={belowRows}
                points={strikePoints}
                mode={mode}
                hiddenStrikes={hiddenBucketStrikes.below}
                onToggleStrike={(strike) => toggleBucketStrike("below", strike)}
              />
            </div>
          </div>
        </div>
      </div>

      {strikeTooltip ? (
        <div style={{ position: "fixed", left: strikeTooltip.x, top: strikeTooltip.y, pointerEvents: "none", zIndex: 9999, maxWidth: 260 }}>
          <div
            style={{
              background: PANEL_BG,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 6,
              padding: 10,
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            <div style={{ color: "#94a3b8", marginBottom: 6 }}>
              {new Date(strikeTooltip.point.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              {strikeTooltip.point.spot ? ` | SPOT ${fmtPrice(strikeTooltip.point.spot)}` : ""}
            </div>
            {tooltipRows.map((row) => (
              <div key={`${row.bucket}-${row.strike}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4, color: row.color }}>
                <span>{fmtPrice(row.strike)} {row.bucket === "above" ? "A" : "B"}</span>
                <strong>{fmtSignedMoney(row.value)}</strong>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {aggregateTooltip ? (
        <div style={{ position: "fixed", left: aggregateTooltip.x, top: aggregateTooltip.y, pointerEvents: "none", zIndex: 9999, maxWidth: 220 }}>
          <div
            style={{
              background: PANEL_BG,
              border: `1px solid ${PANEL_BORDER}`,
              borderRadius: 6,
              padding: 10,
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            <div style={{ color: "#94a3b8", marginBottom: 6 }}>
              {new Date(aggregateTooltip.point.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              {aggregateTooltip.point.spot ? ` | SPOT ${fmtPrice(aggregateTooltip.point.spot)}` : ""}
            </div>
            <div style={{ color: "#22c55e", marginBottom: 4 }}>
              CALL GEX: <strong>{fmtSignedMoney(aggregateTooltip.point.call)}</strong>
            </div>
            <div style={{ color: "#f97316", marginBottom: 4 }}>
              PUT GEX: <strong>{fmtSignedMoney(aggregateTooltip.point.put)}</strong>
            </div>
            <div style={{ color: "#fbbf24", borderTop: `1px solid ${PANEL_BORDER}`, paddingTop: 6, marginTop: 6 }}>
              NET: <strong>{fmtSignedMoney(aggregateTooltip.point.net)}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
