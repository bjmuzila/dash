;(function(){
  const ES_SYMBOLS = ['/ES', '/ESM6', 'ESM'];
  const SPX_SYMBOLS = ['$SPX', 'SPX'];
  const PRICE_KEYS = ['last','lastPrice','mark','mid','close','price','bid'];
  const PREV_KEYS = ['previousClose','prevClose','previous_close','prev_close','priorClose','prior_close','close'];

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
      `/proxy/api/tt/quotes-batch?index[]=SPX&future[]=${encodeURIComponent('/ESM6')}`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache:'no-store' });
        if (!r.ok) continue;
        const json = await r.json();
        const raw = json?.data?.items || json?.quotes || json?.items || json?.data || json;
        const out = {};
        if (Array.isArray(raw)) raw.forEach(q => {
          const sym = String(q.symbol || q.eventSymbol || q.instrument || '').toUpperCase();
          out[sym] = q;
          if (sym === 'SPX') out['$SPX'] = q;
          if (sym.startsWith('/ES')) out['/ES'] = q;
        });
        else if (raw && typeof raw === 'object') Object.entries(raw).forEach(([k,v]) => out[String(k).toUpperCase()] = v);
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

  const update = async () => {
    const now = Date.now();
    if (updateInFlight || now - lastFetchAt < 4500) return;
    updateInFlight = true;
    lastFetchAt = now;
    const root = sectionForEsStats();
    const pill = ensurePill(root);
    if (!pill) { updateInFlight = false; return; }
    try {
      const quotes = await quoteMap([...ES_SYMBOLS, ...SPX_SYMBOLS]);
      const es = pickQuote(quotes, ES_SYMBOLS);
      const spx = pickQuote(quotes, SPX_SYMBOLS);
      const esNow = firstNumber(es, PRICE_KEYS);
      const esPrev = firstNumber(es, PREV_KEYS);
      const spxPrev = firstNumber(spx, PREV_KEYS);
      const spxNow = firstNumber(spx, PRICE_KEYS);
      const implied = Number.isFinite(esNow) && Number.isFinite(esPrev) && Number.isFinite(spxPrev) ? esNow - (esPrev - spxPrev) : spxNow;
      const diff = Number.isFinite(implied) && Number.isFinite(spxPrev) ? implied - spxPrev : NaN;
      pill.textContent = `SPX ${format(implied)} ${Number.isFinite(diff) ? (diff >= 0 ? '+' : '') + format(diff) : ''}`;
      pill.style.color = Number.isFinite(diff) && diff < 0 ? '#ff3355' : '#00ff8a';
    } finally {
      updateInFlight = false;
    }
  };

  const scheduleUpdate = (delay = 750) => {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(update, delay);
  };

  const boot = () => {
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
