"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoxDiscordBtn, BoxSnapBtn } from "@/components/shared/DataBox";
import { useRefreshButton } from "@/hooks/useRefreshButton";
import { HOME_THEME as HT, homeShellStyle, homeButtonStyle } from "@/components/shared/homeTheme";

// ── Custom dropdown (bypasses native OS rendering) ─────────────────────────
function CustomDropdown<T extends string | number>({
  value,
  options,
  onChange,
  formatLabel,
  accentCyan,
}: {
  value: T;
  options: T[] | readonly T[];
  onChange: (v: T) => void;
  formatLabel?: (v: T) => string;
  accentCyan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = formatLabel ? formatLabel(value) : String(value);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const color = accentCyan !== false ? HT.cyan : HT.text;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 10, fontWeight: 800, padding: "4px 8px",
          border: `1px solid ${accentCyan !== false ? "rgba(0,229,255,.3)" : HT.border}`,
          borderRadius: 4,
          background: "rgba(0,0,0,0.4)",
          color,
          cursor: "pointer", outline: "none",
          display: "flex", alignItems: "center", gap: 5,
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span style={{ fontSize: 7, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, zIndex: 999,
          background: "rgba(13,17,25,0.97)", backdropFilter: "blur(20px)",
          border: `1px solid ${HT.border}`, borderRadius: 6,
          padding: "3px 0", minWidth: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
        }}>
          {options.map(opt => {
            const optLabel = formatLabel ? formatLabel(opt) : String(opt);
            const active = opt === value;
            return (
              <div
                key={String(opt)}
                onClick={() => { onChange(opt); setOpen(false); }}
                style={{
                  padding: "6px 12px", fontSize: 10, fontWeight: active ? 800 : 600,
                  cursor: "pointer", whiteSpace: "nowrap",
                  color: active ? HT.cyan : HT.text,
                  background: active ? "rgba(0,229,255,0.10)" : "transparent",
                  letterSpacing: "0.04em",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = active ? "rgba(0,229,255,0.15)" : "rgba(255,255,255,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = active ? "rgba(0,229,255,0.10)" : "transparent")}
              >
                {optLabel}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const QUOTE_PANEL_TICKERS = [
  "VIX",
  "SPX",
  "SPCX",
  "QQQ",
  "SMH",
  "AAPL",
  "AMD",
  "AMZN",
  "GOOGL",
  "META",
  "MSFT",
  "NVDA",
  "TSLA",
];

const DISPLAY_PERCENTS = [5, 10, 15, 20, 25, 30, 50, 100] as const;
const GREEK_MODES = ["gex", "dex", "chex", "vex"] as const;
type GreekMode = typeof GREEK_MODES[number];

// Number of expirations shown side-by-side across the matrix.
const EXP_COLUMNS = 7;

// Per-strike, per-expiration greek values.
type GreekCell = {
  gex: number;
  dex: number;
  chex: number;
  vex: number;
};

// One expiration's column: its date + a strike→greek map.
type ExpColumn = {
  expiration: string;
  label: string;
  cells: Map<number, GreekCell>;
  underlying: number;
};

function etToday(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}

function etDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isHoliday(date: Date): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();

  // US market holidays (non-exhaustive, add more as needed)
  const holidays: Array<[number, number]> = [
    [1, 1],    // New Year's Day
    [7, 4],    // Independence Day
    [12, 25],  // Christmas
  ];

  // Check fixed holidays
  if (holidays.some(([m, d]) => month === m && day === d)) return true;

  // MLK Day (3rd Monday in January)
  if (month === 1) {
    const firstDay = new Date(year, 0, 1).getDay();
    const mlkDay = 15 + ((8 - firstDay) % 7);
    if (day === mlkDay) return true;
  }

  // Presidents Day (3rd Monday in February)
  if (month === 2) {
    const firstDay = new Date(year, 1, 1).getDay();
    const presDay = 15 + ((8 - firstDay) % 7);
    if (day === presDay) return true;
  }

  // Memorial Day (last Monday in May)
  if (month === 5) {
    const lastDay = new Date(year, 5, 0).getDate();
    const lastMonday = lastDay - ((new Date(year, 4, lastDay).getDay() + 1) % 7);
    if (day === lastMonday) return true;
  }

  // Labor Day (1st Monday in September)
  if (month === 9) {
    const firstDay = new Date(year, 8, 1).getDay();
    const laborDay = 1 + ((8 - firstDay) % 7);
    if (day === laborDay) return true;
  }

  // Thanksgiving (4th Thursday in November)
  if (month === 11) {
    const firstDay = new Date(year, 10, 1).getDay();
    const thanksgiving = 22 + ((5 - firstDay) % 7);
    if (day === thanksgiving) return true;
  }

  return false;
}

function isTradingDay(date: Date): boolean {
  const dayOfWeek = date.getDay();
  // Skip weekends (0 = Sunday, 6 = Saturday)
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  // Skip holidays
  if (isHoliday(date)) return false;
  return true;
}

// True during the live RTH session (9:30–16:00 ET on a trading day). Per-strike
// volume only accumulates from real session prints, so it reads 0 from 9:00–9:30
// even though OI (settled overnight) is already populated. We poll the chain
// through the session so volume climbs as trades print instead of staying frozen
// at the stale 0 from the page's one-shot load.
function isSessionLive(): boolean {
  const et = etToday();
  if (!isTradingDay(et)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function buildExpiries() {
  const today = etToday();
  const list: Array<{ value: string; label: string }> = [];
  let daysAdded = 0;
  let offset = 0;

  // Day abbreviations
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Find next 12 trading days
  while (daysAdded < 12 && offset < 30) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);

    if (isTradingDay(date)) {
      const value = etDateKey(date);
      const dayName = dayNames[date.getDay()];
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      list.push({ value, label: `${dayName}, ${mm}-${dd}-${date.getFullYear()}` });
      daysAdded++;
    }

    offset++;
  }

  return list;
}

function fmtMoney(value: number) {
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// Compact column header for an expiration: "Mon 06-23".
function fmtExpHeader(iso: string): string {
  const dt = new Date(iso + "T12:00:00");
  if (Number.isNaN(dt.getTime())) return iso;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${days[dt.getDay()]} ${mm}-${dd}`;
}

// True when `iso` (YYYY-MM-DD) falls in the CURRENT trading week (Mon–Fri of the
// week that contains the upcoming/!this Friday), in ET. The stored weekly EM only
// applies to current-week expirations, so EM bands render only for those.
function isCurrentWeekExp(iso: string): boolean {
  if (!iso) return false;
  const now = etToday();
  const dow = now.getDay(); // 0=Sun..6=Sat
  // Monday of this week (treat Sun as belonging to the week just ended → next Mon).
  const monday = new Date(now);
  const toMon = dow === 0 ? 1 : 1 - dow; // Sun→+1 (next Mon), else back to Mon
  monday.setDate(now.getDate() + toMon);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  const d = new Date(iso + "T12:00:00");
  return d >= monday && d <= friday;
}

// Snap a target price to the nearest value present in `strikes`.
function nearestStrikeTo(target: number, strikes: number[]): number | null {
  if (!Number.isFinite(target) || !strikes.length) return null;
  let best = strikes[0];
  let bestD = Math.abs(strikes[0] - target);
  for (const s of strikes) {
    const dd = Math.abs(s - target);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best;
}

function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]) {
  const n = value || 0;
  const m = maxValue || 0;
  if (m === 0 || !n) return "transparent";
  const pos = n >= 0;
  const rank = topValues.indexOf(Math.abs(n)) + 1;
  if (rank === 1) return pos ? "rgba(41,182,246,0.90)" : "rgba(255,71,87,0.90)";
  if (rank === 2) return pos ? "rgba(41,182,246,0.45)" : "rgba(255,71,87,0.45)";
  if (rank === 3) return pos ? "rgba(41,182,246,0.25)" : "rgba(255,71,87,0.25)";
  const ratio = Math.min(Math.abs(n) / m, 1);
  const eased = Math.pow(ratio * (intensity || 0.1), 1.4);
  const alpha = Math.min(0.18, 0.02 + eased * 0.16);
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`;
}

// Parse one expiration's chain payload into strike→greek cells.
// GEX/DEX/CHEX/VEX use the same formulas the single-expiry view used:
//   contracts = OI + volume (per side); GEX = (γc·cc − γp·pc)·S²·0.01·100, etc.
function parseExpiration(items: unknown[], expDate: string, spot: number): Map<number, GreekCell> {
  const cells = new Map<number, GreekCell>();
  const target = (items as { "expiration-date"?: string; strikes?: unknown[] }[]).filter(
    i => String(i["expiration-date"] ?? "").slice(0, 10) === expDate.slice(0, 10),
  );
  const groups = target.length ? target : (items as { strikes?: unknown[] }[]);
  const S = spot > 0 ? spot : 0;

  groups.forEach(group => {
    (group.strikes || []).forEach((item: unknown) => {
      const it = item as Record<string, unknown>;
      const strike = parseFloat(String(it["strike-price"] || 0));
      if (!strike) return;

      const c = it.call as Record<string, unknown> | undefined;
      const p = it.put as Record<string, unknown> | undefined;
      const num = (o: Record<string, unknown> | undefined, k: string) =>
        o ? parseFloat(String(o[k])) || 0 : 0;
      const cnt = (o: Record<string, unknown> | undefined) =>
        o ? (parseInt(String(o["open-interest"] ?? o.openInterest ?? 0), 10) || 0) +
            (parseInt(String(o.volume ?? 0), 10) || 0)
          : 0;

      const cc = cnt(c);
      const pc = cnt(p);
      const live = cc > 0 || pc > 0;

      cells.set(strike, {
        gex:  live ? (num(c, "gamma") * cc - num(p, "gamma") * pc) * S * S * 0.01 * 100 : 0,
        dex:  live ? (Math.abs(num(c, "delta")) * cc - Math.abs(num(p, "delta")) * pc) * S * 100 : 0,
        chex: live ? (-num(c, "theta") * cc + num(p, "theta") * pc) * S * 100 : 0,
        vex:  live ? (num(c, "vega") * cc - num(p, "vega") * pc) * S * 100 : 0,
      });
    });
  });

  return cells;
}

export default function OptionsChainPage() {
  // Fallback calendar list (used only until/if the per-ticker expirations
  // fetch resolves). Real listings come from /api/expirations so we never
  // offer a date the ticker doesn't actually trade (e.g. NVDA has no Monday
  // weeklies — picking one returned an empty chain).
  const fallbackExpiries = useMemo(() => buildExpiries(), []);
  const [expiries, setExpiries] = useState<Array<{ value: string; label: string }>>(fallbackExpiries);
  const [tickerInput, setTickerInput] = useState("SPX");
  const [activeTicker, setActiveTicker] = useState("SPX");
  const [selectedExpiry, setSelectedExpiry] = useState(fallbackExpiries[0]?.value ?? "");
  const [displayPercent, setDisplayPercent] = useState<number>(10);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [intensity, setIntensity] = useState(1.75);
  const [lastUpdate, setLastUpdate] = useState("--:--:--");
  const [loadProgress, setLoadProgress] = useState(0); // 0-100
  const [greekMode, setGreekMode] = useState<GreekMode>("gex");
  const pageRef = useRef<HTMLDivElement>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  // Weekly EM (from /api/levels, DB-backed). close ± em = 1× band, ± 2·em = 2×.
  const [emLevels, setEmLevels] = useState<{ close: number; em: number } | null>(null);

  // The 7-expiration matrix. Each entry holds one expiration's strike→greek map.
  const expColumnsRef = useRef<ExpColumn[]>([]);
  const loadTokenRef = useRef(0);
  // Re-entrancy + rate guards for loadChain. A render loop or overlapping
  // triggers were firing the full 7-expiration fetch (×noCache) back-to-back,
  // hammering TT upstream. Block while a load is in flight, and enforce a min
  // gap between loads unless the caller is an explicit user refresh (force).
  const loadInFlightRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const LOAD_MIN_INTERVAL_MS = 5000;
  // Set by GO when the ticker changes; consumed by the expirations effect to
  // load the chain only after a valid expiry for the new ticker is resolved.
  const pendingGoRef = useRef(false);
  // Live mirror of selectedExpiry so the expirations effect (which only re-runs
  // on ticker change) always validates against the user's current choice.
  const selectedExpiryRef = useRef("");
  // Live mirror of the full expiries list so loadChain (recreated each render)
  // always slices the 7 starting at the user's selected expiry.
  const expiriesRef = useRef<Array<{ value: string; label: string }>>([]);

  // Load the 7 closest expirations starting at `startExp`, building a strike→
  // greek map per expiration. Each expiration is one /api/chains call.
  const loadChain = async (ticker: string, startExp: string, bustCache = false, force = false) => {
    // Drop overlapping calls, and rate-limit non-forced (auto/poll) loads. User
    // refresh/GO pass force=true to bypass the min-interval but still serialize.
    if (loadInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastLoadAtRef.current < LOAD_MIN_INTERVAL_MS) return;
    loadInFlightRef.current = true;
    lastLoadAtRef.current = now;
    loadTokenRef.current += 1;
    const token = loadTokenRef.current;
    const bust = bustCache ? `&noCache=1` : "";

    // 7 expirations: the selected one + the next 6 from the listed expiries.
    const all = expiriesRef.current.length ? expiriesRef.current : expiries;
    const startIdx = Math.max(0, all.findIndex(e => e.value === startExp));
    const targets = all.slice(startIdx, startIdx + EXP_COLUMNS);
    if (!targets.length) targets.push({ value: startExp, label: startExp });

    try {
      setChainError(null);
      setLoadProgress(8);

      const results = await Promise.all(
        targets.map(async (t, i) => {
          const res = await fetch(
            `/api/chains?ticker=${encodeURIComponent(ticker)}&expiration=${encodeURIComponent(t.value)}&range=all${bust}`,
          );
          const json = await res.json().catch(() => null);
          if (token === loadTokenRef.current) {
            setLoadProgress(8 + Math.round(((i + 1) / targets.length) * 84));
          }
          const data = (json?.data as Record<string, unknown> | undefined) ?? undefined;
          const items = (data?.items as unknown[]) ?? [];
          const underlying = parseFloat(String(data?.underlyingPrice ?? 0)) || 0;
          return {
            expiration: t.value,
            label: t.label,
            underlying,
            cells: parseExpiration(items, t.value, underlying),
          } as ExpColumn;
        }),
      );

      if (token !== loadTokenRef.current) return;

      const cols = results.filter(c => c.cells.size > 0);
      if (!cols.length) {
        expColumnsRef.current = [];
        setUnderlyingPrice(0);
        setChainError(`No live chain payload returned for ${ticker}.`);
        setLoadProgress(0);
        setRefreshSeed(s => s + 0.01);
        return;
      }

      expColumnsRef.current = results; // keep all 7 slots (empty ones render blank)
      const spot = cols.find(c => c.underlying > 0)?.underlying ?? 0;
      setUnderlyingPrice(spot);
      setLoadProgress(100);
      setTimeout(() => setLoadProgress(0), 800);
      setRefreshSeed(s => s + 0.01);
    } catch (err) {
      console.error(`[OptionsChain] Load failed for ${ticker}:`, err);
      expColumnsRef.current = [];
      setUnderlyingPrice(0);
      setChainError(`Live chain load failed for ${ticker}.`);
      setLoadProgress(0);
    } finally {
      loadInFlightRef.current = false;
    }
  };

  useEffect(() => {
    setLastUpdate(
      new Date().toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    );
  }, [activeTicker, selectedExpiry, displayPercent, refreshSeed]);

  const doRefresh = async () => {
    await loadChain(activeTicker, selectedExpiry, true, true); // force: user refresh
    setRefreshSeed((value) => value + 1);
  };

  const { trigger, label: refreshLabel, style: refreshStyle } = useRefreshButton(doRefresh);

  // Manual load via GO button (no auto-load)
  const doGo = useCallback(() => {
    if (!tickerInput || !selectedExpiry) return;
    const ticker = (tickerInput || "SPX").toUpperCase();
    const tickerChanged = ticker !== activeTicker;
    setActiveTicker(ticker);
    // If the ticker changed, the expirations effect will refetch this ticker's
    // real listings and snap selectedExpiry to a valid date; the pendingGo flag
    // makes that effect fire the chain load once the expiry is confirmed valid.
    // This avoids loading against a date the new ticker may not list (e.g. a
    // Monday weekly that exists for SPX but not NVDA).
    if (tickerChanged) {
      pendingGoRef.current = true;
    } else {
      loadChain(ticker, selectedExpiry, true, true); // force: user GO
    }
  }, [tickerInput, selectedExpiry, activeTicker, loadChain]);

  useEffect(() => { selectedExpiryRef.current = selectedExpiry; }, [selectedExpiry]);
  useEffect(() => { expiriesRef.current = expiries; }, [expiries]);

  // Auto-load SPX on mount
  useEffect(() => {
    const defaultExpiry = selectedExpiry || expiries[0]?.value;
    if (defaultExpiry) {
      loadChain("SPX", defaultExpiry);
    }
  }, []);

  // Poll the active matrix every 60s during the live session so the 7-expiration
  // GEX values track intraday OI/volume + greek drift instead of staying frozen.
  useEffect(() => {
    const id = setInterval(() => {
      const exp = selectedExpiryRef.current;
      // Poll WITHOUT noCache so the server chain cache can absorb repeats across
      // clients; the cache TTL still refreshes intraday OI/greek drift. Bypassing
      // the cache every 60s per open tab was hammering TT upstream.
      if (exp && activeTicker && isSessionLive()) loadChain(activeTicker, exp, false);
    }, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  // Fetch the ticker's REAL listed expirations whenever the active ticker
  // changes. Replaces the fabricated calendar list so the dropdown only ever
  // offers dates the symbol actually trades.
  useEffect(() => {
    let cancelled = false;
    const ticker = (activeTicker || "SPX").toUpperCase();

    (async () => {
      try {
        const json = await fetch(`/api/expirations?ticker=${encodeURIComponent(ticker)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const items: Array<Record<string, unknown>> = json?.data?.items ?? [];
        if (cancelled || !items.length) return;

        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const seen = new Set<string>();
        const list = items
          .map((it) => String(it["expiration-date"] ?? ""))
          .filter((d) => d && !seen.has(d) && (seen.add(d), true))
          .sort()
          .map((value) => {
            const dt = new Date(value + "T12:00:00");
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            return { value, label: `${dayNames[dt.getDay()]}, ${mm}-${dd}-${dt.getFullYear()}` };
          });
        if (!list.length) return;

        setExpiries(list);
        // If the current selection isn't a real listing for this ticker, snap
        // to the nearest valid one (prefer today's 0DTE when present).
        const today = etDateKey(etToday());
        const cur = selectedExpiryRef.current;
        const validExpiry = list.some((e) => e.value === cur)
          ? cur
          : (list.find((e) => e.value === today)?.value ?? list[0].value);
        setSelectedExpiry(validExpiry);

        // A ticker-change GO is waiting on a valid expiry — load the chain now.
        if (pendingGoRef.current) {
          pendingGoRef.current = false;
          loadChain(ticker, validExpiry, true, true); // force: user GO after expiry snap
        }
      } catch {
        /* keep fallback calendar list */
      }
    })();

    return () => { cancelled = true; };
    // Only re-run on ticker change. loadChain is recreated every render, so
    // listing it here caused an infinite fetch loop (effect → setState →
    // render → new loadChain → effect …). selectedExpiry is read via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicker]);

  const [underlyingPrice, setUnderlyingPrice] = useState(0);

  // The 7 expiration columns (some may be empty placeholders) + the spot used
  // to center the strike window. Rebuilt whenever a load completes.
  const { columns, spot } = useMemo(() => {
    const cols = expColumnsRef.current;
    if (!cols.length) return { columns: [] as ExpColumn[], spot: 0 };
    const atmStrike =
      underlyingPrice > 0
        ? underlyingPrice
        : cols.find(c => c.underlying > 0)?.underlying ?? 0;
    return { columns: cols, spot: atmStrike };
  }, [activeTicker, expiries, refreshSeed, selectedExpiry, underlyingPrice]);

  // Union of every strike listed across all 7 expirations, sorted ascending.
  const allStrikes = useMemo(() => {
    const set = new Set<number>();
    columns.forEach(c => c.cells.forEach((_v, k) => set.add(k)));
    return [...set].sort((a, b) => a - b);
  }, [columns]);

  const nearestStrike = useMemo(() => {
    if (!allStrikes.length) return 0;
    const ref = spot > 0 ? spot : allStrikes[Math.floor(allStrikes.length / 2)];
    return allStrikes.reduce(
      (best, s) => (Math.abs(s - ref) < Math.abs(best - ref) ? s : best),
      allStrikes[0],
    );
  }, [allStrikes, spot]);

  const totalRows = allStrikes.length;
  const autoDisplayPercent = useMemo(() => {
    const requestedCount = Math.max(1, Math.round(totalRows * (displayPercent / 100)));
    if (displayPercent === 10 && requestedCount < 10) return 20;
    return displayPercent;
  }, [displayPercent, totalRows]);

  // The strike window shown (centered on spot), high → low.
  const visibleStrikes = useMemo(() => {
    if (!allStrikes.length) return [] as number[];
    if (autoDisplayPercent >= 100) return [...allStrikes].sort((a, b) => b - a);

    const targetCount = Math.min(
      allStrikes.length,
      Math.max(10, Math.round(allStrikes.length * (autoDisplayPercent / 100))),
    );
    const atmIndex = allStrikes.findIndex(s => s === nearestStrike);
    const half = Math.floor(targetCount / 2);
    let start = Math.max(0, atmIndex - half);
    let end = Math.min(allStrikes.length, start + targetCount);
    if (end - start < targetCount) start = Math.max(0, end - targetCount);

    return allStrikes.slice(start, end).sort((a, b) => b - a);
  }, [allStrikes, autoDisplayPercent, nearestStrike]);

  // Active-greek value lookup: column index → strike → number.
  const valueAt = useCallback(
    (col: ExpColumn, strike: number): number | null => {
      const cell = col.cells.get(strike);
      if (!cell) return null;
      return cell[greekMode];
    },
    [greekMode],
  );

  // Per-column max + top-3 (by |active greek|) over the VISIBLE strikes, so each
  // expiration colors against its own scale (per-column intensity).
  const colScales = useMemo(() => {
    return columns.map(col => {
      const vals: number[] = [];
      visibleStrikes.forEach(s => {
        const v = valueAt(col, s);
        if (v != null && v !== 0) vals.push(Math.abs(v));
      });
      const sorted = [...vals].sort((a, b) => b - a);
      return { max: sorted[0] ?? 1, top3: sorted.slice(0, 3) };
    });
  }, [columns, visibleStrikes, valueAt]);

  // MVC per column = the visible strike with the highest ABSOLUTE net GEX.
  // Always keyed on GEX (the MVC definition), independent of the active greek.
  const mvcByCol = useMemo(() => {
    return columns.map(col => {
      let best: number | null = null;
      let bestAbs = 0;
      visibleStrikes.forEach(s => {
        const g = col.cells.get(s)?.gex;
        if (g == null) return;
        const a = Math.abs(g);
        if (a > bestAbs) { bestAbs = a; best = s; }
      });
      return best;
    });
  }, [columns, visibleStrikes]);

  // Weekly EM for the active ticker (DB-backed via /api/levels). Refetched on
  // ticker change and on each manual refresh so the bands track intraday EM.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await fetch(`/api/levels?ticker=${encodeURIComponent(activeTicker)}`)
        .then(r => r.json()).catch(() => null);
      if (cancelled) return;
      const em = parseFloat(String(row?.em ?? ""));
      const close = parseFloat(String(row?.close ?? ""));
      setEmLevels(Number.isFinite(em) && em > 0 && Number.isFinite(close) && close > 0
        ? { close, em } : null);
    })();
    return () => { cancelled = true; };
  }, [activeTicker, refreshSeed]);

  // The 4 EM band strikes (snapped to visible strikes): 1× down/up, 2× down/up.
  // Null when no EM is available.
  const emStrikes = useMemo(() => {
    if (!emLevels) return null;
    const { close, em } = emLevels;
    return {
      d1: nearestStrikeTo(close - em, visibleStrikes),
      u1: nearestStrikeTo(close + em, visibleStrikes),
      d2: nearestStrikeTo(close - 2 * em, visibleStrikes),
      u2: nearestStrikeTo(close + 2 * em, visibleStrikes),
    };
  }, [emLevels, visibleStrikes]);

  // Always render EXP_COLUMNS slots so the grid keeps a stable width even before
  // all 7 expirations resolve (or when a ticker lists fewer than 7).
  const gridCols = Math.max(columns.length, EXP_COLUMNS);

  // EM bands only apply to current-week expirations. Mark which visible columns
  // qualify so the band draws across only those columns.
  const colIsCurrentWeek = useMemo(
    () => Array.from({ length: gridCols }).map((_, i) => {
      const c = columns[i];
      return c ? isCurrentWeekExp(c.expiration) : false;
    }),
    [columns, gridCols],
  );
  const anyCurrentWeek = colIsCurrentWeek.some(Boolean);

  const autoPercentNote = autoDisplayPercent !== displayPercent ? `Auto ${autoDisplayPercent}%` : null;

  return (
    <div
      ref={pageRef}
      style={{
        ...homeShellStyle,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes mvcGlow{0%,100%{box-shadow:0 0 3px rgba(255,255,255,.35)}50%{box-shadow:0 0 10px rgba(255,255,255,.85)}}.mvc-peak-cell{animation:mvcGlow 2.4s ease-in-out infinite}`}</style>
      {loadProgress > 0 && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "#05080d", zIndex: 10 }}>
          <div style={{ height: "100%", width: `${loadProgress}%`, background: "#00e5ff", transition: "width 0.3s ease" }} />
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          background: HT.panelBgStrong,
          backdropFilter: "blur(16px)",
          borderBottom: `1px solid ${HT.border}`,
          flexShrink: 0,
          flexWrap: "wrap",
          position: "relative", // ADD: own stacking context so dropdowns paint above chain
          zIndex: 50,           // ADD: above chain scroll area + highlighted rows (zIndex:1)
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 800, color: "#00e5ff", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Options Chain
        </span>

        <input
          list="options-chain-tickers"
          value={tickerInput}
          onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
          onBlur={() => setActiveTicker((tickerInput || "SPX").toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Enter") setActiveTicker((tickerInput || "SPX").toUpperCase());
          }}
          autoComplete="off"
          spellCheck={false}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 8px",
            border: `1px solid rgba(0,229,255,.4)`,
            borderRadius: 4,
            background: "rgba(0,0,0,0.4)",
            color: HT.cyan,
            outline: "none",
            width: 88,
            textTransform: "uppercase",
          }}
        />
        <datalist id="options-chain-tickers">
          {QUOTE_PANEL_TICKERS.map((ticker) => <option key={ticker} value={ticker} />)}
        </datalist>

        <CustomDropdown
          value={selectedExpiry}
          options={expiries.map(e => e.value) as string[]}
          onChange={setSelectedExpiry}
          formatLabel={v => expiries.find(e => e.value === v)?.label ?? v}
          accentCyan={false}
        />

        <CustomDropdown
          value={displayPercent}
          options={DISPLAY_PERCENTS}
          onChange={setDisplayPercent}
          formatLabel={v => `${v}% of strikes`}
        />

        <button
          onClick={doGo}
          disabled={!tickerInput || !selectedExpiry}
          style={{
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 12px",
            border: "1px solid rgba(0,229,255,.5)",
            borderRadius: 4,
            background: tickerInput && selectedExpiry ? "rgba(0,229,255,.12)" : "rgba(0,229,255,.04)",
            color: tickerInput && selectedExpiry ? "#00e5ff" : "#4a6a88",
            cursor: tickerInput && selectedExpiry ? "pointer" : "not-allowed",
            outline: "none",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          GO
        </button>

        {autoPercentNote ? (
          <span style={{ fontSize: 9, fontWeight: 800, color: "#ffb300", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {autoPercentNote}
          </span>
        ) : null}

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700 }}>Intensity</span>
        <input
          type="range" min={0.5} max={3} step={0.01}
          value={intensity}
          onChange={(event) => setIntensity(Number(event.target.value))}
          style={{ width: 80, height: 3, accentColor: "#00e5ff" }}
        />
        <span style={{ fontSize: 10, color: "#00e5ff", fontWeight: 700, minWidth: 36, fontFamily: "monospace" }}>
          {intensity.toFixed(2)}x
        </span>

        <span style={{ color: "#1e3050" }}>|</span>

        <div style={{ display: "flex", gap: 2, background: HT.panelBg, backdropFilter: "blur(8px)", borderRadius: 4, padding: 2 }}>
          {GREEK_MODES.map(m => (
            <button
              key={m}
              onClick={() => setGreekMode(m)}
              style={{
                padding: "2px 8px",
                fontSize: 9,
                fontWeight: 800,
                borderRadius: 3,
                border: "none",
                cursor: "pointer",
                textTransform: "uppercase",
                background: greekMode === m ? "rgba(0,229,255,.15)" : "transparent",
                color: greekMode === m ? HT.cyan : "#64748b",
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
          <span style={{ fontSize: 11, color: "#e4e4e7", fontWeight: 700 }}>
            {activeTicker} <span style={{ color: "#00e5ff", fontFamily: "monospace" }}>{spot > 0 ? spot.toFixed(2) : "—"}</span>
          </span>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#00e676" }} />
          <span style={{ fontSize: 9, color: "#00e676", fontWeight: 800, letterSpacing: "0.08em" }}>LIVE</span>
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>{lastUpdate}</span>
        </div>

        <button onClick={trigger} style={{ ...homeButtonStyle }}>{refreshLabel}</button>
        <BoxSnapBtn targetRef={pageRef} />
        <BoxDiscordBtn
          targetRef={pageRef}
          message={`📊 Options Chain — ${activeTicker} ${selectedExpiry}`}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `100px repeat(${gridCols}, minmax(78px, 1fr))`,
          background: HT.panelBgStrong,
          borderBottom: `1px solid ${HT.border}`,
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        <div style={{ padding: "5px 8px", textAlign: "left", color: HT.muted }}>Strike</div>
        {Array.from({ length: gridCols }).map((_, i) => {
          const col = columns[i];
          return (
            <div
              key={col?.expiration ?? `col-${i}`}
              style={{
                padding: "5px 8px",
                textAlign: "right",
                color: HT.cyan,
                borderLeft: "1px solid rgba(255,255,255,.05)",
                lineHeight: 1.25,
              }}
            >
              <div style={{ fontSize: 12 }}>{greekMode.toUpperCase()}</div>
              <div style={{ fontSize: 10, color: HT.muted, fontWeight: 700, letterSpacing: 0 }}>
                {col ? fmtExpHeader(col.expiration) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {!visibleStrikes.length ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, color: "#4a6a88" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {chainError ? "No Live Chain Data" : "Select ticker, expiry & % strikes"}
              </div>
              <div style={{ fontSize: 11 }}>
                {chainError ?? "Then click GO to load chain"}
              </div>
            </div>
          </div>
        ) : visibleStrikes.map((strike) => {
          const isATM = strike === nearestStrike;
          // EM band membership (only meaningful when a current-week column shows).
          const is1x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d1 || strike === emStrikes.u1);
          const is2x = anyCurrentWeek && emStrikes != null && (strike === emStrikes.d2 || strike === emStrikes.u2);
          const emBorder = is1x
            ? { borderTop: "2px solid rgba(255,255,255,.92)" }
            : is2x
            ? { borderTop: "2px dashed rgba(255,255,255,.85)" }
            : null;
          const rowStyle = isATM
            ? { background: "rgba(255,179,0,.07)", outline: "1px solid rgba(255,255,255,.55)", outlineOffset: "-1px", position: "relative" as const, zIndex: 1 }
            : { borderBottom: "1px solid rgba(30,48,80,.35)" };

          return (
            <div
              key={strike}
              style={{
                display: "grid",
                gridTemplateColumns: `100px repeat(${gridCols}, minmax(78px, 1fr))`,
                position: "relative",
                ...rowStyle,
                ...(emBorder ?? {}),
              }}
            >
              {(is1x || is2x) && (
                <span style={{
                  position: "absolute", top: -8, left: 4, zIndex: 3,
                  fontSize: 8, fontWeight: 800, letterSpacing: "0.05em",
                  color: "#0b0f1a", background: "rgba(255,255,255,.92)",
                  padding: "0 4px", borderRadius: 3, pointerEvents: "none",
                  fontFamily: "sans-serif",
                }}>{is1x ? "EM" : "2× EM"}</span>
              )}
              <div
                style={{
                  padding: "4px 6px",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  textAlign: "left",
                  color: isATM ? "#ffb300" : "#e4e4e7",
                  background: isATM ? "rgba(255,179,0,.12)" : "transparent",
                  borderRight: "1px solid rgba(255,255,255,.06)",
                }}
              >
                {Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2)}
              </div>

              {Array.from({ length: gridCols }).map((_, i) => {
                const col = columns[i];
                const value = col ? valueAt(col, strike) : null;
                const scale = colScales[i] ?? { max: 1, top3: [] as number[] };
                const isMvc = greekMode === "gex" && col != null && mvcByCol[i] === strike;
                return (
                  <div
                    key={col?.expiration ?? `c-${i}`}
                    className={isMvc ? "mvc-peak-cell" : undefined}
                    style={{
                      position: "relative",
                      padding: "4px 6px",
                      fontSize: 11,
                      fontFamily: "monospace",
                      textAlign: "right",
                      color: value == null ? "#3a4a5e" : "#ffffff",
                      background: value != null ? metricBg(value, scale.max, intensity, scale.top3) : "transparent",
                      borderLeft: "1px solid rgba(255,255,255,.04)",
                      fontWeight: 700,
                      ...(isMvc ? { outline: "3px solid #ffffff", outlineOffset: "-3px", zIndex: 2 } : {}),
                    }}
                  >
                    {isMvc && (
                      <span title="MVC — highest |net GEX|" style={{
                        position: "absolute", top: 1, left: 3, fontSize: 12, lineHeight: 1,
                        color: "#ffd600", textShadow: "0 0 3px rgba(0,0,0,.9)", pointerEvents: "none",
                      }}>★</span>
                    )}
                    {value == null ? "·" : fmtMoney(value)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
