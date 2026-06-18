/**
 * Live Signals Tab - Vanilla JavaScript Version
 * No React dependency - embeds directly in HTML
 */

(function() {
  'use strict';

  class LiveSignalsTab {
    constructor() {
      this.signals = [];
      this.isConnected = false;
      this.ws = null;
      this.wsStatus = 'disconnected';
      this.signalsPanelRef = null;
      this.maxSignals = 15;
      this.DISCORD_WEBHOOK_URL = '/proxy/api/discord/webhook';
      
      // Price level tracking for LAF/LBF
      this.levels = { '/ESM6': {}, '/NQM6': {} };
      this.priceHistory = { '/ESM6': [], '/NQM6': [] };
      this.probeState = { '/ESM6': null, '/NQM6': null };
      this.lastSignalTime = {};
    }

    normalizeSymbol(symbol) {
      const sym = String(symbol || '').toUpperCase();
      if (sym.startsWith('/ES')) return '/ESM6';
      if (sym.startsWith('/NQ')) return '/NQM6';
      return sym;
    }

    normalizeFeedData(message) {
      if (message?.type !== 'FEED_DATA') return [];
      const data = message.data;
      if (Array.isArray(data) && data.length && typeof data[0] === 'object' && !Array.isArray(data[0])) {
        return data.map(item => ({
          ...item,
          eventSymbol: this.normalizeSymbol(item.eventSymbol || item.symbol || '')
        }));
      }
      if (!Array.isArray(data) || typeof data[0] !== 'string' || !Array.isArray(data[1])) return [];
      const eventType = data[0];
      const rows = data[1];
      const fieldsByType = {
        Quote: ['bidPrice', 'askPrice', 'bidSize', 'askSize'],
        Trade: ['price', 'dayVolume', 'size'],
        TradeETH: ['price', 'dayVolume', 'size']
      };
      const fields = fieldsByType[eventType];
      if (!fields) return [];
      const out = [];
      const step = fields.length + 1;
      for (let i = 0; i <= rows.length - step; i += step) {
        const item = { eventType, eventSymbol: this.normalizeSymbol(rows[i]) };
        fields.forEach((field, j) => { item[field] = rows[i + 1 + j]; });
        out.push(item);
      }
      return out;
    }

    buildFallbackLevels() {
      const es = window._esLevels || {};
      return {
        prevWeekHigh: Number(es.estUp || 0),
        prevWeekLow: Number(es.estDn || 0),
        prevDayHigh: Number(es.callWall || 0),
        prevDayLow: Number(es.putWall || 0),
        overnightHigh: Number(es.sig1Up || 0),
        overnightLow: Number(es.sig1Dn || 0)
      };
    }

    // Initialize and render component
    init(containerId) {
      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`Container #${containerId} not found`);
        return;
      }

      this.render(container);
      this.attachEventListeners();
      this.loadHtml2Canvas();

      // Fetch levels immediately on load (also fetched again on WS connect)
      this.fetchLevels();

      // Auto-connect on every load
      this.isConnected = true;
      this.connectWebSocket();
      const btn = document.getElementById('ls-connect-btn');
      if (btn) btn.textContent = '✕ Disconnect Feed';
    }

    // Render HTML structure
    render(container) {
      container.innerHTML = `
        <style>
          :root {
            --bg0:#080c10;--bg1:#0d1117;--bg2:#111822;--bg3:#1a2233;--bg4:#1f2d42;
            --border:#1e3050;--border2:#2a4060;
            --text0:#e8edf5;--text1:#a8b8cc;--text2:#5a7a99;--text3:#3a5570;
            --green:#00e676;--green2:#1fae5e;--red:#ff4757;--red2:#cc2233;
            --amber:#ffb300;--blue:#29b6f6;--cyan:#00e5ff;--purple:#7c4dff;
          }

          #live-signals-wrapper {
            display: flex;
            flex-direction: column;
            gap: 0;
            height: 100%;
            background: #05080d;
            padding: 20px;
          }

          .ls-control-panel {
            background: #0d1117;
            border: 1px solid rgba(0, 229, 255, 0.2);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
          }

          .ls-panel-header {
            font-size: 18px;
            text-transform: uppercase;
            color: #8b8f98;
            letter-spacing: 0.05em;
            margin-bottom: 16px;
            font-weight: 700;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            padding-bottom: 12px;
          }

          .ls-flex-row {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .ls-flex-col {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .ls-flex-space-between {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .ls-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            font-family: Arial, sans-serif;
            font-size: 20px;
            font-weight: 600;
            letter-spacing: .08em;
            text-transform: uppercase;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            transition: all .15s;
            background: transparent;
            color: var(--text1);
            border: 1px solid var(--border2);
          }

          .ls-btn:hover {
            background: var(--bg3);
            color: var(--text0);
          }

          .ls-btn-active {
            background: #0a2a14;
            color: var(--green);
            border: 1px solid var(--green2);
          }

          .ls-btn-active:hover {
            background: #113a1e;
          }

          .ls-snapshot-toolbar {
            display: flex;
            gap: 2px;
            background: transparent;
            border-radius: 2px;
            padding: 2px;
          }

          .ls-snapshot-btn {
            font-size: 16px;
            padding: 2px 8px;
            border: none;
            border-radius: 2px;
            background: transparent;
            color: #00e5ff;
            cursor: pointer;
            font-family: Arial, sans-serif;
            font-weight: 700;
            transition: all 0.15s;
          }

          .ls-snapshot-btn:hover {
            background: rgba(0, 229, 255, 0.1);
          }

          .ls-snapshot-btn.loading {
            color: #ffb300;
          }

          .ls-snapshot-btn.success {
            color: #00e676;
          }

          .ls-snapshot-btn.error {
            color: #ff4757;
          }

          .ls-snapshot-btn-discord {
            color: #7289da;
          }

          .ls-tag {
            font-size: 18px;
            padding: 2px 8px;
            border-radius: 2px;
            text-transform: uppercase;
            letter-spacing: .1em;
            font-weight: 700;
            display: inline-flex;
            align-items: center;
            white-space: nowrap;
          }

          .ls-tag-live {
            background: #0a2a14;
            color: var(--green);
            border: 1px solid #1fae5e44;
          }

          .ls-tag-err {
            background: #2a0a0a;
            color: var(--red);
            border: 1px solid #ff475744;
          }

          .ls-tag-warn {
            background: #2a1a00;
            color: var(--amber);
            border: 1px solid #ffb30044;
          }

          .ls-signals-panel {
            background: #141519;
            border: 1px solid #23252b;
            border-radius: 8px;
            padding: 20px;
            flex: 1;
            overflow: auto;
          }

          .ls-signal-row {
            border: 1px solid var(--border);
            background: var(--bg1);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 12px;
            transition: all .15s;
          }

          .ls-signal-row:hover {
            background: var(--bg2);
            border-color: var(--border2);
          }

          .ls-logic-box {
            background: var(--bg3);
            border-left: 2px solid var(--blue);
            padding: 10px 12px;
            border-radius: 0 4px 4px 0;
            margin-top: 12px;
            font-size: 22px;
            color: var(--text1);
            display: flex;
            gap: 8px;
            align-items: flex-start;
          }

          .ls-logic-box.laf {
            border-left-color: var(--red);
          }

          .ls-logic-box.lbf {
            border-left-color: var(--green);
          }

          .ls-empty-state {
            height: 300px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
          }

          .ls-pulse {
            animation: ls-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
          }

          @keyframes ls-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: .4; }
          }

          .ls-snapshot-capture {
            background-color: #05080d;
            padding: 10px;
            border-radius: 4px;
          }

          .ls-text-0 { color: var(--text0); }
          .ls-text-1 { color: var(--text1); }
          .ls-text-2 { color: var(--text2); }
          .ls-text-3 { color: var(--text3); }
          .ls-pos { color: var(--green); }
          .ls-neg { color: var(--red); }
          .ls-cyn { color: var(--cyan); }
        </style>

        <div id="live-signals-wrapper">
          <!-- Control Panel -->
          <div class="ls-control-panel">
            <div class="ls-panel-header">
              <div class="ls-flex-row">
                <span class="ls-cyn">⚙</span>
                <span>dxLink Live Signals Feed</span>
              </div>
              <span class="ls-tag ls-tag-warn" id="ls-status-tag">DISCONNECTED</span>
            </div>

            <div class="ls-flex-space-between">
              <div class="ls-flex-col" style="gap: 4px;">
                <h1 style="font-size: 18px; color: var(--text0); font-weight: 700; letter-spacing: 0.02em;">
                  Failed Auction Signals Feed
                </h1>
                <p class="ls-text-2" style="font-size: 22px;">
                  Real-time LAF/LBF signal detection from dxLink websocket stream.
                </p>
              </div>
              
              <button id="ls-connect-btn" class="ls-btn ls-btn-active" style="padding: 8px 16px;">
                ⚡ Connect Webhook
              </button>
            </div>
          </div>

          <!-- Key Levels Info Box -->
          <div style="border:1px solid rgba(0,229,255,.2);border-radius:6px;padding:12px 14px;margin-top:10px;background:rgba(0,229,255,.03)">
            <div style="font-size:18px;color:var(--cyan);font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">Key Levels</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
              <!-- ESM6 -->
              <div>
                <div style="font-size:18px;color:#ffb300;font-weight:800;letter-spacing:.12em;margin-bottom:6px">/ESM6</div>
                <div style="display:flex;flex-direction:column;gap:4px;font-size:20px">
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Week High</span><span id="ls-level-es-pwh" style="color:#00e676;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Week Low</span><span id="ls-level-es-pwl" style="color:#ff4757;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Day High</span><span id="ls-level-es-pdh" style="color:#00e676;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Day Low</span><span id="ls-level-es-pdl" style="color:#ff4757;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Overnight High</span><span id="ls-level-es-onh" style="color:#7cff6b;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Overnight Low</span><span id="ls-level-es-onl" style="color:#ff9f43;font-weight:700">--</span></div>
                </div>
              </div>
              <!-- NQM6 -->
              <div>
                <div style="font-size:18px;color:#ff5ec4;font-weight:800;letter-spacing:.12em;margin-bottom:6px">/NQM6</div>
                <div style="display:flex;flex-direction:column;gap:4px;font-size:20px">
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Week High</span><span id="ls-level-nq-pwh" style="color:#00e676;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Week Low</span><span id="ls-level-nq-pwl" style="color:#ff4757;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Day High</span><span id="ls-level-nq-pdh" style="color:#00e676;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Prev Day Low</span><span id="ls-level-nq-pdl" style="color:#ff4757;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Overnight High</span><span id="ls-level-nq-onh" style="color:#7cff6b;font-weight:700">--</span></div>
                  <div style="display:flex;justify-content:space-between"><span style="color:var(--text3)">Overnight Low</span><span id="ls-level-nq-onl" style="color:#ff9f43;font-weight:700">--</span></div>
                </div>
              </div>
            </div>
          </div>

          <!-- Signals Panel -->
          <div class="ls-signals-panel">
            <div class="ls-panel-header">
              <div class="ls-flex-row">
                <span>⚡</span>
                <span>Incoming Signals</span>
              </div>
              
              <div class="ls-snapshot-toolbar">
                <button id="ls-copy-shot-btn" class="ls-snapshot-btn" title="Copy screenshot to clipboard">COPY</button>
                <button id="ls-share-x-btn" class="ls-snapshot-btn" title="Copy and open X">X</button>
                <button id="ls-share-discord-btn" class="ls-snapshot-btn ls-snapshot-btn-discord" title="Post to Discord webhook">DISCORD</button>
              </div>
            </div>

            <div id="ls-signals-list" class="ls-flex-col" style="gap: 0px;">
              <div class="ls-empty-state">
                <span style="font-size: 24px;">⏳</span>
                <p class="ls-text-2 ls-uppercase" style="font-size: 20px; font-weight: 600; letter-spacing: .1em;">
                  Awaiting Live Signals...
                </p>
              </div>
            </div>
          </div>
        </div>
      `;

      this.signalsPanelRef = document.getElementById('ls-signals-list');
    }

    // Attach event listeners
    attachEventListeners() {
      const connectBtn = document.getElementById('ls-connect-btn');
      const copyBtn = document.getElementById('ls-copy-shot-btn');
      const xBtn = document.getElementById('ls-share-x-btn');
      const discordBtn = document.getElementById('ls-share-discord-btn');

      if (connectBtn) {
        connectBtn.addEventListener('click', () => this.toggleConnection());
      }
      if (copyBtn) {
        copyBtn.addEventListener('click', () => this.copyScreenshot());
      }
      if (xBtn) {
        xBtn.addEventListener('click', () => this.shareX());
      }
      if (discordBtn) {
        discordBtn.addEventListener('click', () => this.shareDiscord());
      }
    }

    // Toggle WebSocket connection
    toggleConnection() {
      this.isConnected = !this.isConnected;
      const btn = document.getElementById('ls-connect-btn');
      
      if (this.isConnected) {
        this.connectWebSocket();
        if (btn) btn.textContent = '✕ Disconnect Feed';
      } else {
        this.disconnectWebSocket();
        if (btn) btn.textContent = '⚡ Connect Webhook';
      }
    }

    // Connect to /ws/dxlink
    connectWebSocket() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const wsUrl = `${protocol}://localhost:3001/ws/dxlink`;

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[Live Signals] WebSocket connected');
          this.updateStatus('connected');
          
          // Fetch current price levels
          this.fetchLevels();
          
          // Subscribe to ES and NQ futures only
          this.ws.send(JSON.stringify({
            type: 'subscribe',
            symbols: ['/ESM26', '/NQM26', '/ESM6', '/NQM6']
          }));
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.normalizeFeedData(data).forEach(item => this.processSignal(item));
          } catch (err) {
            console.error('WebSocket parse error:', err);
          }
        };

        this.ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          this.updateStatus('error');
        };

        this.ws.onclose = () => {
          console.log('[Live Signals] WebSocket disconnected');
          this.updateStatus('disconnected');
          this.isConnected = false;
        };
      } catch (err) {
        console.error('WebSocket connection failed:', err);
        this.updateStatus('error');
      }
    }

    // Disconnect WebSocket
    disconnectWebSocket() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.updateStatus('disconnected');
    }

    // Update status indicator
    updateStatus(status) {
      const tag = document.getElementById('ls-status-tag');
      if (!tag) return;

      this.wsStatus = status;
      
      if (status === 'connected') {
        tag.className = 'ls-tag ls-tag-live ls-pulse';
        tag.textContent = 'LIVE FEED ACTIVE';
      } else if (status === 'error') {
        tag.className = 'ls-tag ls-tag-err';
        tag.textContent = 'ERROR';
      } else {
        tag.className = 'ls-tag ls-tag-warn';
        tag.textContent = 'DISCONNECTED';
      }
    }

    // proxy removed — levels fetch disabled; using fallback levels
    async fetchLevels(attempt = 1) {
      try {
        // proxy/api/levels removed
        if (false) {
          const data = {};
          this.levels = data.levels || {};
          console.log('[Live Signals] Fetched levels:', JSON.stringify(this.levels));

          // Check if any levels actually populated
          const es = this.levels['/ESM6'] || {};
          const hasData = es.prevDayHigh || es.overnightHigh || es.prevWeekHigh;

          if (!hasData && attempt < 5) {
            console.log(`[Live Signals] Levels empty, retrying in 3s (attempt ${attempt})`);
            setTimeout(() => this.fetchLevels(attempt + 1), 3000);
            return;
          }

          this.renderLevelBox();
        } else {
          const fallback = this.buildFallbackLevels();
          if (Object.keys(fallback).length) {
            this.levels = { '/ESM6': fallback, '/NQM6': this.levels['/NQM6'] || {} };
            this.renderLevelBox();
            return;
          }
          console.error('[Live Signals] Levels fetch failed:', res.status);
        }
      } catch (err) {
        const fallback = this.buildFallbackLevels();
        if (Object.keys(fallback).length) {
          this.levels = { '/ESM6': fallback, '/NQM6': this.levels['/NQM6'] || {} };
          this.renderLevelBox();
          return;
        }
        console.error('[Live Signals] Level fetch error:', err);
      }
    }

    renderLevelBox() {
      const fmt = v => v ? v.toFixed(2) : '--';
      const es = this.levels['/ESM6'] || {};
      const nq = this.levels['/NQM6'] || {};
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
      set('ls-level-es-pwh', es.prevWeekHigh); set('ls-level-es-pwl', es.prevWeekLow);
      set('ls-level-es-pdh', es.prevDayHigh);  set('ls-level-es-pdl', es.prevDayLow);
      set('ls-level-es-onh', es.overnightHigh); set('ls-level-es-onl', es.overnightLow);
      set('ls-level-nq-pwh', nq.prevWeekHigh); set('ls-level-nq-pwl', nq.prevWeekLow);
      set('ls-level-nq-pdh', nq.prevDayHigh);  set('ls-level-nq-pdl', nq.prevDayLow);
      set('ls-level-nq-onh', nq.overnightHigh); set('ls-level-nq-onl', nq.overnightLow);
    }

    // Process dxLink FEED_DATA and detect LAF/LBF
    processSignal(feedData) {
      const symbol = this.normalizeSymbol(feedData.eventSymbol);
      if (!symbol) return;

      // Only process ES and NQ futures
      const allowed = ['/ESM6', '/NQM6'];
      if (!allowed.includes(symbol)) return;

      // Extract price from Quote (mid) or Trade
      let price = 0;
      if (feedData.eventType === 'Quote') {
        const bid = parseFloat(feedData.bidPrice) || 0;
        const ask = parseFloat(feedData.askPrice) || 0;
        price = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
      } else {
        price = parseFloat(feedData.price) || 0;
      }

      if (price === 0) return; // skip empty ticks

      // Track price history (keep last 50 ticks)
      if (!this.priceHistory[symbol]) this.priceHistory[symbol] = [];
      this.priceHistory[symbol].push(price);
      if (this.priceHistory[symbol].length > 50) {
        this.priceHistory[symbol].shift();
      }

      // Detect LAF/LBF based on level probes
      this.detectLevelProbe(symbol, price);
    }

    // Detect when price probes beyond key levels and reverses
    detectLevelProbe(symbol, currentPrice) {
      const levels = this.levels[symbol] || {};
      if (!levels.prevDayHigh) return; // levels not loaded yet

      const probe = this.probeState[symbol];
      const now = Date.now();
      const cooldown = 60000; // Don't emit signal more than once per minute per symbol
      const lastSignal = this.lastSignalTime[symbol] || 0;
      if (now - lastSignal < cooldown) return;

      // Threshold for reversal (0.015% of price)
      const threshold = Math.max(0.25, currentPrice * 0.00015);

      // Check if price probed above prevDayHigh and is now reversing (LAF)
      if (!probe || probe.type !== 'above') {
        if (currentPrice > levels.prevDayHigh + threshold) {
          this.probeState[symbol] = { type: 'above', level: levels.prevDayHigh, price: currentPrice };
        }
      } else if (probe.type === 'above' && currentPrice < probe.price - threshold) {
        // Reversal confirmed: probed above, now reversing down
        this.emitSignal(symbol, 'LAF', currentPrice, levels.prevDayHigh, 'prev day high');
        this.probeState[symbol] = null;
        this.lastSignalTime[symbol] = now;
        return;
      }

      // Check if price probed below prevDayLow and is now reversing (LBF)
      if (!probe || probe.type !== 'below') {
        if (currentPrice < levels.prevDayLow - threshold) {
          this.probeState[symbol] = { type: 'below', level: levels.prevDayLow, price: currentPrice };
        }
      } else if (probe.type === 'below' && currentPrice > probe.price + threshold) {
        // Reversal confirmed: probed below, now reversing up
        this.emitSignal(symbol, 'LBF', currentPrice, levels.prevDayLow, 'prev day low');
        this.probeState[symbol] = null;
        this.lastSignalTime[symbol] = now;
        return;
      }

      // Similarly check overnight levels
      if (levels.overnightHigh) {
        if (!probe || probe.type !== 'above-on') {
          if (currentPrice > levels.overnightHigh + threshold) {
            this.probeState[symbol] = { type: 'above-on', level: levels.overnightHigh, price: currentPrice };
          }
        } else if (probe.type === 'above-on' && currentPrice < probe.price - threshold) {
          this.emitSignal(symbol, 'LAF', currentPrice, levels.overnightHigh, 'overnight high');
          this.probeState[symbol] = null;
          this.lastSignalTime[symbol] = now;
          return;
        }
      }

      if (levels.overnightLow) {
        if (!probe || probe.type !== 'below-on') {
          if (currentPrice < levels.overnightLow - threshold) {
            this.probeState[symbol] = { type: 'below-on', level: levels.overnightLow, price: currentPrice };
          }
        } else if (probe.type === 'below-on' && currentPrice > probe.price + threshold) {
          this.emitSignal(symbol, 'LBF', currentPrice, levels.overnightLow, 'overnight low');
          this.probeState[symbol] = null;
          this.lastSignalTime[symbol] = now;
          return;
        }
      }

      // Check prev week high/low
      if (levels.prevWeekHigh) {
        if (!probe || probe.type !== 'above-pw') {
          if (currentPrice > levels.prevWeekHigh + threshold) {
            this.probeState[symbol] = { type: 'above-pw', level: levels.prevWeekHigh, price: currentPrice };
          }
        } else if (probe.type === 'above-pw' && currentPrice < probe.price - threshold) {
          this.emitSignal(symbol, 'LAF', currentPrice, levels.prevWeekHigh, 'prev week high');
          this.probeState[symbol] = null;
          this.lastSignalTime[symbol] = now;
          return;
        }
      }

      if (levels.prevWeekLow) {
        if (!probe || probe.type !== 'below-pw') {
          if (currentPrice < levels.prevWeekLow - threshold) {
            this.probeState[symbol] = { type: 'below-pw', level: levels.prevWeekLow, price: currentPrice };
          }
        } else if (probe.type === 'below-pw' && currentPrice > probe.price + threshold) {
          this.emitSignal(symbol, 'LBF', currentPrice, levels.prevWeekLow, 'prev week low');
          this.probeState[symbol] = null;
          this.lastSignalTime[symbol] = now;
          return;
        }
      }
    }

    // Emit LAF/LBF signal
    emitSignal(symbol, type, currentPrice, level, levelName) {
      const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });

      const lafLogics = [
        `Probe above ${levelName} (${level.toFixed(2)}) but failed to hold. Reversal triggered.`,
        "Trapped buyers above the level. Momentum couldn't sustain the break.",
        "Value rejection: Price rejected above the key level.",
        "Lack of follow-through: Volume dried up after the probe."
      ];

      const lbfLogics = [
        `Probe below ${levelName} (${level.toFixed(2)}) but couldn't sustain. Reversal up.`,
        "Trapped sellers below the level. Momentum collapse triggered bounce.",
        "Value absorption: Price rejected below the key level.",
        "Stop hunt failed: Unable to drive lower despite the probe."
      ];

      const logicPool = type === 'LAF' ? lafLogics : lbfLogics;
      const logic = logicPool[Math.floor(Math.random() * logicPool.length)];

      const signal = {
        id: Date.now(),
        asset: symbol,
        type,
        price: currentPrice.toFixed(2),
        timestamp,
        status: 'Setup Detected',
        logic
      };

      this.signals.unshift(signal);
      if (this.signals.length > this.maxSignals) {
        this.signals.pop();
      }

      this.renderSignals();
    }

    // Old processSignal code (keep for reference - now replaced above)

    // Render signals list
    renderSignals() {
      if (!this.signalsPanelRef) return;

      if (this.signals.length === 0) {
        this.signalsPanelRef.innerHTML = `
          <div class="ls-empty-state">
            <span style="font-size: 24px;">⏳</span>
            <p class="ls-text-2 ls-uppercase" style="font-size: 20px; font-weight: 600; letter-spacing: .1em;">
              ${this.isConnected ? 'Awaiting Live Signals...' : 'Connect feed to start listening'}
            </p>
          </div>
        `;
        return;
      }

      this.signalsPanelRef.innerHTML = this.signals.map(signal => `
        <div class="ls-signal-row">
          <div class="ls-flex-space-between" style="margin-bottom: 8px;">
            <div class="ls-flex-row" style="gap: 16px;">
              <span style="font-size: 18px;">
                ${signal.type === 'LAF' ? '📉' : '📈'}
              </span>
              <div class="ls-flex-col" style="gap: 2px;">
                <span style="font-size: 14px; font-weight: 700; color: var(--text0);">
                  ${signal.asset}
                </span>
                <div class="ls-flex-row" style="gap: 12px; font-size: 20px;">
                  <span class="ls-text-2 ls-flex-row" style="gap: 4px;">
                    🕐 ${signal.timestamp}
                  </span>
                  <span class="ls-text-3">|</span>
                  <span class="ls-text-1">Price: <span class="ls-text-0">${signal.price}</span></span>
                </div>
              </div>
            </div>

            <div class="ls-flex-col" style="align-items: flex-end; gap: 6px;">
              <span class="ls-tag ${signal.type === 'LAF' ? 'ls-tag-err' : 'ls-tag-live'}">
                ${signal.type} Setup
              </span>
              <span class="ls-text-2" style="font-size: 18px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">
                ${signal.type === 'LAF' ? 'Short Bias' : 'Long Bias'}
              </span>
            </div>
          </div>

          <div class="ls-logic-box ${signal.type.toLowerCase()}">
            <span style="margin-top: 2px; flex-shrink: 0;">⚡</span>
            <div class="ls-flex-col" style="gap: 2px;">
              <span style="font-size: 18px; text-transform: uppercase; color: var(--text2); font-weight: 700;">
                Trigger Logic
              </span>
              <span style="line-height: 1.4;">${signal.logic}</span>
            </div>
          </div>
        </div>
      `).join('');
    }

    // Load html2canvas library
    loadHtml2Canvas() {
      if (typeof html2canvas !== 'undefined') return;
      
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => console.log('[Live Signals] html2canvas loaded');
      script.onerror = () => console.error('[Live Signals] html2canvas failed to load');
      document.head.appendChild(script);
    }

    // Copy screenshot
    async copyScreenshot() {
      const btn = document.getElementById('ls-copy-shot-btn');
      if (!btn) return;

      const originalText = btn.textContent;
      btn.textContent = '…';
      btn.classList.add('loading');

      try {
        if (typeof html2canvas === 'undefined') {
          throw new Error('html2canvas not loaded');
        }

        const panel = document.getElementById('live-signals-wrapper');
        if (!panel) throw new Error('Panel not found');

        const wrapper = document.createElement('div');
        wrapper.className = 'ls-snapshot-capture';
        wrapper.style.display = 'inline-block';
        wrapper.style.position = 'fixed';
        wrapper.style.top = '-9999px';
        wrapper.style.left = '-9999px';
        wrapper.style.zIndex = '-1';
        
        const panelClone = panel.cloneNode(true);
        wrapper.appendChild(panelClone);
        document.body.appendChild(wrapper);

        const shot = await html2canvas(wrapper, {
          backgroundColor: '#05080d',
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        });

        document.body.removeChild(wrapper);

        shot.toBlob(async blob => {
          try {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            
            btn.textContent = '✓';
            btn.style.color = '#00e676';
            btn.classList.remove('loading');
            btn.classList.add('success');
            
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = '#00e5ff';
              btn.classList.remove('success');
            }, 1500);
          } catch (e) {
            throw e;
          }
        }, 'image/png');
      } catch (err) {
        console.error('Screenshot error:', err);
        btn.textContent = 'ERR';
        btn.style.color = '#ff4757';
        btn.classList.remove('loading');
        btn.classList.add('error');
        
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.color = '#00e5ff';
          btn.classList.remove('error');
        }, 1500);
      }
    }

    // Share to X
    async shareX() {
      const btn = document.getElementById('ls-share-x-btn');
      if (!btn) return;

      const originalText = btn.textContent;
      btn.textContent = '…';
      btn.style.color = '#ffb300';

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.color = '#00e5ff';
        window.open('https://twitter.com/intent/tweet?text=Live+Signals+Feed+%23Trading', '_blank');
      }, 300);
    }

    // Share to Discord
    async shareDiscord() {
      const btn = document.getElementById('ls-share-discord-btn');
      if (!btn) return;

      const originalText = btn.textContent;
      btn.textContent = '…';
      btn.style.color = '#ffb300';

      try {
        if (typeof html2canvas === 'undefined') {
          throw new Error('html2canvas not loaded');
        }

        const panel = document.getElementById('live-signals-wrapper');
        if (!panel) throw new Error('Panel not found');

        const wrapper = document.createElement('div');
        wrapper.className = 'ls-snapshot-capture';
        wrapper.style.display = 'inline-block';
        wrapper.style.position = 'fixed';
        wrapper.style.top = '-9999px';
        wrapper.style.left = '-9999px';
        wrapper.style.zIndex = '-1';
        
        const panelClone = panel.cloneNode(true);
        wrapper.appendChild(panelClone);
        document.body.appendChild(wrapper);

        const shot = await html2canvas(wrapper, {
          backgroundColor: '#05080d',
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        });

        document.body.removeChild(wrapper);

        shot.toBlob(async blob => {
          try {
            const form = new FormData();
            form.append('payload_json', JSON.stringify({ 
              content: `Live Signals Feed - ${new Date().toLocaleTimeString()}` 
            }));
            form.append('files[0]', blob, 'live-signals.png');

            const res = await fetch(this.DISCORD_WEBHOOK_URL, {
              method: 'POST',
              body: form
            });

            if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);

            btn.textContent = '✓';
            btn.style.color = '#00e676';
            
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.color = '#7289da';
            }, 1500);
          } catch (e) {
            throw e;
          }
        }, 'image/png');
      } catch (err) {
        console.error('Discord share error:', err);
        btn.textContent = 'ERR';
        btn.style.color = '#ff4757';
        
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.color = '#7289da';
        }, 1500);
      }
    }
  }

  // Auto-initialize when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const tab = new LiveSignalsTab();
      tab.init('live-signals-container');
      window.liveSignalsTab = tab;
    });
  } else {
    const tab = new LiveSignalsTab();
    tab.init('live-signals-container');
    window.liveSignalsTab = tab;
  }
})();
