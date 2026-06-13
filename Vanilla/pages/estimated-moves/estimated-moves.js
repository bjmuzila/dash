// Global scope - no IIFE wrapping
var EM = window.EM || (window.EM = {});

EM.SYMBOLS = ['ESM','NQM','SPY','QQQ','SPX','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NDX','NFLX','SMH','PLTR'];
EM.API_SYMBOL = { ESM:'/ES:XCME', NQM:'/NQ:XCME', SPX:'$SPX', NDX:'$NDX' };
EM.CHAIN_SYMBOL = { SPX:'$SPX', NDX:'$NDX' };
EM.FUTURE_PROXY = { ESM:'SPX', NQM:'NDX' };
EM.IV_ONLY_SYMBOLS = new Set(['SPY', 'NDX']);
EM.PERIODS = {
  weekly: { title:'Weekly', minDays:3, maxDays:10, fallbackScale:1 }
};

EM.activePeriod = 'weekly';
EM.refreshBusy = false;
EM.expOverride = '';
EM.knownExpirations = [];
EM.initRan = false;
EM.bulkSubscribed = false;
EM.getProxyBase = function(){
  const queryProxy = new URLSearchParams(location.search).get('proxy');
  if (queryProxy) return queryProxy.replace(/\/$/, '');
  if (window.EM_PROXY_BASE) return String(window.EM_PROXY_BASE).replace(/\/$/, '');
  return `${location.protocol}//${location.hostname}:3001`;
};
EM.proxyUrl = function(path){
  const base = EM.getProxyBase();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

EM.initDB = function(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open('EM_Dashboard', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { EM.DB = req.result; resolve(); };
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('snapshots')){
        db.createObjectStore('snapshots', { keyPath:'id', autoIncrement:true });
      }
    };
  });
};

EM.saveSnapshot = function(tableHtml){
  if(!EM.DB) return Promise.reject('DB not ready');
  return new Promise((resolve, reject)=>{
    const now = new Date();
    const snapshot = {
      timestamp: now.getTime(),
      date: now.toLocaleDateString('en-US'),
      time: now.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', second:'2-digit'}),
      period: EM.activePeriod,
      tableHtml: tableHtml,
      expirations: EM.knownExpirations.slice(0, 3)
    };
    const tx = EM.DB.transaction(['snapshots'], 'readwrite');
    const store = tx.objectStore('snapshots');
    const req = store.add(snapshot);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(snapshot);
  });
};

EM.getSnapshots = function(){
  if(!EM.DB) return Promise.resolve([]);
  return new Promise((resolve, reject)=>{
    const tx = EM.DB.transaction(['snapshots'], 'readonly');
    const store = tx.objectStore('snapshots');
    const req = store.getAll();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result || []).reverse());
  });
};

EM.labelForDate = function(exp){
  return exp ? new Date(exp+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'}) : EM.nextFridayLabel();
};

EM.nextFridayLabel = function(){
  const d=new Date();
  const add=(5-d.getDay()+7)%7 || 7;
  d.setDate(d.getDate()+add);
  return d.toLocaleDateString('en-US',{month:'numeric',day:'numeric'});
};

EM.daysTo = function(exp){
  return Math.ceil((new Date(exp+'T16:00:00') - new Date()) / 86400000);
};

EM.fmtPrice = function(ticker, num){
  if (!ticker || typeof ticker !== 'string') return '—';
  const n=(ticker === 'ESM' || ticker === 'NQM') ? Math.round(Number(num)*4)/4 : Number(num);
  return Number.isFinite(n) ? n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
};

EM.fmtEm = function(num){
  const n=Number(num);
  return Number.isFinite(n) && n >= 0 ? n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3}) : '—';
};

EM.setStatus = function(text, color){
  const el=document.getElementById('em-status');
  if(el){ el.textContent=text; el.style.color=color||'var(--text3)'; }
};

EM.rowHtml = function(row){
  if (!row || !row.ticker) return '';
  const muted=row.error?'opacity:.55':'';
  return `<tr style="text-align:center;border-bottom:1px solid #121b2a;${muted}" title="${row.error ? row.error.replace(/"/g,'&quot;') : ''}">
    <td style="padding:8px;border-right:1px solid #1a2a3a;font-weight:700;color:#e8edf5">${row.ticker}</td>
    <td style="padding:8px;border-right:1px solid #1a2a3a;color:#cbd5e1">${EM.fmtPrice(row.ticker,row.close)}</td>
    <td style="padding:8px;border-right:1px solid #1a2a3a;color:#7ab8ff">${row.expiration ? EM.labelForDate(row.expiration) : ''}</td>
    <td style="padding:8px;border-right:1px solid #1a2a3a;color:#e8c060">${EM.fmtEm(row.em)}</td>
    <td style="padding:8px;border-right:1px solid #1a2a3a;color:#00e676">${EM.fmtPrice(row.ticker,row.up)}</td>
    <td style="padding:8px;color:#ff4757">${EM.fmtPrice(row.ticker,row.down)}</td>
  </tr>`;
};

EM.normalizeOptions = function(chain){
  const flat = [];
  const direct = Array.isArray(chain?.options) ? chain.options : [];
  direct.forEach(o => {
    flat.push({
      symbol: o.symbol || o.optionSymbol || '',
      expiration: o.expiration || o.expirationDate,
      strike: Number(o.strike || o.strikePrice),
      type: String(o.optionType || o.type || '').toUpperCase(),
      bid: Number(o.bid || o.bidPrice || o['bid-price'] || 0),
      ask: Number(o.ask || o.askPrice || o['ask-price'] || 0),
      last: Number(o.last || o['last-price'] || o.lastPrice || 0),
      mark: Number(o.mark || o['mark-price'] || o['mid-price'] || o.midPrice || 0),
      iv: Number(o.iv || o.impliedVolatility || o['implied-volatility'] || o.volatility || 0),
      dte: Number(o.dte || o.daysToExpiration || 0)
    });
  });

  const nestedItems = Array.isArray(chain?.data?.items) ? chain.data.items : [];
  nestedItems.forEach(expGroup => {
    const expiration = expGroup?.['expiration-date'] || expGroup?.expirationDate || expGroup?.expiration;
    const strikes = Array.isArray(expGroup?.strikes) ? expGroup.strikes : [];
    strikes.forEach(strikeRow => {
      const strike = Number(strikeRow?.['strike-price'] || strikeRow?.strikePrice || strikeRow?.strike);
      ['call', 'put'].forEach(side => {
        const leg = strikeRow?.[side];
        if (!leg) return;
        flat.push({
          symbol: leg.symbol || leg['symbol'] || '',
          expiration,
          strike,
          type: side.toUpperCase(),
          bid: Number(leg.bid || leg.bidPrice || leg['bid-price'] || 0),
          ask: Number(leg.ask || leg.askPrice || leg['ask-price'] || 0),
          last: Number(leg.last || leg['last-price'] || leg.lastPrice || 0),
          mark: Number(leg.mark || leg['mark-price'] || leg['mid-price'] || leg.midPrice || 0),
          iv: Number(leg.iv || leg['implied-volatility'] || leg.impliedVolatility || leg.volatility || 0),
          dte: Number(leg.dte || leg.daysToExpiration || EM.daysTo(expiration))
        });
      });
    });
  });

  return flat.filter(o => o.expiration && Number.isFinite(o.strike));
};

EM.mid = function(o){
  if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
  if (o.mark > 0) return o.mark;
  if (o.last > 0) return o.last;
  return 0;
};

EM.populateExpDropdown = function(id, expirations){
  const sel=document.getElementById(id);
  if(!sel) return;
  sel.innerHTML='<option value="">-- Auto --</option>';
  expirations.forEach(exp=>{
    const opt=document.createElement('option');
    opt.value=exp;
    opt.textContent=EM.labelForDate(exp)+' ('+EM.daysTo(exp)+'d)';
    sel.appendChild(opt);
  });
};

EM.updateExpPickerVisibility = function(){
  const wrap=document.getElementById('em-exp-wrap');
  if(wrap) wrap.style.display='flex';
};

EM.updatePeriodChrome = function(label){
  const targetExp = EM.getTargetExpiration();
  const displayLabel = label || (targetExp ? EM.labelForDate(targetExp) : EM.nextFridayLabel());
  const el = document.getElementById('em-target-date');
  if(el) el.textContent = displayLabel;
  const tableDate = document.getElementById('em-table-date');
  if(tableDate && !label) tableDate.textContent = displayLabel;
};

// Cache quotes-batch result to avoid re-fetching for every symbol
EM._quoteCache = {};
EM._quoteCacheTime = 0;
EM.FRIDAY_4PM_SYMBOLS = new Set(['ESM', 'NQM', 'SPX', 'NDX']);

EM.fetchAllQuotes = async function(){
  if(Date.now() - EM._quoteCacheTime < 5000) return EM._quoteCache;
  const r = await fetch(EM.proxyUrl('/proxy/api/tt/quotes-batch'));
  if(!r.ok) throw new Error('quotes-batch failed');
  const json = await r.json();
  const items = json?.data?.items || [];
  const map = {};
  items.forEach(q => { map[q.symbol] = q; });
  const aliases = {
    ESM: ['/ESM6', '/ES:XCME', '/ES'],
    NQM: ['/NQM6', '/NQ:XCME', '/NQ'],
    SPX: ['$SPX'],
    NDX: ['$NDX'],
    SPY: ['SPY'],
    QQQ: ['QQQ']
  };
  Object.entries(aliases).forEach(([key, list]) => {
    for (const alias of list) {
      if (map[alias]) {
        map[key] = map[alias];
        break;
      }
    }
  });
  EM._quoteCache = map;
  EM._quoteCacheTime = Date.now();
  return map;
};

EM.fetchQuoteDetail = async function(ticker){
  const dxSym = EM.API_SYMBOL[ticker] || ticker;
  const quotes = await EM.fetchAllQuotes();
  const q = quotes[dxSym] || quotes[ticker] || quotes[String(dxSym).replace(/^\//,'')] || quotes[String(ticker).replace(/^\//,'')];
  if(!q) throw new Error(`${ticker} not in quotes-batch`);
  const prevClose = Number(q['prev-close'] || q.prevClose || 0);
  const dayClose  = Number(q['day-close'] || 0);
  const isFutures = (ticker === 'ESM' || ticker === 'NQM');
  const isIndex   = (ticker === 'SPX' || ticker === 'NDX');
  const close = isFutures && dayClose > 0
    ? dayClose
    : isIndex && prevClose > 0
      ? prevClose
      : Number(q.last || q.mark || ((q.bid + q.ask) / 2));
  if(!Number.isFinite(close) || close <= 0) throw new Error(`Invalid price for ${ticker}: ${close}`);
  return { quote: q, close, prevClose };
};

EM.fetchOptionMarks = async function(symbols){
  const list = Array.isArray(symbols) ? symbols : [symbols];
  const cleaned = list.map(s => String(s || '').trim()).filter(Boolean);
  if (!cleaned.length) return {};
  const url = EM.proxyUrl('/proxy/api/tt/option-marks?symbols=' + encodeURIComponent(cleaned.join(',')));
  const r = await fetch(url);
  if(!r.ok) return {};
  const json = await r.json();
  const items = json?.data?.items || [];
  const map = {};
  items.forEach(item => { if (item?.symbol) map[item.symbol] = item; });
  return map;
};

// One-time direct REST fetch when subscription chain returns IV=0.
// Cached per chainSym+expiration so it only fires once per refresh cycle.
EM._directChainCache = {};
EM.fetchChainDirect = async function(chainSym, targetExp){
  const key = chainSym + ':' + targetExp;
  if(EM._directChainCache[key]) return EM._directChainCache[key];
  // Must include noSubscribe=1 to bypass the SPY early-return block in the proxy.
  // The older option-chain path 404s in some setups so it's kept as last resort.
  const urls = [
    EM.proxyUrl(`/proxy/api/tt/chains/${encodeURIComponent(chainSym)}?expiration=${encodeURIComponent(targetExp)}&noSubscribe=1`),
    EM.proxyUrl(`/proxy/api/tt/option-chain/${encodeURIComponent(chainSym)}?expiration=${encodeURIComponent(targetExp)}`),
  ];
  for(const url of urls){
    try{
      const r = await fetch(url);
      if(!r.ok){ console.warn(`[EM] direct chain ${url} → ${r.status}`); continue; }
      const json = await r.json();
      const opts = EM.normalizeOptions(json).filter(o => o.expiration === targetExp);
      if(opts.length && opts.some(o => Number(o.iv) > 0)){
        const sample = opts.find(o => Number(o.iv) > 0);
        console.log(`[EM] direct chain ok: ${chainSym} ${opts.length} opts, sample iv=${(Number(sample.iv)*100).toFixed(2)}%`);
      } else {
        const sampleOpt = opts[0];
        const hasLast = opts.some(o => o.last > 0);
        const hasMark = opts.some(o => o.mark > 0);
        const hasBid = opts.some(o => o.bid > 0);
        console.warn(`[EM] direct chain ${url} returned ${opts.length} opts but all iv=0 (hasLast=${hasLast}, hasMark=${hasMark}, hasBid=${hasBid})`);
        if (sampleOpt) console.log(`[EM] sample opt:`, JSON.stringify(sampleOpt));
      }
      if(opts.length){
        EM._directChainCache[key] = opts;
        return opts;
      }
    }catch(e){ console.warn(`[EM] direct chain ${url}: ${e.message}`); }
  }
  console.warn(`[EM] direct chain exhausted for ${chainSym}`);
  return null;
};

// For weekly: if user hasn't manually overridden, find the nearest Friday in knownExpirations.
// This prevents auto-selecting a Mon/Wed SPX expiration that equities don't have.
EM.getTargetExpiration = function(){
  if(EM.expOverride) return EM.expOverride;
  // For weekly, always resolve to a Friday expiration when in auto mode
  if(EM.activePeriod === 'weekly' && EM.knownExpirations.length){
    const friday = EM.knownExpirations.find(exp => new Date(exp+'T12:00:00').getDay() === 5);
    if(friday) return friday;
    // Fallback: first exp in 3-10 DTE range
    const ranged = EM.knownExpirations.find(exp => { const d=EM.daysTo(exp); return d>=3&&d<=10; });
    if(ranged) return ranged;
    return EM.knownExpirations[0];
  }
  return EM.knownExpirations[0] || '';
};

EM.estimateMove = async function(ticker){
  const startTime = Date.now();
  try {
    const quoteDetail=await EM.fetchQuoteDetail(ticker);
    const close = quoteDetail.close;
    if(!Number.isFinite(close) || close<=0) throw new Error('No quote');

    const targetExp=EM.getTargetExpiration();
    if(!targetExp) throw new Error('No expiration selected');

    const isFuture = EM.FUTURE_PROXY[ticker];
    const lookupSym = isFuture ? EM.FUTURE_PROXY[ticker] : (EM.CHAIN_SYMBOL[ticker] || ticker);
    const chainSym = (lookupSym || 'SPX').replace(/^\$/,'');
    if (!chainSym || typeof chainSym !== 'string') throw new Error('Invalid chain symbol');

    const chainUrl = EM.proxyUrl(`/proxy/api/tt/chains/${encodeURIComponent(chainSym)}?expiration=${encodeURIComponent(targetExp)}&noSubscribe=1&forceSub=1`);
    const chain = await Promise.race([
      fetch(chainUrl).then(r=>r.ok?r.json():{options:[]}).catch(()=>({options:[]})),
      new Promise(resolve=>setTimeout(()=>resolve({options:[]}), 10000))
    ]);

    const options=EM.normalizeOptions(chain);
    let expOptions=options.filter(o=>o.expiration===targetExp);
    if(!expOptions.length) throw new Error('No options for expiration');

    // If subscription data returned options but all IV=0, do a direct REST fetch (cached)
    if(expOptions.every(o => Number(o.iv || 0) === 0)){
      console.log(`[${ticker}] All IV=0 in subscription data — trying direct chain fetch`);
      const direct = await EM.fetchChainDirect(chainSym, targetExp);
      if(direct) expOptions = direct;
    }

    // For futures, use the index's stable prev-close (Friday 4pm) for ATM selection and EM calc.
    const indexQuote = isFuture ? await EM.fetchQuoteDetail(lookupSym) : null;
    const indexClose = isFuture
      ? (indexQuote.prevClose > 0 ? indexQuote.prevClose : indexQuote.close)
      : close;
    const strikes=[...new Set(expOptions.map(o=>o.strike))].sort((a,b)=>Math.abs(a-indexClose)-Math.abs(b-indexClose));
    if(!strikes.length) throw new Error('No strikes found');

    let strike = null, call = null, put = null, dte = 0, em = 0;

    for (const candidateStrike of strikes) {
      const c = expOptions.find(o=>o.strike===candidateStrike && o.type==='CALL');
      const p = expOptions.find(o=>o.strike===candidateStrike && o.type==='PUT');
      if(!c || !p) continue;

      const candidateDte = c.dte || p.dte || EM.daysTo(targetExp);
      let c2 = c;
      let p2 = p;

      // Primary: IV formula — EM = 0.84 × avgIV × close × √(DTE/365)
      let avgIV = (Number(c2.iv || 0) + Number(p2.iv || 0)) / 2;
      let candidateEm = 0;
      if(avgIV > 0 && candidateDte > 0){
        candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
        console.log(`  [${ticker}@${candidateStrike}] IV: avgIV=${(avgIV*100).toFixed(2)}%, dte=${candidateDte}, em=${candidateEm.toFixed(2)}`);
      } else {
        if (Number(c2.bid || 0) <= 0 && Number(c2.ask || 0) <= 0 || Number(p2.bid || 0) <= 0 && Number(p2.ask || 0) <= 0) {
          const marks = await EM.fetchOptionMarks([c2.symbol, p2.symbol]);
          if (marks[c2.symbol]) {
            c2 = Object.assign({}, c2, marks[c2.symbol]);
          }
          if (marks[p2.symbol]) {
            p2 = Object.assign({}, p2, marks[p2.symbol]);
          }
          avgIV = (Number(c2.iv || 0) + Number(p2.iv || 0)) / 2;
        }
        // Fallback: straddle mid × 0.85
        const cMid = EM.mid(c2);
        const pMid = EM.mid(p2);
        if(cMid > 0 && pMid > 0){
          candidateEm = (cMid + pMid) * 0.85;
          console.log(`  [${ticker}@${candidateStrike}] Straddle fallback: call=${cMid}, put=${pMid}, em=${candidateEm.toFixed(2)}`);
        } else if (avgIV > 0 && candidateDte > 0) {
          candidateEm = 0.84 * avgIV * indexClose * Math.sqrt(candidateDte / 365);
          console.log(`  [${ticker}@${candidateStrike}] IV fallback after marks: avgIV=${(avgIV*100).toFixed(2)}%, em=${candidateEm.toFixed(2)}`);
        }
      }

      if(Number.isFinite(candidateEm) && candidateEm > 0){
        // Sanity check: EM should be 0.2%–25% of the underlying price for weekly options
        const emPct = candidateEm / indexClose;
        if (emPct < 0.002 || emPct > 0.25) {
          console.warn(`  [${ticker}@${candidateStrike}] EM sanity fail: ${(emPct*100).toFixed(2)}% of close — skipping`);
          continue;
        }
        strike = candidateStrike;
        call = c2; put = p2; dte = candidateDte; em = candidateEm;
        break;
      }
    }

    if(!strike) throw new Error('No usable strike (IV=0 and no straddle bid/ask)');
    if(!Number.isFinite(em) || em <= 0) throw new Error('EM calculation returned zero');

    const basis = isFuture ? (close - indexClose) : 0;
    const up = (indexClose + em) + basis;
    const down = (indexClose - em) + basis;

    const elapsed = Date.now() - startTime;
    console.log(`✓ ${ticker}: EM=${em.toFixed(2)}, close=${close.toFixed(2)}, basis=${basis.toFixed(2)}, up=${up.toFixed(2)}, down=${down.toFixed(2)} (${elapsed}ms)`);

    return { ticker, close, em, up, down, expiration:targetExp, strike };
  } catch(e) {
    const elapsed = Date.now() - startTime;
    console.error(`✗ ${ticker} (${elapsed}ms): ${e.message}`);
    throw e;
  }
};

EM.prefetchExpirations = async function(){
  try{
    let exps = [];

    const parseExps = (json) => {
      let rawExps = json?.expirations
        || json?.data?.expirations
        || json?.data?.items
        || json?.items
        || [];
      if(rawExps.length && typeof rawExps[0] === 'object'){
        rawExps = rawExps.map(e => e['expiration-date'] || e.expirationDate || e.expiration || e.date || e);
      }
      return rawExps
        .filter(e => typeof e === 'string')
        .filter(e => new Date(e+'T16:00:00') >= new Date())
        .sort();
    };

    const r=await fetch(EM.proxyUrl('/proxy/api/tt/expirations/SPX'));
    if(r.ok){
      const json=await r.json();
      console.log('[EM] Expirations raw response:', json);
      exps = parseExps(json);
    }

    if(!exps.length){
      const chainResp = await fetch(EM.proxyUrl('/proxy/api/tt/chains/SPX?daysToExpiration=90'));
      if(chainResp.ok){
        const chainJson = await chainResp.json();
        const options = EM.normalizeOptions(chainJson);
        exps = [...new Set(options.map(o => o.expiration))]
          .filter(e => typeof e === 'string' && e)
          .filter(e => new Date(e+'T16:00:00') >= new Date())
          .sort();
      }
    }

    console.log('[EM] Parsed expirations:', exps);

    if(exps.length){
      EM.knownExpirations=exps;
      // Only show Friday expirations in the dropdown for weekly
      const fridays = exps.filter(e => new Date(e+'T12:00:00').getDay() === 5);
      EM.populateExpDropdown('em-exp-select', fridays.length ? fridays : exps);
      EM.updateExpPickerVisibility();
    } else {
      console.warn('[EM] No valid expirations found in response');
    }
  }catch(e){ console.warn('Could not prefetch expirations:', e.message); }
};

window.onExpirationChange = function(val){ EM.expOverride = val; };

window.refreshEstimatedMoves = async function(){
  if(EM.refreshBusy) return;
  EM.refreshBusy=true;
  EM.setStatus('Syncing','#00e5ff');
  const btn=document.getElementById('em-start-btn');
  if(btn) btn.textContent='Refresh';
  const body=document.getElementById('em-table-body');
  if(body) body.innerHTML='<tr><td colspan="6" style="padding:24px;text-align:center;color:#3a5570">Loading...</td></tr>';
  try{
    // Always clear the direct chain cache so stale IV=0 results don't persist across refreshes
    EM._directChainCache = {};
    // Also clear quote cache to ensure fresh price data on refresh
    EM._quoteCache = {};
    EM._quoteCacheTime = 0;

    if (!EM.bulkSubscribed) {
      try{
        EM.setStatus('Subscribing…','#00e5ff');
        const bulkSyms = ['SPX','VIX','ESM','NQM','SPY','QQQ','SMH','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NFLX','PLTR','NDX'];

        // Use subscription manager to wait for data
        const pageId = 'estimated-moves-' + Date.now();
        const readyResp = await fetch(EM.proxyUrl('/proxy/api/subscription-ready'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pageId,
            symbols: bulkSyms,
            timeout: 4000,
            threshold: 0.7
          })
        });
        const readyData = await readyResp.json();
        console.log('[EM] Subscription ready:', readyData);

        EM.bulkSubscribed = true;
      }catch(e){ console.warn('Subscribe failed:', e.message); }
    }

    console.log('Starting estimated moves refresh with', EM.SYMBOLS.length, 'symbols');
    const settled=[];
    for(let i=0;i<EM.SYMBOLS.length;i+=4){
      const batch=EM.SYMBOLS.slice(i,i+4);
      console.log(`Processing batch ${Math.floor(i/4)+1}/${Math.ceil(EM.SYMBOLS.length/4)}: ${batch.join(', ')}`);
      const results=await Promise.allSettled(batch.map(EM.estimateMove));
      settled.push(...results);

      results.forEach((r,idx)=>{
        if(r.status==='rejected'){
          console.warn(`✗ ${batch[idx]}: ${r.reason?.message || String(r.reason)}`);
        }else{
          console.log(`✓ ${batch[idx]}: ${r.value.em?.toFixed(2)}`);
        }
      });

      if(i+4<EM.SYMBOLS.length) await new Promise(r=>setTimeout(r,300));
    }

    console.log('All batches completed, rendering results');
    const rows=settled.map((r,i)=>r.status==='fulfilled' ? r.value : { ticker:EM.SYMBOLS[i], error:r.reason?.message || 'Unavailable' });
    if(body) body.innerHTML=rows.map(EM.rowHtml).join('');
    const exp=rows.find(r=>r.expiration)?.expiration;
    const label=EM.labelForDate(exp);
    EM.updatePeriodChrome(label);
    const sync=document.getElementById('em-last-sync');
    if(sync) sync.textContent=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    EM.setStatus('Live','#00e676');

    // Publish ES Stats Ladder data from ESM estimated moves result.
    // Only write once per expiration — re-running estimated moves won't overwrite.
    const esmRow = rows.find(r => r.ticker === 'ESM' && r.up && r.down);
    if (esmRow && esmRow.expiration !== window.esStatsCacheExp) {
      const fmtStat = v => Math.round(v).toLocaleString('en-US');
      const mid = (esmRow.up + esmRow.down) / 2;
      const stats = {
        'NO LONG':  fmtStat(esmRow.up),
        'UP':       fmtStat(esmRow.up),
        'MID':      fmtStat(mid),
        'DOWN':     fmtStat(esmRow.down),
        'NO SHORT': fmtStat(esmRow.down)
      };
      window.esStatsCache = stats;
      window.esStatsCacheExp = esmRow.expiration;
      window.esStatsReady = true;
      if (typeof window.applyOverviewESStats === 'function') window.applyOverviewESStats(stats);
      console.log('[ESStats] Ladder updated for expiration:', esmRow.expiration);
      // Persist to SQLite via API
      fetch(EM.proxyUrl('/api/es-stats'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiration: esmRow.expiration,
          no_long:   stats['NO LONG'],
          up:        stats['UP'],
          mid:       stats['MID'],
          down:      stats['DOWN'],
          no_short:  stats['NO SHORT']
        })
      }).catch(e => console.warn('[ESStats] Failed to persist:', e.message));
    } else if (esmRow) {
      console.log('[ESStats] Ladder unchanged — already set for expiration:', esmRow.expiration);
    }
  }catch(e){
    console.error('Refresh failed:', e);
    EM.setStatus('Error','#ff4757');
    if(body) body.innerHTML=`<tr><td colspan="6" style="padding:24px;text-align:center;color:#ff4757">Failed: ${e.message || 'Unknown error'}</td></tr>`;
  }finally{ EM.refreshBusy=false; }
};

window.init_database = async function(){
  if (EM.initRan) return;
  EM.initRan = true;
  const list=document.getElementById('em-symbol-list');
  if(list) list.innerHTML=EM.SYMBOLS.map(s=>`<span style="font-size:13px;color:#7ab8ff;background:#07111d;border:1px solid #13253a;padding:4px 7px;border-radius:2px">${s}</span>`).join('');
  const label=EM.nextFridayLabel();
  EM.updatePeriodChrome(label);
  EM.setStatus('Ready','#5a7a99');
  const body=document.getElementById('em-table-body');
  if(body) body.innerHTML='<tr><td colspan="6" style="padding:30px;text-align:center;color:#3a5570">Click Start to load estimated moves</td></tr>';
  await EM.prefetchExpirations();
  await EM.initDB();
};

window.captureEMSnapshot = async function(){
  try{
    const body = document.getElementById('em-table-body');
    if(!body || !body.innerHTML.trim()) {
      EM.setStatus('No data to save', '#ff4757');
      return;
    }
    EM.setStatus('Saving snapshot...', '#00e5ff');
    const tableHtml = body.innerHTML;
    const snapshot = await EM.saveSnapshot(tableHtml);
    EM.setStatus(`Snapshot saved ${snapshot.time}`, '#00e676');
    EM.renderDrawer();
  }catch(e){
    EM.setStatus('Snapshot failed', '#ff4757');
    console.error('Snapshot error:', e);
  }
};

// ────── Snapshot drawer (sidebar) ──────
EM.renderDrawer = async function(){
  const container = document.getElementById('em-drawer-weekly');
  const count = document.getElementById('em-drawer-count-weekly');
  if(!container) return;
  const all = await EM.getSnapshots().catch(()=>[]);
  const items = all.filter(s => s.period === 'weekly');
  if(count) count.textContent = String(items.length);
  if(!items.length){
    container.innerHTML = '<div style="padding:10px 14px;font-size:11px;color:#3a5570;letter-spacing:.08em">No snapshots</div>';
    return;
  }
  container.innerHTML = items.map(s => `
    <div data-snap-id="${s.id}" onclick="window.emLoadSnapshot(${s.id})" style="padding:8px 14px;cursor:pointer;border-bottom:1px solid #0d1825;background:#04070c">
      <div style="font-size:11px;color:#e8edf5;font-weight:700">${s.date}</div>
      <div style="font-size:10px;color:#7ab8ff;font-variant-numeric:tabular-nums">${s.time}</div>
    </div>
  `).join('');
};

window.emToggleDrawer = function(){
  const drawer = document.getElementById('em-drawer-weekly');
  const arrow = document.getElementById('em-drawer-arrow-weekly');
  if(!drawer) return;
  const wasOpen = drawer.style.display === 'flex';
  drawer.style.display = wasOpen ? 'none' : 'flex';
  if(arrow) arrow.style.transform = wasOpen ? 'rotate(0deg)' : 'rotate(90deg)';
  if(!wasOpen) EM.renderDrawer();
};

window.emLoadSnapshot = async function(id){
  try{
    const all = await EM.getSnapshots();
    const snap = all.find(s => s.id === id);
    if(!snap) return;
    const body = document.getElementById('em-table-body');
    if(body) body.innerHTML = snap.tableHtml;
    EM.setStatus(`Loaded ${snap.date} ${snap.time}`, '#00e676');
  }catch(e){
    console.error('Load snapshot error:', e);
  }
};

// ────── Export to CSV ──────
window.exportSnapshots = async function(){
  try{
    EM.setStatus('Exporting...', '#00e5ff');
    const snapshots = await EM.getSnapshots();
    if(!snapshots.length){ EM.setStatus('No snapshots to export', '#ff4757'); return; }
    const rows = [['Date','Time','Period','Ticker','Close','Exp','EM','Up','Down']];
    snapshots.forEach(snap => {
      const tmp = document.createElement('table');
      tmp.innerHTML = '<tbody>' + snap.tableHtml + '</tbody>';
      tmp.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim());
        if(cells.length === 6) rows.push([snap.date, snap.time, snap.period, ...cells]);
      });
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `estimated-moves-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    EM.setStatus('Exported', '#00e676');
  }catch(e){
    EM.setStatus('Export failed', '#ff4757');
    console.error('Export error:', e);
  }
};

// ────── Screenshot ──────
EM.captureCanvas = async function(){
  const target = document.querySelector('.em-capture-target');
  if(!target) throw new Error('No capture target');
  if(typeof window.html2canvas !== 'function') throw new Error('html2canvas not loaded');
  const clone = target.cloneNode(true);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;background:#0b111b';
  wrap.appendChild(clone);
  document.body.appendChild(wrap);
  try{
    return await window.html2canvas(clone, { backgroundColor:'#0b111b', scale:2, useCORS:true });
  } finally {
    document.body.removeChild(wrap);
  }
};

window.copyEMScreenshot = async function(){
  try{
    EM.setStatus('Capturing...', '#00e5ff');
    const canvas = await EM.captureCanvas();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png':blob })]);
    EM.setStatus('Screenshot copied', '#00e676');
  }catch(e){
    EM.setStatus('Capture failed: ' + e.message, '#ff4757');
    console.error('Screenshot error:', e);
  }
};

window.shareEM = async function(target){
  try{
    const date = (document.getElementById('em-target-date')?.textContent || '').trim();
    const text = `Weekly Estimated Moves${date ? ' — ' + date : ''}`;
    if(target === 'x'){
      try { await window.copyEMScreenshot(); } catch(_) {}
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
      EM.setStatus('X opened (paste image)', '#00e676');
    } else if(target === 'discord'){
      EM.setStatus('Posting to Discord...', '#00e5ff');
      const canvas = await EM.captureCanvas();
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content: text }));
      form.append('file1', blob, 'estimated-moves.png');
      const r = await fetch('/proxy/api/discord/em-webhook', { method:'POST', body:form });
      if(!r.ok) throw new Error('Webhook ' + r.status);
      EM.setStatus('Posted to Discord', '#00e676');
    }
  }catch(e){
    EM.setStatus('Share failed: ' + e.message, '#ff4757');
    console.error('Share error:', e);
  }
};
