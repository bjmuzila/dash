// =============================================================================
// Daily Estimated Moves — IndexedDB-cached, after-5PM-only fetch
// Logic:
//   • After 17:00 ET, fetch EM for NEXT trading day's expiration (today's 0DTE
//     is already expired/expiring; we want tomorrow's chain).
//   • Before 17:00 ET, try to load the cached EM for today's trade date.
//   • Once fetched and saved, NEVER re-fetch until the date key changes
//     (i.e. the next trading day arrives after 5PM).
//   • ES levels = SPX levels + (esClose - spxClose) basis.
//   • RECALC button force-overwrites the cache for the current fetch-date.
// =============================================================================

(function() {

  // ── helpers ────────────────────────────────────────────────────────────────

  function getEtNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  }

  // Returns "YYYY-MM-DD" in ET
  function etDateStr(d) {
    d = d || getEtNow();
    return d.toISOString().slice(0, 10);
  }

  // Next calendar day that is Mon-Fri (skips Sat/Sun; does NOT skip holidays)
  function nextTradingDate(d) {
    const next = new Date(d);
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() === 0 || next.getDay() === 6);
    return next;
  }

  // The "fetch date key" is the date whose EM we are computing:
  //   • After 5PM ET weekday  → tomorrow (next trading day)
  //   • Before 5PM ET weekday → today   (morning load, show today's pre-fetched EM)
  // Weekends: use next Monday.
  function getFetchDateKey() {
    const now = getEtNow();
    const dow = now.getDay(); // 0=Sun … 6=Sat
    const etMins = now.getHours() * 60 + now.getMinutes();
    const afterFivePM = etMins >= 17 * 60;

    // Weekend or after-5PM weekday → next trading day
    if (dow === 0 || dow === 6 || afterFivePM) {
      return etDateStr(nextTradingDate(now));
    }
    // Before 5PM on a weekday → return today (will only render from cache)
    return etDateStr(now);
  }

  // True only if it's currently after 5PM ET on a weekday (fetch window)
  function isAfterFivePM() {
    const now = getEtNow();
    const dow = now.getDay();
    if (dow === 0 || dow === 6) return false;
    return (now.getHours() * 60 + now.getMinutes()) >= 17 * 60;
  }

  // ── IndexedDB store ────────────────────────────────────────────────────────
  // DB name: "gex_dashboard"  Store: "daily_em"  Key: dateString "YYYY-MM-DD"

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('gex_dashboard', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('daily_em')) {
          db.createObjectStore('daily_em', { keyPath: 'date' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function loadCachedEM(dateKey) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx  = db.transaction('daily_em', 'readonly');
        const req = tx.objectStore('daily_em').get(dateKey);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror   = e => reject(e.target.error);
      });
    } catch (e) {
      console.warn('[DailyEM] loadCachedEM error:', e);
      return null;
    }
  }

  async function saveCachedEM(record) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx  = db.transaction('daily_em', 'readwrite');
        const req = tx.objectStore('daily_em').put(record);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
      });
    } catch (e) {
      console.warn('[DailyEM] saveCachedEM error:', e);
    }
  }

  // ── DOM render ─────────────────────────────────────────────────────────────

  function fmt2(n)  { return (n && isFinite(n) && n > 0) ? n.toFixed(2) : '—'; }
  function fmtP(n)  { return (n && isFinite(n) && n > 0) ? (n * 100).toFixed(2) + '%' : '—'; }

  function renderEM(prefix, refPrice, em) {
    const up   = document.getElementById('em-' + prefix + '-1up');
    const dn   = document.getElementById('em-' + prefix + '-1dn');
    const rng  = document.getElementById('em-' + prefix + '-range');
    const pct  = document.getElementById('em-' + prefix + '-pct');
    const ref  = document.getElementById('em-' + prefix + '-ref');
    if (up)  up.textContent  = fmt2(refPrice + em);
    if (dn)  dn.textContent  = fmt2(refPrice - em);
    if (rng) rng.textContent = fmt2(em);
    if (pct) pct.textContent = fmtP(em / refPrice);
    if (ref) ref.textContent = 'cls: ' + fmt2(refPrice);
  }

  function renderFromRecord(rec) {
    // rec = { date, spxClose, esClose, ndxClose, nqClose, spxEM, ndxEM, fetchedAt, expDate, expDateNDX }
    if (!rec) return;
    const basis = (rec.esClose > 0 && rec.spxClose > 0) ? (rec.esClose - rec.spxClose) : 0;
    const esRef = rec.spxClose + basis;  // == esClose when both present
    renderEM('es', esRef  || rec.spxClose, rec.spxEM);
    renderEM('nq', rec.nqClose || rec.ndxClose, rec.ndxEM);
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  const PROXY = 'http://localhost:3001';

  function num(...args) {
    for (const v of args) { const n = parseFloat(v); if (isFinite(n) && n > 0) return n; }
    return 0;
  }

  // Get first non-expired expiration date AFTER today (exclusive)
  // This gives us "next trading day" expiration for after-5PM use
  function getNextExp(items, afterDate) {
    if (!items || !items.length) return null;
    const cutoff = afterDate; // "YYYY-MM-DD" string; we want exp > cutoff
    const exps = items
      .map(g => g['expiration-date'])
      .filter(e => e > cutoff)
      .sort();
    return exps.length > 0 ? exps[0] : null;
  }

  function atmStrike(strikes, spot) {
    let best = strikes[0], d = Infinity;
    strikes.forEach(s => {
      const v = Math.abs(parseFloat(s['strike-price']) - spot);
      if (v < d) { d = v; best = s; }
    });
    return best;
  }

  function straddlePrice(s) {
    const c = parseFloat(s.call?.last)  || ((parseFloat(s.call?.bid  || 0) + parseFloat(s.call?.ask  || 0)) / 2);
    const p = parseFloat(s.put?.last)   || ((parseFloat(s.put?.bid   || 0) + parseFloat(s.put?.ask   || 0)) / 2);
    return c + p;
  }

  // ── main fetch ─────────────────────────────────────────────────────────────

  window.updateDailyEM = async function(forceRefetch = false) {
    const fetchDateKey = getFetchDateKey();

    // ── 1. Try cache first ──────────────────────────────────────────────────
    if (!forceRefetch) {
      const cached = await loadCachedEM(fetchDateKey);
      if (cached && cached.spxEM > 0 && cached.ndxEM > 0) {
        renderFromRecord(cached);
        console.log('[DailyEM] Loaded from cache for', fetchDateKey);
        return;
      }
    }

    // ── 2. Only actually fetch after 5PM ET ─────────────────────────────────
    if (!forceRefetch && !isAfterFivePM()) {
      console.log('[DailyEM] Not after 5PM ET — skipping fetch. Date key:', fetchDateKey);
      return;
    }

    console.log('[DailyEM] Fetching for date key:', fetchDateKey);

    try {
      // ── 3. Get closes (ESM6, SPX, NQM6, NDX) ──────────────────────────────
      const r1 = await fetch(PROXY + '/proxy/api/tt/quotes-batch');
      if (!r1.ok) throw new Error('quotes-batch ' + r1.status);
      const items = ((await r1.json()).data || {}).items || [];

      let spxClose = 0, esClose = 0, ndxClose = 0, nqClose = 0;
      items.forEach(q => {
        const sym   = (q.symbol || '').split(':')[0];
        const price = num(q.last, q.mark, q['last-price'], q['mark-price']);
        const chg   = num(q.change, q['net-change'], q['day-change']);
        const prev  = num(q['prev-close'], q.prevClose, q['previous-close'], q['settlement-price'])
                      || (price > 0 && chg !== 0 ? price - chg : 0)
                      || price;
        if (sym === 'SPX' || sym === '$SPX') spxClose = prev;
        if (sym === 'NDX' || sym === '$NDX') ndxClose = prev;
        if (sym.startsWith('/ES'))            { esClose  = prev; }
        if (sym.startsWith('/NQ'))            { nqClose  = prev; }
      });

      // Also try window globals set by overview.js if API fields are missing
      if (!spxClose && window.spxPrevClose > 0) spxClose = window.spxPrevClose;
      if (!esClose  && window.esPrevClose  > 0) esClose  = window.esPrevClose;
      if (!ndxClose && window.ndxPrevClose > 0) ndxClose = window.ndxPrevClose;
      if (!nqClose  && window.nqPrevClose  > 0) nqClose  = window.nqPrevClose;

      if (!spxClose) throw new Error('SPX close missing');
      if (!ndxClose) throw new Error('NDX close missing');

      // Persist closes to localStorage so overnight SPX price conversion works
      try {
        localStorage.setItem('todayCloses', JSON.stringify({
          date: fetchDateKey,
          es:  +(esClose  || spxClose).toFixed(2),
          spx: +spxClose.toFixed(2),
          capturedAt: new Date().toISOString()
        }));
      } catch (_) {}

      // ── 4. SPX chain → EM for fetchDateKey expiration ─────────────────────
      const r2 = await fetch(PROXY + '/proxy/api/tt/chains/SPX?range=all');
      if (!r2.ok) throw new Error('SPX chain ' + r2.status);
      const spxItems  = ((await r2.json()).data || {}).items || [];

      // After 5PM the current date's 0DTE is gone; we want first exp > today
      const todayStr = etDateStr();
      const spxExp   = getNextExp(spxItems, todayStr);
      const spxGrp   = spxItems.find(g => g['expiration-date'] === spxExp);
      if (!spxGrp?.strikes?.length) throw new Error('SPX no strikes for exp=' + spxExp);

      const spxAtm      = atmStrike(spxGrp.strikes, spxClose);
      const spxStraddle = straddlePrice(spxAtm);
      const spxEM       = spxStraddle * 0.84;
      if (spxEM <= 0) throw new Error('SPX EM=0');

      // ── 5. NDX chain → EM ─────────────────────────────────────────────────
      const r3 = await fetch(PROXY + '/proxy/api/tt/chains/NDX?range=all');
      if (!r3.ok) throw new Error('NDX chain ' + r3.status);
      const ndxItems  = ((await r3.json()).data || {}).items || [];
      const ndxExp    = getNextExp(ndxItems, todayStr);
      const ndxGrp    = ndxItems.find(g => g['expiration-date'] === ndxExp);
      if (!ndxGrp?.strikes?.length) throw new Error('NDX no strikes for exp=' + ndxExp);

      const ndxAtm      = atmStrike(ndxGrp.strikes, ndxClose);
      const ndxStraddle = straddlePrice(ndxAtm);
      const ndxEM       = ndxStraddle * 0.84;
      if (ndxEM <= 0) throw new Error('NDX EM=0');

      // ── 6. Save to IndexedDB ───────────────────────────────────────────────
      const record = {
        date:      fetchDateKey,          // key = YYYY-MM-DD of next trading day
        spxClose,
        esClose:   esClose  || spxClose,
        ndxClose,
        nqClose:   nqClose  || ndxClose,
        spxEM,
        ndxEM,
        expDate:    spxExp,
        expDateNDX: ndxExp,
        fetchedAt:  new Date().toISOString()
      };
      await saveCachedEM(record);

      // ── 7. Render ──────────────────────────────────────────────────────────
      renderFromRecord(record);

      console.log('[DailyEM] Saved & rendered. SPX EM=' + spxEM.toFixed(2) +
                  ' NDX EM=' + ndxEM.toFixed(2) + ' exp=' + spxExp);

    } catch (e) {
      console.warn('[DailyEM] fetch failed:', e.message);
    }
  };

  // RECALC button force-overwrites — expose globally
  window.forceRefetchDailyEM = function() {
    return window.updateDailyEM(true);
  };

})();
