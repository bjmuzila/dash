// ═══════════════════════════════════════════════════════════════════════════════════
// MULTI-STOCK FLOW TRACKER - Uses DX WebSocket for Quote data
// ═══════════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const SYMBOLS = ['QQQ', 'SPY', 'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA'];

  // Per-stock state
  const multiStockState = {
    QQQ: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    SPY: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    AAPL: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    AMZN: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    GOOGL: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    META: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    MSFT: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    NVDA: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
  };

  // Chart data
  const multiStockCharts = {
    QQQ: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    SPY: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    AAPL: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    AMZN: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    GOOGL: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    META: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    MSFT: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
    NVDA: { callHistory: [], putHistory: [], netHistory: [], timestamps: [] },
  };

  let dxWs = null;
  let multiStockMinuteInterval = null;

  // ════════════════════════════════════════════════════════════════════════════════════
  // CONNECT TO DX WEBSOCKET
  // ════════════════════════════════════════════════════════════════════════════════════
  window.connectMultiStockDxWebSocket = function() {
    return new Promise((resolve, reject) => {
      // Determine WebSocket URL based on environment
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}/ws/dxlink`;

      dxWs = new WebSocket(url);

      dxWs.onopen = () => {
        console.log('✓ Multi-stock DX WebSocket connected');

        // Subscribe to Quote updates for all tracked symbols
        dxWs.send(JSON.stringify({
          type: 'subscribe',
          symbols: SYMBOLS
        }));

        resolve();
      };

      dxWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleDxMessage(msg);
        } catch (e) {
          console.error('DX message parse error:', e);
        }
      };

      dxWs.onerror = (err) => {
        console.error('Multi-stock DX WS error:', err);
        reject(err);
      };

      dxWs.onclose = () => {
        console.log('Multi-stock DX WS closed, reconnecting in 5s...');
        setTimeout(() => {
          window.connectMultiStockDxWebSocket().catch(e => console.error('Reconnect failed:', e));
        }, 5000);
      };

      // Timeout if not connected after 10s
      setTimeout(() => {
        if (dxWs.readyState !== WebSocket.OPEN) {
          reject(new Error('DX WebSocket connection timeout'));
        }
      }, 10000);
    });
  };

  // ════════════════════════════════════════════════════════════════════════════════════
  // HANDLE DX WEBSOCKET MESSAGES
  // ════════════════════════════════════════════════════════════════════════════════════
  function handleDxMessage(msg) {
    // DX sends Quote events with structure:
    // { type: 'Quote', symbol: 'AAPL', bid: 225.40, ask: 225.50, last: 225.45, ... }
    // or { type: 'Trade', symbol: 'AAPL', price: 225.45, ... }

    if (!msg.type || !msg.symbol) return;

    const symbol = msg.symbol.toUpperCase();
    if (!SYMBOLS.includes(symbol)) return;

    // Extract price (Quote.last or Trade.price)
    let price = null;
    if (msg.type === 'Quote' && msg.last) {
      price = msg.last;
    } else if (msg.type === 'Trade' && msg.price) {
      price = msg.price;
    }

    if (price && price > 0) {
      updateMultiStockFlow(symbol, price);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // FIND NEAREST EXPIRATION
  // ════════════════════════════════════════════════════════════════════════════════════
  function findNearestExpiration(symbol) {
    const options = window.__allOptionsData || {};
    const symbolData = options[symbol];
    if (!symbolData || !symbolData.expirations || !Array.isArray(symbolData.expirations)) {
      return null;
    }

    const today = new Date();
    const futureExpirations = symbolData.expirations
      .filter(exp => new Date(exp) > today)
      .sort((a, b) => new Date(a) - new Date(b));

    return futureExpirations.length > 0 ? futureExpirations[0] : null;
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // CALCULATE OTM PREMIUM FLOW
  // ════════════════════════════════════════════════════════════════════════════════════
  function calculateOTMPremiumFlow(symbol, expiration) {
    const options = window.__allOptionsData || {};
    const chain = options[symbol]?.[expiration];
    if (!chain || !Array.isArray(chain)) return { callFlow: 0, putFlow: 0, netFlow: 0 };

    const stockPrice = multiStockState[symbol].price || 0;
    let callPremium = 0;
    let putPremium = 0;

    chain.forEach(leg => {
      if (!leg.bid || !leg.ask) return;
      const mid = (leg.bid + leg.ask) / 2;
      const vol = leg.open_interest || 0;
      const premium = mid * vol * 100;

      if (leg.type === 'call' && leg.strike > stockPrice) {
        callPremium += premium;
      } else if (leg.type === 'put' && leg.strike < stockPrice) {
        putPremium += premium;
      }
    });

    return {
      callFlow: callPremium,
      putFlow: putPremium,
      netFlow: callPremium + putPremium
    };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // UPDATE MULTI-STOCK FLOW STATE
  // ════════════════════════════════════════════════════════════════════════════════════
  function updateMultiStockFlow(symbol, stockPrice) {
    if (!multiStockState[symbol]) return;

    multiStockState[symbol].price = stockPrice;

    const nearestExp = findNearestExpiration(symbol);
    if (nearestExp !== multiStockState[symbol].nearestExp) {
      multiStockState[symbol].nearestExp = nearestExp;
      multiStockState[symbol].callFlow = 0;
      multiStockState[symbol].putFlow = 0;
      multiStockState[symbol].netFlow = 0;
    }

    if (nearestExp) {
      const flow = calculateOTMPremiumFlow(symbol, nearestExp);
      multiStockState[symbol].callFlow = flow.callFlow;
      multiStockState[symbol].putFlow = flow.putFlow;
      multiStockState[symbol].netFlow = flow.netFlow;

      // Add to chart history (keep last 60 data points)
      const chart = multiStockCharts[symbol];
      chart.callHistory.push(flow.callFlow);
      chart.putHistory.push(flow.putFlow);
      chart.netHistory.push(flow.netFlow);
      chart.timestamps.push(Date.now());

      if (chart.callHistory.length > 60) {
        chart.callHistory.shift();
        chart.putHistory.shift();
        chart.netHistory.shift();
        chart.timestamps.shift();
      }
    }

    updateMultiStockLabels(symbol);
    renderMultiStockChart(symbol);
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // UPDATE UI LABELS
  // ════════════════════════════════════════════════════════════════════════════════════
  function updateMultiStockLabels(symbol) {
    const card = document.querySelector(`.multi-stock-card[data-symbol="${symbol}"]`);
    if (!card) return;

    const state = multiStockState[symbol];
    const callEl = card.querySelector('.stock-call-flow');
    const putEl = card.querySelector('.stock-put-flow');

    if (callEl) callEl.textContent = fmtMoney(state.callFlow);
    if (putEl) putEl.textContent = fmtMoney(state.putFlow);
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // RENDER CHART
  // ════════════════════════════════════════════════════════════════════════════════════
  function renderMultiStockChart(symbol) {
    const canvas = document.querySelector(`.multi-stock-card[data-symbol="${symbol}"] .stock-premium-canvas`);
    if (!canvas || !canvas.offsetHeight) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const chart = multiStockCharts[symbol];

    if (chart.callHistory.length === 0) return;

    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const padding = 25;
    const graphW = w - 2 * padding;
    const graphH = h - 2 * padding;

    // Clear
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, w, h);

    // Y-axis bounds
    const allValues = [...chart.callHistory, ...chart.putHistory, ...chart.netHistory].filter(v => typeof v === 'number');
    const minVal = Math.min(...allValues, 0);
    const maxVal = Math.max(...allValues, 1000);
    const range = maxVal - minVal || 1;

    const yAt = (val) => padding + graphH - (graphH * (val - minVal) / range);
    const xAt = (i) => padding + (graphW * i / (chart.callHistory.length - 1 || 1));

    // Draw grid
    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (graphH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(padding + graphW, y);
      ctx.stroke();
    }

    // Draw lines
    drawLine(ctx, chart.callHistory, xAt, yAt, '#22c55e', 1.5);
    drawLine(ctx, chart.putHistory, xAt, yAt, '#ef4444', 1.5);
    ctx.setLineDash([4, 4]);
    drawLine(ctx, chart.netHistory, xAt, yAt, '#fbbf24', 2);
    ctx.setLineDash([]);

    // Draw axes
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + graphH);
    ctx.lineTo(padding + graphW, padding + graphH);
    ctx.stroke();
  }

  function drawLine(ctx, data, xAt, yAt, color, width) {
    if (data.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    data.forEach((val, i) => {
      if (typeof val !== 'number') return;
      const x = xAt(i);
      const y = yAt(val);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // SAVE TO DATABASE EVERY MINUTE
  // ════════════════════════════════════════════════════════════════════════════════════
  window.startMultiStockFlowSaves = function() {
    if (multiStockMinuteInterval) clearInterval(multiStockMinuteInterval);

    multiStockMinuteInterval = setInterval(async () => {
      const now = new Date();
      const fourPM = new Date();
      fourPM.setHours(16, 0, 0, 0);
      const nineAM = new Date();
      nineAM.setHours(9, 0, 0, 0);

      // Only save during market hours
      if (now < nineAM || now >= fourPM) return;

      for (const symbol of SYMBOLS) {
        const state = multiStockState[symbol];
        const exp = state.nearestExp;
        if (!exp) continue;

        try {
          const dte = Math.ceil((new Date(exp) - now) / (1000 * 60 * 60 * 24));
          await DB.saveMultiStockFlow({
            stock: symbol,
            dte: dte,
            timestamp: now.getTime(),
            callFlow: state.callFlow,
            putFlow: state.putFlow,
            netFlow: state.netFlow,
            price: state.price
          });
        } catch (e) {
          console.error(`Error saving ${symbol} flow:`, e);
        }
      }
    }, 60 * 1000);
  };

  window.stopMultiStockFlowSaves = function() {
    if (multiStockMinuteInterval) {
      clearInterval(multiStockMinuteInterval);
      multiStockMinuteInterval = null;
    }
  };

  // ════════════════════════════════════════════════════════════════════════════════════
  // EXPORT
  // ════════════════════════════════════════════════════════════════════════════════════
  window.__multiStockState = multiStockState;
  window.__multiStockCharts = multiStockCharts;
})();
