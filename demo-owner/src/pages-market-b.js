/* ══════════════════════════════════════════════════════════════
   MARKET GROUP B — Daily Grades, Est. Moves BE, Watchlists,
                    Chart Types, LSE Data
   ══════════════════════════════════════════════════════════════ */

/* ══════════════ DAILY GRADES ══════════════ */
P.DailyGrades = () => {
  const tab = tabOf("DailyGrades","Levels");
  const OUT = {
    "tagged · held":"gn","untested":"bl","tagged · broke":"rd","gapped through":"og","broke · ran":"gn",
    "gapped · ran":"gn","absorbed":"gd","broke · reverted":"og","never reached":"rd","chop · held":"gn",
    "chop · broke":"og","chop · gapped":"rd","held clean":"gn","held · tested":"gd","flipped":"rd",
    "pinned":"gn","close":"cy","near":"gd","loose":"og","far":"rd","contained":"gn",
    "one side out":"gd","both out":"rd","regime held":"gn","regime · partial":"gd","regime failed":"rd",
    "call hit":"gn","call · partial":"gd","call untested":"bl","call missed":"rd" };
  const outPill = o => pill(o, OUT[o]||"mt");
  const gradePill = g => pill(g, g==="A+"||g==="A"?"gn":g==="B"?"cy":g==="C"?"gd":g==="D"?"og":"rd");
  const regPill = r => r==="+GEX"?pill("+GEX","gn"):r==="−GEX"?pill("−GEX","rd"):pill("flip","gd");

  const head = `<div class="phead">
    <div><div class="chips"><h1 style="font-size:14px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Daily Grades</h1>
      ${pill("Sample board","gd")}${pill("2026-09-05","cy")}${pill("watchlist live","gn")}</div>
      <div class="psub">Sealed 09:26 ET · 169 of 169 graded · scanner watchlist, same roster as the ΔGEX Board</div></div>
    <span class="sp"></span>
    <button class="btn2 sm">Paste JSON</button><button class="btn2 sm">Refresh</button></div>
    <div class="chips">${tabs("DailyGrades",["Levels","Grades","Sessions"],tab)}
      <span class="sp" style="flex:1"></span>
      <span class="mut" style="font-size:11px">Session</span>${gradePill("A-")}</div>`;

  if(tab === "Grades"){
    const tiles = [["session score","86.4"],["session grade","A-"],["weighted points","412 / 507"],
      ["graded","169"],["mean setup score","62.1"],["regime held","71%"],["calls hit","64%"],
      ["cap held / tested","48 / 66"],["floor held / tested","39 / 58"],["flip held","74%"],["range contained","81%"]];
    const rows = table(
      [{t:"Ticker"},{t:"Regime"},{t:"Grade"},{t:"Score",n:1},{t:"Setup",n:1},{t:"Pts",n:1},{t:"Regime call"},{t:"The call"},{t:"Cap"},{t:"Floor"},{t:"Flip"},{t:"CB"},{t:"Range"},{t:"C",n:1}],
      D.grades.map(g=>[`<b style="color:var(--cy);cursor:pointer">${esc(g.sym)}</b>`, regPill(g.reg), gradePill(g.grade),
        g.score.toFixed(1), (g.score*0.72).toFixed(0), `${g.pts} / 3`,
        outPill(g.score>75?"regime held":g.score>55?"regime · partial":"regime failed"),
        outPill(g.score>75?"call hit":g.score>55?"call · partial":"call missed"),
        outPill(g.out), outPill(g.score>60?"held clean":"flipped"),
        outPill(g.score>60?"held · tested":"flipped"), outPill(g.score>70?"pinned":"near"),
        outPill(g.score>70?"contained":"one side out"), `<b>${g.cap}</b>`]));
    return head
      + `<div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">
          ${tiles.map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n" style="font-size:19px">${v}</div></div>`).join("")}</div>`
      + card(null, `<div class="chips" style="margin-bottom:12px">
            <span class="inp ph" style="width:150px">Filter ticker…</span>
            ${["All","A+","A","B","C","D","F"].map((c,i)=>pill(c,i===0?"cy":"mt")).join("")}
            <span class="mut" style="font-size:11px">21 A+ · 44 A · 52 B · 31 C · 14 D · 7 F</span>
            <span class="sp" style="flex:1"></span><span class="mono mut" style="font-size:11px">6 / 169</span></div>` + rows);
  }

  if(tab === "Sessions"){
    const tiles = [["average over 60 sessions","78.4"],["average grade","B+"],["weighted points","24,180 / 30,420"],
      ["best session","A+ 94.2"],["worst session","D 41.8"],["mean setup","58.6"]];
    const rows = table(
      [{t:"Date"},{t:"Grade"},{t:"Score",n:1},{t:"Setup",n:1},{t:"Pts",n:1},{t:"Graded",n:1},{t:"Regime held",n:1},{t:"Calls hit",n:1},{t:"Regime split"},{t:"Spread"},{t:"Cap held",n:1},{t:"Floor held",n:1},{t:"Flip held",n:1},{t:"CB pinned",n:1}],
      D.gradeDays.map(d=>[
        `<span class="mono">${esc(d.date)}</span> <span class="mut" style="font-size:10px">${["Sat","Fri","Thu","Wed","Tue"][D.gradeDays.indexOf(d)]}</span>`,
        gradePill(d.grade), d.score.toFixed(1), (d.score*0.72).toFixed(1), `${Math.round(d.score*4.8)} / 507`,
        `${d.graded} / 169`, (d.held*100).toFixed(0)+"%", (d.calls*100).toFixed(0)+"%",
        `<span class="chips">${pill(Math.round(d.graded*0.6)+" +","gn")}${pill(Math.round(d.graded*0.3)+" −","rd")}${pill(Math.round(d.graded*0.1)+" flip","gd")}</span>`,
        `<span class="chips">${pill("21 A+","gn")}${pill("44 A","gn")}${pill("52 B","cy")}</span>`,
        `48 / 66`, `39 / 58`, (d.held*100).toFixed(0)+"%", "62%"]));
    return head
      + `<div class="chips"><span class="mut" style="font-size:11px">Window</span>
          ${["30","60","120","250"].map((w,i)=>pill(w,i===1?"cy":"mt")).join("")}
          <button class="btn2 sm">Refresh</button></div>`
      + `<div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">
          ${tiles.map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n" style="font-size:19px">${v}</div></div>`).join("")}</div>`
      + card("Session score over time",
          lineChart([{n:"score", v:[66,72,76,81,90,86,74,79,84,88,82,86], c:"var(--gold)", fill:1}], {h:150}))
      + card(null, rows);
  }

  /* Levels tab */
  const regimeTiles = [["+gex · walls absorb","104"],["−gex · breaks run","51"],["on the flip · chop","14"],
    ["mean setup score","62.1"],["fade calls","88"],["break calls","54"],["stand down","27"],["wall chasing price","19"]];
  const structTiles = [["on watchlist","169"],["graded","169"],["not graded","0"],["above flip","104"],
    ["below flip","65"],["within 0.5% of a level","41"],["outside floor/cap","12"]];
  const rows = table(
    [{t:"Ticker"},{t:"Regime"},{t:"Setup",n:1},{t:"Call"},{t:"Spot",n:1},{t:"Floor",n:1},{t:"Δ",n:1},{t:"Floor q"},{t:"CB",n:1},{t:"Cap",n:1},{t:"Δ",n:1},{t:"Cap q"},{t:"Flip",n:1},{t:"Δ",n:1},{t:"EM",n:1},{t:"Net GEX",n:1},{t:"State"}],
    D.grades.map(g=>{
      const spot = Math.round((g.cap+g.floor)/2);
      const q = (v,w)=>`<span class="chips"><span style="width:46px">${bar(v/100,"var(--cy)")}</span>
        <span class="mono" style="font-size:10px">${v}</span>
        ${w?`<span class="mut" style="font-size:9px;text-transform:uppercase">${w}</span>`:""}</span>`;
      return [`<b style="color:var(--cy);cursor:pointer">${esc(g.sym)}</b>`, regPill(g.reg),
        (g.score*0.72).toFixed(0),
        pill(g.call==="Fade the cap"?"fade first test":g.call==="Break runs"?"expect break":"stand down",
          g.call==="Fade the cap"?"cy":g.call==="Break runs"?"og":"gd"),
        `<b>${spot.toLocaleString()}</b>`, g.floor.toLocaleString(),
        `<span class="pos">+${((spot-g.floor)/spot*100).toFixed(2)}%</span>`, q(72,"held"),
        Math.round((g.flip+g.cap)/2).toLocaleString(), g.cap.toLocaleString(),
        `<span class="neg">−${((g.cap-spot)/spot*100).toFixed(2)}%</span>`, q(64,"firming"),
        g.flip.toLocaleString(), `<span class="pos">+${((spot-g.flip)/spot*100).toFixed(2)}%</span>`,
        "±1.28%", `<span class="${g.reg==="+GEX"?"pos":"neg"}">${g.reg==="+GEX"?"+4.12B":"−812M"}</span>`,
        `<span class="chips">${pill(g.reg==="+GEX"?"above flip":"below flip", g.reg==="+GEX"?"gn":"rd")}
          ${g.score<50?pill("near","gd"):""}</span>`];
    }));
  const legend = [["Read the regime first","+GEX means the walls absorb — fade the first test. −GEX means breaks run."],
    ["Setup","0–100. How much of the board lined up behind the call before the open."],
    ["Wall quality","Fill bar is 0–100. The word is stability: held, firming, chasing."],
    ["Call","What the board said to do, sealed before the open."],
    ["Cap / Floor","The published levels for the session. Δ is distance from spot."],
    ["Flip","Gamma flip. Above it dealers dampen; below, they amplify."],
    ["Click a ticker","Opens its full grade history, every session it was sealed for."]];
  return head
    + `<div class="tiles" style="grid-template-columns:repeat(8,minmax(0,1fr))">
        ${regimeTiles.map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n" style="font-size:18px">${v}</div></div>`).join("")}</div>`
    + `<div class="tiles" style="grid-template-columns:repeat(7,minmax(0,1fr))">
        ${structTiles.map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n" style="font-size:18px">${v}</div></div>`).join("")}</div>`
    + card(null, `<div class="chips" style="margin-bottom:12px">
          <span class="inp ph" style="width:150px">Filter ticker…</span>
          ${["All","Above flip","Below flip","Within 0.5%","Outside range","Not graded"].map((c,i)=>pill(c,i===0?"cy":"mt")).join("")}
          <span style="width:8px;border-left:1px solid var(--line);height:16px"></span>
          ${["+GEX","−GEX","On the flip","Fade calls","Break calls","Wall chasing"].map(c=>pill(c,"mt")).join("")}
          <span class="sp" style="flex:1"></span><span class="mono mut" style="font-size:11px">6 / 169</span></div>` + rows)
    + `<div class="grid3">${legend.map(([k,v])=>card(k, `<div class="cap">${v}</div>`, {tight:true})).join("")}</div>`;
};

/* ══════════════ ESTIMATED MOVE ══════════════ */
P.EstimatedMove = () => {
  const tab = tabOf("EstimatedMove","Estimated Moves");
  const titles = { "Estimated Moves":["Estimated Moves","Weekly"],
    "No Short No Long Zones":["No Short No Long Zones","Last Week OHLC"],
    "EM Tracker":["EM Tracker","Win / Loss Record"],
    "Iron Condors":["Iron Condors","Weekly Condor Record"] };
  const [vt, st] = titles[tab];

  const dock = `<div class="chips" style="padding:10px 14px;border:1px solid var(--line);border-radius:14px;
      background:var(--panelBg);backdrop-filter:blur(16px)">
    ${tabs("EstimatedMove",["Estimated Moves","No Short No Long Zones","EM Tracker","Iron Condors"],tab)}
    <span style="color:var(--cy);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${vt}</span>
    <span class="mut" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">${st}</span>
    ${tab==="Estimated Moves"?`<span class="mut" style="font-size:11px">9/12</span>
      <span style="color:#7ab8ff;font-size:11px">Source: Weekly publish — Sat Sep 6, 9:00 AM ET</span>
      <span class="mut" style="font-size:11px">Exp</span><span class="inp" style="width:88px;padding:5px 8px;font-size:12px">Auto</span>`
      :tab==="No Short No Long Zones"?`<span class="mut" style="font-size:11px">Last Completed Week</span>`:""}
    <span class="sp" style="flex:1"></span>
    <span class="mut" style="font-size:11px">Published</span>
    <button class="btn2 sm">Refresh</button>
    ${tab==="Estimated Moves"?`<button class="btn2 sm">Compute Live</button>`:""}
    <button class="btn2 sm">Save</button><button class="btn2 sm">Export</button><button class="btn2 sm">Copy Shot</button></div>`;

  const sidebar = `<div style="width:230px;flex:0 0 230px">
    ${card(null, `<div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Last Sync</div>
      <div class="mono" style="font-size:13px;margin-top:3px">09:41:07 AM</div>
      <div class="chips" style="margin-top:12px"><span class="mut">&gt;</span>
        <span style="font-size:12px;font-weight:700">${tab==="No Short No Long Zones"?"Zones":"Weekly"}</span>
        <span class="mut" style="font-size:11px">3</span></div>
      <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin:16px 0 6px">Symbols</div>
      <div class="chips">${D.em.map(e=>pill(e.sym,"mt")).join("")}${["NDX","SMH","AAPL","MSFT","META","AMZN","GOOGL","AMD","COIN","MSTR","AVGO","NFLX"].map(s=>pill(s,"mt")).join("")}</div>`, {tight:true})}</div>`;

  if(tab === "Estimated Moves"){
    const rows = table([{t:"Ticker"},{t:"Close",n:1},{t:"Exp"},{t:"EM",n:1},{t:"Up",n:1},{t:"Down",n:1}],
      D.em.map(e=>[`<b>${esc(e.sym)}</b>`, e.close.toLocaleString(undefined,{minimumFractionDigits:2}),
        `<span class="mut">${esc(e.exp)}</span>`,
        `<span style="color:#e8c060">${e.em.toFixed(2)}</span>`,
        `<span class="pos">${e.up.toLocaleString(undefined,{minimumFractionDigits:2})}</span>`,
        `<span class="neg">${e.dn.toLocaleString(undefined,{minimumFractionDigits:2})}</span>`]));
    return dock + `<div style="display:flex;gap:clamp(16px,2vw,32px)">${sidebar}
      <div style="flex:1;min-width:0">${card("Weekly Estimated Move For 9/12", rows,
        { right:pill("CB CONF 78%","gn") })}</div></div>`;
  }

  if(tab === "No Short No Long Zones"){
    const rows = table([{t:"Ticker"},{t:"Close",n:1},{t:"Pivot",n:1},{t:"Range",n:1},{t:"No Long",n:1},{t:"No Short",n:1}],
      D.zones.map(z=>[`<b>${esc(z.sym)}</b>`, z.close.toLocaleString(undefined,{minimumFractionDigits:2}),
        z.pivot.toLocaleString(undefined,{minimumFractionDigits:2}), z.range.toFixed(2),
        `<span class="neg">${z.nolong.toLocaleString(undefined,{minimumFractionDigits:2})}<br>
          <span style="opacity:.65">${(z.nolong*1.006).toFixed(2)}</span></span>`,
        `<span class="pos">${z.noshort.toLocaleString(undefined,{minimumFractionDigits:2})}<br>
          <span style="opacity:.65">${(z.noshort*0.994).toFixed(2)}</span></span>`]));
    return dock + `<div style="display:flex;gap:clamp(16px,2vw,32px)">${sidebar}
      <div style="flex:1;min-width:0">${card("No Short / No Long Zones · Last Week Candle", rows)}</div></div>`;
  }

  if(tab === "EM Tracker"){
    const publish = card(null, `
      <div class="chips" style="margin-bottom:12px">
        <b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Levels Publish · /em feed</b>
        ${pill("Current","gn")}</div>
      <div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${[["Last Published","Sat Sep 6, 9:00 AM"],["EM Grabbed","20 / 20"],["Tickers","169"],["Schedule","Fri ~16:15 ET"]]
          .map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n sm">${v}</div></div>`).join("")}</div>
      <div class="chips" style="margin-top:12px"><button class="btn sm">Publish Now</button>
        <span style="color:var(--cy);font-size:12px;text-decoration:underline;cursor:pointer">View table →</span>
        <span class="sp" style="flex:1"></span>
        <span class="pos" style="font-size:11.5px">✓ Last run OK</span>
        <span class="mut" style="font-size:11.5px">EM 20/20 · 169 rows · in 148s</span></div>
      <div class="chips" style="margin-top:10px"><button class="btn2 sm">⧉ Copy Core EM</button>
        ${D.em.map(e=>pill(e.sym,"mt")).join("")}</div>`);
    const weekly = card(null, `
      <div class="chips" style="margin-bottom:10px"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Weekly Stats</b>
        <span class="mut" style="font-size:11.5px">Win / loss by week across all 169 scored tickers</span></div>
      <div style="border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px">
        <div class="mut" style="font-size:11px">This Week · Sep 1</div>
        <div style="font-size:26px;font-weight:800;margin:4px 0">75.0%</div>
        <div class="chips" style="font-size:11.5px"><span class="pos">6 WIN</span><span class="neg">2 LOSS</span>
          <span class="mut">8 SCORED</span></div></div>
      ${table([{t:"Week"},{t:"Win Rate",n:1},{t:"Win",n:1},{t:"Loss",n:1},{t:"Win/Scored",n:1}],
        D.emRecord.map(r=>[`<span class="mono">${esc(r.wk)}</span>`,
          `<span class="${r.rate>=0.7?"pos":""}">${(r.rate*100).toFixed(1)}%</span>`,
          r.hits, r.miss, `${r.hits}/${r.hits+r.miss}`]), {plain:true})}`);
    const perTicker = card(null, `
      <div class="chips" style="margin-bottom:10px">
        <span class="mut" style="font-size:11px">Scope</span>
        <span class="seg"><button class="on">All Tickers</button><button>Core Board</button></span>
        <span class="sp" style="flex:1"></span><span class="inp ph" style="width:150px">Filter ticker…</span></div>
      ${table([{t:"Ticker"},{t:"Hit Rate",n:1},{t:"Verified",n:1},{t:"Going-Fwd",n:1},{t:"Combined",n:1},{t:"Latest EM",n:1}],
        D.em.slice(0,6).map((e,i)=>[`<b>${esc(e.sym)}</b>`,
          `<span class="${74-i*3>=70?"pos":""}">${74-i*3}.0%</span>`,
          `${23-i}/31`, `${6-Math.floor(i/2)}/8`, `${29-i}/39`, e.em.toFixed(2)]), {plain:true})}
      <div class="cap" style="margin-top:10px">Win = weekly close inside the band [down, up]. Δ Edge = distance from the nearer band edge (green = cushion inside, red = how far it broke out). Breach = the weekday price first left the band that week ("no" = held all week, "—" = not yet scored).</div>`);
    return dock + publish + `<div class="grid2">${weekly}${perTicker}</div>`;
  }

  /* Iron Condors */
  const grid = table(
    [{t:"Ticker"},{t:"Bull Put — long / short"},{t:"Bear Call — short / long"},{t:"Credit put / call"},{t:"Qty",n:1},{t:"Risk & breakevens"},{t:"Week Mon→Fri"},{t:"Result"}],
    [["SPX",6300,6330,6490,6520,"1.85","2.10",1,"width 30/30 · credit 3.95 · max +$395 / −$2,605 · ROC 15.2%","BE 6326.05 → 6493.95","+$395","FULL"],
     ["NDX",22600,22800,23600,23800,"12.40","14.10",1,"width 200/200 · credit 26.50 · max +$2,650 / −$17,350 · ROC 15.3%","BE 22773.50 → 23626.50","−$1,240","PART −"],
     ["SPY",628,631,647,650,"0.42","0.51",2,"width 3/3 · credit 0.93 · max +$186 / −$414 · ROC 44.9%","BE 630.07 → 647.93","+$186","FULL"]]
    .map(r=>[`<div>▸ <b>${r[0]}</b></div><div class="mut" style="font-size:10px">EM ${r[0]==="SPX"?"82":r[0]==="NDX"?"428":"8.3"}</div>`,
      `<span class="mono">${r[1]} / ${r[2]}</span>`, `<span class="mono">${r[3]} / ${r[4]}</span>`,
      `<span class="mono">${r[5]} / ${r[6]}</span>`, r[7],
      `<div class="mut" style="font-size:10.5px">${r[8]}</div><div class="mut" style="font-size:10.5px">${r[9]}</div>`,
      spark([10,22,38,52,64,72,80],"var(--ok)"),
      `<span class="chips"><b class="${r[10].startsWith("+")?"pos":"neg"}">${r[10]}</b>
        ${pill(r[11], r[11]==="FULL"?"gn":r[11]==="PART −"?"og":"rd")}</span>`]));
  return dock
    + card(null, `<div class="chips" style="margin-bottom:12px">
        <b style="color:var(--orange);font-size:13px">EM Iron Condors</b>
        <span class="mut" style="font-size:11.5px">Bull put spread + bear call spread written on the weekly EM band</span>
        <span class="sp" style="flex:1"></span>
        <span class="mut" style="font-size:11.5px">Overall 68.4% (13/19) · +$4,120</span>${pill("3 open","gd")}
        <button class="btn2 sm">Refresh Marks</button><button class="btn2 sm">Snapshot Now</button>
        <button class="btn2 sm">Settle Week</button></div>
      <div class="chips" style="margin-bottom:14px">
        ${[["Week (Mon)","2026-09-08"],["Wing (pts)","auto"],["Contracts","1"]].map(([l,v])=>
          `<div><div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">${l}</div>
            <div class="inp" style="width:120px;margin-top:4px;padding:6px 9px;font-size:12.5px">${v}</div></div>`).join("")}
        <button class="btn2 sm" style="align-self:flex-end">Seed From EM Band</button>
        <button class="btn2 sm" style="align-self:flex-end">Re-derive Strikes</button>
        <span class="sp" style="flex:1"></span>
        <span class="mut" style="font-size:11.5px;align-self:flex-end">Week Sep 8 · 3 condors</span></div>` + grid
      + `<div class="cap" style="margin-top:12px">Credits are in points per one condor (multiplier 100). Max loss = widest wing − credit, × contracts. A settled row is locked — hit ↺ to re-open it before editing. Settlement uses the weekly close stored on the matching EM Tracker row, so run Evaluate Now there first.</div>`)
    + `<div class="grid2">
        ${card(null, `<div class="chips" style="margin-bottom:10px"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Weekly Condor Record</b>
            <span class="mut" style="font-size:11.5px">Win / loss and realized P&amp;L by week</span></div>
          ${table([{t:"Week"},{t:"Win Rate",n:1},{t:"Win",n:1},{t:"Loss",n:1},{t:"Open",n:1},{t:"P&L",n:1}],
            [["2026-09-01",66.7,2,1,0,"+$1,240"],["2026-08-25",100.0,3,0,0,"+$2,180"],
             ["2026-08-18",33.3,1,2,0,"−$880"],["2026-08-11",66.7,2,1,0,"+$1,580"]]
            .map(r=>[`<span class="mono">${r[0]}</span>`,
              `<span class="${r[1]>=60?"pos":"neg"}">${r[1].toFixed(1)}%</span>`,r[2],r[3],r[4],
              `<span class="${r[5].startsWith("+")?"pos":"neg"}">${r[5]}</span>`]), {plain:true})}`)}
        ${card(null, `<div class="chips" style="margin-bottom:10px"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Per-ticker record</b></div>
          ${table([{t:"Ticker"},{t:"Win Rate",n:1},{t:"Win/Settled",n:1},{t:"Max Loss",n:1},{t:"Avg P&L",n:1},{t:"Total P&L",n:1}],
            [["SPX",75.0,"6/8","−$2,605","+$284","+$2,270"],["NDX",50.0,"3/6","−$17,350","−$180","−$1,080"],
             ["SPY",80.0,"4/5","−$414","+$186","+$930"]]
            .map(r=>[`<b>${r[0]}</b>`,`<span class="${r[1]>=60?"pos":"neg"}">${r[1].toFixed(1)}%</span>`,r[2],
              `<span class="neg">${r[3]}</span>`,
              `<span class="${r[4].startsWith("+")?"pos":"neg"}">${r[4]}</span>`,
              `<span class="${r[5].startsWith("+")?"pos":"neg"}">${r[5]}</span>`]), {plain:true})}
          <div class="cap" style="margin-top:10px">Cushion = distance from the weekly close to the nearer SHORT strike (green = finished inside both shorts for full credit, red = how far past). FULL = both spreads expired worthless. MAX − = price blew all the way through a wing.</div>`)}</div>`;
};

/* ══════════════ WATCHLISTS ══════════════ */
P.Watchlists = () => {
  const tab = tabOf("Watchlists","scanner");
  const r = D.rosters;
  const buckets = tab==="scanner" ? [["HOT",r.scanner.HOT,true,"fast lane"],["Core",r.scanner.Core,false,"the names that always sweep"],["Wide",r.scanner.Wide,false,"swept on the slow lane"]]
    : tab==="em" ? [["Weekly",r.em.Weekly,false,"the Estimated Moves board"]]
    : [["Watch",r.farcb.Watch,false,"customer-visible Far CB list"]];
  const overrides = tab==="scanner" ? 3 : 0;

  const group = ([label,syms,hot,note]) => `
    <div style="margin-bottom:20px">
      <div class="chips" style="margin-bottom:9px">
        <b style="font-size:13px;letter-spacing:.10em;text-transform:uppercase;color:var(--cy)">${label}</b>
        ${hot?`<span style="color:var(--orange);font-size:10px;font-weight:800;letter-spacing:.08em">HOT</span>`:""}
        <span class="mut" style="font-size:12px;font-weight:700">${syms.length}</span>
        <span class="mut" style="font-size:12px">· ${note}</span>
        <span class="sp" style="flex:1"></span>
        <span class="inp ph" style="width:132px;padding:5px 9px;font-size:12px">Add to ${label.toLowerCase()}…</span>
        <button class="btn2 sm">Add</button><button class="btn2 sm">Copy</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px">
        ${syms.map((s,i)=>{
          const ov = tab==="scanner" && (s==="MSTR"||s==="SOFI"||s==="RIOT");
          return `<span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;
            text-align:center;padding:6px 4px;border-radius:8px;cursor:pointer;
            border:1px solid ${ov?"rgba(255,183,3,.5)":"var(--line)"};
            background:${ov?"rgba(255,183,3,.09)":"var(--inset)"};color:${ov?"var(--gold)":"var(--tx)"}">${s}${ov?" ✎":""}</span>`;
        }).join("")}</div>
    </div>`;

  return `<div style="max-width:1240px;margin:0 auto;display:flex;flex-direction:column;gap:clamp(16px,2vw,32px)">
      <div>
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:800">Reference</div>
        <h1 style="margin:8px 0 8px;font-size:28px;font-weight:800">Watchlists</h1>
        <p class="cap" style="max-width:820px;font-size:12.5px">The <b style="color:var(--lblue)">CB Edge</b> lists are live and editable — an add or remove here writes a roster override and the recorders pick it up on their next sweep, no redeploy. The file in <code>server-v2/</code> stays the baseline; <b>Reset to file</b> drops every override and hands control back to it.<br>The <b style="color:var(--lblue)">Tastytrade</b> tabs are still a static snapshot captured 2026-07-14 — reference exports, nothing to edit.</p>
      </div>
      <div>
        <div class="mut" style="font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:6px">CB Edge — server-v2 (editable)</div>
        <div class="chips">${["scanner","em","far-cb"].map(t=>{
          const k = t==="far-cb"?"farcb":t;
          const n = k==="scanner"?34:k==="em"?20:8;
          const on = (tab===k)||(tab==="scanner"&&t==="scanner");
          return `<button class="btn2 sm" data-tab="${k}" data-tabpage="Watchlists"
            style="${on?'border-color:rgba(33,158,188,.6);color:#8fdcef;':''}text-transform:uppercase;letter-spacing:.06em">
            ${t} <span style="opacity:.65">${n}</span>${k==="scanner"&&overrides?` <span style="color:var(--gold)">✎${overrides}</span>`:""}</button>`;
        }).join("")}</div>
      </div>
      ${card(null, `<div class="chips" style="margin-bottom:12px">
          <div><div class="mut" style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Source</div>
            <div class="mono" style="font-size:13px;font-weight:700;color:var(--cy);margin-top:2px">server-v2/roster-store.js · ${tab}</div></div>
          <span style="color:var(--ok);font-size:11px;font-weight:800">● LIVE</span>
          <span class="sp" style="flex:1"></span>
          <button class="btn2 sm">Refresh</button>
          <button class="btn2 sm" style="color:var(--orange);border-color:rgba(251,133,1,.35)">Reset to file</button>
          <span class="inp ph" style="width:180px;padding:6px 9px;font-size:12.5px">Filter ticker…</span></div>
        <div class="mut" style="font-size:13px;margin-bottom:16px">Every ticker the ${tab} recorders sweep. An edit here writes an override row; the file baseline is untouched.</div>`
        + buckets.map(group).join("")
        + (overrides?`<div style="margin-top:6px">
            <div style="color:var(--orange);font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin-bottom:7px">Removed from the file baseline (2)</div>
            <div class="chips">${["INTC","BA"].map(s=>`<span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;
              color:var(--orange);border:1px dashed rgba(251,133,1,.5);border-radius:8px;padding:4px 9px;
              text-decoration:line-through">${s} ↺</span>`).join("")}</div></div>`:""))}
      ${card("Tastytrade public watchlists",
        `<p class="cap" style="margin:0 0 12px">Everything tastytrade exposes at <code style="color:var(--lblue)">GET /public-watchlists</code>. Highlighted names are captured in the tabs above. To pull another, hit <code style="color:var(--lblue)">/public-watchlists/{name}</code> with the name URL-encoded and the OAuth token as <code>Bearer</code>.</p>
         <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;font-size:12px">
           ${["Tom's Watchlist","High Options Volume","Crypto","Indices","Metals","Energy","Semiconductors",
              "Mega Cap Tech","Banks","Airlines","Biotech","Retail","China ADRs","Housing","Defense","Utilities"]
             .map((n,i)=>i<5
               ? `<span style="color:var(--ok);font-weight:700;background:rgba(31,217,138,.08);
                   border:1px solid rgba(31,217,138,.3);border-radius:7px;padding:5px 9px">✓ ${n}</span>`
               : `<span style="opacity:.6;padding:5px 9px">${n}</span>`).join("")}</div>`,
        { sub:"16 available · 5 captured above" })}
    </div>`;
};

/* ══════════════ CHART TYPES ══════════════ */
P.ChartsUI = () => {
  const fig = (t, svg, n) => `<figure style="margin:0;border:1px solid var(--line);border-radius:12px;padding:13px;background:var(--panelSolid)">
    ${svg}<figcaption style="margin-top:9px">
      <div style="font-size:11.5px;font-weight:800;letter-spacing:.10em;text-transform:uppercase">${t}</div>
      <div class="mut" style="font-size:10px;margin-top:2px">${n}</div></figcaption></figure>`;
  const grp = (h, items) => `<div style="margin-bottom:22px">
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.45;
      border-bottom:1px solid var(--line);padding-bottom:7px;margin-bottom:12px">${h}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">${items}</div></div>`;
  const L = (v,c,f) => lineChart([{n:"a",v,c,fill:f}],{w:240,h:78});
  const B = (rows,ca,cb) => barChart(rows,{w:240,h:88,ca,cb,la:"a",lb:"b"});
  const pie = `<svg viewBox="0 0 90 90" style="width:100%;height:78px">
    ${[[0,120,"var(--cy)"],[120,210,"var(--gold)"],[210,280,"var(--orange)"],[280,330,"#8ECAE6"],[330,360,"var(--purple)"]]
      .map(([a,b,c])=>{const r=34,cx=45,cy=45,x1=cx+r*Math.cos(a*Math.PI/180),y1=cy+r*Math.sin(a*Math.PI/180),
        x2=cx+r*Math.cos(b*Math.PI/180),y2=cy+r*Math.sin(b*Math.PI/180);
        return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${b-a>180?1:0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${c}" opacity=".8"/>`;}).join("")}</svg>`;
  const ring = `<svg viewBox="0 0 90 90" style="width:100%;height:78px">
    ${[[34,"var(--cy)",0.72],[26,"var(--gold)",0.48],[18,"var(--orange)",0.3]].map(([r,c,f])=>
      `<circle cx="45" cy="45" r="${r}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="6"/>
       <circle cx="45" cy="45" r="${r}" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"
         stroke-dasharray="${(2*Math.PI*r*f).toFixed(1)} 999" transform="rotate(-90 45 45)"/>`).join("")}</svg>`;
  const radar = `<svg viewBox="0 0 90 90" style="width:100%;height:78px">
    ${[34,25,16,8].map(r=>`<polygon points="${[0,72,144,216,288].map(a=>
      `${(45+r*Math.cos((a-90)*Math.PI/180)).toFixed(1)},${(45+r*Math.sin((a-90)*Math.PI/180)).toFixed(1)}`).join(" ")}"
      fill="none" stroke="rgba(255,255,255,.07)"/>`).join("")}
    <polygon points="${[30,22,32,14,26].map((r,i)=>{const a=i*72-90;
      return `${(45+r*Math.cos(a*Math.PI/180)).toFixed(1)},${(45+r*Math.sin(a*Math.PI/180)).toFixed(1)}`;}).join(" ")}"
      fill="var(--cy)" opacity=".28" stroke="var(--cy)" stroke-width="1.5"/></svg>`;
  const gaugeSvg = gauge("", "68%", 0.36, "var(--gold)");
  const sankey = `<svg viewBox="0 0 240 78" style="width:100%;height:78px">
    ${[[10,52,"var(--cy)"],[26,30,"var(--gold)"],[52,18,"var(--orange)"]].map(([y,h,c],i)=>
      `<rect x="8" y="${y}" width="10" height="${h}" fill="${c}" opacity=".8" rx="2"/>
       <path d="M18,${y+2} C110,${y+2} 130,${14+i*24} 222,${14+i*24} L222,${20+i*24} C130,${20+i*24} 110,${y+h-2} 18,${y+h-2} Z"
         fill="${c}" opacity=".18"/>
       <rect x="222" y="${12+i*24}" width="10" height="${10+i*2}" fill="${c}" opacity=".8" rx="2"/>`).join("")}</svg>`;
  const choro = `<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:3px;height:78px;align-content:center">
    ${Array.from({length:24},(_,i)=>`<div style="height:16px;border-radius:3px;
      background:rgba(33,158,188,${(0.1+((i*37)%9)/12).toFixed(2)})"></div>`).join("")}</div>`;
  const candles = `<svg viewBox="0 0 240 78" style="width:100%;height:78px">
    ${[[20,52,30,44,1],[42,44,22,36,1],[64,50,34,40,0],[86,38,18,28,1],[108,42,24,32,0],
       [130,34,14,24,1],[152,40,20,30,0],[174,30,10,20,1],[196,36,16,26,1],[218,28,8,18,1]]
      .map(([x,hi,lo,c,up])=>`<line x1="${x}" x2="${x}" y1="${hi}" y2="${lo}" stroke="${up?"var(--ok)":"var(--softred)"}" stroke-width="1"/>
        <rect x="${x-4}" y="${Math.min(c,c+8)}" width="8" height="8" fill="${up?"var(--ok)":"var(--softred)"}" opacity=".85" rx="1"/>`).join("")}</svg>`;

  return `<div style="max-width:1240px;margin:0 auto">${card(null, `
    <div class="phead" style="align-items:flex-end;margin-bottom:20px">
      <div><div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:var(--lblue)">Reference</div>
        <h1 style="margin:6px 0 6px;font-size:30px;font-weight:800">Chart types</h1>
        <p class="cap" style="max-width:620px;margin:0">Seventeen forms drawn in owner colours with fixed sample data. Static pictures — no library, no data, nothing to install. Use it to pick a shape before building the real thing.</p></div>
      <span class="sp"></span>
      <button class="btn2 sm" style="color:var(--cy);border-radius:10px">Wide view</button></div>

    ${grp("Time series",
      fig("Line", L([20,34,28,46,40,58,52,66],"var(--cy)",0), "One or more continuous series over time. The default for anything trending.")
      + fig("Area", L([20,34,28,46,40,58,52,66],"var(--cy)",1), "Same as a line but emphasises magnitude. Good for cumulative or stacked totals.")
      + fig("Composed", B([{m:"M",a:40,b:22},{m:"T",a:62,b:31},{m:"W",a:48,b:26},{m:"T",a:71,b:38},{m:"F",a:55,b:29}],"var(--cy)","var(--gold)"), "Bars and lines on one x-axis — volume under price, count against a rate.")
      + fig("Scatter", `<svg viewBox="0 0 240 78" style="width:100%;height:78px">${
          Array.from({length:26},(_,i)=>`<circle cx="${(i*37)%230+6}" cy="${(i*53)%64+7}" r="3" fill="var(--cy)" opacity=".65"/>`).join("")}</svg>`,
          "Discrete observations rather than a continuous path. Shows clustering and outliers.")
      + fig("Live line", L([30,32,31,36,34,39,37,42,40,46],"var(--ok)",0), "Streaming value with a sliding window and a pinned last price. Quotes, spot, P&L ticker.")
      + fig("Profit / loss", `<svg viewBox="0 0 240 78" style="width:100%;height:78px">
          <line x1="0" x2="240" y1="39" y2="39" stroke="rgba(255,255,255,.12)"/>
          ${[12,-8,20,-14,26,6,-4,18,-10,24].map((v,i)=>`<rect x="${i*24+6}" y="${v>0?39-v:39}" width="14"
            height="${Math.abs(v)}" fill="${v>0?"var(--ok)":"var(--softred)"}" opacity=".8" rx="2"/>`).join("")}</svg>`,
          "Signed series split at zero, green above and red below. Daily P&L, net delta.")
      + fig("Candlestick", candles, "OHLC bars. The only honest way to show price action at a glance."))}

    ${grp("Categorical",
      fig("Bar", B([{m:"A",a:40,b:22},{m:"B",a:62,b:31},{m:"C",a:48,b:26},{m:"D",a:71,b:38}],"var(--cy)","var(--purple)"),
        "Comparing discrete buckets. Grouped for two measures, stacked for composition.")
      + fig("Funnel", `<div style="height:78px;display:flex;flex-direction:column;justify-content:center;gap:4px">
          ${[100,72,48,26,12].map(w=>`<div style="height:11px;width:${w}%;margin:0 auto;border-radius:3px;
            background:var(--cy);opacity:${(w/130+.3).toFixed(2)}"></div>`).join("")}</div>`,
          "Stage-to-stage drop-off where order matters. Signup flow, trade lifecycle.")
      + fig("Heatmap", heat([["Mon",[2,4,7,9,6,3]],["Tue",[3,6,9,8,5,2]],["Wed",[1,3,5,8,9,6]],["Thu",[4,7,8,6,4,2]]]),
          "Intensity across two dimensions. Activity by day-of-week and hour, GEX by strike and expiry."))}

    ${grp("Radial",
      fig("Pie", pie, "Parts of a whole, five slices at most. Beyond that a bar chart reads better.")
      + fig("Ring", ring, "Several progress-toward-target values sharing a centre readout.")
      + fig("Gauge", gaugeSvg, "A single number against a range. Utilisation, capacity, percent of target.")
      + fig("Radar", radar, "Comparing a few entities across the same handful of metrics. Regime fingerprints.")
      + fig("Sunburst", ring, "Hierarchy where the rings sum to the whole. Revenue by segment then product."))}

    ${grp("Flow &amp; geo",
      fig("Sankey", sankey, "Weighted flow between stages. Where traffic — or capital — actually goes.")
      + fig("Choropleth", choro, "A value per region. Tile-grid form shown here; a real map works the same way."))}

    <div class="cap" style="opacity:.4">Drawn in src/pages/charts-ui/examples.tsx · sample numbers in data.ts</div>`)}</div>`;
};

/* ══════════════ LSE DATA ══════════════ */
P.LseData = () => {
  const tab = tabOf("LseData","Catalog");
  const HINT = { "Catalog":"every symbol the vault holds, with its history span",
    "Candles":"OHLCV for futures, stocks, FX, crypto, indices",
    "Options Chain":"current chain with IV, greeks and today's volume",
    "Options Flow":"the print tape — trailing week",
    "Contract Candles":"1m premium bars for one option contract" };
  const field = (l,v,hint,w) => `<div><div class="mut" style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">${l}</div>
    <div class="inp${v?"":" ph"}" style="width:${w||150}px;margin-top:4px;padding:7px 10px;font-size:12.5px">${v||"—"}</div>
    ${hint?`<div class="mut" style="font-size:11px;margin-top:3px">${hint}</div>`:""}</div>`;

  const FIELDS = {
    "Catalog":[["Dataset","All datasets","",200],["Search","NQ, apple, BTC…","symbol or company name",220]],
    "Candles":[["Symbol","NQ","pick from the catalog",165],["Timeframe","1m","",120],
      ["Start","MAX","a date, MAX, or blank for 30d",165],["End","today","optional",165],
      ["Dataset","auto","pin the asset class",150],["Range","☐ Walk it all","one call caps at 5,000 bars",150]],
    "Options Chain":[["Underlying","SPY","ticker or company name",175],["Type","Both","",120],
      ["Expiry","any expiry","one date, optional",165],["Min DTE","","",110],["Max DTE","30","",110]],
    "Options Flow":[["Underlying","all names","blank sweeps the whole tape",175],["Type","Both","",120],
      ["Min premium","100000","",150],["Max DTE","","",110],["Start","earliest","optional",165],
      ["End","now","optional",165],["Range","☐ Walk it all","one call caps at 5,000 prints",150]],
    "Contract Candles":[["Ticker","AAPL","the option's underlying",165],["Expiry","2026-06-12","the contract's expiration",165],
      ["Strike","205","dollars, e.g. 205 or 205.5",120],["Type","Call","",110],
      ["Or paste an OSI","AAPL260612C00205000","splits itself into the fields left",225]],
  };

  const ROWS = {
    "Catalog": [[{t:"symbol"},{t:"name"},{t:"dataset"},{t:"first"},{t:"last"},{t:"rows",n:1}],
      [["ES","E-mini S&P 500","futures","2008-01-02","2026-09-05","24,180,411"],
       ["NQ","E-mini Nasdaq-100","futures","2008-01-02","2026-09-05","23,914,006"],
       ["SPX","S&P 500 Index","indices","2004-01-02","2026-09-05","18,204,880"],
       ["SPXW","SPX Weeklys","options","2019-06-03","2026-09-05","1,204,880,102"],
       ["SPY","SPDR S&P 500 ETF","stocks","2004-01-02","2026-09-05","31,880,204"],
       ["BTCUSD","Bitcoin / USD","crypto","2014-09-17","2026-09-05","9,214,660"]]],
    "Candles": [[{t:"ts"},{t:"open",n:1},{t:"high",n:1},{t:"low",n:1},{t:"close",n:1},{t:"volume",n:1}],
      [["2026-09-05 15:59:00","23238.25","23244.00","23236.50","23241.50","1,204"],
       ["2026-09-05 15:58:00","23234.75","23239.25","23232.00","23238.25","988"],
       ["2026-09-05 15:57:00","23231.00","23236.00","23229.50","23234.75","1,441"],
       ["2026-09-05 15:56:00","23228.50","23233.25","23226.00","23231.00","1,102"]]],
    "Options Chain": [[{t:"strike",n:1},{t:"type"},{t:"expiry"},{t:"bid",n:1},{t:"ask",n:1},{t:"iv",n:1},{t:"delta",n:1},{t:"gamma",n:1},{t:"volume",n:1}],
      [["640","call","2026-09-12","4.10","4.30","0.114","0.482","0.00412","18,204"],
       ["640","put","2026-09-12","3.80","4.00","0.121","-0.518","0.00388","14,880"],
       ["645","call","2026-09-12","1.85","2.00","0.118","0.288","0.00341","22,104"],
       ["635","put","2026-09-12","1.70","1.88","0.126","-0.271","0.00330","19,662"]]],
    "Options Flow": [[{t:"ts"},{t:"symbol"},{t:"strike",n:1},{t:"type"},{t:"size",n:1},{t:"price",n:1},{t:"premium",n:1},{t:"side"}],
      [["2026-09-05 14:41:22","SPY","645","call","1,200","2.00","240,000","ask"],
       ["2026-09-05 14:38:04","SPY","635","put","880","1.88","165,440","bid"],
       ["2026-09-05 14:31:55","QQQ","570","call","2,400","1.42","340,800","ask"],
       ["2026-09-05 14:22:10","SPY","640","put","1,010","4.00","404,000","mid"]]],
    "Contract Candles": [[{t:"ts"},{t:"open",n:1},{t:"high",n:1},{t:"low",n:1},{t:"close",n:1},{t:"volume",n:1}],
      [["2026-09-05 15:59:00","4.20","4.35","4.15","4.30","188"],
       ["2026-09-05 15:58:00","4.10","4.24","4.08","4.20","204"],
       ["2026-09-05 15:57:00","4.05","4.14","4.01","4.10","141"]]],
  };
  const [cols, rows] = ROWS[tab];

  return `<div><h1 style="margin:0;font-size:22px;font-weight:800">LSE Data</h1>
      <p class="mut" style="margin:4px 0 0;font-size:13px">London Strategic Edge vault — catalog, candles, option chains, flow and contract bars. Preview here, download the full pull as CSV.</p></div>
    <div class="chips">${tabs("LseData",["Catalog","Candles","Options Chain","Options Flow","Contract Candles"],tab)}</div>
    ${card(null, `<div class="mut" style="font-size:12.5px;margin-bottom:14px">${HINT[tab]}</div>
      <div class="chips" style="align-items:flex-start">
        ${FIELDS[tab].map(f=>field(f[0],f[1],f[2],f[3])).join("")}
        <span class="sp" style="flex:1"></span>
        <button class="btn2 sm" style="align-self:flex-end">Preview</button>
        <button class="btn sm" style="align-self:flex-end">Download CSV</button></div>
      ${tab==="Contract Candles"?`<div class="chips" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
        <span class="mut" style="font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">OSI ticker</span>
        <span class="mono" style="font-size:15px;font-weight:800;letter-spacing:.07em;color:var(--cy)">AAPL260612C00205000</span>
        <span class="mut" style="font-size:12px">AAPL · 2026-06-12 · $205 · call</span>
        <span class="sp" style="flex:1"></span><button class="btn2 sm">Copy</button></div>`:""}`)}
    ${card(null, `<div class="mut" style="font-size:12.5px;margin-bottom:12px">
        ${rows.length.toLocaleString()} rows · from 2026-09-05 · preview capped — use Download CSV for everything · showing the first 300</div>`
      + table(cols, rows.map(r=>r.map((c,i)=>cols[i].n?`<span class="mono">${c}</span>`:`<span class="${i===0?"mono":""}">${c}</span>`)), {plain:true}))}`;
};
