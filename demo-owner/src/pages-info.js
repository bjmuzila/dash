/* ══════════════════════════════════════════════════════════════
   INFO GROUP — rebuilt against the real pages, string for string.
   Sources: pages/Sales.tsx, pages/Admin.tsx, pages/ControlPanel.tsx,
            pages/Visitors.tsx, components/OwnerControls.tsx,
            components/LiveKpiCard.tsx, components/AcquisitionPanel.tsx
   ══════════════════════════════════════════════════════════════ */

/* LiveKpiCard — label 12px gold uppercase .07em, value 30px mono, delta pill */
function kpi(label, value, sub, opts){
  opts = opts || {};
  const d = opts.delta;
  const dp = d == null ? "" :
    `<div class="kd" style="color:${d.dir==="up"?"var(--ok)":d.dir==="down"?"var(--softred)":"rgba(255,255,255,.4)"}">
       ${d.dir==="up"?"↑":d.dir==="down"?"↓":"→"} ${esc(d.text)}</div>`;
  const sp = opts.points ? sparkWide(opts.points, opts.accent || "var(--cy)") : "";
  return `<div class="kpi">${dp}
    <div class="kl">${esc(label)}</div>
    <div class="kv"${opts.accent?` style="color:${opts.accent}"`:""}>${esc(value)}</div>
    <div class="ks">${esc(sub)}</div>${sp}</div>`;
}
function sparkWide(vals, color){
  const w=300,h=36, mn=Math.min(...vals), mx=Math.max(...vals), rg=(mx-mn)||1;
  const pts = vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-((v-mn)/rg)*(h-6)-2).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" height="36">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" opacity=".75"/></svg>`;
}
const bdg = (t,c) => `<span class="bdg" style="color:${c}">${esc(t)}</span>`;

/* fmtMoney from Sales.tsx: $1.2K at >= 1000, else $29 — no cents, no separators */
const fm = n => (n<0?"−":"") + (Math.abs(n)>=1000 ? "$"+(Math.abs(n)/1000).toFixed(1)+"K" : "$"+Math.abs(n).toFixed(0));

/* ══════════════ SALES ══════════════ */
P.Sales = () => {
  const gran = tabOf("Sales","Weekly");
  const factor = { Daily:12/365, Weekly:12/52, Monthly:1, Yearly:12 }[gran];
  const per    = { Daily:"per day", Weekly:"per week", Monthly:"per month", Yearly:"per year" }[gran];
  const mrrM   = 11742;

  const kpis = `<div class="kpis">
    ${kpi(`${gran} Recurring Revenue`, fm(mrrM*factor), `104 monthly subs · ${per}`,
        { accent:"var(--cy)", delta:{dir:"up",text:"8.4%"}, points:[62,64,67,69,72,75,79,82,86,90,94,98] })}
    ${kpi("Active Subscriptions","141","3 leaving · $297/mo at risk",
        { accent:"#8ECAE6", delta:{dir:"up",text:"6.8%"}, points:[40,42,44,43,47,49,52,54,57,59,62,66] })}
    ${kpi("Total Customers","1,284","lifetime paying",
        { accent:"var(--orange)", delta:{dir:"up",text:"3.1%"}, points:[60,63,66,68,71,74,77,80,83,86,89,92] })}
    ${kpi("Collected · Lifetime", fm(182400), "all sales to date · 1 churned this month",
        { accent:"var(--lblue)", delta:{dir:"up",text:"11.2%"}, points:[8,14,22,31,41,52,64,78,92,108,126,148] })}
    ${kpi("Trial Conversion","36%","23 of 57 paid · 7 still in trial", {})}
  </div>`;

  /* Profit per Month — 12 buckets, money above, month + subs delta below, dashed expense line */
  const months = ["Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep"];
  const cash   = [3100,3480,3900,4250,4900,5400,6100,7400,8850,9620,11480,4120];
  const subsD  = [2,3,1,4,3,5,4,6,5,3,7,2];
  const expM   = 1310;
  const mxCash = Math.max(...cash);
  const bars = `<div class="pbars">${cash.map((c,i)=>{
    const h = (c/mxCash*150).toFixed(0);
    const under = c < expM;
    return `<div class="pb">
      <div class="amt">${c?fm(c):"—"}</div>
      <div class="col${under?" under":""}" style="height:${h}px"></div>
      <div class="m">${months[i]}</div>
      <div class="s" style="color:${subsD[i]>=0?"var(--ok)":"var(--softred)"}">${subsD[i]>=0?"+":"−"}${Math.abs(subsD[i])}</div>
    </div>`;
  }).join("")}</div>
  <div class="chips" style="margin-top:12px;font-size:11px;opacity:.5">
    <span style="color:var(--gold)">■</span> Cleared costs
    <span style="color:var(--softred);margin-left:8px">■</span> Under costs
    <span style="margin-left:8px">┄</span> Expense line
    <span style="margin-left:8px">+n / −n subs</span></div>`;
  const profitHead = `<div class="badges">
    <span class="mut" style="font-size:11.5px">Sep collected</span>
    <b style="color:var(--cy);font-size:15px">${fm(4120)}</b>
    ${pill("+"+fm(2810)+" profit","gn")}
    <span style="color:var(--softred);font-size:11px">▼ ${fm(7360)} (64%)</span></div>`;

  /* Signed up · never bought */
  const range = tabOf("Sales.range","Today");
  const totals = `<div class="chips" style="margin-bottom:14px;font-size:11.5px;gap:16px">
    ${[["Created",38],["Became customers",5],["Still unpaid",33],["Saw pricing",19],["Reached checkout",6],["Never came back",14]]
      .map(([l,n])=>`<span class="mut">${l} <b style="color:#fff;opacity:1">${n}</b></span>`).join("")}</div>`;
  const farPill = f => f==="Payment failed" ? pill(f,"og") : f==="Cancelled" ? pill(f,"rd")
    : f==="Reached checkout" ? pill(f,"gd") : f==="Saw pricing" ? pill(f,"cy") : pill(f,"mt");
  const nb = table([{t:"Person"},{t:"Signed up"},{t:"Came from"},{t:"Looked at"},{t:"Got as far as"},{t:"Last seen"},{t:"Location"}],
    D.signups.map(s=>[
      `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;
        background:${s.far==="Never saw pricing"?"rgba(255,255,255,.25)":"var(--ok)"}"
        title="${s.far==="Never saw pricing"?"Email never verified":"Email verified"}"></span><span class="mono">${esc(s.email)}</span>`,
      `<span class="mut">${esc(s.rel||"2d ago")}</span>`, esc(s.src),
      `<span class="mut">${(s.views||3)} views</span>`, farPill(s.far),
      `<span class="mut">${esc(s.seenRel||"1d ago")}</span>`, `<span class="mut">${esc(s.loc)}</span>`]));

  /* Trial conversion */
  const trialHead = `<div class="badges">
    <b style="font-size:19px">36%</b>
    ${bdg("64 started","rgba(255,255,255,.45)")}${bdg("23 paid","var(--ok)")}
    ${bdg("7 in trial","var(--cy)")}${bdg("34 lapsed","var(--softred)")}${bdg(fm(4210)+" from trials","var(--gold)")}</div>`;
  const trials = table([{t:"Customer"},{t:"Trial started"},{t:"Trial ended"},{t:"Outcome"},{t:"Paid",n:1}],
    [["m.calloway@sample-mail.test","Feb 9","Feb 11","converted",400],
     ["j.ferreira@sample-mail.test","Mar 31","Apr 2","converted",99],
     ["r.whitfield@sample-mail.test","Sep 5","—","in trial",0],
     ["t.osei@sample-mail.test","Sep 1","Sep 3","lapsed",0],
     ["n.vasquez@sample-mail.test","Aug 28","Aug 30","lapsed",0]]
    .map(r=>[`<span class="mono">${esc(r[0])}</span>`, `<span class="mut">${esc(r[1])}</span>`,
      `<span class="mut">${esc(r[2])}</span>`,
      pill(r[3], r[3]==="converted"?"gn":r[3]==="in trial"?"cy":"mt"), r[4]?fm(r[4]):"—"]));

  /* Trial abuse & bans */
  const banHead = `<div class="badges">${bdg("2 banned","var(--softred)")}${bdg("6 blocked attempts","var(--orange)")}
    ${bdg("3 repeat attempts","var(--gold)")}<span class="sp" style="flex:1"></span>
    <span class="mut" style="font-size:11px">a ban blocks the trial only — never the purchase</span></div>`;
  const banForm = `<div class="chips" style="margin-bottom:16px">
    <span class="seg"><button class="on">Email</button><button>IP</button></span>
    <span class="inp ph" style="width:200px">someone@example.com</span>
    <span class="inp ph" style="width:170px">reason (internal)…</span>
    <span class="mut" style="font-size:11.5px">☑ email them</span>
    <span class="mut" style="font-size:11.5px">☐ quote reason</span>
    <button class="btn sm">Ban trial</button></div>`;
  const repeats = table([{t:"Email"},{t:"First trial"},{t:"Attempts",n:1},{t:"Last try"},{t:"Action"}],
    [["burner+12@sample-mail.test","7/14/2026",4,"9/6/2026"],
     ["k.tanaka@sample-mail.test","8/2/2026",2,"9/4/2026"]]
    .map(r=>[`<span class="mono">${esc(r[0])}</span>`,`<span class="mut">${r[1]}</span>`,r[2],
      `<span class="mut">${r[3]}</span>`,`<button class="btn2 sm">Ban + notify</button>`]));
  const ips = table([{t:"IP"},{t:"Emails",n:1},{t:"Checkouts",n:1},{t:"Addresses"},{t:"Action"}],
    [["84.19.203.11",6,7,"a.brennan@…, t.osei@…, n.vasquez@…"],
     ["203.0.113.9",2,2,"burner+12@…, burner+13@…"]]
    .map((r,i)=>[`<span class="mono">${esc(r[0])}</span>`,r[1],r[2],`<span class="mut">${esc(r[3])}</span>`,
      i?`<span class="neg" style="font-size:11px">banned</span>`:`<button class="btn2 sm">Ban IP</button>`]));
  const activeBans = table([{t:"Value"},{t:"Kind"},{t:"Reason"},{t:"Blocked",n:1},{t:"Notified"},{t:"Actions"}],
    [["burner+12@sample-mail.test","email","4th trial, same card fingerprint",4,"✓ 9/6/2026"],
     ["84.19.203.11","ip","6 accounts, one address",6,"not sent"]]
    .map(r=>[`<span class="mono">${esc(r[0])}</span>`,`<span class="mut">${r[1]}</span>`,
      `<span class="mut">${esc(r[2])}</span>`,r[3],
      r[4]==="not sent"?`<span class="mut">not sent</span>`:`<span class="pos">${r[4]}</span>`,
      `<button class="btn2 sm">Send notice</button> <button class="btn2 sm">Lift</button>`]));

  /* Active subscriptions + Cancellations */
  const statusTag = c => c.status==="active" ? `<div>active</div>`
    : c.status==="trialing" ? `<div>trialing</div>`
    : `<div>cancelled</div><div class="mut" style="font-size:10px">ended Aug 24</div>`;
  const subs = table([{t:"Customer"},{t:"Discord"},{t:"Amount"},{t:"Status"},{t:"Renews"},{t:"Joined"},{t:"Total Spent",n:1},{t:"Account",n:1}],
    D.customers.map(c=>[
      `<div class="mono">${esc(c.email)}</div><div class="mut" style="font-size:10px">${c.plan==="Annual"?"CB Edge Annual":"CB Edge Monthly"}</div>`,
      `<span class="mut">${esc(c.disc)}</span>`,
      `<span class="mono">${fm(c.amt)}/${c.plan==="Annual"?"yr":"mo"}</span>`,
      statusTag(c),
      `<span class="mut">${c.renew==="—"?"—":esc(c.renew.slice(5).replace("-","/"))}</span>`,
      `<span class="mut">${esc(c.joined.slice(5).replace("-","/"))}</span>`,
      `<span class="mono">${fm(c.spent)}</span>`,
      `<button class="btn2 sm">Reset pw</button>`]));
  const cancels = D.cancels.map((c,i)=>`
    <div style="padding:11px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <div class="chips"><span class="mono" style="font-size:12px">${esc(c.email)}</span>
        <span class="sp" style="flex:1"></span>${pill(i===0?"cancelled":"cancelled","rd")}</div>
      <div class="mut" style="font-size:11px;margin-top:4px">${fm(99)}/mo · ended ${esc(c.when)} · spent ${fm(c.months*99)}</div>
      <div class="chips" style="margin-top:6px">${pill(c.reason,"mt")}</div></div>`).join("");

  /* Expenses */
  const expForm = `<div class="chips" style="margin-bottom:14px">
    <span class="inp ph" style="width:180px">expense name…</span>
    <span class="seg"><button class="on">Data feed</button><button>Infra</button><button>Software</button></span>
    <span class="inp ph" style="width:110px">amount $</span>
    <span class="seg"><button class="on">Monthly</button><button>Yearly</button><button>One-off</button></span>
    <button class="btn sm">+ Add</button></div>`;
  const exp = table([{t:"Item"},{t:"Category"},{t:"Amount",n:1},{t:"Cadence"},{t:"Action"}],
    D.expenses.map(e=>[esc(e[0]),
      `<span class="mut">${e[0].includes("Theta")||e[0].includes("vault")?"Data feed":e[0].includes("VPS")||e[0].includes("Cloudflare")?"Infra":"Software"}</span>`,
      `<span class="mono">${fm(e[1])}${e[2]==="monthly"?"/mo":""}</span>`,
      e[2]==="one-off"?"One-off":"Monthly", `<button class="btn2 sm">Remove</button>`]));

  return phead("Sales · Stripe", null, `<span class="mut" style="font-size:11.5px">Updated 09:41:07</span>
      ${tabs("Sales",["Daily","Weekly","Monthly","Yearly"],gran)}
      <button class="btn sm">↻ Refresh</button>`)
    + `<div class="synth">◆ Revenue figures and customer records on this page are synthetic.</div>`
    + kpis
    + card("Profit per Month", bars,
        { sub:`All sales collected that month, less the ${fm(expM)}/mo expense run-rate · last 12 months`,
          right:profitHead })
    + card("Signed up · never bought", totals + nb,
        { sub:"Accounts created that are not paying. Sorted newest first — the top of this list on a zero-sale day is exactly who to look at.",
          right:`${tabs("Sales.range",["Today","7 days","30 days","All time"],range)}
                 <button class="btn2 sm">Copy 5 emails</button>` })
    + card("Trial conversion", trials, { right:trialHead })
    + card("Trial abuse & bans", banHead + banForm
        + `<div class="cs" style="font-size:12px;color:var(--green);margin:4px 0 8px">Repeat trial attempts <span class="mut">— already refused automatically — ban to make it permanent and tell them</span></div>` + repeats
        + `<div class="cs" style="font-size:12px;color:var(--green);margin:18px 0 8px">Shared checkout IPs <span class="mut">— one address, more than one email</span></div>` + ips
        + `<div class="cs" style="font-size:12px;color:var(--green);margin:18px 0 8px">Active bans</div>` + activeBans)
    + `<div style="display:grid;grid-template-columns:2fr 1fr;gap:clamp(16px,2vw,32px)" class="g21">
        ${card("Active Subscriptions", subs, { right:`<div class="badges">${bdg("141","var(--cy)")}${bdg("3 leaving","var(--gold)")}${bdg("1 needs card","var(--orange)")}</div>` })}
        ${card("Cancellations", cancels, { right:`<div class="badges">${bdg("3 leaving","var(--gold)")}${bdg("3 ended","var(--softred)")}</div>` })}</div>`
    + card("Expenses", expForm + exp,
        { right:`<div class="badges">${pill(fm(expM)+"/mo","rd")}<span class="mut" style="font-size:11px">recurring + one-off costs, netted against MRR above</span></div>` })
    + card(null, `<div class="chips"><span class="mut" style="font-size:12.5px">Full billing management, invoices, and payouts</span>
        <span class="sp" style="flex:1"></span><button class="btn sm">Open Stripe Dashboard ↗</button></div>`, {tight:true});
};

/* ══════════════ ADMIN ══════════════ */
P.Admin = () => {
  const controls = `
    <div class="strip"><span class="dot" style="background:var(--ok)"></span>
      <div><div class="t">SPX Index Feed · HEALTHY</div>
        <div class="s">spot 6412.40 · updated &lt;1s ago</div></div>
      <span class="sp"></span><button class="btn2 sm">Open Greeks →</button></div>
    <div class="strip" style="margin-top:8px"><span class="dot" style="background:var(--ok)"></span>
      <div><div class="t">Theta Terminal · HEALTHY</div>
        <div class="s">cpu 4.2% · mem 812MiB / 2.0GiB (40%) · pids 61</div></div></div>
    <div class="grid3" style="margin-top:14px;gap:12px">
      ${[["Idle Mode (feed)","○ Idle OFF — pause"],["CB Auto (5m)","● Auto ON — disable"],["Maintenance","○ Maint OFF — enable"]]
        .map(([l,b])=>`<div><div class="mut" style="font-size:11px;margin-bottom:5px">${l}</div>
          <button class="btn2 sm" style="width:100%">${b}</button></div>`).join("")}</div>
    <div class="chips" style="margin-top:14px">
      ${["↻ Reconnect Feed","▶ Run EOD GEX now","📸 CB Snapshot now","📝 Premarket Summary now","🎯 Strategy now","🗑️ Erase all chat"]
        .map(b=>`<button class="btn2 sm">${b}</button>`).join("")}</div>
    <div style="margin-top:18px">
      <div style="font-size:12px;color:var(--green)">Signal Alerts</div>
      <div class="mut" style="font-size:11px;margin-bottom:10px">on/off per alert type for the background signals engine → Discord. No redeploy needed.</div>
      ${[["Gamma flip crossed","bzila",1],["Call wall breached","bzila",1],["Put wall breached","bzila",1],
         ["EOD board recorded","system",1],["Levels publish failed","system",0]]
        .map(([l,g,on])=>`<div class="chips" style="padding:5px 0">
          <button class="btn2 sm" style="min-width:64px">${on?"● ON":"○ OFF"}</button>
          <span style="font-size:12.5px">${l}</span><span class="sp" style="flex:1"></span>${pill(g,"mt")}</div>`).join("")}
    </div>`;

  const checks = `${[
    ["Stripe ↔ database drift","Does every active Stripe subscription have a matching row?","0 rows · 412ms"],
    ["Access without a subscription","Who can reach the app but isn't paying?","3 rows · 288ms"],
    ["Orphaned comp grants","Comped accounts past their expiry date","1 row · 104ms"],
    ["Sessions without an account","Session rows whose user was deleted","0 rows · 96ms"]]
    .map(([t,q,s])=>`<div style="padding:11px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <div class="chips"><div><div style="font-size:15px;font-weight:700">${t}</div>
        <div class="mut" style="font-size:13px">${q}</div></div>
        <span class="sp" style="flex:1"></span>
        <button class="btn2 sm">⧉ cmd</button><button class="btn2 sm">Re-run</button></div>
      <div class="mono mut" style="font-size:11px;margin-top:6px">${s}</div></div>`).join("")}`;

  const fb = D.feedback.map(f=>`
    <div style="padding:11px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <div class="chips">${pill(f.cat.toUpperCase(), f.cat==="Bug"?"rd":f.cat==="Idea"?"og":"cy")}
        <span class="mono" style="font-size:12px">${esc(f.email)}</span>
        <span class="mono mut" style="font-size:11px">${esc(f.page)}</span>
        <span class="mut" style="font-size:11px">${esc(f.when)}</span>
        <span class="sp" style="flex:1"></span>
        <button class="btn2 sm">${f.open?"Resolve":"Reopen"}</button></div>
      <div style="font-size:12.5px;margin-top:5px;opacity:.85">${esc(f.msg)}</div></div>`).join("");

  const comped = D.comped.map(c=>`
    <div class="chips" style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <span class="mono" style="font-size:12px">${esc(c.email)}</span>
      ${c.state!=="active"?pill(c.state,"og"):""}
      ${c.state!=="active"?`<button class="btn2 sm">Resend</button>`:""}
      <span class="mut" style="font-size:11.5px">${esc(c.note)}</span>
      <span class="sp" style="flex:1"></span>
      <span class="mut" style="font-size:11.5px">${c.exp==="—"?"no expiry":"until "+esc(c.exp)}</span>
      <button class="btn2 sm">Revoke</button></div>`).join("");
  const compForm = `<div class="chips" style="margin-bottom:14px">
    <span class="inp ph" style="width:190px">email to comp…</span>
    <span class="inp ph" style="width:160px">note (why)…</span>
    <span class="inp ph" style="width:130px">yyyy-mm-dd</span>
    <span class="mut" style="font-size:11.5px">☑ email invite</span>
    <button class="btn sm">Grant</button></div>`;

  const notPaying = `<div class="mono" style="font-size:12px;line-height:2;opacity:.75">
    ${D.signups.map(s=>esc(s.email)).join("<br>")}</div>`;

  const activity = table([{t:"Customer"},{t:"Last login"},{t:"Time (approx)",n:1},{t:"Loads",n:1},{t:"Pages",n:1},{t:"Most viewed"}],
    D.customers.map(c=>[
      `<div><span class="mono">${esc(c.email)}</span> ${c.status!=="canceled"?pill("paid","gn"):""}</div>
       <div class="mut" style="font-size:10px">${c.last.slice(11)} · ${Math.round(c.loads/14)} sessions</div>`,
      `<span class="mut">${c.status==="canceled"?"17d ago":"2h ago"}</span>`,
      (c.mins/60)>=1 ? Math.floor(c.mins/60)+"h "+(c.mins%60)+"m" : c.mins+"m",
      c.loads, c.pages, `<span class="mono mut">${esc(c.top)}</span>`]), {plain:true});

  const discord = table([{t:"Customer"},{t:"Discord"},{t:"Connected"}],
    D.customers.filter(c=>c.disc!=="—").map(c=>[
      `<span class="mono">${esc(c.email)}</span>`,
      `<span class="mono" style="color:var(--cy)">${esc(c.disc)}</span>`,
      `<span class="mut">${esc(c.joined)}</span>`]), {plain:true});

  const farcb = table([{t:"Ticker"},{t:"Added by"},{t:"Added"}],
    [["MSTR","m.calloway@sample-mail.test","9/6/2026, 10:12:04 AM"],
     ["SOFI","d.okafor@sample-mail.test","9/4/2026, 3:41:22 PM"],
     ["RIOT","j.ferreira@sample-mail.test","9/1/2026, 8:02:11 AM"]]
    .map(r=>[`<b class="mono">${r[0]}</b>`,`<span class="mono">${esc(r[1])}</span>`,`<span class="mut">${r[2]}</span>`]),
    {plain:true});

  const unsub = D.unsubs.map(u=>`
    <div class="chips" style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.045)">
      <span class="mono" style="font-size:12px">${esc(u.email)}</span>
      ${pill(u.why==="Unsubscribed"?"link":"manual", u.why==="Unsubscribed"?"mt":"og")}
      <span class="mut" style="font-size:11.5px">${esc(u.when)}</span>
      <span class="sp" style="flex:1"></span>
      <button class="btn2 sm">Re-subscribe</button></div>`).join("");

  return phead("Admin", null, `<span class="mut" style="font-size:11.5px">Updated 09:41:07</span>
      <button class="btn2 sm">Sales →</button>`)
    + `<div class="synth">◆ Every customer record on this page is synthetic.</div>`
    + card("Controls", controls, { sub:"idle OFF · mvc ON · maint OFF" })
    + card("System Checks", checks, { sub:"nothing here changes data — write actions stay on the VPS",
        right:pill("read-only","gn") })
    + card("Feedback", fb, { sub:"4 total · submitted from the in-app widget",
        right:`<div class="badges">${bdg("2 open","var(--orange)")}
          <span class="mut" style="font-size:11.5px">☐ Show resolved</span>
          <button class="btn2 sm">↻</button></div>` })
    + card("Comped Access", compForm + comped,
        { sub:"full customer access, no Stripe · never owner access · granting creates the account",
          right:`<div class="badges">${bdg("3","var(--cy)")}<button class="btn2 sm">↻</button></div>` })
    + `<div class="grid2">
        ${card("Signed Up · Not Paying", notPaying, { sub:"accounts created without an active subscription",
          right:`<div class="badges">${bdg("1,143","var(--orange)")}<button class="btn2 sm">Copy emails</button>
            <button class="btn2 sm">Email these →</button></div>` })}
        ${card("Unsubscribes · Do Not Email", `<div class="chips" style="margin-bottom:12px">
            <span class="inp ph" style="width:200px">add email to suppress…</span>
            <button class="btn sm">Suppress</button></div>` + unsub,
          { sub:"skipped by every broadcast audience", right:bdg("2","var(--softred)") })}</div>`
    + card("Customer Activity", activity + `<div class="cap" style="margin-top:12px">Time on site is estimated from page-load timestamps (30-min session gap) and is a lower bound — the last page of each session isn't counted.</div>`,
        { sub:"last login · time on site (approx) · pages",
          right:`<div class="badges"><span class="seg"><button class="on">Recent</button><button>Time</button><button>Pages</button></span>
            <button class="btn2 sm">↻</button></div>` })
    + `<div class="grid2">
        ${card("Discord Connections", discord, { sub:"accounts that linked a Discord account", right:bdg("3","var(--cy)") })}
        ${card("Far CB Watch — Tickers Added", farcb, { sub:"customer additions on top of the curated core list", right:bdg("3","var(--cy)") })}</div>`;
};

/* ══════════════ OVERVIEW (ControlPanel) ══════════════ */
P.ControlPanel = () => {
  const gran = tabOf("ControlPanel","daily");
  const winLabel  = gran==="live" ? "24h" : gran==="daily" ? "24h" : gran==="weekly" ? "7d" : "30d";
  const hostLabel = gran==="live" ? "1h"  : gran==="daily" ? "1h"  : gran==="weekly" ? "7d" : "30d";
  const caption   = { live:"24 hours", daily:"7 days", weekly:"12 weeks", monthly:"12 months", yearly:"lifetime" }[gran];

  const sysTile = (l,v,s) => `<div class="tile"><div class="l">${esc(l)}</div>
    <div class="n sm">${esc(v)}</div><div class="d">${esc(s)}</div></div>`;
  const sysStrip = `<div class="tiles" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${sysTile("Server Uptime","41d 06h 12s","since last restart")}
    ${sysTile("Last Feed","2s","since last tick")}
    ${sysTile("dxLink Feed","CONNECTED","TT → Proxy")}
    ${sysTile("TT Auth","OK","tastytrade session")}
    ${sysTile("Version","2026.09.07-v2","deployed build")}</div>`;

  const hosting = `<div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    ${sysTile(`CF Egress · ${winLabel}`,"1.2 TB","edge bandwidth served")}
    ${sysTile(`Host Net · ${hostLabel}`,"84 GB","server egress")}
    ${sysTile("Memory · App RSS","612 MB","resident set size")}
    ${sysTile(`CPU · ${gran==="live"?"Latest":hostLabel+" Avg"}`,"18.4%","host utilisation")}</div>`;

  const kpiStrip = `<div class="kpis">
    ${kpi("Visits · 12d","9,412","", { delta:{dir:"up",text:"12.4%"}, points:D.traffic, accent:"var(--cy)" })}
    ${kpi("Total users","1,284","", { delta:{dir:"up",text:"3.1%"}, points:D.cumUsers, accent:"var(--cy)" })}
    ${kpi("Subscribers","141","", { delta:{dir:"up",text:"6.8%"}, points:[40,42,44,43,47,49,52,54,57,59,62,66], accent:"#8ECAE6" })}
    ${kpi("On today","87","", { delta:{dir:"up",text:"4.2%"}, points:[20,44,66,88,74,52,38,60,82,70,48,30], accent:"var(--orange)" })}
    ${kpi("Logged in · 30d","643","", { delta:{dir:"up",text:"2.0%"}, points:[30,34,38,41,45,48,52,55,58,60,63,66], accent:"var(--lblue)" })}
    ${kpi("Waitlist","206","", { delta:{dir:"up",text:"7.3%"}, points:[10,12,14,18,20,24,28,31,36,40,44,48], accent:"var(--gold)" })}
    ${kpi("CPU","18%","", { delta:{dir:"down",text:"1.4%"}, points:[22,20,24,19,18,21,17,18,20,19,18,18], accent:"var(--softred)" })}
    ${kpi("WS out/hr","4.2 MB","", { delta:{dir:"up",text:"0.8%"}, points:[30,32,31,34,33,36,35,38,37,40,39,42], accent:"var(--cy)" })}
  </div>`;

  const chart = (title, vals, color, footL, footR, footRC) => card(title,
    barsMini(vals, color) + `<div class="chips" style="margin-top:10px;font-size:11.5px">
      <span class="mut">${esc(footL)}</span><span class="sp" style="flex:1"></span>
      <span style="color:${footRC||"var(--ok)"}">${esc(footR)}</span></div>`, {tight:true});

  const topPages = table([{t:"Page"},{t:"Loads",n:1},{t:"People",n:1},{t:"Member / guest"},{t:"Came from"},{t:"Last",n:1}],
    D.topPages.map(r=>{
      const pub = !r[0].startsWith("/app");
      return [`${pill(pub?"PUB":"APP", pub?"gd":"cy")} <span class="mono">${esc(r[0])}</span>`,
        r[1].toLocaleString(), Math.round(r[1]/4.2).toLocaleString(),
        `<span class="mut">${Math.round(r[1]*r[2]/100)} / ${r[1]-Math.round(r[1]*r[2]/100)} (${Math.round(r[1]*r[2]/140)})</span>`,
        `<span class="mut">${["Direct","Search","Social","Referral","Email","Paid"][r[1]%6]} ×${Math.round(r[1]/40)}</span>`,
        `<span class="mut">${r[1]>1000?"2m ago":"1h ago"}</span>`];
    }), {plain:true});

  const denom = `<div class="chips" style="margin-bottom:12px;font-size:11.5px;gap:14px">
    ${[["9,412","loads"],["2,241","people"],["643","with accounts"],["38","pages"],
       ["3,180","member loads (141 paying)"],["1,204","bot loads excluded"],["612","owner loads excluded"]]
      .map(([n,l])=>`<span class="mut"><b class="mono" style="color:#fff;opacity:1">${n}</b> ${l}</span>`).join("")}</div>`;

  const rowsToday = `${[["CB Snaps",312],["Prem Flow",22840],["Greeks TS",44120],["Playbook",190],
      ["ES Candles",1560],["Bzila Snaps",88],["Flow Calls",6120],["EOD GEX",3]]
    .map(([l,n])=>`<div style="padding:6px 0">
      <div class="chips" style="font-size:11.5px"><span class="mono">${l}</span>
        <span class="sp" style="flex:1"></span><b class="mono">${n.toLocaleString()}</b></div>
      ${bar(n/44120,"var(--cy)")}</div>`).join("")}`;

  const acqStats = `<div class="tiles" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:16px">
    ${[["2,241","sessions","first beacon of a visit"],["9,412","pageviews","every load, humans only"],
       ["4.2","pages / session",""],["X / organic","top channel",""],["1,204","bot loads","excluded above"]]
      .map(([v,l,h])=>`<div class="tile"><div class="n" style="font-size:19px">${v}</div>
        <div class="l" style="margin-top:4px">${l}</div>${h?`<div class="d">${h}</div>`:""}</div>`).join("")}</div>`;
  const acqBars = (title, sub, rows) => `<div style="margin-bottom:18px">
    <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">${title}</div>
    <div style="font-size:12px;color:var(--green);margin-bottom:8px">${sub}</div>
    ${rows.map(([l,n,mx])=>`<div style="padding:5px 0">
      <div class="chips" style="font-size:11.5px"><span>${l}</span><span class="sp" style="flex:1"></span>
        <b class="mono">${n.toLocaleString()}</b></div>${bar(n/mx,"var(--cy)")}</div>`).join("")}</div>`;
  const campaigns = table([{t:"Campaign"},{t:"Sessions",n:1},{t:"Signups",n:1},{t:"Paid",n:1},{t:"Conv.",n:1}],
    [["sept-levels","email · newsletter",412,31,9],["gex-thread","x · social",1204,88,22],
     ["bday","x · social",611,44,18],["podcast-ep12","referral · link",188,12,3]]
    .map(r=>[`<div>${r[0]}</div><div class="mut" style="font-size:10px">${r[1]}</div>`,
      r[2].toLocaleString(), r[3], r[4], ((r[3]/r[2])*100).toFixed(1)+"%"]), {plain:true});

  const tickerCard = (icon,title,rows) => card(`${icon} ${title}`,
    rows.map(([t,n],i)=>`<div style="padding:6px 0">
      <div class="chips" style="font-size:11.5px"><span class="mut" style="width:16px">${i+1}</span>
        <b>${t}</b><span class="sp" style="flex:1"></span>
        <span class="mono">${n.toLocaleString()}</span>
        <span class="mut" style="font-size:10px" title="impressions">${Math.round(n*2.4).toLocaleString()} imp</span></div>
      ${bar(n/1841,"var(--gold)")}</div>`).join(""),
    { right:`<span class="seg"><button>24h</button><button class="on">7d</button><button>30d</button></span>` });

  return phead("Overview", null,
      `${tabs("ControlPanel",["live","daily","weekly","monthly","yearly"],gran)}
       <span id="cpclock" class="mono mut" style="font-size:12px">09:41:07</span>
       <button class="btn sm">↻</button>`)
    + sysStrip
    + card("Hosting · Hetzner + Cloudflare", hosting,
        { right:`<span class="mono mut" style="font-size:11px">${gran==="yearly"?"30 day — no yearly upstream":gran==="live"?"live window":hostLabel==="7d"?"7 day window":"30 day window"}</span>` })
    + kpiStrip
    + `<div class="chips" style="justify-content:flex-end"><span class="mono mut" style="font-size:11px">${caption}</span></div>`
    + `<div class="grid3">
        ${chart(`Traffic · ${gran}`, D.traffic, "var(--orange)", "9,412 visits", "▲ 12%")}
        ${chart(`Signups · ${gran}`, D.signups12, "#8ECAE6", "44 new", `▲ 2 this ${gran==="monthly"?"mo":gran==="weekly"?"wk":"day"}`)}
        ${chart(`Cumulative users · ${gran}`, D.cumUsers, "#126783", "1,284 total", "643 logged in", "rgba(255,255,255,.5)")}</div>`
    + `<div style="display:grid;grid-template-columns:1.9fr 1fr;gap:clamp(16px,2vw,32px)">
        ${card("Pages being visited", denom + topPages,
          { right:`<div class="badges">
              <span class="seg"><button class="on">Everyone</button><button>Members</button><button>Non-members</button></span>
              <span class="seg"><button>24h</button><button class="on">7d</button><button>30d</button><button>All</button></span></div>` })}
        ${card("Rows written today · by table", rowsToday)}</div>`
    + card("Acquisition", acqStats
        + acqBars("Sessions by channel","how people arrived", D.acq.map(a=>[a[0],a[1],3120]))
        + acqBars("Top referrers","external sites only — self-referrals are dropped",
            [["x.com",1840,1840],["discord.com",1204,1840],["news.ycombinator.com",188,1840],["Other",96,1840]])
        + `<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase">Campaigns</div>
           <div style="font-size:12px;color:var(--green);margin-bottom:8px">links you tagged (utm_*) and inferred ad clicks — ranked by sessions</div>`
        + campaigns
        + `<div class="cap" style="margin-top:16px">Sessions are entry rows — one per browser session, the only rows carrying a referrer, so a visitor who reads six pages counts once here and six times under pageviews. Bots are excluded everywhere except the bot counter.<br><b style="opacity:.8">Signups and Paid are attributed, not audited.</b> An arrival is anonymous by definition, so the only way to connect it to the account that appears later is the account id where we have one and the IP where we don't.</div>`,
        { right:`<span class="seg"><button>24h</button><button class="on">7d</button><button>30d</button><button>All</button></span>` })
    + card("Campaign links", `<div class="chips" style="margin-bottom:12px">
        <span class="mut" style="font-size:11.5px">Lands on</span>
        ${["Landing","Pricing","Sign up","What's New"].map((s,i)=>pill(s,i===0?"cy":"mt")).join("")}</div>
      <div class="chips" style="margin-bottom:14px">
        <span class="mut" style="font-size:11.5px">Name this push <span style="opacity:.6">— optional</span></span>
        <span class="inp ph" style="width:280px">e.g. gex-thread — leave blank for the default</span></div>
      ${[["X post","in a tweet — the short one","cbedge.net/x"],
         ["X profile","the link in your bio","cbedge.net/xbio"],
         ["YouTube","video description","cbedge.net/yt"],
         ["TikTok","bio or caption","cbedge.net/tt"],
         ["Email","pasted into a message by hand","cbedge.net/email"]]
        .map(([l,n,u])=>`<div class="chips" style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.045)">
          <div style="width:120px"><div style="font-size:12.5px;font-weight:700">${l}</div>
            <div class="mut" style="font-size:10.5px">${n}</div></div>
          <span class="mono mut" style="font-size:11.5px">${u}</span>
          <span class="sp" style="flex:1"></span><button class="btn2 sm">Copy</button></div>`).join("")}`,
      { sub:"Copy and paste. The redirect adds the tracking tags. Broadcast emails tag themselves at send time." })
    + `<div class="grid2">
        ${tickerCard("📡","Flow · Ticker Visits", D.tickerClicks)}
        ${tickerCard("🎯","EM · Ticker Visits", D.tickerClicks.slice().reverse())}</div>`;
};

function barsMini(vals, color){
  const mx = Math.max(...vals)||1;
  return `<div style="display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;align-items:end;height:104px">
    ${vals.map(v=>`<div style="height:${(v/mx*100).toFixed(0)}%;background:${color};opacity:.8;border-radius:3px 3px 0 0"></div>`).join("")}</div>`;
}

/* ══════════════ VISITORS ══════════════ */
P.Visitors = () => {
  const range = tabOf("Visitors","All");
  const SC = { "Today":0.012, "7d":0.09, "30d":0.31, "90d":0.68, "All":1 }[range];
  const sf = (n,d) => Math.max(1, Math.round(n*SC)).toLocaleString();
  const stats = [[sf(9412),"loads"],[SC<0.05?"9":SC<0.4?"28":"41","countries"],[sf(1204),"visitors plotted"],
    [sf(612),"locations"],[sf(141),"subscribers"],[sf(643),"signed in"]];
  const statRow = stats.map(([v,l])=>
    `<span style="font-size:11.5px"><b class="mono">${v}</b> <span class="mut">${l}</span></span>`).join("");

  const legend = `<div class="chips" style="margin-top:14px;font-size:11px">
    <span class="mut">0</span>
    <span style="width:90px;height:8px;border-radius:8px;background:linear-gradient(90deg,rgba(33,158,188,.15),var(--cy))"></span>
    <span class="mut">38</span>
    <span style="width:14px"></span>
    <span style="width:9px;height:9px;border-radius:50%;background:var(--gold)" title="Paying subscriber (active or trialing)"></span>
    <span style="width:9px;height:9px;border-radius:50%;border:1.4px solid var(--gold)" title="Signed-in account, not paying"></span>
    <span style="width:9px;height:9px;border-radius:50%;border:1.2px solid rgba(255,255,255,.4)" title="Anonymous visitor"></span>
    <span class="mut">Visitors</span>
    <span style="width:14px"></span>
    <span class="mut">${sf(141)} paying · ${sf(502)} free · ${sf(561)} anonymous</span>
    <span class="sp" style="flex:1"></span>
    <span class="mut">United States 5,210 · United Kingdom 942 · Canada 711 · Germany 486 · Singapore 341</span></div>`;

  const detail = `
    <div style="font-size:14px;font-weight:700">m.calloway@sample-mail.test</div>
    <div class="mut" style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Subscriber</div>
    <div class="mut" style="font-size:11px;margin-bottom:12px">Austin, TX, United States</div>
    <div class="kv"><span class="k">Page loads</span><b>612</b></div>
    <div style="font-size:12px;color:var(--green);margin:12px 0 4px">Account</div>
    ${[["Email","m.calloway@sample-mail.test"],["Discord","mcallo#4417"],["User ID","a1f4c9e2b0d7…"],
       ["Member since","Feb 11, 2026"],["Last login","Sep 7, 2026"],["Subscription","active"],
       ["Location","Austin, TX, United States"],["IPs (2)","198.51.100.24, 198.51.100.88"]]
      .map(r=>`<div class="kv"><span class="k">${r[0]}</span><span class="mono" style="font-size:11.5px">${esc(r[1])}</span></div>`).join("")}
    <div style="font-size:12px;color:var(--green);margin:12px 0 4px">Top pages</div>
    ${[["ES Candles",188],["Traders Dashboard",142],["Flow",96],["Estimated Moves",71],["Options Chain",54],["GEX",41]]
      .map(r=>`<div class="kv"><span class="k">${r[0]}</span><b>${r[1]}</b></div>`).join("")}
    <div style="font-size:12px;color:var(--green);margin:12px 0 4px">Recent visits</div>
    ${[["ES Candles","Sep 7, 9:41 AM"],["Flow","Sep 7, 9:38 AM"],["Traders Dashboard","Sep 7, 9:31 AM"]]
      .map(r=>`<div style="padding:4px 0"><div class="chips" style="font-size:11.5px">
        <span>${r[0]}</span><span class="sp" style="flex:1"></span><span class="mut">${r[1]}</span></div>
        <div class="mut mono" style="font-size:10px">198.51.100.24 · a1f4c9e2b0d7…</div></div>`).join("")}`;

  return phead("Visitors · World Map", null,
      `<span class="mut" style="font-size:11.5px">Updated 09:41:07</span>
       ${pill("● last visit 2m ago","gn")}
       ${statRow}
       ${tabs("Visitors",["Today","7d","30d","90d","All"],range)}
       <button class="btn sm">↻ Refresh</button>`)
    + `<div class="synth">◆ Plotted points are synthetic. No real visitor or location data is present.</div>`
    + `<div style="display:grid;grid-template-columns:1fr 320px;gap:clamp(16px,2vw,32px)">
        ${card("Visitors · by country, one dot per person",
          `<div class="chips" style="margin-bottom:12px">
            <b class="mono" style="font-size:24px">${sf(1204)}</b>
            <span class="mut" style="font-size:12px">Worldwide · ${SC<0.05?"9":SC<0.4?"28":"41"} countries · ${sf(612)} at ${sf(612)} locations · ${sf(92)} country-level</span>
            <span class="sp" style="flex:1"></span>
            <span class="mut" style="font-size:11px">last ${sf(9412)} loads</span></div>`
          + worldMap(D.dots.slice(0, Math.max(6, Math.round(D.dots.length*Math.min(1, SC*1.6))))) + legend)}
        ${card("Detail", detail)}</div>`
    + `<div class="cap">Opens on <b style="opacity:.8">All</b> — every load ever recorded. Narrow the range to look at a window. One dot per visitor, not per city — visitors sharing a location are fanned out around it, so zoom in to separate them. A solid gold dot is a PAYING subscriber (active or trialing); a gold ring is a signed-in account that is not paying; a slate ring is an anonymous visitor, known only by IP. Click any dot for the email, Discord, user id, member-since, last login and subscription status. A <b style="opacity:.8">dashed, dimmed</b> dot has no city on its row at all and is fanned out around the middle of its country — a real visitor at a position we are guessing. Click a country or a dot to pin its detail card. Scroll to zoom, drag to pan, double-click to zoom in. Solid positions are metro centroids from the visitor's IP, not device locations.</div>`;
};
