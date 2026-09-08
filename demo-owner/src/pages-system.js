/* ══════════════════════════════════════════════════════════════
   SYSTEM GROUP + HUB — Dev, Database, Hub
   Rebuilt against pages/Dev.tsx, Database.tsx, Hub.tsx
   ══════════════════════════════════════════════════════════════ */

/* ══════════════ DEV · SYMBOL PROBE ══════════════ */
P.Dev = () => {
  const feed = (title, rows) => `<div style="border:1px solid var(--line);border-radius:11px;padding:11px;background:var(--panelSolid)">
    <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;margin-bottom:7px">${title}</div>
    ${rows.map(r=>`<div class="kv" style="padding:4px 0;font-size:11.5px"><span class="k">${r[0]}</span>
      <b class="mono">${r[1]}</b></div>`).join("")}</div>`;

  const exposure = rows => `<div style="border:1px solid var(--line);border-radius:11px;padding:11px;background:var(--panelSolid)">
    <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;margin-bottom:7px">Greeks</div>
    ${rows.map(r=>`<div class="kv" style="padding:4px 0;font-size:11.5px"><span class="k">${r[0]}</span>
      <b class="mono">${r[1]}</b></div>`).join("")}</div>`;

  const oiCheck = (theta, tt) => {
    const diff = theta - tt, pct = (diff/tt*100);
    const tone = Math.abs(pct)<=2 ? "var(--ok)" : Math.abs(pct)<=10 ? "var(--gold)" : "var(--softred)";
    return `<div style="border:1px solid var(--line);border-radius:11px;padding:11px;background:var(--panelSolid)">
      <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;margin-bottom:7px">OI Check · Theta vs TT REST</div>
      <div class="kv" style="padding:4px 0;font-size:11.5px"><span class="k">Theta (OPRA)</span><b class="mono">${theta.toLocaleString()}</b></div>
      <div class="kv" style="padding:4px 0;font-size:11.5px"><span class="k">TT REST</span><b class="mono">${tt.toLocaleString()}</b></div>
      <div class="kv" style="padding:4px 0;font-size:11.5px;border-top:1px solid var(--line);margin-top:4px">
        <span class="k">Diff (Θ−TT)</span>
        <b class="mono" style="color:${tone}">${diff} (${pct>=0?"+":""}${pct.toFixed(1)}%)</b></div></div>`;
  };

  const legRow = (side, colour) => `
    <div style="margin-bottom:8px"><div style="font-size:11px;font-weight:800;letter-spacing:.12em;
      text-transform:uppercase;color:${colour};margin-bottom:9px">${side}</div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
      ${feed("Quote", side==="Calls"?[["bid","4.10"],["ask","4.30"],["mark","4.20"],["size","41 × 88"]]
                                     :[["bid","3.80"],["ask","4.00"],["mark","3.90"],["size","62 × 104"]])}
      ${feed("Trade", side==="Calls"?[["price","4.25"],["size","12"],["volume","18,204"],["dayVolume","18,204"]]
                                    :[["price","3.85"],["size","8"],["volume","14,880"],["dayVolume","14,880"]])}
      ${feed("Summary", side==="Calls"?[["openInterest","124,880"],["prevDayClose","3.90"],["dayOpen","3.95"]]
                                      :[["openInterest","110,884"],["prevDayClose","4.10"],["dayOpen","4.05"]])}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px">
      ${feed("Greeks", side==="Calls"?[["delta","0.482"],["gamma","0.00412"],["theta","-2.14"],["vega","0.88"],["volatility","0.114"]]
                                     :[["delta","-0.518"],["gamma","0.00388"],["theta","-2.02"],["vega","0.86"],["volatility","0.121"]])}
      ${exposure(side==="Calls"
        ? [["GEX (γ·(OI+Vol)·S²)","+2.84B"],["DEX (δ·OI·100·S)","+3.86B"],["VEX (vega·OI·100·S)","+70.4M"],
           ["Theta exp","−26.7M"],["GEX (vol)","+412M"],["Vanna exp","+18.2M"],["Charm exp","−4.1M"],["spot","6,412.40"]]
        : [["GEX (γ·(OI+Vol)·S²)","+1.28B"],["DEX (δ·OI·100·S)","−3.68B"],["VEX (vega·OI·100·S)","+61.1M"],
           ["Theta exp","−22.4M"],["GEX (vol)","+228M"],["Vanna exp","+14.0M"],["Charm exp","−3.4M"],["spot","6,412.40"]])}
      ${oiCheck(side==="Calls"?124880:110884, side==="Calls"?124902:112004)}
    </div></div>`;

  const netGreeks = card(null, `
    <div class="chips" style="margin-bottom:12px">
      <b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Net Greeks · Call + Put</b>
      ${pill("SPXW · 6410","cy")}
      <span class="sp" style="flex:1"></span>
      <button class="btn2 sm">⧉ Copy img</button><button class="btn2 sm">↗ Discord</button></div>
    <div class="grid2" style="gap:8px 24px">
      ${[["Net GEX (γ·(OI+Vol)·S²)","+4.12B"],["Net DEX (δ·OI·100·S)","+180M"],["Net VEX (vega·OI·100·S)","+131.5M"],
         ["Net Theta exp","−49.1M"],["Net GEX (vol)","+640M"],["Net Vanna exp","+32.2M"],
         ["Net Charm exp","−7.5M"],["Σ OI (call + put)","235,764"],["Σ Volume (call + put)","33,084"],["spot","6,412.40"]]
        .map(r=>`<div class="kv" style="font-size:12px"><span class="k">${r[0]}</span><b class="mono">${r[1]}</b></div>`).join("")}</div>`);

  const flowCalc = card(null, `
    <div style="margin-bottom:6px"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Flow GEX · raw calc</b>
      <span class="mut" style="font-size:11.5px;margin-left:8px">γ · dealer_net · Spot²  (dealer long +, short −, no put flip)</span></div>
    <div class="mut" style="font-size:11px;margin-bottom:12px">dealer-inventory basis (live tape) · Spot 6,412.40 · Spot² 41,118,873 · net = buyVol − sellVol</div>
    ${table([{t:" "},{t:"γ",n:1},{t:"Buy / Sell",n:1},{t:"× Net",n:1},{t:"× S²",n:1},{t:"= Flow GEX",n:1}],
      [["Call","0.00412","8,204 / 6,110","2,094","41,118,873","+354.9M","gn"],
       ["Put","0.00388","5,880 / 9,204","−3,324","41,118,873","−530.2M","rd"],
       ["Net","","","","","−175.3M","mt"]]
      .map(r=>[pill(r[0], r[6]), r[1]||"—", r[2]||"—", r[3]||"n/a", r[4]||"—",
        r[5]?`<span class="${r[5].startsWith("+")?"pos":"neg"}">${r[5]}</span>`:"n/a"]), {plain:true})}`);

  const log = card(null, `
    <div class="chips" style="margin-bottom:10px"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Log</b>
      <span class="sp" style="flex:1"></span><button class="btn2 sm">Clear</button></div>
    <pre class="mono" style="margin:0;font-size:11px;line-height:1.9;opacity:.7;white-space:pre-wrap">14:03:22.481  ▶ REST probe SPXW 6410 2026-09-12 (call + put)
14:03:22.744  CALL OI=124880 vol=18204 GEX=2.840B DEX=3.860B
14:03:22.751  CALL OI theta=124880 tt=124902 diff=-22 (-0.0%)
14:03:22.893  PUT OI=110884 vol=14880 GEX=1.280B DEX=-3.680B
14:03:22.901  PUT OI theta=110884 tt=112004 diff=-1120 (-1.0%)
14:03:22.934  Σ NET GEX=4.120B DEX=180.0M VEX=131.5M spot=6412.40</pre>`);

  return `<div class="phead"><h1>Dev · Symbol probe</h1>
      <span class="mut" style="font-size:14px">Chain → strike resolve → market-data (any ticker)</span>
      ${pill("REST","bl")}</div>`
    + card(null, `<div class="chips" style="align-items:flex-end">
        ${[["Ticker","SPXW",110],["Strike","6410",110]].map(([l,v,w])=>
          `<div><div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">${l}</div>
            <div class="inp" style="width:${w}px;margin-top:4px;padding:7px 10px;font-size:12.5px">${v}</div></div>`).join("")}
        <div><div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">Expiry</div>
          <div class="inp" style="width:160px;margin-top:4px;padding:7px 10px;font-size:12.5px">2026-09-12</div></div>
        <button class="btn sm">Render</button>
        <button class="btn2 sm" style="color:var(--softred);border-color:rgba(239,68,68,.3)">■ Stop</button>
        <span class="sp" style="flex:1"></span>
        <span class="mut" style="font-size:11.5px">REST — calls + puts + net</span></div>
      <div class="grid2" style="margin-top:14px;gap:10px">
        ${[["Ticker","SPXW"],["Strike","6410"],["Resolved Symbol","SPXW 260912C06410000"],["Elapsed","453 ms"]]
          .map(([l,v])=>`<div style="border:1px solid var(--line);border-radius:11px;padding:10px 12px">
            <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">${l}</div>
            <div class="mono" style="font-size:13.5px;font-weight:700;margin-top:3px">${v}</div></div>`).join("")}</div>`)
    + card(null, legRow("Calls","var(--ok)") + legRow("Puts","var(--softred)"))
    + netGreeks + flowCalc
    + card(null, `<details><summary style="cursor:pointer;font-size:12.5px;opacity:.7">Raw response (call + put)</summary>
        <pre class="mono" style="margin:10px 0 0;font-size:11px;opacity:.6;white-space:pre-wrap">{
  "call": { "symbol": "SPXW 260912C06410000", "openInterest": 124880, "gamma": 0.00412 },
  "put":  { "symbol": "SPXW 260912P06410000", "openInterest": 110884, "gamma": 0.00388 }
}</pre></details>`, {tight:true})
    + log;
};

/* ══════════════ DATABASE ══════════════ */
P.Database = () => {
  const LABELS = { eod_strike_gex:"EOD Strike GEX", eod_gex:"EOD GEX", mvc_snapshots:"CB - Core Bullseye Snapshots",
    premium_flow:"Premium Flow", greeks_ts:"Greeks TS", playbook_feed:"Playbook Feed", page_visits:"Page Status",
    es_candles:"ES Candles", bzila_snapshots:"Bzila Snaps", flow_calls:"Flow Calls", snapshots:"EM Snapshots",
    ticker_levels:"Levels (/em)", es_stats:"ES Stats", trades:"Trades", expirations_cache:"Exp Cache",
    daily_grade_days:"Daily Grade Days", watch_snapshots:"Watch Snapshots", users:"Users",
    subscriptions:"Subscriptions", feedback:"Feedback", comp_access:"Comp Access", roster_overrides:"Roster Overrides" };
  const eod = `<div class="grid3">${D.eodStatus.map(e=>`
    <div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px">
      <div class="chips"><span class="livedot"></span><b class="mono" style="font-size:13px">${esc(e.sym)}</b></div>
      <div class="mono pos" style="font-size:19px;font-weight:800;margin-top:5px">${esc(e.gex)}</div>
      <div class="mut" style="font-size:11px;margin-top:3px">spot ${e.spot.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
      <div class="mut" style="font-size:11px">${esc(e.at)}</div></div>`).join("")}</div>`;

  const picker = `<div class="chips" style="margin-bottom:10px">
      <span style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Table (22)</span>
      <span class="inp ph" style="width:140px;padding:5px 9px;font-size:12px">filter…</span>
      <span class="mut" style="font-size:10.5px">(total)<span style="color:var(--softred)">(today)</span></span></div>
    <div style="max-height:168px;overflow-y:auto"><div class="chips">
      ${D.tables.map((t,i)=>`<button class="btn2 sm" style="text-transform:uppercase;letter-spacing:.04em;font-size:10px${
        i===0?';border-color:rgba(33,158,188,.6);color:#8fdcef':''}">
        ${LABELS[t[0]]||t[0]} (${t[1].toLocaleString()})${t[2]?`<span style="color:var(--softred)">(${t[2].toLocaleString()})</span>`:""}</button>`).join("")}
    </div></div>`;

  const grid = table(
    [{t:"session"},{t:"symbol"},{t:"strike",n:1},{t:"call_gex",n:1},{t:"put_gex",n:1},{t:"net_gex",n:1},{t:"oi",n:1},{t:"basis"}],
    [["2026-09-05","SPX",6450,"+712,004,110","-7,102,880","+704,901,230","124,880","oi+vol"],
     ["2026-09-05","SPX",6440,"+318,220,004","-68,004,120","+250,215,884","98,204","oi+vol"],
     ["2026-09-05","SPX",6430,"+286,110,220","-50,220,884","+235,889,336","81,442","oi+vol"],
     ["2026-09-05","SPX",6420,"+142,880,004","-46,110,220","+96,769,784","64,220","oi+vol"],
     ["2026-09-05","SPX",6410,"+88,204,110","-152,220,660","-64,016,550","71,884","oi+vol"],
     ["2026-09-05","SPX",6400,"+402,880,110","-14,880,220","+387,999,890","142,006","oi+vol"],
     ["2026-09-05","SPX",6390,"+61,220,004","-271,880,410","-210,660,406","110,884","oi+vol"],
     ["2026-09-05","SPX",6350,"+22,110,880","-567,220,004","-545,109,124","188,402","oi+vol"]]
    .map(r=>[`<span class="mono mut">${r[0]}</span>`,`<b>${r[1]}</b>`,r[2],
      `<span class="mono pos">${r[3]}</span>`,`<span class="mono neg">${r[4]}</span>`,
      `<span class="mono ${r[5].startsWith("+")?"pos":"neg"}">${r[5]}</span>`,
      `<span class="mono">${r[6]}</span>`,`<span class="mut">${r[7]}</span>`]), {plain:true});

  return `<div class="phead">
      <h1 style="font-size:14px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--cy)">Database</h1>
      <span class="mut" style="font-size:12px">200 rows</span>
      <span class="mut" style="font-size:12px">Date:</span>
      <span class="inp" style="width:100px;padding:5px 9px;font-size:12px">Sep 5</span>
      <span style="color:var(--cy);font-size:12px;cursor:pointer">Today</span>
      <span style="color:var(--cy);font-size:12px;cursor:pointer">All</span>
      <span class="mut" style="font-size:12px">Limit:</span>
      <span class="chips">${["100","200","500"].map((l,i)=>pill(l,i===1?"cy":"mt")).join("")}</span>
      <span class="sp"></span><button class="refresh">↻ Refresh</button></div>`
    + `<div class="synth">◆ Rows shown are illustrative. The live console reads the production schema directly.</div>`
    + card(null, `<div class="chips" style="margin-bottom:12px">
        <b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">EOD GEX · Today</b>
        <span class="sp" style="flex:1"></span>
        <span class="mut" style="font-size:11.5px">3 symbol(s) saved</span></div>` + eod)
    + card(null, picker)
    + card(null, grid);
};

/* ══════════════ HUB ══════════════ */
P.Hub = () => {
  const view = tabOf("Hub","List");
  if(view === "Brain"){
    return `<div class="phead"><h1>Owner Hub</h1><span class="sp"></span>
        ${tabs("Hub",["Brain","List"],view)}</div>`
      + card(null, `<div class="locked">
          <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--lblue);font-weight:800">Brain graph — coming in a later pass</div>
          <div class="s">The force-directed route map (OwnerBrainGraph) will be ported next. Use the List view to navigate for now.</div></div>`);
  }
  const chip = l => `<span class="pill p-mt" data-go="${esc(l.key)}" style="cursor:pointer;padding:5px 10px;
    font-size:11px;text-transform:uppercase;letter-spacing:.04em">${esc(l.glyph)} ${esc(l.label)} <span style="opacity:.4">☆</span></span>`;
  const rails = NAV.groups.map(g=>`
    <div style="margin-bottom:16px">
      <div class="chips" style="margin-bottom:8px">
        <span style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:800;color:${g.accent}">${esc(g.label)}</span>
        <span class="mut" style="font-size:11px">${g.links.length}</span></div>
      <div class="chips">${g.links.map(chip).join("")}</div></div>`).join("");

  return `<div class="phead"><h1>Owner Hub</h1><span class="sp"></span>
      ${tabs("Hub",["Brain","List"],view)}</div>`
    + card(null, `<div class="chips" style="background:var(--inset);border:1px solid var(--line);
        border-radius:11px;padding:11px 14px">
        <span class="mut">⌕</span>
        <span class="mut" style="font-size:13px">Jump to a route…</span>
        <span class="sp" style="flex:1"></span>
        <span style="border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:10.5px;opacity:.6">⌘K</span></div>`, {tight:true})
    + card(null, `<div style="margin-bottom:16px">
        <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:800;opacity:.5;margin-bottom:8px">Pinned</div>
        <div class="chips">${["Sales","GexGrowth","DailyGrades"].map(k=>{
          const l = ALL.find(x=>x.key===k);
          return `<span class="pill p-gd" data-go="${k}" style="cursor:pointer;padding:5px 10px;font-size:11px;
            text-transform:uppercase;letter-spacing:.04em">${l.glyph} ${l.label} ★</span>`;}).join("")}</div></div>
      <div style="margin-bottom:16px">
        <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;font-weight:800;opacity:.5;margin-bottom:8px">Recent</div>
        <div class="chips">${["Admin","Affiliates","Dev"].map(k=>{
          const l = ALL.find(x=>x.key===k);
          return chip(l);}).join("")}</div></div>`
      + rails
      + `<div class="cap" style="margin-top:8px">28 routes · ⌘K to search · ↑↓ to move · ↵ to open · ☆ to pin</div>`);
};
