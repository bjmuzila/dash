// Global scope - no IIFE wrapping
const EM = {};

EM.SYMBOLS = ['ESM','NQM','SPY','QQQ','SPX','AAPL','AMD','AMZN','GOOGL','META','MSFT','NVDA','TSLA','COIN','HOOD','IWM','NDX','NFLX','SMH','PLTR'];
EM.API_SYMBOL = { ESM:'/ESM6', NQM:'/NQM6', SPX:'$SPX', NDX:'$NDX' };
EM.CHAIN_SYMBOL = { ESM:'$SPX', NQM:'$NDX', SPX:'$SPX', NDX:'$NDX' };
EM.FUTURE_PROXY = { ESM:'SPX', NQM:'NDX' };
EM.PROXY_ESTIMATE = { ESM:'SPX', NQM:'NDX' };
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
EM.expirationMeta = {};

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

EM.isFridayExpiration = function(exp){
  return new Date(exp+'T12:00:00').getDay() === 5;
};

EM.monthKey = function(exp){
  return exp ? exp.slice(0, 7) : '';
};

EM.closestExpiration = function(expirations){
  return [...(expirations || [])].sort()[0] || '';
};

EM.monthlyExpirations = function(expirations){
  const byMonth = {};
  expirations.forEach(exp=>{
    const key=EM.monthKey(exp);
    if(key && (!byMonth[key] || exp > byMonth[key])) byMonth[key]=exp;
  });
  const closest=EM.closestExpiration(Object.values(byMonth));
  return closest ? [closest] : [];
};

EM.expirationsForPeriod = function(period, expirations){
  const list=[...(expirations || [])].sort();
  if(period === 'weekly') {
    const closest=EM.closestExpiration(list.filter(EM.isFridayExpiration));
    return closest ? [closest] : [];
  }
  if(period === 'monthly') return EM.monthlyExpirations(list);
  return list;
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
  let raw = Array.isArray(chain?.options) ? chain.options : [];
  const flattenObjectOptions = function(obj, inherited){
    if(!obj || typeof obj !== 'object') return [];
    if(Array.isArray(obj)) return obj.flatMap(item=>flattenObjectOptions(item, inherited));
    const exp=obj.expiration || obj.expirationDate || obj['expiration-date'] || inherited?.expiration;
    const strike=obj.strike || obj.strikePrice || obj['strike-price'] || inherited?.strike;
    const out=[];
    if(obj.call) out.push({ ...obj.call, expiration:obj.call.expiration || obj.call.expirationDate || obj.call['expiration-date'] || exp, strike:obj.call.strike || obj.call.strikePrice || obj.call['strike-price'] || strike, type:obj.call.type || obj.call.optionType || obj.call['option-type'] || 'CALL' });
    if(obj.put) out.push({ ...obj.put, expiration:obj.put.expiration || obj.put.expirationDate || obj.put['expiration-date'] || exp, strike:obj.put.strike || obj.put.strikePrice || obj.put['strike-price'] || strike, type:obj.put.type || obj.put.optionType || obj.put['option-type'] || 'PUT' });
    if(obj.calls) out.push(...flattenObjectOptions(obj.calls, { expiration:exp, strike, type:'CALL' }).map(o=>({ ...o, type:o.type || 'CALL' })));
    if(obj.puts) out.push(...flattenObjectOptions(obj.puts, { expiration:exp, strike, type:'PUT' }).map(o=>({ ...o, type:o.type || 'PUT' })));
    if(obj.option || obj.optionSymbol || obj.symbol || obj.streamerSymbol || obj['streamer-symbol']) out.push({ ...obj, expiration:exp, strike, type:obj.type || obj.optionType || obj['option-type'] || inherited?.type });
    return out;
  };
  if(!raw.length && Array.isArray(chain?.items)){
    raw = chain.items.flatMap(item=>{
      const exp=item.expiration || item.expirationDate || item['expiration-date'];
      const strikes=item.strikes || item.strikeMap || item.strike_map || {};
      if(!strikes || typeof strikes !== 'object') return Array.isArray(item.options) ? item.options : [];
      return Object.entries(strikes).flatMap(([strike, value])=>{
        const list=Array.isArray(value) ? value : Object.values(value || {});
        return list.flatMap(opt=>{
          if(!opt || typeof opt !== 'object') return [];
          if(opt.call || opt.put){
            return [opt.call, opt.put].filter(Boolean).map(o=>({
              ...o,
              expiration:o.expiration || o.expirationDate || o['expiration-date'] || exp,
              strike:o.strike || o.strikePrice || o['strike-price'] || strike
            }));
          }
          return [{
            ...opt,
            expiration:opt.expiration || opt.expirationDate || opt['expiration-date'] || exp,
            strike:opt.strike || opt.strikePrice || opt['strike-price'] || strike
          }];
        });
      });
    });
  }
  if(!raw.length && chain?.expiryMap && typeof chain.expiryMap === 'object'){
    raw = Object.entries(chain.expiryMap).flatMap(([exp, strikes])=>{
      if(!strikes || typeof strikes !== 'object') return [];
      return Object.entries(strikes).flatMap(([strike, items])=>flattenObjectOptions(items, { expiration:exp, strike }));
    });
  }
  if(!raw.length && chain && typeof chain === 'object'){
    raw = flattenObjectOptions(chain, {});
  }
  if(!raw.length && chain && typeof chain === 'object'){
    const found=[];
    const walk=(node, ctx={})=>{
      if(!node || typeof node !== 'object') return;
      if(Array.isArray(node)){ node.forEach(item=>walk(item, ctx)); return; }
      const exp=node.expiration || node.expirationDate || node['expiration-date'] || ctx.expiration;
      const strike=node.strike || node.strikePrice || node['strike-price'] || ctx.strike;
      const looksOption=node.symbol || node.optionSymbol || node.streamerSymbol || node['streamer-symbol'] || node.delta || node.gamma || node.mark || node.bid || node.ask;
      if(looksOption && exp && strike) found.push({ ...node, expiration:exp, strike });
      Object.entries(node).forEach(([key,value])=>{
        const next={ expiration:exp, strike };
        if(/^\d+(\.\d+)?$/.test(key)) next.strike=key;
        if(/^\d{4}-\d{2}-\d{2}$/.test(key)) next.expiration=key;
        if(key === 'call' || key === 'calls') next.type='CALL';
        if(key === 'put' || key === 'puts') next.type='PUT';
        walk(value, next);
      });
    };
    walk(chain, {});
    raw=found;
  }
  const inferType = function(o){
    const explicit=String(o.optionType || o.type || o['option-type'] || '').toUpperCase();
    if(explicit) return explicit;
    const symbol=String(o.symbol || o.optionSymbol || o.streamerSymbol || o['streamer-symbol'] || '').toUpperCase();
    const m=symbol.match(/\d{6}([CP])\d{8}$/) || symbol.match(/[CP]\d{8}$/);
    if(m) return m[1] || m[0].charAt(0);
    return '';
  };
  return raw.map(o=>({
    expiration:o.expiration || o.expirationDate || o['expiration-date'],
    strike:Number(o.strike || o.strikePrice || o['strike-price']),
    type:inferType(o),
    bid:Number(o.bid || o.bidPrice || o['bid-price'] || 0),
    ask:Number(o.ask || o.askPrice || o['ask-price'] || 0),
    last:Number(o.last || o.mark || o.lastPrice || o['last-price'] || o['mark-price'] || 0),
    iv:Number(o.iv || o.impliedVolatility || o.volatility || o.callIVMid || o.putIVMid || o['implied-volatility'] || 0),
    delta:Number(o.delta || o.rawDelta || o['delta'] || 0),
    dte:Number(o.dte || o.daysToExpiration || 0)
  })).filter(o=>o.expiration && Number.isFinite(o.strike));
};

EM.mid = function(o){ 
  return Number.isFinite(o.bid) && Number.isFinite(o.ask) && o.bid>0 && o.ask>0 ? (o.bid+o.ask)/2 : (Number.isFinite(o.last) ? o.last : 0); 
};

EM.optionSide = function(o){
  const t=String(o?.type || '').toUpperCase();
  if(t==='CALL' || t==='C') return 'C';
  if(t==='PUT' || t==='P') return 'P';
  const d=Number(o?.delta);
  if(Number.isFinite(d) && d !== 0) return d > 0 ? 'C' : 'P';
  return '';
};

EM.populateExpDropdown = function(id, expirations){
  const sel=document.getElementById(id); 
  if(!sel) return;
  const period=id.includes('weekly') ? 'weekly' : (id.includes('monthly') ? 'monthly' : EM.activePeriod);
  const filtered=EM.expirationsForPeriod(period, expirations);
  sel.innerHTML='<option value="">-- Auto --</option>';
  filtered.forEach(exp=>{
    const opt=document.createElement('option');
    opt.value=exp; 
    opt.textContent=EM.labelForDate(exp)+' ('+EM.daysTo(exp)+'d)';
    sel.appendChild(opt);
  });
};

EM.setKnownExpirations = function(items){
  const meta={};
  const dates=(items || []).map(item=>{
    const exp=typeof item === 'string' ? item : (item?.['expiration-date'] || item?.expirationDate || item?.expiration);
    if(exp && typeof item === 'object'){
      meta[exp]={
        type:item['expiration-type'] || item.expirationType || item.type || '',
        strikeCount:item['strike-count'] || item.strikeCount || 0
      };
    }
    return exp;
  }).filter(Boolean).filter(e=>new Date(e+'T16:00:00')>=new Date()).sort();
  EM.expirationMeta=meta;
  EM.knownExpirations=[...new Set(dates)];
  EM.populateExpDropdown('em-weekly-exp-select', EM.knownExpirations);
  EM.populateExpDropdown('em-monthly-exp-select', EM.knownExpirations);
  EM.updateExpPickerVisibility();
};

EM.updateExpPickerVisibility = function(){
  const weeklyWrap=document.getElementById('em-weekly-exp-wrap');
  const monthlyWrap=document.getElementById('em-monthly-exp-wrap');
  const weeklySelect=document.getElementById('em-weekly-exp-select');
  const monthlySelect=document.getElementById('em-monthly-exp-select');
  const showWeekly=(EM.activePeriod==='weekly' && EM.knownExpirations.length) ? 'inline-block' : 'none';
  const showMonthly=(EM.activePeriod==='monthly' && EM.knownExpirations.length) ? 'inline-block' : 'none';
  if(weeklyWrap) weeklyWrap.style.display=showWeekly === 'none' ? 'none' : 'flex';
  if(monthlyWrap) monthlyWrap.style.display=showMonthly === 'none' ? 'none' : 'flex';
  if(weeklySelect) weeklySelect.style.display=showWeekly;
  if(monthlySelect) monthlySelect.style.display=showMonthly;
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
  const expLabel=document.getElementById('em-exp-label');
  if(expLabel) expLabel.textContent=label || '';
  ['em-target-date'].forEach(id=>{ 
    const el=document.getElementById(id); 
    if(el) el.textContent=label || EM.nextFridayLabel(); 
  });
};

EM.fetchQuoteDetail = async function(ticker){
  const quoteSymbol=EM.API_SYMBOL[ticker] || ticker;
  const quote=await window.API.fetchQuote(quoteSymbol);
  const q=quote?.data || quote?.quote || quote || {};
  return { quote:q, close:Number(q.price || q.last || q.close || q.mark || q.mid || q['last-price'] || q['mark-price']) };
};

EM.fetchUnderlyingClose = async function(ticker){
  const quoteDetail=await EM.fetchQuoteDetail(ticker).catch(()=>({ close:0 }));
  return Number(quoteDetail.close || 0);
};

EM.chooseExpiration = function(expirations, period){
  expirations=EM.expirationsForPeriod(period, expirations);
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
  // Get target expiration from dropdown or auto-select
  const targetExp=EM.getTargetExpiration();
  if(!targetExp) throw new Error('No expiration selected');
  const estimateTicker=EM.PROXY_ESTIMATE[ticker] || ticker;
  
  // Fetch options chain for this expiration
  const chainSym = (EM.CHAIN_SYMBOL[estimateTicker] || estimateTicker).replace(/^\$/,'');
  const chainUrl = `http://localhost:3001/proxy/api/tt/chains/${encodeURIComponent(chainSym)}?expiration=${encodeURIComponent(targetExp)}&noSubscribe=1`;
  const chain = await fetch(chainUrl).then(r=>r.ok?r.json():{options:[]}).catch(()=>({options:[]}));
  const options=EM.normalizeOptions(chain);
  
  if(!options.length) throw new Error('No options data');

  let close=Number(chain.underlyingPrice || chain.currentPrice || chain.lastPrice || chain.price || chain.underlying?.price || chain.underlying?.last);
  if(!Number.isFinite(close) || close<=0){
    close=await EM.fetchUnderlyingClose(estimateTicker);
  }
  if(!Number.isFinite(close) || close<=0){
    const deltaSorted=options
      .filter(o=>Number.isFinite(o.strike) && EM.optionSide(o)==='C')
      .sort((a,b)=>Math.abs(Math.abs(Number(a.delta || a.rawDelta || 0))-0.5)-Math.abs(Math.abs(Number(b.delta || b.rawDelta || 0))-0.5));
    close=deltaSorted[0]?.strike || 0;
  }
  if(!Number.isFinite(close) || close<=0) throw new Error('No quote for '+estimateTicker);
  const tickerClose=ticker === estimateTicker ? close : await EM.fetchUnderlyingClose(ticker);
  const displayClose=Number.isFinite(tickerClose) && tickerClose>0 ? tickerClose : close;
  
  // Find ATM strike
  const atmStrike=[...new Set(options.map(o=>o.strike))].sort((a,b)=>Math.abs(a-close)-Math.abs(b-close))[0];
  if(!Number.isFinite(atmStrike)) throw new Error('No ATM strike');
  
  // Get call and put at ATM
  const call=options.find(o=>o.strike===atmStrike && EM.optionSide(o)==='C');
  const put=options.find(o=>o.strike===atmStrike && EM.optionSide(o)==='P');
  
  if(!call || !put){
    const priced=options.filter(o=>o.strike===atmStrike && EM.mid(o)>0);
    if(priced.length >= 2){
      const emFallback=priced.slice(0,2).reduce((sum,o)=>sum+EM.mid(o),0);
      return { ticker, close:displayClose, em:emFallback, up:displayClose+emFallback, down:displayClose-emFallback, expiration:targetExp, strike:atmStrike };
    }
    throw new Error('Missing call or put');
  }
  
  // Calculate EM using TastyTrade formula: 0.84 × avgIV × price × √(DTE/365)
  const avgIV = ((call.iv || 0) + (put.iv || 0)) / 2;
  const dte = call.dte || put.dte || EM.daysTo(targetExp);
  
  let em = 0;
  if(avgIV > 0 && dte > 0){
    em = 0.84 * avgIV * close * Math.sqrt(dte / 365);
  } else if(EM.mid(call) > 0 || EM.mid(put) > 0) {
    // Fallback: use straddle mid
    em = EM.mid(call) + EM.mid(put);
  }
  
  if(!Number.isFinite(em) || em <= 0) throw new Error('Could not calculate EM');
  
  return { 
    ticker, 
    close:displayClose, 
    em, 
    up:displayClose+em, 
    down:displayClose-em, 
    expiration:targetExp, 
    strike:atmStrike 
  };
};

EM.prefetchExpirations = async function(){
  try{
    const r=await fetch('http://localhost:3001/proxy/api/tt/expirations/SPX');
    const json=await r.json();
    const items=json.expirations || json?.data?.items || [];
    if(items.length) EM.setKnownExpirations(items);
  }catch(e){ console.warn('Could not prefetch expirations'); }
};

window.setEstimatedMovePeriod = function(period){
  if(!EM.PERIODS[period] || EM.activePeriod===period) return;
  EM.activePeriod=period;
  const exp=EM.getTargetExpiration();
  EM.updatePeriodChrome(exp ? EM.labelForDate(exp) : '');
  EM.updateExpPickerVisibility();
};

window.onWeeklyExpChange = function(val){ 
  EM.weeklyExpOverride=val; 
  if(EM.activePeriod==='weekly') EM.updatePeriodChrome(val ? EM.labelForDate(val) : '');
};
window.onMonthlyExpChange = function(val){ 
  EM.monthlyExpOverride=val; 
  if(EM.activePeriod==='monthly') EM.updatePeriodChrome(val ? EM.labelForDate(val) : '');
};

window.copyEstimatedMovesTable = async function(){
  const btn=document.getElementById('em-copy-table-btn');
  const body=document.getElementById('em-table-body');
  const rows=Array.from(body?.querySelectorAll('tr') || [])
    .map(tr=>Array.from(tr.cells).map(cell=>cell.textContent.trim()).filter(Boolean))
    .filter(row=>row.length >= 6);
  if(!rows.length) return;

  const period=document.getElementById('em-period-title')?.textContent || 'Estimated';
  const exp=document.getElementById('em-exp-label')?.textContent || '';
  const title=`${period} Estimated Move For ${exp}`.trim();
  const original=btn?.textContent || 'Copy';

  try{
    if(!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard unavailable');

    const headers=['Ticker','Close','Exp','EM','↑ Up','↓ Down'];
    const colW=[138,172,90,140,178,178];
    const rowH=36;
    const titleH=34;
    const brandH=28;
    const w=colW.reduce((sum,n)=>sum+n,0);
    const h=titleH + rowH + rows.length * rowH + (rows.length > 13 ? brandH : 0) + 2;
    const canvas=document.createElement('canvas');
    canvas.width=w * 2;
    canvas.height=h * 2;
    const ctx=canvas.getContext('2d');
    const drawText=(value,x,y,width,align,color,weight='700')=>{
      ctx.fillStyle=color;
      ctx.font=`${weight} 13px Consolas, monospace`;
      ctx.textAlign=align;
      ctx.textBaseline='middle';
      const s=String(value ?? '').trim();
      const max=Math.max(1, Math.floor(width / 8));
      ctx.fillText(s.length > max ? s.slice(0, max - 1) : s, x, y);
    };
    const drawTitle=()=>{
      const prefix=`${period} Estimated Move For`.toUpperCase();
      const date=String(exp || '').trim();
      ctx.font='800 13px Consolas, monospace';
      ctx.textBaseline='middle';
      ctx.textAlign='left';
      const gap=date ? 6 : 0;
      const total=ctx.measureText(prefix).width + gap + ctx.measureText(date).width;
      let x=(w - total) / 2;
      ctx.fillStyle='#00e5ff';
      ctx.fillText(prefix, x, titleH/2);
      x += ctx.measureText(prefix).width + gap;
      if(date){
        ctx.fillStyle='#ff9f43';
        ctx.fillText(date, x, titleH/2);
      }
    };

    ctx.scale(2,2);
    ctx.fillStyle='#080d12';
    ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#20334a';
    ctx.lineWidth=1;
    ctx.strokeRect(0.5,0.5,w-1,h-1);
    ctx.fillStyle='#0b1118';
    ctx.fillRect(0,0,w,titleH);
    drawTitle();

    let y=titleH;
    ctx.fillStyle='#101923';
    ctx.fillRect(0,y,w,rowH);
    let x=0;
    headers.forEach((head,i)=>{
      ctx.strokeStyle='#20334a';
      ctx.strokeRect(x+0.5,y+0.5,colW[i],rowH);
      const headColor=i === 4 ? '#00e676' : i === 5 ? '#ff3355' : '#00e5ff';
      drawText(head.toUpperCase(), x + colW[i]/2, y + rowH/2, colW[i]-12, 'center', headColor, '800');
      x += colW[i];
    });

    y += rowH;
    rows.forEach((row,index)=>{
      if(index === 13){
        ctx.fillStyle='#0d131b';
        ctx.fillRect(0,y,w,brandH);
        ctx.strokeStyle='#20334a';
        ctx.strokeRect(0.5,y+0.5,w-1,brandH);
        drawText('X.COM/BZILATRADES', w/2, y + brandH/2, w-16, 'center', '#ffffff', '800');
        y += brandH;
      }
      x=0;
      ctx.fillStyle='#080d12';
      ctx.fillRect(0,y,w,rowH);
      row.slice(0,6).forEach((cell,i)=>{
        ctx.strokeStyle='#20334a';
        ctx.strokeRect(x+0.5,y+0.5,colW[i],rowH);
        const fill=i === 0 || i === 2 ? '#00e5ff' : i === 3 ? '#ffd329' : i === 4 ? '#00ff8a' : i === 5 ? '#ff3355' : '#ffffff';
        drawText(cell, x + colW[i]/2, y + rowH/2, colW[i]-12, 'center', fill, i === 0 || i >= 3 ? '800' : '700');
        x += colW[i];
      });
      y += rowH;
    });

    const blob=await new Promise(resolve=>canvas.toBlob(resolve, 'image/png'));
    if(!blob) throw new Error('Image render failed');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    if(btn) btn.textContent='Copied';
  }catch(e){
    if(btn) btn.textContent='Failed';
  }finally{
    if(btn) setTimeout(()=>{ btn.textContent=original; }, 1200);
  }
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
      if(chainExps.length) EM.setKnownExpirations(chainExps);
    }
    
    const settled=[];
    for(let i=0;i<EM.SYMBOLS.length;i+=1){
      const batch=EM.SYMBOLS.slice(i,i+1);
      const results=await Promise.allSettled(batch.map(EM.estimateMove));
      settled.push(...results);
      if(i+1<EM.SYMBOLS.length) await new Promise(r=>setTimeout(r,1500));
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

;(function(){
  const installEstimatedMoveCopyShot = () => {
    return;
    if (window.__estimatedMoveCopyShotInstalled) return;
    window.__estimatedMoveCopyShotInstalled = true;
    const style = document.createElement('style');
    style.textContent = `
      #em-copy-shot,.em-copy-shot{display:inline-flex;align-items:center;height:22px;padding:0 11px;border:1px solid #1f70a8;background:#071522;color:#00e5ff;font:800 10px/1 monospace;letter-spacing:1.3px;text-transform:uppercase;border-radius:3px;cursor:pointer}
      .em-copy-shot{margin-left:4px}
      #em-copy-shot:hover{border-color:#00e5ff;color:#fff}
      #em-copy-shot.copied{border-color:#00ff8a;color:#00ff8a}
      #em-copy-shot.failed{border-color:#ff3355;color:#ff3355}
    `;
    document.head.appendChild(style);
    const findToolbar = () => {
      const refresh = Array.from(document.querySelectorAll('button,input,a')).find(el => /refresh/i.test(el.textContent || el.value || ''));
      return refresh?.parentElement || document.querySelector('#em-weekly-exp-select')?.parentElement || document.body;
    };
    const ensureButton = () => {
      const controls = [
        ['daily','DAILY SHOT'],
        ['weekly','WEEKLY SHOT'],
        ['monthly','MONTHLY SHOT']
      ];
      const refresh = Array.from(document.querySelectorAll('button,input,a')).find(el => /refresh/i.test(el.textContent || el.value || ''));
      const toolbar = refresh?.parentElement || findToolbar();
      controls.forEach(([period,label], index) => {
        if (document.getElementById(`em-copy-shot-${period}`)) return;
        const btn = document.createElement('button');
        btn.id = index === 0 ? 'em-copy-shot' : `em-copy-shot-${period}`;
        btn.className = 'em-copy-shot';
        btn.type = 'button';
        btn.dataset.period = period;
        btn.textContent = label;
        btn.addEventListener('click', copyShot);
        if (refresh?.parentElement) refresh.parentElement.insertBefore(btn, refresh);
        else toolbar.appendChild(btn);
      });
    };
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const color = (value, fallback) => value || fallback;
    const text = (ctx, value, x, y, w, align, fill, weight = '700') => {
      ctx.fillStyle = fill;
      ctx.font = `${weight} 14px Consolas, monospace`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      const s = String(value ?? '').trim();
      const max = Math.max(1, Math.floor(w / 8));
      ctx.fillText(s.length > max ? s.slice(0, max - 1) : s, x, y);
    };
    const rowsFromTable = () => {
      const table = document.querySelector('table');
      if (!table) return [];
      return Array.from(table.querySelectorAll('tbody tr')).map(tr => Array.from(tr.cells).map(td => td.textContent.trim())).filter(r => r.length >= 6);
    };
    async function copyShot() {
      const btn = (typeof event !== 'undefined' && event?.currentTarget) || document.getElementById('em-copy-shot');
      try {
        const requestedPeriod = btn?.dataset?.period;
        const currentPeriod = window.EM?.activePeriod;
        if (requestedPeriod && currentPeriod && requestedPeriod !== currentPeriod) {
          const target = Array.from(document.querySelectorAll('button,input,a')).find(el => (el.textContent || el.value || '').trim().toLowerCase() === requestedPeriod);
          target?.click();
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        const rows = rowsFromTable();
        if (!rows.length) throw new Error('No rows');
        const title = (Array.from(document.querySelectorAll('*')).find(el => /ESTIMATED MOVE FOR/i.test(el.textContent || '') && (el.children.length === 0 || String(el.className).includes('em-title')))?.textContent || 'ESTIMATED MOVES').trim();
        const headers = ['TICKER','CLOSE','EXP','EM','↑ UP','↓ DOWN'];
        const colW = [138,172,90,140,178,178];
        const rowH = 36;
        const titleH = 36;
        const brandH = 28;
        const w = colW.reduce((a,b)=>a+b,0);
        const h = titleH + rowH + rows.length * rowH + (rows.length > 13 ? brandH : 0) + 2;
        const c = document.createElement('canvas');
        c.width = w * 2;
        c.height = h * 2;
        const ctx = c.getContext('2d');
        ctx.scale(2,2);
        ctx.fillStyle = '#080d12';
        ctx.fillRect(0,0,w,h);
        ctx.strokeStyle = '#20334a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5,0.5,w-1,h-1);
        ctx.fillStyle = '#0b1118';
        ctx.fillRect(0,0,w,titleH);
        text(ctx, title.toUpperCase(), w/2, titleH/2, w, 'center', '#00e5ff', '800');
        let y = titleH;
        ctx.fillStyle = '#101923';
        ctx.fillRect(0,y,w,rowH);
        let x = 0;
        headers.forEach((head,i) => {
          ctx.strokeStyle = '#20334a';
          ctx.strokeRect(x+0.5,y+0.5,colW[i],rowH);
          text(ctx, head, x + colW[i]/2, y + rowH/2, colW[i]-12, 'center', i === 5 ? '#ff3355' : '#00e5ff', '800');
          x += colW[i];
        });
        y += rowH;
        rows.forEach((row, idx) => {
          if (idx === 13) {
            ctx.fillStyle = '#0d131b';
            ctx.fillRect(0,y,w,brandH);
            ctx.strokeStyle = '#20334a';
            ctx.strokeRect(0.5,y+0.5,w-1,brandH);
            text(ctx, 'X.COM/BZILATRADES', w/2, y + brandH/2, w, 'center', '#ffffff', '800');
            y += brandH;
          }
          x = 0;
          ctx.fillStyle = '#080d12';
          ctx.fillRect(0,y,w,rowH);
          row.slice(0,6).forEach((cell,i) => {
            ctx.strokeStyle = '#20334a';
            ctx.strokeRect(x+0.5,y+0.5,colW[i],rowH);
            const fill = i === 0 || i === 2 ? '#00e5ff' : i === 3 ? '#ffd329' : i === 4 ? '#00ff8a' : i === 5 ? '#ff3355' : '#ffffff';
            text(ctx, cell, x + colW[i]/2, y + rowH/2, colW[i]-12, 'center', fill, i === 0 || i >= 3 ? '800' : '700');
            x += colW[i];
          });
          y += rowH;
        });
        const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('No image');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        btn.classList.remove('failed');
        btn.classList.add('copied');
        const originalText = btn.textContent;
        btn.textContent = 'COPIED';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = originalText; }, 1200);
      } catch (error) {
        btn?.classList.add('failed');
        const originalText = btn?.textContent || 'COPY SHOT';
        if (btn) btn.textContent = 'FAILED';
        setTimeout(() => { btn?.classList.remove('failed'); if (btn) btn.textContent = originalText; }, 1400);
      }
    }
    new MutationObserver(ensureButton).observe(document.body, { childList:true, subtree:true });
    ensureButton();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEstimatedMoveCopyShot);
  else installEstimatedMoveCopyShot();
  const installEstimatedMoveDomFormat = () => {
    if (window.__estimatedMoveDomFormatInstalled) return;
    window.__estimatedMoveDomFormatInstalled = true;
    const style = document.createElement('style');
    style.textContent = `
      .em-brand-row td{color:#fff!important;text-align:center!important;font-weight:800!important;letter-spacing:2px!important;background:#0d131b!important;border-top:1px solid #20334a!important;border-bottom:1px solid #20334a!important;padding:8px 0!important}
      .em-title{letter-spacing:3px!important}
    `;
    document.head.appendChild(style);
    const fmtExp = (exp) => {
      const m = String(exp || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return `${Number(m[2])}/${Number(m[3])}`;
      const short = String(exp || '').match(/^(\d{1,2})\/(\d{1,2})/);
      return short ? `${Number(short[1])}/${Number(short[2])}` : '-';
    };
    const sync = () => {
      const title = Array.from(document.querySelectorAll('*')).find(el => /ESTIMATED MOVE FOR/i.test(el.textContent || '') && (el.children.length === 0 || el.className === 'em-title'));
      const activeSelect = document.getElementById('em-weekly-exp-select')?.offsetParent ? document.getElementById('em-weekly-exp-select') : document.getElementById('em-monthly-exp-select');
      const exp = activeSelect?.selectedOptions?.[0]?.textContent || activeSelect?.value || '';
      if (title) title.textContent = title.textContent.replace(/ESTIMATED MOVE FOR\s+.*/i, `ESTIMATED MOVE FOR ${fmtExp(exp)}`);
      const table = document.querySelector('table');
      const body = table?.tBodies?.[0];
      if (!body || body.querySelector('.em-brand-row')) return;
      const dataRows = Array.from(body.rows).filter(row => row.cells.length >= 6);
      if (dataRows.length <= 13) return;
      const brand = document.createElement('tr');
      brand.className = 'em-brand-row';
      brand.innerHTML = '<td colspan="6">X.COM/BZILATRADES</td>';
      body.insertBefore(brand, dataRows[13]);
    };
    new MutationObserver(sync).observe(document.body, { childList:true, subtree:true, characterData:true });
    document.addEventListener('change', sync, true);
    setInterval(sync, 750);
    sync();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installEstimatedMoveDomFormat);
  else installEstimatedMoveDomFormat();
  const installEstimatedMoveFormat = () => {
    if (!window.EM || window.EM.__formatPatchInstalled) return;
    const EM = window.EM;
    EM.__formatPatchInstalled = true;
    const fmtExp = (exp) => {
      if (!exp) return '-';
      const m = String(exp).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${Number(m[2])}/${Number(m[3])}` : String(exp);
    };
    const oldRender = EM.renderRows || EM.renderTable || EM.render;
    const getExpiration = (rows) =>
      EM.selectedExpiration ||
      (Array.isArray(rows) && rows.find(r => r && r.expiration)?.expiration) ||
      document.getElementById('em-weekly-exp-select')?.value ||
      document.getElementById('em-monthly-exp-select')?.value ||
      '';
    const formatExistingTable = () => {
      const table = document.querySelector('.em-table, #em-table, table');
      if (!table) return;
      const rows = Array.from(table.querySelectorAll('tbody tr')).filter(tr => tr.children.length > 1);
      rows.forEach((tr, index) => {
        if (index === 13 || tr.classList.contains('em-brand-row')) return;
        if (index > 13 && tr.previousElementSibling && tr.previousElementSibling.classList.contains('em-brand-row')) return;
      });
      const title = document.querySelector('.em-title');
      const exp = getExpiration([]);
      if (title) title.textContent = `${String(EM.activePeriod || 'weekly').toUpperCase()} ESTIMATED MOVE FOR ${fmtExp(exp)}`;
      if (rows.length > 13 && !table.querySelector('.em-brand-row')) {
        const body = table.tBodies[0] || table;
        const brand = document.createElement('tr');
        brand.className = 'em-brand-row';
        brand.innerHTML = '<td colspan="6">X.COM/BZILATRADES</td>';
        body.insertBefore(brand, rows[13]);
      }
    };
    ['renderRows','renderTable','render'].forEach(name => {
      if (typeof EM[name] !== 'function') return;
      const original = EM[name];
      EM[name] = function(...args) {
        const result = original.apply(this, args);
        setTimeout(formatExistingTable, 0);
        return result;
      };
    });
    const oldRefresh = window.refreshEstimatedMoves;
    if (typeof oldRefresh === 'function') {
      window.refreshEstimatedMoves = async function(...args) {
        const result = await oldRefresh.apply(this, args);
        formatExistingTable();
        return result;
      };
    }
    document.addEventListener('change', (event) => {
      if (event.target && /em-(weekly|monthly)-exp-select/.test(event.target.id || '')) {
        setTimeout(formatExistingTable, 0);
      }
    }, true);
    setTimeout(formatExistingTable, 0);
  };
  installEstimatedMoveFormat();
  document.addEventListener('DOMContentLoaded', installEstimatedMoveFormat);
})();
