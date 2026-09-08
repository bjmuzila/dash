/* ══════════════════════════════════════════════════════════════
   CONTENT GROUP — rebuilt against the real pages, string for string.
   Sources: pages/Feedback.tsx, SocialMedia.tsx, PostStudio.tsx +
            studioHtml.ts, Changelog.tsx, Affiliates.tsx, Emails.tsx,
            MediaDump.tsx, BzilaAlerts.tsx
   ══════════════════════════════════════════════════════════════ */

/* ══════════════ FEEDBACK ══════════════ */
P.Feedback = () => {
  const filter = tabOf("Feedback","Open");
  const CAT = { Bug:"🐞 Bug", Idea:"💡 Idea", Note:"📝 Note", Other:"💬 Other" };
  const rows = D.feedback.filter(f => filter==="All" ? true : filter==="Open" ? f.open : !f.open);
  const list = rows.length ? rows.map((f,i)=>`
    <div style="padding:11px 12px;border-radius:11px;margin-bottom:6px;cursor:pointer;
      border:1px solid ${i===0?"var(--lineStrong)":"transparent"};background:${i===0?"var(--panelSolid)":"transparent"}">
      <div class="chips" style="margin-bottom:5px">
        <span style="font-size:11.5px">${esc(CAT[f.cat]||f.cat)}</span>
        <span class="mono mut" style="font-size:11px">${esc(f.email)}</span>
        ${f.open&&f.replies?`<span style="display:inline-grid;place-items:center;min-width:16px;height:16px;
          border-radius:8px;background:var(--cy);color:#04212a;font-size:9.5px;font-weight:800">${f.replies}</span>`:""}
        <span class="sp" style="flex:1"></span>
        ${pill(f.open?"Open":"Complete", f.open?"cy":"mt")}</div>
      <div style="font-size:12.5px;opacity:.85;line-height:1.4">${esc(f.msg)}</div>
      <div class="mut" style="font-size:10.5px;margin-top:5px">#${f.id} · ${f.replies} ${f.replies===1?"reply":"replies"} · ${esc(f.when)}</div>
    </div>`).join("")
    : `<div class="empty">${filter==="Open"?"Nothing open. Inbox zero.":"No tickets here."}</div>`;

  const bubble = (who, text, when, mine) => `
    <div style="align-self:${mine?"flex-end":"flex-start"};max-width:80%;
      background:${mine?"rgba(33,158,188,.14)":"var(--inset)"};
      border:1px solid ${mine?"rgba(33,158,188,.3)":"var(--line)"};
      border-radius:${mine?"12px 12px 4px 12px":"12px 12px 12px 4px"};padding:10px 13px;font-size:12.5px">
      ${esc(text)}<div class="mut" style="font-size:10px;margin-top:5px">${esc(who)} · ${esc(when)}</div></div>`;

  const thread = `
    <div style="font-size:13px;font-weight:800">#1042 · 🐞 Bug</div>
    <div class="mut" style="font-size:11px;margin-bottom:14px">j.ferreira@sample-mail.test · from /app/options-chain · opened yesterday</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${bubble("j.ferreira@sample-mail.test","Chain stops updating if I leave the tab for ~10 min and come back.","Sep 7, 8:12 AM",false)}
      ${bubble("CB Edge","That's the idle auto-shutoff on the market feed. Fix is in the next deploy — it'll reconnect on focus.","Sep 7, 9:04 AM",true)}
      ${bubble("j.ferreira@sample-mail.test","Perfect, thanks.","Sep 7, 9:22 AM",false)}
    </div>
    <div class="inp ph" style="margin-top:14px;min-height:64px">Reply to this customer…</div>
    <div class="chips" style="margin-top:10px"><button class="btn2 sm">Mark complete</button>
      <span class="sp" style="flex:1"></span><button class="btn sm">Send</button></div>`;

  return card("Customer feedback",
      `<div class="grid2">
        <div>${list}</div>
        <div>${thread}</div></div>`,
      { sub:"2 open · 1 needing a look",
        right:`${tabs("Feedback",["Open","Complete","All"],filter)}<button class="btn2 sm">↻ Refresh</button>` });
};

/* ══════════════ SOCIAL MEDIA ══════════════ */
P.SocialMedia = () => {
  const tab = tabOf("SocialMedia","Daily Levels");
  const head = `<div class="phead">
    <h1>Social Media</h1>${pill("Admin","gd")}
    <span class="mut" style="font-size:11.5px">Ticker</span>
    <span class="inp" style="width:88px;padding:6px 9px;font-size:12.5px">SPX</span>
    ${tabs("SocialMedia",["Probe","Day Posts","Daily Levels","Explainer Mockup"],tab)}
    <span class="chips" style="font-size:11.5px"><span class="livedot" style="display:inline-block;width:6px;height:6px;
      border-radius:50%;background:var(--cy)"></span><span class="mut">Loaded</span></span>
    <span class="sp"></span>
    <span class="mut" style="font-size:11.5px">9/8/2026</span>
    <button class="btn2 sm">↻ Refresh</button><button class="btn2 sm">◼ Stop data</button></div>`;

  if(tab === "Daily Levels"){
    const fields = [["SPX Spot","6412.40"],["SPX Prior Close","6398.20"],["Gamma Flip","6388"],["Net GEX","+4.12B"],
      ["Call Wall","6450"],["Put Wall","6350"]];
    const ladder = [["Call wall",6450,"var(--softred)"],["Gamma flip",6388,"var(--gold)"],
      ["Spot",6412,"#fff"],["Put wall",6350,"var(--ok)"]];
    const left = `
      <div style="border:1px solid rgba(31,217,138,.3);background:rgba(31,217,138,.07);border-radius:12px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:var(--ok)">POSITIVE GAMMA</div>
        <div class="mut" style="font-size:11.5px;margin-top:3px">Net GEX positive · spot over the flip — dealers dampen moves, fade extremes.</div></div>
      ${ladder.map(([l,v,c])=>`<div class="chips" style="padding:4px 0;font-size:11.5px">
        <span class="mut" style="width:74px">${l}</span>
        <span style="flex:1;height:5px;border-radius:5px;background:${c};opacity:.5"></span>
        <b class="mono">${v.toLocaleString()}</b></div>`).join("")}
      <div class="grid2" style="gap:10px;margin-top:14px">
        ${fields.map(([l,v])=>`<div><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">${l}</div>
          <div class="inp" style="padding:7px 10px;font-size:13px;margin-top:4px">${v}</div></div>`).join("")}</div>
      <div style="margin-top:12px"><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Expected Move ±</div>
        <div class="chips" style="margin-top:5px;font-size:12px">
          <span class="pos">6330</span><span class="mut">Close 6398.20 · ±1.28%</span><span class="neg">6494</span></div></div>
      <div style="margin-top:12px"><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">ES Overnight (H / L)</div>
        <div class="inp" style="padding:7px 10px;font-size:13px;margin-top:4px">6444 / 6428</div></div>
      <div style="margin-top:12px"><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Bias · from Greeks flow regime</div>
        <div class="inp" style="padding:7px 10px;font-size:12.5px;margin-top:4px;min-height:46px">Dealers long gamma into the open — fade the extremes back toward 6400 unless 6388 fails.</div>
        <div class="mut" style="font-size:10px;margin-top:4px">pre-filled from options-flow regime — edit on event days</div></div>
      <div style="margin-top:18px">
        <div class="chips" style="font-size:11px"><b>SPX · all stats</b><span class="sp" style="flex:1"></span>
          <span class="mut">live feed</span></div>
        <div class="grid2" style="gap:6px 14px;margin-top:8px">
          ${[["Core Bullseye","6400","scanner sweep"],["Prior day H","6421","Sep 5"],["Prior day L","6371","Sep 5"],
             ["Prior week H","6448",""],["Prior week L","6302",""],["Pivot","6396","published levels"],
             ["Published EM","±82","09/12"],["EM up / down","6494 / 6330",""],
             ["No-short zone","6314 → 6280",""],["No-long zone","6478 → 6512",""]]
            .map(([k,v,h])=>`<div class="kv"><span class="k">${k}${h?` <span style="opacity:.6">${h}</span>`:""}</span><b class="mono">${v}</b></div>`).join("")}</div></div>`;

    const shareCard = `
      <div style="background:#080b11;border:1px solid var(--lineStrong);border-radius:14px;padding:18px">
        <div class="chips"><b style="font-size:15px">SPX</b>
          <span style="font-size:10px;letter-spacing:.16em;color:var(--cy);font-weight:800">DAILY LEVELS</span>
          <span class="sp" style="flex:1"></span><span class="mut" style="font-size:10px">Updated Sep 8, 9:41 AM</span></div>
        <div style="font-size:10px;letter-spacing:.14em;color:var(--gold);font-weight:800;margin:16px 0 8px">ESTIMATED MOVE</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          ${[["CLOSE","6398"],["EM","±1.28%"],["UP","6494"],["DOWN","6330"]].map(([l,v])=>
            `<div style="background:var(--inset);border-radius:9px;padding:9px;text-align:center">
              <div class="mut" style="font-size:9px;letter-spacing:.12em">${l}</div>
              <div class="mono" style="font-size:15px;font-weight:800;margin-top:3px">${v}</div></div>`).join("")}</div>
        <div style="margin-top:16px;padding:11px;border-radius:10px;background:rgba(31,217,138,.07);border:1px solid rgba(31,217,138,.25)">
          <div style="font-size:11px;font-weight:800;letter-spacing:.1em;color:var(--ok)">POSITIVE GAMMA</div>
          <div class="mut" style="font-size:10.5px;margin-top:2px">Net GEX positive · spot over the flip — dealers dampen moves, fade extremes.</div></div>
        <div class="grid2" style="gap:12px;margin-top:14px">
          <div><div style="font-size:9px;letter-spacing:.14em;color:var(--softred);font-weight:800">UPSIDE / RESISTANCE</div>
            <div class="kv" style="margin-top:5px"><span class="k">CALL WALL</span><b class="mono">6450</b></div>
            <div class="kv"><span class="k">GAMMA FLIP</span><b class="mono">6388</b></div></div>
          <div><div style="font-size:9px;letter-spacing:.14em;color:var(--ok);font-weight:800">DOWNSIDE / SUPPORT</div>
            <div class="kv" style="margin-top:5px"><span class="k">PUT WALL</span><b class="mono">6350</b></div>
            <div class="kv"><span class="k">NET GEX</span><b class="mono">+4.12B</b></div></div></div>
        <div style="margin-top:14px"><div style="font-size:9px;letter-spacing:.14em;color:var(--gold);font-weight:800">OVERNIGHT ACTION</div>
          <div class="kv" style="margin-top:5px"><span class="k">ES OVERNIGHT (HIGH / LOW)</span><b class="mono">6444 / 6428</b></div></div>
        <div class="chips" style="margin-top:16px;font-size:9px;opacity:.4">
          <b>CB Edge</b><span class="sp" style="flex:1"></span>
          <span>LEVELS ARE PUBLISHED DAILY AND ARE INFORMATIONAL ONLY — NOT FINANCIAL ADVICE.</span></div>
      </div>
      <div class="chips" style="margin-top:12px">
        <button class="btn2 sm">Copy card</button><button class="btn sm">Copy &amp; Open X</button>
        <button class="btn2 sm" style="color:#8b95f7;border-color:rgba(88,101,242,.4)">Share to Discord</button></div>
      <div class="mut" style="font-size:10.5px;margin-top:8px">Copies the card image to your clipboard — paste (Ctrl+V) into the X composer. If your browser blocks image copy, it downloads a PNG to attach.</div>`;

    return head + `<div style="display:grid;grid-template-columns:360px 1fr;gap:clamp(16px,2vw,32px)">
      ${card("Daily Input · from dashboard state", left)}
      ${card("Share card", shareCard)}</div>`;
  }

  if(tab === "Day Posts"){
    const slot = "Premarket Analysis";
    return head
      + card("1 · Post slot",
          `<div class="chips">${["Premarket Analysis","Midday Update","EOD Summary","Custom"]
            .map((s,i)=>`<button class="btn2 sm"${i===0?' style="border-color:rgba(33,158,188,.6);color:#8fdcef"':''}>${s}</button>`).join("")}</div>
           <div class="mut" style="font-size:11.5px;margin-top:10px">Using: <b>Spot 6412.40</b> · Flip 6388 · Call 6450 · Put 6350 · EM ±1.28% · GEX +4.12B</div>
           <div class="inp ph" style="margin-top:10px;min-height:54px">Optional notes / angle for the AI (e.g. 'focus on the failed breakout at the call wall')…</div>`)
      + card("2 · Visual · retrieve, then capture",
          `<div class="chips">${["GEX Chart","Option Flow (SPX 0DTE OTM)","Option Chain","Multi Greeks","ES Candles"]
            .map((s,i)=>`<button class="btn2 sm"${i===0?' style="border-color:rgba(33,158,188,.6);color:#8fdcef"':''}>${s}</button>`).join("")}
            <span class="sp" style="flex:1"></span>
            <span class="seg"><button class="on">OI + VOL</button><button>VOL</button></span>
            <button class="btn2 sm">⤓ Retrieve</button><button class="btn sm">📸 Capture</button></div>
           <div style="margin-top:14px;height:230px;border-radius:12px;border:1px solid var(--line);
             background:linear-gradient(180deg,rgba(33,158,188,.10),rgba(13,17,25,.4));display:grid;place-items:center">
             <span class="mut" style="font-size:12px">✓ Captured — attached to the tweet preview below</span></div>
           <div class="chips" style="margin-top:12px;font-size:11.5px">
             <span class="mut">☑ CB Edge logo on image</span>
             <span class="mut">Logo corner</span><span class="seg"><button class="on">top-left</button><button>top-right</button></span>
             <span class="mut">cbedge.net corner</span><span class="seg"><button>bottom-left</button><button class="on">bottom-right</button></span></div>`)
      + card("3 · Trade idea · optional",
          `<div class="chips" style="font-size:11.5px"><span class="mut">☑ Include trade idea</span></div>
           <div class="chips" style="margin-top:10px">
             <span class="inp" style="width:80px">SPX</span><span class="inp ph" style="width:80px">6400</span>
             <span class="seg"><button class="on">Call</button><button>Put</button></span>
             <span class="inp ph" style="width:80px">7/17</span><span class="inp ph" style="width:80px">3.10</span>
             <button class="btn2 sm">$ Get price</button>
             <span class="inp ph" style="width:200px">watching over the flip</span></div>`)
      + card("4 · Generate &amp; post",
          `<button class="btn sm">✨ Generate post (AI)</button>
           <div style="margin-top:14px;border:1px solid var(--line);border-radius:14px;padding:14px;max-width:520px">
             <div class="chips"><span style="width:30px;height:30px;border-radius:50%;
               background:linear-gradient(135deg,var(--cy),var(--purple))"></span>
               <div><div style="font-size:13px;font-weight:800">CB Edge</div>
                 <div class="mut" style="font-size:11px">@cbedge · now</div></div></div>
             <div style="font-size:13px;margin-top:10px;line-height:1.5">SPX opens over the gamma flip at 6388 with dealers long gamma — the 6450 call wall is the ceiling until it isn't. EM is ±1.28%.<br><br>Todays $SPX Levels<br>provided by https://www.cbedge.net/</div>
             <div style="margin-top:10px;height:150px;border-radius:10px;background:linear-gradient(135deg,rgba(33,158,188,.16),rgba(18,103,131,.08))"></div>
             <div class="chips" style="margin-top:10px"><button class="btn2 sm">↻ Refresh</button>
               <button class="btn2 sm">Copy</button><button class="btn sm">Open X</button></div></div>
           <div class="mut" style="font-size:11px;margin-top:10px"><b>Copy</b> puts the branded image on the clipboard; <b>Open X</b> pre-fills the caption — paste the image into the composer.</div>`);
  }

  if(tab === "Explainer Mockup"){
    const matrix = [[6450,"CW",712],[6440,"",318],[6430,"",286],[6420,"",96],[6410,"",-64],
      [6400,"FLIP",402],[6390,"",-210],[6380,"",-318],[6350,"PW",-545]];
    return head
      + card("GEX Plan", `
        <div class="chips" style="margin-bottom:14px">
          <span class="seg"><button class="on">0DTE</button><button>1DTE</button></span>
          <span class="seg"><button class="on">OI + VOL</button><button>VOL GEX</button></span>
          <span class="sp" style="flex:1"></span>
          <button class="btn2 sm">Copy screenshot</button><button class="btn2 sm">Copy image</button>
          <button class="btn sm">Download (PNG)</button></div>
        <div style="background:#080b11;border:1px solid var(--lineStrong);border-radius:14px;padding:16px">
          <div class="chips" style="margin-bottom:14px">
            <b style="font-size:14px">CB EDGE <span style="color:var(--cy)">GEX PLAN</span></b>
            ${pill("UPDATE: 09/08/26","mt")}
            ${pill("CORE BULLSEYE 6400","gd")}${pill("TOTAL NET GEX +$4,120K","cy")}${pill("EXPIRATION SEP 8 · 0DTE","cy")}</div>
          <div class="grid2">
            <div><div style="font-size:10px;letter-spacing:.14em;font-weight:800;opacity:.5;margin-bottom:8px">GEX MATRIX (STRIKE)</div>
              ${matrix.map(([k,b,v])=>`<div class="chips" style="font-size:11px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">
                <span class="mono" style="width:44px">${k}</span>
                ${b?pill(b, b==="CW"?"cy":b==="PW"?"rd":"gd"):""}
                <span class="sp" style="flex:1"></span>
                <span class="mono ${v>=0?"pos":"neg"}">${v>=0?"":"-"}$${Math.abs(v)}K</span></div>`).join("")}
              <div class="chips" style="margin-top:8px;font-size:10.5px"><span class="mut">TOTAL NET GEX:</span><b class="mono pos">+$4,120K</b></div></div>
            <div><div style="font-size:10px;letter-spacing:.14em;font-weight:800;opacity:.5;margin-bottom:8px">GEX PROFILE</div>
              ${ladder(D.ladder.slice(0,12), 6410)}
              <div class="grid2" style="gap:8px;margin-top:12px">
                ${[["CORE (CB)","6400","biggest magnet","gd"],["CALL WALL","6450","ceiling","cy"],
                   ["PUT WALL","6350","floor","rd"],["GAMMA FLIP","6388","pinning ↑ trending ↓","gd"]]
                  .map(([l,v,n,k])=>`<div style="border:1px solid var(--line);border-radius:10px;padding:9px">
                    ${pill(l,k)}<div class="mono" style="font-size:16px;font-weight:800;margin-top:5px">${v}</div>
                    <div class="mut" style="font-size:10px">${n}</div></div>`).join("")}</div></div></div>
          <div class="grid2" style="margin-top:16px;gap:14px">
            <div><div style="font-size:10px;letter-spacing:.14em;font-weight:800;opacity:.5;margin-bottom:6px">KEY LEVELS</div>
              ${[["RESISTANCE","6450","var(--ok)"],["CORE BULLSEYE (MAGNET)","6400","var(--gold)"],
                 ["GAMMA FLIP / PIVOT","6388","var(--cy)"],["SUPPORT","6350","var(--softred)"]]
                .map(([l,v,c])=>`<div class="kv"><span class="k" style="color:${c};opacity:.85">${l}</span><b class="mono">${v}</b></div>`).join("")}</div>
            <div><div class="chips" style="margin-bottom:6px">
                <span style="font-size:10px;letter-spacing:.14em;font-weight:800;opacity:.5">TRADE PLAN</span>
                <span class="sp" style="flex:1"></span><button class="btn2 sm">↻ Regenerate</button></div>
              ${[["▲ BULL CASE · 42%","Holds above 6388 → grind toward 6450; buy dips near the Core Bullseye.","var(--ok)"],
                 ["▼ BEAR CASE · 24%","Loses 6388 → dealers flip short gamma, momentum unlocks toward 6350.","var(--softred)"],
                 ["→ CHOP ZONE · 34%","Range 6350–6450: two-way action, fake breakouts, scalp the edges.","var(--gold)"]]
                .map(([h,t,c])=>`<div style="margin-bottom:8px"><div style="font-size:10.5px;font-weight:800;color:${c}">${h}</div>
                  <div class="mut" style="font-size:11px">${t}</div></div>`).join("")}</div></div>
          <div class="mut" style="font-size:10px;margin-top:12px"><b>CB Edge :</b> The 6400 Core Bullseye is dominant control — price gravitates there unless a catalyst breaks it. The bigger move only comes if 6388 fails. <span style="opacity:.6">Not financial advice · educational only.</span></div>
        </div>`);
  }

  /* Probe tab inside Social Media = the OptionsProbe component */
  return head + probeBody();
};

/* shared by SocialMedia › Probe and the Probe page */
function probeBody(){
  const cards = `<div class="grid3">${D.probe.map(p=>`
    <div class="card" style="margin:0;padding:16px 18px">
      <div class="chips"><b style="font-size:14px">${esc(p.c.split(" ")[0])}</b>
        ${pill(p.c.split(" ")[1], p.side==="C"?"gn":"rd")}
        <span class="sp" style="flex:1"></span><span class="mut">▸</span><span class="mut">×</span></div>
      <div class="mut" style="font-size:11px;margin-top:2px">${esc(p.exp)}, 26</div>
      <div style="font-size:26px;font-weight:800;margin-top:8px" class="${p.pct>=0?"pos":"neg"}">
        ${p.pct>=0?"▲":"▼"} ${Math.abs(p.pct)}%</div>
      <div class="mut" style="font-size:11.5px;margin-top:4px">
        in $${p.fill.toFixed(2)} → now $${p.now.toFixed(2)}
        · <span class="${p.pct>=0?"pos":"neg"}">${p.pct>=0?"+":"−"}$${Math.abs(Math.round((p.now-p.fill)*100))}/ct</span></div>
      ${spark([p.fill*100,p.fill*112,p.fill*104,p.fill*130,p.now*88,p.now*96,p.now*100].map(Math.round),
        p.pct>=0?"var(--ok)":"var(--softred)")}
      <div class="chips" style="margin-top:6px;font-size:10px" class="mut">
        <span class="mut">in $${p.fill.toFixed(2)}</span><span class="mut">now $${p.now.toFixed(2)}</span>
        <span class="sp" style="flex:1"></span><span class="mut">2m ago</span></div>
    </div>`).join("")}</div>`;
  return card("Probe a contract",
      `<div class="chips"><span class="inp ph" style="width:320px">shortcut: TSLA 420c 7/17  →  Enter to fill</span>
        <button class="btn2 sm">Fill ↓</button></div>
       <div class="chips" style="margin-top:12px">
        ${[["Ticker","TSLA"],["Expiration","2026-09-19"],["Strike","420"]].map(([l,v])=>
          `<div><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">${l}</div>
            <div class="inp ph" style="width:120px;margin-top:4px">${v}</div></div>`).join("")}
        <div><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Side</div>
          <span class="seg" style="margin-top:4px"><button class="on">Call</button><button>Put</button></span></div>
        <div><div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase">Fill price <i style="opacity:.6">(opt)</i></div>
          <div class="inp ph" style="width:110px;margin-top:4px">live mark</div></div>
        <button class="btn sm" style="align-self:flex-end">Probe &amp; Track</button></div>
       <div class="inp ph" style="margin-top:10px">note / thesis (optional)</div>`,
      { sub:"records your entry, then tracks the result live" })
    + card("Tracked", cards,
      { sub:"3 contracts · updated 12s ago",
        right:`<span class="mut" style="font-size:11px">click a card for the full chart</span>
               <button class="btn2 sm">↻ Refresh</button>` })
    + `<div class="cap">Entry is the fill price you type, or the live mark at the moment you add it if you leave it blank. Prices, greeks and OI come from Theta + Tastytrade through <b>/proxy/probe-rest</b> — the same pipeline the GEX tabs use — and a server-side recorder keeps snapshotting through the session, so the sparkline keeps filling even with this tab closed. Any ticker works. P&amp;L is per single contract (×100).</div>`;
}
P.Probe = () => phead("Probe","records your entry, then tracks the result live") + probeBody();

/* ══════════════ AFFILIATES ══════════════ */
P.Affiliates = () => {
  const tab = tabOf("Affiliates","Active");
  const money0 = c => "$" + c.toLocaleString();
  const money2 = c => "$" + c.toFixed(2);
  const who = (n,s) => `<div style="display:flex;align-items:center;gap:8px">
    <span style="width:28px;height:28px;border-radius:7px;display:grid;place-items:center;flex:0 0 28px;
      background:rgba(33,158,188,.14);color:var(--cy);font-size:10.5px;font-weight:800">${
        n.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase()}</span>
    <span><span style="font-weight:600">${esc(n)}</span>
      <span class="mut" style="display:block;font-size:10.5px">${esc(s)}</span></span></div>`;
  const codePill = c => `<span style="border:1px dashed rgba(33,158,188,.5);color:var(--cy);border-radius:6px;
    padding:2px 8px;font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.06em">${esc(c)}</span>`;

  const summary = `<div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">
    ${[["Awaiting review","2","New applications","var(--orange)"],
       ["Code edit requests","1","Need a decision","var(--cy)"],
       ["Active affiliates","3","45 referred members","var(--lblue)"],
       ["Commission owed",money0(2404),"Accrued, not yet paid","var(--orange)"],
       ["Paid to date",money0(6880),money0(8956)+" affiliate gross MTD","var(--ok)"],
       ["Commission rate","25%","Flat, everyone","var(--lblue)"]]
      .map(([l,v,s,c])=>`<div class="tile"><div class="l">${l}</div>
        <div class="n" style="font-size:26px;color:${c}">${v}</div><div class="d">${s}</div></div>`).join("")}</div>`;

  const headRow = `<div class="phead"><h1>Affiliates</h1>
    <span class="mut" style="font-size:12px">affiliate.cbedge.net</span><span class="sp"></span>
    ${tabs("Affiliates",["Onboarding","Active","Payouts"],tab)}
    <button class="btn2 sm">Refresh</button></div>`;

  if(tab === "Onboarding"){
    const pend = table(
      [{t:"Applicant"},{t:"Channels"},{t:"Audience",n:1},{t:"Requested code"},{t:"Payout"},{t:"Applied"},{t:"Decision",n:1}],
      D.affPending.map(a=>[ who(a.name, a.email),
        pill(a.audience.includes("X")?"X":"DISCORD","bl"),
        esc(a.audience.split(" ")[0]), codePill(a.want), "Stripe",
        `<span class="mut">${a.when.slice(5).replace("-","/")}</span>`,
        `<button class="btn2 sm">Review</button>`]));
    const req = `<div class="chips" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      ${who("Chart Fiend","cf@sample-mail.test")}
      ${codePill("FIEND")} <span>→</span> ${codePill("CHARTF")}
      <span class="mut" style="font-size:11px">requested Sep 3</span>
      <span class="sp" style="flex:1"></span>
      <span class="mut" style="font-size:11.5px">☑ Keep old code live 30d</span>
      <button class="btn2 sm" style="color:var(--softred);border-color:rgba(239,68,68,.3)">Reject</button>
      <button class="btn2 sm" style="color:var(--ok);border-color:rgba(31,217,138,.35)">Approve swap</button></div>
      <div class="mut" style="font-size:11px;margin-top:8px">“Rebranding the channel — old code has my old handle in it.”</div>`;
    return headRow + summary
      + card("Pending applications", pend, { right:`<span class="mut" style="font-size:11.5px">2 waiting</span>` })
      + card("Code change requests", req, { right:`<span class="mut" style="font-size:11.5px">1 open</span>` });
  }

  if(tab === "Payouts"){
    const stats = `<div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      ${[["Awaiting approval",money0(416),"Period 2026-09","var(--orange)"],
         ["Approved, unpaid",money0(520),"Ready to send","var(--ok)"],
         ["Paid this period",money0(1240),"4 payouts","var(--lblue)"],
         ["Held",money0(198),"30-day refund window","var(--softred)"]]
        .map(([l,v,s,c])=>`<div class="tile"><div class="l">${l}</div>
          <div class="n" style="font-size:26px;color:${c}">${v}</div><div class="d">${s}</div></div>`).join("")}</div>`;
    const rows = table(
      [{t:"Affiliate"},{t:"Code"},{t:"Sales",n:1},{t:"Gross",n:1},{t:"Refunds",n:1},{t:"Rate",n:1},{t:"Payout",n:1},{t:"Method"},{t:"Status"},{t:"Action",n:1}],
      D.payouts.map(p=>[ who(p.name, p.name.toLowerCase().replace(/ /g,".")+"@sample-mail.test"),
        codePill(p.code), p.sales, money0(p.gross),
        p.refunds?`−${money0(p.refunds)}`:"$0", `<span style="color:var(--lblue)">${p.rate}%</span>`,
        `<b class="pos">${money2(p.pay)}</b>`, `<span class="mut">${p.method}</span>`,
        p.status==="approved"?pill("Approved","gn"):p.status==="awaiting"?pill("Needs approval","gd"):pill("Held","rd"),
        p.status==="approved"?`<button class="btn2 sm">Mark paid</button>`
          :p.status==="held"?`<button class="btn2 sm">Release hold</button>`
          :`<button class="btn2 sm">Approve</button> <button class="btn2 sm">Hold</button>`]));
    const hist = table([{t:"Paid"},{t:"Affiliate"},{t:"Code"},{t:"Period"},{t:"Amount",n:1},{t:"Method"},{t:"Reference"}],
      [["Aug 4","ES Desk Notes","ESDESK","2026-07",1180.00,"Stripe","po_1PxQ82ABCD"],
       ["Jul 3","0DTE Weekly","ZDTE","2026-06",640.50,"Zelle","ZL-88214"],
       ["Jul 3","Chart Fiend","FIEND","2026-06",212.00,"PayPal","4XW29183KJ"]]
      .map(r=>[`<span class="mut">${r[0]}</span>`,r[1],codePill(r[2]),`<span class="mut">${r[3]}</span>`,
        money2(r[4]),`<span class="mut">${r[5]}</span>`,`<span class="mono mut" style="font-size:11px">${r[6]}</span>`]));
    return headRow + summary + stats
      + card("Payouts · 2026-09", rows, { right:`<span class="seg"><button class="on">2026-09</button><button>2026-08</button></span>` })
      + card("Paid history", hist, { right:`<span class="mut" style="font-size:11.5px">3 payouts</span>` });
  }

  const roster = table(
    [{t:"Affiliate"},{t:"Code"},{t:"Rate",n:1},{t:"Clicks",n:1},{t:"Members",n:1},{t:"Gross MTD",n:1},{t:"Owed",n:1},{t:"Payout"},{t:"Status"},{t:"Actions",n:1}],
    D.affiliates.map(a=>[ who(a.name, a.name.toLowerCase().replace(/ /g,".")+"@sample-mail.test"),
      codePill(a.code),
      `<span style="color:${a.rate===25?"var(--lblue)":"var(--orange)"}">${a.rate}%</span>`,
      a.clicks.toLocaleString(), a.members, money0(a.gross),
      a.owed?`<span class="pos">${money0(a.owed)}</span>`:money0(0),
      `<span class="mut">${a.method}</span>`,
      a.status==="active"?pill("Active","gn"):pill("Paused","mt"),
      a.status==="active"?`<button class="btn2 sm">Pause</button>`:`<button class="btn2 sm">Reactivate</button>`]));
  return headRow + summary
    + card("Active affiliates", roster,
        { right:`<span class="inp ph" style="width:200px">Search name or code</span>` });
};

/* ══════════════ EMAILS ══════════════ */
P.Emails = () => {
  const auds = [["👥 All users",1284,0],["💳 Subscribers",141,1],["🚫 Not paying",1143,0],
    ["📋 Waitlist",206,0],["📇 Old emails",412,0],["📇 Old emails 2",188,0],["✏️ Custom",0,0]];
  const compose = `
    <div class="chips" style="margin-bottom:6px"><span style="font-size:17px;font-weight:800">📧 Email Broadcast</span></div>
    <div style="font-size:14px;color:var(--green);margin-bottom:18px">Send an announcement to your users. Recipients are hidden via BCC.</div>

    <div style="font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase">Templates</div>
    <div class="mut" style="font-size:11.5px;margin:2px 0 8px">Newest first · click a template to load it into the composer below.</div>
    <div class="chips">${["📨 Weekly levels","📨 Feature launch","📨 Promo — annual"].map(t=>`<button class="btn2 sm">${t}</button>`).join("")}</div>

    <div style="font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:20px">Audience</div>
    <div class="mut" style="font-size:11.5px;margin:2px 0 10px">Tick as many as you like — anyone on two lists is sent one email, not two. “All users” and “Custom” each replace the selection.</div>
    ${auds.map(([l,n,on])=>`<div class="chips" style="padding:5px 0">
      <span style="width:15px;height:15px;border-radius:${l.includes("All users")||l.includes("Custom")?"999px":"5px"};
        border:1px solid ${on?"var(--cy)":"var(--line)"};background:${on?"rgba(33,158,188,.2)":"transparent"};
        display:grid;place-items:center;font-size:10px;color:var(--cy)">${on?"✓":""}</span>
      <span style="font-size:13px">${l}</span><span class="sp" style="flex:1"></span>
      <span class="mono mut" style="font-size:11.5px">${n?n.toLocaleString():""}</span></div>`).join("")}
    <div style="font-size:12px;margin-top:8px">141 recipients <span style="color:var(--green)">· 0 duplicates merged</span>
      <span class="mut">· from brandon@cbedge.net</span></div>
    <div class="chips" style="margin-top:6px">
      <span style="color:var(--cy);text-decoration:underline;font-size:12px;cursor:pointer">View list</span>
      <span style="color:var(--cy);text-decoration:underline;font-size:12px;cursor:pointer">Edit list</span></div>

    <div style="font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:20px">Subject</div>
    <div class="inp" style="margin-top:6px">September levels are live</div>

    <div style="font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:20px">Campaign</div>
    <div class="chips" style="margin-top:6px">
      <span class="seg"><button class="on">Broadcast</button><button>Newsletter</button></span>
      <span class="inp ph" style="width:260px">campaign name (blank = from subject)</span></div>
    <div class="mono mut" style="font-size:12px;margin-top:6px">?utm_source=email&amp;utm_medium=email&amp;utm_campaign=september-levels-are-live</div>

    <div style="font-size:14px;font-weight:700;letter-spacing:.1em;color:var(--green);text-transform:uppercase;margin-top:20px">Message (HTML allowed)</div>
    <div class="inp" style="margin-top:6px;min-height:120px;font-size:12.5px;opacity:.8">&lt;p&gt;The September level set is published. Weekly estimated moves updated Saturday, and the no-long / no-short zones are live on the Estimated Moves page.&lt;/p&gt;</div>
    <div style="color:var(--cy);text-decoration:underline;font-size:12px;margin-top:8px;cursor:pointer">Show rendered preview</div>

    <div class="chips" style="margin-top:18px"><span class="sp" style="flex:1"></span>
      <button class="btn">Send to 141</button></div>`;

  const hist = D.sends.map(s=>`
    <div class="chips" style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <div style="min-width:0"><div style="font-size:14px;font-weight:600">${esc(s.subj)}</div>
        <div style="font-size:11.5px;color:var(--green)">${esc(s.when)} · ${esc(s.aud.toLowerCase())}</div></div>
      <span class="sp" style="flex:1"></span>
      <b style="color:var(--cy)">${s.sent.toLocaleString()} sent</b>
      ${s.fail?`<b class="neg">${s.fail} failed</b>`:""}</div>`).join("");

  return `<div style="max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:18px">
      <div class="synth">◆ Audience counts and addresses are synthetic. Nothing on this screen can send.</div>
      ${card(null, compose)}
      ${card(null, `<div class="chips" style="margin-bottom:12px"><span style="font-size:17px;font-weight:800">📜 Sent history</span>
        <span class="sp" style="flex:1"></span>
        <span style="color:var(--cy);text-decoration:underline;font-size:12px;cursor:pointer">Refresh</span></div>` + hist)}
      <div class="cap" style="text-align:center">CB Edge · <span style="color:var(--cy)">cbedge.net</span></div>
    </div>`;
};

/* ══════════════ MEDIA DUMP ══════════════ */
P.MediaDump = () => {
  const items = [
    ["ΔGEX board on the day SPX pinned 6400","gex, screenshot","412 KB"],
    ["Stripe MRR curve — August close","revenue","188 KB"],
    ["Mobile GEX heatmap, iPhone 15","mobile, design","96 KB"],
    ["Partner deck v1 cover","deck","1.2 MB"],
  ];
  const grid = `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px">
    ${items.map((it,i)=>`
      <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panelSolid)">
        <div style="height:96px;background:linear-gradient(135deg,rgba(33,158,188,.${2+i}),rgba(18,103,131,.08));cursor:zoom-in"></div>
        <div style="padding:10px 11px">
          <div style="font-size:12px">${esc(it[0])}</div>
          <div class="chips" style="margin-top:7px">${it[1].split(", ").map(t=>pill("#"+t,"mt")).join("")}
            <span class="mut" style="font-size:10.5px">+ tag</span></div>
          <div class="mut" style="font-size:10.5px;margin-top:7px">Anything you'd want to remember when you bring this up later…</div>
          <div class="chips" style="margin-top:9px;font-size:10.5px">
            <span class="mut">☆ pin</span><span class="mut">Note</span><span class="mut">Link</span>
            <span class="mut">MD</span><span class="mut">Save</span>
            <span class="sp" style="flex:1"></span><span class="mut">${it[2]}</span><span class="mut">✕</span></div>
        </div></div>`).join("")}</div>`;
  return `<div class="phead"><h1>Media Dump</h1><span class="sp"></span>
      <span class="inp ph" style="width:260px">Search captions, notes, filenames…</span>
      <button class="btn2 sm">Refresh</button><button class="btn sm">＋ Add media</button></div>`
    + `<div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${[["In the dump","148"],["Showing","4"],["Pinned","6"],["Stored","412 MB"]]
          .map(([l,n])=>`<div class="tile"><div class="l">${l}</div><div class="n">${n}</div></div>`).join("")}</div>`
    + card(null, `<div style="border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;
        font-size:12.5px;opacity:.45">Paste a screenshot (Ctrl+V), drop a file anywhere on this page, or click to pick one</div>`)
    + card(null, `<div class="chips"><span class="mut" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">Tags</span>
        ${[["gex",41],["screenshot",88],["revenue",12],["design",26],["deck",4],["mobile",19]]
          .map(([t,n])=>pill(`#${t} · ${n}`,"mt")).join("")}</div>`)
    + card("Tue, Sep 8", grid, { right:`<span class="mut" style="font-size:11.5px">4</span>` });
};

/* ══════════════ POST STUDIO ══════════════ */
P.PostStudio = () => {
  const fxGroup = (name, list) => `<div style="margin-bottom:10px">
    <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px">${name}</div>
    <div class="chips">${list.map(f=>pill(f,"mt")).join("")}</div></div>`;
  return phead("X Post Studio", null, `<button class="btn sm">Download PNG</button>`)
    + `<div style="display:grid;grid-template-columns:220px 1fr 250px;gap:clamp(16px,2vw,32px)">
      ${card("Presets", `<div class="chips" style="flex-direction:column;align-items:stretch">
          ${["Daily levels card","GEX plan","Weekly EM","Promo — annual"].map((p,i)=>
            `<button class="btn2 sm" style="text-align:left${i===0?';border-color:rgba(33,158,188,.6);color:#8fdcef':''}">${p}</button>`).join("")}</div>
        <div class="chips" style="margin-top:12px"><span class="inp ph" style="flex:1">Preset name</span></div>
        <div class="chips" style="margin-top:8px"><button class="btn2 sm">Load template</button>
          <button class="btn2 sm" style="color:var(--softred);border-color:rgba(239,68,68,.3)">Delete preset</button></div>
        <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin:16px 0 6px">Canvas</div>
        <div class="chips">${["Fit","Fill","Crop to fill","Fit box to image"].map(b=>pill(b,"mt")).join("")}</div>
        <div class="chips" style="margin-top:10px"><button class="btn2 sm">Add layer</button>
          <button class="btn2 sm">Group</button></div>`)}
      ${card(null, `<div style="aspect-ratio:16/9;border-radius:14px;border:1px solid var(--lineStrong);
          background:radial-gradient(120% 120% at 30% 10%, rgba(33,158,188,.20), rgba(5,6,10,.9) 70%);
          display:grid;place-items:center;position:relative;overflow:hidden">
          <div style="position:absolute;inset:0;background:
            repeating-linear-gradient(0deg,rgba(255,255,255,.03) 0 1px,transparent 1px 42px),
            repeating-linear-gradient(90deg,rgba(255,255,255,.03) 0 1px,transparent 1px 42px)"></div>
          <div style="text-align:center;position:relative">
            <div style="font-size:11px;letter-spacing:.2em;color:var(--cy);font-weight:800">CB EDGE</div>
            <div style="font-size:34px;font-weight:900;letter-spacing:-.02em;margin-top:6px">SPX 6412</div>
            <div class="mut" style="font-size:12px;margin-top:4px">Call wall 6450 · Flip 6388 · Put wall 6350</div>
            <div style="margin-top:14px;font-size:10px;letter-spacing:.16em;opacity:.5">cbedge.net</div></div>
          <div style="position:absolute;left:18px;top:18px;width:44px;height:44px;border-radius:10px;
            border:1px dashed rgba(33,158,188,.6)"></div></div>
        <div class="mut" style="font-size:11.5px;margin-top:10px;text-align:center">Click a layer on the canvas to edit it.</div>`, {tight:true})}
      ${card("Layer", `${[["Fill","#0D1119"],["Border","No border"],["Border thickness","2"],
            ["Corner radius","14"],["Color","#219EBC"],["Font size","34"]]
          .map(([l,v])=>`<div class="kv"><span class="k">${l}</span><b class="mono" style="font-size:11.5px">${v}</b></div>`).join("")}
        <div class="chips" style="margin-top:10px">${["Left","Center","Bring front","Forward ↷","Duplicate","Delete"]
          .map(b=>pill(b,"mt")).join("")}</div>
        <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin:16px 0 8px">FX strength</div>
        ${bar(0.42,"var(--cy)")}
        <div style="margin-top:12px">
          ${fxGroup("FX · light",["Bloom","God rays","Light leaks","Lights"])}
          ${fxGroup("FX · air",["Fog","Clouds","Aurora","Caustics"])}
          ${fxGroup("FX · film",["Grain","Film burn","Anamorphic","Bokeh"])}
          ${fxGroup("FX · digital",["Glitch","CRT static","Grid lines"])}
          ${fxGroup("FX · particles",["Dust","Embers"])}
          ${fxGroup("FX · finish",["Color wash","Accent","Auto-fill"])}
        </div>
        <button class="btn2 sm" style="width:100%;margin-top:6px">Clear FX</button>`)}
    </div>`;
};

/* ══════════════ CHANGELOG ══════════════ */
P.Changelog = () => {
  const file = tabOf("Changelog","CHANGELOG.md");
  const body = file==="CHANGELOG.md" ? D.changelog : `## 2026-09-08 - Customer-facing notes
- Estimated Moves: weekly publish now shows the source timestamp on the page
- Mobile: Economic Calendar added to the phone build
- Options Chain: fixed the stale-after-idle reconnect`;
  return `<div style="max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:18px">
      <div>
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:800">Live Notes</div>
        <h1 style="margin:8px 0 6px;font-size:26px;font-weight:800;letter-spacing:-.02em">Changelog</h1>
        <p class="mut" style="margin:0;font-size:13px">Read live from the backend at
          <span style="color:var(--cy)">/api/changelog</span> — current as of the running deploy, not a copy bundled into this app.</p>
      </div>
      <div class="chips">${tabs("Changelog",["CHANGELOG.md","CUSTOMER_CHANGELOG.md"],file)}
        <span class="sp" style="flex:1"></span><button class="btn2 sm">Refresh</button></div>
      ${card(null, `<div class="chips" style="margin-bottom:14px">
          <span style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:800">Source File</span>
          <span class="sp" style="flex:1"></span>
          <span class="mut" style="font-size:11.5px">last written Sep 8, 6:04 PM ET</span>
          <span class="mut" style="font-size:11.5px">${file==="CHANGELOG.md"?"1.1 MB":"56 KB"}</span>
          <b style="color:var(--cy);font-size:11.5px">${esc(file)}</b></div>
        ${file==="CHANGELOG.md"?`<div class="warnbar" style="margin-bottom:12px">Showing the newest ~400 KB of this file — the rest is older history, still in the repo.</div>`:""}
        <pre class="mono" style="white-space:pre-wrap;margin:0;font-size:11.5px;opacity:.75;line-height:1.7">${esc(body)}</pre>`)}
    </div>`;
};

/* ══════════════ BZILA ALERTS ══════════════ */
P.BzilaAlerts = () => {
  const alerts = D.alerts.map(a=>`
    <div style="border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px">
      <div style="font-size:14px;line-height:1.5">${esc(a.t)}</div>
      <div class="chips" style="margin-top:8px;font-size:11.5px">
        <span class="pos">👍 ${a.up}</span><span class="neg">👎 ${a.dn}</span>
        <span class="sp" style="flex:1"></span>
        <span class="mut">${esc(a.age)}</span>
        <span style="color:var(--cy);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;cursor:pointer">Edit</span>
        <span style="color:var(--softred);font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;cursor:pointer">Delete</span></div></div>`).join("");
  const react = table(
    [{t:"Subscriber"},{t:"👍 Up",n:1},{t:"👎 Down",n:1},{t:"Total",n:1},{t:"Alerts",n:1},{t:"Taps",n:1},{t:"First"},{t:"Last reacted"}],
    D.reactors.map(r=>[`<span style="color:var(--cy)">▸</span> <span class="mono">${esc(r.who)}</span>`,
      `<span class="pos">${r.up}</span>`, `<span class="neg">${r.dn}</span>`, r.up+r.dn, r.alerts,
      Math.round((r.up+r.dn)*1.4), `<span class="mut">${esc(r.first)}</span>`, `<span class="mut">${esc(r.last)}</span>`]));
  return `<div style="max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:18px">
      <div class="phead">
        <span style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--gold),var(--orange))"></span>
        <div><h1 style="font-size:20px;font-weight:800">Bzila Alerts</h1>
          <div class="mut" style="font-size:12px">Broadcasts to paid subscribers · reaction tally</div></div>
        <span class="sp"></span><button class="refresh">↻ Refresh</button></div>
      <div class="synth">◆ Every subscriber record on this page is synthetic.</div>
      <div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="tile"><div class="l">Alerts sent</div><div class="n" style="color:var(--cy)">112</div></div>
        <div class="tile"><div class="l">👍 Total</div><div class="n" style="color:var(--ok)">2,841</div></div>
        <div class="tile"><div class="l">👎 Total</div><div class="n" style="color:var(--softred)">188</div></div></div>
      ${card("New alert", `<div class="inp ph">Title (optional)</div>
        <div class="inp ph" style="margin-top:8px;min-height:72px">Type an alert…</div>
        <div class="chips" style="margin-top:10px"><span class="sp" style="flex:1"></span>
          <button class="btn sm">Send alert</button></div>`)}
      ${card("All alerts · 112", alerts)}
      ${card("Reactions by user · 3",
        `<div class="mut" style="font-size:12px;margin-bottom:10px">All-time score · includes reactions on alerts that have since been deleted</div>` + react)}
    </div>`;
};
