// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA — SINGLE SOURCE OF TRUTH
// This file (pages/database/database.js) is the ONLY database.js.
// Loaded by index.html. Do not define window.DB anywhere else.
// Stores: MVC snapshots, Premium Flow (1-min), Greeks, GEX Top3, Bzila,
//         Buy/Sell scores, ES 15m candles
// ============================================================================

if (typeof window.DB === 'undefined') {
window.DB = {
  name: 'OptionsMarketDB',
  version: 9,
  db: null,
  _autoSnapScheduled: false,
  _greeksTsLastWrite: null,
  _greeksTsLastGex: null,

  // ========================================================================
  // INITIALIZATION
  // ========================================================================
  async init(isRetry = false) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, this.version);

      request.onerror = () => {
        const err = request.error;
        const errMsg = String(err?.message || err?.name || '');
        // Handle version conflicts by deleting and recreating
        if (err?.name === 'VersionError' || errMsg.includes('version') || errMsg.includes('requested')) {
          if (!isRetry) {
            console.warn('⚠ Version conflict detected, deleting old database...');
            const deleteReq = indexedDB.deleteDatabase(this.name);
            deleteReq.onsuccess = () => {
              console.log('✓ Old database deleted, retrying...');
              setTimeout(() => this.init(true).then(resolve).catch(reject), 200);
            };
            deleteReq.onerror = () => {
              console.error('Failed to delete database:', deleteReq.error);
              reject(deleteReq.error);
            };
          } else {
            console.error('Recovery failed after retry:', err);
            reject(err);
          }
        } else {
          reject(err);
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✓ Database initialized (v' + this.version + ')');
        setTimeout(() => this.normalizeMVCFlipStrikes().catch(err => console.warn('MVC flip normalization failed:', err)), 0);
        resolve(true);
      };
      request.onblocked = () => {
        console.warn('⚠ Database open blocked (close other tabs if having issues)');
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

        // Store 3: Full chain snapshots
        if (!db.objectStoreNames.contains('chainSnapshots')) {
          const snapStore = db.createObjectStore('chainSnapshots', { keyPath: 'id', autoIncrement: true });
          snapStore.createIndex('timestamp', 'timestamp', { unique: false });
          snapStore.createIndex('date', 'date', { unique: false });
        }

        // Store 4: Greeks history
        if (!db.objectStoreNames.contains('greeksHistory')) {
          const greekStore = db.createObjectStore('greeksHistory', { keyPath: 'id', autoIncrement: true });
          greekStore.createIndex('timestamp', 'timestamp', { unique: false });
          greekStore.createIndex('strike_exp', ['strike', 'expiration'], { unique: false });
        }

        // Store 5: Multi-stock flow (0DTE-30DTE per stock)
        if (!db.objectStoreNames.contains('multiStockFlow')) {
          const multiStore = db.createObjectStore('multiStockFlow', { keyPath: 'id', autoIncrement: true });
          multiStore.createIndex('timestamp', 'timestamp', { unique: false });
          multiStore.createIndex('date', 'date', { unique: false });
          multiStore.createIndex('stock', 'stock', { unique: false });
          multiStore.createIndex('stock_dte', ['stock', 'dte'], { unique: false });
        }

        // Store 6: Greeks time-series (GEX/DEX/CHEX/VEX history)
        if (!db.objectStoreNames.contains('greeksTimeSeries')) {
          const greekTsStore = db.createObjectStore('greeksTimeSeries', { keyPath: 'id', autoIncrement: true });
          greekTsStore.createIndex('timestamp', 'timestamp', { unique: false });
          greekTsStore.createIndex('date', 'date', { unique: false });
          greekTsStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 7: Big block trades (ES/NQ futures)
        if (!db.objectStoreNames.contains('bigTrades')) {
          const btStore = db.createObjectStore('bigTrades', { keyPath: 'id', autoIncrement: true });
          btStore.createIndex('timestamp', 'timestamp', { unique: false });
          btStore.createIndex('date', 'date', { unique: false });
          btStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 8: ES 15m candles for intraday RVOL context
        if (!db.objectStoreNames.contains('es15mCandles')) {
          const candleStore = db.createObjectStore('es15mCandles', { keyPath: 'id', autoIncrement: true });
          candleStore.createIndex('timestamp', 'timestamp', { unique: false });
          candleStore.createIndex('date', 'date', { unique: false });
          candleStore.createIndex('slotKey', 'slotKey', { unique: true });
        }

        // Store 9: SPX GEX snapshots for Bzila and related pages
        if (!db.objectStoreNames.contains('gexTop3')) {
          const gexStore = db.createObjectStore('gexTop3', { keyPath: 'id', autoIncrement: true });
          gexStore.createIndex('timestamp', 'timestamp', { unique: false });
          gexStore.createIndex('date', 'date', { unique: false });
          gexStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 10: Bzila live snapshots
        if (!db.objectStoreNames.contains('bzilaLiveSnapshots')) {
          const bzilaStore = db.createObjectStore('bzilaLiveSnapshots', { keyPath: 'id', autoIncrement: true });
          bzilaStore.createIndex('timestamp', 'timestamp', { unique: false });
          bzilaStore.createIndex('date', 'date', { unique: false });
          bzilaStore.createIndex('ticker', 'ticker', { unique: false });
        }

        // Store 11: Buy/Sell scores (15-min slots)
        if (!db.objectStoreNames.contains('buySellScores')) {
          const bsStore = db.createObjectStore('buySellScores', { keyPath: 'id', autoIncrement: true });
          bsStore.createIndex('timestamp', 'timestamp', { unique: false });
          bsStore.createIndex('date', 'date', { unique: false });
          bsStore.createIndex('slotKey', 'slotKey', { unique: true });
        }
      };
    });
  },

  // Re-open the connection if something closed it (e.g. page cleanup)
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
      netDEXStrike: netDexStrike != null ? (typeof netDexStrike === 'object' ? (netDexStrike.value ?? null) : Number(netDexStrike)) : null,
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

    const result = await this._insert('mvc', record);

    // SYNC TO SQLite backend
    try {
      await fetch(window.location.origin + '/api/mvc/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: record.timestamp,
          date: record.date,
          triggerType: record.triggerType,
          mvcOIVol: mvcOIVol,
          mvcVolOnly: mvcVolOnly,
          currentPrice: record.esPrice,
          spxPrice: record.spxPrice,
          expiration: record.expiration,
          totalNetGEX: totalNetGEX,
          netDexStrike: netDexStrike,
          totalNetDEX_OI: totalNetDEX_OI,
          gexFlip: record.gexFlip
        })
      }).catch(e => console.warn('[Sync] MVC save to SQLite failed:', e.message));
    } catch (e) {
      console.warn('[Sync] MVC sync error:', e.message);
    }

    if (typeof window.updateSnapshotCount === 'function') window.updateSnapshotCount();
    if (typeof window.loadGexPeaks === 'function') window.loadGexPeaks();
    return result;
  },

  async getMVCCount() {
    return this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction('mvc', 'readonly');
      const request = tx.objectStore('mvc').count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    }));
  },

  async getRecentMVC(limit = 5) {
    const all = await this._getAllRecords('mvc').catch(() => []);
    return all.slice(-limit).reverse();
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
  // BUY/SELL SCORES (15-min slots, upsert by slotKey)
  // ========================================================================
  async saveBuySellScore(score) {
    const now = new Date();
    const record = {
      timestamp: score.timestamp || now.getTime(),
      date: score.date || now.toISOString().split('T')[0],
      time: score.time || now.toTimeString().split(' ')[0],
      slotKey: score.slotKey || `${now.toISOString().split('T')[0]}-${now.getHours()}:${now.getMinutes()}`,
      spxPrice: Number(score.spxPrice || 0),
      side: score.side || 'Buy',
      score: Number(score.score || 0),
      buyPct: Number(score.buyPct || 0),
      sellPct: Number(score.sellPct || 0)
    };

    const result = await this._withReopen(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction('buySellScores', 'readwrite');
      const store = tx.objectStore('buySellScores');
      const getReq = store.index('slotKey').get(record.slotKey);
      getReq.onerror = () => reject(getReq.error);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const req = existing ? store.put({ ...existing, ...record, id: existing.id }) : store.add(record);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      };
    }));

    // SYNC TO SQLite backend
    try {
      await fetch(window.location.origin + '/api/buy_sell/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: record.timestamp,
          date: record.date,
          time: record.time,
          slot_key: record.slotKey,
          spx_price: record.spxPrice,
          side: record.side,
          score: record.score,
          buy_pct: record.buyPct,
          sell_pct: record.sellPct,
          gex: score.gex || 0,
          dex: score.dex || 0,
          chex: score.chex || 0,
          vex: score.vex || 0
        })
      }).catch(e => console.warn('[Sync] Buy/sell save to SQLite failed:', e.message));
    } catch (e) {
      console.warn('[Sync] Buy/sell sync error:', e.message);
    }

    return result;
  },

  async queryBuySellScores_Today() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('buySellScores', 'date', today);
    return records.sort((a, b) => b.timestamp - a.timestamp);
  },

  // ========================================================================
  // GREEKS TIME SERIES (GEX/DEX/CHEX/VEX)
  // All fields are in billions ($B)
  // ========================================================================
  async saveGreeksTimeSeries(gex, dex, chex, vex, buyScore, sellScore, ticker = 'SPXW', price = 0) {
    const now = new Date();
    const normalizeGreekBillions = (value, metric) => {
      const num = Number(value || 0);
      if (!Number.isFinite(num)) return 0;
      if (metric === 'chex' || metric === 'vex') {
        if (Math.abs(num) >= 1e3) return num / 1e9;
        return num / 1e3;
      }
      return Math.abs(num) >= 1e6 ? num / 1e9 : num;
    };
    const gexRaw = Number(gex || 0);
    const dexRaw = Number(dex || 0);
    const chexRaw = Number(chex || 0);
    const vexRaw = Number(vex || 0);
    const gexVal = normalizeGreekBillions(gexRaw, 'gex');
    const dexVal = normalizeGreekBillions(dexRaw, 'dex');
    const chexVal = normalizeGreekBillions(chexRaw, 'chex');
    const vexVal = normalizeGreekBillions(vexRaw, 'vex');
    const netExposure = gexVal + dexVal + chexVal + vexVal;

    // Throttle: write at most once every 30 seconds
    const nowMs = now.getTime();
    if (this._greeksTsLastWrite && (nowMs - this._greeksTsLastWrite) < 30000) return;

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

    this._greeksTsLastWrite = nowMs;
    this._greeksTsLastGex = gexVal;

    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      ticker: ticker,
      price: price,
      // Preserve raw values so the sparkline can reconstruct historical scale exactly.
      gexRaw: Number.isFinite(gexRaw) ? gexRaw : 0,
      dexRaw: Number.isFinite(dexRaw) ? dexRaw : 0,
      chexRaw: Number.isFinite(chexRaw) ? chexRaw : 0,
      vexRaw: Number.isFinite(vexRaw) ? vexRaw : 0,
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
    const stores = ['mvc', 'premiumFlow', 'chainSnapshots', 'greeksHistory', 'greeksTimeSeries', 'es15mCandles', 'gexTop3', 'bzilaLiveSnapshots', 'buySellScores'];
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

    return this._withReopen(() => new Promise((resolve, reject) => {
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
    }));
  },

  async queryES15mCandles(daysBack = 10) {
    const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    const records = await this._queryByRange('es15mCandles', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // ========================================================================
  // ES 5M CANDLES (INTRADAY — CURRENT SESSION)
  // ========================================================================
  async saveES5mCandle(candle) {
    const ts = Number(candle?.timestamp || candle?.datetime || Date.now());
    const etDate = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const date = `${etDate.getFullYear()}-${String(etDate.getMonth()+1).padStart(2,'0')}-${String(etDate.getDate()).padStart(2,'0')}`;
    const slotKey = candle?.slotKey || `${date}-${String(etDate.getHours()).padStart(2,'0')}:${String(etDate.getMinutes()).padStart(2,'0')}`;
    const record = {
      timestamp: ts,
      date,
      time: etDate.toTimeString().split(' ')[0],
      slotKey,
      symbol: candle?.symbol || '/ES{=5m}',
      open: Number(candle?.open || 0),
      high: Number(candle?.high || 0),
      low: Number(candle?.low || 0),
      close: Number(candle?.close || 0),
      volume: Number(candle?.volume || 0),
      session: candle?.session || 'RTH'
    };

    // proxy removed — server-side DB insert not available until rebuilt
    return null;
  },

  async queryES5mCandles(daysBack = 3) {
    // proxy removed — server DB query not available until rebuilt
    return [];
  },

  async clearES5mCandles() {
    // proxy removed
    return 0;
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
  // AUTO-SNAP SCHEDULER (9:45 / 10:30 / 12:00 ET snaps + 4:30pm export)
  // ========================================================================
  startAutoSnapScheduler() {
    if (this._autoSnapScheduled) return;
    this._autoSnapScheduled = true;

    const AUTO_SNAP_TIMES = ['9:45', '10:30', '12:00'];
    const EXPORT_TIME = '16:30'; // 4:30pm ET

    const scheduleNext = () => {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hh = nowET.getHours();
      const mm = nowET.getMinutes();
      const totalNowMins = hh * 60 + mm;

      let msUntilNext = null;
      let nextLabel = null;

      // Check for trading snaps
      for (const t of AUTO_SNAP_TIMES) {
        const [sh, sm] = t.split(':').map(Number);
        const snapMins = sh * 60 + sm;
        if (snapMins > totalNowMins) {
          const diffMins = snapMins - totalNowMins;
          const diffMs = (diffMins * 60 - nowET.getSeconds()) * 1000 - nowET.getMilliseconds();
          if (msUntilNext === null || diffMs < msUntilNext) {
            msUntilNext = diffMs;
            nextLabel = `auto-${t}`;
          }
        }
      }

      // Check for daily export at 4:30pm
      const [eh, em] = EXPORT_TIME.split(':').map(Number);
      const exportMins = eh * 60 + em;
      if (exportMins > totalNowMins) {
        const diffMins = exportMins - totalNowMins;
        const diffMs = (diffMins * 60 - nowET.getSeconds()) * 1000 - nowET.getMilliseconds();
        if (msUntilNext === null || diffMs < msUntilNext) {
          msUntilNext = diffMs;
          nextLabel = 'export-excel';
        }
      }

      if (msUntilNext !== null && msUntilNext > 0) {
        console.log(`⏰ Next event: ${nextLabel} in ${Math.round(msUntilNext / 1000)}s`);
        setTimeout(async () => {
          console.log(`📸 Event firing: ${nextLabel}`);
          try {
            if (nextLabel === 'export-excel') {
              await this.exportDailySnapshotsToExcel();
            } else if (typeof window.gexDatabaseSnapshot === 'function') {
              await window.gexDatabaseSnapshot(nextLabel);
            } else if (typeof window.gexTakeSnapshot === 'function') {
              await window.gexTakeSnapshot(nextLabel);
            }
          } catch (e) {
            console.error('Event error:', e);
          }
          scheduleNext();
        }, msUntilNext);
      } else {
        const midnight = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        midnight.setHours(24, 0, 5, 0);
        const msUntilMidnight = midnight - new Date();
        console.log(`⏰ All events done. Rescheduling at midnight (${Math.round(msUntilMidnight / 1000 / 60)}min)`);
        setTimeout(scheduleNext, msUntilMidnight);
      }
    };

    scheduleNext();
  },

  async exportDailySnapshotsToExcel() {
    if (!this.db) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const records = await this._queryByIndex('mvc', 'date', today);

      if (records.length === 0) {
        console.log('No snapshots to export for today');
        return;
      }

      // Prepare data
      const wsData = records.map(r => ({
        'Day': r.day || '—',
        'Date': r.date || '—',
        'Time': r.time || '—',
        'Strike': r.strikeOIVol || r.strikeVolOnly || '—',
        'Net GEX': r.mvcValueOIVol != null ? (r.mvcValueOIVol / 1e9).toFixed(2) : '—',
        'ES Price': r.esPrice != null ? Number(r.esPrice).toFixed(2) : '—',
        'SPX Price': r.spxPrice != null ? Number(r.spxPrice).toFixed(2) : '—',
        'Net DEX': r.totalNetDEX_OI != null ? (r.totalNetDEX_OI / 1e6).toFixed(2) : '—',
        'Trigger': r.triggerType || 'manual',
        'Expiration': r.expiration || '—'
      }));

      const filename = `MVC_Snapshots_${today}.xlsx`;

      // POST to proxy endpoint
      const resp = await fetch('http://localhost:3002/export-mvc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: wsData, filename })
      });

      const result = await resp.json();
      if (resp.ok) {
        console.log(`✓ Excel exported: ${result.message}`);
      } else {
        console.error(`✗ Export failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Excel export failed:', err);
    }
  },

  // ========================================================================
  // INTERNAL QUERY METHODS — SQLite via REST API
  // ========================================================================
  async _insert(storeName, record) {
    // Route to correct SQLite endpoint based on store name
    const endpoints = {
      'mvc': '/api/mvc/save',
      'premiumFlow': '/api/premium_flow/save',
      'chainSnapshots': '/api/chain/snapshot',
      'greeksHistory': null, // greeks_history (not exposed yet)
      'multiStockFlow': null, // multi_stock_flow (not exposed yet)
      'greeksTimeSeries': '/api/greeks/timeseries',
      'bigTrades': null, // big_trades (not exposed yet)
      'es15mCandles': '/api/candles/es15m',
      'gexTop3': '/api/gex/top3',
      'bzilaLiveSnapshots': '/api/bzila/snapshot'
    };

    const endpoint = endpoints[storeName];
    if (!endpoint) {
      // Fall back to IndexedDB for stores without endpoints
      return this._indexedDBInsert(storeName, record);
    }

    try {
      const response = await fetch(window.location.origin + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log(`[Sync] Saved to SQLite: ${storeName}`);
      return record.id || Date.now();
    } catch (err) {
      console.warn(`[DB] SQLite write failed for ${storeName}, falling back to IndexedDB:`, err.message);
      // Graceful fallback to IndexedDB
      return this._indexedDBInsert(storeName, record);
    }
  },

  async _indexedDBInsert(storeName, record) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(storeName)) { resolve(0); return; }
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  },

  async _getAllRecords(storeName) {
    const endpoints = {
      'mvc': '/api/mvc/all',
      'premiumFlow': null,
      'chainSnapshots': null,
      'greeksTimeSeries': null,
      'es15mCandles': '/api/candles/es15m/date',
      'gexTop3': null,
      'bzilaLiveSnapshots': null
    };

    const endpoint = endpoints[storeName];
    if (endpoint) {
      try {
        const date = new Date().toISOString().split('T')[0];
        const resp = await fetch(window.location.origin + endpoint + '?date=' + date);
        if (resp.ok) {
          const records = await resp.json();
          console.log(`[Sync] Loaded ${records.length} records for ${storeName} from SQLite`);
          return records;
        }
      } catch (e) {
        console.warn(`[DB] SQLite read failed for ${storeName}:`, e.message);
      }
    }

    // Fall back to IndexedDB
    return this._indexedDBGetAll(storeName);
  },

  async _indexedDBGetAll(storeName) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  },

  async _queryByIndex(storeName, indexName, value) {
    // Route to SQLite endpoints for common queries
    const endpoints = {
      'buySellScores': { path: '/api/buy_sell/date', param: 'date' },
      'premiumFlow': { path: '/api/premium_flow/date', param: 'date' },
      'gexTop3': { path: '/api/gex/top3/date', param: 'date' },
      'bzilaLiveSnapshots': { path: '/api/bzila/snapshot/date', param: 'date' },
      'greeksTimeSeries': { path: '/api/greeks/timeseries/date', param: 'date' },
      'es15mCandles': { path: '/api/candles/es15m/date', param: 'date' },
      'chainSnapshots': { path: '/api/chain/snapshot/date', param: 'date' }
    };

    const endpoint = endpoints[storeName];
    if (endpoint && indexName === 'date') {
      try {
        const url = `${window.location.origin}${endpoint.path}?${endpoint.param}=${encodeURIComponent(value)}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const records = await resp.json();
          console.log(`[Sync] Loaded ${records.length} records for ${storeName}/${indexName}/${value} from SQLite`);
          return records;
        }
      } catch (e) {
        console.warn(`[DB] SQLite query failed for ${storeName}, falling back to IndexedDB:`, e.message);
      }
    }

    // Fall back to IndexedDB
    return this._indexedDBQueryByIndex(storeName, indexName, value);
  },

  async _indexedDBQueryByIndex(storeName, indexName, value) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) { resolve([]); return; }
      const request = store.index(indexName).getAll(value);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  },

  async _queryByRange(storeName, indexName, minValue, maxValue = Date.now()) {
    // Route to SQLite endpoints for time range queries
    const endpoints = {
      'premiumFlow': '/api/premium_flow/range',
      'greeksTimeSeries': '/api/greeks/timeseries/range'
    };

    const endpoint = endpoints[storeName];
    if (endpoint && indexName === 'timestamp') {
      try {
        const url = `${window.location.origin}${endpoint}?minTs=${minValue}&maxTs=${maxValue}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const records = await resp.json();
          console.log(`[Sync] Loaded ${records.length} records for ${storeName} range from SQLite`);
          return records;
        }
      } catch (e) {
        console.warn(`[DB] SQLite range query failed for ${storeName}:`, e.message);
      }
    }

    // Fall back to IndexedDB
    return this._indexedDBQueryByRange(storeName, indexName, minValue, maxValue);
  },

  async _indexedDBQueryByRange(storeName, indexName, minValue, maxValue = Date.now()) {
    return this._withReopen(() => new Promise((resolve, reject) => {
      if (!this.db || !this.db.objectStoreNames.contains(storeName)) { resolve([]); return; }
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) { resolve([]); return; }
      const range = IDBKeyRange.bound(minValue, maxValue, true, false);
      const request = store.index(indexName).getAll(range);
      request.onsuccess = () => resolve(request.result || []);
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
window.addEventListener('DOMContentLoaded', () => {
  window.DB.init().then(() => {
    console.log('✓ Market data database ready');
    window.dispatchEvent(new CustomEvent('db-ready'));
  }).catch(err => {
    console.error('✗ Database initialization failed:', err);
  });
});

} // End of guard: if (typeof window.DB === 'undefined')

// Prevent CommonJS bundlers from trying to export this as a module
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  try {
    module.exports = undefined;
  } catch (e) {
    // Silently ignore if module is read-only or missing
  }
}
