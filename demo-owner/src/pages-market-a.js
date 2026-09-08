/* ══════════════════════════════════════════════════════════════
   MARKET GROUP A — Results, Backtests, Greeks, ΔGEX Board
   Rebuilt against pages/Results.tsx, Backtests.tsx, Greeks.tsx,
   GexGrowth.tsx + components/RegimeMatrix.tsx, SkewCalculator.tsx
   ══════════════════════════════════════════════════════════════ */

/* ══════════════ RESULTS ══════════════ */
P.Results = () => {
  const tab = tabOf("Results","ICT Results");
  const strip = tabs("Results",["ICT Results","Fail Rate","Confidence","Contracts","Walls"],tab);

  if(tab === "Fail Rate"){
    return `<div class="phead"><span class="sp"></span>${strip}</div>`
      + card("Fail Rate", `<p style="margin:0;font-size:13px;opacity:.7;line-height:1.6">
        This tab is not yet available in the standalone app. It depends on the live ES candle stream
        (useEsCandles) and the fail-level engine (failLevels/computeStats), which haven't been ported.</p>`);
  }

  if(tab === "Confidence"){
    const range = tabOf("Results.conf","20d");
    const cps = [["9:45 CB",72,26,36,"6.4"],["10:30 CB",64,21,33,"7.9"],["12:00 CB",58,19,33,"9.1"]];
    const roll = `<div class="grid3">${cps.map(([l,pctv,h,n,avg])=>`
      <div class="card" style="margin:0">
        <div class="chips"><b style="font-size:13.5px">${l}</b><span class="sp" style="flex:1"></span>
          <span class="mut" style="font-size:11px">${n} days</span></div>
        <div style="font-size:26px;font-weight:800;margin-top:6px">${Math.round(h/n*100)}%</div>
        <div class="mut" style="font-size:11px">hit rate · ${h}/${n}</div>
        <div class="mut" style="font-size:11.5px;margin-top:6px">avg closest: ${avg} pt</div>
        <div class="chips" style="margin-top:8px">
          ${[["≤5pt",Math.round(h*0.5)],["≤10pt",Math.round(h*0.8)],["≤15pt",h]].map(([t,v])=>
            `<div style="flex:1;border:1px solid var(--line);border-radius:9px;padding:7px;text-align:center">
              <div class="mut" style="font-size:9.5px;letter-spacing:.1em">${t}</div>
              <div style="font-size:13px;font-weight:800">${Math.round(v/n*100)}%</div>
              <div class="mut" style="font-size:9.5px">${v}/${n}</div></div>`).join("")}</div></div>`).join("")}</div>`;
    const rows = table(
      [{t:"Date"},{t:"9:45 Strike",n:1},{t:"Closest",n:1},{t:"≤5"},{t:"10:30 Strike",n:1},{t:"Closest",n:1},{t:"≤5"},{t:"12:00 Strike",n:1},{t:"Closest",n:1},{t:"≤5"}],
      [["2026-09-05",6400,3.2,"✓",6410,7.1,"✗",6420,11.4,"✗"],
       ["2026-09-04",6380,1.8,"✓",6380,2.4,"✓",6390,4.9,"✓"],
       ["2026-09-03",6350,8.6,"✗",6360,5.5,"✗",6360,2.1,"✓"],
       ["2026-09-02",6340,0.9,"✓",6350,3.8,"✓",6350,6.2,"✗"]]
      .map(r=>[`<span class="mono mut">${r[0]}</span>`,r[1],r[2].toFixed(1),
        r[3]==="✓"?`<span class="pos">✓</span>`:`<span class="neg">✗</span>`,
        r[4],r[5].toFixed(1),r[6]==="✓"?`<span class="pos">✓</span>`:`<span class="neg">✗</span>`,
        r[7],r[8].toFixed(1),r[9]==="✓"?`<span class="pos">✓</span>`:`<span class="neg">✗</span>`]));
    return `<div class="phead"><div><h1>Confidence</h1>
        <div class="psub">CB - Core Bullseye at 9:45 / 10:30 / 12:00 · how close SPX got · hit = within 8 pts</div></div>
        <span class="sp"></span>${strip}${tabs("Results.conf",["7d","20d","All"],range)}</div>`
      + roll + card(null, rows);
  }

  if(tab === "Contracts"){
    const range = tabOf("Results.tr","20d");
    const roll = `<div class="grid3">${[["9:45",11,14,7],["10:30",8,14,4],["12:00",6,13,3]].map(([l,tr,pr,w])=>`
      <div class="card" style="margin:0">
        <div class="chips"><b style="font-size:13.5px">${l}</b><span class="sp" style="flex:1"></span>
          <span class="mut" style="font-size:11px">${tr}/${pr} taken</span></div>
        <div style="font-size:26px;font-weight:800;margin-top:6px">${Math.round(w/tr*100)}%</div>
        <div class="mut" style="font-size:11px">win rate · ${w}/${tr}</div>
        ${[["Traded up",`${Math.round(tr*0.7)}/${tr}`],["Avg peak","+0.42"],["Avg P&L","+0.18"],["Total","+$1,240"]]
          .map(([k,v])=>`<div class="kv"><span class="k">${k}</span><b class="mono">${v}</b></div>`).join("")}</div>`).join("")}</div>`;
    const rows = table([{t:"Date"},{t:"Time"},{t:"Contract"},{t:"Entry",n:1},{t:"Peak",n:1},{t:"P/L",n:1}],
      D.trades.map(t=>[`<span class="mono mut">${esc(t.d)}</span>`,`<span class="mut">${esc(t.t)}</span>`,
        `<span class="mono">${esc(t.c.split(" ")[1])}</span> <span class="mut" style="font-size:10px">←CB ${(parseInt(t.c.match(/\d{4}/))||6400)-10}</span>`,
        t.skip?`<span class="mut">($2.40)</span>`:`$${t.e.toFixed(2)}`,
        t.p?`$${t.p.toFixed(2)} <span class="mut" style="font-size:10px">10:12 AM</span>`:"—",
        t.skip?`<span class="mut">—</span>`:`<span class="${t.pl>=0?"pos":"neg"}">${t.pl>=0?"+":""}${(t.pl/100).toFixed(2)}</span>
          <span class="mut" style="font-size:10px">${t.pl>=0?"+":"−"}$${Math.abs(t.pl)}</span>`]));
    return `<div class="phead"><div><h1>Contracts</h1>
        <div class="psub">0DTE probed on TastyTrade at 9:45 / 10:30 / 12:00 · from the CB, walk toward the money to the first strike over $1.00 · held and re-priced every minute to the bell · ×100</div></div>
        <span class="sp"></span>${strip}
        <button class="btn2 sm">Skipped on</button>${tabs("Results.tr",["7d","20d","All"],range)}</div>`
      + card(null, `<div class="chips"><button class="btn2 sm">Run now</button><button class="btn2 sm">Diagnose</button>
          <span class="mut" style="font-size:11.5px">14 opened · 14 priced · 0 probe errors</span></div>`, {tight:true})
      + roll
      + card(null, rows + `<div class="chips" style="margin-top:12px;font-size:11px">
          <span class="mut">41 checkpoints probed · 25 traded · 0 open</span>
          <span class="mut">64% win rate (16/25)</span><span class="pos">net +$1,240</span>
          <span class="sp" style="flex:1"></span>
          <span class="mut">←CB marks a walked strike · held to the bell, no exit rule · * unrealized</span></div>`);
  }

  if(tab === "Walls"){
    const tiles = [["Tickers tracked","169","scanner universe"],["Level changes","412","27 capture slots"],
      ["Levels hit","88","52% of tracked"],["Rejects","41","47% of hits"],["Breaks","32","9 consolidated"],
      ["Rows written","2,104","vs 13,689 if unfiltered"],["In play now","12","levels inside 0.60× ATR"],
      ["Median dist","0.34×","ATR to nearest level"]];
    const ladder = [["Sitting on price","0.00 – 0.15× ATR",81,"1,204",41,3],
      ["A short walk","0.15 – 0.45× ATR",62,"2,880",58,4],
      ["A solid move","0.45 – 0.90× ATR",44,"3,412",42,2],
      ["Across the map","0.90 – 1.80× ATR",22,"2,904",21,1],
      ["Off in the distance","> 1.80× ATR",8,"2,004",7,1]];
    const uni = table([{t:"#"},{t:"Ticker"},{t:"Spot",n:1},{t:"Put Wall",n:1},{t:"CORE",n:1},{t:"Call Wall",n:1},{t:"Nearest"},{t:"×ATR",n:1},{t:"Reach",n:1},{t:"Chg",n:1},{t:"Last event"},{t:"Reaction"}],
      D.walls.map((w,i)=>[i+1,`<b>${esc(w.sym)}</b>`,w.spot.toLocaleString(),w.put,w.core,w.call,
        `<span class="mut">${w.near===w.call?"Call Wall":w.near===w.put?"Put Wall":"CORE"}</span>`,
        w.reach.toFixed(2)+"×",`${60-i*7}%`,3-Math.floor(i/2),
        `<span class="mut">11:00 CORE ${w.core}</span>`,
        pill(w.react==="rejected"?"Reject":w.react==="broke"?"Break +5":w.react==="pinned"?"Pinned":"New wall",
          w.react==="rejected"?"gn":w.react==="broke"?"rd":"gd")]));
    return `<div class="phead"><span class="sp"></span>${strip}</div>`
      + card("Walls", `<div class="chips">
          <span class="inp" style="width:150px">2026-09-08</span>
          <span class="inp ph" style="width:150px">Filter ticker…</span>
          ${["all","changed","hit","Untested"].map((c,i)=>pill(c,i===0?"cy":"mt")).join("")}
          <span class="sp" style="flex:1"></span><button class="refresh">↻ Refresh</button></div>`,
        { sub:"Call wall · put wall · CORE across the scanner universe — 09:29 open + every 15m to 16:00 ET, change-only" })
      + `<div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
          ${tiles.map(([l,v,s])=>`<div class="tile"><div class="l">${l}</div>
            <div class="n" style="font-size:20px">${v}</div><div class="d">${s}</div></div>`).join("")}</div>`
      + card("Reach ladder — how often price actually gets there",
          `<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px">
            ${ladder.map(([l,r,p,n,rand,d])=>`<div style="border:1px solid var(--line);border-radius:12px;padding:12px">
              <div style="font-size:12px;font-weight:700">${l}</div>
              <div class="mut" style="font-size:10.5px">${r}</div>
              <div style="font-size:24px;font-weight:800;margin:6px 0 4px">${p}%</div>
              ${bar(p/100,"var(--gold)")}
              <div class="mut" style="font-size:10px;margin-top:6px">n ${n} · rand ${rand}% · Δ +${d}</div></div>`).join("")}</div>
          <div class="cap" style="margin-top:14px"><b>rand</b> = a synthetic level drawn from the same bucket, same side, same session — same travel requirement, no dealer positioning behind it. Across every bucket the real wall and the synthetic level reach at the same rate (max Δ 2pts). <b>The wall is not what holds — the distance is.</b> Reach Rank therefore scores distance only; the level type is shown for context and never weighted.</div>`,
          { right:`<span class="mut" style="font-size:11px">out-of-sample · fitted through 2026-09-05 · n 12,404</span>` })
      + `<div style="display:grid;grid-template-columns:1.6fr 1fr;gap:clamp(16px,2vw,32px)">
          ${card("Universe — 2026-09-08", uni, { right:`<span class="mut" style="font-size:11px">4 of 169 shown</span>` })}
          <div style="display:flex;flex-direction:column;gap:clamp(16px,2vw,32px)">
            ${card("Alerts", [["09:47","SPX","Call Wall 6450","12.4 pts above · spot 6437.60 · tested 2× · last reject","0.18×"],
                ["10:12","NVDA","Put Wall 172","1.8 pts below · spot 173.80 · tested 1× · last break","0.21×"]]
              .map(a=>`<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.045)">
                <div class="chips" style="font-size:11.5px"><span class="mono mut">${a[0]}</span><b>${a[1]}</b>
                  ${pill(a[2],"cy")}<span class="sp" style="flex:1"></span><span class="mono">${a[4]}</span></div>
                <div class="mut" style="font-size:11px;margin-top:3px">${a[3]}</div></div>`).join(""),
              { right:`<span class="mut" style="font-size:11px">inside 0.25× ATR &amp; closing</span>` })}
            ${card("In play", [["SPX","Call Wall 6450","↘ closing","12.4 pts above · 0.18× ATR · tested 2× · last reject · GEX +1.2B","0.18×"],
                ["SPY","Put Wall 628","↗ backing off","11.1 pts below · 0.42× ATR · tested 1× · last break · GEX −340M","0.42×"]]
              .map(a=>`<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.045)">
                <div class="chips" style="font-size:11.5px"><b>${a[0]}</b>${pill(a[1],"cy")}${pill("Live","gn")}
                  <span class="mut">${a[2]}</span><span class="sp" style="flex:1"></span>
                  <span class="mono">${a[4]}</span><span class="mut" style="font-size:10px">away</span></div>
                <div class="mut" style="font-size:11px;margin-top:3px">${a[3]}</div></div>`).join("")
              + `<div class="cap" style="margin-top:10px">Distance only. Alerts fire once per level when it comes inside <b>0.25× ATR while closing</b>. Tests and reactions are this session's history — not a call on whether the level holds.</div>`,
              { right:`<button class="btn2 sm">On price only</button>` })}
          </div></div>`;
  }

  /* ICT Results (default) */
  const share = `<div style="background:#080b11;border:1px solid var(--lineStrong);border-radius:14px;padding:18px">
    <div class="chips"><b style="font-size:12px;letter-spacing:.16em">CB EDGE</b>
      <span class="sp" style="flex:1"></span>
      <span style="font-size:12px;letter-spacing:.1em;color:var(--cy);font-weight:800">ICT Setup Results</span></div>
    <div class="mut" style="font-size:11px;margin-top:4px">Auto-graded on 5-minute follow-through — every setup logged, no cherry-picking</div>
    <div class="grid3" style="margin-top:16px;gap:0">
      ${[["Today",64,"9W · 5L · 2C","+0.71R avg","16 logged"],
         ["Last 7 Days",61,"41W · 26L · 11C","+0.62R avg","78 logged"],
         ["All-Time",59,"171W · 95L · 38C","+0.58R avg","304 logged"]]
        .map(([l,p,wl,r,n],i)=>`<div style="text-align:center;padding:0 14px;${i?'border-left:1px solid rgba(255,255,255,.08)':''}">
          <div class="mut" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase">${l}</div>
          <div style="font-size:28px;font-weight:800;margin-top:4px">${p}%</div>
          <div class="mut" style="font-size:11px">${wl}</div>
          <div class="pos" style="font-size:11px">${r}</div>
          <div class="mut" style="font-size:10.5px">${n}</div></div>`).join("")}</div>
    <div class="chips" style="margin-top:16px;font-size:10px;opacity:.4">
      <span>cbedge.net</span><span class="sp" style="flex:1"></span><span>2026-09-08</span></div></div>`;

  const cards = `<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px">
    ${D.setups.map(s=>{
      const g = s.w+s.l, wr = s.w/g;
      return `<div class="card" style="margin:0;padding:14px 15px">
        <div class="chips"><b style="font-size:12.5px">${esc(s.name)}</b><span class="sp" style="flex:1"></span>
          <span class="mut" style="font-size:10px">${g+s.c} logged</span></div>
        <div style="font-size:26px;font-weight:800;margin-top:6px">${(wr*100).toFixed(0)}%</div>
        <div class="mut" style="font-size:10.5px">win rate · ${s.w}/${g}</div>
        ${bar(wr, wr>0.6?"var(--ok)":wr>0.5?"var(--gold)":"var(--softred)")}
        <div class="chips" style="margin-top:9px">${[["1R",78],["2R",44],["3R",21]].map(([t,v])=>
          `<div style="flex:1;border:1px solid var(--line);border-radius:8px;padding:5px;text-align:center">
            <div class="mut" style="font-size:9px;letter-spacing:.1em">${t}</div>
            <div style="font-size:12px;font-weight:800">${v}%</div></div>`).join("")}</div>
        <div style="margin-top:9px">
          ${[["Wins",s.w],["Losses",s.l],["Chop",s.c],["Live",1],["Avg max R","+"+s.r.toFixed(2)+"R"],["Avg MFE",s.mfe.toFixed(1)+" pt"]]
            .map(([k,v])=>`<div class="kv" style="padding:3px 0;font-size:11px"><span class="k">${k}</span><b>${v}</b></div>`).join("")}</div></div>`;
    }).join("")}</div>`;

  return `<div class="phead"><span class="sp"></span>${strip}</div>`
    + card(null, share, {tight:true})
    + `<div class="phead"><div><h1>ICT Results</h1>
        <div class="psub">Per-setup performance · auto-graded by follow-through</div></div>
        <span class="sp"></span>
        <span class="chips">${["Today","Last 7d","All-time"].map((r,i)=>pill(r,i===2?"cy":"mt")).join("")}</span></div>`
    + card(null, `<div class="chips"><b style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Overall</b>
        <b style="font-size:20px">59%</b>
        <span class="mut" style="font-size:11.5px">171W · 95L · 266 graded · 4 live · 304 total</span></div>`, {tight:true})
    + cards;
};

/* ══════════════ BACKTESTS ══════════════ */
P.Backtests = () => {
  const panel = (title, sub, controls, body, help) => card(title,
    `<div class="chips" style="margin-bottom:14px">
      ${controls.map(c=>`<div><div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">${c[0]}</div>
        <div class="inp" style="width:${c[2]||130}px;margin-top:4px;padding:7px 10px;font-size:12.5px">${c[1]}</div></div>`).join("")}
      <button class="btn sm" style="align-self:flex-end">Run</button></div>${body||""}
      ${help?`<details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;opacity:.6">▸ How to read this</summary>
        <div class="cap" style="margin-top:8px">${help}</div></details>`:""}`,
    { sub });

  const cbsize = table([{t:"size bucket"},{t:"n",n:1},{t:"touched",n:1},{t:"held",n:1}],
    [["top decile",412,"0.81","0.62"],["upper half",1840,"0.66","0.51"],
     ["lower half",1902,"0.48","0.39"],["bottom decile",388,"0.31","0.22"]]
    .map(r=>[r[0],r[1].toLocaleString(),r[2],r[3]]), {plain:true});
  const calib = table([{t:"predicted"},{t:"n",n:1},{t:"actual reach",n:1},{t:"actual hold",n:1}],
    [["reach · high",620,"0.78","0.61"],["reach · med",1204,"0.59","0.47"],["reach · low",840,"0.34","0.28"]]
    .map(r=>[r[0],r[1].toLocaleString(),r[2],r[3]]), {plain:true});
  const feed = [
    ["2026-09-05","MU","2000","+187%","3.4×","$4.2M → $12.1M","3.1% vs spot, call side","51% big-move next session (1.8× base, n=64)","hit"],
    ["2026-09-05","NVDA","190","+142%","2.9×","$18.4M → $44.6M","2.4% vs spot, call side","47% big-move next session (1.6× base, n=88)","miss"],
    ["2026-09-05","TSLA","340","+118%","2.4×","$6.1M → $13.3M","6.8% vs spot, call side","not enough past events",""],
  ];
  const feedRows = feed.map(f=>`
    <div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <div class="chips" style="font-size:12px"><span class="mono mut">[${f[0]}]</span>
        <b>${f[1]}</b><span>${f[2]} strike</span>
        ${f[1]==="TSLA"?pill("UNTESTED","gd"):""}</div>
      <div class="mut" style="font-size:11.5px;margin-top:2px">GEX grew ${f[3]}, way above normal (${f[4]} typical). ${f[5]}, ${f[6]}.</div>
      <div class="chips" style="font-size:11px;margin-top:5px">
        <b class="mono">${f[4]}</b><span style="flex:1;max-width:120px">${bar(parseFloat(f[4])/4,"var(--gold)")}</span>
        <span class="mut">History: ${f[7]}</span>
        ${f[8]?`<span class="sp" style="flex:1"></span><span class="${f[8]==="hit"?"pos":"neg"}">→ RESULT: ${f[8]==="hit"?"−1.42σ next session ✓ HIT":"+0.31σ next session ✗ miss"}</span>`:""}</div></div>`).join("");

  return phead("Backtests","Re-runnable edge studies over the live Postgres data. Owner-only.")
    + card(null, `<details><summary style="cursor:pointer;font-size:12.5px;opacity:.7">▸ About this page</summary>
        <div class="cap" style="margin-top:8px">Each panel runs server-side against the same tables the dashboard writes. Adjust the inputs and hit Run. Samples are still small — treat results as directional. Expand “Per-day detail” to see the underlying rows.</div></details>`, {tight:true})
    + panel("CB size → reach","Does a bigger CB level get touched / held more often?",
        [["strike tol (pt)","10",110]], cbsize)
    + panel("Confidence calibration","Predicted reach / hold / break vs what actually happened.",
        [], calib)
    + panel("Normalized GEX per strike","Live chain: |strike net GEX| / Σ|net GEX| × 100 for one ticker + expiration.",
        [["ticker","SPX",110],["expiration (YYYY-MM-DD)","2026-09-12",170]])
    + panel("GEX change — by ticker","Consolidates the very-strong GEX-change board into one row per ticker for a session.",
        [["date (blank = latest)","2026-09-05",160]],
        table([{t:"ticker"},{t:"$M abs",n:1},{t:"call %",n:1},{t:"slots",n:1},{t:"expiries",n:1},{t:"near exp",n:1}],
          [["NVDA","44.6",78,9,4,1],["MU","12.1",91,6,2,1],["TSLA","13.3",66,4,3,2],["SPX","104.2",52,14,6,2]]
          .map(r=>[`<b>${r[0]}</b>`,r[1],r[2],r[3],r[4],r[5]]), {plain:true}),
        `The recorder keeps the top-N “very strong” strikes every 30 minutes. One ticker shows up many times across slots and strikes — this collapses that into one row each.<br><br><b>$M abs</b> — total |Δ GEX| flagged for the day. Rank on this, not on the raw hit count.<br><b>call %</b> — share of that on the call / above-spot side. ≥70 reads as resistance building, ≤30 as support or downside protection, in between is two-sided.<br><b>slots</b> — distinct 30m windows it appeared in. High slots + high $M abs = persistent build; a single slot is a one-off and usually noise.`)
    + panel("GEX Watch","Strikes growing more than their ticker normally grows, at a cutoff the backtest earned rather than one anybody picked.",
        [["×normal (0 = auto)","0",120],["ticker (blank = all)","",130],["history (days)","180",120],
         ["big move (σ)","1",110],["run checks","☐",100]],
        `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin-bottom:8px">feed</div>${feedRows}
         <details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;opacity:.6">▸ Calibration &amp; diagnostics (3)</summary></details>`,
        `Hit Run. Read <b>feed</b>. That is the whole daily use.<br><br><b>×normal</b> — the strike's dollar change ÷ the trailing average of <i>that ticker's own biggest daily strike move</i>. 1.0 is an ordinary day's hottest strike; 3× is three times that. It is what puts a mid-cap and SPX on one scale.<br><b>Δ %</b> — the raw growth, measured only on strikes that already held real gamma.<br><b>⚠ OPEX SESSION</b> — on the third Friday the expiring tranche leaves the chain, so strikes collapse for calendar reasons.<br><br>In <b>calibration</b>, trust <b>lift (low)</b>, not <b>lift</b>. Raw lift almost always peaks at the most extreme cutoff simply because the tail has the fewest events. The lower bound is the worst case at 95% confidence.<br><br><b>track_record</b> is <b>forward-tested</b>: of the alerts the rule ACTUALLY fired, how many were followed by a move. Where the two disagree, the log wins.`);
};

/* ══════════════ GREEKS ══════════════ */
P.Greeks = () => {
  const g = D.greeks;
  const gauges = `<div class="gauges">
    ${gauge("GEX", g.GEX.v, g.GEX.pct, "var(--ok)")}
    ${gauge("DEX", g.DEX.v, g.DEX.pct, "var(--softred)")}
    ${gauge("CHEX", g.CHEX.v, g.CHEX.pct, "var(--ok)")}
    ${gauge("VEX", g.VEX.v, g.VEX.pct, "var(--softred)")}</div>`;

  const COLS = [["DEX↑ / CEX↑","Bullish & Late Bid"],["DEX↑ / CEX↓","Bullish w/ Late Fade"],
    ["DEX↓ / CEX↑","Bearish w/ Late Bid"],["DEX↓ / CEX↓","Bearish & Late Drag"]];
  const ROWS = [["GEX↑ / VEX↑","Stabilized Bull"],["GEX↑ / VEX↓","Suppressed Chop"],
    ["GEX↓ / VEX↑","Volatile Bull"],["GEX↓ / VEX↓","Volatile Bear"]];
  const CELLS = [
    ["Vanna-Charm Melt-Up","Afternoon Grind w/ Late Fade","Capped Bull Drift","Stabilized Trap"],
    ["Vol-Chop with EOD Lift","Vol-Dependent Chop","Orderly Retreat with Support","Managed Decline"],
    ["Explosive Rocket","Rocket with Late Pullback","Fake-Out Factory","Unstable Squeeze Trap"],
    ["Bearish Grind w/ Late Support","Accelerated Bleed","Doom Loop w/ EOD Cushion","Full Doom Cascade"]];
  const TONE = [["gn","gd","gd","gd"],["gd","gd","rd","rd"],["gn","gn","gd","rd"],["rd","rd","rd","rd"]];
  const LIVE = [0,1];
  const matrix = `<div style="overflow-x:auto"><div style="display:grid;grid-template-columns:118px repeat(4,minmax(120px,1fr));gap:5px;min-width:640px">
    <div style="font-size:9.5px;opacity:.4;line-height:1.4;align-self:end">GEX·VEX ↓<br>DEX·CEX →</div>
    ${COLS.map(([l,s])=>`<div style="text-align:center;padding-bottom:4px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.06em">${l}</div>
      <div class="mut" style="font-size:9px">${s}</div></div>`).join("")}
    ${ROWS.map(([rl,rs],r)=>`
      <div style="align-self:center"><div style="font-size:10px;font-weight:800;letter-spacing:.06em">${rl}</div>
        <div class="mut" style="font-size:9px">${rs}</div></div>
      ${CELLS[r].map((c,i)=>{
        const live = r===LIVE[0] && i===LIVE[1];
        const tone = {gn:"var(--ok)",gd:"var(--gold)",rd:"var(--softred)"}[TONE[r][i]];
        return `<div style="position:relative;border:1px solid ${live?"rgba(33,158,188,.55)":"var(--line)"};
          border-radius:10px;padding:9px 8px;background:${live?"rgba(33,158,188,.12)":"var(--inset)"};
          opacity:${live?1:(Math.abs(r-LIVE[0])+Math.abs(i-LIVE[1]))===1?.7:.34};min-height:64px">
          ${live?`<span style="position:absolute;top:5px;right:6px;font-size:8px;color:var(--cy);font-weight:800">● LIVE</span>`:""}
          <div style="font-size:10.5px;font-weight:700;color:${tone};line-height:1.3">${c}</div>
          <div class="chips" style="margin-top:6px;font-size:8.5px;opacity:.6">
            <span>DEX${r<2?"▲":"▼"}</span><span>CEX${i%2===0?"▲":"▼"}</span></div></div>`;
      }).join("")}`).join("")}
  </div></div>
  <div class="chips" style="margin-top:12px;font-size:10.5px;opacity:.5">
    ${["Live regime — glow border (current signs)","One Greek-flip away — dim tint","Green name = bullish bias",
       "Red name = bearish bias","Yellow name = mixed / chop"].map(l=>`<span>${l}</span>`).join(" · ")}</div>`;

  const vol = `<div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">
    ${[["VIX (30D)","14.8"],["VIX1D","11.2"],["10D Realized","9.4"],["IV Rank","28%"],["IV %ile","34%"],["VRP","5.4"]]
      .map(([l,v])=>`<div class="tile"><div class="l">${l}</div><div class="n" style="font-size:19px">${v}</div></div>`).join("")}</div>
    <div class="cap" style="margin-top:12px">Subdued IV — premium-selling friendly when gamma is positive (condors / flies).</div>`;

  const skew = `<div class="chips" style="margin-bottom:14px">
      ${[["OTM Put IV","18.4","25Δ / −5-10%"],["OTM Call IV","14.1","25Δ / +5-10%"],["ATM IV","15.2","spot IV"]]
        .map(([l,v,ph])=>`<div><div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">${l}</div>
          <div class="inp" style="width:130px;margin-top:4px;padding:7px 10px;font-size:12.5px">${v} <span class="mut">%</span></div>
          <div class="mut" style="font-size:9.5px;margin-top:3px">${ph}</div></div>`).join("")}
      <div style="border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-left:8px">
        <div class="mut" style="font-size:10px;letter-spacing:.1em;text-transform:uppercase">Skew</div>
        <div style="font-size:22px;font-weight:800;color:var(--gold)">+28.3%</div>
        <div class="mut" style="font-size:10.5px">+4.30 vol pts</div></div></div>
    ${table([{t:"Skew band"},{t:"If this"},{t:"Then that"}],
      [["Inverted / Call Skew","< 0%","Skew < 0% — OTM calls richer than OTM puts."],
       ["Flat / Complacent","0–10%","Skew 0–10% — unusually flat for equity index."],
       ["Normal Equity Skew","10–30%","Skew 10–30% — the typical equity-index regime."],
       ["Steep / Elevated Fear","30–45%","Skew 30–45% — puts materially bid."],
       ["Extreme / Panic Skew","> 45%","Skew > 45% — crash-fear pricing."]]
      .map((r,i)=>[i===2?`<b style="color:var(--cy)">${r[0]}</b>`:r[0],
        `<span class="mono mut">${r[1]}</span>`,`<span class="mut">${r[2]}</span>`]), {plain:true})}
    <div class="cap" style="margin-top:12px">Convention: positive skew = puts richer = downside fear. Keep the put/call legs at a consistent moneyness (25-delta, or a fixed ±5-10% from spot) so readings are comparable across sessions.</div>`;

  const flips = D.flips.map(f=>`
    <div class="chips" style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.045);font-size:12px">
      <span class="mono mut" style="width:74px">${f.t==="13:48"?"01:48 PM":f.t==="11:02"?"11:02 AM":"09:47 AM"}</span>
      <b style="width:40px">${f.w}</b>
      <span class="${f.d.includes("→ +")?"pos":"neg"}">${f.d.replace("−","−")}&nbsp;&nbsp;${f.note}</span></div>`).join("");

  return phead("Greeks","SPX dealer exposure · updated 15:41:07 ET",
      `<span class="seg"><button class="on">OI+Vol</button><button>Vol Only</button></span>
       <button class="btn2 sm" style="color:var(--ok);border-color:rgba(31,217,138,.4)">● DATA ON</button>
       <button class="refresh">↻ Refresh</button>`)
    + gauges
    + card("Options Flow Regime Canvas", matrix,
        { sub:"4-Greek matrix tracking Gamma (GEX), Vanna (VEX), Delta (DEX) and Charm (CEX). Each cell's name colour is its bias — green = bullish, red = bearish, yellow = mixed/chop. The live regime is glow-highlighted; cells one Greek-flip away are dimly lit.",
          right:`<span class="chips">${["GEX ↑","VEX ↑","DEX ↓","CEX ↓"].map((s,i)=>
            `<span class="pill ${i<2?"p-gn":"p-rd"}">${s}</span>`).join("")}</span>` })
    + `<div class="grid2">
        ${card("Volatility", vol, { sub:"VIX / Implied Vol", right:pill("IV FALLING ▼","gn") })}
        ${card("Zero-Line Crossings", flips, { sub:"GEX / DEX sign flips · 3 today",
          right:`<span class="chips"><span class="livedot"></span><span class="mut" style="font-size:11px">LIVE</span></span>` })}</div>`
    + card("Vol Skew Calculator", skew,
        { sub:"(OTM Put IV − OTM Call IV) / ATM IV",
          right:`<span class="mut" style="font-size:11px">LIVE SPX 0DTE</span><button class="btn2 sm">↻ Sync</button>` });
};

/* ══════════════ ΔGEX BOARD ══════════════ */
P.GexGrowth = () => {
  const mode = tabOf("GexGrowth","Δ 1 day");
  const sorts = mode==="Net GEX"
    ? ["Biggest gamma","Most positive","Most negative","Most structural"]
    : ["Biggest move","Most built","Most pulled","Most structural"];

  const controls = `<div class="chips" style="margin-bottom:14px">
    <span class="inp ph" style="width:150px">Filter symbol…</span>
    ${sorts.map((s,i)=>pill(s,i===0?"cy":"mt")).join("")}
    <span style="width:10px"></span>
    ${["OI + Vol","OI only","Volume only","Flow (signed)"].map((s,i)=>pill(s,i===0?"cy":"mt")).join("")}
    <span style="width:10px"></span>
    ${["Net","Split","Calls","Puts"].map((s,i)=>pill(s,i===0?"cy":"mt")).join("")}
    <span style="width:10px"></span>
    ${tabs("GexGrowth",["Net GEX","Δ 1 day","Prior → now"],mode)}
    <span class="inp" style="width:168px;padding:6px 9px;font-size:12px">Latest · 2026-09-05</span>
    ${["All","±5%","±3%"].map((s,i)=>pill(s,i===0?"cy":"mt")).join("")}
    <button class="btn2 sm">Open Card</button><button class="btn2 sm">Read</button>
    <button class="refresh">↻</button>
    <span class="sp" style="flex:1"></span>
    <span class="mut" style="font-size:11px">169 symbols · ${mode==="Net GEX"?"close 2026-09-05":"142 with a baseline"}</span></div>`;

  const caveat = `<div class="infobar" style="margin-bottom:14px">
    <div class="chips"><b style="font-size:12px">OI + Volume</b>
      <span class="mut">|γ| × (open interest + volume)</span>
      <span class="sp" style="flex:1"></span>
      <span class="mut" style="font-size:10.5px">run 2026-09-05 20:01:52 ET · overnight</span>
      ${pill("● good","gn")}</div>
    <div style="margin-top:6px;font-size:11.5px;opacity:.75">Δ double-counts a session: OI at 16:05 is settled through the PREVIOUS close, volume is today's, so the diff adds yesterday's net OI change and subtracts yesterday's gross volume. The LEVEL is sound and matches every other card in the app — the Δ is the part to distrust. Use OI-only for a real day-over-day.</div></div>`;

  const rail = D.gexBoard.map((b,i)=>`
    <div style="display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:9px;margin-bottom:3px;
      border:1px solid ${i===0?"var(--lineStrong)":"transparent"};background:${i===0?"var(--panelSolid)":"transparent"}">
      <b style="width:48px;font-size:12.5px">${esc(b.sym)}</b>
      <span style="flex:1;height:5px;border-radius:5px;background:${b.net.startsWith("+")?"var(--green)":"var(--softred)"};
        opacity:.55;max-width:${60+i*4}%"></span>
      ${i===1?pill("FLIP NEW","gd"):i===4?pill("3× FLIP","gd"):""}
      <span class="mono ${b.net.startsWith("+")?"pos":"neg"}" style="font-size:11.5px">${esc(b.net)}</span></div>`).join("");

  const openCard = `
    <div class="chips" style="margin-bottom:12px">
      <b style="font-size:11px;letter-spacing:.14em">OPEN CARD</b>
      ${pill("PROVISIONAL","gd")}<span class="mut" style="font-size:11px">OI + Volume</span>
      ${pill("OI ONLY IS THE MORNING BASIS","mt")}
      <span class="sp" style="flex:1"></span>
      <span class="mut" style="font-size:11px">ES offset</span>
      <span class="inp" style="width:74px;padding:5px 8px;font-size:12px">26.00</span>
      <button class="btn2 sm">copy</button></div>
    <div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px">
      ${[["CALL WALL","6450","ES 6476","+37.6 · +0.59%","heaviest +γ above spot"],
         ["GAMMA FLIP","6388","ES 6414","","regime boundary"],
         ["PUT WALL","6350","ES 6376","−62.4 · −0.97%","heaviest −γ below spot"],
         ["CUSHION","+24.4","","was +8.1","points from spot to the flip"],
         ["REGIME","POSITIVE","","strengthening","+4.12B"]]
        .map(([n,v,es,sub,note])=>`<div style="border:1px solid var(--line);border-radius:12px;padding:11px">
          <div class="mut" style="font-size:9.5px;letter-spacing:.13em">${n}</div>
          <div class="mono" style="font-size:19px;font-weight:800;margin-top:3px">${v}</div>
          ${es?`<div class="mut" style="font-size:10px">${es}</div>`:""}
          ${sub?`<div class="mut" style="font-size:10px;margin-top:2px">${sub}</div>`:""}
          <div class="mut" style="font-size:9.5px;margin-top:4px;opacity:.5">${note}</div></div>`).join("")}</div>
    <div class="chips" style="margin-top:12px">${pill("SPOT IN DAMPEN","gn")}
      <span class="mut" style="font-size:11.5px">Dealers are long gamma here — they buy weakness and sell strength. Moves COMPRESS.</span></div>`;

  const read = `<div class="grid3">
    ${card("Regime", `<div style="font-size:24px;font-weight:800" class="pos">+4.12B</div>
      <div style="font-size:12px;font-weight:700;margin-top:2px">POSITIVE · strengthening</div>
      <div class="mut" style="font-size:11.5px;margin-top:4px">Long gamma, and more of it than at the prior close — dampening got stronger.</div>
      <div class="kv" style="margin-top:8px"><span class="k">prior</span><b class="mono">+3.48B</b></div>
      <div class="kv"><span class="k">Δ book</span><b class="mono pos">+640M</b></div>
      <div class="kv"><span class="k">Δ / |GEX|</span><b class="mono">+4.2%</b></div>`, {tight:true})}
    ${card("Call wall · +0.59%", `<div class="chips">${pill("▲ building","gn")}</div>
      <div class="mono" style="font-size:22px;font-weight:800;margin-top:6px;color:var(--cy)">6450</div>
      <div class="mut" style="font-size:11.5px;margin-top:4px">+705M · was +610M · +95M · +15%</div>`, {tight:true})}
    ${card("Put wall · −0.97%", `<div class="chips">${pill("▲ deepening","rd")}</div>
      <div class="mono" style="font-size:22px;font-weight:800;margin-top:6px;color:var(--cy)">6350</div>
      <div class="mut" style="font-size:11.5px;margin-top:4px">−545M · was −480M · −65M · +14%</div>`, {tight:true})}
  </div>
  <div class="grid2" style="margin-top:16px">
    ${card("Gamma flip", `<div class="mono" style="font-size:22px;font-weight:800;color:var(--cy)">6388</div>
      <div class="mut" style="font-size:11.5px;margin-top:4px">was 6,380.2 · +7.8</div>
      <div class="mut" style="font-size:11.5px">spot +24.4 (was +8.10)</div>`, {tight:true})}
    ${card("Which leg moved · call vs put gamma", `
      <div class="kv"><span class="k">call leg</span><b class="mono pos">+2.84B (+420M)</b></div>
      <div class="kv"><span class="k">put leg</span><b class="mono neg">−1.02B (−220M)</b></div>
      <div class="mut" style="font-size:11.5px;margin-top:6px">Mostly the call leg — added, with the put leg the smaller half.</div>`, {tight:true})}
  </div>
  ${card("Structural range", `
    <div class="chips" style="margin-bottom:10px"><span class="mut" style="font-size:11.5px">spot sits in <b>DAMPEN</b></span>
      <span class="sp" style="flex:1"></span><b class="mono">6,350 — 6,450</b></div>
    <div style="display:flex;height:26px;border-radius:8px;overflow:hidden;border:1px solid var(--line)">
      <div style="flex:38;background:rgba(244,148,142,.18);display:grid;place-items:center;font-size:9.5px;letter-spacing:.12em">AMPLIFY</div>
      <div style="flex:62;background:rgba(31,217,138,.14);display:grid;place-items:center;font-size:9.5px;letter-spacing:.12em">DAMPEN</div></div>
    <div class="chips" style="margin-top:6px;font-size:10px;opacity:.5">
      <span>PUT SUPP 6350</span><span>FLIP 6388</span><span>★ HEAVIEST 6450</span><span>CALL WALL 6450</span></div>
    <div class="chips" style="margin-top:12px;font-size:11.5px">
      <span class="mut" style="letter-spacing:.1em;text-transform:uppercase;font-size:10px">GEX %</span>
      <span class="pos">+γ 62%</span><span class="mut">/</span><span class="neg">38% −γ</span>
      <span class="mut">call-dominant</span></div>
    <div style="display:flex;height:6px;border-radius:6px;overflow:hidden;margin-top:6px">
      <div style="flex:62;background:var(--green)"></div><div style="flex:38;background:var(--softred)"></div></div>`, {tight:true})}
  ${card("Biggest moves · ranked by |Δ|, share of book",
    [["6450","+0.59%","+610M → +705M","+95M","+2.3%","built"],
     ["6350","−0.97%","−480M → −545M","−65M","+1.6%","built"],
     ["6390","−0.35%","−150M → −210M","−60M","+1.5%","deepened"],
     ["6400","+0.19%","+340M → +388M","+48M","+1.2%","built"],
     ["6410","−0.03%","−80M → −64M","+16M","+0.4%","lifted"],
     ["6480","+1.06%","+210M → +240M","+30M","+0.7%","built"]]
    .map(r=>`<div class="chips" style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.045);font-size:11.5px">
      <b class="mono" style="width:52px;color:var(--cy)">${r[0]}</b>
      <span class="mut" style="width:60px">${r[1]}</span>
      <span class="mono" style="width:150px">${r[2]}</span>
      <span class="mono ${r[3].startsWith("+")?"pos":"neg"}" style="width:60px">${r[3]}</span>
      <span class="mut" style="width:56px">${r[4]}</span>
      <span class="sp" style="flex:1"></span>${pill(r[5],"mt")}</div>`).join(""), {tight:true})}`;

  const axis = mode==="Net GEX" ? "← negative · positive →"
    : mode==="Δ 1 day" ? "← removed · added →" : "← negative · positive →";

  return phead("ΔGEX Board", null)
    + `<div class="cap" style="margin-top:-8px;max-width:900px">Per-strike dealer gamma at the close, or what was built and taken off — whole board ex-0DTE, scanner watchlist. Recorded 16:05 ET with the open-interest half re-stamped from the settled file at 09:25, ~400 sessions on file. Pick a basis: what the number is made of decides what its Δ can honestly mean.</div>`
    + controls + caveat
    + `<div style="display:grid;grid-template-columns:268px 1fr;gap:clamp(16px,2vw,32px)">
        ${card("Symbols ranked by absolute ΔGEX", rail, {tight:true})}
        <div>
          ${card(null, `<div class="chips" style="margin-bottom:10px">
              <b style="font-size:15px">SPX</b>
              <span class="mut" style="font-size:11.5px">spot 6,412.40 · 2026-09-05 vs close 2026-09-04</span></div>`
            + openCard, {tight:true})}
          <div style="height:16px"></div>
          ${card("SPX · strike ladder",
            `<div class="chips" style="font-size:10px;opacity:.5;margin-bottom:6px">
              <span style="width:56px;text-align:right">Strike</span>
              <span class="sp" style="flex:1;text-align:center">${axis}</span>
              <span style="width:96px;text-align:right">${mode==="Net GEX"?"Net GEX":mode==="Δ 1 day"?"Δ 1D":"Δ vs close"} · net</span></div>`
            + ladder(D.ladder, 6410)
            + `<div class="cap" style="margin-top:10px">OI + Volume basis · net leg · whole board excl. 0DTE · ±40 strikes around the close · outline = prior close, fill = current close · the four chips sum to the net Δ · as of 2026-09-05</div>`,
            { right:`<span class="chips">${["+γ built","+γ pulled","−γ built","−γ pulled"].map((c,i)=>
                pill(c+" "+["+420M","−120M","−280M","+180M"][i], i%2?"mt":"cy")).join("")}</span>` })}
        </div></div>`
    + read;
};
