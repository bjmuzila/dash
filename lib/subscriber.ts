import type { EventEmitter } from 'events';

// Types
export interface ChainRow {
  strike: number;
  callOI: number;
  putOI: number;
  callVolume: number;
  putVolume: number;
  callGamma: number;
  putGamma: number;
  callDelta: number;
  putDelta: number;
  callGEX: number;
  putGEX: number;
  netGEX: number;
  netVolGEX: number;
  netDEX: number;
  volNetDEX: number;
  callIV: number;
  putIV: number;
  dte: number;
  spotPrice: number;
}

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

export interface SubscriberState {
  chain: ChainRow[];
  quotes: Map<string, Quote>;
  spotPrice: number;
  vix: number;
  esFutures: number;
  netGex: number;
  callWall: number | null;
  putWall: number | null;
  gexFlip: number | null;
  timestamp: number;
  isConnected: boolean;
}

type SubscriberCallback = (state: SubscriberState) => void;

class Subscriber {
  private static instance: Subscriber;
  private state: SubscriberState;
  private subscribers: Set<SubscriberCallback> = new Set();
  private wsRef: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  private constructor() {
    this.state = {
      chain: [],
      quotes: new Map(),
      spotPrice: 0,
      vix: 0,
      esFutures: 0,
      netGex: 0,
      callWall: null,
      putWall: null,
      gexFlip: null,
      timestamp: Date.now(),
      isConnected: false,
    };
  }

  static getInstance(): Subscriber {
    if (!Subscriber.instance) {
      Subscriber.instance = new Subscriber();
    }
    return Subscriber.instance;
  }

  /**
   * Initialize the subscriber: start WS connection, fetch initial chain
   */
  async init(): Promise<void> {
    // Fetch initial chain data
    await this.fetchChain();
    // Connect to WebSocket for live updates
    this.connectWebSocket();
  }

  /**
   * Fetch chain data from /api/gex
   */
  private async fetchChain(): Promise<void> {
    try {
      const res = await fetch('/api/gex', { cache: 'no-store' });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();

      this.state.chain = data.chain || [];
      this.state.spotPrice = data.spotPrice || 0;
      this.state.netGex = data.summary?.totalNetGEX || 0;
      this.state.callWall = data.callWall ?? null;
      this.state.putWall = data.putWall ?? null;
      this.state.gexFlip = data.gexFlip ?? null;
      this.state.timestamp = data.timestamp || Date.now();

      this.publish();
    } catch (err) {
      console.error('[Subscriber] fetchChain failed:', err);
    }
  }

  /**
   * Connect to WebSocket for live market data
   */
  private connectWebSocket(): void {
    const wsUrl = typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/dxlink`
      : '';

    if (!wsUrl) return;

    try {
      this.wsRef = new WebSocket(wsUrl);

      this.wsRef.onopen = () => {
        console.log('[Subscriber] WS connected');
        this.state.isConnected = true;
        this.reconnectAttempts = 0;
        this.publish();

        // Subscribe to market data
        this.wsRef?.send(
          JSON.stringify({
            type: 'subscribe',
            symbols: ['$SPX', 'SPX', '/ESU26', '/ES:XCME', 'VIX'],
            feedTypesBySymbol: {
              '$SPX': ['Quote', 'Trade', 'Summary'],
              'SPX': ['Quote', 'Trade', 'Summary'],
              '/ESU26': ['Quote', 'Trade'],
              '/ES:XCME': ['Quote', 'Trade'],
              'VIX': ['Quote', 'Trade'],
            },
          })
        );
      };

      this.wsRef.onmessage = (e) => {
        this.handleWsMessage(e.data);
      };

      this.wsRef.onclose = () => {
        console.log('[Subscriber] WS closed');
        this.state.isConnected = false;
        this.publish();
        this.attemptReconnect();
      };

      this.wsRef.onerror = (err) => {
        console.error('[Subscriber] WS error:', err);
        this.state.isConnected = false;
      };
    } catch (err) {
      console.error('[Subscriber] connectWebSocket failed:', err);
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect to WebSocket
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Subscriber] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Subscriber] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWsMessage(data: string): void {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'FEED_DATA') return;

      (msg.data as Array<Record<string, unknown>>).forEach((ev) => {
        const sym = String(ev.eventSymbol ?? '');
        const t = ev.eventType;

        if ((sym === '$SPX' || sym === 'SPX') && t === 'Quote') {
          const bid = Number(ev.bidPrice ?? 0);
          const ask = Number(ev.askPrice ?? 0);
          const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

          if (mid > 100) {
            this.state.spotPrice = mid;
            // Trigger chain refresh on SPX quote
            this.fetchChain();
          }
        }

        if ((sym === '/ESU26' || sym === '/ES:XCME') && t === 'Quote') {
          const bid = Number(ev.bidPrice ?? 0);
          const ask = Number(ev.askPrice ?? 0);
          const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;

          if (mid > 100) {
            this.state.esFutures = mid;
            this.publish();
          }
        }

        if (sym === 'VIX' && t === 'Quote') {
          const v = Number(ev.bidPrice ?? ev.lastPrice ?? 0);
          if (v > 0) {
            this.state.vix = v;
            this.publish();
          }
        }
      });
    } catch (err) {
      console.error('[Subscriber] handleWsMessage failed:', err);
    }
  }

  /**
   * Get current state snapshot
   */
  getState(): SubscriberState {
    return { ...this.state };
  }

  /**
   * Subscribe to state updates
   */
  subscribe(callback: SubscriberCallback): () => void {
    this.subscribers.add(callback);
    // Immediately call with current state
    callback(this.getState());
    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Publish state to all subscribers
   */
  private publish(): void {
    const state = this.getState();
    this.subscribers.forEach((cb) => {
      try {
        cb(state);
      } catch (err) {
        console.error('[Subscriber] callback error:', err);
      }
    });
  }

  /**
   * Manually update chain data
   */
  setChain(chain: ChainRow[]): void {
    this.state.chain = chain;
    this.state.timestamp = Date.now();
    this.publish();
  }

  /**
   * Manually update quote
   */
  setQuote(symbol: string, quote: Quote): void {
    this.state.quotes.set(symbol, quote);
    this.state.timestamp = Date.now();
    this.publish();
  }

  /**
   * Manually update net GEX
   */
  setNetGex(netGex: number): void {
    this.state.netGex = netGex;
    this.state.timestamp = Date.now();
    this.publish();
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.wsRef) {
      this.wsRef.close();
      this.wsRef = null;
    }
    this.subscribers.clear();
  }
}

export default Subscriber;
