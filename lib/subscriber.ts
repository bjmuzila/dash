import { getClientWsUrl, isLiveFeedReady } from '@/lib/clientRuntime';
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
  netVanna?: number;
  netVolVanna?: number;
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

const ES_SYMBOL_ALIASES = ['/ESU26', '/ESU6', '/ES:XCME', '/ES'];

class Subscriber {
  private static instance: Subscriber;
  private state: SubscriberState;
  private subscribers: Set<SubscriberCallback> = new Set();
  private wsRef: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20; // keep retrying indefinitely
  private reconnectDelay = 2000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastChainFetch = 0;
  private readonly CHAIN_THROTTLE_MS = 20000; // max one chain fetch per 20s

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
    // Already initialized — don't re-init the singleton
    if (this.heartbeatTimer !== null) return;
    // Fetch quotes first so top bar shows live prices immediately
    await Promise.all([this.fetchQuotes(), this.fetchChain()]);
    void this.connectWebSocket();
    // Poll quotes every 15s and chain every 30s regardless of WS
    this.heartbeatTimer = setInterval(() => {
      this.fetchQuotes();
      const s = this.wsRef?.readyState;
      if (s !== WebSocket.OPEN && s !== WebSocket.CONNECTING) {
        this.reconnectAttempts = 0;
        void this.connectWebSocket();
      }
    }, 15000);
    // Chain poll every 30s
    setInterval(() => this.fetchChain(), 30000);
  }

  /**
   * Fetch SPX, VIX, ES prices from quotes-batch REST endpoint
   */
  private async fetchQuotes(): Promise<void> {
    try {
      const res = await fetch(`/api/quotes-batch?symbols=${encodeURIComponent(['SPX', 'VIX', ...ES_SYMBOL_ALIASES].join(','))}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const items: Array<Record<string, unknown>> = data?.data?.items ?? [];
      let changed = false;
      for (const q of items) {
        const sym = String(q.symbol ?? '');
        const last = Number(q.last ?? q.mark ?? 0);
        const prev = Number(q['prev-close'] ?? q['day-close'] ?? 0);
        const pct  = prev > 0 ? ((last - prev) / prev) * 100 : 0;
        if (sym === 'SPX' && last > 100) {
          this.state.spotPrice = last;
          changed = true;
        }
        if (sym === 'VIX' && last > 0) {
          this.state.vix = last;
          changed = true;
        }
        if (ES_SYMBOL_ALIASES.includes(sym) && last > 100) {
          this.state.esFutures = last;
          changed = true;
        }
      }
      if (changed) this.publish();
    } catch (_) {}
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
      // Only overwrite spotPrice if proxy returned a valid value
      if (data.spotPrice > 100) this.state.spotPrice = data.spotPrice;
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
  private async connectWebSocket(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (this.wsRef && (this.wsRef.readyState === WebSocket.OPEN || this.wsRef.readyState === WebSocket.CONNECTING)) return;

    const ready = await isLiveFeedReady();
    if (!ready) {
      this.attemptReconnect();
      return;
    }

    const wsUrl = getClientWsUrl();

    if (!wsUrl) return;

    try {
      this.wsRef = new WebSocket(wsUrl);

      this.wsRef.onopen = () => {
        this.state.isConnected = true;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.publish();

        // Subscribe to market data — all ES/NQ aliases so we catch whatever the relay emits
        const coreSymbols = [
          '$SPX', 'SPX',
          '/ESU26', '/ESU6', '/ES:XCME', '/ES',
          '/NQU26', '/NQU6', '/NQ:XCME',
          'VIX',
        ];
        this.wsRef?.send(
          JSON.stringify({
            type: 'FEED_SUBSCRIPTION',
            add: coreSymbols.flatMap(s => [
              { type: 'Quote',   symbol: s },
              { type: 'Trade',   symbol: s },
              { type: 'Summary', symbol: s },
            ]),
          })
        );
      };

      this.wsRef.onmessage = (e) => {
        this.handleWsMessage(e.data);
      };

      this.wsRef.onclose = () => {
        this.wsRef = null;
        this.state.isConnected = false;
        this.publish();
        this.attemptReconnect();
      };

      this.wsRef.onerror = () => {
        this.state.isConnected = false;
        this.wsRef?.close();
      };
    } catch (err) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect to WebSocket
   */
  private attemptReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    // Cap backoff at 30s, keep retrying forever
    const delay = Math.min(this.reconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)), 30000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket();
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

        const isSpx = sym === '$SPX' || sym === 'SPX' || sym === 'SPX:XCIS';
        const isEs  = sym.startsWith('/ES');
        const isNq  = sym.startsWith('/NQ');
        const isVix = sym === 'VIX' || sym === 'VIX:XCIS' || sym === '$VIX';

        if (isSpx && (t === 'Quote' || t === 'Trade')) {
          const bid  = Number(ev.bidPrice  ?? 0);
          const ask  = Number(ev.askPrice  ?? 0);
          const last = Number((ev as Record<string, unknown>).price ?? (ev as Record<string, unknown>).lastPrice ?? 0);
          const mid  = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;

          if (mid > 100) {
            this.state.spotPrice = mid;
            this.publish();
            // Throttle chain refresh — at most once per 20s
            if (Date.now() - this.lastChainFetch > this.CHAIN_THROTTLE_MS) {
              this.lastChainFetch = Date.now();
              this.fetchChain();
            }
          }
        }

        if (isEs && (t === 'Quote' || t === 'Trade')) {
          const bid  = Number(ev.bidPrice  ?? 0);
          const ask  = Number(ev.askPrice  ?? 0);
          const last = Number((ev as Record<string, unknown>).price ?? (ev as Record<string, unknown>).lastPrice ?? 0);
          const mid  = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;

          if (mid > 100) {
            this.state.esFutures = mid;
            this.publish();
          }
        }

        if (isVix && (t === 'Quote' || t === 'Trade')) {
          const bid  = Number(ev.bidPrice  ?? 0);
          const last = Number((ev as Record<string, unknown>).price ?? (ev as Record<string, unknown>).lastPrice ?? 0);
          const v    = bid > 0 ? bid : last;
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
   * Disconnect and cleanup — only call on full app shutdown.
   * Components should use the unsubscribe fn returned by subscribe() instead.
   */
  disconnect(): void {
    // No-op: singleton WS stays alive across component unmounts
    // to prevent reconnect churn when navigating between pages.
  }
}

export default Subscriber;
