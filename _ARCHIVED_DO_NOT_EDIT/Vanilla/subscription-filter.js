/**
 * Per-Client Subscription Filter
 *
 * Tracks which client (WS connection) subscribed to which symbols.
 * Filters broadcast messages so each client only receives data for symbols they requested.
 *
 * Usage:
 *   const filter = new SubscriptionFilter();
 *
 *   // When client subscribes:
 *   filter.addClientSubscription(ws.id, ['SPX', 'VIX', 'SPXW260620C5800']);
 *
 *   // When client disconnects:
 *   filter.removeClient(ws.id);
 *
 *   // When broadcasting FEED_DATA:
 *   if (filter.shouldBroadcast(symbol, ws.id)) {
 *     ws.send(msg);
 *   }
 */

class SubscriptionFilter {
  constructor() {
    this.clientSubscriptions = new Map(); // wsId -> Set<symbol>
    this.symbolToClients = new Map();     // symbol -> Set<wsId> (reverse lookup for stats)
    this.clientCount = 0;
  }

  /**
   * Register a client (call when WS connects)
   */
  registerClient(wsId) {
    if (!this.clientSubscriptions.has(wsId)) {
      this.clientSubscriptions.set(wsId, new Set());
      this.clientCount++;
    }
  }

  /**
   * Add symbols to a client's subscription list
   */
  addClientSubscription(wsId, symbols) {
    this.registerClient(wsId);
    const clientSubs = this.clientSubscriptions.get(wsId);

    symbols.forEach(sym => {
      const normalized = String(sym || '').trim().toUpperCase();
      clientSubs.add(normalized);

      // Update reverse lookup
      if (!this.symbolToClients.has(normalized)) {
        this.symbolToClients.set(normalized, new Set());
      }
      this.symbolToClients.get(normalized).add(wsId);
    });
  }

  /**
   * Remove client from all subscriptions (call on disconnect)
   */
  removeClient(wsId) {
    const subs = this.clientSubscriptions.get(wsId);
    if (subs) {
      subs.forEach(sym => {
        const clients = this.symbolToClients.get(sym);
        if (clients) {
          clients.delete(wsId);
          if (clients.size === 0) {
            this.symbolToClients.delete(sym);
          }
        }
      });
      this.clientSubscriptions.delete(wsId);
      this.clientCount--;
    }
  }

  /**
   * Check if a client is subscribed to a symbol
   */
  isSubscribed(wsId, symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    const subs = this.clientSubscriptions.get(wsId);
    return subs ? subs.has(normalized) : false;
  }

  /**
   * Get all clients subscribed to a symbol
   */
  getClientsForSymbol(symbol) {
    const normalized = String(symbol || '').trim().toUpperCase();
    return this.symbolToClients.get(normalized) || new Set();
  }

  /**
   * Check if symbol should be broadcast to client
   */
  shouldBroadcast(symbol, wsId) {
    if (!wsId || !symbol) return false;
    return this.isSubscribed(wsId, symbol);
  }

  /**
   * Get subscription stats for logging
   */
  getStats() {
    return {
      totalClients: this.clientCount,
      totalSymbols: this.symbolToClients.size,
      avgSymbolsPerClient: this.clientCount > 0
        ? Math.round([...this.clientSubscriptions.values()].reduce((sum, set) => sum + set.size, 0) / this.clientCount)
        : 0,
      symbols: [...this.symbolToClients.keys()].sort(),
    };
  }

  /**
   * Log current state (for debugging)
   */
  log(label = '') {
    const stats = this.getStats();
    console.log(`[SubscriptionFilter] ${label}`, {
      clients: stats.totalClients,
      symbols: stats.totalSymbols,
      avgPerClient: stats.avgSymbolsPerClient,
    });
  }

  /**
   * Clear all subscriptions (for testing/reset)
   */
  clear() {
    this.clientSubscriptions.clear();
    this.symbolToClients.clear();
    this.clientCount = 0;
  }
}

module.exports = SubscriptionFilter;
