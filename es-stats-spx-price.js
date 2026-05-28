;(function(){
  const ES_SYMBOLS = ['/ES', '/ESM6', 'ESM'];
  const SPX_SYMBOLS = ['$SPX', 'SPX'];
  const PRICE_KEYS = ['mark','mid','last','lastPrice','close','price','bid'];
  const PREV_KEYS = ['prev-close', 'previousClose','prevClose','previous_close','prev_close','priorClose','prior_close','close'];

  const num = (value) => {
    if (value == null) return NaN;
    const n = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };

  const firstNumber = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return NaN;
    for (const key of keys) {
      const n = num(obj[key]);
      if (Number.isFinite(n)) return n;
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const n = firstNumber(value, keys);
        if (Number.isFinite(n)) return n;
      }
    }
    return NaN;
  };

  const quoteMap = async (symbols) => {
    const urls = [
      `/proxy/api/tt/quotes-batch?index[]=SPX&index[]=SPXW&future[]=${encodeURIComponent('/ESM6')}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache:'no-store' });
        if (!r.ok) continue;
        const json = await r.json();
        const out = {};
        // TT returns: { data: { items: [...] } }
        const items = json?.data?.items || [];
        if (Array.isArray(items)) {
          items.forEach(q => {
            const sym = String(q.symbol || q.eventSymbol || '').toUpperCase();
            out[sym] = q;
            // Map SPX/SPXW to $SPX key for consistent lookup
            if (sym === 'SPX' || sym === 'SPXW' || sym === '$SPX' || sym === '$SPXW') out['$SPX'] = q;
            if (sym.includes('ESM') || sym.startsWith('/ES')) out['/ES'] = q;
          });
        }
        if (Object.keys(out).length) return out;
      } catch (_) {}
    }
    return {};
  };

  const pickQuote = (map, symbols) => {
    for (const symbol of symbols) {
      const key = symbol.toUpperCase();
      if (map[key]) return map[key];
      const found = Object.entries(map).find(([k]) => k.includes(key.replace(/[^A-Z0-9]/g, '')));
      if (found) return found[1];
    }
    return null;
  };

  const sectionForEsStats = () => {
    const title = Array.from(document.querySelectorAll('*')).find(el => /ES\s*STATS/i.test(el.textContent || '') && el.children.length < 3);
    return title?.closest('section,article,.card,.panel,.widget,.stats,.ladder') || title?.parentElement || null;
  };

  const format = (value) => Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 }) : '-';
  let updateInFlight = false;
  let updateTimer = null;
  let lastFetchAt = 0;

  const ensurePill = (root) => {
    if (!root || root.querySelector('.spx-implied-pill')) return root?.querySelector('.spx-implied-pill');
    const pill = document.createElement('div');
    pill.className = 'spx-implied-pill';
    pill.style.cssText = 'display:inline-flex;gap:8px;align-items:center;margin-left:8px;padding:3px 8px;border:1px solid #1f70a8;border-radius:3px;background:#071522;color:#00e5ff;font:800 10px/1.3 monospace;letter-spacing:1px;text-transform:uppercase;';
    pill.textContent = 'SPX --';
    const title = Array.from(root.querySelectorAll('*')).find(el => /ES\s*STATS/i.test(el.textContent || '') && el.children.length < 3) || root.firstElementChild;
    title?.appendChild(pill);
    return pill;
  };

  let todayCloses = { es: 7539.25, spx: 7518.80 }; // Today's actual closes — auto-captured at 4pm ET

  const update = async () => {
    const now = Date.now();
    if (updateInFlight || now - lastFetchAt < 4500) return;
    updateInFlight = true;
    lastFetchAt = now;
    const root = sectionForEsStats();
    const pill = ensurePill(root); // may be null — topbar updates regardless
    try {
      const quotes = await quoteMap([...ES_SYMBOLS, ...SPX_SYMBOLS]);
      const es = pickQuote(quotes, ES_SYMBOLS);
      const spx = pickQuote(quotes, SPX_SYMBOLS);
      const esNow = firstNumber(es, PRICE_KEYS);
      const esPrev = firstNumber(es, PREV_KEYS);
      const spxPrev = firstNumber(spx, PREV_KEYS);
      const spxNow = firstNumber(spx, PRICE_KEYS);
      
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const etMins = nowET.getHours() * 60 + nowET.getMinutes();
      const marketOpen = etMins >= 9 * 60 + 30 && etMins < 16 * 60;
      
      // Capture closes at 4pm ET for after-hours use
      if (etMins >= 16 * 60 - 2 && etMins < 16 * 60 + 2 && Number.isFinite(esNow) && Number.isFinite(spxNow)) {
        todayCloses = { es: esNow, spx: spxNow };
        localStorage.setItem('todayCloses', JSON.stringify({...todayCloses, date: nowET.toISOString().split('T')[0]}));
      }
      
      // After hours: use stored closes from today; fallback to prev-close if not available
      const esClose = marketOpen ? esPrev : (todayCloses.es || esPrev);
      const spxClose = marketOpen ? spxPrev : (todayCloses.spx || spxPrev);
      const esImplied = Number.isFinite(esNow) && Number.isFinite(esClose) && Number.isFinite(spxClose)
        ? esNow - (esClose - spxClose) : NaN;
      const displaySpx = marketOpen && Number.isFinite(spxNow) ? spxNow : esImplied;
      const diff = Number.isFinite(displaySpx) && Number.isFinite(spxPrev) ? displaySpx - spxPrev : NaN;
      const diffPct = Number.isFinite(diff) && Number.isFinite(spxPrev) && spxPrev !== 0 ? diff / spxPrev * 100 : NaN;
      const color = Number.isFinite(diff) && diff < 0 ? '#ff3355' : '#00ff8a';

      // Update ES stats pill (if present)
      if (pill) {
        pill.textContent = `SPX ${format(displaySpx)} ${Number.isFinite(diff) ? (diff >= 0 ? '+' : '') + format(diff) : ''}`;
        pill.style.color = color;
      }

      // Update topbar #spx-price / #spx-change
      const topbarPrice = document.getElementById('spx-price');
      const topbarChange = document.getElementById('spx-change');
      if (topbarPrice && Number.isFinite(displaySpx)) {
        topbarPrice.textContent = format(displaySpx);
      }
      if (topbarChange && Number.isFinite(diff)) {
        const sign = diff >= 0 ? '+' : '';
        const pctStr = Number.isFinite(diffPct) ? ` (${sign}${diffPct.toFixed(2)}%)` : '';
        topbarChange.textContent = `${sign}${format(diff)}${pctStr}`;
        topbarChange.style.color = color;
      }

      // Sync to AppState for snapshots
      if (window.AppState && Number.isFinite(displaySpx)) window.AppState.spxPrice = displaySpx;
    } finally {
      updateInFlight = false;
    }
  };

  const scheduleUpdate = (delay = 750) => {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(update, delay);
  };

  const boot = () => {
    // Load today's closes from localStorage if from today
    try {
      const stored = JSON.parse(localStorage.getItem('todayCloses'));
      const todayET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().split('T')[0];
      if (stored?.es && stored?.spx && stored?.date === todayET) {
        todayCloses = { es: stored.es, spx: stored.spx };
      }
    } catch (_) {}
    
    const style = document.createElement('style');
    style.textContent = '.spx-implied-pill{white-space:nowrap}.spx-implied-pill::before{content:"CURRENT";color:#8bb9e8}';
    document.head.appendChild(style);
    update();
    setInterval(update, 15000);
    new MutationObserver(() => {
      const root = sectionForEsStats();
      ensurePill(root);
      scheduleUpdate();
    }).observe(document.body, { childList:true, subtree:true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
