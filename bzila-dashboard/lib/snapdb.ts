// ─── IndexedDB snap helpers ───────────────────────────────────────────────────
// Mirrors the saveMVCSnapshot logic from pages/database/database.js
// Call from client components only (browser IndexedDB).

const DB_NAME    = "OptionsMarketDB";
const DB_VERSION = 9;

// Open DB read-write — if not yet created, onupgradeneeded bootstraps the stores.
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror   = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);

    // Bootstrap stores if opening for the first time or upgrading.
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result;

      const ensure = (
        name: string,
        keyPath: string,
        indexes: Array<{ name: string; key: string | string[]; unique?: boolean }> = [],
      ) => {
        if (db.objectStoreNames.contains(name)) return;
        const store = db.createObjectStore(name, { keyPath, autoIncrement: true });
        indexes.forEach(({ name: iName, key, unique = false }) =>
          store.createIndex(iName, key, { unique })
        );
      };

      ensure("mvc", "id", [
        { name: "timestamp",   key: "timestamp" },
        { name: "date",        key: "date" },
        { name: "triggerType", key: "triggerType" },
      ]);
      ensure("premiumFlow",        "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }]);
      ensure("greeksTimeSeries",   "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }]);
      ensure("buySellScores",      "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }, { name: "slotKey", key: "slotKey", unique: true }]);
      ensure("es15mCandles",       "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }, { name: "slotKey", key: "slotKey", unique: true }]);
      ensure("greeksHistory",      "id", [{ name: "timestamp", key: "timestamp" }]);
      ensure("gexTop3",            "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }]);
      ensure("bzilaLiveSnapshots", "id", [{ name: "timestamp", key: "timestamp" }, { name: "date", key: "date" }]);
      ensure("expirations",        "id", [{ name: "timestamp", key: "timestamp" }]);
    };
  });
}

export interface MVCPayload {
  mvcOIVol:     { strike: number | null; value: number; volume: number };
  mvcVolOnly:   { strike: number | null; value: number; volume: number };
  spxPrice:     number;
  esPrice:      number;
  expiration:   string;
  triggerType:  string;
  totalNetGEX:  number;
  totalNetGEX_Vol: number;
  totalNetDEX_OI: number;
  totalNetDEX_Vol: number;
  netDexStrike: number | null;
  gexFlip:      number | null;
}

export interface BzilaLiveSnapshotOrder {
  ts: number;
  symbol: string;
  strike: number;
  type: string;
  side: string;
  action: string;
  bucket: string;
  price: number;
  size: number;
  premium: number;
}

export interface BzilaLiveSnapshotStats {
  callVol: number;
  putVol: number;
  buyVol: number;
  sellVol: number;
  bullVol: number;
  bearVol: number;
  totalVol: number;
  bullPct: number;
  bearPct: number;
  pcr: number;
  bbr: number;
  latestTs: number;
  latestAction: string;
  netPremium: number;
  callPremium?: number;
  putPremium?: number;
  spxPrice: number;
}

export interface BzilaLiveSnapshotPayload {
  orders: BzilaLiveSnapshotOrder[];
  stats: BzilaLiveSnapshotStats;
}

export async function saveMVCSnapshot(p: MVCPayload): Promise<number> {
  const db  = await openDB();
  const now = new Date();
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const totalNetGEX    = p.totalNetGEX    ?? 0;
  const totalNetGEX_Vol = p.totalNetGEX_Vol ?? 0;

  const pctOI_Vol  = totalNetGEX    !== 0 ? parseFloat((Math.abs(p.mvcOIVol.value  ?? 0) / Math.abs(totalNetGEX)     * 100).toFixed(2)) : null;
  const pctVol_Only = totalNetGEX_Vol !== 0 ? parseFloat((Math.abs(p.mvcVolOnly.value ?? 0) / Math.abs(totalNetGEX_Vol) * 100).toFixed(2)) : null;

  const gexFlipRaw = Number(p.gexFlip);
  const gexFlipStrike =
    Number.isFinite(gexFlipRaw) && gexFlipRaw > 500
      ? gexFlipRaw
      : (p.mvcOIVol.strike ?? p.mvcVolOnly.strike ?? null);

  const record: Record<string, unknown> = {
    timestamp:       now.getTime(),
    date:            now.toISOString().split("T")[0],
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
    gexFlip:         gexFlipStrike,
    triggerType:     p.triggerType || "manual",
    expiration:      p.expiration  || "—",
  };

  return new Promise((resolve, reject) => {
    const tx    = db.transaction("mvc", "readwrite");
    const store = tx.objectStore("mvc");
    const req   = store.add(record);
    req.onerror   = () => { db.close(); reject(req.error); };
    req.onsuccess = () => { db.close(); resolve(req.result as number); };
  });
}

export async function saveBzilaLiveSnapshot(snapshot: Partial<BzilaLiveSnapshotPayload> = {}): Promise<number> {
  const db = await openDB();
  const now = new Date();
  const record: Record<string, unknown> = {
    timestamp: now.getTime(),
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().split(" ")[0],
    ticker: "SPX",
    panel: "bzila-live-snapshot",
    orders: Array.isArray(snapshot.orders) ? snapshot.orders : [],
    stats: snapshot.stats && typeof snapshot.stats === "object" ? snapshot.stats : {},
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction("bzilaLiveSnapshots", "readwrite");
    const store = tx.objectStore("bzilaLiveSnapshots");
    const req = store.add(record);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => { db.close(); resolve(req.result as number); };
  });
}

/** Read today's most-recent bzila live snapshot (for seeding cumulative state on page load). */
export async function getLatestBzilaSnapshotToday(): Promise<{ stats: BzilaLiveSnapshotStats; orders: BzilaLiveSnapshotOrder[] } | null> {
  const today = new Date().toISOString().split("T")[0];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains("bzilaLiveSnapshots")) { db.close(); resolve(null); return; }
    const tx = db.transaction("bzilaLiveSnapshots", "readonly");
    const req = tx.objectStore("bzilaLiveSnapshots").index("date").getAll(today);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => {
      db.close();
      const all = (req.result as Array<Record<string, unknown>>) ?? [];
      if (!all.length) { resolve(null); return; }
      // Most recent
      const last = all.sort((a, b) => Number(a.timestamp) - Number(b.timestamp)).pop()!;
      resolve({
        stats: (last.stats as BzilaLiveSnapshotStats) ?? {},
        orders: (last.orders as BzilaLiveSnapshotOrder[]) ?? [],
      });
    };
  });
}

/** Save premium flow snapshot (call, put, net premium + timestamp). */
export async function savePremiumFlowSnapshot(callPremium: number, putPremium: number, netPremium: number, spxPrice = 0): Promise<void> {
  const db = await openDB();
  const now = new Date();
  const record: Record<string, unknown> = {
    timestamp: now.getTime(),
    date: now.toISOString().split("T")[0],
    time: now.toTimeString().split(" ")[0],
    callPremium,
    putPremium,
    netPremium,
    spxPrice,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("premiumFlow", "readwrite");
    const req = tx.objectStore("premiumFlow").add(record);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => { db.close(); resolve(); };
  });
}

// ─── Greeks time-series (IndexedDB) ──────────────────────────────────────────

export interface GreeksRecord {
  id?: number;
  timestamp: number;
  date: string;
  time: string;
  ticker: string;
  price: number;
  // raw dollar-scale values (same as proxy computeIntradaySnapshot output * 1e9 or 1e6)
  gexRaw: number;   // raw dollars
  dexRaw: number;
  chexRaw: number;
  vexRaw: number;
  // display-scale ($B for gex/dex, $M for chex/vex)
  gex: number;
  dex: number;
  chex: number;
  vex: number;
  buyScore: number;
  sellScore: number;
}

/** Save one greeks snapshot. proxy sends gex/dex in billions, chex/vex in millions. */
export async function saveGreeksSnapshot(
  gexB: number, dexB: number, chexM: number, vexM: number,
  buyScore = 0, sellScore = 0, price = 0
): Promise<void> {
  const now = new Date();
  const etDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now).filter(p => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  const date = `${etDate.year}-${etDate.month}-${etDate.day}`;

  const record: Omit<GreeksRecord, "id"> = {
    timestamp: now.getTime(),
    date,
    time: now.toTimeString().split(" ")[0],
    ticker: "SPXW",
    price,
    gexRaw: gexB * 1e9,
    dexRaw: dexB * 1e9,
    chexRaw: chexM * 1e6,
    vexRaw: vexM * 1e6,
    gex: gexB,
    dex: dexB,
    chex: chexM,
    vex: vexM,
    buyScore,
    sellScore,
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("greeksTimeSeries", "readwrite");
    const req = tx.objectStore("greeksTimeSeries").add(record);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => { db.close(); resolve(); };
  });
}

// ─── ES 15m candles (IndexedDB) ──────────────────────────────────────────────

export interface EsCandleRecord {
  id?: number;
  timestamp: number;
  date: string;
  slotKey: string;       // e.g. "2024-06-12T09:30"
  time?: string;
  symbol?: string;
  intervalMinutes?: number;
  source?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  avgVolume?: number;    // historical average for this slot (if stored)
}

export async function saveEsCandleSnapshot(candle: EsCandleRecord): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("es15mCandles", "readwrite");
    const store = tx.objectStore("es15mCandles");
    const index = store.index("slotKey");
    const keyReq = index.getKey(candle.slotKey);

    keyReq.onerror = () => { db.close(); reject(keyReq.error); };
    keyReq.onsuccess = () => {
      const existingKey = keyReq.result as IDBValidKey | undefined;
      const req = existingKey != null
        ? store.put({ ...candle, id: existingKey })
        : store.add(candle);
      req.onerror = () => { db.close(); reject(req.error); };
      req.onsuccess = () => { db.close(); resolve(); };
    };
  });
}

/** Read today's ES 15m candles sorted oldest → newest. */
export async function queryEsCandlesToday(): Promise<EsCandleRecord[]> {
  const etDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).filter(p => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  const today = `${etDate.year}-${etDate.month}-${etDate.day}`;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const storeName = db.objectStoreNames.contains("es15mCandles") ? "es15mCandles" : "esCandles";
    if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const idx = store.indexNames.contains("date") ? store.index("date").getAll(today) : store.getAll();
    idx.onerror = () => { db.close(); reject(idx.error); };
    idx.onsuccess = () => {
      db.close();
      const rows = (idx.result as EsCandleRecord[]) ?? [];
      resolve(rows.sort((a, b) => a.timestamp - b.timestamp));
    };
  });
}

/** Read today's greeks time series sorted oldest → newest. */
export async function queryGreeksToday(): Promise<GreeksRecord[]> {
  const etDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).filter(p => p.type !== "literal")
    .reduce((a, p) => ({ ...a, [p.type]: p.value }), {} as Record<string, string>);
  const today = `${etDate.year}-${etDate.month}-${etDate.day}`;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains("greeksTimeSeries")) { db.close(); resolve([]); return; }
    const tx = db.transaction("greeksTimeSeries", "readonly");
    const req = tx.objectStore("greeksTimeSeries").index("date").getAll(today);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => {
      db.close();
      const rows = (req.result as GreeksRecord[]) ?? [];
      resolve(rows.sort((a, b) => a.timestamp - b.timestamp));
    };
  });
}

/** Read ES candles from the past N trading days (for averaging slot volumes). */
export async function queryEsCandlesHistorical(daysBack = 20): Promise<EsCandleRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains("es15mCandles")) { db.close(); resolve([]); return; }
    const tx = db.transaction("es15mCandles", "readonly");
    const req = tx.objectStore("es15mCandles").getAll();
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => {
      db.close();
      const allRows = (req.result as EsCandleRecord[]) ?? [];
      // Filter to only rows from past N trading days (exclude weekends)
      const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
      const filtered = allRows.filter(r => {
        const ts = r.timestamp ?? 0;
        if (ts < cutoff) return false;
        const d = new Date(ts);
        const day = d.getDay();
        return day !== 0 && day !== 6; // exclude Saturday (6) and Sunday (0)
      });
      resolve(filtered.sort((a, b) => a.timestamp - b.timestamp));
    };
  });
}

/** Read the N most-recent MVC rows (newest first) */
export async function getRecentMVC(limit = 5): Promise<Record<string, unknown>[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains("mvc")) { db.close(); resolve([]); return; }
    const tx  = db.transaction("mvc", "readonly");
    const req = tx.objectStore("mvc").getAll();
    req.onerror   = () => { db.close(); reject(req.error); };
    req.onsuccess = () => {
      db.close();
      const all = (req.result as Record<string, unknown>[]) ?? [];
      resolve(all.slice(-limit).reverse());
    };
  });
}

// ─── Expirations cache (IndexedDB) ──────────────────────────────────────────

export interface ExpirationCacheEntry {
  id?: number;
  ticker: string;
  timestamp: number;
  expirations: string[];
  raw: Record<string, unknown>;
}

/** Save expirations to IndexedDB cache. */
export async function saveExpirationCache(ticker: string, expirations: string[], raw: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  const now = Date.now();
  const record: ExpirationCacheEntry = {
    ticker,
    timestamp: now,
    expirations,
    raw,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("expirations", "readwrite");
    const req = tx.objectStore("expirations").add(record);
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => { db.close(); resolve(); };
  });
}

/** Query cached expirations. Returns the most recent cache entry if it's fresh (< 1 hour). */
export async function queryExpirationCache(ticker: string): Promise<Record<string, unknown> | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains("expirations")) { db.close(); resolve(null); return; }
    const tx = db.transaction("expirations", "readonly");
    const req = tx.objectStore("expirations").getAll();
    req.onerror = () => { db.close(); reject(req.error); };
    req.onsuccess = () => {
      db.close();
      const all = (req.result as ExpirationCacheEntry[]) ?? [];
      if (!all.length) { resolve(null); return; }
      // Find most recent for this ticker
      const entries = all.filter(e => e.ticker === ticker).sort((a, b) => b.timestamp - a.timestamp);
      if (!entries.length) { resolve(null); return; }
      const latest = entries[0];
      // Check if fresh (< 1 hour)
      const now = Date.now();
      if (now - latest.timestamp < 3600_000) {
        resolve(latest.raw);
      } else {
        resolve(null);
      }
    };
  });
}
