console.log('[QM] Loading quotes-manager');

window.QuotesManager = (function() {
  const state = {
    symbols: new Set(),
    quotes: {},
    prevCloses: {},
    subscribers: [],
    wsConnected: false
  };

  function init(symbolList = []) {
    console.log('[QM] init:', symbolList);
    symbolList.forEach(s => state.symbols.add(s));
    loadPrevCloses();
    subscribeToDXLink();
    setTimeout(() => {
      if (!state.wsConnected) {
        console.log('[QM] Starting polling');
        startPolling(1000);
      }
    }, 2000);
  }

  async function loadPrevCloses() {
    try {
      const response = await fetch('/proxy/api/spx-prevclose');
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data === 'object') {
        state.prevCloses = data.prevClose ? {
          '/ES': data.prevClose,
          '/NQ': data.prevClose,
          'SPX': data.prevClose,
          'VIX': data.prevClose
        } : data;
        console.log('[QM] Prev closes loaded');
      }
    } catch (e) {
      console.warn('[QM] loadPrevCloses error:', e.message);
    }
  }

  function subscribeToDXLink() {
    try {
      const symbols = Array.from(state.symbols);
      const monitorCache = () => {
        Array.from(state.symbols).forEach(symbol => {
          const cached = window.dxQuoteCache?.[symbol];
          if (cached) {
            updateQuote({
              symbol: symbol,
              bid: cached.bidPrice || cached.bid,
              ask: cached.askPrice || cached.ask,
              last: cached.last || cached.price
            });
          }
        });
      };
      monitorCache();
      setInterval(monitorCache, 500);
      state.wsConnected = true;
      console.log('[QM] DXLink monitoring started');
    } catch (e) {
      console.warn('[QM] subscribeToDXLink error:', e.message);
    }
  }

  function updateQuote(quoteData) {
    const { symbol, bid, ask, last } = quoteData;
    if (!symbol) return;
    state.quotes[symbol] = {
      symbol,
      bid: bid || state.quotes[symbol]?.bid,
      ask: ask || state.quotes[symbol]?.ask,
      last: last || state.quotes[symbol]?.last,
      updated: Date.now()
    };
    notifySubscribers(symbol);
  }

  function getChange(symbol) {
    const quote = state.quotes[symbol];
    const prevClose = state.prevCloses[symbol];
    if (!quote || !quote.last || !prevClose) return null;
    const change = quote.last - prevClose;
    return {
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(((change / prevClose) * 100).toFixed(2)),
      up: change > 0,
      down: change < 0,
      icon: change > 0 ? '▲' : '▼'
    };
  }

  function getQuotes(filter = null) {
    const quotes = Object.values(state.quotes);
    if (!filter) return quotes;
    return quotes.filter(q => q.symbol.includes(filter));
  }

  function getQuote(symbol) {
    return state.quotes[symbol];
  }

  function subscribe(callback, filter = null) {
    const subscriber = { callback, filter };
    state.subscribers.push(subscriber);
    return () => {
      const idx = state.subscribers.indexOf(subscriber);
      if (idx > -1) state.subscribers.splice(idx, 1);
    };
  }

  function notifySubscribers(symbol) {
    const quote = state.quotes[symbol];
    const change = getChange(symbol);
    state.subscribers.forEach(sub => {
      if (sub.filter && !symbol.includes(sub.filter)) return;
      try {
        sub.callback({ symbol, quote, change });
      } catch (e) {
        console.error('[QM] Callback error:', e.message);
      }
    });
  }

  async function fetchQuotesAPI() {
    try {
      const symbols = Array.from(state.symbols);
      if (symbols.length === 0) return;

      const futures = symbols.filter(s => s.startsWith('/'));
      const equities = symbols.filter(s => !s.startsWith('/'));

      if (futures.length > 0) {
        try {
          const response = await fetch('/proxy/api/tt/quotes-batch?symbols=' + futures.join(','));
          if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data)) {
              data.forEach(q => {
                if (q && q.symbol) {
                  updateQuote({ symbol: q.symbol, bid: q.bid, ask: q.ask, last: q.last });
                }
              });
            }
          }
        } catch (e) {
          console.warn('[QM] Futures fetch error:', e.message);
        }
      }

      if (equities.length > 0) {
        for (const symbol of equities) {
          try {
            const response = await fetch('/proxy/api/instruments/equities/' + symbol);
            if (response.ok) {
              const data = await response.json();
              if (data) {
                updateQuote({
                  symbol: symbol,
                  bid: data.bid || data.bidPrice,
                  ask: data.ask || data.askPrice,
                  last: data.last || data.lastPrice || data.price
                });
              }
            }
          } catch (e) {
            console.warn('[QM] Equity fetch error for ' + symbol);
          }
        }
      }
    } catch (e) {
      console.warn('[QM] fetchQuotesAPI error:', e.message);
    }
  }

  function addSymbols(symbols) {
    if (!Array.isArray(symbols)) symbols = [symbols];
    symbols.forEach(s => state.symbols.add(s));
    if (state.wsConnected) subscribeToDXLink();
    else fetchQuotesAPI();
  }

  function startPolling(intervalMs = 1000) {
    console.log('[QM] Polling started at ' + intervalMs + 'ms');
    return setInterval(fetchQuotesAPI, intervalMs);
  }

  function getStatus() {
    return {
      wsConnected: state.wsConnected,
      symbolCount: state.symbols.size,
      symbols: Array.from(state.symbols),
      quoteCount: Object.keys(state.quotes).length,
      prevCloseCount: Object.keys(state.prevCloses).length,
      quotes: state.quotes,
      prevCloses: state.prevCloses,
      dxQuoteCacheAvailable: !!window.dxQuoteCache,
      dxQuoteCacheSymbols: window.dxQuoteCache ? Object.keys(window.dxQuoteCache).slice(0, 10) : []
    };
  }

  return {
    init, updateQuote, getQuote, getQuotes, getChange, subscribe,
    addSymbols, fetchQuotesAPI, startPolling, getStatus, loadPrevCloses
  };
})();

console.log('[QM] QuotesManager ready:', !!window.QuotesManager);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      console.log('[QM] Auto-init');
      window.QuotesManager.init(['/ES', '/NQ', 'SPX', 'VIX', 'QQQ', 'SRM', 'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA']);
    }, 500);
  });
} else {
  setTimeout(() => {
    console.log('[QM] Auto-init (ready)');
    window.QuotesManager.init(['/ES', '/NQ', 'SPX', 'VIX', 'QQQ', 'SRM', 'AAPL', 'AMD', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA']);
  }, 500);
}

console.log('[QM] Script finished');
