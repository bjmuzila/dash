// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA
// Stores: MVC snapshots, Premium Flow (1-min), Greeks, Big Trades
// All WebSocket data flows through DXLink proxy at /proxy/api
// ============================================================================

if (typeof window.DB === 'undefined') {
window.DB = {
  name: 'OptionsMarketDB',
  version: 8,
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

        // Store 9: ES 15m candles for intraday RVOL context
        if (!db.objectStoreNames.contains('es15mCandles')) {
          const candleStore = db.createObjectStore('es15mCandles', { keyPath: 'id', autoIncrement: true });
          candleStore.createIndex('timestamp', 'timestamp', { unique: false });
          candleStore.createIndex('date', 'date', { unique: false });
          candleStore.createIndex('slotKey', 'slotKey', { unique: true });
        }

        // Store 10: SPX GEX snapshots for Bzila and related pages
        if (!db.objectStoreNames.contains('gexTop3')) {
          const gexStore = db.createObjectStore('gexTop3', { keyPath: 'id', autoIncrement: true });
          gexStore.createIndex('timestamp', 'timestamp', { unique: false });
          gexStore.createIndex('date', 'date', { unique: false });
          gexStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 11: Bzila live snapshot snapshots
        if (!db.objectStoreNames.contains('bzilaLiveSnapshots')) {
          const bzilaStore = db.createObjectStore('bzilaLiveSnapshots', { keyPath: 'id', autoIncrement: true });
          bzilaStore.createIndex('timestamp', 'timestamp', { unique: false });
          bzilaStore.createIndex('date', 'date', { unique: false });
          bzilaStore.createIndex('ticker', 'ticker', { unique: false });
        }
      };
    });
  },

  async _withReopen(fn) {
    try {
      if (!this.db) {
        await this.init();
      }
      return await fn();
    } catch (err) {
      const msg = String(err?.message || err || '');
      if (err?.name === 'InvalidStateError' || /database connection is closing/i.test(msg)) {
        this.db = null;
        await this.init();
        return await fn();
      }
      throw err;
    }
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
  async saveMVCSnapshot(mvcOIVol, mvcVolOnly, spxPrice, esPrice, expiration, triggerType = 'manual', totalNetGEX = 0, netDexStrike = null, totalNetDEX_OI = 0, totalNetDEX_Vol = 0, timeRangeStart = null, totalNetGEX_Vol = null, gexFlip = null) {
    const now = new Date();
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
    const isTriggerLabel = (value) => typeof value === 'string' && /^(manual|auto(?:-\d{1,2}:\d{2})?)$/.test(value);
    const looksLikeTriggerLabel = isTriggerLabel(expiration);
    if (looksLikeTriggerLabel && triggerType === 'manual') {
      triggerType = expiration;
      expiration = '—';
    }
    triggerType = isTriggerLabel(triggerType) ? triggerType : 'manual';
    
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
      totalNetGEX_OI: totalNetGEX != null ? Math.abs(Number(totalNetGEX)) : null,
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
      totalNetDEX_OI: totalNetDEX_OI != null ? totalNetDEX_OI : null,
      totalNetDEX_Vol: totalNetDEX_Vol != null ? totalNetDEX_Vol : null,
      totalAbsNetGEX: Math.abs(Number(totalNetGEX || 0)),
      gexFlip: gexFlipStrike,
      // Metadata
      triggerType,
      expiration: expiration || '—',
      dte: parseInt(expiration?.split('-')[0]) || 0,
      timeRangeStart
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

  async queryPremiumFlow_Today() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('premiumFlow', 'date', today);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // ========================================================================
  // SPX GEX SNAPSHOTS
  // ========================================================================
  async saveSpxGexSnapshot(rows, spot = 0, deltaGexTotals = {}, sourcePage = 'spx') {
    const now = new Date();
    const normalizedRows = (Array.isArray(rows) ? rows : [])
      .filter(r => Number.isFinite(Number(r?.strike)))
      .slice(0, 3)
      .map(r => ({
        strike: Number(r.strike),
        callGEX: Number(r.callGEX || 0),
        putGEX: Number(r.putGEX || 0),
        callDelta: Number(r.callDelta || 0),
        putDelta: Number(r.putDelta || 0),
        callDeltaGEX: Number(r.callDeltaGEX || 0),
        putDeltaGEX: Number(r.putDeltaGEX || 0),
        deltaWeightedGEX: Number(r.deltaWeightedGEX || 0)
      }));

    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: 'SPX GEX',
      sourcePage: sourcePage || 'spx',
      spot: Number(spot || 0),
      rows: normalizedRows,
      topStrike: normalizedRows[0]?.strike ?? null,
      totalAbsNetGEX: normalizedRows.reduce((sum, row) => sum + Math.abs(row.deltaWeightedGEX), 0),
      totalCallDeltaGEX: Number(deltaGexTotals.totalCallDeltaGEX || 0),
      totalPutDeltaGEX: Number(deltaGexTotals.totalPutDeltaGEX || 0),
      netDeltaGEX: Number(deltaGexTotals.net || 0)
    };

    return this._insert('gexTop3', record);
  },

  async saveGexTop3Snapshot(rows, spot = 0, deltaGexTotals = {}) {
    return this.saveSpxGexSnapshot(rows, spot, deltaGexTotals, 'legacy');
  },

  async querySpxGex_TimeSeries(hoursBack = 12) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('gexTop3', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  async querySpxGex_Today() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('gexTop3', 'date', today);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  async queryGexTop3_TimeSeries(hoursBack = 12) {
    return this.querySpxGex_TimeSeries(hoursBack);
  },

  async queryGexTop3_Today() {
    return this.querySpxGex_Today();
  },

  // ========================================================================
  // BZILA LIVE SNAPSHOT
  // ========================================================================
  async saveBzilaLiveSnapshot(snapshot = {}) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: 'SPX',
      panel: 'bzila-live-snapshot',
      orders: Array.isArray(snapshot.orders) ? snapshot.orders : [],
      stats: snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : {}
    };
    return this._insert('bzilaLiveSnapshots', record);
  },

  async queryBzilaLiveSnapshots_Today() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('bzilaLiveSnapshots', 'date', today);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // ========================================================================
  // GREEKS TIME SERIES (GEX/DEX/CHEX/VEX)
  // All fields are in billions ($B)
  // ========================================================================
  async saveGreeksTimeSeries(gex, dex, chex, vex, buyScore, sellScore, ticker = 'SPXW', price = 0) {
    const now = new Date();
    const normalizeGreekBillions = (value) => {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) return 0;
      return Math.abs(num) >= 1e6 ? num / 1e9 : num;
    };
    const gexVal = normalizeGreekBillions(gex);
    const dexVal = normalizeGreekBillions(dex);
    const chexVal = normalizeGreekBillions(chex);
    const vexVal = normalizeGreekBillions(vex);
    const netExposure = gexVal + dexVal + chexVal + vexVal;
    
    const getPercentile = (val, min, max) => {
      if (val <= min) return 0;
      if (val >= max) return 1;
      return (val - min) / (max - min);
    };

    const gexLevel = getPercentile(gexVal, -3, 3);
    const dexLevel = getPercentile(dexVal, -2, 2);
    const chexLevel = getPercentile(chexVal, -1.5, 1.5);
    const vexLevel = getPercentile(vexVal, -2, 2);
    
    // Determine greek state/position
    const gexState = gexVal > 0.5 ? 'HIGH_POS' : gexVal > 0 ? 'POS' : gexVal > -0.5 ? 'NEG' : 'HIGH_NEG';
    const dexState = dexVal > 0.75 ? 'UPSIDE_PRESSURE' : dexVal > 0 ? 'UPSIDE' : dexVal < -0.75 ? 'DOWNSIDE_PRESSURE' : 'DOWNSIDE';
    const chexState = chexVal > 0.3 ? 'SUPPORT' : 'WEAK';
    const vexState = Math.abs(vexVal) > 1.5 ? 'HIGH_ACTIVE' : Math.abs(vexVal) > 0.5 ? 'ACTIVE' : 'FLAT';
    
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: ticker,
      price: price,
      // Raw greek values ($B)
      gex: gexVal || 0,
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
      exposureLabel: `GEX ${gexVal.toFixed(3)}B | DEX ${dexVal.toFixed(3)}B | CHEX ${chexVal.toFixed(3)}B | VEX ${vexVal.toFixed(3)}B`,
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
    const all = await this._getAllRecords('greeksTimeSeries');
    return all
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
    const records = await this._queryByRange('greeksTimeSeries', 'timestamp', cutoff);
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
    return this.queryPremiumFlow_TimeSeries(hoursBack);
  },

  async clearPremiumFlowToday() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('premiumFlow', 'date', today);
    if (!records.length) return 0;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('premiumFlow', 'readwrite');
      const store = tx.objectStore('premiumFlow');
      let deleted = 0;
      records.forEach(r => {
        const req = store.delete(r.id);
        req.onsuccess = () => { deleted += 1; };
        req.onerror = () => reject(req.error);
      });
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error);
    });
  },

  async export() {
    const stores = ['mvc', 'premiumFlow', 'chainSnapshots', 'greeksHistory', 'greeksTimeSeries', 'es15mCandles'];
    const exported = {};

    for (const store of stores) {
      if (this.db.objectStoreNames.contains(store)) {
        exported[store] = await this._getAllRecords(store);
      }
    }

    return exported;
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

  // ========================================================================
  // ES 15M CANDLES (PAST 10 TRADING DAYS)
  // ========================================================================
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
    return this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  },

  async _getAllRecords(storeName) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  },

  async _queryByIndex(storeName, indexName, value) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  },

  async _queryByRange(storeName, indexName, minValue, maxValue) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.lowerBound(minValue, true);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
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
