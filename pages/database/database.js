// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA
// Stores: MVC snapshots, Premium Flow (1-min), Greeks, Big Trades
// All WebSocket data flows through DXLink proxy at /proxy/api
// ============================================================================

if (typeof window.DB === 'undefined') {
window.DB = {
  name: 'OptionsMarketDB',
  version: 7,
  db: null,
  _autoSnapScheduled: false,

  // ========================================================================
  // INITIALIZATION
  // ========================================================================
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✓ Database initialized');
        setTimeout(() => this.normalizeMVCFlipStrikes().catch(err => console.warn('MVC flip normalization failed:', err)), 0);
        resolve(true);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Creating/upgrading database schema...');

        if (db.objectStoreNames.contains('cumulativeDelta')) {
          db.deleteObjectStore('cumulativeDelta');
        }

        // Store 1: MVC snapshots
        if (!db.objectStoreNames.contains('mvc')) {
          const mvcStore = db.createObjectStore('mvc', { keyPath: 'id', autoIncrement: true });
          mvcStore.createIndex('timestamp', 'timestamp', { unique: false });
          mvcStore.createIndex('date', 'date', { unique: false });
          mvcStore.createIndex('triggerType', 'triggerType', { unique: false });
        }

        // Store 2: Premium flow — 1-minute rolled-up buckets
        if (!db.objectStoreNames.contains('premiumFlow')) {
          const pfStore = db.createObjectStore('premiumFlow', { keyPath: 'id', autoIncrement: true });
          pfStore.createIndex('timestamp', 'timestamp', { unique: false });
          pfStore.createIndex('date', 'date', { unique: false });
          pfStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 4: Full chain snapshots
        if (!db.objectStoreNames.contains('chainSnapshots')) {
          const snapStore = db.createObjectStore('chainSnapshots', { keyPath: 'id', autoIncrement: true });
          snapStore.createIndex('timestamp', 'timestamp', { unique: false });
          snapStore.createIndex('date', 'date', { unique: false });
        }

        // Store 5: Greeks history
        if (!db.objectStoreNames.contains('greeksHistory')) {
          const greekStore = db.createObjectStore('greeksHistory', { keyPath: 'id', autoIncrement: true });
          greekStore.createIndex('timestamp', 'timestamp', { unique: false });
          greekStore.createIndex('strike_exp', ['strike', 'expiration'], { unique: false });
        }

        // Store 6: Multi-stock flow (0DTE-30DTE per stock)
        if (!db.objectStoreNames.contains('multiStockFlow')) {
          const multiStore = db.createObjectStore('multiStockFlow', { keyPath: 'id', autoIncrement: true });
          multiStore.createIndex('timestamp', 'timestamp', { unique: false });
          multiStore.createIndex('date', 'date', { unique: false });
          multiStore.createIndex('stock', 'stock', { unique: false });
          multiStore.createIndex('stock_dte', ['stock', 'dte'], { unique: false });
        }

        // Store 7: Greeks time-series (GEX/DEX/CHEX/VEX history)
        if (!db.objectStoreNames.contains('greeksTimeSeries')) {
          const greekTsStore = db.createObjectStore('greeksTimeSeries', { keyPath: 'id', autoIncrement: true });
          greekTsStore.createIndex('timestamp', 'timestamp', { unique: false });
          greekTsStore.createIndex('date', 'date', { unique: false });
          greekTsStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 8: Big block trades (ES/NQ futures)
        if (!db.objectStoreNames.contains('bigTrades')) {
          const btStore = db.createObjectStore('bigTrades', { keyPath: 'id', autoIncrement: true });
          btStore.createIndex('timestamp', 'timestamp', { unique: false });
          btStore.createIndex('date', 'date', { unique: false });
          btStore.createIndex('ticker', 'ticker', { unique: false });
        }

        if (!db.objectStoreNames.contains('es15mCandles')) {
          const candleStore = db.createObjectStore('es15mCandles', { keyPath: 'id', autoIncrement: true });
          candleStore.createIndex('timestamp', 'timestamp', { unique: false });
          candleStore.createIndex('date', 'date', { unique: false });
          candleStore.createIndex('slotKey', 'slotKey', { unique: true });
        }
      };
    });
  },

  async normalizeMVCFlipStrikes() {
    if (!this.db || !this.db.objectStoreNames.contains('mvc')) return;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('mvc', 'readwrite');
      const store = tx.objectStore('mvc');
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const value = cursor.value || {};
        const strike = Number(value.strikeOIVol ?? value.strikeVolOnly ?? null);
        const flip = Number(value.gexFlip);
        const needsFix = Number.isFinite(flip) && flip > 0 && flip < 500 && Number.isFinite(strike) && strike > 500;
        if (needsFix) {
          cursor.update({ ...value, gexFlip: strike });
        }
        cursor.continue();
      };

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ========================================================================
  // MVC SNAPSHOTS
  // triggerType: 'manual' | 'auto-9:45' | 'auto-10:30' | 'auto-12:00'
  // ========================================================================
  async saveMVCSnapshot(mvcOIVol, mvcVolOnly, spxPrice, esPrice, expiration, triggerType = 'manual', totalNetGEX = 0, netDexStrike = null, totalNetDEX_OI = 0, totalNetDEX_Vol = 0, totalNetGEX_Vol = null, gexFlip = null) {
    const now = new Date();
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
    const looksLikeTriggerLabel = typeof expiration === 'string' && /^(manual|auto-\d{1,2}:\d{2})$/.test(expiration);
    if (looksLikeTriggerLabel && triggerType === 'manual') {
      triggerType = expiration;
      expiration = '—';
    }
    
    // Calculate percentages using raw values before any display formatting
    const pctOI_Vol = totalNetGEX !== 0 ? parseFloat((Math.abs(mvcOIVol?.value ?? 0) / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;
    const pctVol_Only = totalNetGEX_Vol !== 0 && totalNetGEX_Vol != null ? parseFloat((Math.abs(mvcVolOnly?.value ?? 0) / Math.abs(totalNetGEX_Vol) * 100).toFixed(2)) : null;

    const gexFlipRaw = Number(gexFlip);
    const gexFlipStrike = Number.isFinite(gexFlipRaw) && gexFlipRaw > 500
      ? gexFlipRaw
      : (Number(mvcOIVol?.strike ?? mvcVolOnly?.strike) || null);

    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      day: dayName,
      time: now.toTimeString().split(' ')[0],
      // OI+Vol breakdown (raw values; UI converts for display)
      strikeOIVol: mvcOIVol?.strike,
      mvcValueOIVol: mvcOIVol?.value != null ? mvcOIVol.value : null,
      pctOI_Vol: pctOI_Vol,
      volumeOIVol: typeof mvcOIVol?.volume !== 'undefined' ? mvcOIVol.volume : null,
      totalNetGEX_OI: totalNetGEX != null ? totalNetGEX : null,
      // Vol Only breakdown (raw values; UI converts for display)
      strikeVolOnly: mvcVolOnly?.strike,
      mvcValueVolOnly: mvcVolOnly?.value != null ? mvcVolOnly.value : null,
      pctVol_Only: pctVol_Only,
      volumeVolOnly: typeof mvcVolOnly?.volume !== 'undefined' ? mvcVolOnly.volume : null,
      totalNetGEX_Vol: totalNetGEX_Vol != null ? totalNetGEX_Vol : null,
      // Price & Greeks (raw values; UI converts for display)
      spxPrice: Number(spxPrice) || 0,
      esPrice: Number(esPrice) || 0,
      netDEXStrike: netDexStrike?.value != null ? netDexStrike.value : null,
      topStrike: mvcOIVol?.strike ?? null,
      totalAbsNetGEX: Math.abs(Number(totalNetGEX || 0)),
      totalNetDEX_OI: totalNetDEX_OI != null ? totalNetDEX_OI : null,
      totalNetDEX_Vol: totalNetDEX_Vol != null ? totalNetDEX_Vol : null,
      // GEX Flip Point
      gexFlip: gexFlipStrike,
      // Metadata
      triggerType,
      expiration: expiration || '—',
      dte: parseInt(expiration?.split('-')[0]) || 0
    };

    return this._insert('mvc', record);
  },

  // ========================================================================
  // PREMIUM FLOW — 1 MIN BUCKETS
  // ========================================================================
  async saveMinutePremiumFlow(callFlow, putFlow, esPrice, ticker = 'SPX', netFlowOverride = null) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: ticker || 'SPX',
      callFlow: Number(callFlow || 0),
      putFlow: Number(putFlow || 0),
      netFlow: Number(netFlowOverride != null ? netFlowOverride : (Number(callFlow || 0) - Number(putFlow || 0))),
      esPrice: Number(esPrice || 0)
    };
    return this._insert('premiumFlow', record);
  },

  async queryPremiumFlow_TimeSeries(hoursBack = 6) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('premiumFlow', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // ========================================================================
  // GREEKS TIME SERIES (GEX/DEX/CHEX/VEX)
  // All fields are in billions ($B)
  // ========================================================================
  async saveGreeksTimeSeries(gex, dex, chex, vex, buyScore, sellScore, ticker = 'SPXW', price = 0) {
    const now = new Date();

    // Throttle: write at most once every 30 seconds
    const nowMs = now.getTime();
    if (this._greeksTsLastWrite && (nowMs - this._greeksTsLastWrite) < 30000) return;

    // Sanity check: reject if GEX deviates >50% from last stored value
    if (this._greeksTsLastGex != null && Math.abs(this._greeksTsLastGex) > 0) {
      const deviation = Math.abs(gex - this._greeksTsLastGex) / Math.abs(this._greeksTsLastGex);
      if (deviation > 0.5) return;
    }

    this._greeksTsLastWrite = nowMs;
    this._greeksTsLastGex   = gex;

    const getPercentile = (val, min, max) => {
      if (val <= min) return 0;
      if (val >= max) return 1;
      return (val - min) / (max - min);
    };

    const gexLevel = getPercentile(gex, -3, 3);
    const dexLevel = getPercentile(dex ? dex / 1e9 : 0, -2, 2);
    const chexLevel = getPercentile(chex ? chex / 1e9 : 0, -1.5, 1.5);
    const vexLevel = getPercentile(vex ? vex / 1e9 : 0, -2, 2);
    
    // Determine greek state/position
    const gexState = gex > 0.5 ? 'HIGH_POS' : gex > 0 ? 'POS' : gex > -0.5 ? 'NEG' : 'HIGH_NEG';
    const dexVal = dex ? dex / 1e9 : 0;
    const dexState = dexVal > 0.75 ? 'UPSIDE_PRESSURE' : dexVal > 0 ? 'UPSIDE' : dexVal < -0.75 ? 'DOWNSIDE_PRESSURE' : 'DOWNSIDE';
    const chexVal = chex ? chex / 1e9 : 0;
    const chexState = chexVal > 0.3 ? 'SUPPORT' : 'WEAK';
    const vexVal = vex ? vex / 1e9 : 0;
    const vexState = Math.abs(vexVal) > 1.5 ? 'HIGH_ACTIVE' : Math.abs(vexVal) > 0.5 ? 'ACTIVE' : 'FLAT';
    
    const netExposure = (gex || 0) + dexVal + chexVal + vexVal;

    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: ticker,
      price: price,
      // Raw greek values ($B)
      gex: gex || 0,
      dex: dexVal || 0,
      chex: chexVal || 0,
      vex: vexVal || 0,
      // Greek levels (0-1 percentile)
      gexLevel: parseFloat(gexLevel.toFixed(2)),
      dexLevel: parseFloat(dexLevel.toFixed(2)),
      chexLevel: parseFloat(chexLevel.toFixed(2)),
      vexLevel: parseFloat(vexLevel.toFixed(2)),
      // Greek states (descriptive)
      gexState: gexState,
      dexState: dexState,
      chexState: chexState,
      vexState: vexState,
      // Buy/Sell scores
      buyScore: buyScore || 0,
      sellScore: sellScore || 0,
      netExposure,
      exposureLabel: `GEX ${Number(gex || 0).toFixed(3)}B | DEX ${dexVal.toFixed(3)}B | CHEX ${chexVal.toFixed(3)}B | VEX ${vexVal.toFixed(3)}B`,
      source: 'exposure-stack'
    };
    return this._insert('greeksTimeSeries', record);
  },

  async queryGreeksTimeSeries_Today(tickerFilter = 'SPXW') {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date()).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    const all = await this._getAllRecords('greeksTimeSeries').catch(() => []);
    const fallback = all.length ? all : await this._getAllRecords('greeksHistory').catch(() => []);
    return fallback
      .filter(r => {
        if (tickerFilter && r.ticker !== tickerFilter) return false;
        const recParts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).formatToParts(new Date(Number(r.timestamp || 0))).reduce((acc, part) => {
          if (part.type !== 'literal') acc[part.type] = part.value;
          return acc;
        }, {});
        return `${recParts.year}-${recParts.month}-${recParts.day}` === today;
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  async queryGreeksTimeSeries_Hours(hoursBack = 6, tickerFilter = 'SPXW') {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = (await this._queryByRange('greeksTimeSeries', 'timestamp', cutoff).catch(() => []))
      .concat(await this._queryByRange('greeksHistory', 'timestamp', cutoff).catch(() => []));
    return records
      .filter(r => r.ticker === tickerFilter || !tickerFilter)
      .sort((a, b) => a.timestamp - b.timestamp);
  },

  // ========================================================================
  // QUERY HELPERS (used by database.html display functions)
  // ========================================================================
  async queryMVC_Recent(hoursBack = 24) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    return this._queryByRange('mvc', 'timestamp', cutoff);
  },

  async queryPremiumFlow_TopTrades(hoursBack = 1) {
    return [];
  },

  async export() {
    const stores = ['mvc', 'chainSnapshots', 'greeksHistory', 'greeksTimeSeries', 'es15mCandles'];
    const exported = {};

    for (const store of stores) {
      if (this.db.objectStoreNames.contains(store)) {
        exported[store] = await this._getAllRecords(store);
      }
    }

    return exported;
  },

  // Clear all premiumFlow records for today (ET date)
  async clearPremiumFlowToday() {
    return 0;
  },

  async import(data) {
    for (const [storeName, records] of Object.entries(data)) {
      for (const record of records) {
        await this._insert(storeName, record);
      }
    }
  },

  // ========================================================================
  // BIG BLOCK TRADES (ES / NQ futures)
  // ========================================================================
  async saveBigTrade({ ticker, price, size, side, timestamp }) {
    return null;
  },

  async queryBigTrades_Today() {
    return [];
  },

  async saveES15mCandle(candle) {
    const ts = Number(candle?.timestamp || candle?.datetime || Date.now());
    const now = new Date(ts);
    const slotKey = candle?.slotKey || `${now.toISOString().slice(0, 10)}-${now.toTimeString().slice(0, 5)}`;
    const record = {
      timestamp: ts,
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      slotKey,
      symbol: candle?.symbol || '/ES{=15m}',
      open: Number(candle?.open || 0),
      high: Number(candle?.high || 0),
      low: Number(candle?.low || 0),
      close: Number(candle?.close || 0),
      volume: Number(candle?.volume || 0),
      candleTime: candle?.candleTime || null,
      session: candle?.session || 'RTH'
    };
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('es15mCandles', 'readwrite');
      const store = tx.objectStore('es15mCandles');
      const index = store.index('slotKey');
      const getReq = index.get(record.slotKey);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const req = existing ? store.put({ ...existing, ...record, id: existing.id }) : store.add(record);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      };
    });
  },

  async queryES15mCandles(daysBack = 10) {
    const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    const records = await this._queryByRange('es15mCandles', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  async clearES15mCandles() {
    const records = await this._getAllRecords('es15mCandles');
    if (!records.length) return 0;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('es15mCandles', 'readwrite');
      tx.objectStore('es15mCandles').clear();
      tx.oncomplete = () => resolve(records.length);
      tx.onerror = () => reject(tx.error);
    });
  },

  // ========================================================================
  // INTERNAL QUERY METHODS
  // ========================================================================
  async _insert(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async _getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async _queryByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async _queryByRange(storeName, indexName, minValue, maxValue) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.lowerBound(minValue, true);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
};

// ============================================================================
// GLOBAL QUERY ALIASES (used by database.html display functions)
// ============================================================================
async function queryMVC_Recent(hoursBack = 24) {
  return DB.queryMVC_Recent(hoursBack);
}

async function queryPremiumFlow_TopTrades(hoursBack = 1) {
  return DB.queryPremiumFlow_TopTrades(hoursBack);
}

async function queryGreeksTimeSeries_Hours(hoursBack = 6, tickerFilter = 'SPXW') {
  return DB.queryGreeksTimeSeries_Hours(hoursBack, tickerFilter);
}

// ============================================================================
// AUTO-INIT
// ============================================================================
window.DB = DB;  // Export DB to window

window.addEventListener('DOMContentLoaded', () => {
  DB.init().then(() => {
    console.log('✓ Market data database ready');
    window.dispatchEvent(new CustomEvent('db-ready'));
  }).catch(err => {
    console.error('✗ Database initialization failed:', err);
  });
});

// ============================================================================
// USAGE NOTES
// ============================================================================
// 
// 1. MVC SNAPS — call from your snap handler:
//    await DB.saveMVCSnapshot(mvcOIVol, mvcVolOnly, currentPrice, 'manual');
//
// 2. AUTO-SNAP SCHEDULER — call once after db-ready:
//    DB.startAutoSnapScheduler(async (triggerLabel) => {
//      const { mvcOIVol, mvcVolOnly, price } = await getCurrentMVCData();
//      await DB.saveMVCSnapshot(mvcOIVol, mvcVolOnly, price, triggerLabel);
//    });
//
// 3. PREMIUM FLOW — call every 1 minute from DXLink WebSocket:
//    await DB.saveMinutePremiumFlow(callFlow, putFlow, esPrice, 'SPX');
//
// 4. GREEKS TIME SERIES — call from DXLink WebSocket with latest snapshot:
//    await DB.saveGreeksTimeSeries(gex, dex, chex, vex, buyScore, sellScore, 'SPXW', price);
//
// 5. BIG TRADES — call from DXLink WebSocket tape data:
//    await DB.saveBigTrade({ ticker: 'ES', price: 5500, size: 100, side: 'ASK' });
//
// All WebSocket data flows through DXLink proxy at /proxy/api endpoints

} // End of guard: if (typeof window.DB === 'undefined')
