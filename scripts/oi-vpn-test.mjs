const [, , ROOT='SPX', EXP='', TYPE='P', STRIKE=''] = process.argv;
const TT_BASE = process.env.TT_BASE_URL || 'https://api.tastytrade.com';
const CID=(process.env.TT_CLIENT_ID||'').trim();
const CSEC=(process.env.TT_CLIENT_SECRET||'').trim();
const RTOK=(process.env.TT_REFRESH_TOKEN||'').trim();
const UA=process.env.TT_USER_AGENT||'spx-gex-dashboard/1.0';
const H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',Accept:'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9',Origin:'https://www.cboe.com',Referer:'https://www.cboe.com/'};
const IDX=new Set(['SPX','NDX','RUT','VIX','XSP','DJX']);
const csym=r=>IDX.has(r)?'_'+r:r;
const pad=(n,w)=>String(n).padStart(w,'0');
const occ=(root,exp,type,strike)=>`${root}${exp}${type}${pad(Math.round(Number(strike)*1000),8)}`;
// EXP YYMMDD -> 20YY-MM-DD
const isoExp=e=>`20${e.slice(0,2)}-${e.slice(2,4)}-${e.slice(4,6)}`;
async function ip(){try{return (await (await fetch('https://api.ipify.org?format=json')).json()).ip;}catch{return '(ip failed)';}}
async function cboe(root){const r=await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(csym(root))}.json`,{headers:H});if(!r.ok)throw new Error('CBOE HTTP '+r.status);const m=new Map();for(const o of ((await r.json())?.data?.options||[]))if(o?.option)m.set(o.option,{oi:o.open_interest??null,volume:o.volume??null});return m;}
async function token(){if(!RTOK||!CSEC||!CID)throw new Error('Missing TT env');const basic=Buffer.from(`${CID}:${CSEC}`).toString('base64');const body=new URLSearchParams({grant_type:'refresh_token',refresh_token:RTOK}).toString();const r=await fetch(`${TT_BASE}/oauth/token`,{method:'POST',headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json','User-Agent':UA},body});const t=await r.text().catch(()=>'');if(!r.ok)throw new Error('OAuth '+r.status+' '+t.slice(0,200));return JSON.parse(t).access_token;}
async function ttoi(root,exp,type,strike){
  if(!RTOK)return null;
  const tk=await token();
  const auth={Authorization:'Bearer '+tk,Accept:'application/json','User-Agent':UA};
  // 1) resolve the exact TT option symbol via the nested option chain for this expiry
  const iso=isoExp(exp);
  const cr=await fetch(`${TT_BASE}/option-chains/${encodeURIComponent(root)}/nested`,{headers:auth});
  if(!cr.ok){console.log('  chain -> HTTP '+cr.status);return null;}
  const data=(await cr.json())?.data?.items?.[0];
  let symbol=null;
  for(const e of (data?.expirations||[])){
    if(e['expiration-date']!==iso)continue;
    for(const s of (e.strikes||[])){
      if(Math.abs(Number(s['strike-price'])-Number(strike))<0.001){
        symbol=type==='C'?s.call:s.put;
      }
    }
  }
  if(!symbol){console.log('  no chain match for',iso,strike,type);return null;}
  console.log('  TT symbol:',JSON.stringify(symbol));
  // 2) by-type with the REAL TT symbol (spaces and all)
  for(const key of ['equity-option[]','index-option[]']){
    const r=await fetch(`${TT_BASE}/market-data/by-type?${key}=${encodeURIComponent(symbol)}`,{headers:auth});
    if(!r.ok){console.log(`  ${key} -> HTTP ${r.status}`);continue;}
    const it=(await r.json())?.data?.items?.[0];
    console.log(`  ${key} -> ${it?'OI='+it['open-interest']:'no item'}`);
    if(it)return Number(it['open-interest']);
  }
  return null;
}
(async()=>{console.log('Outbound IP:',await ip());console.log(`Contract: ${ROOT} ${EXP} ${TYPE} ${STRIKE}\n`);const m=await cboe(ROOT);console.log('CBOE rows:',m.size);const sa=occ(ROOT,EXP,TYPE,STRIKE),sw=ROOT==='SPX'?occ('SPXW',EXP,TYPE,STRIKE):null;const a=m.get(sa),b=sw?m.get(sw):null;console.log(`  ${sa} OI=${a?.oi??'-'} vol=${a?.volume??'-'}`);if(sw)console.log(`  ${sw} OI=${b?.oi??'-'} vol=${b?.volume??'-'}`);const ct=(a?.oi||0)+(b?.oi||0);console.log('  CBOE OI both:',ct);console.log('  TT token:',RTOK?'yes('+RTOK.length+')':'NO');const tt=await ttoi(ROOT,EXP,TYPE,STRIKE).catch(e=>{console.log('  TT error:',e.message);return null;});if(tt!=null){const d=tt-ct,p=ct>0?((d/ct)*100).toFixed(1):'n/a';console.log(`\n  Ours (TT): ${tt}\n  Diff vs CBOE: ${d} (${p}%)`);}})().catch(e=>{console.error('FAILED:',e.message);process.exit(1);});
