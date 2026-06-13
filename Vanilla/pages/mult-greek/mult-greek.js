(() => {
  window.__multGreekModuleLoaded = true;

  // ── MULT-GREEK · SPX / SPY / QQQ net greeks by strike ───────────────────────
  (function() {
    'use strict';

    var TICKERS = ['SPX', 'SPY', 'QQQ'];
    // dxlink streamer symbols for underlying spot (SPX index uses $SPX on dxfeed)
    var UNDERLYING_STREAMER = { SPX: '$SPX', SPY: 'SPY', QQQ: 'QQQ' };
    var STREAMER_TO_TICKER = {};
    Object.keys(UNDERLYING_STREAMER).forEach(function(t) { STREAMER_TO_TICKER[UNDERLYING_STREAMER[t]] = t; });

    // ── state ──────────────────────────────────────────────────────────────────
    var _expirations  = [];
    var _activeExpiry = null;
    var _strikes      = { SPX: [], SPY: [], QQQ: [] };   // per-ticker strike rows
    // Shared global greek cache — same object used by options-chain, exposure, and overview.
    // All WS Greek/Summary events from any page write here; all pages read from here.
    window.dxGreeksCache = window.dxGreeksCache || {};
    var _liveData = window.dxGreeksCache;               // alias — DO NOT reassign
    var _spot         = { SPX: 0, SPY: 0, QQQ: 0 };       // via dxlink WS
    var _ws           = null;
    var _subSymbols   = { SPX: [], SPY: [], QQQ: [] };
    var _renderTimer  = null;
    var _mgIntensity  = parseFloat(localStorage.getItem('mg_intensity')) || 0.1;
    var _contractMode = 'oivol'; // 'oivol' = volume + open interest, 'vol' = volume only
    var _loadToken    = 0;
    var _saveTimer    = null;
    var _autoSaveTimer = null;
    var _refreshTimer  = null;

    var _lastComputed = {};
    var _sliderActive = false; // block renderAll while dragging intensity slider
    var NET_COLS  = ['gex', 'dex', 'chex', 'vex'];
    var COL_LABELS = { gex: 'NET GEX', dex: 'NET DEX', chex: 'NET CHEX', vex: 'NET VEX' };
    var GRID_COLS = '64px 1fr 1fr 1fr 1fr'; // strike (left edge) + 4 net cols
    var STRIKES_PER_SIDE = 25; // same row count for every ticker: ATM ± 25

    // ── helpers ────────────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function fmtMoney(v) {
      var n = parseFloat(v);
      if (!isFinite(n) || n === 0) return '--';
      var s = n >= 0 ? '+' : '-';
      var a = Math.abs(n);
      return s + '$' + (a / 1e6).toFixed(2) + 'M';
    }

    function setStatus(state, msg) {
      var dot = el('mg-status-dot'), txt = el('mg-status-txt');
      var colors = { live: '#00e676', loading: '#ffb300', err: '#ff4757', idle: '#1e293b' };
      if (dot) dot.style.background = colors[state] || '#1e293b';
      if (txt) { txt.textContent = msg || state.toUpperCase(); txt.style.color = colors[state] || '#e4e4e7'; }
    }

    function todayETStr() {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var m = {}; parts.forEach(function(p) { m[p.type] = p.value; });
      return m.year + '-' + m.month + '-' + m.day;
    }

    function daysTo(dateStr) {
      return Math.round((new Date(dateStr) - new Date(todayETStr())) / 86400000);
    }

    function etTimeNow() {
      return new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    window.mgSetContractMode = function(mode) {
      _contractMode = mode === 'vol' ? 'vol' : 'oivol';
      ['oivol', 'vol'].forEach(function(m) {
        var btn = el('mg-mode-' + m);
        if (!btn) return;
        var active = m === _contractMode;
        btn.style.background = active ? 'rgba(0,229,255,.15)' : 'transparent';
        btn.style.color = active ? '#00e5ff' : '#64748b';
      });
      renderAll();
    };

    window.mgSetIntensity = function(val) {
      var next = Math.max(0.01, Math.min(3, parseFloat(val) || 0.1));
      _mgIntensity = next;
      localStorage.setItem('mg_intensity', next);
      var slider = el('mg-intensity');
      var label = el('mg-intensity-val');
      if (slider) slider.max = '3';
      if (slider && slider.value !== String(next)) slider.value = String(next);
      if (label) label.textContent = next.toFixed(2) + 'x';
      // Repaint cell backgrounds in-place — no innerHTML rebuild, no flicker
      TICKERS.forEach(function(ticker) {
        var computed = _lastComputed[ticker];
        if (!computed) return;
        var body = el('mg-body-' + ticker);
        if (!body) return;
        computed.rows.forEach(function(r) {
          var rowEl = body.querySelector('[data-strike="' + r.strike + '"]');
          if (!rowEl) return;
          var cells = rowEl.querySelectorAll('div');
          // cells[0] = strike, cells[1..4] = net cols
          NET_COLS.forEach(function(c, i) {
            var cell = cells[i + 1];
            if (!cell) return;
            var topRank = (computed.top3[c] && computed.top3[c][r.strike]) || 0;
            cell.style.background = metricBg(r[c], computed.maxAbs[c], topRank);
          });
        });
      });
    };

    // ── expirations (SPX list, shared across tickers) ──────────────────────────
    function fetchExpirations(cb) {
      setStatus('loading', 'LOADING...');
      var expSel = el('mg-expiry-select');
      if (expSel) expSel.innerHTML = '<option value="">Loading...</option>';

      fetch('/proxy/api/tt/expirations/SPX')
        .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
        .then(function(json) {
          var items = (json.data && json.data.items) ? json.data.items : [];
          var seen = {};
          _expirations = [];
          items.forEach(function(item) {
            var d = item['expiration-date'] || '';
            if (!d || seen[d]) return;
            seen[d] = true;
            var dt = daysTo(d);
            _expirations.push({ date: d, daysTo: dt, label: dt + 'DTE  ' + d.slice(5), type: item['expiration-type'] || '' });
          });
          _expirations.sort(function(a, b) { return a.daysTo - b.daysTo; });

          var filtered = _expirations.filter(function(e) {
            if (e.daysTo <= 7) return true;
            var expType = (e.type || '').toLowerCase();
            if (expType === 'weekly' || expType === 'monthly') return true;
            var parts = e.date.split('-');
            var d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            return d.getDay() === 5;
          });

          if (expSel) {
            expSel.innerHTML = '<option value="" style="background:#0a0e14;color:#e4e4e7">-- Expiry --</option>';
            filtered.forEach(function(exp) {
              var opt = document.createElement('option');
              opt.value = exp.date;
              opt.textContent = exp.label;
              opt.style.background = '#0a0e14';
              opt.style.color = '#e4e4e7';
              expSel.appendChild(opt);
            });
            var dte0 = filtered.filter(function(e) { return e.daysTo === 0; })[0];
            var autoSelect = dte0 || filtered[0];
            if (autoSelect) { expSel.value = autoSelect.date; _activeExpiry = autoSelect.date; }
          }
          setStatus('idle', 'READY');
          if (cb) cb();
        })
        .catch(function(e) {
          setStatus('err', 'ERR: ' + e);
          if (expSel) expSel.innerHTML = '<option value="">Error loading</option>';
        });
    }

    function bindExpirySelect() {
      var expSel = el('mg-expiry-select');
      if (!expSel || expSel._bound) return;
      expSel._bound = true;
      expSel.addEventListener('change', function() {
        _activeExpiry = this.value || null;
        if (_activeExpiry) loadAll(_activeExpiry);
      });
    }

    // ── chain fetch + strike parsing (cached like options chain page) ──────────
    function buildStrikes(expGroups) {
      var map = {};
      function safeFloat(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
      function safeInt(v) { var n = parseInt(v, 10); return isFinite(n) ? n : null; }
      expGroups.forEach(function(expGroup) {
        (expGroup.strikes || []).forEach(function(item) {
          var strike = parseFloat(item['strike-price'] || 0);
          if (!strike) return;
          var key = strike.toFixed(2);
          if (!map[key]) map[key] = { strike: strike, callSym: null, putSym: null };
          var r = map[key];
          ['call', 'put'].forEach(function(side) {
            var o = item[side];
            if (!o) return;
            var sym = o['streamer-symbol'] || o.symbol || '';
            if (side === 'call') r.callSym = sym; else r.putSym = sym;
            // Seed from REST snapshot. REST always overwrites cache-seeded values;
            // only symbols already updated by live WS data this session are kept.
            if (sym && !(_liveData[sym] && _liveData[sym]._ws)) {
              _liveData[sym] = {
                iv: safeFloat(o['implied-volatility']),
                delta: safeFloat(o.delta), gamma: safeFloat(o.gamma),
                theta: safeFloat(o.theta), vega: safeFloat(o.vega),
                oi: safeInt(o['open-interest'] || o.openInterest || o['openInterest']) || 0,
                vol: safeInt(o.volume) || 0
              };
            }
          });
        });
      });
      return Object.values(map).sort(function(a, b) { return a.strike - b.strike; });
    }

    function fetchChain(ticker, expDate, token, done) {
      var pageId = 'mult-greek-' + Date.now();

      fetch('/proxy/api/tt/chains/' + encodeURIComponent(ticker) + '?expiration=' + expDate + '&range=all&pageId=' + encodeURIComponent(pageId))
        .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP ' + r.status); })
        .then(function(json) {
          if (token !== _loadToken) return;
          var items = (json.data && json.data.items) ? json.data.items : [];
          var target = items.filter(function(i) {
            var d = i['expiration-date'] || i.expirationDate || '';
            return d && String(d).slice(0, 10) === String(expDate).slice(0, 10);
          });
          _strikes[ticker] = buildStrikes(target.length ? target : items);
          // Seed spot from REST immediately; live dxlink WS will override
          var rawSpot = json.data && json.data.underlyingPrice ? parseFloat(json.data.underlyingPrice) : 0;
          if (isFinite(rawSpot) && rawSpot > 0) _spot[ticker] = rawSpot;

          var syms = [];
          _strikes[ticker].forEach(function(r) {
            if (r.callSym) syms.push(r.callSym);
            if (r.putSym) syms.push(r.putSym);
          });
          _subSymbols[ticker] = syms;

          // Wait for subscription to be ready (use manager instead of hoping)
          if (syms.length > 0) {
            fetch('/proxy/api/subscription-ready', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pageId: pageId,
                symbols: syms,
                timeout: 2000,
                threshold: 0.5
              })
            })
            .then(function(r) { return r.json(); })
            .then(function(readyData) {
              console.log('[MultGreek] ' + ticker + ' subscription ready:', readyData);
              done(null);
            })
            .catch(function(e) {
              console.warn('[MultGreek] subscription-ready call failed:', e);
              done(null);  // Continue anyway
            });
          } else {
            done(null);
          }
        })
        .catch(function(e) { done(e); });
    }

    function loadAll(expDate) {
      _loadToken += 1;
      var token = _loadToken;
      setStatus('loading', 'LOADING...');
      buildPanels();
      TICKERS.forEach(function(t) { setPanelMsg(t, 'Loading chain...'); });

      var pending = TICKERS.length;
      var errors = [];

      TICKERS.forEach(function(ticker) {
        // IDB cache first — render instantly on hit, then refresh from REST
        loadCacheEntry(ticker, expDate, function(cached) {
          if (token !== _loadToken) return;
          if (cached && cached.strikes && cached.strikes.length) {
            _strikes[ticker] = cached.strikes;
            _subSymbols[ticker] = (cached.symbols || []).slice();
            Object.keys(cached.liveData || {}).forEach(function(sym) {
              if (!_liveData[sym]) _liveData[sym] = cached.liveData[sym];
            });
            if (cached.spot && !_spot[ticker]) _spot[ticker] = cached.spot;
            renderPanel(ticker);
            setStatus('loading', 'CACHED — refreshing...');
          }
          fetchChain(ticker, expDate, token, function(err) {
            if (token !== _loadToken) return;
            if (err) { errors.push(ticker + ': ' + err); setPanelMsg(ticker, 'Failed to load'); }
            else renderPanel(ticker);
            pending -= 1;
            if (pending === 0) finalizeLoad(token, errors);
          });
        });
      });
    }

    function finalizeLoad(token, errors) {
      if (token !== _loadToken) return;
      // Quick re-fetch at 5s, 15s, then every 30s — proxy caches fill in during that time
      if (_refreshTimer) clearInterval(_refreshTimer);
      var _quickRefreshes = [5000, 15000];
      function scheduleNextRefresh(token) {
        var delay = _quickRefreshes.length ? _quickRefreshes.shift() : 30000;
        _refreshTimer = setTimeout(function() {
          if (token !== _loadToken || !_activeExpiry) return;
          TICKERS.forEach(function(ticker) {
            fetchChain(ticker, _activeExpiry, token, function(err) {
              if (!err && token === _loadToken) renderPanel(ticker);
            });
          });
          if (_quickRefreshes.length === 0) {
            // switch to interval after quick refreshes done
            _refreshTimer = setInterval(function() {
              if (_activeExpiry && isMarketOpen() && token === _loadToken) {
                TICKERS.forEach(function(ticker) {
                  fetchChain(ticker, _activeExpiry, token, function(err) {
                    if (!err && token === _loadToken) renderPanel(ticker);
                  });
                });
              }
            }, 30000);
          } else {
            scheduleNextRefresh(token);
          }
        }, delay);
      }
      scheduleNextRefresh(token);
      // sync spot from overview's dxQuoteCache every second
      if (_spotSyncTimer) clearInterval(_spotSyncTimer);
      _spotSyncTimer = setInterval(syncSpotFromCache, 1000);
      syncSpotFromCache(); // immediate first sync
      if (errors.length) setStatus('err', 'PARTIAL: ' + errors.length + ' ERR');
      else if (!isMarketOpen()) setStatus('idle', 'CLOSED — LIVE AT 9:30 ET');
      else setStatus('live', 'LIVE');
      renderAll();
      // save after live data has streamed in for a bit
      if (_saveTimer) clearTimeout(_saveTimer);
      _saveTimer = setTimeout(function() { if (token === _loadToken) saveAllCaches(); }, 10000);
    }

    // ── dxlink websocket (spot + greeks + OI/vol via proxy WS bridge) ──────────
    function connectDxLink() {
      if (_ws && _ws.readyState === 1) { wsSubscribe(); return; }
      if (_ws) { try { _ws.close(); } catch (e) {} _ws = null; }
      _ws = new WebSocket((window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws/dxlink');
      _ws.onopen = function() { setStatus('live', 'LIVE'); wsSubscribe(); };
      _ws.onmessage = function(e) { handleMsg(e.data); };
      _ws.onclose = function() { setStatus('idle', 'DISCONNECTED'); _ws = null; };
      _ws.onerror = function() { setStatus('err', 'WS ERR'); };
    }

    function allSubSymbols() {
      var syms = [];
      TICKERS.forEach(function(t) { syms = syms.concat(_subSymbols[t] || []); });
      TICKERS.forEach(function(t) { syms.push(UNDERLYING_STREAMER[t]); });
      return syms;
    }

    function feedTypesFor(symbols) {
      var map = {};
      symbols.forEach(function(s) {
        map[s] = STREAMER_TO_TICKER[s] ? ['Quote', 'Trade'] : ['Quote', 'Greeks', 'Summary', 'Trade'];
      });
      return map;
    }

    function wsSubscribe() {
      var symbols = allSubSymbols();
      if (!symbols.length || !_ws || _ws.readyState !== 1) return;
      try {
        _ws.send(JSON.stringify({ type: 'subscribe', symbols: symbols, feedTypesBySymbol: feedTypesFor(symbols) }));
      } catch (err) {}
    }

    function sendSubscriptions() {
      var symbols = allSubSymbols();
      if (!symbols.length) return;
      // REST POST — the WS path is gated and blocks non-SPXW option symbols
      fetch('/proxy/dxlink/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: symbols, feedTypesBySymbol: feedTypesFor(symbols) })
      }).catch(function(e) { console.warn('[MultGreek] subscribe POST failed:', e); });
      wsSubscribe();
    }

    function isMarketOpen() {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(new Date());
      var m = {}; parts.forEach(function(p) { m[p.type] = p.value; });
      if (m.weekday === 'Sat' || m.weekday === 'Sun') return false;
      var mins = parseInt(m.hour, 10) * 60 + parseInt(m.minute, 10);
      return mins >= 570 && mins < 960; // 9:30–16:00 ET
    }

    // ── sync spot from global dxQuoteCache (overview WS) ─────────────────────────
    var _spotSyncTimer = null;
    var DX_SPOT_KEYS = { SPX: ['$SPX', 'SPX'], SPY: ['SPY'], QQQ: ['QQQ'] };
    function syncSpotFromCache() {
      var cache = window.dxQuoteCache || {};
      TICKERS.forEach(function(t) {
        var keys = DX_SPOT_KEYS[t] || [t];
        for (var i = 0; i < keys.length; i++) {
          var q = cache[keys[i]];
          if (!q) continue;
          var mid = (q.bidPrice > 0 && q.askPrice > 0) ? (q.bidPrice + q.askPrice) / 2 : 0;
          // prefer mid (bid+ask)/2 for ETFs as it tracks real-time better than last trade
          var p = parseFloat(mid || q.last || q.price || q.mark || 0);
          if (p > 0) {
            _spot[t] = p;
            // update spot display directly — no full re-render needed
            var spotEl = el('mg-spot-' + t);
            if (spotEl) spotEl.textContent = p.toFixed(2);
            break;
          }
        }
      });
    }

    function handleMsg(raw) {
      if (!isMarketOpen()) return; // freeze data outside RTH (no pre/post-market ticks)
      var msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type !== 'FEED_DATA') return;
      var data = msg.data;
      if (!Array.isArray(data)) return;
      var changed = false;
      data.forEach(function(ev) {
        if (!ev || !ev.eventSymbol) return;
        var sym = ev.eventSymbol;
        var underlyingTicker = STREAMER_TO_TICKER[sym];

        if (underlyingTicker) {
          // spot price also updated via syncSpotFromCache interval; WS still updates too
          if (ev.eventType === 'Trade' && ev.price > 0) { _spot[underlyingTicker] = ev.price; changed = true; }
          else if (ev.eventType === 'Quote' && ev.bidPrice > 0 && ev.askPrice > 0) {
            _spot[underlyingTicker] = (ev.bidPrice + ev.askPrice) / 2; changed = true;
          }
          return;
        }

        if (!_liveData[sym]) _liveData[sym] = {};
        var d = _liveData[sym];
        d._ws = true; // live WS data takes precedence over REST/cache seeds
        var t = ev.eventType;
        if (t === 'Greeks') {
          if (ev.volatility != null) d.iv = ev.volatility;
          if (ev.delta != null) d.delta = ev.delta;
          if (ev.gamma != null) d.gamma = ev.gamma;
          if (ev.theta != null) d.theta = ev.theta;
          if (ev.vega != null) d.vega = ev.vega;
          changed = true;
        } else if (t === 'Summary') {
          if (ev.openInterest != null) d.oi = ev.openInterest;
          else if (ev['open-interest'] != null) d.oi = ev['open-interest'];
          else if (ev.open_interest != null) d.oi = ev.open_interest;
          if (ev.dayVolume != null) d.vol = ev.dayVolume;
          changed = true;
        } else if (t === 'Trade') {
          if (ev.dayVolume != null && ev.dayVolume > 0) d.vol = ev.dayVolume;
          changed = true;
        } else if (t === 'Quote') {
          if (ev.bidPrice != null) d.bid = ev.bidPrice;
          if (ev.askPrice != null) d.ask = ev.askPrice;
          changed = true;
        }
      });
      if (changed) scheduleRender();
    }

    function scheduleRender() {
      if (_renderTimer || _sliderActive) return;
      _renderTimer = setTimeout(function() {
        _renderTimer = null;
        if (!_sliderActive) renderAll();
      }, 150);
    }

    // ── IDB cache (clears at midnight ET, same pattern as options chain) ───────
    var _IDB_NAME = 'multGreekCache';
    var _IDB_STORE = 'chains';
    var _IDB_META = 'meta';
    var _idb = null;

    function openIDB(cb) {
      if (_idb) { cb(_idb); return; }
      var req = indexedDB.open(_IDB_NAME, 1);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(_IDB_META)) db.createObjectStore(_IDB_META, { keyPath: 'key' });
      };
      req.onsuccess = function(e) { _idb = e.target.result; cb(_idb); };
      req.onerror = function() { console.warn('[MultGreek IDB] open failed'); cb(null); };
    }

    function idbPurgeIfStale(db, cb) {
      var today = todayETStr();
      var tx = db.transaction([_IDB_META, _IDB_STORE], 'readwrite');
      var meta = tx.objectStore(_IDB_META);
      meta.get('date').onsuccess = function(e) {
        var stored = e.target.result ? e.target.result.value : null;
        if (stored === today) { cb(); return; }
        tx.objectStore(_IDB_STORE).clear();
        meta.put({ key: 'date', value: today });
        tx.oncomplete = cb;
      };
    }

    function saveCache(ticker, expiry) {
      openIDB(function(db) {
        if (!db) return;
        idbPurgeIfStale(db, function() {
          var live = {};
          (_subSymbols[ticker] || []).forEach(function(sym) {
            if (_liveData[sym]) live[sym] = _liveData[sym];
          });
          var tx = db.transaction(_IDB_STORE, 'readwrite');
          tx.objectStore(_IDB_STORE).put({
            key: ticker + '|' + expiry,
            ticker: ticker,
            expiry: expiry,
            symbols: _subSymbols[ticker] || [],
            strikes: _strikes[ticker] || [],
            liveData: live,
            spot: _spot[ticker] || 0,
            savedAt: Date.now()
          });
          tx.oncomplete = function() { updateCacheBadge(); };
        });
      });
    }

    function saveAllCaches() {
      if (!_activeExpiry) return;
      TICKERS.forEach(function(t) {
        if ((_strikes[t] || []).length) saveCache(t, _activeExpiry);
      });
    }

    function loadCacheEntry(ticker, expiry, cb) {
      openIDB(function(db) {
        if (!db) { cb(null); return; }
        idbPurgeIfStale(db, function() {
          var tx = db.transaction(_IDB_STORE, 'readonly');
          tx.objectStore(_IDB_STORE).get(ticker + '|' + expiry).onsuccess = function(e) {
            cb(e.target.result || null);
          };
        });
      });
    }

    function updateCacheBadge() {
      openIDB(function(db) {
        if (!db) return;
        idbPurgeIfStale(db, function() {
          var count = 0;
          var tx = db.transaction(_IDB_STORE, 'readonly');
          tx.objectStore(_IDB_STORE).openCursor().onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) { count++; cursor.continue(); }
            else {
              var badge = el('mg-cache-badge');
              var countEl = el('mg-cache-count');
              if (badge) badge.style.display = count > 0 ? 'flex' : 'none';
              if (countEl) countEl.textContent = count;
            }
          };
        });
      });
    }

    // ── panels + rendering ──────────────────────────────────────────────────────
    function buildPanels() {
      var zone = el('mg-capture-zone');
      if (!zone) return;
      zone.innerHTML = TICKERS.map(function(t) {
        var headerCells = '<div style="padding:5px 4px;text-align:center;color:#e4e4e7;font-family:Arial">STRIKE</div>' + NET_COLS.map(function(c) {
          return '<div style="padding:5px 4px;text-align:center;color:#a78bfa;font-family:Arial">' + COL_LABELS[c] + '</div>';
        }).join('');
        return '<div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--bg1);border:1px solid var(--border);border-radius:6px;overflow:hidden">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg2);border-bottom:1px solid var(--border2);flex-shrink:0">'
          + '<span style="font-size:12px;font-weight:800;color:#00e5ff;letter-spacing:.1em;font-family:Arial">' + t + '</span>'
          + '<span id="mg-spot-' + t + '" style="font-size:11px;font-weight:700;color:var(--cyan);font-family:Arial,monospace">--</span>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:' + GRID_COLS + ';background:var(--bg2);border-bottom:2px solid var(--border2);flex-shrink:0;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase">' + headerCells + '</div>'
          + '<div style="display:grid;grid-template-columns:' + GRID_COLS + ';background:#0a1220;border-bottom:2px solid var(--border2);flex-shrink:0">'
          + '<div style="padding:4px 4px;font-size:9px;font-weight:800;text-align:center;color:#475569;font-family:Arial;letter-spacing:.06em">TOTAL</div>'
          + NET_COLS.map(function(c) {
              return '<div id="mg-total-' + t + '-' + c + '" style="padding:4px 4px;font-size:10px;font-weight:800;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#94a3b8">--</div>';
            }).join('')
          + '</div>'
          + '<div id="mg-body-' + t + '" style="flex:1;overflow-y:auto;min-height:0">'
          + '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:11px;color:#475569;font-family:Arial">Select an expiry and click GO</div>'
          + '</div>'
          + '</div>';
      }).join('');
    }

    function setPanelMsg(ticker, msg) {
      var body = el('mg-body-' + ticker);
      if (body) body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:11px;color:#64748b;font-family:Arial">' + msg + '</div>';
    }

    function computeRows(ticker) {
      var spot = _spot[ticker] || 0;
      var rows = (_strikes[ticker] || []).slice();
      rows.sort(function(a, b) { return b.strike - a.strike; });

      var atmStrike = 0;
      if (spot > 0 && rows.length) {
        // find ATM index, then take the same window for every ticker: ATM ± STRIKES_PER_SIDE
        var atmIdx = 0, minDist = Infinity;
        rows.forEach(function(r, i) {
          var d = Math.abs(r.strike - spot);
          if (d < minDist) { minDist = d; atmIdx = i; }
        });
        atmStrike = rows[atmIdx].strike;
        var start = Math.max(0, atmIdx - STRIKES_PER_SIDE);
        var end = Math.min(rows.length, atmIdx + STRIKES_PER_SIDE + 1);
        // shift window at edges so each ticker still returns 2*STRIKES_PER_SIDE+1 rows when possible
        var want = STRIKES_PER_SIDE * 2 + 1;
        if (end - start < want) {
          if (start === 0) end = Math.min(rows.length, want);
          else if (end === rows.length) start = Math.max(0, rows.length - want);
        }
        rows = rows.slice(start, end);
      }

      var out = rows.map(function(r) {
        var cd = _liveData[r.callSym] || {};
        var pd = _liveData[r.putSym] || {};
        var volOnly = _contractMode === 'vol';
        var cc = (volOnly ? 0 : (parseFloat(cd.oi) || 0)) + (parseFloat(cd.vol) || 0);
        var pc = (volOnly ? 0 : (parseFloat(pd.oi) || 0)) + (parseFloat(pd.vol) || 0);
        return {
          strike: r.strike,
          isATM: r.strike === atmStrike,
          gex:  ((parseFloat(cd.gamma) || 0) * cc - (parseFloat(pd.gamma) || 0) * pc) * spot * spot * 0.01 * 100,
          dex:  (Math.abs(parseFloat(cd.delta) || 0) * cc - Math.abs(parseFloat(pd.delta) || 0) * pc) * spot * 100,
          chex: (-(parseFloat(cd.theta) || 0) * cc + (parseFloat(pd.theta) || 0) * pc) * spot * 100,
          vex:  ((parseFloat(cd.vega) || 0) * cc - (parseFloat(pd.vega) || 0) * pc) * spot * 100
        };
      });

      var maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 };
      out.forEach(function(r) {
        NET_COLS.forEach(function(c) { if (Math.abs(r[c]) > maxAbs[c]) maxAbs[c] = Math.abs(r[c]); });
      });
      // top-3 strikes per column (same as overview heatmap top3ByCol)
      var top3 = {};
      NET_COLS.forEach(function(c) {
        top3[c] = {};
        out.slice().sort(function(a, b) { return Math.abs(b[c]) - Math.abs(a[c]); })
          .slice(0, 3)
          .forEach(function(row, idx) { top3[c][row.strike] = idx + 1; });
      });
      return { rows: out, maxAbs: maxAbs, top3: top3, atmStrike: atmStrike };
    }

    function metricBg(value, maxValue, topRank) {
      var n = parseFloat(value) || 0;
      var m = maxValue || 0;
      if (m === 0 || !n) return 'transparent';
      var pos = n >= 0;
      // Top ranks: fixed alphas — never affected by intensity slider
      if (topRank === 1) return pos ? 'rgba(41,182,246,0.90)' : 'rgba(255,71,87,0.90)';
      if (topRank === 2) return pos ? 'rgba(41,182,246,0.45)' : 'rgba(255,71,87,0.45)';
      if (topRank === 3) return pos ? 'rgba(41,182,246,0.25)' : 'rgba(255,71,87,0.25)';
      // Everyone else: scaled by intensity
      var ratio = Math.min(Math.abs(n) / m, 1);
      var eased = Math.pow(ratio * (_mgIntensity || 0.1), 1.4);
      var alpha = Math.min(0.18, 0.02 + eased * 0.16);
      return pos ? 'rgba(41,182,246,' + alpha.toFixed(2) + ')' : 'rgba(255,71,87,' + alpha.toFixed(2) + ')';
    }

    function metricBorder(topRank, value) {
      if (topRank !== 1) return '';
      var n = parseFloat(value) || 0;
      return ';outline:1px solid ' + (n >= 0 ? 'rgba(41,182,246,.9)' : 'rgba(255,71,87,.9)') + ';outline-offset:-1px;z-index:1;position:relative';
    }

    function rowHTML(r, maxAbs, top3, small) {
      var netCells = NET_COLS.map(function(c) {
        var topRank = (top3[c] && top3[c][r.strike]) || 0;
        var weight = topRank === 1 ? 900 : topRank ? 800 : 700;
        var extra = metricBorder(topRank, r[c]);
        return '<div style="padding:4px 4px;font-size:' + (small ? '10px' : '11px') + ';font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#ffffff;background:' + metricBg(r[c], maxAbs[c], topRank) + ';font-weight:' + weight + extra + '">' + fmtMoney(r[c]) + '</div>';
      }).join('');
      var strikeColor = r.isATM ? '#ffb300' : '#94a3b8';
      var strikeCell = '<div style="padding:4px 4px;font-size:' + (small ? '10px' : '11px') + ';font-weight:800;font-family:Arial,monospace;text-align:center;color:' + strikeColor + ';border-right:1px solid rgba(255,255,255,.06)' + (r.isATM ? ';background:rgba(255,179,0,.12)' : '') + '">'
        + r.strike.toFixed(r.strike % 1 === 0 ? 0 : 2) + '</div>';
      var rowBg = r.isATM ? 'background:rgba(255,179,0,.07);border-top:1px solid rgba(255,179,0,.25);border-bottom:1px solid rgba(255,179,0,.25)' : 'border-bottom:1px solid rgba(30,48,80,.35)';
      return '<div style="display:grid;grid-template-columns:' + GRID_COLS + ';' + rowBg + '" data-strike="' + r.strike + '">' + strikeCell + netCells + '</div>';
    }

    function renderPanel(ticker) {
      var body = el('mg-body-' + ticker);
      if (!body) return;
      var spotEl = el('mg-spot-' + ticker);
      if (spotEl) spotEl.textContent = _spot[ticker] > 0 ? _spot[ticker].toFixed(2) : '--';

      if (!(_strikes[ticker] || []).length) return;
      var computed = computeRows(ticker);
      if (!computed.rows.length) { setPanelMsg(ticker, 'No strikes in range'); return; }
      // column totals — sum ALL strikes (not just the visible window) for correct net greeks
      var spot = _spot[ticker] || 0;
      var volOnly = _contractMode === 'vol';
      var allTotals = { gex: 0, dex: 0, chex: 0, vex: 0 };
      (_strikes[ticker] || []).forEach(function(r) {
        var cd = _liveData[r.callSym] || {};
        var pd = _liveData[r.putSym]  || {};
        var cc = (volOnly ? 0 : (parseFloat(cd.oi) || 0)) + (parseFloat(cd.vol) || 0);
        var pc = (volOnly ? 0 : (parseFloat(pd.oi) || 0)) + (parseFloat(pd.vol) || 0);
        allTotals.gex  += ((parseFloat(cd.gamma) || 0) * cc - (parseFloat(pd.gamma) || 0) * pc) * spot * spot * 0.01 * 100;
        allTotals.dex  += (Math.abs(parseFloat(cd.delta) || 0) * cc - Math.abs(parseFloat(pd.delta) || 0) * pc) * spot * 100;
        allTotals.chex += (-(parseFloat(cd.theta) || 0) * cc + (parseFloat(pd.theta) || 0) * pc) * spot * 100;
        allTotals.vex  += ((parseFloat(cd.vega) || 0) * cc - (parseFloat(pd.vega) || 0) * pc) * spot * 100;
      });
      NET_COLS.forEach(function(c) {
        var sum = allTotals[c];
        var cell = el('mg-total-' + ticker + '-' + c);
        if (cell) {
          cell.textContent = fmtMoney(sum);
          cell.style.color = sum > 0 ? '#29b6f6' : sum < 0 ? '#ff4757' : '#94a3b8';
        }
      });
      _lastComputed[ticker] = computed;
      body.innerHTML = computed.rows.map(function(r) { return rowHTML(r, computed.maxAbs, computed.top3, false); }).join('');

      if (computed.atmStrike > 0 && !body._userScrolled) {
        var atmRow = body.querySelector('[data-strike="' + computed.atmStrike + '"]');
        if (atmRow) {
          var top = atmRow.offsetTop - (body.clientHeight / 2) + (atmRow.clientHeight / 2);
          body.scrollTop = Math.max(0, top);
        }
      }
      if (!body._scrollBound) {
        body._scrollBound = true;
        ['wheel', 'touchstart', 'pointerdown'].forEach(function(type) {
          body.addEventListener(type, function() { body._userScrolled = true; }, { passive: true });
        });
      }
    }

    function renderAll() {
      TICKERS.forEach(renderPanel);
      var tsEl = el('mg-last-update');
      if (tsEl) tsEl.textContent = etTimeNow();
    }

    // ── refresh button (snapshot.md ↻ Now feedback states) ─────────────────────
    window.mgManualRefresh = async function() {
      var btn = el('mg-refresh-btn');
      if (!btn || btn.disabled) return;
      if (!_activeExpiry) { setStatus('err', 'SELECT EXPIRY'); return; }
      var originalText = '↻ Now';

      btn.textContent = '↻ Refreshing...';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';

      var ok = true;
      try {
        await new Promise(function(resolve, reject) {
          var token = _loadToken + 1;
          loadAll(_activeExpiry);
          var t0 = Date.now();
          (function poll() {
            if (_loadToken !== token) { resolve(); return; } // superseded
            var statusTxt = el('mg-status-txt') ? el('mg-status-txt').textContent : '';
            if (statusTxt.indexOf('LIVE') >= 0) resolve();
            else if (statusTxt.indexOf('ERR') >= 0 || statusTxt.indexOf('PARTIAL') >= 0) reject(new Error('refresh failed'));
            else if (Date.now() - t0 > 30000) reject(new Error('timeout'));
            else setTimeout(poll, 200);
          })();
        });
      } catch (e) { ok = false; }

      var stamp = el('mg-refresh-time');
      if (stamp) {
        stamp.textContent = 'Last refresh: ' + etTimeNow();
        stamp.style.color = ok ? 'var(--cyan)' : '#f87171';
      }

      if (ok) {
        btn.textContent = '✓ Refreshed';
        btn.style.color = 'var(--green)';
        btn.style.textShadow = '0 0 12px rgba(0,230,118,0.5)';
        btn.style.borderColor = 'var(--green)';
        btn.style.background = 'rgba(0,230,118,0.1)';
      } else {
        btn.textContent = '✗ Failed';
        btn.style.color = 'var(--red)';
        btn.style.textShadow = '0 0 12px rgba(255,71,87,0.5)';
        btn.style.borderColor = 'var(--red)';
        btn.style.background = 'rgba(255,71,87,0.1)';
      }

      await new Promise(function(r) { setTimeout(r, 1800); });

      btn.textContent = originalText;
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      btn.style.color = 'var(--cyan)';
      btn.style.textShadow = '';
      btn.style.borderColor = 'rgba(0,229,255,.45)';
      btn.style.background = 'rgba(0,229,255,.08)';
    };

    window.mgGo = function() {
      var expSel = el('mg-expiry-select');
      var expiry = expSel ? expSel.value : null;
      if (!expiry) { setStatus('err', 'SELECT EXPIRY'); return; }
      _activeExpiry = expiry;
      loadAll(expiry);
    };

    // ── screenshot / share (snapshot.md pattern) ───────────────────────────────
    var MG_DISCORD_WEBHOOK = '/proxy/api/discord-webhook';
    var html2canvasPromise = null;

    function loadHtml2Canvas() {
      if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
      if (html2canvasPromise) return html2canvasPromise;
      html2canvasPromise = new Promise(function(resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.onload = function() { resolve(window.html2canvas); };
        s.onerror = function() { reject(new Error('html2canvas failed to load')); };
        document.head.appendChild(s);
      });
      return html2canvasPromise;
    }

    function buildMgScreenshot(cb) {
      var hasData = TICKERS.some(function(t) { return (_strikes[t] || []).length; });
      if (!hasData) { cb(new Error('nothing to capture'), null); return; }

      var html = '<div style="padding:10px 12px;background:#05080d;border-bottom:2px solid rgba(0,229,255,.2);display:flex;align-items:center;justify-content:space-between;font-family:Arial">'
        + '<div style="display:flex;gap:16px;align-items:center">'
        + '<div style="font-size:14px;font-weight:800;color:#00e5ff;letter-spacing:.1em">MULT-GREEK · SPX / SPY / QQQ</div>'
        + '<div style="font-size:11px;color:#94a3b8;font-weight:700">' + (_activeExpiry || '--') + '</div>'
        + '<div style="font-size:10px;color:#a78bfa;font-weight:800;letter-spacing:.08em">' + (_contractMode === 'vol' ? 'VOL ONLY' : 'OI+VOL') + '</div>'
        + '</div>'
        + '<div style="font-size:10px;color:#475569;font-family:Arial,monospace">' + etTimeNow() + ' ET</div>'
        + '</div>';

      html += '<div style="display:flex;gap:8px;padding:8px;background:#05080d">';
      TICKERS.forEach(function(t) {
        var computed = computeRows(t);
        var headerCells = '<div style="padding:5px 4px;text-align:center;color:#e4e4e7;font-family:Arial;font-size:9px;font-weight:800">STRIKE</div>' + NET_COLS.map(function(c) {
          return '<div style="padding:5px 4px;text-align:center;color:#a78bfa;font-family:Arial;font-size:9px;font-weight:800">' + COL_LABELS[c] + '</div>';
        }).join('');
        html += '<div style="flex:1;background:#0d1117;border:1px solid #1e3050;border-radius:6px;overflow:hidden">'
          + '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#111822;border-bottom:1px solid #2a4060">'
          + '<span style="font-size:12px;font-weight:800;color:#00e5ff;letter-spacing:.1em;font-family:Arial">' + t + '</span>'
          + '<span style="font-size:11px;font-weight:700;color:#00e5ff;font-family:Arial,monospace">' + (_spot[t] > 0 ? _spot[t].toFixed(2) : '--') + '</span>'
          + '</div>'
          + '<div style="display:grid;grid-template-columns:' + GRID_COLS + ';background:#111822;border-bottom:2px solid #2a4060;text-transform:uppercase;letter-spacing:.06em">' + headerCells + '</div>'
          + '<div style="display:grid;grid-template-columns:' + GRID_COLS + ';background:#0a1220;border-bottom:2px solid #2a4060">'
          + '<div style="padding:4px 4px;font-size:9px;font-weight:800;text-align:center;color:#475569;font-family:Arial;letter-spacing:.06em">TOTAL</div>'
          + NET_COLS.map(function(c) {
              var sum = 0;
              computed.rows.forEach(function(r) { sum += r[c] || 0; });
              var color = sum > 0 ? '#29b6f6' : sum < 0 ? '#ff4757' : '#94a3b8';
              return '<div style="padding:4px 4px;font-size:10px;font-weight:800;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:' + color + '">' + fmtMoney(sum) + '</div>';
            }).join('')
          + '</div>'
          + computed.rows.map(function(r) { return rowHTML(r, computed.maxAbs, computed.top3, true); }).join('')
          + '</div>';
      });
      html += '</div>';

      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1400px;background:#05080d;font-family:Arial,sans-serif';
      wrapper.innerHTML = html;
      document.body.appendChild(wrapper);

      loadHtml2Canvas().then(function(html2canvasFn) {
        html2canvasFn(wrapper, {
          backgroundColor: '#05080d',
          scale: 2,
          useCORS: true,
          logging: false,
          allowTaint: true
        }).then(function(canvas) {
          document.body.removeChild(wrapper);
          canvas.toBlob(function(blob) { cb(null, blob); }, 'image/png');
        }).catch(function(e) {
          document.body.removeChild(wrapper);
          cb(e, null);
        });
      }).catch(function(err) {
        document.body.removeChild(wrapper);
        cb(err || new Error('html2canvas unavailable'), null);
      });
    }

    window.mgCopyScreenshot = function() {
      var btn = el('mg-copy-shot-btn');
      var orig = btn ? btn.textContent : 'COPY';
      if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
      buildMgScreenshot(function(err, blob) {
        function restore(okMark) {
          if (!btn) return;
          btn.textContent = okMark;
          btn.style.color = okMark === '✓' ? '#00e676' : '#ff4757';
          setTimeout(function() { btn.textContent = orig; btn.style.color = '#00e5ff'; }, 1500);
        }
        if (err || !blob) { console.error('[MultGreek] copy capture failed:', err); restore('ERR'); return; }
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(function() { restore('✓'); })
            .catch(function() {
              var url = URL.createObjectURL(blob);
              window.open(url, '_blank');
              setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
              restore('✓');
            });
        } else {
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
          restore('✓');
        }
      });
    };

    window.mgShare = function(platform) {
      var btn = platform === 'x' ? el('mg-share-x-btn') : el('mg-share-discord-btn');
      var origColor = platform === 'x' ? '#00e5ff' : '#7289da';
      var orig = btn ? btn.textContent : platform.toUpperCase();
      if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }

      if (platform === 'x') {
        setTimeout(function() {
          if (btn) { btn.textContent = orig; btn.style.color = origColor; }
          window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('SPX SPY QQQ Net Greeks ' + (_activeExpiry || '')), '_blank');
        }, 300);
        return;
      }

      buildMgScreenshot(function(err, blob) {
        function restore(text, color) {
          if (!btn) return;
          btn.textContent = text; btn.style.color = color;
          setTimeout(function() { btn.textContent = orig; btn.style.color = origColor; }, 1500);
        }
        if (err || !blob) { console.error('[MultGreek] discord capture failed:', err); restore('ERR', '#ff4757'); return; }
        var form = new FormData();
        form.append('payload_json', JSON.stringify({ content: 'SPX / SPY / QQQ Net Greeks ' + (_activeExpiry || '') }));
        form.append('files[0]', blob, 'mult-greek-' + (_activeExpiry || 'snapshot') + '.png');
        fetch(MG_DISCORD_WEBHOOK, { method: 'POST', body: form }).then(function(res) {
          if (!res.ok) throw new Error('webhook ' + res.status);
          restore('✓', '#00e676');
        }).catch(function(e2) {
          console.error('[MultGreek] discord webhook failed:', e2);
          restore('ERR', '#ff4757');
        });
      });
    };

    // ── init / cleanup ─────────────────────────────────────────────────────────
    function cleanup() {
      saveAllCaches();
      if (_ws) { try { _ws.close(); } catch (e) {} _ws = null; }
      if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
      if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
      if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
      if (_spotSyncTimer) { clearInterval(_spotSyncTimer); _spotSyncTimer = null; }
      if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    }

    window.mgInit = function() {
      if (window.PageRuntime?.register) window.PageRuntime.register('mult-greek', cleanup);
      buildPanels();
      bindExpirySelect();
      // Prevent renderAll from firing while slider is being dragged
      var intensitySlider = el('mg-intensity');
      if (intensitySlider && !intensitySlider._sliderBound) {
        intensitySlider.max = '3';
        intensitySlider._sliderBound = true;
        ['mousedown','touchstart'].forEach(function(e) {
          intensitySlider.addEventListener(e, function() { _sliderActive = true; }, { passive: true });
        });
        ['mouseup','touchend','blur'].forEach(function(e) {
          intensitySlider.addEventListener(e, function() { _sliderActive = false; }, { passive: true });
        });
      }
      mgSetIntensity(_mgIntensity);
      mgSetContractMode(_contractMode);
      updateCacheBadge();
      if (!_autoSaveTimer) _autoSaveTimer = setInterval(saveAllCaches, 60000);
      fetchExpirations(function() {
        // auto-load the default (0DTE) expiry on first open
        if (_activeExpiry) loadAll(_activeExpiry);
      });
    };

    window['init_mult-greek'] = window.mgInit;
  })();
  // ── END MULT-GREEK ───────────────────────────────────────────────────────────

  // Do NOT call mgInit() here — loadPage calls init_mult-greek() after script loads
})();
