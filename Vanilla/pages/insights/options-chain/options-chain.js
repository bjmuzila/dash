(() => {
  if (window.__optionsChainModuleLoaded) {
    if (typeof window.chainInit === 'function') window.chainInit();
    return;
  }
  window.__optionsChainModuleLoaded = true;

  // ── OPTIONS CHAIN · /proxy/api/tt/chains/<TICKER> ──────────────────────────
  (function() {
    'use strict';

    // ── ticker list ────────────────────────────────────────────────────────────
    var TICKER_LIST = [
      'SPX','SPY','QQQ','NDX','IWM','RSP',
      'AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA',
      'ABNB','AFRM','ARM','BA','BABA','CCJ','CHWY','COIN','COST','CRCL','CRM','CRWD','CRWV',
      'DJT','FDX','GME','GS','HIMS','HOOD','IBIT','INTC','IREN',
      'LAC','LLY','MA','MARA','MCD','MRK','MRNA','MU',
      'NIO','NKE','NNE','NOK','NXE','OKLO','OPEN','OXY',
      'PDD','PFE','PLTR','PTON','RBLX','RIOT','RKLB','ROKU',
      'SE','SMH','SMCI','SNDK','SNOW','SOFI','SOUN','SOXL',
      'TGT','TQQQ','TSM','TTD','TSLL',
      'U','UNH','UPS','UPST','V','XPEV','XYZ',
      'ASTS','AVGO','BYND','CMG','CWVX','ETHA','FBL','FIG','HIMZ',
      'LLYX','MSFU','NFLX','NVDX','OSCR','PONY','QBTS','QUBT','RGTI','RIVN','SLV','UUUU'
    ].sort();

    // ── state ──────────────────────────────────────────────────────────────────
    var _expirations  = [];
    var _expiryCache  = {};
    var _activeExpiry = null;
    var _activeTicker = 'SPX';
    var _strikes      = [];
    // Shared global greek cache — same object used by mult-greek, exposure, and overview.
    // All WS Greek/Summary/Quote events from any page write here; all pages read from here.
    window.dxGreeksCache = window.dxGreeksCache || {};
    var _liveData = window.dxGreeksCache;               // alias — DO NOT reassign
    var _spot         = 0;
    var _ws           = null;
    var _kaTimer      = null;
    var _subSymbols   = [];
    var _renderTimer  = null;
    var _priceMode    = 'mid';
    var _chainIntensity = 1.4;
    var _rangePercent = 10;
    var _wsDataStartTime = null;
    var _minWaitForWsMs = 20000; // min ms to wait after first WS quote before rendering (20 seconds)
    var _loadToken = 0;
    var _pendingToken = 0;
    var _pendingStrikes = [];
    var _renderBlocked = false;
    var _waitTimer = null;
    var _waitStartedAt = 0;

    // ── column config ──────────────────────────────────────────────────────────
    var CALL_COLS = ['symbol','oi','vol','bid','ask','last','mid','iv','delta'];
    var PUT_COLS  = ['delta','iv','mid','last','bid','ask','vol','oi','symbol'];
    var NET_COLS  = ['gex','dex','chex','vex'];
    var COL_W = { symbol:'96px', oi:'70px', vol:'88px', bid:'62px', ask:'62px', last:'62px', mid:'62px', iv:'62px', delta:'60px', gex:'88px', dex:'88px', chex:'88px', vex:'88px' };
    var COL_LABELS = { symbol:'Symbol', oi:'OI', vol:'Vol', bid:'Bid', ask:'Ask', last:'Last', mid:'Mid', iv:'IV', delta:'Δ', gex:'NET GEX', dex:'NET DEX', chex:'NET CHEX', vex:'NET VEX' };

    // ── screenshot columns (for copy button) ──────────────────────────────
    var SCREENSHOT_CALL_COLS = ['symbol','oi','vol','last','iv'];
    var SCREENSHOT_PUT_COLS  = ['iv','last','vol','oi','symbol'];
    var SCREENSHOT_NET_COLS  = ['gex','dex','chex','vex'];
    var SCREENSHOT_COL_W = { symbol:'96px', oi:'70px', vol:'88px', last:'62px', iv:'62px', gex:'88px', dex:'88px', chex:'88px', vex:'88px' };

    function screenshotColsCSS() {
      var p = SCREENSHOT_CALL_COLS.map(function(c) { return SCREENSHOT_COL_W[c]; });
      SCREENSHOT_NET_COLS.forEach(function(c) { p.push(SCREENSHOT_COL_W[c]); });
      p.push('72px'); // strike
      SCREENSHOT_PUT_COLS.forEach(function(c) { p.push(SCREENSHOT_COL_W[c]); });
      return p.join(' ');
    }

    function colsCSS() {
      var p = CALL_COLS.map(function(c) { return COL_W[c]; });
      NET_COLS.forEach(function(c) { p.push(COL_W[c]); });
      p.push('72px'); // strike
      PUT_COLS.forEach(function(c) { p.push(COL_W[c]); });
      return p.join(' ');
    }

    // ── helpers ────────────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }
    function fp(v, d) { var n = parseFloat(v); return isFinite(n) ? n.toFixed(d==null?2:d) : '--'; }
    function fpPct(v) { var n = parseFloat(v); return isFinite(n) ? (n*100).toFixed(1)+'%' : '--'; }
    function fmtDelta(v) { var n = parseFloat(v); return isFinite(n) ? (n>=0?'+':'')+n.toFixed(3) : '--'; }
    function fmtWhole(v) { var n = parseFloat(v); return isFinite(n) ? Math.round(n).toLocaleString('en-US') : '--'; }
    function fmtMoney(v) {
      var n = parseFloat(v);
      if (!isFinite(n)) return '--';
      var s = n >= 0 ? '+' : '-';
      var a = Math.abs(n);
      return s + '$' + (a/1e6).toFixed(2) + 'M';
    }

    function setStatus(state, msg) {
      var dot = el('chain-status-dot'), txt = el('chain-status-txt');
      var colors = { live:'#00e676', loading:'#ffb300', err:'#ff4757', idle:'#1e293b' };
      if (dot) dot.style.background = colors[state] || '#1e293b';
      if (txt) { txt.textContent = msg || state.toUpperCase(); txt.style.color = colors[state] || '#e4e4e7'; }
    }

    function resetChainState() {
      _loadToken += 1;
      _pendingToken = _loadToken;
      _strikes = [];
      _pendingStrikes = [];
      // Clear only our subscribed symbols from the shared cache (don't wipe other pages' data)
      _subSymbols.forEach(function(sym) { delete _liveData[sym]; });
      _subSymbols = [];
      _wsDataStartTime = null;
      _renderBlocked = true;
      if (_renderTimer) {
        clearTimeout(_renderTimer);
        _renderTimer = null;
      }
      stopWaitCountdown();
      window._chainSymbolsToSubscribe = null;
      window._chainStrikesReady = null;
    }

    function startWaitCountdown(ms, token) {
      _waitStartedAt = Date.now();
      var wrap = el('chain-wait-wrap');
      var bar = el('chain-wait-bar');
      var label = el('chain-wait-label');
      if (wrap) wrap.style.display = 'flex';
      if (_waitTimer) clearInterval(_waitTimer);
      function tick() {
        if (token !== _pendingToken) return stopWaitCountdown();
        var remaining = Math.max(0, ms - (Date.now() - _waitStartedAt));
        var pct = ms > 0 ? remaining / ms : 0;
        if (bar) bar.style.transform = 'scaleX(' + pct.toFixed(3) + ')';
        if (label) label.textContent = (remaining / 1000).toFixed(1) + 's';
        if (remaining <= 0) stopWaitCountdown();
      }
      tick();
      _waitTimer = setInterval(tick, 100);
    }

    function stopWaitCountdown() {
      if (_waitTimer) {
        clearInterval(_waitTimer);
        _waitTimer = null;
      }
      var wrap = el('chain-wait-wrap');
      var bar = el('chain-wait-bar');
      var label = el('chain-wait-label');
      if (wrap) wrap.style.display = 'none';
      if (bar) bar.style.transform = 'scaleX(1)';
      if (label) label.textContent = (_minWaitForWsMs / 1000).toFixed(1) + 's';
    }

    function finalizeLoad(preStrikes, token, liveLabel) {
      if (token !== _pendingToken) return;
      _renderBlocked = false;
      _strikes = window._chainStrikesReady || preStrikes || [];
      stopWaitCountdown();
      renderHeader();
      renderTable();
      setStatus('live', liveLabel || 'LIVE');
    }

    function hasSnapshotData(strikes) {
      return (strikes || []).some(function(row) {
        var call = row.callTT || {};
        var put = row.putTT || {};
        function hasSideData(side) {
          return (parseFloat(side.bid) > 0) ||
                 (parseFloat(side.ask) > 0) ||
                 (parseFloat(side.last) > 0) ||
                 (parseFloat(side['open-interest']) > 0) ||
                 (parseFloat(side.volume) > 0);
        }
        return hasSideData(call) || hasSideData(put);
      });
    }

    function todayETStr() {
      var parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      var m = {}; parts.forEach(function(p){m[p.type]=p.value;});
      return m.year+'-'+m.month+'-'+m.day;
    }

    function daysTo(dateStr) {
      return Math.round((new Date(dateStr) - new Date(todayETStr())) / 86400000);
    }

    function setPriceMode(mode) {
      _priceMode = mode === 'last' ? 'last' : 'mid';
      var lastBtn = el('chain-price-last');
      var midBtn = el('chain-price-mid');
      if (lastBtn) {
        lastBtn.style.background = _priceMode === 'last' ? '#00e5ff22' : 'transparent';
        lastBtn.style.borderColor = _priceMode === 'last' ? '#00e5ff' : 'rgba(255,255,255,.12)';
        lastBtn.style.color = _priceMode === 'last' ? '#00e5ff' : '#64748b';
      }
      if (midBtn) {
        midBtn.style.background = _priceMode === 'mid' ? '#00e5ff22' : 'transparent';
        midBtn.style.borderColor = _priceMode === 'mid' ? '#00e5ff' : 'rgba(255,255,255,.12)';
        midBtn.style.color = _priceMode === 'mid' ? '#00e5ff' : '#64748b';
      }
      renderTable();
    }

    function setChainRange(dollars) {
      _rangePercent = (dollars === 'all' || dollars === 0) ? 'all' : (parseFloat(dollars) || 150);
      var sel = el('chain-range-select');
      if (sel && sel.value !== String(_rangePercent)) sel.value = String(_rangePercent);
      renderTable();
    }

    function setChainIntensity(val) {
      var next = Math.max(0.2, Math.min(3, parseFloat(val) || 1.4));
      _chainIntensity = next;
      var slider = el('chain-intensity');
      var label = el('chain-intensity-val');
      if (slider && slider.value !== String(next)) slider.value = String(next);
      if (label) label.textContent = next.toFixed(2) + 'x';
      renderTable();
    }

    // ── build ticker datalist + input ──────────────────────────────────────────
    function buildTickerDropdown() {
      var input = el('chain-ticker-select');
      var dl    = el('chain-ticker-list');
      if (!dl || dl.children.length > 0) return;
      TICKER_LIST.forEach(function(t) {
        var opt = document.createElement('option');
        opt.value = t;
        dl.appendChild(opt);
      });
      if (input && !input._bound) {
        input._bound = true;
        input.addEventListener('input', function() { this.value = this.value.toUpperCase(); });
        function onTickerConfirm() {
          var v = input.value.trim().toUpperCase();
          if (!v) return;
          if (v === _activeTicker && _expirations.length) return;
          _activeTicker = v;
          var lbl = el('chain-ticker-label');
          if (lbl) lbl.textContent = v;
          _expirations = []; _activeExpiry = null;
          fetchExpirations();
        }
        input.addEventListener('change', onTickerConfirm);
        input.addEventListener('blur', onTickerConfirm);
      }
    }

    // ── fetch expirations and populate expiry dropdown ─────────────────────────
    function fetchExpirations(cb) {
      function isExpiryValid(exp) {
        // Skip expired expirations only
        if (exp.daysTo < 0) return false;
        // After 4pm ET (16:00), skip 0DTE only for SPX
        if (_activeTicker === 'SPX' || _activeTicker === 'SPXW') {
          var etTime = new Date().toLocaleString('en-US', {timeZone:'America/New_York'});
          var etHour = parseInt(etTime.split(',')[1].trim().split(':')[0], 10);
          if (etHour >= 16 && exp.daysTo === 0) return false;
        }
        return true;
      }

      if (_expiryCache[_activeTicker] && _expiryCache[_activeTicker].length) {
        _expirations = _expiryCache[_activeTicker].slice();
        var expSelCached = el('chain-expiry-select');
        if (expSelCached) {
          expSelCached.innerHTML = '<option value="" style="background:#0a0e14;color:#e4e4e7">-- Expiry --</option>';
          var validExpirations = _expirations.filter(isExpiryValid);
          validExpirations.forEach(function(exp) {
            var opt = document.createElement('option');
            opt.value = exp.date;
            opt.textContent = exp.label;
            opt.style.background = '#0a0e14';
            opt.style.color = '#e4e4e7';
            expSelCached.appendChild(opt);
          });
          var dte0 = validExpirations.filter(function(e){ return e.daysTo===0; })[0];
          var autoSelect = dte0 || validExpirations[0];
          if (autoSelect) { expSelCached.value = autoSelect.date; _activeExpiry = autoSelect.date; }
        }
        setStatus('idle', 'READY');
        if (cb) cb(_expirations, { data: { items: _expirations } });
        return;
      }
      setStatus('loading', 'LOADING...');
      var expSel = el('chain-expiry-select');
      if (expSel) expSel.innerHTML = '<option value="">Loading...</option>';

      fetch('/proxy/api/tt/expirations/' + encodeURIComponent(_activeTicker))
        .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
        .then(function(json) {
          var items = (json.data && json.data.items) ? json.data.items : [];

          var seen = {};
          _expirations = [];
          items.forEach(function(item) {
            var d = item['expiration-date'] || '';
            if (!d || seen[d]) return;
            seen[d] = true;
            var dt = daysTo(d);
            var mmdd = d.slice(5);
            var dte  = dt + 'DTE';
            var label = dte + '  ' + mmdd;
            _expirations.push({ date:d, daysTo:dt, label:label, type: item['expiration-type'] || '' });
          });
          _expirations.sort(function(a,b){ return a.daysTo - b.daysTo; });

          // Holiday exclusions (6/19 is holiday, so include 6/18)
          var holidayExclusions = { '2026-06-19': true };
          var holidayInclusions = { '2026-06-18': true };

          var filtered = _expirations.filter(function(e) {
            // Exclude holiday dates (except those in inclusions list)
            if (holidayExclusions[e.date] && !holidayInclusions[e.date]) return false;

            if (e.daysTo <= 7) return true;
            if (holidayInclusions[e.date]) return true; // Always include forced holiday dates
            var expType = (e.type || '').toLowerCase();
            if (expType === 'weekly' || expType === 'monthly') return true;
            var parts = e.date.split('-');
            var d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
            return d.getDay() === 5; // include all Friday expirations
          });

          if (expSel) {
            expSel.innerHTML = '<option value="" style="background:#0a0e14;color:#e4e4e7">-- Expiry --</option>';
            var validFiltered = filtered.filter(isExpiryValid);
            validFiltered.forEach(function(exp) {
              var opt = document.createElement('option');
              opt.value = exp.date;
              opt.textContent = exp.label;
              opt.style.background = '#0a0e14';
              opt.style.color = '#e4e4e7';
              expSel.appendChild(opt);
            });
            var dte0 = validFiltered.filter(function(e){ return e.daysTo===0; })[0];
            var autoSelect = dte0 || validFiltered[0];
            if (autoSelect) { expSel.value = autoSelect.date; _activeExpiry = autoSelect.date; }
          }

          setStatus('idle', 'READY');
          _expiryCache[_activeTicker] = _expirations.slice();
          if (cb) cb(items, json);
        })
        .catch(function(e) {
          setStatus('err', 'ERR: '+e);
          if (expSel) expSel.innerHTML = '<option value="">Error loading</option>';
        });
    }

    // ── fetch strikes for a specific expiry ────────────────────────────────────
    function loadExpiry(expDate) {
      resetChainState();
      var token = _pendingToken;
      setStatus('loading', 'LOADING...');
      var bodyEl = el('chain-body');
      if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Loading chain...</div>';

      // Skip cache, fetch fresh data
      var _cacheHit = false;
      startFetch();

      var pageId = 'options-chain-' + Date.now();
      var baseUrl = '/proxy/api/tt/chains/' + encodeURIComponent(_activeTicker) + '?expiration=' + expDate + '&pageId=' + encodeURIComponent(pageId);
      var rangeParam = _rangePercent === 'all' ? 'all' : String(_rangePercent);

      function startFetch() { fetch(baseUrl + '&range=' + rangeParam)
        .then(function(r) { return r.ok ? r.json() : Promise.reject('HTTP '+r.status); })
        .then(function(json) {
          if (token !== _pendingToken) return;
          var items = (json.data && json.data.items) ? json.data.items : [];
          var targetItems = items.filter(function(i){
            return i['expiration-date'] === expDate ||
                   i.expirationDate === expDate ||
                   i['expirationDate'] === expDate;
          });
          if (!targetItems.length) {
            targetItems = items.filter(function(i) {
              var d = i['expiration-date'] || i.expirationDate || i['expirationDate'] || '';
              return d && String(d).slice(0, 10) === String(expDate).slice(0, 10);
            });
          }
          var rawSpot = json.data && json.data.underlyingPrice ? parseFloat(json.data.underlyingPrice) : 0;
          var spotPrice = (rawSpot > 10) ? rawSpot : 0;
          var preStrikes = buildStrikes(targetItems.length ? targetItems : items, spotPrice);
          _pendingStrikes = preStrikes;
          updateSpot(json.data && json.data.underlyingPrice);

          var allSyms = [];
          preStrikes.forEach(function(r) {
            if (r.callSym) allSyms.push(r.callSym);
            if (r.putSym)  allSyms.push(r.putSym);
          });
          var hasRestSnapshot = hasSnapshotData(preStrikes);

          if (!allSyms.length) {
            window._chainStrikesReady = preStrikes;
            connectDxLink();
            if (_cacheHit) {
              finalizeLoad(preStrikes, token, 'LIVE');
            } else {
              if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Collecting quotes...</div>';
              setStatus('loading', 'SUBSCRIBING...');
              startWaitCountdown(_minWaitForWsMs, token);
              var waitUntil = Date.now() + _minWaitForWsMs;
              var pollCount = 0;
              var checkReady = function() {
                if (token !== _pendingToken) return;
                var elapsed = Date.now() - (waitUntil - _minWaitForWsMs);
                var greeksCount = Object.keys(_liveData).filter(function(sym) { return _liveData[sym] && _liveData[sym].delta != null; }).length;
                var minGreeksNeeded = Math.max(5, Math.floor(preStrikes.length * 0.1)); // At least 5 or 10% of strikes

                // Update progress counter in toolbar
                var progressEl = el('chain-progress-count');
                if (progressEl) progressEl.textContent = greeksCount + '/' + minGreeksNeeded;

                // Refresh display every 2 seconds (every 20 x 100ms polls) if we have some data
                if (greeksCount >= minGreeksNeeded && pollCount > 0 && pollCount % 20 === 0) {
                  renderTable();
                  setStatus('loading', 'Collecting... ' + greeksCount + '/' + minGreeksNeeded);
                }

                if (elapsed >= _minWaitForWsMs && greeksCount >= minGreeksNeeded) {
                  finalizeLoad(preStrikes, token, 'LIVE');
                }
                else if (elapsed >= _minWaitForWsMs) {
                  finalizeLoad(preStrikes, token, 'LIVE (Collecting...' + greeksCount + '/' + minGreeksNeeded + ')');
                }
                else {
                  pollCount++;
                  setTimeout(checkReady, 100);
                }
              };
              setTimeout(checkReady, 5000);
            }
            return;
          }

          // Use subscription manager instead of hardcoded waits
          window._chainSymbolsToSubscribe = allSyms;
          window._chainStrikesReady = preStrikes;
          connectDxLink();

          if (_cacheHit) {
            finalizeLoad(preStrikes, token, 'LIVE');
          } else {
            if (bodyEl) bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Collecting quotes...</div>';
            setStatus('loading', 'SUBSCRIBING...');

            // Wait for subscription manager to report ready
            var subscriptionReady = false;
            fetch('/proxy/api/subscription-ready', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                pageId: pageId,
                symbols: allSyms,
                timeout: _minWaitForWsMs,
                threshold: 0.5
              })
            })
            .then(function(r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.json();
            })
            .then(function(readyData) {
              if (token !== _pendingToken) return;
              subscriptionReady = true;
              console.log('[ChainOptions] subscription ready:', readyData);
              stopWaitCountdown();
              finalizeLoad(preStrikes, token, readyData.ready ? 'LIVE' : 'LIVE (Partial)');
            })
            .catch(function(e) {
              if (token !== _pendingToken) return;
              console.warn('[ChainOptions] subscription-ready failed:', e.message || e);
              // Fall back to waiting min time if server fails
              if (!subscriptionReady) {
                var checkFallback = function() {
                  if (token !== _pendingToken) return;
                  var elapsed = Date.now() - (waitUntil - _minWaitForWsMs);
                  if (_wsDataStartTime && elapsed >= _minWaitForWsMs) { finalizeLoad(preStrikes, token, 'LIVE (Fallback)'); }
                  else if (elapsed >= _minWaitForWsMs) { finalizeLoad(preStrikes, token, 'LIVE (Static Fallback)'); }
                  else { setTimeout(checkFallback, 50); }
                };
                setTimeout(checkFallback, 50);
              }
            });
          }
        })
        .catch(function(e) {
          if (token !== _pendingToken) return;
          stopWaitCountdown();
          _renderBlocked = false;
          setStatus('err', 'ERR: '+e);
        });
      } // end startFetch
    }

    // ── parse response items into strike rows ──────────────────────────────────
    function buildStrikes(expGroups, spotPrice) {
      var map = {};
      expGroups.forEach(function(expGroup) {
        var strikeRows = expGroup.strikes || [];
        strikeRows.forEach(function(item) {
          var strike = parseFloat(item['strike-price'] || 0);
          if (!strike) return;
          var key = strike.toFixed(2);
          if (!map[key]) map[key] = { strike:strike, callSym:null, putSym:null, callTT:null, putTT:null };
        });
      });

      var allStrikes = Object.values(map).sort(function(a,b){ return a.strike - b.strike; });

      expGroups.forEach(function(expGroup) {
        var strikeRows = expGroup.strikes || [];
        strikeRows.forEach(function(item) {
          var strike = parseFloat(item['strike-price'] || 0);
          if (!strike) return;
          var key = strike.toFixed(2);
          if (!map[key]) return;

          var r = map[key];
          function safeFloat(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
          function safeInt(v)   { var n = parseInt(v,10); return isFinite(n) ? n : null; }
          if (item.call) {
            r.callTT  = item.call;
            r.callSym = item.call['streamer-symbol'] || item.call.symbol || '';
            if (r.callSym) _liveData[r.callSym] = {
              bid:   safeFloat(item.call.bid),
              ask:   safeFloat(item.call.ask),
              last:  safeFloat(item.call.last),
              iv:    safeFloat(item.call['implied-volatility']),
              delta: safeFloat(item.call.delta),
              gamma: safeFloat(item.call.gamma),
              theta: safeFloat(item.call.theta),
              vega:  safeFloat(item.call.vega),
              oi:    (safeInt(item.call['open-interest']) !== null ? safeInt(item.call['open-interest']) : (safeInt(item.call.openInterest) !== null ? safeInt(item.call.openInterest) : (safeInt(item.call['openInterest']) !== null ? safeInt(item.call['openInterest']) : 0))),
              vol:   safeInt(item.call.volume) !== null ? safeInt(item.call.volume) : 0,
              size:  null
            };
          }
          if (item.put) {
            r.putTT  = item.put;
            r.putSym = item.put['streamer-symbol'] || item.put.symbol || '';
            if (r.putSym) _liveData[r.putSym] = {
              bid:   safeFloat(item.put.bid),
              ask:   safeFloat(item.put.ask),
              last:  safeFloat(item.put.last),
              iv:    safeFloat(item.put['implied-volatility']),
              delta: safeFloat(item.put.delta),
              gamma: safeFloat(item.put.gamma),
              theta: safeFloat(item.put.theta),
              vega:  safeFloat(item.put.vega),
              oi:    (safeInt(item.put['open-interest']) !== null ? safeInt(item.put['open-interest']) : (safeInt(item.put.openInterest) !== null ? safeInt(item.put.openInterest) : (safeInt(item.put['openInterest']) !== null ? safeInt(item.put['openInterest']) : 0))),
              vol:   safeInt(item.put.volume) !== null ? safeInt(item.put.volume) : 0,
              size:  null
            };
          }
        });
      });
      return Object.values(map).sort(function(a,b){ return a.strike - b.strike; });
    }

    function updateSpot(price) {
      var p = parseFloat(price);
      if (isFinite(p) && p > 0) {
        _spot = p;
        var spotEl = el('chain-spot');
        if (spotEl) spotEl.textContent = p.toFixed(2);
      } else if (window.esPrice > 1000) {
        _spot = window.esPrice;
      }
    }

    // ── expiry dropdown handler ────────────────────────────────────────────────
    function bindExpirySelect() {
      var expSel = el('chain-expiry-select');
      if (!expSel || expSel._bound) return;
      expSel._bound = true;
      expSel.addEventListener('change', function() {
        _activeExpiry = this.value || null;
        if (_activeExpiry) loadExpiry(_activeExpiry);
      });
    }

    window._chainSelectExpiry = function(date) {
      _activeExpiry = date;
      var expSel = el('chain-expiry-select');
      if (expSel) expSel.value = date;
    };
    window.setChainIntensity = setChainIntensity;
    window.setPriceMode = setPriceMode;
    window.setChainRange = setChainRange;

    // ── render column header ───────────────────────────────────────────────────
    function renderHeader() {
      var hdr = el('chain-header');
      if (!hdr) return;
      var cols = colsCSS();
      hdr.setAttribute('style', 'display:grid;grid-template-columns:'+cols+';background:var(--bg2);border-bottom:2px solid var(--border2);flex-shrink:0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase');

      var callH = CALL_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:'+(c==='symbol'?'left':'right')+';color:#2298cf;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
      });
      var netH = NET_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:center;color:#a78bfa;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
      });
      var strikeH = '<div style="padding:5px 6px;text-align:center;color:#e4e4e7;font-family:Arial">Strike</div>';
      var putH = PUT_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:right;color:#ff7c88;font-family:Arial">'+(COL_LABELS[c]||c)+'</div>';
      });
      hdr.innerHTML = callH.join('') + netH.join('') + strikeH + putH.join('');
    }

    // ── render rows ────────────────────────────────────────────────────────────
    function renderTable() {
      var bodyEl = el('chain-body');
      if (!bodyEl) return;
      if (_renderBlocked) {
        if (_pendingStrikes.length) {
          bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#64748b;font-family:Arial">Waiting for full quote batch...</div>';
        }
        return;
      }
      if (!_strikes.length) {
        bodyEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:80px;font-size:13px;color:#ff4757;font-family:Arial">No strikes returned</div>';
        return;
      }
      if (!_spot && window.esPrice > 1000) _spot = window.esPrice;
      var cols = colsCSS();
      var spot = _spot;
      var atmStrike = spot > 0 ? _strikes.reduce(function(best, r) {
        return Math.abs(r.strike-spot) < Math.abs(best.strike-spot) ? r : best;
      }, _strikes[0]).strike : 0;
      var maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 };
      var baseSpot = _spot > 0 ? _spot : (window.esPrice > 1000 ? window.esPrice : 0);
      _strikes.forEach(function(row) {
        var cd = _liveData[row.callSym] || {};
        var pd = _liveData[row.putSym] || {};
        if ((!cd.bid && !cd.ask && !cd.last && !cd.vol && !cd.oi) && row.callTT) {
          cd = Object.assign({}, cd, row.callTT);
        }
        if ((!pd.bid && !pd.ask && !pd.last && !pd.vol && !pd.oi) && row.putTT) {
          pd = Object.assign({}, pd, row.putTT);
        }
        var cc = (parseFloat(cd.oi)||0) + (parseFloat(cd.vol)||0);
        var pc = (parseFloat(pd.oi)||0) + (parseFloat(pd.vol)||0);
        var gex  = Math.abs(((parseFloat(cd.gamma)||0)*cc - (parseFloat(pd.gamma)||0)*pc) * baseSpot * baseSpot * 0.01 * 100);
        var dex  = Math.abs((Math.abs(parseFloat(cd.delta)||0)*cc - Math.abs(parseFloat(pd.delta)||0)*pc) * baseSpot * 100);
        var chex = Math.abs((-(parseFloat(cd.theta)||0)*cc + (parseFloat(pd.theta)||0)*pc) * baseSpot * 100);
        var vex  = Math.abs(((parseFloat(cd.vega)||0)*cc - (parseFloat(pd.vega)||0)*pc) * baseSpot * 100);
        if (gex > maxAbs.gex) maxAbs.gex = gex;
        if (dex > maxAbs.dex) maxAbs.dex = dex;
        if (chex > maxAbs.chex) maxAbs.chex = chex;
        if (vex > maxAbs.vex) maxAbs.vex = vex;
      });

      function metricBg(value, maxValue) {
        var n = parseFloat(value) || 0;
        if (!n) return 'transparent';
        var ratio = Math.min(Math.abs(n) / Math.max(maxValue, 1) * (0.35 + _chainIntensity * 0.65), 1);
        var alpha = 0.08 + Math.pow(ratio, 1.45) * 0.82;
        return n >= 0 ? 'rgba(0,229,255,' + alpha.toFixed(2) + ')' : 'rgba(255,71,87,' + alpha.toFixed(2) + ')';
      }

      var sortedStrikes = _strikes.slice().sort(function(a,b){ return b.strike - a.strike; });

      // Filter by range percentage (only if we have sufficient WS data; otherwise show all)
      var spot = _spot > 0 ? _spot : (window.esPrice > 1000 ? window.esPrice : 0);
      var greeksCount = Object.keys(_liveData).filter(function(sym) { return _liveData[sym] && _liveData[sym].delta != null; }).length;
      var minGreeksNeeded = Math.max(5, Math.floor(_strikes.length * 0.1)); // At least 5 or 10% of strikes
      var hasEnoughWsData = greeksCount >= minGreeksNeeded;

      if (hasEnoughWsData && _rangePercent !== 'all' && spot > 0) {
        // rangePercent is in dollars, not percentage (e.g., 150 = ±150 around ATM)
        var dollarRange = parseFloat(_rangePercent) || 150;
        var lowerBound = spot - dollarRange;
        var upperBound = spot + dollarRange;
        var filtered = sortedStrikes.filter(function(r) {
          return r.strike >= lowerBound && r.strike <= upperBound;
        });
        if (filtered.length > 0) sortedStrikes = filtered;
      }
      // 'all' shows every strike in the API response, no filtering
      console.log('[Chain] renderTable: ' + sortedStrikes.length + ' strikes shown, ' + greeksCount + '/' + minGreeksNeeded + ' WS data, liveData keys=' + Object.keys(_liveData).length);

      var html = sortedStrikes.map(function(row) {
        var isATM = row.strike === atmStrike;
        var cd = _liveData[row.callSym] || {};
        var pd = _liveData[row.putSym]  || {};
        if ((!cd.bid && !cd.ask && !cd.last && !cd.vol && !cd.oi) && row.callTT) {
          cd = Object.assign({}, cd, row.callTT);
        }
        if ((!pd.bid && !pd.ask && !pd.last && !pd.vol && !pd.oi) && row.putTT) {
          pd = Object.assign({}, pd, row.putTT);
        }
        var rowBg = isATM ? 'background:rgba(255,179,0,.07);border-top:1px solid rgba(255,179,0,.25);border-bottom:1px solid rgba(255,179,0,.25)' : 'border-bottom:1px solid rgba(30,48,80,.35)';
        var spot = _spot > 0 ? _spot : (window.esPrice > 1000 ? window.esPrice : 0);

        var callContracts = (parseFloat(cd.oi) || 0) + (parseFloat(cd.vol) || 0);
        var putContracts  = (parseFloat(pd.oi) || 0) + (parseFloat(pd.vol) || 0);
        var netGex  = ((parseFloat(cd.gamma)||0) * callContracts - (parseFloat(pd.gamma)||0) * putContracts) * spot * spot * 0.01 * 100;
        var netDex  = (Math.abs(parseFloat(cd.delta)||0) * callContracts - Math.abs(parseFloat(pd.delta)||0) * putContracts) * spot * 100;
        var netChex = (-(parseFloat(cd.theta)||0) * callContracts + (parseFloat(pd.theta)||0) * putContracts) * spot * 100;
        var netVex  = ((parseFloat(cd.vega)||0) * callContracts - (parseFloat(pd.vega)||0) * putContracts) * spot * 100;

        function cell(col, d, side) {
          var v='--', color='#a8b8cc', align='right';
          var mid = (d.bid != null && d.ask != null && isFinite(d.bid) && isFinite(d.ask)) ? ((d.bid + d.ask) / 2) : null;
          if (col==='symbol') {
            v = (row.strike%1===0 ? row.strike.toFixed(0) : row.strike.toFixed(2)) + ' ' + (side==='call'?'C':'P');
            color = side==='call' ? '#4db8ff' : '#ff7c88'; align = side==='call' ? 'left' : 'right';
          }
          else if (col==='last')  { v=fp(d.last,2);       color='#e4e4e7'; }
          else if (col==='mid')   { v=_priceMode==='mid'?fp(mid,2):fp(d.last,2); color='#e4e4e7'; }
          else if (col==='bid')   { v=fp(d.bid,2);         color='#f87171'; }
          else if (col==='ask')   { v=fp(d.ask,2);         color='#4ade80'; }
          else if (col==='iv')    { v=fpPct(d.iv);         color='#7278ca'; }
          else if (col==='delta') { v=fmtDelta(d.delta);   color=parseFloat(d.delta)>=0?'#00e676':'#ff4757'; }
          else if (col==='oi')    { v=fmtWhole(d.oi);      color='#94a3b8'; }
          else if (col==='vol')   { v=fmtWhole(d.vol);     color='#e4e4e7'; }
          var extra = col==='symbol' ? 'min-width:0;' : '';
          return '<div style="padding:5px 8px;font-size:13px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'+extra+'text-align:'+align+';color:'+color+'">'+v+'</div>';
        }

        function netCell(val, maxVal) {
          var v = val ? fmtMoney(val) : '--';
          var bg = metricBg(val, maxVal);
          return '<div style="padding:5px 8px;font-size:12px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#ffffff;background:'+bg+';font-weight:700">'+v+'</div>';
        }

        var strikeColor = isATM ? '#ffb300' : '#94a3b8';
        var strikeCell = '<div style="padding:4px 6px;font-size:13px;font-weight:800;font-family:Arial,monospace;text-align:center;color:'+strikeColor+';border-left:1px solid rgba(255,255,255,.06);border-right:1px solid rgba(255,255,255,.06)'+(isATM?';background:rgba(255,179,0,.12)':'')+'">'
          + row.strike.toFixed(row.strike%1===0?0:2)
          + '</div>';

        var callCells = CALL_COLS.map(function(c){ return cell(c, cd, 'call'); }).join('');
        var putCells  = PUT_COLS.map(function(c){  return cell(c, pd, 'put');  }).join('');
        var netCells  = netCell(netGex, maxAbs.gex) + netCell(netDex, maxAbs.dex) + netCell(netChex, maxAbs.chex) + netCell(netVex, maxAbs.vex);

        return '<div style="display:grid;grid-template-columns:'+cols+';'+rowBg+'" data-strike="'+row.strike+'">'+callCells+netCells+strikeCell+putCells+'</div>';
      }).join('');

      bodyEl.innerHTML = html;

      if (atmStrike > 0 && !window.__chainAutoCenterBlocked) {
        setTimeout(function() {
          var rows = bodyEl.querySelectorAll('[data-strike]');
          var closest = null, minDist = Infinity;
          rows.forEach(function(r) {
            var d = Math.abs(parseFloat(r.dataset.strike) - atmStrike);
            if (d < minDist) { minDist=d; closest=r; }
          });
          if (closest) closest.scrollIntoView({ block:'center' });
        }, 60);
      }

      var tsEl = el('chain-last-update');
      if (tsEl) tsEl.textContent = new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
    }

    // ── dxLink live updates (via proxy WS bridge) ──────────────────────────────
    function connectDxLink() {
      if (_ws && _ws.readyState === 1) return;
      if (_ws) { try { _ws.close(); } catch(e) {} _ws = null; }

      _ws = new WebSocket((window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/ws/dxlink');
      _ws.onopen = function() {
        setStatus('live', 'LIVE');
        if (_subSymbols && _subSymbols.length) {
          try {
            _ws.send(JSON.stringify({
              type: 'subscribe',
              symbols: _subSymbols,
              feedTypesBySymbol: _subSymbols.reduce(function(acc, sym) {
                acc[sym] = ['Quote','Greeks','Summary','Trade'];
                return acc;
              }, {})
            }));
          } catch (err) {}
        }
      };
      _ws.onmessage = function(e) { handleMsg(e.data); };
      _ws.onclose   = function() { setStatus('idle', 'DISCONNECTED'); _ws = null; };
      _ws.onerror   = function() { setStatus('err', 'WS ERR'); };
    }

    // ── chain cache (IndexedDB, clears at midnight ET) ─────────────────────────
    var _IDB_NAME    = 'chainCache';
    var _IDB_STORE   = 'chains';
    var _IDB_META    = 'meta';
    var _idb         = null;  // opened IDBDatabase

    function todayETDateStr() {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var m = {}; parts.forEach(function(p) { m[p.type] = p.value; });
      return m.year + '-' + m.month + '-' + m.day;
    }

    function openIDB(cb) {
      if (_idb) { cb(_idb); return; }
      var req = indexedDB.open(_IDB_NAME, 1);
      req.onupgradeneeded = function(e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(_IDB_STORE)) db.createObjectStore(_IDB_STORE, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(_IDB_META))  db.createObjectStore(_IDB_META,  { keyPath: 'key' });
      };
      req.onsuccess = function(e) { _idb = e.target.result; cb(_idb); };
      req.onerror   = function()  { console.warn('[Chain IDB] open failed'); cb(null); };
    }

    function idbPurgeIfStale(db, cb) {
      var today = todayETDateStr();
      var tx  = db.transaction([_IDB_META, _IDB_STORE], 'readwrite');
      var meta = tx.objectStore(_IDB_META);
      meta.get('date').onsuccess = function(e) {
        var stored = e.target.result ? e.target.result.value : null;
        if (stored === today) { cb(); return; }
        // Stale — clear both stores
        tx.objectStore(_IDB_STORE).clear();
        meta.put({ key: 'date', value: today });
        tx.oncomplete = cb;
      };
    }

    function saveSubCache(ticker, expiry, symbols, strikes, liveData) {
      openIDB(function(db) {
        if (!db) return;
        idbPurgeIfStale(db, function() {
          var tx    = db.transaction(_IDB_STORE, 'readwrite');
          var store = tx.objectStore(_IDB_STORE);
          var entry = {
            key:      ticker + '|' + expiry,
            ticker:   ticker,
            expiry:   expiry,
            symbols:  symbols || [],
            strikes:  strikes  || [],
            liveData: liveData  || {},
            savedAt:  Date.now()
          };
          store.put(entry);
          tx.oncomplete = function() { updateCacheBadge(); };
        });
      });
    }

    function loadSubCacheEntry(ticker, expiry, cb) {
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

    function loadAllCacheEntries(cb) {
      openIDB(function(db) {
        if (!db) { cb([]); return; }
        idbPurgeIfStale(db, function() {
          var results = [];
          var tx = db.transaction(_IDB_STORE, 'readonly');
          tx.objectStore(_IDB_STORE).openCursor().onsuccess = function(e) {
            var cursor = e.target.result;
            if (cursor) { results.push(cursor.value); cursor.continue(); }
            else cb(results);
          };
        });
      });
    }

    function updateCacheBadge() {
      loadAllCacheEntries(function(entries) {
        var count = entries.length;
        var badge   = el('chain-cache-badge');
        var countEl = el('chain-cache-count');
        if (badge)   badge.style.display  = count > 0 ? 'flex' : 'none';
        if (countEl) countEl.textContent  = count;
      });
    }

    window.chainToggleCachePopover = function() {
      var popover = el('chain-cache-popover');
      if (!popover) return;
      var isOpen = popover.style.display !== 'none';
      if (isOpen) { popover.style.display = 'none'; return; }

      loadAllCacheEntries(function(entries) {
        var list = el('chain-cache-popover-list');
        if (!list) return;
        if (!entries.length) {
          list.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#475569">Nothing cached yet</div>';
        } else {
          entries.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
          list.innerHTML = entries.map(function(e) {
            var time = e.savedAt ? new Date(e.savedAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false }) : '--';
            var syms = (e.symbols || []).length;
            var active = e.ticker === _activeTicker && e.expiry === _activeExpiry;
            return '<div onclick="chainLoadFromCache(\'' + e.ticker + '\',\'' + e.expiry + '\')" style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;cursor:pointer;background:' + (active ? 'rgba(0,229,255,.08)' : 'transparent') + ';border-left:2px solid ' + (active ? '#00e5ff' : 'transparent') + '">'
              + '<div>'
              + '<span style="font-size:11px;font-weight:800;color:#00e5ff">' + e.ticker + '</span>'
              + '<span style="font-size:10px;color:#64748b;margin-left:6px">' + e.expiry + '</span>'
              + '</div>'
              + '<div style="text-align:right">'
              + '<span style="font-size:9px;color:#334155;display:block">' + syms + ' syms</span>'
              + '<span style="font-size:9px;color:#334155">' + time + '</span>'
              + '</div>'
              + '</div>';
          }).join('');
        }
        popover.style.display = 'block';

        // Close on outside click
        setTimeout(function() {
          document.addEventListener('click', function handler(ev) {
            if (!popover.contains(ev.target) && ev.target.id !== 'chain-cache-badge') {
              popover.style.display = 'none';
              document.removeEventListener('click', handler);
            }
          });
        }, 0);
      });
    };

    window.chainLoadFromCache = function(ticker, expiry) {
      var popover = el('chain-cache-popover');
      if (popover) popover.style.display = 'none';
      var input = el('chain-ticker-select');
      var expSel = el('chain-expiry-select');
      if (input) input.value = ticker;
      var lbl = el('chain-ticker-label');
      if (lbl) lbl.textContent = ticker;
      if (ticker !== _activeTicker || !_expirations.length) {
        _activeTicker = ticker;
        _expirations = []; _activeExpiry = null;
        fetchExpirations(function() {
          var s = el('chain-expiry-select');
          if (s) s.value = expiry;
          _activeExpiry = expiry;
          loadExpiry(expiry);
        });
      } else {
        if (expSel) expSel.value = expiry;
        _activeExpiry = expiry;
        loadExpiry(expiry);
      }
    };

    function sendSubscriptions() {
      var symbols = window._chainSymbolsToSubscribe || [];
      if (!symbols.length) {
        _subSymbols = [];
        _strikes.forEach(function(r) {
          if (r.callSym) _subSymbols.push(r.callSym);
          if (r.putSym)  _subSymbols.push(r.putSym);
        });
        symbols = _subSymbols;
      }
      if (!symbols.length) return;
      _subSymbols = symbols.slice();
      window._chainSymbolsToSubscribe = null;
      // Use REST POST — the WS path is gated by shouldAcceptBrowserSubscription
      // which blocks non-SPXW option symbols. The POST endpoint has no such filter.
      var feedTypesBySymbol = {};
      symbols.forEach(function(s) { feedTypesBySymbol[s] = ['Quote','Greeks','Summary','Trade']; });
      fetch('/proxy/dxlink/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: symbols, feedTypesBySymbol: feedTypesBySymbol })
      }).catch(function(e) { console.warn('[Chain] subscribe POST failed:', e); });
      if (_ws && _ws.readyState === 1) {
        try {
          _ws.send(JSON.stringify({ type: 'subscribe', symbols: symbols, feedTypesBySymbol: feedTypesBySymbol }));
        } catch (err) {}
      }
    }

    function handleMsg(raw) {
      var msg; try { msg = JSON.parse(raw); } catch(e) { return; }
      if (msg.type !== 'FEED_DATA') return;
      var data = msg.data;
      if (!Array.isArray(data)) return;
      if (!_wsDataStartTime) _wsDataStartTime = Date.now();
      var changed = false;
      data.forEach(function(ev) {
        if (!ev || !ev.eventSymbol) return;
        var t = ev.eventType;
        if (t === 'Quote')   { applyQuote(ev);   changed = true; }
        if (t === 'Greeks')  { applyGreeks(ev);  changed = true; }
        if (t === 'Summary') { applySummary(ev); changed = true; }
        if (t === 'Trade')   { applyTrade(ev);   changed = true; }
      });
      if (changed) scheduleRender();
    }

    function applyQuote(ev) {
      var sym=ev.eventSymbol;
      if (!_liveData[sym]) _liveData[sym]={};
      var d=_liveData[sym];
      if (ev.bidPrice  != null) d.bid  = ev.bidPrice;
      if (ev.askPrice  != null) d.ask  = ev.askPrice;
      if (ev.lastPrice != null) d.last = ev.lastPrice;
      if (ev.lastSize  != null) d.size = ev.lastSize;
    }

    function applyGreeks(ev) {
      var sym = ev.eventSymbol;
      if (!_liveData[sym]) _liveData[sym] = {};
      var d = _liveData[sym];
      if (ev.volatility != null) d.iv    = ev.volatility;
      if (ev.delta      != null) d.delta = ev.delta;
      if (ev.gamma      != null) d.gamma = ev.gamma;
      if (ev.theta      != null) d.theta = ev.theta;
      if (ev.vega       != null) d.vega  = ev.vega;
    }

    function applySummary(ev) {
      var sym = ev.eventSymbol;
      if (!_liveData[sym]) _liveData[sym] = {};
      var d = _liveData[sym];
      var prevOI = d.oi || 0;
      var newOI = ev.openInterest || ev['open-interest'] || ev.open_interest || 0;
      if (newOI > 0 && newOI !== prevOI) {
        d.oi = newOI;
        // Only log significant changes
        if (Math.abs(newOI - prevOI) > Math.max(prevOI * 0.05, 100)) {
          console.log('[Chain OI]', sym, ':', prevOI, '→', newOI);
        }
      }
      if (ev.dayVolume != null) {
        d.vol = ev.dayVolume;
      }
    }

    function applyTrade(ev) {
      var sym = ev.eventSymbol;
      if (!_liveData[sym]) _liveData[sym] = {};
      var d = _liveData[sym];
      if (ev.dayVolume != null && ev.dayVolume > 0) d.vol  = ev.dayVolume;
      if (ev.price     != null && ev.price     > 0) d.last = ev.price;
      if (ev.size      != null)                     d.size = ev.size;
    }

    function scheduleRender() {
      if (_renderBlocked) return;
      if (_renderTimer) return;
      _renderTimer = setTimeout(function() {
        _renderTimer = null;
        if (window.esPrice > 1000) _spot = window.esPrice;
        renderTable();
      }, 120);
    }

    // ── public API ─────────────────────────────────────────────────────────────
    window.chainInit = function() {
      buildTickerDropdown();
      bindExpirySelect();
      setPriceMode(_priceMode);
      var input = el('chain-ticker-select');
      if (input) input.value = _activeTicker;
      var label = el('chain-ticker-label');
      if (label) label.textContent = _activeTicker;

      // Start with empty state — no auto-load
      setStatus('idle', 'Ready to load');

      // Defer fetchExpirations until user selects a ticker to avoid blocking on page load
      var bodyEl = el('chain-body');
      if (bodyEl && !bodyEl._userScrollBound) {
        bodyEl._userScrollBound = true;
        ['wheel', 'touchstart', 'pointerdown', 'mousedown', 'scroll'].forEach(function(type) {
          bodyEl.addEventListener(type, function() {
            window.__chainAutoCenterBlocked = true;
          }, { passive: true });
        });
      }
    };

    var _autoRefreshTimer = null;
    var _autoRefreshCount = 0;

    function startAutoRefresh() {
      if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
      _autoRefreshCount = 0;
      _autoRefreshTimer = setInterval(function() {
        _autoRefreshCount++;
        if (_autoRefreshCount >= 5) { // 5 refreshes × 2 sec = 10 seconds
          clearInterval(_autoRefreshTimer);
          _autoRefreshTimer = null;
          return;
        }
        // Re-render to pick up new WS data
        renderTable();
      }, 2000);
    }

    window.chainGo = function() {
      var tickerInput = el('chain-ticker-select');
      var expSel      = el('chain-expiry-select');
      var ticker = tickerInput ? tickerInput.value.trim().toUpperCase() : 'SPX';
      var expiry = expSel ? expSel.value : null;
      var lbl = el('chain-ticker-label');
      if (lbl) lbl.textContent = ticker || 'SPX';

      if (ticker !== _activeTicker || !_expirations.length) {
        _activeTicker = ticker || 'SPX';
        _expirations = []; _activeExpiry = null;
        fetchExpirations(function() {
          var expSel2 = el('chain-expiry-select');
          var e = expSel2 ? expSel2.value : null;
          if (e) { _activeExpiry = e; loadExpiry(e); startAutoRefresh(); }
          else setStatus('idle', 'PICK EXPIRY');
        });
      } else {
        if (!expiry) { setStatus('err', 'SELECT EXPIRY'); return; }
        _activeExpiry = expiry;
        loadExpiry(expiry);
        startAutoRefresh();
      }
    };

    window.chainLoad = window.chainGo;

    // ── screenshot / share ─────────────────────────────────────────────────────
    var CHAIN_DISCORD_WEBHOOK = '/proxy/api/discord-webhook';
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

    function chainBtnState(btn, text, color) {
      if (!btn) return;
      btn.textContent = text;
      btn.style.color = color;
    }

    function chainBtnRestore(btn, orig, color) {
      setTimeout(function() { chainBtnState(btn, orig, color); }, 1500);
    }

    function captureChain(cb) {
      var chainMain = document.getElementById('chain-main');
      var target = document.getElementById('chain-capture-zone');
      if (!target) { cb(new Error('no target'), null); return; }
      var headerRow = document.getElementById('chain-header');

      var hdr    = document.getElementById('chain-shot-header');
      var ticker = document.getElementById('chain-shot-ticker');
      var expiry = document.getElementById('chain-shot-expiry');
      var time   = document.getElementById('chain-shot-time');
      if (ticker) ticker.textContent = _activeTicker || 'SPX';
      if (expiry) expiry.textContent = _activeExpiry  || '--';
      if (time)   time.textContent   = new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) + ' ET';
      if (hdr)    hdr.style.display  = 'flex';

      loadHtml2Canvas().then(function(html2canvasFn) {
        var prev = {};
        function stash(el, prop) { if (!el) return; prev[prop] = el.style.cssText; }
        stash(chainMain, 'main');
        stash(target, 'target');
        stash(headerRow, 'header');
        stash(hdr, 'shot');
        try {
          if (chainMain) {
            chainMain.style.overflow = 'visible';
            chainMain.style.position = 'relative';
            chainMain.style.height = 'auto';
            chainMain.style.minHeight = '0';
          }
          if (target) {
            target.style.overflow = 'visible';
            target.style.maxHeight = 'none';
            target.style.minHeight = '0';
          }
          if (headerRow) {
            headerRow.style.position = 'sticky';
            headerRow.style.top = '0';
            headerRow.style.zIndex = '20';
          }

          html2canvasFn(chainMain || target, {
            backgroundColor: '#05080d',
            scale: 2,
            useCORS: true,
            logging: false,
            allowTaint: true
          }).then(function(canvas) {
            if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
            if (target && prev.target !== undefined) target.style.cssText = prev.target;
            if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
            if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
            canvas.toBlob(function(blob) { cb(null, blob); }, 'image/png');
          }).catch(function(e) {
            if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
            if (target && prev.target !== undefined) target.style.cssText = prev.target;
            if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
            if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
            cb(e, null);
          });
        } catch (err) {
          if (chainMain && prev.main !== undefined) chainMain.style.cssText = prev.main;
          if (target && prev.target !== undefined) target.style.cssText = prev.target;
          if (headerRow && prev.header !== undefined) headerRow.style.cssText = prev.header;
          if (hdr && prev.shot !== undefined) hdr.style.cssText = prev.shot;
          cb(err, null);
        }
      }).catch(function(err) {
        if (hdr) hdr.style.display = 'none';
        cb(err || new Error('html2canvas unavailable'), null);
      });
    }

    function buildChainScreenshot(cb) {
      var chainMain = document.getElementById('chain-main');
      if (!chainMain) { cb(new Error('no target'), null); return; }

      var spot = _spot > 0 ? _spot : (window.esPrice > 0 ? window.esPrice : 0);
      var filtered;
      if (_rangePercent === 'all') {
        filtered = _strikes.filter(function(r) {
          var cd = _liveData[r.callSym] || r.callTT || {};
          var pd = _liveData[r.putSym]  || r.putTT  || {};
          return (parseFloat(cd.bid) > 0 || parseFloat(cd.ask) > 0 || parseFloat(cd.last) > 0 || parseFloat(cd.oi) > 0 || parseFloat(cd.vol) > 0) ||
                 (parseFloat(pd.bid) > 0 || parseFloat(pd.ask) > 0 || parseFloat(pd.last) > 0 || parseFloat(pd.oi) > 0 || parseFloat(pd.vol) > 0);
        }).sort(function(a,b){ return b.strike - a.strike; });
      } else {
        var pctRange = _rangePercent / 100;
        var lowerBound = spot * (1 - pctRange);
        var upperBound = spot * (1 + pctRange);
        filtered = _strikes.filter(function(r) {
          return r.strike >= lowerBound && r.strike <= upperBound;
        }).sort(function(a,b){ return b.strike - a.strike; });
      }
      if (!filtered.length) { cb(new Error('no strikes to capture'), null); return; }

      var cols = screenshotColsCSS();
      var html = '';

      // Title header with ticker, expiry, timestamp
      var ticker = _activeTicker || 'SPX';
      var expiry = _activeExpiry || '--';
      var timestamp = new Date().toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) + ' ET';

      html += '<div style="padding:10px 12px;background:#05080d;border-bottom:2px solid rgba(0,229,255,.2);display:flex;align-items:center;justify-content:space-between;font-family:Arial">';
      html += '<div style="display:flex;gap:16px;align-items:center">';
      html += '<div style="font-size:14px;font-weight:800;color:#00e5ff;letter-spacing:.1em">' + ticker + '</div>';
      html += '<div style="font-size:11px;color:#94a3b8;font-weight:700">' + expiry + '</div>';
      html += '</div>';
      html += '<div style="font-size:10px;color:#475569;font-family:Arial,monospace">' + timestamp + '</div>';
      html += '</div>';

      // Header
      var callH = SCREENSHOT_CALL_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:'+(c==='symbol'?'left':'right')+';color:#2298cf;font-family:Arial;font-size:11px;font-weight:800">'+(COL_LABELS[c]||c)+'</div>';
      });
      var netH = SCREENSHOT_NET_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:center;color:#a78bfa;font-family:Arial;font-size:11px;font-weight:800">'+(COL_LABELS[c]||c)+'</div>';
      });
      var strikeH = '<div style="padding:5px 6px;text-align:center;color:#e4e4e7;font-family:Arial;font-size:11px;font-weight:800">Strike</div>';
      var putH = SCREENSHOT_PUT_COLS.map(function(c) {
        return '<div style="padding:5px 6px;text-align:right;color:#ff7c88;font-family:Arial;font-size:11px;font-weight:800">'+(COL_LABELS[c]||c)+'</div>';
      });

      html += '<div style="display:grid;grid-template-columns:'+cols+';background:var(--bg2);border-bottom:2px solid var(--border2);flex-shrink:0">';
      html += callH.join('') + netH.join('') + strikeH + putH.join('');
      html += '</div>';

      // Rows
      var maxAbs = { gex: 1, dex: 1, chex: 1, vex: 1 };
      filtered.forEach(function(row) {
        var cd = _liveData[row.callSym] || {};
        var pd = _liveData[row.putSym] || {};
        if ((!cd.bid && !cd.ask && !cd.last && !cd.vol && !cd.oi) && row.callTT) {
          cd = Object.assign({}, cd, row.callTT);
        }
        if ((!pd.bid && !pd.ask && !pd.last && !pd.vol && !pd.oi) && row.putTT) {
          pd = Object.assign({}, pd, row.putTT);
        }
        var cc = (parseFloat(cd.oi)||0) + (parseFloat(cd.vol)||0);
        var pc = (parseFloat(pd.oi)||0) + (parseFloat(pd.vol)||0);
        var gex  = Math.abs(((parseFloat(cd.gamma)||0)*cc - (parseFloat(pd.gamma)||0)*pc) * spot * spot * 0.01 * 100);
        var dex  = Math.abs((Math.abs(parseFloat(cd.delta)||0)*cc - Math.abs(parseFloat(pd.delta)||0)*pc) * spot * 100);
        var chex = Math.abs((-(parseFloat(cd.theta)||0)*cc + (parseFloat(pd.theta)||0)*pc) * spot * 100);
        var vex  = Math.abs(((parseFloat(cd.vega)||0)*cc - (parseFloat(pd.vega)||0)*pc) * spot * 100);
        if (gex > maxAbs.gex) maxAbs.gex = gex;
        if (dex > maxAbs.dex) maxAbs.dex = dex;
        if (chex > maxAbs.chex) maxAbs.chex = chex;
        if (vex > maxAbs.vex) maxAbs.vex = vex;
      });

      function metricBg(value, maxValue) {
        var n = parseFloat(value) || 0;
        if (!n) return 'transparent';
        var ratio = Math.min(Math.abs(n) / Math.max(maxValue, 1) * (0.35 + _chainIntensity * 0.65), 1);
        var alpha = 0.08 + Math.pow(ratio, 1.45) * 0.82;
        return n >= 0 ? 'rgba(0,229,255,' + alpha.toFixed(2) + ')' : 'rgba(255,71,87,' + alpha.toFixed(2) + ')';
      }

      // Find ATM strike
      var atmStrike = spot > 0 ? filtered.reduce(function(best, r) {
        return Math.abs(r.strike-spot) < Math.abs(best.strike-spot) ? r : best;
      }, filtered[0]).strike : 0;

      filtered.forEach(function(row) {
        var isATM = row.strike === atmStrike;
        var cd = _liveData[row.callSym] || {};
        var pd = _liveData[row.putSym] || {};
        if ((!cd.bid && !cd.ask && !cd.last && !cd.vol && !cd.oi) && row.callTT) {
          cd = Object.assign({}, cd, row.callTT);
        }
        if ((!pd.bid && !pd.ask && !pd.last && !pd.vol && !pd.oi) && row.putTT) {
          pd = Object.assign({}, pd, row.putTT);
        }

        var cc = (parseFloat(cd.oi)||0) + (parseFloat(cd.vol)||0);
        var pc = (parseFloat(pd.oi)||0) + (parseFloat(pd.vol)||0);
        var netGex  = ((parseFloat(cd.gamma)||0)*cc - (parseFloat(pd.gamma)||0)*pc) * spot * spot * 0.01 * 100;
        var netDex  = (Math.abs(parseFloat(cd.delta)||0)*cc - Math.abs(parseFloat(pd.delta)||0)*pc) * spot * 100;
        var netChex = (-(parseFloat(cd.theta)||0)*cc + (parseFloat(pd.theta)||0)*pc) * spot * 100;
        var netVex  = ((parseFloat(cd.vega)||0)*cc - (parseFloat(pd.vega)||0)*pc) * spot * 100;

        function cell(col, d, side) {
          var v='--', color='#a8b8cc', align='right';
          var mid = (d.bid != null && d.ask != null && isFinite(d.bid) && isFinite(d.ask)) ? ((d.bid + d.ask) / 2) : null;
          if (col==='symbol') {
            v = (row.strike%1===0 ? row.strike.toFixed(0) : row.strike.toFixed(2)) + ' ' + (side==='call'?'C':'P');
            color = side==='call' ? '#4db8ff' : '#ff7c88'; align = side==='call' ? 'left' : 'right';
          }
          else if (col==='last')  { v=fp(d.last,2);       color='#e4e4e7'; }
          else if (col==='iv')    { v=fpPct(d.iv);         color='#7278ca'; }
          else if (col==='oi')    { v=fmtWhole(d.oi);      color='#94a3b8'; }
          else if (col==='vol')   { v=fmtWhole(d.vol);     color='#e4e4e7'; }
          return '<div style="padding:5px 8px;font-size:12px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:'+align+';color:'+color+'">'+v+'</div>';
        }

        function netCell(val, maxVal) {
          var v = val ? fmtMoney(val) : '--';
          var bg = metricBg(val, maxVal);
          return '<div style="padding:5px 8px;font-size:11px;font-family:Arial,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;color:#ffffff;background:'+bg+';font-weight:700">'+v+'</div>';
        }

        var strikeColor = isATM ? '#ffb300' : '#94a3b8';
        var strikeBg = isATM ? 'background:rgba(255,179,0,.12)' : '';
        var strikeCell = '<div style="padding:4px 6px;font-size:12px;font-weight:800;font-family:Arial,monospace;text-align:center;color:'+strikeColor+';border-left:1px solid rgba(255,255,255,.06);border-right:1px solid rgba(255,255,255,.06);'+strikeBg+'">'
          + row.strike.toFixed(row.strike%1===0?0:2)
          + '</div>';

        var rowBg = isATM ? 'background:rgba(255,179,0,.07);border-top:1px solid rgba(255,179,0,.25);border-bottom:1px solid rgba(255,179,0,.25)' : 'border-bottom:1px solid rgba(30,48,80,.35)';
        var callCells = SCREENSHOT_CALL_COLS.map(function(c){ return cell(c, cd, 'call'); }).join('');
        var putCells  = SCREENSHOT_PUT_COLS.map(function(c){  return cell(c, pd, 'put');  }).join('');
        var netCells  = netCell(netGex, maxAbs.gex) + netCell(netDex, maxAbs.dex) + netCell(netChex, maxAbs.chex) + netCell(netVex, maxAbs.vex);

        html += '<div style="display:grid;grid-template-columns:'+cols+';'+rowBg+'">'+callCells+netCells+strikeCell+putCells+'</div>';
      });

      var wrapper = document.createElement('div');
      wrapper.id = 'chain-screenshot-wrapper';
      wrapper.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1200px;background:#05080d;font-family:Arial,sans-serif';
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

    window.chainCopyScreenshot = function() {
      var btn = document.getElementById('chain-copy-btn');
      var origText = btn ? btn.textContent : 'COPY';
      var origColor = '#00e5ff';
      if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }
      buildChainScreenshot(function(err, blob) {
        if (err || !blob) {
          console.error('[Chain] copy capture failed:', err);
          if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
          return;
        }
        if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
          navigator.clipboard.write([new ClipboardItem({'image/png': blob})]).then(function() {
            if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
          }).catch(function(err2) {
            var url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
            if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
          });
        } else {
          var url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
          if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
        }
      });
    };

    window.chainShare = function(platform) {
      var btn = platform === 'x' ? document.getElementById('chain-share-x-btn') : document.getElementById('chain-share-discord-btn');
      var origColor = platform === 'x' ? '#00e5ff' : '#7289da';
      var origText = btn ? btn.textContent : (platform === 'x' ? 'X' : 'DISCORD');
      if (btn) { btn.textContent = '…'; btn.style.color = '#ffb300'; }

      if (platform === 'x') {
        var ticker = _activeTicker || 'SPX';
        var expiry = _activeExpiry || '';
        setTimeout(function() {
          if (btn) { btn.textContent = origText; btn.style.color = origColor; }
          window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(ticker + ' Options Chain ' + expiry), '_blank');
        }, 200);
        return;
      }

      buildChainScreenshot(function(err, blob) {
        if (err || !blob) {
          console.error('[Chain] discord capture failed:', err);
          if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
          return;
        }
        var form = new FormData();
        var ticker = _activeTicker || 'SPX';
        var expiry = _activeExpiry || '';
        form.append('payload_json', JSON.stringify({ content: ticker + ' Options Chain ' + expiry }));
        form.append('files[0]', blob, 'chain-' + ticker + '-' + expiry + '.png');
        fetch(CHAIN_DISCORD_WEBHOOK, { method: 'POST', body: form }).then(function(res) {
          if (!res.ok) throw new Error('webhook ' + res.status);
          if (btn) { btn.textContent = '✓'; btn.style.color = '#00e676'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
        }).catch(function(err2) {
          console.error('[Chain] discord webhook failed:', err2);
          if (btn) { btn.textContent = 'ERR'; btn.style.color = '#ff4757'; setTimeout(function(){ btn.textContent = origText; btn.style.color = origColor; }, 1500); }
        });
      });
    };

  })();
  // ── END OPTIONS CHAIN ────────────────────────────────────────────────────────

  window.init_insights_options_chain = function() {
    if (typeof window.chainInit === 'function') window.chainInit();
  };

  if (window.PageRuntime?.register) {
    window.PageRuntime.register('options-chain', () => {});
  }
})();
