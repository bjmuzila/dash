// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA
// Stores: MVC snapshots, Premium Flow (1-min), Cumulative Delta (1-min ES), Greeks
// ============================================================================

const DB = {
  name: 'OptionsMarketDB',
  version: 2,
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

        // Store 3: Cumulative delta — 1-minute ES scalar
        if (!db.objectStoreNames.contains('cumulativeDelta')) {
          const cdStore = db.createObjectStore('cumulativeDelta', { keyPath: 'id', autoIncrement: true });
          cdStore.createIndex('timestamp', 'timestamp', { unique: false });
          cdStore.createIndex('date', 'date', { unique: false });
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
    
    // Calculate duration if start time provided
    let durationMinutes = null;
    if (timeRangeStart) {
      durationMinutes = Math.round((now.getTime() - new Date(timeRangeStart).getTime()) / 60000);
    }
    
    const record = {
      timestamp:       now.getTime(),
      date:            now.toISOString().split('T')[0],
      day:             dayName,
      time:            now.toTimeString().split(' ')[0],
      triggerType:     triggerType,
      expiration:      expiration || '—',
      strikeOIVol:     mvcOIVol.strike,
      mvcValueOIVol:   mvcOIVol.value,
      pctNetGEXOIVol:  pctOIVol,
      volumeOIVol:     mvcOIVol.volume,
      netDexStrike:    netDexStrike,
      strikeVolOnly:   mvcVolOnly.strike,
      mvcValueVolOnly: mvcVolOnly.value,
      pctNetGEXVolOnly: pctVolOnly,
      volumeVolOnly:   mvcVolOnly.volume,
      currentPrice:    currentPrice,
      totalNetGEX:     totalNetGEX,
      totalNetDEX:     totalNetDEX_OI,
      totalNetDEX_OI:  totalNetDEX_OI,
      totalNetDEX_Vol: totalNetDEX_Vol,
      timeRangeStart:  timeRangeStart ? new Date(timeRangeStart).toTimeString().split(' ')[0] : null,
      durationMinutes: durationMinutes
    };
    console.log('📊 MVC saving:', { triggerType, expiration: record.expiration, netDexStrike, totalNetDEX_OI, totalNetDEX_Vol, durationMin: durationMinutes });
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
  // CUMULATIVE DELTA — 1-MINUTE ES SCALAR
  // cvd: running cumulative volume delta for the session
  // ========================================================================
  async saveMinuteCumulativeDelta(cvd, esPrice) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      cvd: cvd,
      esPrice: esPrice
    };
    return this._insert('cumulativeDelta', record);
  },

  // Get 1-min time series for charting in bzila.html
  async queryCumulativeDelta_TimeSeries(hoursBack = 8) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('cumulativeDelta', 'timestamp', cutoff);
    return records.sort((a, b) => a.timestamp - b.timestamp);
  },

  // Get today's cumulative delta series
  async queryCumulativeDelta_Today() {
    const today = new Date().toISOString().split('T')[0];
    return this._queryByIndex('cumulativeDelta', 'date', today);
  },

  // Get latest cumulative delta value (single scalar)
  async getCumulativeDeltaLatest() {
    const records = await this._getAllRecords('cumulativeDelta');
    if (!records.length) return null;
    const today = new Date().toISOString().split('T')[0];
    const todayRecords = records.filter(r => r.date === today);
    return todayRecords.length ? todayRecords[todayRecords.length - 1] : null;
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

  async queryCumulativeDelta_Chart(hoursBack = 1) {
    return this.queryCumulativeDelta_TimeSeries(hoursBack);
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
      const index = store.index(indexName);
      const request = index.getAll(value);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  async _queryByRange(storeName, indexName, minValue, maxValue = Date.now()) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const range = IDBKeyRange.bound(minValue, maxValue);
      const request = index.getAll(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  async _getAllRecords(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  },

  async _getLatestRecord(storeName) {
    const records = await this._getAllRecords(storeName);
    return records.length > 0 ? records[records.length - 1] : null;
  },

  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  },

  async export() {
    const stores = ['mvc', 'premiumFlow', 'cumulativeDelta', 'chainSnapshots', 'greeksHistory'];
    const exported = {};
    for (const store of stores) {
      exported[store] = await this._getAllRecords(store);
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

async function queryCumulativeDelta_Chart(hoursBack = 1) {
  return DB.queryCumulativeDelta_Chart(hoursBack);
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
// 4. CUMULATIVE DELTA — call every 1 minute from your polling loop:
//    await DB.saveMinuteCumulativeDelta(cvd, esPrice);
//
// 5. BZILA CHART QUERIES:
//    const pfSeries = await DB.queryPremiumFlow_TimeSeries(6);   // last 6h
//    const cdSeries = await DB.queryCumulativeDelta_TimeSeries(8); // last 8h
