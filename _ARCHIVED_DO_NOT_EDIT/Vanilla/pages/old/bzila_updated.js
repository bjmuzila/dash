  (function() {
    'use strict';

    // ════════════════════════════════════════════════════════════════════════════════════
    // MULTI-STOCK FLOW TRACKING - Nearest expiration, OTM only, 1-minute saves
    // ════════════════════════════════════════════════════════════════════════════════════

    const SYMBOLS = ['QQQ', 'SPY', 'AAPL', 'AMZN', 'GOOGL', 'META', 'MSFT', 'NVDA'];

    // Per-stock state: nearest expiration + flow tracking
    const multiStockState = {
      // Each stock gets { nearestExp: 'YYYY-MM-DD', callFlow: $, putFlow: $, netFlow: $, price: $ }
      QQQ: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      SPY: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      AAPL: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      AMZN: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      GOOGL: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      META: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      MSFT: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
      NVDA: { nearestExp: null, callFlow: 0, putFlow: 0, netFlow: 0, price: 0 },
    };

    // Track chart data per symbol for rendering
    const multiStockCharts = {
      QQQ: { callHistory: [], putHistory: [], netHistory: [] },
      SPY: { callHistory: [], putHistory: [], netHistory: [] },
      AAPL: { callHistory: [], putHistory: [], netHistory: [] },
      AMZN: { callHistory: [], putHistory: [], netHistory: [] },
      GOOGL: { callHistory: [], putHistory: [], netHistory: [] },
      META: { callHistory: [], putHistory: [], netHistory: [] },
      MSFT: { callHistory: [], putHistory: [], netHistory: [] },
      NVDA: { callHistory: [], putHistory: [], netHistory: [] },
    };

    // ════════════════════════════════════════════════════════════════════════════════════
    // FIND NEAREST EXPIRATION for a given stock
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
    // CALCULATE OTM PREMIUM FLOW (calls > strike, puts < strike only)
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
        const premium = mid * vol * 100; // Price × Vol × 100 (per option contract)

        if (leg.type === 'call' && leg.strike > stockPrice) {
          // OTM call
          callPremium += premium;
        } else if (leg.type === 'put' && leg.strike < stockPrice) {
          // OTM put
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
    // Called whenever options data arrives or stock price updates
    // ════════════════════════════════════════════════════════════════════════════════════
    window.updateMultiStockFlow = function(symbol, stockPrice) {
      if (!multiStockState[symbol]) return;

      // Update stock price
      multiStockState[symbol].price = stockPrice;

      // Find nearest expiration
      const nearestExp = findNearestExpiration(symbol);
      if (nearestExp !== multiStockState[symbol].nearestExp) {
        multiStockState[symbol].nearestExp = nearestExp;
        // Reset flow on expiration change
        multiStockState[symbol].callFlow = 0;
        multiStockState[symbol].putFlow = 0;
        multiStockState[symbol].netFlow = 0;
      }

      if (nearestExp) {
        const flow = calculateOTMPremiumFlow(symbol, nearestExp);
        multiStockState[symbol].callFlow = flow.callFlow;
        multiStockState[symbol].putFlow = flow.putFlow;
        multiStockState[symbol].netFlow = flow.netFlow;
      }

      // Update UI labels
      updateMultiStockLabels(symbol);
      renderMultiStockChart(symbol);
    };

    // ════════════════════════════════════════════════════════════════════════════════════
    // UPDATE UI LABELS for each multi-stock card
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
    // RENDER MULTI-STOCK CHART (call, put, net premium over time)
    // ════════════════════════════════════════════════════════════════════════════════════
    function renderMultiStockChart(symbol) {
      const canvas = document.querySelector(`.multi-stock-card[data-symbol="${symbol}"] .stock-premium-canvas`);
      if (!canvas || !canvas.offsetHeight) return;

      const ctx = canvas.getContext('2d');
      const chart = multiStockCharts[symbol];
      const state = multiStockState[symbol];

      // Clear canvas
      ctx.fillStyle = '#0d1520';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const w = canvas.width / window.devicePixelRatio || canvas.width;
      const h = canvas.height / window.devicePixelRatio || canvas.height;
      const padding = 30;
      const graphW = w - 2 * padding;
      const graphH = h - 2 * padding;

      // Get data (use the 3 lines: call, put, net)
      const callData = chart.callHistory;
      const putData = chart.putHistory;
      const netData = chart.netHistory;
      if (callData.length === 0) return;

      // Y-axis bounds
      const allValues = [...callData, ...putData, ...netData].filter(v => typeof v === 'number');
      const minVal = Math.min(...allValues, 0);
      const maxVal = Math.max(...allValues, 1000);
      const range = maxVal - minVal || 1;
      const yAt = (i, val) => padding + graphH - (graphH * (val - minVal) / range);

      // X-axis
      const xAt = (i) => padding + (graphW * i / (callData.length - 1 || 1));

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

      // Draw call line (green)
      drawLine(ctx, callData, xAt, yAt, '#22c55e', 1.5);

      // Draw put line (red)
      drawLine(ctx, putData, xAt, yAt, '#ef4444', 1.5);

      // Draw net line (yellow, dashed)
      ctx.setLineDash([4, 4]);
      drawLine(ctx, netData, xAt, yAt, '#fbbf24', 2);
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
        const y = yAt(i, val);
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
    // SNAPSHOT MULTI-STOCK FLOW EVERY MINUTE and save to database
    // ════════════════════════════════════════════════════════════════════════════════════
    let multiStockMinuteInterval = null;
    window.startMultiStockFlowTracking = function() {
      if (multiStockMinuteInterval) clearInterval(multiStockMinuteInterval);

      multiStockMinuteInterval = setInterval(async () => {
        const now = new Date();
        const fourPM = new Date();
        fourPM.setHours(16, 0, 0, 0);
        const nineAM = new Date();
        nineAM.setHours(9, 0, 0, 0);

        // Only save during market hours (9 AM - 4 PM ET)
        if (now < nineAM || now >= fourPM) return;

        for (const symbol of SYMBOLS) {
          const state = multiStockState[symbol];
          const exp = state.nearestExp;
          if (!exp) continue;

          try {
            await DB.saveMultiStockFlow({
              stock: symbol,
              dte: calculateDTE(exp),
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
      }, 60 * 1000); // Every minute
    };

    // ════════════════════════════════════════════════════════════════════════════════════
    // CALCULATE DTE from expiration date
    // ════════════════════════════════════════════════════════════════════════════════════
    function calculateDTE(expString) {
      const exp = new Date(expString);
      const now = new Date();
      const diffMs = exp - now;
      return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    // ════════════════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ════════════════════════════════════════════════════════════════════════════════════
    window.stopMultiStockFlowTracking = function() {
      if (multiStockMinuteInterval) {
        clearInterval(multiStockMinuteInterval);
        multiStockMinuteInterval = null;
      }
    };

    // ════════════════════════════════════════════════════════════════════════════════════
    // EXPORT for integration with TastyTrade flow updates
    // ════════════════════════════════════════════════════════════════════════════════════
    window.__multiStockState = multiStockState;
    window.__multiStockCharts = multiStockCharts;
  })();
