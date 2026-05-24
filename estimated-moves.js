// Global scope - no IIFE wrapping
const EM = {};

EM.SYMBOLS = ['ESM','NQM','SPY','QQQ','SPX','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NDX','NFLX','SMH','PLTR'];
EM.API_SYMBOL = { ESM:'/ESM6', NQM:'/NQM6', SPX:'$SPX', NDX:'$NDX' };
EM.CHAIN_SYMBOL = { SPX:'$SPX', NDX:'$NDX' };
EM.FUTURE_PROXY = { ESM:'SPX', NQM:'NDX' };
EM.PERIODS = {
  daily: { title:'Daily', minDays:0, maxDays:2, fallbackScale:1 },
  weekly: { title:'Weekly', minDays:0, maxDays:10, fallbackScale:1 },
  monthly: { title:'Monthly', minDays:21, maxDays:45, fallbackScale:Math.sqrt(4) }
};

EM.activePeriod = 'daily';
EM.refreshBusy = false;
EM.weeklyExpOverride = '';
EM.monthlyExpOverride = '';
EM.knownExpirations = [];

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
  return (Array.isArray(chain?.options) ? chain.options : []).map(o=>({
    expiration:o.expiration || o.expirationDate,
    strike:Number(o.strike || o.strikePrice),
    type:String(o.optionType || o.type || '').toUpperCase(),
    bid:Number(o.bid || o.bidPrice || 0),
    ask:Number(o.ask || o.askPrice || 0),
    last:Number(o.last || o.mark || o.lastPrice || 0),
    iv:Number(o.iv || o.impliedVolatility || o.volatility || o.callIVMid || o.putIVMid || 0),
    dte:Number(o.dte || o.daysToExpiration || 0)
  })).filter(o=>o.expiration && Number.isFinite(o.strike));
};

EM.mid = function(o){ 
  return Number.isFinite(o.bid) && Number.isFinite(o.ask) && o.bid>0 && o.ask>0 ? (o.bid+o.ask)/2 : (Number.isFinite(o.last) ? o.last : 0); 
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
  const ww=document.getElementById('em-weekly-exp-wrap');
  const mw=document.getElementById('em-monthly-exp-wrap');
  if(ww) ww.style.display=(EM.activePeriod==='weekly' && EM.knownExpirations.length) ? 'flex' : 'none';
  if(mw) mw.style.display=(EM.activePeriod==='monthly' && EM.knownExpirations.length) ? 'flex' : 'none';
};

EM.updatePeriodChrome = function(label){
  const cfg=EM.PERIODS[EM.activePeriod];
  document.querySelectorAll('.em-period-tab').forEach(btn=>{
    const active=btn.dataset.period===EM.activePeriod;
    btn.style.color=active ? '#00e5ff' : '#5a7a99';
    btn.style.borderColor=active ? '#00e5ff' : '#1e3a5f';
  });
  const title=document.getElementById('em-period-title'); 
  if(title) title.textContent=cfg.title;
  ['em-target-date'].forEach(id=>{ 
    const el=document.getElementById(id); 
    if(el) el.textContent=label || EM.nextFridayLabel(); 
  });
};

EM.fetchQuoteDetail = async function(ticker){
  const quoteSymbol=EM.API_SYMBOL[ticker] || ticker;
  const quote=await window.API.fetchQuote(quoteSymbol);
  return { quote, close:Number(quote.price || quote.last || quote.close) };
};

EM.chooseExpiration = function(expirations, period){
  if(!expirations.length) return '';
  const cfg=EM.PERIODS[period];
  if(!cfg) return expirations[0];
  return expirations.find(e=>{
    const dt=EM.daysTo(e);
    return dt >= cfg.minDays && dt <= cfg.maxDays;
  }) || expirations[0];
};

EM.getTargetExpiration = function(){
  if(EM.activePeriod==='weekly' && EM.weeklyExpOverride) return EM.weeklyExpOverride;
  if(EM.activePeriod==='monthly' && EM.monthlyExpOverride) return EM.monthlyExpOverride;
  return EM.chooseExpiration(EM.knownExpirations, EM.activePeriod);
};

EM.estimateMove = async function(ticker){
  // Get current quote first
  const quoteDetail=await EM.fetchQuoteDetail(ticker);
  let close=quoteDetail.close;
  if(!Number.isFinite(close) || close<=0) throw new Error('No quote for '+ticker);
  
  // Get target expiration from dropdown or auto-select
  const targetExp=EM.getTargetExpiration();
  if(!targetExp) throw new Error('No expiration selected');
  
  // Fetch options chain for this expiration
  const chainSym = (EM.CHAIN_SYMBOL[ticker] || ticker).replace(/^\$/,'');
  const chainUrl = `http://localhost:3001/proxy/api/tt/chains/${encodeURIComponent(chainSym)}?expiration=${encodeURIComponent(targetExp)}`;
  const chain = await fetch(chainUrl).then(r=>r.ok?r.json():{options:[]}).catch(()=>({options:[]}));
  const options=EM.normalizeOptions(chain);
  
  if(!options.length) throw new Error('No options data');
  
  // Find ATM strike
  const atmStrike=[...new Set(options.map(o=>o.strike))].sort((a,b)=>Math.abs(a-close)-Math.abs(b-close))[0];
  if(!Number.isFinite(atmStrike)) throw new Error('No ATM strike');
  
  // Get call and put at ATM
  const call=options.find(o=>o.strike===atmStrike && (o.type==='CALL' || o.type==='C'));
  const put=options.find(o=>o.strike===atmStrike && (o.type==='PUT' || o.type==='P'));
  
  if(!call || !put) throw new Error('Missing call or put');
  
  // Calculate EM using TastyTrade formula: 0.84 × avgIV × price × √(DTE/365)
  const avgIV = ((call.iv || 0) + (put.iv || 0)) / 2;
  const dte = call.dte || put.dte || EM.daysTo(targetExp);
  
  let em = 0;
  if(avgIV > 0 && dte > 0){
    em = 0.84 * avgIV * close * Math.sqrt(dte / 365);
  } else if(call.last > 0 || put.last > 0) {
    // Fallback: use straddle mid
    em = EM.mid(call) + EM.mid(put);
  }
  
  if(!Number.isFinite(em) || em <= 0) throw new Error('Could not calculate EM');
  
  return { 
    ticker, 
    close, 
    em, 
    up:close+em, 
    down:close-em, 
    expiration:targetExp, 
    strike:atmStrike 
  };
};

EM.prefetchExpirations = async function(){
  try{
    const r=await fetch('http://localhost:3001/proxy/api/tt/expirations/SPX');
    const json=await r.json();
    const exps=(json.expirations||[]).filter(e=>new Date(e+'T16:00:00')>=new Date());
    if(exps.length){ 
      EM.knownExpirations=exps;
      EM.populateExpDropdown('em-weekly-exp-select', EM.knownExpirations);
      EM.populateExpDropdown('em-monthly-exp-select', EM.knownExpirations);
      EM.updateExpPickerVisibility();
    }
  }catch(e){ console.warn('Could not prefetch expirations'); }
};

window.setEstimatedMovePeriod = function(period){
  if(!EM.PERIODS[period] || EM.activePeriod===period) return;
  EM.activePeriod=period;
  EM.updatePeriodChrome();
  EM.updateExpPickerVisibility();
};

window.onWeeklyExpChange = function(val){ 
  EM.weeklyExpOverride=val; 
};
window.onMonthlyExpChange = function(val){ 
  EM.monthlyExpOverride=val; 
};

window.refreshEstimatedMoves = async function(){
  if(EM.refreshBusy) return;
  EM.refreshBusy=true; 
  EM.setStatus('Syncing','#00e5ff');
  const btn=document.getElementById('em-start-btn'); 
  if(btn) btn.textContent='Refresh';
  const body=document.getElementById('em-table-body');
  if(body) body.innerHTML='<tr><td colspan="6" style="padding:24px;text-align:center;color:#3a5570">Loading...</td></tr>';
  try{
    if(!window.API?.isReady?.()) await new Promise(resolve=>window.addEventListener('api-ready', resolve, { once:true }));
    
    // Fetch expirations on first click
    if(!EM.knownExpirations.length){
      const chainSymbol=EM.CHAIN_SYMBOL['SPX'] || 'SPX';
      const ch=await fetch(`http://localhost:3001/proxy/api/tt/chains/${encodeURIComponent(chainSymbol)}`).then(r=>r.ok?r.json():{options:[]}).catch(()=>({options:[]}));
      const opts=EM.normalizeOptions(ch);
      const chainExps=[...new Set(opts.map(o=>o.expiration))].filter(e=>new Date(e+'T16:00:00')>=new Date()).sort();
      if(chainExps.length){ 
        EM.knownExpirations=chainExps;
        EM.populateExpDropdown('em-weekly-exp-select', EM.knownExpirations);
        EM.populateExpDropdown('em-monthly-exp-select', EM.knownExpirations);
        EM.updateExpPickerVisibility();
      }
    }
    
    const settled=[];
    for(let i=0;i<EM.SYMBOLS.length;i+=4){
      const batch=EM.SYMBOLS.slice(i,i+4);
      const results=await Promise.allSettled(batch.map(EM.estimateMove));
      settled.push(...results);
      if(i+4<EM.SYMBOLS.length) await new Promise(r=>setTimeout(r,400));
    }
    const rows=settled.map((r,i)=>r.status==='fulfilled' ? r.value : { ticker:EM.SYMBOLS[i], error:r.reason?.message || 'Unavailable' });
    if(body) body.innerHTML=rows.map(EM.rowHtml).join('');
    const exp=rows.find(r=>r.expiration)?.expiration;
    const label=EM.labelForDate(exp);
    EM.updatePeriodChrome(label);
    const sync=document.getElementById('em-last-sync'); 
    if(sync) sync.textContent=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    EM.setStatus('Live','#00e676');
  }catch(e){
    EM.setStatus('Error','#ff4757');
    if(body) body.innerHTML=`<tr><td colspan="6" style="padding:24px;text-align:center;color:#ff4757">${e.message}</td></tr>`;
  }finally{ EM.refreshBusy=false; }
};

window.init_database = async function(){
  const list=document.getElementById('em-symbol-list');
  if(list) list.innerHTML=EM.SYMBOLS.map(s=>`<span style="font-size:13px;color:#7ab8ff;background:#07111d;border:1px solid #13253a;padding:4px 7px;border-radius:2px">${s}</span>`).join('');
  const label=EM.nextFridayLabel();
  EM.updatePeriodChrome(label);
  EM.setStatus('Ready','#5a7a99');
  const body=document.getElementById('em-table-body');
  if(body) body.innerHTML='<tr><td colspan="6" style="padding:30px;text-align:center;color:#3a5570">Click Start to load estimated moves</td></tr>';
  await EM.prefetchExpirations();
};
