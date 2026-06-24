// ─── Client-side snapshot helpers ────────────────────────────────────────────
// All data now stored in SQLite (server-side) via API routes.
// These functions mirror the old IndexedDB API so callers need minimal changes.

// ── Types (re-exported for callers) ──────────────────────────────────────────

export interface MVCPayload {
  mvcOIVol:        { strike: number | null; value: number; volume: number };
  mvcVolOnly:      { strike: number | null; value: number; volume: number };
  spxPrice:        number;
  esPrice:         number;
  expiration:      string;
  triggerType:     string;
  totalNetGEX:     number;
  totalNetGEX_Vol: number;
  totalNetDEX_OI:  number;
  totalNetDEX_Vol: number;
  netDexStrike:    number | null;
  gexFlip:         number | null;
}

export interface BzilaLiveSnapshotOrder {
  ts:      number;
  symbol:  string;
  strike:  number;
  type:    string;
  side:    string;
  action:  string;
  bucket:  string;
  price:   number;
  size:    number;
  premium: number;
}

export interface BzilaLiveSnapshotStats {
  callVol:      number;
  putVol:       number;
  buyVol:       number;
  sellVol:      number;
  bullVol:      number;
  bearVol:      number;
  totalVol:     number;
  bullPct:      number;
  bearPct:      number;
  pcr:          number;
  bbr:          number;
  latestTs:     number;
  latestAction: string;
  netPremium:   number;
  callPremium?: number;
  putPremium?:  number;
  spxPrice:     number;
}

export interface BzilaLiveSnapshotPayload {
  orders: BzilaLiveSnapshotOrder[];
  stats:  BzilaLiveSnapshotStats;
}

export interface GreeksRecord {
  id?:       number;
  timestamp: number;
  date:      string;
  time:      string;
  ticker:    string;
  price:     number;
  gexRaw:    number;
  dexRaw:    number;
  chexRaw:   number;
  vexRaw:    number;
  gex:       number;
  dex:       number;
  chex:      number;
  vex:       number;
  buyScore:  number;
  sellScore: number;
}

export interface PlaybookFeedRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  text: string;
  color?: string | null;
  source?: string | null;
  expiry?: string | null;
  regime_key?: string | null;
  spot?: number | null;
  gex?: number | null;
  dex?: number | null;
  chex?: number | null;
  vex?: number | null;
}

export interface EsCandleRecord {
  id?:             number;
  timestamp:       number;
  date:            string;
  slotKey:         string;
  time?:           string;
  symbol?:         string;
  intervalMinutes?: number;
  source?:         string;
  open:            number;
  high:            number;
  low:             number;
  close:           number;
  volume:          number;
  avgVolume?:      number;
}

export interface ExpirationCacheEntry {
  id?:         number;
  ticker:      string;
  timestamp:   number;
  expirations: string[];
  raw:         Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function etDateStr(d = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d).filter(p => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Returns the current trading session:
 *   "rth" — 09:30–17:00 ET
 *   "ext" — 17:00–09:30 ET (spans midnight)
 */
export function currentSession(d = new Date()): "rth" | "ext" {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const hour   = Number(parts.find(p => p.type === "hour")?.value   ?? 0);
  const minute = Number(parts.find(p => p.type === "minute")?.value ?? 0);
  const mins   = hour * 60 + minute;
  return (mins >= 570 && mins < 1020) ? "rth" : "ext";
}

// ── MVC Snapshots ─────────────────────────────────────────────────────────────

export async function saveMVCSnapshot(p: MVCPayload): Promise<number> {
  const now  = new Date();
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const totalNetGEX     = p.totalNetGEX     ?? 0;
  const totalNetGEX_Vol = p.totalNetGEX_Vol ?? 0;
  const pctOI_Vol  = totalNetGEX     !== 0 ? parseFloat((Math.abs(p.mvcOIVol.value  ?? 0) / Math.abs(totalNetGEX)     * 100).toFixed(2)) : null;
  const pctVol_Only= totalNetGEX_Vol !== 0 ? parseFloat((Math.abs(p.mvcVolOnly.value ?? 0) / Math.abs(totalNetGEX_Vol) * 100).toFixed(2)) : null;
  const gexFlipRaw = Number(p.gexFlip);
  const gexFlip    = Number.isFinite(gexFlipRaw) && gexFlipRaw > 500
    ? gexFlipRaw
    : (p.mvcOIVol.strike ?? p.mvcVolOnly.strike ?? null);

  const res = await fetch("/api/snapshots/mvc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp:       now.getTime(),
      date:            etDateStr(now),
      day:             days[now.getDay()],
      time:            now.toTimeString().split(" ")[0],
      strikeOIVol:     p.mvcOIVol.strike,
      mvcValueOIVol:   p.mvcOIVol.value,
      pctOI_Vol,
      volumeOIVol:     p.mvcOIVol.volume,
      totalNetGEX_OI:  Math.abs(totalNetGEX),
      strikeVolOnly:   p.mvcVolOnly.strike,
      mvcValueVolOnly: p.mvcVolOnly.value,
      pctVol_Only,
      volumeVolOnly:   p.mvcVolOnly.volume,
      totalNetGEX_Vol: totalNetGEX_Vol,
      spxPrice:        Number(p.spxPrice) || 0,
      esPrice:         Number(p.esPrice)  || 0,
      netDEXStrike:    p.netDexStrike,
      totalNetDEX_OI:  p.totalNetDEX_OI  ?? null,
      totalNetDEX_Vol: p.totalNetDEX_Vol ?? null,
      totalAbsNetGEX:  Math.abs(totalNetGEX),
      gexFlip,
      triggerType:     p.triggerType || "manual",
      expiration:      p.expiration  || "—",
    }),
  });
  const json = await res.json();
  return json.id ?? 0;
}

export async function getRecentMVC(limit = 5): Promise<Record<string, unknown>[]> {
  const today = etDateStr();
  const res   = await fetch(`/api/snapshots/mvc?date=${today}&limit=${limit}`);
  const json  = await res.json();
  return (json.rows ?? []) as Record<string, unknown>[];
}

// ── Bzila Live Snapshots ──────────────────────────────────────────────────────

export async function saveBzilaLiveSnapshot(snapshot: Partial<BzilaLiveSnapshotPayload> = {}): Promise<number> {
  const now = new Date();
  const res = await fetch("/api/snapshots/bzila", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: now.getTime(),
      date:      etDateStr(now),
      time:      now.toTimeString().split(" ")[0],
      ticker:    "SPX",
      session:   currentSession(now),
      orders:    Array.isArray(snapshot.orders) ? snapshot.orders : [],
      stats:     snapshot.stats ?? {},
    }),
  });
  const json = await res.json();
  return json.id ?? 0;
}

export async function getLatestBzilaSnapshotToday(): Promise<{ stats: BzilaLiveSnapshotStats; orders: BzilaLiveSnapshotOrder[]; session: string } | null> {
  const today   = etDateStr();
  const session = currentSession();
  let res  = await fetch(`/api/snapshots/bzila?latest=1&date=${today}&session=${session}`);
  let json = await res.json();
  if (!json.snap) {
    // fallback: try without session filter
    res  = await fetch(`/api/snapshots/bzila?latest=1&date=${today}`);
    json = await res.json();
  }
  if (!json.snap) return null;
  return {
    stats:   json.snap.stats   as BzilaLiveSnapshotStats,
    orders:  json.snap.orders  as BzilaLiveSnapshotOrder[],
    session: json.snap.session as string ?? session,
  };
}

// ── Premium Flow ──────────────────────────────────────────────────────────────

export async function savePremiumFlowSnapshot(
  callPremium: number,
  putPremium:  number,
  netPremium:  number,
  spxPrice = 0,
): Promise<void> {
  const now = new Date();
  await fetch("/api/snapshots/premium", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp:   now.getTime(),
      date:        etDateStr(now),
      time:        now.toTimeString().split(" ")[0],
      callPremium,
      putPremium,
      netPremium,
      spxPrice,
    }),
  });
}

export async function getPremiumFlowToday(): Promise<{ timestamp: number; callPremium: number; putPremium: number; netPremium: number; spxPrice: number }[]> {
  const today = etDateStr();
  const res   = await fetch(`/api/snapshots/premium?date=${today}&limit=2000`);
  const json  = await res.json();
  return json.rows ?? [];
}

// ── Greeks Time Series ────────────────────────────────────────────────────────

export async function saveGreeksSnapshot(
  gexB:      number,
  dexB:      number,
  chexM:     number,
  vexM:      number,
  buyScore  = 0,
  sellScore = 0,
  price     = 0,
): Promise<void> {
  const now = new Date();
  await fetch("/api/snapshots/greeks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: now.getTime(),
      date:      etDateStr(now),
      time:      now.toTimeString().split(" ")[0],
      ticker:    "SPXW",
      price,
      gex:       gexB,
      dex:       dexB,
      chex:      chexM,
      vex:       vexM,
      buyScore,
      sellScore,
    }),
  });
}

export async function queryGreeksToday(): Promise<GreeksRecord[]> {
  const today = etDateStr();
  const res   = await fetch(`/api/snapshots/greeks?date=${today}&limit=5000`);
  const json  = await res.json();
  return (json.rows ?? []) as GreeksRecord[];
}

export async function savePlaybookSignal(payload: {
  text: string;
  color?: string;
  source?: string;
  expiry?: string;
  regimeKey?: string;
  spot?: number | null;
  gex?: number | null;
  dex?: number | null;
  chex?: number | null;
  vex?: number | null;
}): Promise<number> {
  const now = new Date();
  const res = await fetch("/api/snapshots/playbook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timestamp: now.getTime(),
      date: etDateStr(now),
      time: now.toTimeString().split(" ")[0],
      source: payload.source ?? "insights-exposure",
      text: payload.text,
      color: payload.color ?? null,
      expiry: payload.expiry ?? null,
      regimeKey: payload.regimeKey ?? null,
      spot: payload.spot ?? null,
      gex: payload.gex ?? null,
      dex: payload.dex ?? null,
      chex: payload.chex ?? null,
      vex: payload.vex ?? null,
    }),
  });
  const json = await res.json();
  return json.id ?? 0;
}

export async function queryPlaybookFeedToday(limit = 200): Promise<PlaybookFeedRecord[]> {
  const today = etDateStr();
  const res = await fetch(`/api/snapshots/playbook?date=${today}&limit=${limit}`);
  const json = await res.json();
  return (json.rows ?? []) as PlaybookFeedRecord[];
}

// ── ES Candles ────────────────────────────────────────────────────────────────

export async function saveEsCandleSnapshot(candle: EsCandleRecord): Promise<void> {
  await fetch("/api/snapshots/candles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(candle),
  });
}

// Postgres BIGINT (timestamp) and REAL columns deserialize from JSON as STRINGS
// via the API route. Downstream math — isRthBar(new Date(ts)), hiLo high/low
// comparisons — needs real numbers, else new Date('1782187200000') is Invalid
// Date and every RTH filter silently drops the bar. Coerce at the boundary.
function normalizeCandle(r: EsCandleRecord): EsCandleRecord {
  return {
    ...r,
    timestamp: Number(r.timestamp),
    open:  Number(r.open),
    high:  Number(r.high),
    low:   Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  };
}

export async function queryEsCandlesToday(): Promise<EsCandleRecord[]> {
  const today = etDateStr();
  const res   = await fetch(`/api/snapshots/candles?date=${today}&limit=2000`);
  const json  = await res.json();
  return ((json.rows ?? []) as EsCandleRecord[]).map(normalizeCandle);
}

export async function queryEsCandlesHistorical(daysBack = 20): Promise<EsCandleRecord[]> {
  const res  = await fetch(`/api/snapshots/candles?daysBack=${daysBack}&limit=10000`);
  const json = await res.json();
  return ((json.rows ?? []) as EsCandleRecord[]).map(normalizeCandle);
}

// ── IB Levels (locked Initial Balance per day) ──────────────────────────────────

export interface IbLevelsRecord {
  date:       string;
  symbol?:    string;
  timestamp:  number;
  locked:     number;           // 1 once frozen at/after 10:30 ET
  high:       number;
  low:        number;
  mid:        number;
  range:      number;
  rangePct:   number;
  openPrice:  number;
  lowFirst:   number | null;
  barCount:   number;
}

/**
 * Persist the day's IB levels. Server upsert is a no-op once the row is locked,
 * so a later call can never overwrite a frozen IB. Returns the authoritative
 * stored row (so the caller can adopt the locked values).
 */
export async function saveIbLevels(rec: IbLevelsRecord): Promise<IbLevelsRecord | null> {
  try {
    const res = await fetch("/api/snapshots/ib", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec),
    });
    const json = await res.json();
    return (json.row ?? null) as IbLevelsRecord | null;
  } catch {
    return null;
  }
}

export async function queryIbLevels(date = etDateStr()): Promise<IbLevelsRecord | null> {
  try {
    const res  = await fetch(`/api/snapshots/ib?date=${date}`);
    const json = await res.json();
    return (json.row ?? null) as IbLevelsRecord | null;
  } catch {
    return null;
  }
}

// ── Expirations Cache ─────────────────────────────────────────────────────────

export async function saveExpirationCache(
  ticker:      string,
  expirations: string[],
  raw:         Record<string, unknown>,
): Promise<void> {
  await fetch("/api/cache/expirations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, expirations, raw }),
  });
}

export async function queryExpirationCache(ticker: string): Promise<Record<string, unknown> | null> {
  const res  = await fetch(`/api/cache/expirations?ticker=${encodeURIComponent(ticker)}`);
  const json = await res.json();
  return json.hit ? (json.data as Record<string, unknown>) : null;
}
