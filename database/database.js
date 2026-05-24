// ============================================================================
// TIME-SERIES DATABASE FOR OPTIONS MARKET DATA
// Stores: MVC snapshots, Premium Flow, Cumulative Delta, Greeks at intervals
// ============================================================================

const DB = {
  name: 'OptionsMarketDB',
  version: 1,
  db: null,
  
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
        console.log('Creating database schema...');
        
        // Store 1: MVC snapshots (timestamp, strike, OI+Vol, Vol-only)
        if (!db.objectStoreNames.contains('mvc')) {
          const mvcStore = db.createObjectStore('mvc', { keyPath: 'id', autoIncrement: true });
          mvcStore.createIndex('timestamp', 'timestamp', { unique: false });
          mvcStore.createIndex('date', 'date', { unique: false });
        }
        
        // Store 2: Premium flow (cumulative buy/sell volume by strike/expiration)
        if (!db.objectStoreNames.contains('premiumFlow')) {
          const pfStore = db.createObjectStore('premiumFlow', { keyPath: 'id', autoIncrement: true });
          pfStore.createIndex('timestamp', 'timestamp', { unique: false });
          pfStore.createIndex('expiration', 'expiration', { unique: false });
        }
        
        // Store 3: Cumulative delta (running sum of delta by strike)
        if (!db.objectStoreNames.contains('cumulativeDelta')) {
          const cdStore = db.createObjectStore('cumulativeDelta', { keyPath: 'id', autoIncrement: true });
          cdStore.createIndex('timestamp', 'timestamp', { unique: false });
          cdStore.createIndex('strike', 'strike', { unique: false });
        }
        
        // Store 4: Full options chain snapshots (every N minutes)
        if (!db.objectStoreNames.contains('chainSnapshots')) {
          const snapStore = db.createObjectStore('chainSnapshots', { keyPath: 'id', autoIncrement: true });
          snapStore.createIndex('timestamp', 'timestamp', { unique: false });
          snapStore.createIndex('date', 'date', { unique: false });
        }
        
        // Store 5: Greeks history (delta, gamma, vega, theta changes)
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
  // ========================================================================
  async saveMVCSnapshot(mvcOIVol, mvcVolOnly, currentPrice) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().split(' ')[0],
      strikeOIVol: mvcOIVol.strike,
      mvcValueOIVol: mvcOIVol.value,
      volumeOIVol: mvcOIVol.volume,
      strikeVolOnly: mvcVolOnly.strike,
      mvcValueVolOnly: mvcVolOnly.value,
      volumeVolOnly: mvcVolOnly.volume,
      currentPrice: currentPrice
    };
    
    return this._insert('mvc', record);
  },
  
  async getMVCHistory(daysBack = 5) {
    const cutoff = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
    return this._queryByRange('mvc', 'timestamp', cutoff);
  },
  
  async getMVCByDate(dateStr) {
    return this._queryByIndex('mvc', 'date', dateStr);
  },
  
  // ========================================================================
  // PREMIUM FLOW (BUY/SELL VOLUME TRACKING)
  // ========================================================================
  async savePremiumFlow(strike, expiration, callVolume, putVolume, callDirection, putDirection) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      strike: strike,
      expiration: expiration,
      callVolume: callVolume,
      putVolume: putVolume,
      callDirection: callDirection,  // 'buy' | 'sell'
      putDirection: putDirection,
      netFlow: (callVolume * (callDirection === 'buy' ? 1 : -1)) + 
               (putVolume * (putDirection === 'buy' ? 1 : -1)),
      totalVolume: callVolume + putVolume
    };
    
    return this._insert('premiumFlow', record);
  },
  
  async getPremiumFlowByExpiration(expiration, hoursBack = 1) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('premiumFlow', 'timestamp', cutoff);
    return records.filter(r => r.expiration === expiration);
  },
  
  async getPremiumFlowAggregated(hoursBack = 1) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('premiumFlow', 'timestamp', cutoff);
    
    // Group by strike + expiration, sum volumes
    const map = {};
    records.forEach(r => {
      const key = `${r.strike}_${r.expiration}`;
      if (!map[key]) map[key] = { strike: r.strike, expiration: r.expiration, flow: 0, volume: 0 };
      map[key].flow += r.netFlow;
      map[key].volume += r.totalVolume;
    });
    
    return Object.values(map).sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow));
  },
  
  // ========================================================================
  // CUMULATIVE DELTA
  // ========================================================================
  async saveCumulativeDelta(strike, callDelta, putDelta, cumulativeSum) {
    const now = new Date();
    const record = {
      timestamp: now.getTime(),
      date: now.toISOString().split('T')[0],
      strike: strike,
      callDelta: callDelta,
      putDelta: putDelta,
      netDelta: callDelta + putDelta,
      cumulativeSum: cumulativeSum
    };
    
    return this._insert('cumulativeDelta', record);
  },
  
  async getCumulativeDeltaHistory(strike, hoursBack = 1) {
    const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
    const records = await this._queryByRange('cumulativeDelta', 'timestamp', cutoff);
    return records.filter(r => r.strike === strike);
  },
  
  async getCumulativeDeltaSnapshot() {
    // Get latest cumulative delta for all strikes
    const records = await this._getAllRecords('cumulativeDelta');
    const latestByStrike = {};
    
    records.forEach(r => {
      if (!latestByStrike[r.strike] || r.timestamp > latestByStrike[r.strike].timestamp) {
        latestByStrike[r.strike] = r;
      }
    });
    
    return Object.values(latestByStrike);
  },
  
  // ========================================================================
  // CHAIN SNAPSHOTS (FULL OPTIONS CHAIN AT POINT IN TIME)
  // ========================================================================
  async saveChainSnapshot(chainData, intervalMinutes = 5) {
    // Only save if enough time has passed since last save
    const lastSnapshot = await this._getLatestRecord('chainSnapshots');
    if (lastSnapshot && (Date.now() - lastSnapshot.timestamp) < (intervalMinutes * 60 * 1000)) {
      return; // Skip, too recent
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
    // Find closest snapshot to given timestamp
    return records.reduce((closest, current) => {
      const currentDiff = Math.abs(current.timestamp - timestamp);
      const closestDiff = Math.abs(closest.timestamp - timestamp);
      return currentDiff < closestDiff ? current : closest;
    });
  },
  
  async getChainSnapshotsByDate(dateStr) {
    return this._queryByIndex('chainSnapshots', 'date', dateStr);
  },
  
  // ========================================================================
  // GREEKS HISTORY (TRACK CHANGES OVER TIME)
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

// Auto-init on load
window.addEventListener('DOMContentLoaded', () => {
  DB.init().then(() => {
    console.log('✓ Market data database ready');
    window.dispatchEvent(new CustomEvent('db-ready'));
  }).catch(err => {
    console.error('✗ Database initialization failed:', err);
  });
});
