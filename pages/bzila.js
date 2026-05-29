  (function() {
    'use strict';

    const PRICE_BUCKET_ES = 0.50;
    const PRICE_BUCKET_NQ = 2.00;
    const ES_REST_SYMBOL = '/ESM6';
    const NQ_REST_SYMBOL = '/NQM6';
    const ES_STREAM_SYMBOL = '/ESM26:XCME';
    const NQ_STREAM_SYMBOL = '/NQM26:XCME';

    // State
    const defaultState = {
      esMinSize: 100,
      nqMinSize: 50,
      fadeMinutes: 15,
      esPrice: 5900.00,
      nqPrice: 20800.00,
      esTrades: [],
      nqTrades: [],
      ws: null,
      connected: false,
      // SPX 0DTE Premium Flow state
      spxPrice: 0,
      callPremiumFlow: 0,    // Cumulative OTM call net drift ($)
      putPremiumFlow: 0,     // Cumulative OTM put net drift, visually inverted ($)
      netPremiumFlow: 0,     // Call drift + inverted put drift
      flowHistory: [],       // [{ts, call, put, net, spx}] - snapshots for chart
      lastFlowCross: null,
      // SPX option quotes cache (for NBBO lookup at trade time)
      spxQuotes: {},         // symbol -> {bid, ask, ts}
      futureQuotes: {},      // symbol -> {bid, ask, ts}
      lastTradeBySymbol: {}, // symbol -> last trade price for side fallback
      // Pan/zoom state
      chartPan: 0,           // Offset in data points (left/right drag)
      chartZoom: 1,          // Scale factor (1 = all data, >1 = zoomed in)
      // Multi-stock flow history (0DTE OTM)
      multiStockFlowHistory: {
        QQQ: [], SPY: [], AAPL: [], AMZN: [],
        GOOGL: [], META: [], MSFT: [], NVDA: [], TSLA: []
      },
      // Flow feed (from proxy aggregator)
      flowOrders: [],        // All orders from proxy
      minPremiumFilter: 50000,
      sweepOnlyFilter: false
    };
    const state = window.__bzilaFlowState || defaultState;
    window.__bzilaFlowState = state;
    if (!state.dbMinuteBaseline) {
      state.dbMinuteBaseline = {
        callPremiumFlow: state.callPremiumFlow || 0,
        putPremiumFlow: state.putPremiumFlow || 0
      };
    }

    // Elements
    const elements = {
      status: document.getElementById('bzila-status'),
      // SPX Premium Flow
      premiumCanvas: document.getElementById('bzila-premium-canvas'),
      callFlow: document.getElementById('bzila-call-flow'),
      putFlow: document.getElementById('bzila-put-flow'),
      netFlow: document.getElementById('bzila-net-flow'),
      // Multi-Stock Flow Feed
      flowFeed: document.getElementById('bzila-flow-feed'),
      minPremiumSlider: document.getElementById('bzila-min-premium'),
      minPremiumVal: document.getElementById('bzila-min-premium-val'),
      sweepOnlyCheckbox: document.getElementById('bzila-sweep-only'),
      flowCount: document.getElementById('bzila-flow-count'),
      flowTotal: document.getElementById('bzila-flow-total'),
    };

    // Handle premium chart hover
    elements.premiumCanvas?.addEventListener('mousemove', (e) => {
      if (!state.premiumChartConfig) return;
      const rect = elements.premiumCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const cfg = state.premiumChartConfig;
      const { hist, padding, xAt, yAt, min, max } = cfg;

      // Find closest point
      let closest = -1, minDist = Infinity;
      hist.forEach((p, i) => {
        const px = xAt(i);
        const dist = Math.abs(px - x);
        if (dist < 30 && dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });

      if (closest >= 0) {
        const p = hist[closest];
        const time = new Date(p.ts).toLocaleTimeString();
        const html = `
          <div style="background:#0d1520;border:1px solid #1a2a3a;border-radius:6px;padding:10px;font-size:11px;font-family:monospace">
            <div style="color:#94a3b8;margin-bottom:6px">${time}</div>
            <div style="color:#22c55e;margin-bottom:4px">Calls: <strong>${fmtMoney(p.call)}</strong></div>
            <div style="color:#ef4444;margin-bottom:4px">Puts: <strong>${fmtMoney(p.put)}</strong></div>
            <div style="color:#fbbf24;border-top:1px solid #1a2a3a;padding-top:6px;margin-top:6px">NET: <strong>${fmtMoney(p.net)}</strong></div>
          </div>
        `;
        showTooltip(e, html);
      } else {
        hideTooltip();
      }
    });

    elements.premiumCanvas?.addEventListener('mouseleave', hideTooltip);

    // Tooltip helpers
    let tooltipEl = null;
    function showTooltip(e, html) {
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;max-width:200px;';
        document.body.appendChild(tooltipEl);
      }
      tooltipEl.innerHTML = html;
      tooltipEl.style.left = (e.clientX + 10) + 'px';
      tooltipEl.style.top = (e.clientY + 10) + 'px';
      tooltipEl.style.display = 'block';
    }
    function hideTooltip() {
      if (tooltipEl) tooltipEl.style.display = 'none';
    }
    function hideTooltip() {
      if (tooltipEl) tooltipEl.style.display = 'none';
    }

    // Pan/zoom handlers for chart
    let chartDragging = false;
    let dragStartX = 0;
    
//     elements.premiumCanvas?.addEventListener('mousedown', e => {
//       chartDragging = true;
//       dragStartX = e.clientX;
//     });
//     
//     elements.premiumCanvas?.addEventListener('mousemove', e => {
//       if (chartDragging) {
//         const delta = e.clientX - dragStartX;
//         const hist = state.flowHistory;
//         if (hist.length > 1) {
//           // ~5px per data point
//           const pointsDelta = -Math.round(delta / 5);
//           state.chartPan = Math.max(0, Math.min(hist.length - 1, state.chartPan + pointsDelta));
//           dragStartX = e.clientX;
//         }
//       }
//     });
//     
//     elements.premiumCanvas?.addEventListener('mouseup', () => {
//       chartDragging = false;
//     });
//     
//     elements.premiumCanvas?.addEventListener('mouseleave', () => {
//       chartDragging = false;
//       hideTooltip();
//     });
//     
//     elements.premiumCanvas?.addEventListener('wheel', e => {
//       e.preventDefault();
//       const hist = state.flowHistory;
//       if (hist.length < 2) return;
//       // Scroll down = zoom in, scroll up = zoom out
//       const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
//       state.chartZoom = Math.max(1, Math.min(20, state.chartZoom * zoomFactor));
//     }, { passive: false });

    // Setup canvas
    function setupCanvas(canvas) {
      if (!canvas) return;
      const parent = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      return ctx;
    }

    // Format money compactly
    function fmtMoney(n) {
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
      if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
      if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
      return sign + '$' + abs.toFixed(0);
    }

    // ════════════════════════════════════════════
    // SPX 0DTE PREMIUM FLOW LOGIC
    // ════════════════════════════════════════════

    // Determine if SPX option symbol is a Call or Put
    // OCC format: SPXW  YYMMDDC00000000 / P00000000
    function getOptionType(symbol) {
      const m = symbol.match(/\d{6}([CP])\d/);
      return m ? m[1] : null; // 'C' or 'P'
    }

    // Check if symbol is 0DTE SPX (expires today)
    function isSpx0DTE(symbol) {
      if (!symbol.startsWith('.SPXW') && !symbol.startsWith('SPXW')) return false;
      const m = symbol.match(/(\d{6})[CP]/);
      if (!m) return false;
      const dateStr = m[1]; // YYMMDD
      const today = new Date();
      const yy = String(today.getFullYear()).slice(2);
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      return dateStr === `${yy}${mm}${dd}`;
    }

    function getOptionStrike(symbol) {
      const m = symbol.match(/[CP](\d+(?:\.\d+)?)$/);
      if (!m) return null;
      const raw = m[1];
      const strike = parseFloat(raw);
      if (!Number.isFinite(strike)) return null;
      return raw.length === 8 ? strike / 1000 : strike;
    }

    function isOtmOption(symbol, optType) {
      const strike = getOptionStrike(symbol);
      const refPrice = state.spxPrice || state.esPrice || 0;
      if (!strike || !refPrice) return false;
      if (optType === 'C') return strike > refPrice;
      if (optType === 'P') return strike < refPrice;
      return false;
    }

    function getAggressorDirection(item, quote) {
      const tradePrice = parseFloat(item.price || 0);
      if (quote && quote.bid > 0 && quote.ask > 0) {
        if (tradePrice >= quote.ask) return 1;
        if (tradePrice <= quote.bid) return -1;
        return 0;
      }
      const ag = item.aggressorSide || '';
      if (ag === 'BUY') return 1;
      if (ag === 'SELL') return -1;
      return 0;
    }

    // Process incoming SPX option trade
    function processSpxTrade(item) {
      const symbol = item.eventSymbol || '';
      if (!isSpx0DTE(symbol)) return;

      const optType = getOptionType(symbol);
      if (!optType) return;
      if (!isOtmOption(symbol, optType)) return;

      const tradePrice = parseFloat(item.price || 0);
      const size = parseInt(item.size || 0);
      if (!tradePrice || !size) return;

      const quote = state.spxQuotes[symbol];
      const direction = getAggressorDirection(item, quote);
      if (direction === 0) return;

      const premium = tradePrice * size * 100;
      const driftContribution = premium * direction;

      if (optType === 'C') state.callPremiumFlow += driftContribution;
      else if (optType === 'P') state.putPremiumFlow += -driftContribution;

      state.netPremiumFlow = state.callPremiumFlow + state.putPremiumFlow;
      updateFlowLabels();
    }

    // Process SPX quote update (track NBBO for each option)
    function processSpxQuote(item) {
      const symbol = item.eventSymbol || '';
      if (!symbol.startsWith('.SPXW') && !symbol.startsWith('SPXW')) return;
      const bid = parseFloat(item.bidPrice || 0);
      const ask = parseFloat(item.askPrice || 0);
      if (bid > 0 && ask > 0) {
        state.spxQuotes[symbol] = { bid, ask, ts: Date.now() };
      }
    }

    function normalizeFeedData(data) {
      if (!Array.isArray(data)) return [];
      if (data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) return data;
      const eventType = data[0];
      const rows = data[1];
      if (typeof eventType !== 'string' || !Array.isArray(rows)) return [];
      const fieldsByType = {
        Quote: ['bidPrice','askPrice','bidSize','askSize'],
        Trade: ['price','dayVolume','size'],
        TradeETH: ['price','dayVolume','size']
      };
      const fields = fieldsByType[eventType];
      if (!fields) return [];
      const rowsIncludeType = rows[0] === eventType;
      const step = fields.length + (rowsIncludeType ? 2 : 1);
      const out = [];
      for (let i = 0; i <= rows.length - step; i += step) {
        const base = i + (rowsIncludeType ? 2 : 1);
        const item = {
          eventType: rowsIncludeType ? rows[i] : eventType,
          eventSymbol: rowsIncludeType ? rows[i + 1] : rows[i],
          time: Date.now()
        };
        fields.forEach((field, j) => item[field] = rows[base + j]);
        out.push(item);
      }
      return out;
    }

    function getSessionOpenTs() {
      const now = new Date();
      const open = new Date();
      open.setHours(9, 30, 0, 0);
      if (now < open) open.setDate(open.getDate() - 1);
      return open.getTime();
    }

    // Snapshot premium flow for full-session chart history
    function snapshotFlow() {
      const ts = Date.now();
      
      // Stop recording after 4 PM ET
      const now = new Date();
      const fourPM = new Date();
      fourPM.setHours(16, 0, 0, 0);
      if (now >= fourPM) return;
      
      const prev = state.flowHistory[state.flowHistory.length - 1];
      state.flowHistory.push({
        ts,
        call: state.callPremiumFlow,
        put: state.putPremiumFlow,
        net: state.netPremiumFlow,
        spx: state.esPrice
      });
      const sessionOpen = getSessionOpenTs();
      state.flowHistory = state.flowHistory.filter(p => p.ts >= sessionOpen);

      if (prev) {
        // Compare calls vs puts directly (not the net)
        const prevCallAbovePut = prev.call > prev.put;
        const currCallAbovePut = state.callPremiumFlow > state.putPremiumFlow;
        
        // Detect cross: was calls below puts, now calls above puts (or vice versa)
        if (prevCallAbovePut !== currCallAbovePut) {
          if (currCallAbovePut && !prevCallAbovePut) {
            // Calls crossed above puts
            state.lastFlowCross = 'calls-over-puts';
            addEvent({
              type: 'flow-cross',
              title: 'CALLS OVER PUTS',
              side: 'buy',
              volume: Math.round(Math.abs(state.callPremiumFlow)),
              trades: 1,
              instrument: 'FLOW',
              price: state.esPrice
            });
          } else if (!currCallAbovePut && prevCallAbovePut) {
            // Puts crossed above calls
            state.lastFlowCross = 'puts-over-calls';
            addEvent({
              type: 'flow-cross',
              title: 'PUTS OVER CALLS',
              side: 'sell',
              volume: Math.round(Math.abs(state.putPremiumFlow)),
              trades: 1,
              instrument: 'FLOW',
              price: state.esPrice
            });
          }
        }
      }
      updateFlowLabels();
    }

    function updateFlowLabels() {
      if (elements.callFlow) elements.callFlow.textContent = fmtMoney(state.callPremiumFlow);
      if (elements.putFlow) elements.putFlow.textContent = fmtMoney(state.putPremiumFlow);
      if (elements.netFlow) {
        elements.netFlow.textContent = fmtMoney(state.netPremiumFlow);
        elements.netFlow.style.color = state.netPremiumFlow >= 0 ? '#10b981' : '#ef4444';
      }
    }

    // Handle aggregated flow order from proxy
    function onFlowOrder(orderData) {
      // orderData = { symbol, type, strike, size, premium, price, timestamp, isSweep, underlyingPrice }
      state.flowOrders.push({
        ...orderData,
        ts: orderData.timestamp
      });
      
      // Keep only last 100 orders
      if (state.flowOrders.length > 100) {
        state.flowOrders.shift();
      }
      
      renderFlowFeed();
      updateFlowStats();
    }

    // Render filtered flow feed
    function renderFlowFeed() {
      const minPrem = state.minPremiumFilter || 50000;
      const sweepOnly = state.sweepOnlyFilter || false;
      
      let filtered = state.flowOrders.filter(o => o.premium >= minPrem);
      if (sweepOnly) {
        filtered = filtered.filter(o => o.isSweep);
      }
      
      const feed = elements.flowFeed;
      if (!feed) return;
      
      if (!filtered.length) {
        feed.innerHTML = '<div style="padding:8px;color:#475569;text-align:center">No orders matching filters</div>';
        return;
      }
      
      // Render in reverse order (newest first)
      feed.innerHTML = filtered.slice().reverse().map(o => {
        const time = new Date(o.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const color = o.type === 'C' ? '#22c55e' : '#ef4444';
        const sweep = o.isSweep ? ' <span style="color:#fbbf24;font-weight:700">[SWEEP]</span>' : '';
        return `<div style="padding:6px 8px;border-bottom:1px solid #1a2a3a;color:#cbd5e1;line-height:1.4">
          <div style="display:flex;justify-content:space-between;font-size:8px;margin-bottom:2px">
            <span style="color:#94a3b8">${time}</span>
            <span style="color:#64748b">${o.symbol}</span>
          </div>
          <div style="font-size:9px">
            <span style="color:${color};font-weight:700">${o.type}</span> ${o.strike} 
            <span style="color:#cbd5e1">${o.size}c @ $${o.price}</span>
          </div>
          <div style="font-size:8px;color:#10b981;margin-top:2px">
            <span style="font-weight:700">$${(o.premium/1000).toFixed(1)}k</span>${sweep}
          </div>
        </div>`;
      }).join('');
      
      // Auto-scroll to bottom
      feed.scrollTop = feed.scrollHeight;
    }

    // Update feed stats
    function updateFlowStats() {
      const minPrem = state.minPremiumFilter || 50000;
      const sweepOnly = state.sweepOnlyFilter || false;
      
      let filtered = state.flowOrders.filter(o => o.premium >= minPrem);
      if (sweepOnly) {
        filtered = filtered.filter(o => o.isSweep);
      }
      
      const count = filtered.length;
      const total = filtered.reduce((sum, o) => sum + o.premium, 0);
      
      if (elements.flowCount) elements.flowCount.textContent = count;
      if (elements.flowTotal) elements.flowTotal.textContent = fmtMoney(total);
    }

    // Snapshot multi-stock flow from option chain data
    function snapshotMultiStockFlow(optionData) {
      // optionData = { SPY: {0dte: {call: x, put: y}, 1dte: {...}}, ... }
      const ts = Date.now();
      const fourPM = new Date();
      fourPM.setHours(16, 0, 0, 0);
      if (new Date() >= fourPM) return;

      const sessionOpen = getSessionOpenTs();
      
      for (const [stock, expirationData] of Object.entries(optionData)) {
        if (!state.multiStockFlowHistory[stock]) state.multiStockFlowHistory[stock] = [];
        
        const snapshot = { ts };
        // Store flow for each expiration (0dte, 1dte, 7dte, etc.)
        for (const [dte, flowData] of Object.entries(expirationData)) {
          snapshot[dte] = flowData;
        }
        
        state.multiStockFlowHistory[stock].push(snapshot);
        // Keep only session data
        state.multiStockFlowHistory[stock] = state.multiStockFlowHistory[stock].filter(p => p.ts >= sessionOpen);
      }
    }

    const MULTI_STOCK_SYMBOLS = ['QQQ','SPY','AAPL','AMZN','GOOGL','META','MSFT','NVDA','TSLA'];

    // Is this expiration 0DTE (expires today)?
    function isExp0DTE(expDateStr) {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      return expDateStr === `${y}-${m}-${d}`;
    }

    // Get nearest expiration from list of expiration dates
    function getNearestExpiration(expirations) {
      if (!expirations.length) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      return expirations.sort((a, b) => {
        const aDays = Math.round((new Date(a + 'T00:00:00') - today) / 86400000);
        const bDays = Math.round((new Date(b + 'T00:00:00') - today) / 86400000);
        return Math.abs(aDays) - Math.abs(bDays);
      })[0];
    }

    // Fetch one stock's chain, compute nearest-expiration OTM call/put premium
    async function fetchStockChainFlow(symbol) {
      try {
        const resp = await fetch(`http://localhost:3001/proxy/api/tt/chains/${encodeURIComponent(symbol)}?range=all`);
        if (!resp.ok) return null;
        const json = await resp.json();
        const items = json?.data?.items || [];
        const spot  = json?.data?.underlyingPrice || 0;
        if (!items.length || !spot) return null;

        // Get all expirations and pick the nearest
        const expirations = items.map(eg => eg['expiration-date']).filter(Boolean);
        const nearestExp = getNearestExpiration(expirations);
        if (!nearestExp) return null;

        let callFlow = 0, putFlow = 0;

        for (const expGroup of items) {
          if (expGroup['expiration-date'] !== nearestExp) continue; // Use nearest expiration only

          for (const strikeObj of (expGroup.strikes || [])) {
            const strike = parseFloat(strikeObj['strike-price'] || 0);
            if (!strike) continue;

            // OTM calls: strike above spot
            const c = strikeObj.call;
            if (c && strike > spot) {
              const mid = ((c.bid || 0) + (c.ask || 0)) / 2;
              callFlow += mid * (c.volume || 0) * 100;
            }
            // OTM puts: strike below spot
            const p = strikeObj.put;
            if (p && strike < spot) {
              const mid = ((p.bid || 0) + (p.ask || 0)) / 2;
              putFlow += mid * (p.volume || 0) * 100;
            }
          }
        }

        if (!callFlow && !putFlow) return null;
        return { [nearestExp.replace(/-/g, '')]: { call: callFlow, put: putFlow } };
      } catch (e) {
        console.error(`fetchStockChainFlow ${symbol}:`, e.message);
        return null;
      }
    }

    // Poll all stocks, staggered to respect proxy rate limits
    async function pollMultiStockFlow() {
      const now = new Date();
      const open = new Date(); open.setHours(9, 30, 0, 0);
      const close = new Date(); close.setHours(16, 0, 0, 0);
      if (now < open || now >= close) return;

      const result = {};
      for (const sym of MULTI_STOCK_SYMBOLS) {
        const flow = await fetchStockChainFlow(sym);
        if (flow) result[sym] = flow;
        await new Promise(r => setTimeout(r, 600));
      }
      if (Object.keys(result).length) snapshotMultiStockFlow(result);
    }

    async function saveMinuteFlowToDatabase() {
      if (typeof DB === 'undefined' || !DB?.db) return;
      const baseline = state.dbMinuteBaseline || {
        callPremiumFlow: state.callPremiumFlow || 0,
        putPremiumFlow: state.putPremiumFlow || 0
      };
      const callPremiumDelta = (state.callPremiumFlow || 0) - (baseline.callPremiumFlow || 0);
      const putPremiumDisplayDelta = (state.putPremiumFlow || 0) - (baseline.putPremiumFlow || 0);
      const price = state.spxPrice || state.esPrice || 0;

      try {
        await DB.saveMinutePremiumFlow(callPremiumDelta, -putPremiumDisplayDelta, price);
        state.dbMinuteBaseline = {
          callPremiumFlow: state.callPremiumFlow || 0,
          putPremiumFlow: state.putPremiumFlow || 0
        };
      } catch (err) {
        console.error('Bzila DB minute save failed:', err);
      }
    }

    async function saveMultiStockFlowToDatabase() {
      if (typeof DB === 'undefined' || !DB?.db) return;
      try {
        for (const [stock, history] of Object.entries(state.multiStockFlowHistory)) {
          const lastSnapshot = history[history.length - 1];
          if (!lastSnapshot) continue;

          // Save each expiration's call/put flow
          for (const [dte, flowData] of Object.entries(lastSnapshot)) {
            if (dte === 'ts') continue; // Skip timestamp field
            if (!flowData.call && !flowData.put) continue;

            await DB.saveMultiStockFlow({
              stock,
              dte: parseInt(dte),
              timestamp: lastSnapshot.ts,
              callFlow: flowData.call || 0,
              putFlow: flowData.put || 0,
              netFlow: (flowData.call || 0) + (flowData.put || 0)
            });
          }
        }
      } catch (err) {
        console.error('Multi-stock DB save failed:', err);
      }
    }

    async function hydratePremiumFlowFromDatabase() {
      if (typeof DB === 'undefined' || !DB?.db) return;
      try {
        let records = [];
        try {
          records = typeof DB.queryPremiumFlow_Today === 'function'
            ? await DB.queryPremiumFlow_Today()
            : await DB.queryPremiumFlow_TimeSeries(8);
        } catch (err) {
          if (err?.name !== 'NotFoundError' || typeof DB._getAllRecords !== 'function') throw err;
          const today = new Date().toISOString().split('T')[0];
          records = (await DB._getAllRecords('premiumFlow')).filter(r => r.date === today);
        }
        const sorted = (records || []).slice().sort((a, b) => a.timestamp - b.timestamp);
        if (!sorted.length) return;

        let callTotal = 0;
        let putDisplayTotal = 0;
        state.flowHistory = sorted.map(r => {
          callTotal += Number(r.callFlow ?? r.netCallPremium ?? 0);
          putDisplayTotal += Number(r.putFlow ?? -(r.netPutPremium || 0));
          return {
            ts: Number(r.timestamp || Date.now()),
            call: callTotal,
            put: putDisplayTotal,
            net: callTotal + putDisplayTotal,
            spx: Number(r.esPrice || r.spxPrice || state.spxPrice || state.esPrice || 0)
          };
        });

        state.callPremiumFlow = callTotal;
        state.putPremiumFlow = putDisplayTotal;
        state.netPremiumFlow = callTotal + putDisplayTotal;
        state.dbMinuteBaseline = {
          callPremiumFlow: state.callPremiumFlow || 0,
          putPremiumFlow: state.putPremiumFlow || 0
        };
        updateFlowLabels();
      } catch (err) {
        console.error('Bzila premium history load failed:', err);
      }
    }

    async function hydrateMultiStockFlowFromDatabase() {
      if (typeof DB === 'undefined' || !DB?.db) return;
      try {
        const today = new Date().toISOString().split('T')[0];
        // Query multi-stock flow records (assumes DB.queryMultiStockFlow exists)
        let records = [];
        try {
          records = typeof DB.queryMultiStockFlow_Today === 'function'
            ? await DB.queryMultiStockFlow_Today()
            : typeof DB._getAllRecords === 'function'
            ? (await DB._getAllRecords('multiStockFlow')).filter(r => r.date === today)
            : [];
        } catch (err) {
          console.warn('Multi-stock flow history not available:', err.message);
          return;
        }

        if (!records.length) return;

        // Group by stock and rebuild snapshots
        const byStock = {};
        for (const stock of Object.keys(state.multiStockFlowHistory)) {
          byStock[stock] = [];
        }

        const sorted = (records || []).slice().sort((a, b) => a.timestamp - b.timestamp);
        for (const r of sorted) {
          const stock = r.stock || '';
          if (!byStock[stock]) continue;

          let snapshot = byStock[stock][byStock[stock].length - 1];
          if (!snapshot || snapshot.ts !== r.timestamp) {
            snapshot = { ts: Number(r.timestamp || Date.now()) };
            byStock[stock].push(snapshot);
          }

          const dte = String(r.dte || 0);
          snapshot[dte] = {
            call: Number(r.callFlow || 0),
            put: Number(r.putFlow || 0),
            net: Number(r.netFlow || 0)
          };
        }

        Object.assign(state.multiStockFlowHistory, byStock);
      } catch (err) {
        console.error('Multi-stock history hydration failed:', err);
      }
    }

    function hydratePremiumFlowWhenDatabaseReady() {
      if (typeof DB !== 'undefined' && DB?.db) {
        hydratePremiumFlowFromDatabase();
        return;
      }
      window.addEventListener('db-ready', () => {
        hydratePremiumFlowFromDatabase();
      }, { once: true });
    }

    function processFutureQuote(item) {
      const symbol = item.eventSymbol || '';
      if (!symbol.startsWith('/ES') && !symbol.startsWith('/NQ')) return;
      const bid = parseFloat(item.bidPrice || 0);
      const ask = parseFloat(item.askPrice || 0);
      if (bid > 0 && ask > 0) {
        state.futureQuotes[symbol] = { bid, ask, ts: Date.now() };
      }
    }

    function getAggressorSide(symbol, price, item) {
      const bid = parseFloat(item.bidPrice || 0);
      const ask = parseFloat(item.askPrice || 0);
      const quote = (bid > 0 && ask > 0) ? { bid, ask } : state.futureQuotes[symbol];
      if (quote && quote.bid > 0 && quote.ask > 0) {
        if (price >= quote.ask) return 'buy';
        if (price <= quote.bid) return 'sell';
      }
      const ag = item.aggressorSide || '';
      if (ag === 'BUY') return 'buy';
      if (ag === 'SELL') return 'sell';
      const prev = state.lastTradeBySymbol[symbol];
      if (prev == null || price === prev) return null;
      return price > prev ? 'buy' : 'sell';
    }


    // ════════════════════════════════════════════
    // CHART RENDERERS
    // ════════════════════════════════════════════
    function renderPremiumChart() {
      const canvas = elements.premiumCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const W = parseFloat(canvas.style.width);
      const H = parseFloat(canvas.style.height);
      if (!W || !H) return;
      ctx.clearRect(0, 0, W, H);

      const padding = { l: 60, r: 10, t: 10, b: 20 };
      const cw = W - padding.l - padding.r;
      const ch = H - padding.t - padding.b;

      let hist = state.flowHistory;
      
      if (hist.length < 2) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for SPX 0DTE flow...', W / 2, H / 2);
        return;
      }

      // Market hours: 9:30 AM - 4 PM ET (fixed, no zoom/pan)
      const marketStart = new Date();
      marketStart.setHours(9, 30, 0, 0);
      const marketEnd = new Date();
      marketEnd.setHours(16, 0, 0, 0);
      const totalMs = marketEnd - marketStart;

      const xAtTime = (ts) => {
        const entryTime = ts instanceof Date ? ts : new Date(ts);
        const offsetMs = Math.max(0, entryTime - marketStart);
        const progress = Math.min(1, offsetMs / totalMs);
        return padding.l + progress * cw;
      };

      // Auto-range
      let min = Infinity, max = -Infinity;
      hist.forEach(p => {
        min = Math.min(min, p.call, -p.put, 0);
        max = Math.max(max, p.call, -p.put, 0);
      });
      if (min === max) { min -= 1; max += 1; }
      const pad = (max - min) * 0.1;
      min -= pad; max += pad;

      const yAt = v => padding.t + ch - ((v - min) / (max - min)) * ch;

      // Grid
      ctx.strokeStyle = '#1a2a3a';
      ctx.lineWidth = 1;
      for (let g = 0; g <= 4; g++) {
        const y = padding.t + (g / 4) * ch;
        ctx.beginPath();
        ctx.moveTo(padding.l, y);
        ctx.lineTo(W - padding.r, y);
        ctx.stroke();
      }

      // Zero line
      if (min < 0 && max > 0) {
        const zy = yAt(0);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(padding.l, zy);
        ctx.lineTo(W - padding.r, zy);
        ctx.stroke();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 10px ui-sans-serif, monospace';
        ctx.textAlign = 'right';
        ctx.fillText('0', padding.l - 6, zy - 6);
      }

      // Y-axis labels
      ctx.fillStyle = '#64748b';
      ctx.font = '10px ui-sans-serif, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let g = 0; g <= 4; g++) {
        const v = max - (g / 4) * (max - min);
        const y = padding.t + (g / 4) * ch;
        ctx.fillText(fmtMoney(v), padding.l - 6, y);
      }

      const drawLine = (key, color, lw, invert) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        hist.forEach((p, i) => {
          const x = xAtTime(p.ts);
          const val = invert ? -p[key] : p[key];
          const y = yAt(val);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      };

      drawLine('call', '#22c55e', 2, false);
      drawLine('put', '#ef4444', 2, true);

      // X-axis time labels (9 AM to 4 PM)
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const hours = [9, 10, 11, 12, 13, 14, 15, 16];
      
      hours.forEach(hour => {
        const timeLabel = new Date();
        timeLabel.setHours(hour, 0, 0, 0);
        const xPos = xAtTime(timeLabel);
        if (xPos >= padding.l && xPos <= W - padding.r) {
          const ampm = hour >= 12 ? (hour === 12 ? '12 PM' : `${hour - 12} PM`) : `${hour} AM`;
          ctx.fillText(ampm, xPos, H - padding.b + 5);
        }
      });

      // Draw axes
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding.l, padding.t);
      ctx.lineTo(padding.l, H - padding.b);
      ctx.lineTo(W - padding.r, H - padding.b);
      ctx.stroke();
    }

    function renderMultiStockCharts() {
      document.querySelectorAll('.multi-stock-card').forEach(card => {
        const symbol = card.getAttribute('data-symbol');
        const canvas = card.querySelector('.stock-premium-canvas');
        if (!canvas || !symbol) return;

        const ctx = canvas.getContext('2d');
        const parent = canvas.parentElement;
        const rect = parent.getBoundingClientRect();
        const W = rect.width;
        const H = rect.height;

        if (!W || !H) return;

        // Only resize if dimensions changed
        if (canvas._w !== W || canvas._h !== H) {
          canvas.width = W;
          canvas.height = H;
          canvas._w = W;
          canvas._h = H;
        }

        ctx.clearRect(0, 0, W, H);

        const padding = { l: 35, r: 6, t: 6, b: 14 };
        const cw = W - padding.l - padding.r;
        const ch = H - padding.t - padding.b;

        const hist = state.multiStockFlowHistory[symbol] || [];

        if (hist.length < 2) {
          ctx.fillStyle = '#475569';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Waiting...', W / 2, H / 2);
          return;
        }

        // Market hours: 9:30 AM - 4 PM ET (fixed)
        const marketStart = new Date();
        marketStart.setHours(9, 30, 0, 0);
        const marketEnd = new Date();
        marketEnd.setHours(16, 0, 0, 0);
        const totalMs = marketEnd - marketStart;

        const xAtTime = (ts) => {
          const entryTime = ts instanceof Date ? ts : new Date(ts);
          const offsetMs = Math.max(0, entryTime - marketStart);
          const progress = Math.min(1, offsetMs / totalMs);
          return padding.l + progress * cw;
        };

        // Sum all DTE buckets per snapshot
        const pts = hist.map(p => {
          let call = 0, put = 0;
          for (const k in p) {
            if (k === 'ts' || typeof p[k] !== 'object' || !p[k]) continue;
            call += p[k].call || 0;
            put += p[k].put || 0;
          }
          return { ts: p.ts, call, put, net: call - put };
        });

        // Auto-range
        let min = Infinity, max = -Infinity;
        pts.forEach(p => {
          min = Math.min(min, p.call, -p.put, p.net, 0);
          max = Math.max(max, p.call, -p.put, p.net, 0);
        });
        if (min === max) { min -= 1; max += 1; }
        const padY = (max - min) * 0.08;
        min -= padY; max += padY;

        const yAt = v => padding.t + ch - ((v - min) / (max - min)) * ch;

        // Grid
        ctx.strokeStyle = '#1a2a3a';
        ctx.lineWidth = 0.5;
        for (let g = 0; g <= 3; g++) {
          const y = padding.t + (g / 3) * ch;
          ctx.beginPath();
          ctx.moveTo(padding.l, y);
          ctx.lineTo(W - padding.r, y);
          ctx.stroke();
        }

        // Zero line
        if (min < 0 && max > 0) {
          const zy = yAt(0);
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(padding.l, zy);
          ctx.lineTo(W - padding.r, zy);
          ctx.stroke();
        }

        // Y-axis labels
        ctx.fillStyle = '#64748b';
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let g = 0; g <= 3; g++) {
          const v = max - (g / 3) * (max - min);
          const y = padding.t + (g / 3) * ch;
          ctx.fillText(fmtMoney(v), padding.l - 3, y);
        }

        // Draw lines
        const drawLine = (getVal, color, lw) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = lw;
          ctx.beginPath();
          pts.forEach((p, i) => {
            const x = xAtTime(p.ts);
            const y = yAt(getVal(p));
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.stroke();
        };

        drawLine(p => p.call, '#22c55e', 1.2);   // Calls: green
        drawLine(p => -p.put, '#ef4444', 1.2);   // Puts: red (inverted)
        drawLine(p => p.net, '#fbbf24', 1.5);    // NET: gold

        // Axes
        ctx.strokeStyle = '#1e3a4a';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(padding.l, padding.t);
        ctx.lineTo(padding.l, H - padding.b);
        ctx.lineTo(W - padding.r, H - padding.b);
        ctx.stroke();

        // Stock label
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(symbol, padding.l + 3, padding.t + 2);
      });
    }



    // Batch market data requests to respect 2 req/sec limit (100 symbols per request)
    async function batchFetchOptionChains(stocks, expirations) {
      // stocks: ['SPY', 'QQQ', 'IWM', 'AAPL']
      // expirations: [0, 1, 7, 14, 21, 30] (DTE)
      // Build symbol list: SPY250606C, SPY250606P, etc.
      const symbols = [];
      for (const stock of stocks) {
        for (const dte of expirations) {
          const expDate = getExpirationDate(dte);
          symbols.push(`${stock}${expDate}C`); // call
          symbols.push(`${stock}${expDate}P`); // put
        }
      }
      
      const results = {};
      const batchSize = 100; // API limit per request
      
      // Batch into groups of 100, with delays to stay under 2 req/sec
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const query = batch.map(s => `symbols[]=${encodeURIComponent(s)}`).join('&');
        
        try {
          const resp = await fetch(`http://localhost:3001/proxy/api/tt/option-chains?${query}`);
          if (resp.ok) {
            const data = await resp.json();
            const items = data?.data?.items || [];
            items.forEach(item => {
              results[item.symbol] = item;
            });
          }
        } catch (e) {
          console.error('Batch fetch failed:', e);
        }
        
        // Wait 600ms between batches to stay under 2 req/sec (margin of safety)
        if (i + batchSize < symbols.length) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
      
      return results;
    }
    
    function getExpirationDate(dte) {
      // dte = days to expiration, return YYMMDD format
      const d = new Date();
      d.setDate(d.getDate() + dte);
      const yy = String(d.getFullYear()).slice(2);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}${mm}${dd}`;
    }

    // WebSocket connection
    function connectWebSocket() {
      if (state.ws) state.ws.close();
      
      const ws = new WebSocket('ws://localhost:3001/ws/dxlink');
      state.ws = ws;

      ws.onopen = () => {
        console.log('Bzila: dxLink connected');
        state.connected = true;
        elements.status.textContent = '● LIVE';
        elements.status.style.background = '#065f46';
        elements.status.style.color = '#6ee7b7';
        
        ws.send(JSON.stringify({
          type: 'subscribe',
          symbols: [ES_STREAM_SYMBOL, NQ_STREAM_SYMBOL],
          feedTypes: ['Trade', 'Quote'],
          spxSubscribe: true  // flag for proxy to also subscribe SPX 0DTE options
        }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Handle aggregated flow orders from proxy
          if (msg.type === 'FLOW_ORDER' && msg.data) {
            onFlowOrder(msg.data);
            return;
          }
          
          if (msg.type === 'FEED_DATA' && Array.isArray(msg.data)) {
            normalizeFeedData(msg.data).forEach(item => {
              const symbol = item.eventSymbol || '';
              const eventType = item.eventType || '';

              if (eventType === 'Quote' && (symbol.startsWith('/ES') || symbol.startsWith('/NQ'))) {
                processFutureQuote(item);
                return;
              }

              // ── SPX Quote: cache NBBO for aggressor-side detection ──
              if (eventType === 'Quote' && (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW'))) {
                processSpxQuote(item);
                return;
              }

              if (eventType !== 'Trade' && eventType !== 'TradeETH') return;

              const price = parseFloat(item.price || 0);
              const size = parseInt(item.size || 0);
              const timestamp = item.time || Date.now();
              if (!price || !size) return;

              // ── SPX 0DTE Option Trade ──
              if (symbol.startsWith('.SPXW') || symbol.startsWith('SPXW')) {
                processSpxTrade(item);
                return;
              }

              const side = getAggressorSide(symbol, price, item);

              // ── ES Futures Trade ──
              if (symbol.startsWith('/ES')) {
                state.esPrice = price;
                if (!state.spxPrice) state.spxPrice = price;
                if (!side) return;
                const trade = { timestamp, price, size, side };
                state.esTrades.push(trade);

                if (state.esTrades.length > 5000) state.esTrades.splice(0, 1000);

              // ── NQ Futures Trade ──
              } else if (symbol.startsWith('/NQ')) {
                state.nqPrice = price;
                state.lastTradeBySymbol[symbol] = price;
                if (!side) return;
                const trade = { timestamp, price, size, side };
                state.nqTrades.push(trade);

                if (state.nqTrades.length > 5000) state.nqTrades.splice(0, 1000);
              }
            });
          }
        } catch (e) {
          console.error('Bzila WS message error:', e);
        }
      };

      ws.onerror = (err) => {
        console.error('Bzila WS error:', err);
        state.connected = false;
        elements.status.textContent = '● ERROR';
        elements.status.style.background = '#7f1d1d';
        elements.status.style.color = '#fca5a5';
      };

      ws.onclose = () => {
        if (ws !== state.ws) return;
        console.log('Bzila WS closed');
        state.connected = false;
        elements.status.textContent = '● DISCONNECTED';
        elements.status.style.background = '#7f1d1d';
        elements.status.style.color = '#fca5a5';
        
        // Auto-reconnect after 5s
        reconnectTimeout = setTimeout(connectWebSocket, 5000);
      };
    }

    // ── Animation loop for charts ──
    let animFrame = null;
    let snapshotInterval = null;
    let dbMinuteInterval = null;
    let multiStockInterval = null;
    let dailyResetTimeout = null;
    let reconnectTimeout = null;
    function animate() {
      renderPremiumChart();
      renderMultiStockCharts();
      animFrame = requestAnimationFrame(animate);
    }

    // ── Daily reset at 9:30 AM ET ──
    function scheduleDailyReset() {
      const now = new Date();
      const next = new Date();
      next.setHours(9, 30, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const msUntil = next - now;
      dailyResetTimeout = setTimeout(() => {
        state.callPremiumFlow = 0;
        state.putPremiumFlow = 0;
        state.netPremiumFlow = 0;
        state.flowHistory = [];
      state.spxQuotes = {};
      state.futureQuotes = {};
      state.lastTradeBySymbol = {};
      state.lastFlowCross = null;
      state.dbMinuteBaseline = {
        callPremiumFlow: 0,
        putPremiumFlow: 0,
      };
        updateFlowLabels();
        console.log('Bzila: daily reset at 9:30 AM ET');
        scheduleDailyReset();
      }, msUntil);
    }

    // Tab switching
    window.switchBzilaTab = function(tabName) {
      const spxTab = document.getElementById('bzila-tab-spx');
      const multiStockTab = document.getElementById('bzila-tab-multi-stock');
      const spxBtn = document.getElementById('tab-spx');
      const multiStockBtn = document.getElementById('tab-multi-stock');

      if (tabName === 'spx') {
        spxTab.style.display = 'flex';
        multiStockTab.style.display = 'none';
        spxBtn.style.color = '#cbd5e1';
        spxBtn.style.borderBottomColor = '#10b981';
        multiStockBtn.style.color = '#64748b';
        multiStockBtn.style.borderBottomColor = 'transparent';
      } else if (tabName === 'multi-stock') {
        spxTab.style.display = 'none';
        multiStockTab.style.display = 'flex';
        spxBtn.style.color = '#64748b';
        spxBtn.style.borderBottomColor = 'transparent';
        multiStockBtn.style.color = '#cbd5e1';
        multiStockBtn.style.borderBottomColor = '#10b981';
        
        // Render after layout settles; renderMultiStockCharts sizes canvases itself
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            renderMultiStockCharts();
          });
        });
      }
    };

    // Initialize when page loads
    window.initBzilaFlow = function() {
      if (state.ws || animFrame || snapshotInterval) window.cleanupBzilaFlow();
      console.log('Initializing Bzila Flow...');
      setupCanvas(elements.premiumCanvas);
      
      fetchInitialPrices();
      connectWebSocket();
      hydratePremiumFlowWhenDatabaseReady();

      snapshotFlow();
      renderMultiStockCharts();
      snapshotInterval = setInterval(snapshotFlow, 5000);
      state.dbMinuteBaseline = {
        callPremiumFlow: state.callPremiumFlow || 0,
        putPremiumFlow: state.putPremiumFlow || 0
      };
      dbMinuteInterval = setInterval(saveMinuteFlowToDatabase, 60 * 1000);

      // Poll multi-stock 0DTE OTM chains every 60s
      pollMultiStockFlow();
      multiStockInterval = setInterval(pollMultiStockFlow, 60 * 1000);

      // Setup flow feed filters
      if (elements.minPremiumSlider) {
        elements.minPremiumSlider.addEventListener('input', (e) => {
          state.minPremiumFilter = parseInt(e.target.value);
          if (elements.minPremiumVal) {
            elements.minPremiumVal.textContent = (state.minPremiumFilter).toLocaleString();
          }
          renderFlowFeed();
          updateFlowStats();
        });
      }
      if (elements.sweepOnlyCheckbox) {
        elements.sweepOnlyCheckbox.addEventListener('change', (e) => {
          state.sweepOnlyFilter = e.target.checked;
          renderFlowFeed();
          updateFlowStats();
        });
      }

      // Start animation loop
      animate();

      // Schedule daily reset
      scheduleDailyReset();
    };

    // Cleanup
    window.cleanupBzilaFlow = function() {
      if (animFrame) cancelAnimationFrame(animFrame);
      animFrame = null;
      if (snapshotInterval) clearInterval(snapshotInterval);
      snapshotInterval = null;
      if (dbMinuteInterval) clearInterval(dbMinuteInterval);
      dbMinuteInterval = null;
      if (multiStockInterval) clearInterval(multiStockInterval);
      multiStockInterval = null;
      if (dailyResetTimeout) clearTimeout(dailyResetTimeout);
      dailyResetTimeout = null;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
      if (state.ws) state.ws.close();
      state.ws = null;
    };
    window.init_bzila = window.initBzilaFlow;
  })();

