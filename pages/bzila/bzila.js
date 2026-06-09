  (function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // CONFIG
    // ═══════════════════════════════════════════════════════════════
    const DISCORD_WEBHOOK_URL = '/proxy/api/webhooks/1466249857122570454/REDACTED';

    const PRICE_BUCKET_ES = 0.50;
    const PRICE_BUCKET_NQ = 2.00;
    const ES_REST_SYMBOL = '/ESM6';
    const NQ_REST_SYMBOL = '/NQM6';
    const ES_STREAM_SYMBOL = '/ES:XCME';
    const NQ_STREAM_SYMBOL = '/NQ:XCME';

    // State
    const defaultState = {
      esMinSize: 200,
      nqMinSize: 75,
      fadeMinutes: 15,
      esPrice: 5900.00,
      nqPrice: 20800.00,
      esTrades: [],
      nqTrades: [],
      ws: null,
      connected: false,
      spxPrice: 0,
      callPremiumFlow: 0,
      putPremiumFlow: 0,
      netPremiumFlow: 0,
      flowHistory: [],
      lastFlowCross: null,
      spxQuotes: {},
      futureQuotes: {},
      lastTradeBySymbol: {},
      seenSpxTradeKeys: new Set(),
      seenSpxTradeOrder: [],
      chartPan: 0,
      chartZoom: 1,
      flowOrders: [],
      minPremiumFilter: 50000,
      sweepOnlyFilter: false,
      // Big block trades
      bigBlocks: [],
      bigBlocksMinSizeES: 200,
      bigBlocksMinSizeNQ: 75,
      bigBlocksCount: 0,
      bigBlocksVolume: 0,
    };

    // Preserve user preferences but always start with clean flow data
    const _prev = window.__bzilaFlowState || {};
    const state = Object.assign({}, defaultState, {
      minPremiumFilter:   _prev.minPremiumFilter   ?? defaultState.minPremiumFilter,
      sweepOnlyFilter:    _prev.sweepOnlyFilter     ?? defaultState.sweepOnlyFilter,
      bigBlocksMinSizeES: _prev.bigBlocksMinSizeES  ?? defaultState.bigBlocksMinSizeES,
      bigBlocksMinSizeNQ: _prev.bigBlocksMinSizeNQ  ?? defaultState.bigBlocksMinSizeNQ,
      // Always fresh
      flowHistory: [], callPremiumFlow: 0, putPremiumFlow: 0, netPremiumFlow: 0,
      bigBlocks: [], bigBlocksCount: 0, bigBlocksVolume: 0,
    });
    window.__bzilaFlowState = state;

    const MAX_SEEN_SPX_TRADES = 20000;

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
      bigBlockFeed: document.getElementById('bzila-big-blocks-feed'),
      bigBlockCount: document.getElementById('bzila-big-blocks-count'),
      bigBlockVolume: document.getElementById('bzila-big-blocks-volume'),
      bigBlockLive: document.getElementById('bzila-big-block-live'),
      bigBlockMinLabel: document.getElementById('bzila-big-block-min-label'),
      flowCount: document.getElementById('bzila-flow-count'),
      flowTotal: document.getElementById('bzila-flow-total'),
    };

    function fmtSignedMoney(n) {
      const value = Number(n);
      if (!Number.isFinite(value)) return '$0';
      return (value >= 0 ? '+' : '-') + fmtMoney(Math.abs(value));
    }

    function computeDeltaWeightedGEX(r) {
      const cg = Number(r.callGEX || 0);
      const pg = Number(r.putGEX || 0);
      const cd = Number(r.callDelta || r.avgCallDelta || 0);
      const pd = Number(r.putDelta || r.avgPutDelta || 0);
      return { callDeltaGEX: cg * cd, putDeltaGEX: pg * pd, deltaWeightedGEX: cg * cd - pg * pd };
    }

    function normalizeGexRows(rows) {
      return (Array.isArray(rows) ? rows : [])
        .filter(r => Number.isFinite(Number(r?.strike)))
        .map(r => {
          const { callDeltaGEX, putDeltaGEX, deltaWeightedGEX } = computeDeltaWeightedGEX(r);
          return {
            strike: Number(r.strike),
            callGEX: Number(r.callGEX || 0),
            putGEX: Number(r.putGEX || 0),
            callDelta: Number(r.callDelta || r.avgCallDelta || 0),
            putDelta: Number(r.putDelta || r.avgPutDelta || 0),
            callDeltaGEX, putDeltaGEX, deltaWeightedGEX
          };
        })
        .sort((a, b) => a.strike - b.strike);
    }

    async function fetchTop3GexRows() {
      try {
        const res = await fetch('/proxy/api/tt/gex-top-3', { cache: 'no-store' });
        if (!res.ok) return [];
        const data = await res.json();
        const rows = normalizeGexRows(data?.rows);
        if (rows.length) return rows;

        const alt = await fetch('/proxy/api/tt/gex', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
        const altRows = normalizeGexRows(alt?.rows || alt?.data?.rows || []);
        return altRows.length ? altRows.sort((a, b) => Math.abs(b.deltaWeightedGEX || 0) - Math.abs(a.deltaWeightedGEX || 0)).slice(0, 3).sort((a, b) => a.strike - b.strike) : [];
      } catch (e) {
        console.warn('Bzila gex-top-3 fetch failed:', e);
        return [];
      }
    }

    state.gexRows = normalizeGexRows(state.gexRows);
    state.gexFetchInFlight = false;
    state.gexLastFetchTs = 0;

    function renderBigBlockControls() {
      if (elements.bigBlockMinLabel) elements.bigBlockMinLabel.textContent = `ES ${state.bigBlocksMinSizeES}+ / NQ ${state.bigBlocksMinSizeNQ}+`;
      if (elements.bigBlockLive) elements.bigBlockLive.textContent = state.connected ? 'LIVE' : 'CONNECTING';
    }

    function renderBigBlockFeed() {
      const esTrades = state.esTrades.filter(trade => trade.size >= state.bigBlocksMinSizeES).slice(-25);
      const nqTrades = state.nqTrades.filter(trade => trade.size >= state.bigBlocksMinSizeNQ).slice(-25);
      const trades = [...esTrades.map(t => ({ ...t, symbol: 'ES' })), ...nqTrades.map(t => ({ ...t, symbol: 'NQ' }))].sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
      if (elements.bigBlockCount) elements.bigBlockCount.textContent = String(trades.length);
      if (elements.bigBlockVolume) elements.bigBlockVolume.textContent = trades.reduce((sum, trade) => sum + (trade.size || 0), 0).toLocaleString();
      if (!elements.bigBlockFeed) return;
      if (!trades.length) {
        elements.bigBlockFeed.innerHTML = `<div style="padding:8px;color:#475569;text-align:center">Waiting for ES 200+ and NQ 75+ prints...</div>`;
        return;
      }
      elements.bigBlockFeed.innerHTML = trades.map(trade => `
        <div style="display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:center;padding:7px 8px;border-bottom:1px solid #14202e;background:${trade.side === 'buy' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'}">
          <div style="color:#94a3b8">${new Date(trade.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div style="color:${trade.side === 'buy' ? '#22c55e' : '#ef4444'};font-weight:700">${trade.symbol} ${trade.side === 'buy' ? 'BUY' : 'SELL'}</div>
          <div style="text-align:right">
            <div style="color:#e2e8f0;font-weight:700">${trade.size}</div>
            <div style="color:#64748b">${trade.price.toFixed(2)}</div>
          </div>
        </div>
      `).join('');
    }

    async function refreshSpxGexRows() {
      if (state.gexFetchInFlight) return;
      const now = Date.now();
      if (now - (state.gexLastFetchTs || 0) < 5000 && state.gexRows.length) {
        renderPremiumChart();
        return;
      }
      state.gexFetchInFlight = true;
      try {
        const rows = normalizeGexRows(await fetchTop3GexRows());
        state.gexRows = rows;
        state.gexLastFetchTs = now;
        updateDeltaGexStats(rows);
        renderPremiumChart();
        if (typeof DB !== 'undefined' && DB?.db && typeof DB.saveGexTop3Snapshot === 'function') {
          const topRows = [...rows].sort((a, b) => Math.abs(b.deltaWeightedGEX || 0) - Math.abs(a.deltaWeightedGEX || 0)).slice(0, 3);
          const deltaGexTotals = {
            totalCallDeltaGEX: rows.reduce((s, r) => s + (r.callDeltaGEX || 0), 0),
            totalPutDeltaGEX:  rows.reduce((s, r) => s + (r.putDeltaGEX  || 0), 0),
            net: rows.reduce((s, r) => s + (r.callDeltaGEX || 0) - (r.putDeltaGEX || 0), 0)
          };
          DB.saveGexTop3Snapshot(topRows, state.spxPrice || state.esPrice || 0, deltaGexTotals)
            .catch(err => console.warn('GEX Top 3 save failed:', err));
        }
      } finally {
        state.gexFetchInFlight = false;
      }
    }

    function updateDeltaGexStats(rows) {
      if (!rows.length) return;
      const callTotal = rows.reduce((s, r) => s + (r.callDeltaGEX || 0), 0);
      const putTotal  = rows.reduce((s, r) => s + (r.putDeltaGEX  || 0), 0);
      const net = callTotal - putTotal;
      const fmt = n => (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
      const cEl = document.getElementById('bzila-call-delta-gex');
      const pEl = document.getElementById('bzila-put-delta-gex');
      const nEl = document.getElementById('bzila-net-delta-gex');
      const lEl = document.getElementById('bzila-gex-live');
      if (cEl) cEl.textContent = fmt(callTotal);
      if (pEl) pEl.textContent = fmt(putTotal);
      if (nEl) { nEl.textContent = fmt(net); nEl.style.color = net >= 0 ? '#22c55e' : '#f97316'; }
      if (lEl) lEl.textContent = 'LIVE';
    }

    renderBigBlockControls();
    renderBigBlockFeed();

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
    function fmtCompactNumber(value, divisor = 1) {
      const scaled = value / divisor;
      return scaled.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
        useGrouping: false
      });
    }

    function fmtMoney(n) {
      const value = Number(n);
      if (!Number.isFinite(value)) return '$0';
      const abs = Math.abs(value);
      const sign = value < 0 ? '-' : '';
      if (abs >= 1e9) return sign + '$' + fmtCompactNumber(abs, 1e9) + 'B';
      if (abs >= 1e6) return sign + '$' + fmtCompactNumber(abs, 1e6) + 'M';
      if (abs >= 1e3) return sign + '$' + fmtCompactNumber(abs, 1e3) + 'K';
      return sign + '$' + fmtCompactNumber(abs);
    }

    function fmtPrice(n) {
      const value = Number(n);
      if (!Number.isFinite(value)) return '--';
      return value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: true
      });
    }

    function getEtParts(date = new Date()) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        weekday: 'short'
      }).formatToParts(date);
      const out = {};
      for (const part of parts) {
        if (part.type !== 'literal') out[part.type] = part.value;
      }
      const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return {
        year: parseInt(out.year || '0', 10),
        month: parseInt(out.month || '0', 10),
        day: parseInt(out.day || '0', 10),
        hour: parseInt(out.hour || '0', 10),
        minute: parseInt(out.minute || '0', 10),
        second: parseInt(out.second || '0', 10),
        weekday: weekdayMap[out.weekday] ?? -1
      };
    }

    function isMarketHoursAt(date = new Date()) {
      const et = getEtParts(date);
      if (et.weekday < 1 || et.weekday > 5) return false;
      const mins = et.hour * 60 + et.minute;
      return mins >= 570 && mins < 960;
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
      const today = getEtParts();
      const yy = String(today.year).slice(2);
      const mm = String(today.month).padStart(2, '0');
      const dd = String(today.day).padStart(2, '0');
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

    function getSpxTradeDedupKey(item) {
      const symbol = item.eventSymbol || '';
      const sequence = item.sequence ?? item.index ?? '';
      const exchange = item.exchangeCode ?? '';
      const price = parseFloat(item.price || 0);
      const size = parseInt(item.size || 0);
      const time = Number(item.time || 0);
      return [symbol, sequence, exchange, time, price, size].join('|');
    }

    function markSpxTradeSeen(item) {
      const key = getSpxTradeDedupKey(item);
      if (!key || key === '|||||') return false;
      if (state.seenSpxTradeKeys.has(key)) return true;
      state.seenSpxTradeKeys.add(key);
      state.seenSpxTradeOrder.push(key);
      if (state.seenSpxTradeOrder.length > MAX_SEEN_SPX_TRADES) {
        const staleKey = state.seenSpxTradeOrder.shift();
        if (staleKey) state.seenSpxTradeKeys.delete(staleKey);
      }
      return false;
    }

    // Process incoming SPX option trade
    function processSpxTrade(item) {
      // Only process trades Mon–Fri
      if (!isMarketHoursAt()) return;

      const symbol = item.eventSymbol || '';
      if (!isSpx0DTE(symbol)) return;

      const optType = getOptionType(symbol);
      if (!optType) return;
      if (!isOtmOption(symbol, optType)) return;

      const tradePrice = parseFloat(item.price || 0);
      const size = parseInt(item.size || 0);
      if (!tradePrice || !size) return;
      if (markSpxTradeSeen(item)) return;

      const quote = state.spxQuotes[symbol];
      const direction = getAggressorDirection(item, quote);
      if (direction === 0) return;

      const premium = tradePrice * size * 100;

      if (optType === 'C') {
        if (direction > 0) {
          state.callPremiumFlow += premium;
        } else {
          state.callPremiumFlow -= premium;
        }
        state.netPremiumFlow += (direction > 0 ? premium : -premium);
      } else if (optType === 'P') {
        if (direction > 0) {
          state.putPremiumFlow += premium;
        } else {
          state.putPremiumFlow -= premium;
        }
        state.netPremiumFlow -= (direction > 0 ? premium : -premium);
      }
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
        TradeETH: ['price','dayVolume','size'],
        TimeAndSale: ['time','sequence','exchangeCode','price','size','bidPrice','askPrice','saleConditions','flags','aggressorSide']
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
      const et = getEtParts(now);
      const open = new Date(now);
      open.setHours(now.getHours() - et.hour + 9, 30, 0, 0);
      if (now < open) open.setDate(open.getDate() - 1);
      return open.getTime();
    }

    // Pure UTC market hours — no locale/browser dependency
    function isMarketOpen() {
      return isMarketHoursAt();
    }
    function isBeforeMarketOpen() {
      const et = getEtParts();
      return et.hour * 60 + et.minute < 570;
    }

    function snapshotFlow() {
      if (!isMarketOpen()) return;
      const ts = Date.now();
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
        const prevCallAbovePut = prev.call > prev.put;
        const currCallAbovePut = state.netPremiumFlow >= 0;
        if (prevCallAbovePut !== currCallAbovePut) {
          if (currCallAbovePut && !prevCallAbovePut) {
            state.lastFlowCross = 'calls-over-puts';
            if (typeof addEvent === 'function') addEvent({ type: 'flow-cross', title: 'CALLS OVER PUTS', side: 'buy', volume: Math.round(Math.abs(state.callPremiumFlow)), trades: 1, instrument: 'FLOW', price: state.esPrice });
          } else if (!currCallAbovePut && prevCallAbovePut) {
            state.lastFlowCross = 'puts-over-calls';
            if (typeof addEvent === 'function') addEvent({ type: 'flow-cross', title: 'PUTS OVER CALLS', side: 'sell', volume: Math.round(Math.abs(state.putPremiumFlow)), trades: 1, instrument: 'FLOW', price: state.esPrice });
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
      renderPremiumStatsBox();
    }

    function renderPremiumStatsBox() {
      const hist = Array.isArray(state.flowHistory) ? state.flowHistory : [];
      const latest = hist.length ? hist[hist.length - 1] : null;
      const prev = hist.length > 1 ? hist[hist.length - 2] : null;
      const call = Number(state.callPremiumFlow || 0);
      const put = Number(state.putPremiumFlow || 0);
      const net = Number(state.netPremiumFlow || 0);
      const spot = Number(state.spxPrice || state.esPrice || 0);
      const callEl = document.getElementById('bzila-premium-call');
      const putEl = document.getElementById('bzila-premium-put');
      const netEl = document.getElementById('bzila-premium-net');
      const spotEl = document.getElementById('bzila-premium-spot');
      const historyEl = document.getElementById('bzila-premium-history');
      const updatedEl = document.getElementById('bzila-premium-last-updated');
      const biasEl = document.getElementById('bzila-premium-bias');
      const intervalEl = document.getElementById('bzila-premium-interval');
      const rangeEl = document.getElementById('bzila-premium-range');

      if (callEl) callEl.textContent = fmtMoney(call);
      if (putEl) putEl.textContent = fmtMoney(put);
      if (netEl) netEl.textContent = fmtMoney(net);
      if (spotEl) spotEl.textContent = spot ? fmtPrice(spot) : '--';
      if (historyEl) historyEl.textContent = hist.length ? `${hist.length} pts` : '0 pts';

      if (latest && updatedEl) {
        updatedEl.textContent = `UPDATED ${new Date(latest.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      } else if (updatedEl) {
        updatedEl.textContent = 'LIVE - WAITING FOR SNAPSHOT';
      }

      const netDelta = prev ? net - Number(prev.net || 0) : net;
      const rangeMin = hist.length ? hist.reduce((min, p) => Math.min(min, Number(p.net || 0)), net) : net;
      const rangeMax = hist.length ? hist.reduce((max, p) => Math.max(max, Number(p.net || 0)), net) : net;
      const range = hist.length ? (rangeMax - rangeMin) : 0;
      const biasText = hist.length ? (net >= 0 ? 'CALLS LEADING' : 'PUTS LEADING') : 'WAITING';

      if (biasEl) biasEl.textContent = biasText;
      if (intervalEl) intervalEl.textContent = latest ? fmtSignedMoney(netDelta) : '--';
      if (rangeEl) rangeEl.textContent = hist.length ? fmtMoney(range).replace(/^\+/, '') : '--';

      if (callEl) callEl.style.color = '#22c55e';
      if (putEl) putEl.style.color = '#ef4444';
      if (spotEl) spotEl.style.color = '#e2e8f0';
      if (netEl) netEl.style.color = net >= 0 ? '#22c55e' : '#f97316';
      if (biasEl) biasEl.style.color = hist.length ? (net >= 0 ? '#22c55e' : '#f97316') : '#64748b';
      if (intervalEl) intervalEl.style.color = latest ? (netDelta >= 0 ? '#22c55e' : '#f97316') : '#64748b';
      if (rangeEl) rangeEl.style.color = '#e2e8f0';
    }

    // ── Big Block Trades (ES/NQ) ──
    function processBigBlockTrade(symbol, price, size, side, timestamp) {
      const rawTs = Number(timestamp);
      let tradeTs = Number.isFinite(rawTs) ? rawTs : Date.now();
      if (tradeTs > 1e15) tradeTs = Math.floor(tradeTs / 1e6);
      else if (tradeTs > 1e12 && tradeTs > Date.now() + 365 * 24 * 60 * 60 * 1000) tradeTs = Math.floor(tradeTs / 1000);
      if (!isMarketHoursAt()) return;
      const isES = symbol.startsWith('/ES');
      const isNQ = symbol.startsWith('/NQ');
      const minSize = isES ? state.bigBlocksMinSizeES : state.bigBlocksMinSizeNQ;
      if (size < minSize) return;
      const block = { timestamp: tradeTs, symbol: isES ? 'ES' : 'NQ', price, size, side };
      state.bigBlocks.unshift(block);
      if (state.bigBlocks.length > 200) state.bigBlocks.pop();
      state.bigBlocksCount++;
      state.bigBlocksVolume += size;
      renderBigBlocksFeed();
    }

    function renderBigBlocksFeed() {
      const feed = document.getElementById('bzila-big-blocks-feed');
      if (!feed) return;
      const filtered = state.bigBlocks.filter(b => {
        const min = b.symbol === 'ES' ? state.bigBlocksMinSizeES : state.bigBlocksMinSizeNQ;
        return b.size >= min;
      });
      if (!filtered.length) {
        feed.innerHTML = '<div style="padding:8px;color:#475569;text-align:center">Waiting for big blocks...</div>';
      } else {
        feed.innerHTML = filtered.map(b => {
          const color = b.side > 0 ? '#10b981' : (b.side < 0 ? '#ef4444' : '#fbbf24');
          const sideText = b.side > 0 ? 'BUY' : (b.side < 0 ? 'SELL' : 'PRINT');
          const time = new Date(b.timestamp).toLocaleTimeString();
          return `<div style="padding:6px 8px;border-bottom:1px solid #1a2a3a;display:flex;justify-content:space-between;font-size:13px">
            <div><span style="color:#7dd3fc">${b.symbol}</span> <span style="color:${color}">${sideText}</span></div>
            <div style="text-align:right"><div style="color:#cbd5e1">${b.size.toLocaleString()} @ ${b.price.toFixed(2)}</div><div style="color:#64748b;font-size:11px">${time}</div></div>
          </div>`;
        }).join('');
      }
      const cnt = document.getElementById('bzila-big-blocks-count');
      const vol = document.getElementById('bzila-big-blocks-volume');
      if (cnt) cnt.textContent = state.bigBlocksCount.toLocaleString();
      if (vol) vol.textContent = state.bigBlocksVolume.toLocaleString();
    }

    async function loadBigTradesFromDatabase() {
      if (typeof DB === 'undefined' || !DB?.db) return;
      if (!DB.db.objectStoreNames.contains('bigTrades')) return;
      try {
        const tx = DB.db.transaction('bigTrades', 'readonly');
        const store = tx.objectStore('bigTrades');
        const request = store.getAll();
        request.onsuccess = () => {
          const trades = request.result || [];
          const now = Date.now();
          const oneDayAgo = now - (24 * 60 * 60 * 1000);
          trades.filter(t => t.timestamp > oneDayAgo).forEach(t => {
            const side = t.side === 'ASK' ? 1 : -1;
            state.bigBlocks.unshift({ timestamp: t.timestamp, symbol: t.ticker, price: t.price, size: t.size, side });
            state.bigBlocksCount++;
            state.bigBlocksVolume += t.size;
          });
          if (state.bigBlocks.length > 200) state.bigBlocks = state.bigBlocks.slice(0, 200);
          renderBigBlocksFeed();
        };
      } catch (err) {
        console.error('[Bzila] Error loading big trades from DB:', err);
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

    // ═══════════════════════════════════════════════════════════════
    // SNAPSHOT BUTTONS (Copy, X, Discord)
    // ═══════════════════════════════════════════════════════════════

           // Load html2canvas library if needed
    function loadHtml2Canvas() {
      return new Promise((resolve, reject) => {
        if (typeof html2canvas !== 'undefined') {
          resolve();
          return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          console.log('✅ html2canvas loaded');
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load html2canvas'));
        document.head.appendChild(script);
      });
    }

    function setButtonFeedback(btn, state, originalText, originalColor, restoreDelay = 1500, onRestore) {
      if (!btn) return;
      if (state === 'loading') {
        btn.textContent = '...';
        btn.style.color = '#ffb300';
        return;
      }
      btn.textContent = (state === 'success' || state === 'ok') ? 'OK' : 'ERR';
      btn.style.color = (state === 'success' || state === 'ok') ? '#00e676' : '#ff4757';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.color = originalColor;
        if (typeof onRestore === 'function') onRestore();
      }, restoreDelay);
    }

    // Copy SPX Premium Chart screenshot
    async function copySPXChartScreenshot() {
      const btn = document.getElementById('bzila-copy-shot-btn');
      const canvas = document.getElementById('bzila-premium-canvas');
      setButtonFeedback(btn, 'loading', 'COPY', '#00e5ff');
      try {
        if (!canvas) throw new Error('Canvas not found');
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('Screenshot failed')), 'image/png')
        );
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setButtonFeedback(btn, 'success', 'COPY', '#00e5ff');
      } catch (e) {
        console.error('Copy failed:', e);
        setButtonFeedback(btn, 'error', 'COPY', '#00e5ff');
      }
    }

    // Share SPX chart to X or Discord
    async function shareSPXChart(platform) {
      const btn = platform === 'x'
        ? document.getElementById('bzila-share-x-btn')
        : document.getElementById('bzila-share-discord-btn');
      const origColor = platform === 'x' ? '#00e5ff' : '#7289da';
      const orig = btn ? btn.textContent : platform.toUpperCase();

      if (platform === 'x') {
        try {
          const canvas = document.getElementById('bzila-premium-canvas');
          if (canvas) {
            const blob = await new Promise((resolve, reject) =>
              canvas.toBlob(b => b ? resolve(b) : reject(new Error('Screenshot failed')), 'image/png')
            );
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          }
        } catch (e) {
          console.warn('X copy failed, opening Twitter anyway:', e);
        }
        window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('SPX 0DTE Premium Flow'), '_blank', 'noopener,noreferrer');
        return;
      }

      // Discord
      setButtonFeedback(btn, 'loading', orig, origColor);
      try {
        const canvas = document.getElementById('bzila-premium-canvas');
        if (!canvas) throw new Error('Canvas not found');
        const blob = await new Promise((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('Screenshot failed')), 'image/png')
        );
        const form = new FormData();
        form.append('payload_json', JSON.stringify({ content: 'SPX 0DTE Premium Flow' }));
        form.append('files[0]', blob, 'spx-premium-flow.png');
        const res = await fetch(DISCORD_WEBHOOK_URL, { method: 'POST', body: form });
        if (!res.ok) throw new Error('Discord webhook failed: ' + res.status);
        setButtonFeedback(btn, 'success', orig, origColor);
      } catch (e) {
        console.error('Discord share failed:', e);
        setButtonFeedback(btn, 'error', orig, origColor);
      }
    }

    window.shareMultiStockChart = function(symbol, platform) {
      console.log('Multi-stock share not fully implemented yet');
      alert('Multi-stock share coming soon');
    };

    function hydratePremiumFlowWhenDatabaseReady() {
      if (typeof DB !== 'undefined' && DB?.db) {
        hydratePremiumFlowFromDatabase();
        return;
      }
      window.addEventListener('db-ready', () => {
        hydratePremiumFlowFromDatabase();
      }, { once: true });
    }
    window.addEvent = function(event) {
    console.log("Flow Event Detected:", event);
    // Add logic here to display the event in your UI or feed
};

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
    async function renderPremiumChart() {
      const canvas = elements.premiumCanvas;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const parent = canvas.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : { width: 0, height: 0 };
      const W = rect.width;
      const H = rect.height;
      if (!W || !H) return;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, W, H);

      const rows = normalizeGexRows(state.gexRows);

      if (!rows.length) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for SPX GEX data...', W / 2, H / 2);
        return;
      }

      const hist = Array.isArray(state.flowHistory) ? state.flowHistory : [];

      if (!hist.length) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for SPX flow data...', W / 2, H / 2);
        return;
      }

      const series = hist.map(p => ({
        ts: Number(p.ts || Date.now()),
        call: Number(p.call || 0),
        put: -Math.abs(Number(p.put || 0))
      }));

      const values = series.flatMap(p => [p.call, p.put]);
      const minVal = Math.min(...values, 0);
      const maxVal = Math.max(...values, 0);
      const maxAbs = Math.max(Math.abs(minVal), Math.abs(maxVal), 1);

      const pad = { l: 56, r: 20, t: 22, b: 38 };
      const plotW = Math.max(1, W - pad.l - pad.r);
      const plotH = Math.max(1, H - pad.t - pad.b);
      const xAt = i => pad.l + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
      const yAt = value => pad.t + (maxAbs - value) / (maxAbs * 2) * plotH;
      const zeroY = yAt(0);

      ctx.fillStyle = '#0a0e14';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#162130';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) {
        const y = pad.t + (plotH * i) / 4;
        ctx.moveTo(pad.l, y);
        ctx.lineTo(W - pad.r, y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(pad.l, zeroY);
      ctx.lineTo(W - pad.r, zeroY);
      ctx.stroke();

      function drawLine(points, color, width = 2) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = xAt(i);
          const y = yAt(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
        points.forEach((p, i) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(xAt(i), yAt(p), 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      drawLine(series.map(p => p.call), '#22c55e', 2.5);
      drawLine(series.map(p => p.put), '#ef4444', 2.5);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      [maxAbs, maxAbs * 0.5, 0, -maxAbs * 0.5, -maxAbs].forEach(val => {
        ctx.fillText(fmtSignedMoney(val), pad.l - 8, yAt(val));
      });

      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tickCount = Math.min(series.length, 6);
      const step = Math.max(1, Math.floor(series.length / Math.max(1, tickCount - 1)));
      for (let i = 0; i < series.length; i += step) {
        ctx.fillText(new Date(series[i].ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), xAt(i), H - pad.b + 6);
      }

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = '#22c55e';
      ctx.fillText('CALL GEX', pad.l, 6);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('PUT GEX', pad.l + 90, 6);
      ctx.fillStyle = '#475569';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText('X AXIS: TIME ? Y AXIS: PREMIUM', W - pad.r, H - 10);

      const totalCallDeltaGEX = series.length ? series[series.length - 1].call : 0;
      const totalPutDeltaGEX = series.length ? Math.abs(series[series.length - 1].put) : 0;
      const net = totalCallDeltaGEX - totalPutDeltaGEX;
      state.premiumChartConfig = { totalCallDeltaGEX, totalPutDeltaGEX, net, W, H, series };
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
          feedTypesBySymbol: {
            [ES_STREAM_SYMBOL]: ['Quote', 'TimeAndSale'],
            [NQ_STREAM_SYMBOL]: ['Quote', 'TimeAndSale']
          },
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

              if (eventType !== 'Trade' && eventType !== 'TradeETH' && eventType !== 'TimeAndSale') return;

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
                processBigBlockTrade(symbol, price, size, side === 'buy' ? 1 : (side === 'sell' ? -1 : 0), timestamp);
                if (!side) return;
                const trade = { timestamp, price, size, side };
                state.esTrades.push(trade);
                if (state.esTrades.length > 5000) state.esTrades.splice(0, 1000);

              // ── NQ Futures Trade ──
              } else if (symbol.startsWith('/NQ')) {
                state.nqPrice = price;
                state.lastTradeBySymbol[symbol] = price;
                processBigBlockTrade(symbol, price, size, side === 'buy' ? 1 : (side === 'sell' ? -1 : 0), timestamp);
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
        let netTotal = 0;
        state.flowHistory = sorted.map(r => {
          callTotal += Number(r.callFlow ?? r.netCallPremium ?? 0);
          putDisplayTotal += Number(r.putFlow ?? r.netPutPremium ?? 0);
          netTotal += Number(r.netFlow ?? ((r.callFlow ?? 0) - (r.putFlow ?? 0)));
          return {
            ts: Number(r.timestamp || Date.now()),
            call: callTotal,
            put: putDisplayTotal,
            net: netTotal,
            spx: Number(r.esPrice || r.spxPrice || state.spxPrice || state.esPrice || 0)
          };
        });

        state.callPremiumFlow = callTotal;
        state.putPremiumFlow = putDisplayTotal;
        state.netPremiumFlow = netTotal;
        state.dbMinuteBaseline = {
          callPremiumFlow: state.callPremiumFlow || 0,
          putPremiumFlow: state.putPremiumFlow || 0,
          netPremiumFlow: state.netPremiumFlow || 0
        };
        updateFlowLabels();
      } catch (err) {
        console.error('Bzila premium history load failed:', err);
      }
    }

    let animFrame = null;
    let snapshotInterval = null;
    let dbMinuteInterval = null;
    let dailyResetTimeout = null;
    let reconnectTimeout = null;
    function animate() {
      renderPremiumChart();
      animFrame = requestAnimationFrame(animate);
    }

    // ── Daily reset at 9:30 AM ET ──
    function scheduleDailyReset() {
      const now = new Date();
      const utcNow = now.getUTCHours() * 60 + now.getUTCMinutes();
      const isDST = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10;
      const openUTC = isDST ? 13 * 60 + 30 : 14 * 60 + 30;
      // ms until next 9:30 AM ET
      let minsUntil = openUTC - utcNow;
      if (minsUntil <= 0) minsUntil += 24 * 60;
      dailyResetTimeout = setTimeout(async () => {
        state.callPremiumFlow = 0;
        state.putPremiumFlow  = 0;
        state.netPremiumFlow  = 0;
        state.flowHistory     = [];
        state.spxQuotes       = {};
        state.futureQuotes    = {};
        state.lastTradeBySymbol = {};
        state.seenSpxTradeKeys = new Set();
        state.seenSpxTradeOrder = [];
        state.lastFlowCross   = null;
updateFlowLabels();
        // Clear today's DB records
        if (typeof DB !== 'undefined' && DB?.db && typeof DB._getAllRecords === 'function') {
          try {
            const today = new Date().toISOString().split('T')[0];
            const all = await DB._getAllRecords('premiumFlow');
            for (const r of all.filter(r => r.date === today)) {
              const tx = DB.db.transaction('premiumFlow', 'readwrite');
              tx.objectStore('premiumFlow').delete(r.id);
              await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
            }
          } catch(e) { console.warn('Reset DB clear failed:', e); }
        }
        // Flush GEX cache so the first post-open fetch is always fresh
        state.gexRows = [];
        state.gexLastFetchTs = 0;
        refreshSpxGexRows();
        console.log('Bzila: daily reset at 9:30 AM ET');
        scheduleDailyReset();
      }, minsUntil * 60 * 1000);
    }

    // Tab switching
    window.switchBzilaTab = function(tabName) {
      const spxTab         = document.getElementById('bzila-tab-spx');
      const multiChartsTab = document.getElementById('bzila-tab-multicharts');
      const spxBtn         = document.getElementById('tab-spx');
      const multiChartsBtn = document.getElementById('tab-multicharts');

      [spxTab, multiChartsTab].forEach(t => { if (t) t.style.display = 'none'; });
      [spxBtn, multiChartsBtn].forEach(b => {
        if (b) { b.style.color = '#64748b'; b.style.borderBottomColor = 'transparent'; }
      });

      if (tabName === 'spx') {
        if (spxTab) spxTab.style.display = 'flex';
        if (spxBtn) { spxBtn.style.color = '#cbd5e1'; spxBtn.style.borderBottomColor = '#10b981'; }
      } else if (tabName === 'multicharts') {
        if (multiChartsTab) multiChartsTab.style.display = 'flex';
        if (multiChartsBtn) { multiChartsBtn.style.color = '#cbd5e1'; multiChartsBtn.style.borderBottomColor = '#10b981'; }
      }
    };

    // Initialize when page loads
    window.initBzilaFlow = function() {
      if (state.ws || animFrame || snapshotInterval) window.cleanupBzilaFlow();
      console.log('Initializing Bzila Flow...');

      // ── DIAGNOSTIC ──
      const _now = new Date();
      const _utcMins = _now.getUTCHours() * 60 + _now.getUTCMinutes();
      const _isDST = _now.getUTCMonth() >= 2 && _now.getUTCMonth() <= 10;
      const _openUTC = _isDST ? 13*60+30 : 14*60+30;
      console.log(`[Bzila] UTC time: ${_now.getUTCHours()}:${String(_now.getUTCMinutes()).padStart(2,'0')} | utcMins=${_utcMins} | openUTC=${_openUTC} | isBeforeMarketOpen=${isBeforeMarketOpen()} | isMarketOpen=${isMarketOpen()}`);
      console.log(`[Bzila] Big block controls ready`);

      // Clear stale state before market open
      if (isBeforeMarketOpen()) {
        state.callPremiumFlow = 0;
        state.putPremiumFlow  = 0;
        state.netPremiumFlow  = 0;
        state.flowHistory     = [];
console.log('[Bzila] Pre-market: state cleared to 0');
      }

      // ── Hydrate GEX stats from today's DB records ──
      async function hydrateGexStatsFromDatabase() {
        if (typeof DB === 'undefined' || !DB?.db) {
          window.addEventListener('db-ready', () => hydrateGexStatsFromDatabase(), { once: true });
          return;
        }
        try {
          const records = typeof DB.queryGexTop3_Today === 'function'
            ? await DB.queryGexTop3_Today()
            : [];
          if (!records.length) return;
          const latest = records[records.length - 1];
          if (!latest.totalCallDeltaGEX && !latest.totalPutDeltaGEX) return;
          updateDeltaGexStats([{
            callDeltaGEX: latest.totalCallDeltaGEX || 0,
            putDeltaGEX:  latest.totalPutDeltaGEX  || 0
          }].concat()); // use updateDeltaGexStats with synthetic aggregate row
          // directly set stat boxes since updateDeltaGexStats expects per-row structure
          const fmt = n => (n >= 0 ? '+' : '-') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
          const net = (latest.totalCallDeltaGEX || 0) - (latest.totalPutDeltaGEX || 0);
          const cEl = document.getElementById('bzila-call-delta-gex');
          const pEl = document.getElementById('bzila-put-delta-gex');
          const nEl = document.getElementById('bzila-net-delta-gex');
          if (cEl) cEl.textContent = fmt(latest.totalCallDeltaGEX || 0);
          if (pEl) pEl.textContent = fmt(latest.totalPutDeltaGEX  || 0);
          if (nEl) { nEl.textContent = fmt(net); nEl.style.color = net >= 0 ? '#22c55e' : '#f97316'; }
        } catch (err) {
          console.warn('GEX stats hydration failed:', err);
        }
      }

      // Re-query DOM elements now that the page is rendered
      elements.status              = document.getElementById('bzila-status');
      elements.premiumCanvas       = document.getElementById('bzila-premium-canvas');
      elements.callFlow            = document.getElementById('bzila-call-flow');
      elements.putFlow             = document.getElementById('bzila-put-flow');
      elements.netFlow             = document.getElementById('bzila-net-flow');
      elements.flowFeed            = document.getElementById('bzila-flow-feed');
      elements.flowCount           = document.getElementById('bzila-flow-count');
      elements.flowTotal           = document.getElementById('bzila-flow-total');

      updateFlowLabels();
      setupCanvas(elements.premiumCanvas);

      connectWebSocket();
      hydratePremiumFlowWhenDatabaseReady();
      hydrateGexStatsFromDatabase();
      refreshSpxGexRows();

      snapshotFlow();
      snapshotInterval = setInterval(() => {
        snapshotFlow();
        refreshSpxGexRows();
      }, 5000);

      // Slider/checkbox listeners — direct getElementById to always get live elements
      const _sl = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input',  fn); };
      const _ch = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', fn); };

      _sl('bzila-min-premium', e => {
        state.minPremiumFilter = parseInt(e.target.value);
        const v = document.getElementById('bzila-min-premium-val');
        if (v) v.textContent = state.minPremiumFilter.toLocaleString();
        renderFlowFeed(); updateFlowStats();
      });
      _ch('bzila-sweep-only', e => {
        state.sweepOnlyFilter = e.target.checked;
        renderFlowFeed(); updateFlowStats();
      });
      renderBigBlockControls();
      renderBigBlockFeed();
      loadBigTradesFromDatabase();

      animate();
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
      if (dailyResetTimeout) clearTimeout(dailyResetTimeout);
      dailyResetTimeout = null;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
      if (state.ws) state.ws.close();
      state.ws = null;
      state.seenSpxTradeKeys = new Set();
      state.seenSpxTradeOrder = [];
    };
    window.init_bzila = window.initBzilaFlow;
    window.__modernInitBzilaFlow = window.initBzilaFlow;

    function refreshBzilaData() {
      const btn = document.getElementById('bzila-refresh-btn');
      if (!btn) return;
      const orig = btn.textContent;
      const origColor = '#10b981';
      setButtonFeedback(btn, 'loading');
      btn.style.transition = 'transform 0.8s linear';
      btn.style.transform = 'rotate(360deg)';
      setTimeout(() => {
        const now = new Date();
        const el = document.getElementById('bzila-last-refresh');
        if (el) el.textContent = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        btn.style.transition = 'none';
        btn.style.transform = 'rotate(0deg)';
        setButtonFeedback(btn, 'success', orig, origColor, 1500);
      }, 800);
    }

    window.copySPXChartScreenshot = copySPXChartScreenshot;
    window.shareSPXChart = shareSPXChart;
    window.refreshBzilaData = refreshBzilaData;
  })();
