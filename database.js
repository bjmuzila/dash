// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA
// Stores: MVC snapshots, Premium Flow (1-min), Greeks
// ============================================================================

const DB = {
  name: 'OptionsMarketDB',
  version: 4,
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

        // Store 6: Buy/Sell confidence score snapshots
        if (!db.objectStoreNames.contains('buySellScores')) {
          const bsStore = db.createObjectStore('buySellScores', { keyPath: 'id', autoIncrement: true });
          bsStore.createIndex('timestamp', 'timestamp', { unique: false });
          bsStore.createIndex('date', 'date', { unique: false });
          bsStore.createIndex('slotKey', 'slotKey', { unique: true });
        }
      };
    });
  },

  // ========================================================================
  // MVC SNAPSHOTS
  // triggerType: 'manual' | 'auto-9:45' | 'auto-10:30' | 'auto-12:00'
  // ========================================================================
  async saveMVCSnapshot(mvcOIVol, mvcVolOnly, currentPrice, expiration, triggerType = 'manual', totalNetGEX = 0, netDexStrike = null, totalNetDEX_OI = 0, totalNetDEX_Vol = 0, timeRangeStart = null) {
    const now = new Date();
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()];
    const pctOIVol  = totalNetGEX !== 0 ? parseFloat((Math.abs(mvcOIVol.value)  / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;
    const pctVolOnly = totalNetGEX !== 0 ? parseFloat((Math.abs(mvcVolOnly.value) / Math.abs(totalNetGEX) * 100).toFixed(2)) : null;

    // Calculate duration from previous snap time string (HH:MM:SS)
    let durationMinutes = null;
    if (timeRangeStart) {
      const [h, m] = timeRangeStart.split(':').map(Number);
      const prevDate = new Date();
      prevDate.setHours(h, m, 0, 0);
      durationMinutes = Math.round((now.getTime() - prevDate.getTime()) / 60000);
    }

    const record = {
      timestamp:        now.getTime(),
      date:             now.toISOString().split('T')[0],
      day:              dayName,
      time:             now.toTimeString().split(' ')[0],
      triggerType:      triggerType,
      expiration:       expiration || '—',
      strikeOIVol:      mvcOIVol.strike,
      mvcValueOIVol:    mvcOIVol.value,
      pctNetGEXOIVol:   pctOIVol,
      volumeOIVol:      mvcOIVol.volume,
      strikeVolOnly:    mvcVolOnly.strike,
      mvcValueVolOnly:  mvcVolOnly.value,
      pctNetGEXVolOnly: pctVolOnly,
      volumeVolOnly:    mvcVolOnly.volume,
      currentPrice:     currentPrice,
      totalNetGEX:      totalNetGEX,
      netDexStrike:     netDexStrike,
      totalNetDEX_OI:   totalNetDEX_OI,
      totalNetDEX_Vol:  totalNetDEX_Vol,
      timeRangeStart:   timeRangeStart || null,
      durationMinutes:  durationMinutes
    };
    console.log('📊 MVC saving:', { triggerType, expiration: record.expiration, totalNetDEX_OI, totalNetDEX_Vol, durationMinutes });
    return this._insert('mvc', record);
  },

  async getMVCHistory(daysBack = 5) {
    const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    return this._queryByRange('mvc', 'timestamp', cutoff);
  },

  async getMVCByDate(dateStr) {
    return this._queryByIndex('mvc', 'date', dateStr);
  },

  async getMVCByTriggerType(triggerType) {
    return this._queryByIndex('mvc', 'triggerType', triggerType);
  },

  // ========================================================================
  // AUTO-SNAP SCHEDULER (9:45, 10:30, 12:00 Eastern)
  // Call this once after DB init, passing your snap callback:
  //   DB.startAutoSnapScheduler(() => takeMVCSnapshot('auto'))
  // ========================================================================
  startAutoSnapScheduler(snapCallback) {
    if (this._autoSnapScheduled) return;
    this._autoSnapScheduled = true;

    const AUTO_SNAP_TIMES = ['9:45', '10:30', '12:00']; // Eastern

    const scheduleNext = () => {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hh = nowET.getHours();
      const mm = nowET.getMinutes();
      const totalNowMins = hh * 60 + mm;

      // Find next snap time that hasn't passed today
      let msUntilNext = null;
      let nextLabel = null;

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

      if (msUntilNext !== null && msUntilNext > 0) {
        console.log(`⏰ Auto-snap scheduled: ${nextLabel} in ${Math.round(msUntilNext / 1000)}s`);
        setTimeout(async () => {
          console.log(`📸 Auto-snap firing: ${nextLabel}`);
          try {
            await snapCallback(nextLabel);
          } catch (e) {
            console.error('Auto-snap error:', e);
          }
          scheduleNext(); // Schedule the next one
        }, msUntilNext);
      } else {
        // All snaps passed for today — reschedule at midnight ET
        const midnight = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        midnight.setHours(24, 0, 5, 0);
        const msUntilMidnight = midnight - new Date();
        console.log(`⏰ All auto-snaps done for today. Rescheduling at midnight (${Math.round(msUntilMidnight / 1000 / 60)}min)`);
        setTimeout(scheduleNext, msUntilMidnight);
      }
    };

    scheduleNext();
  },

  // ========================================================================
  // PREMIUM FLOW — 1-MINUTE BUCKETS
  // Call once per minute with rolled-up totals from the options chain.
  // callFlow / putFlow: 1-minute premium flow buckets
  // ========================================================================
  async saveMinutePremiumFlow(callFlow, putFlow, esPrice) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      callFlow: callFlow,
      putFlow: putFlow,
      netFlow: callFlow + putFlow,
      esPrice: esPrice
    };
    return this._insert('premiumFlow', record);
  },

  // Get 1-min time series for charting in bzila.html
  async queryPremiumFlow_TimeSeries(hoursBack = 6) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('premiumFlow', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // Get today's premium flow
  async queryPremiumFlow_Today() {
    const today = new Date().toISOString().split('T')[0];
    return this._queryByIndex('premiumFlow', 'date', today);
  },

  // ========================================================================
  // BUY / SELL SCORE SNAPSHOTS
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

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['buySellScores'], 'readwrite');
      const store = tx.objectStore('buySellScores');
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

  async queryBuySellScores_Today() {
    const today = new Date().toISOString().split('T')[0];
    const records = await this._queryByIndex('buySellScores', 'date', today);
    return records.sort((a, b) => b.timestamp - a.timestamp);
  },

  // ========================================================================
  // CHAIN SNAPSHOTS (FULL OPTIONS CHAIN AT POINT IN TIME)
  // ========================================================================
  async saveChainSnapshot(chainData, intervalMinutes = 5) {
    const lastSnapshot = await this._getLatestRecord('chainSnapshots');
    if (lastSnapshot && (Date.now() - lastSnapshot.timestamp) < (intervalMinutes * 60 * 1000)) {
      return;
    }

    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      chainData: chainData,
      optionCount: chainData.options?.length || 0,
      expirationCount: Object.keys(chainData.expiryMap || {}).length
    };

    return this._insert('chainSnapshots', record);
  },

  async getChainSnapshot(timestamp) {
    const records = await this._getAllRecords('chainSnapshots');
    return records.reduce((closest, current) => {
      return Math.abs(current.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? current : closest;
    });
  },

  async getChainSnapshotsByDate(dateStr) {
    return this._queryByIndex('chainSnapshots', 'date', dateStr);
  },

  // ========================================================================
  // GREEKS HISTORY
  // ========================================================================
  async saveGreeksSnapshot(strike, expiration, callGreeks, putGreeks) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      strike: strike,
      expiration: expiration,
      call: {
        delta: callGreeks.delta,
        gamma: callGreeks.gamma,
        vega: callGreeks.vega,
        theta: callGreeks.theta,
        iv: callGreeks.iv
      },
      put: {
        delta: putGreeks.delta,
        gamma: putGreeks.gamma,
        vega: putGreeks.vega,
        theta: putGreeks.theta,
        iv: putGreeks.iv
      }
    };

    return this._insert('greeksHistory', record);
  },

  async getGreeksHistory(strike, expiration, hoursBack = 1) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('greeksHistory', 'timestamp', cutoff);
    return records.filter(r => r.strike === strike && r.expiration === expiration);
  },

  // ========================================================================
  // QUERY HELPERS (used by database.html display functions)
  // ========================================================================
  async queryMVC_Recent(hoursBack = 24) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    return this._queryByRange('mvc', 'timestamp', cutoff);
  },

  async queryPremiumFlow_TopTrades(hoursBack = 1) {
    // Returns sorted by absolute total premium for the display table
    const records = await this.queryPremiumFlow_TimeSeries(hoursBack);
    return records
      .map(r => ({
        time: r.time,
        time: r.time,
        timestamp: r.timestamp,
        callFlow: r.callFlow ?? r.netCallPremium ?? 0,
        putFlow: r.putFlow ?? r.netPutPremium ?? 0,
        netFlow: r.netFlow ?? r.totalPremium ?? ((r.netCallPremium || 0) + (r.netPutPremium || 0)),
        esPrice: r.esPrice ?? r.spxPrice ?? 0
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  },

  // ========================================================================
  // UTILITIES
  // ========================================================================
  async _insert(storeName, record) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  async _queryByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) {
        resolve([]);
        return;
      }
      const request = store.index(indexName).getAll(value);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  async _queryByRange(storeName, indexName, minValue, maxValue = Date.now()) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      if (!store.indexNames.contains(indexName)) {
        resolve([]);
        return;
      }
      const range = IDBKeyRange.bound(minValue, maxValue);
      const request = store.index(indexName).getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  async _getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  },

  async _getLatestRecord(storeName) {
    const records = await this._getAllRecords(storeName);
    return records.length > 0 ? records[records.length - 1] : null;
  },

  async export() {
    const stores = ['mvc', 'premiumFlow', 'chainSnapshots', 'greeksHistory', 'buySellScores'];
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


// ============================================================================
// AUTO-INIT
// ============================================================================
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
// 3. PREMIUM FLOW — call every 1 minute from your polling loop:
//    await DB.saveMinutePremiumFlow(callFlow, putFlow, esPrice);
//
//
// 5. BZILA CHART QUERIES:
//    const pfSeries = await DB.queryPremiumFlow_TimeSeries(6);   // last 6h


