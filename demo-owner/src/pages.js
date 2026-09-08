/* ── page renderers ──────────────────────────────────────── */
const P = {};
const head = (h1, sub, right) => phead(h1, sub, right);

/* ══════════════ INFO ══════════════ */

P.Sales = () => {
  const mrr = D.customers.filter(c=>c.status==="active").reduce((a,c)=>a+(c.plan==="Annual"?c.amt/12:c.amt),0);
  const t = tiles([
    { l:"Monthly recurring", n:"$11,742", d:"+8.4% vs Aug", up:true,  s:[62,64,67,69,72,75,79,82,86,90,94,98] },
    { l:"Active subs",       n:"141",     d:"+9 this month", up:true, s:[40,42,44,43,47,49,52,54,57,59,62,66] },
    { l:"Total customers",   n:"1,284",   d:"+38 · 30d",     up:true, s:[60,63,66,68,71,74,77,80,83,86,89,92] },
    { l:"Collected · life",  n:"$182,400",d:"since Jan 2026", up:true,s:[8,14,22,31,41,52,64,78,92,108,126,148] },
    { l:"Trial conversion",  n:"36%",     d:"23 of 64",      up:true, s:[22,25,24,28,30,29,33,31,34,35,36,36] },
  ],5);

  const profit = barChart(D.revMonths.map(r=>({m:r.m, a:r.cash, b:r.exp})),
    { la:"Cash collected", lb:"Expense run-rate", ca:"var(--gold)", cb:"var(--orange)" });

  const subs = table(
    [{t:"Customer"},{t:"Discord"},{t:"Plan"},{t:"Amount",n:1},{t:"Status"},{t:"Renews"},{t:"Total spent",n:1}],
    D.customers.map(c=>[
      `<span class="mono">${esc(c.email)}</span>`, `<span class="mut">${esc(c.disc)}</span>`, esc(c.plan),
      money(c.amt), c.status==="active"?pill("active","gn"):c.status==="trialing"?pill("trialing","cy"):pill("canceled","rd"),
      `<span class="mut">${esc(c.renew)}</span>`, money(c.spent)
    ]));

  const cancels = table([{t:"Customer"},{t:"Ended"},{t:"Months",n:1},{t:"Reason"}],
    D.cancels.map(c=>[`<span class="mono">${esc(c.email)}</span>`, `<span class="mut">${esc(c.when)}</span>`, c.months, `<span class="mut">${esc(c.reason)}</span>`]));

  const nb = table([{t:"Signed up"},{t:"When"},{t:"Came from"},{t:"Looked at"},{t:"Got as far as"},{t:"Last seen"},{t:"Location"}],
    D.signups.map(s=>[`<span class="mono">${esc(s.email)}</span>`, `<span class="mut">${esc(s.when)}</span>`, esc(s.src),
      `<span class="mono mut">${esc(s.looked)}</span>`,
      s.far==="Reached checkout"?pill(s.far,"gd"):s.far==="Payment failed"?pill(s.far,"rd"):pill(s.far,"mt"),
      `<span class="mut">${esc(s.seen)}</span>`, `<span class="mut">${esc(s.loc)}</span>`]));

  const tr = D.trials;
  const trialCard = `<div class="grid2" style="gap:14px">
    <div>${["started","converted","active","lapsed"].map(k=>`<div class="kv"><span class="k">${k==="active"?"in trial":k}</span><b>${tr[k]}</b></div>`).join("")}
      <div class="kv"><span class="k">conversion</span><b style="color:var(--ok)">${(tr.rate*100).toFixed(0)}%</b></div>
      <div class="kv"><span class="k">revenue from trials</span><b>${money(tr.rev)}</b></div></div>
    <div>${bar(tr.rate,"var(--ok)")}<p class="note">Converted trials are counted at first successful charge, not at signup.</p></div></div>`;

  const bans = table([{t:"Subject"},{t:"Why"},{t:"Hits",n:1},{t:"State"}],
    D.bans.map(b=>[`<span class="mono">${esc(b.email)}</span>`, `<span class="mut">${esc(b.why)}</span>`, b.hits,
      b.state==="banned"?pill("banned","rd"):pill("watching","gd")]));

  const exp = table([{t:"Item"},{t:"Amount",n:1},{t:"Cadence"}],
    D.expenses.map(e=>[esc(e[0]), money(e[1]), `<span class="mut">${esc(e[2])}</span>`]));

  return head("Sales · Stripe","Revenue, subscriptions, trials and run-rate", seg(["Daily","Weekly","Monthly","Yearly"],"Monthly"))
    + synth("Revenue figures and customer records on this page are synthetic.")
    + t
    + card("Profit per month", profit, {sub:"cash collected vs expense run-rate"})
    + `<div class="grid2">${card("Active subscriptions", subs)}${card("Cancellations", cancels, {sub:"why each one ended"})}</div>`
    + card("Signed up · never bought", nb, {sub:"how far each one got", right:seg(["7d","30d","90d"],"30d")})
    + `<div class="grid2">${card("Trial conversion", trialCard)}${card("Trial abuse & bans", bans)}</div>`
    + card("Expenses", exp, {sub:"feeds the run-rate on the profit chart"});
};

P.Admin = () => {
  const checks = table([{t:"Check"},{t:"Result"}],[
    ["Stripe ↔ database drift", pill("0 rows","gn")],
    ["Accounts with access but no subscription", pill("3 · all comped","cy")],
    ["Subscriptions with no account", pill("0 rows","gn")],
    ["Orphaned comp grants past expiry", pill("1 row","gd")],
  ]);
  const fb = table([{t:"#"},{t:"Cat"},{t:"From"},{t:"Message"},{t:"Status"}],
    D.feedback.map(f=>[`<span class="mut">${f.id}</span>`, pill(f.cat, f.cat==="Bug"?"rd":f.cat==="Idea"?"gd":"mt"),
      `<span class="mono">${esc(f.email)}</span>`, `<span class="mut">${esc(f.msg)}</span>`,
      f.open?pill("open","cy"):pill("complete","mt")]));
  const comp = table([{t:"Email"},{t:"Note"},{t:"Expires"},{t:"State"}],
    D.comped.map(c=>[`<span class="mono">${esc(c.email)}</span>`, `<span class="mut">${esc(c.note)}</span>`,
      `<span class="mut">${esc(c.exp)}</span>`, c.state==="active"?pill("active","gn"):pill(c.state,"gd")]));
  const act = table([{t:"Customer"},{t:"Last login"},{t:"Time on site",n:1},{t:"Loads",n:1},{t:"Pages",n:1},{t:"Most viewed"}],
    D.customers.map(c=>[`<span class="mono">${esc(c.email)}</span>`, `<span class="mut">${esc(c.last)}</span>`,
      (c.mins/60).toFixed(1)+"h", c.loads, c.pages, `<span class="mono mut">${esc(c.top)}</span>`]));
  const np = table([{t:"Email"},{t:"Signed up"},{t:"Source"}],
    D.signups.slice(0,5).map(s=>[`<span class="mono">${esc(s.email)}</span>`,`<span class="mut">${esc(s.when)}</span>`,esc(s.src)]));
  const uns = table([{t:"Email"},{t:"When"},{t:"Why"}],
    D.unsubs.map(u=>[`<span class="mono">${esc(u.email)}</span>`,`<span class="mut">${esc(u.when)}</span>`,pill(u.why,"mt")]));

  return head("Admin","Customer operations — access, support, suppression")
    + synth()
    + tiles([{l:"Open tickets",n:"2"},{l:"Comped",n:"3"},{l:"Not paying",n:"1,143"},{l:"Suppressed",n:"2"}],4)
    + `<div class="grid2">${card("System checks", checks, {sub:"read-only diagnostics"})}${card("Comped access", comp)}</div>`
    + card("Feedback", fb, {right:seg(["Open","All"],"Open")})
    + card("Customer activity", act)
    + `<div class="grid2">${card("Signed up · not paying", np, {sub:"one click to the broadcast composer"})}${card("Unsubscribes · do not email", uns)}</div>`;
};

P.ControlPanel = () => {
  const i = D.infra;
  const sysStrip = `<div class="tiles" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${[["Server uptime",i.uptime],["Last feed",i.lastFeed],["dxLink feed",i.dxlink],["TT auth",i.ttAuth],["Version",i.version]]
      .map(([l,v])=>`<div class="tile"><div class="l">${esc(l)}</div><div class="n" style="font-size:15px">${esc(v)}</div></div>`).join("")}</div>`;
  const host = `<div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">
    ${[["CPU",i.cpu+"%"],["App RSS",i.mem],["Host egress",i.egress],["CDN bandwidth",i.cf]]
      .map(([l,v])=>`<div class="tile"><div class="l">${esc(l)}</div><div class="n" style="font-size:18px">${esc(v)}</div></div>`).join("")}</div>`;
  const x = ["","","","","","","","","","","",""];
  const traffic = lineChart([{n:"Visits", v:D.traffic, c:"var(--cy)", fill:1}], {x, zero:1});
  const signups = lineChart([{n:"Signups", v:D.signups12, c:"var(--gold)", fill:1}], {x, zero:1});
  const cum     = lineChart([{n:"Cumulative users", v:D.cumUsers, c:"var(--green)", fill:1}], {x});
  const tp = table([{t:"Path"},{t:"Loads",n:1},{t:"Members %",n:1}],
    D.topPages.map(r=>[`<span class="mono">${esc(r[0])}</span>`, r[1].toLocaleString(), r[2]+"%"]));
  const rows = table([{t:"Table"},{t:"Rows today",n:1}], D.tables.slice(0,10).map(t=>[`<span class="mono">${esc(t[0])}</span>`, t[2].toLocaleString()]));
  const acq = table([{t:"Channel"},{t:"Visits",n:1},{t:"Signups",n:1}], D.acq.map(a=>[esc(a[0]), a[1].toLocaleString(), a[2]]));
  const tk = table([{t:"Ticker"},{t:"Clicks",n:1}], D.tickerClicks.map(t=>[`<b>${esc(t[0])}</b>`, t[1].toLocaleString()]));
  return head("Overview","Live operations — infrastructure, traffic, usage", seg(["Live","Daily","Weekly","Yearly"],"Daily"))
    + sysStrip
    + card("Hosting · Hetzner + Cloudflare", host, {right:seg(["Live","7d","30d"],"7d")})
    + tiles(D.kpis, 6)
    + `<div class="grid3">${card("Traffic · 12d", traffic)}${card("Signups · 12d", signups)}${card("Cumulative users", cum)}</div>`
    + `<div class="grid2">${card("Pages being visited", tp, {right:seg(["24h","7d","30d"],"7d")})}${card("Rows written today", rows)}</div>`
    + `<div class="grid2">${card("Acquisition", acq)}${card("Ticker clicks · 7d", tk)}</div>`
    + card("Controls", `<div class="chips">
        <span class="pill p-mt">Idle mode · off</span><span class="pill p-mt">CB auto · on</span>
        <span class="pill p-mt">Maintenance · off</span><span class="pill p-cy">↻ Reconnect feed</span></div>
        <p class="note">Disabled in the demo build. On the live console these flip production behaviour.</p>`);
};

P.Visitors = () => {
  const s = D.visitorStats;
  return head("Visitors · World Map","Every page load, plotted", `<span class="mut" style="font-size:11.5px">last visit 2m ago</span>`)
    + synth("Plotted points are synthetic. No real visitor or location data is present.")
    + tiles([{l:"Loads",n:s.loads},{l:"Countries",n:s.countries},{l:"Plotted",n:s.plotted},
             {l:"Locations",n:s.locations},{l:"Subscribers",n:s.subs},{l:"Signed in",n:s.signed}],6)
    + card("", worldMap(D.dots), {right:seg(["Today","7d","30d","90d","All"],"30d")})
    + `<div class="chips" style="margin:-4px 0 16px">
        <span class="pill p-gd">● paying subscriber</span>
        <span class="pill p-gd">○ signed in, not paying</span>
        <span class="pill p-mt">○ anonymous</span></div>`
    + `<div class="grid2">
      ${card("Selected visitor", `
        <div class="kv"><span class="k">account</span><span class="mono">m.calloway@sample-mail.test</span></div>
        <div class="kv"><span class="k">discord</span><span class="mono">mcallo#4417</span></div>
        <div class="kv"><span class="k">member since</span><span>2026-02-11</span></div>
        <div class="kv"><span class="k">subscription</span>${pill("active · annual","gn")}</div>
        <div class="kv"><span class="k">last login</span><span>2026-09-07 09:41</span></div>
        <div class="kv"><span class="k">top page</span><span class="mono">/app/es-candles</span></div>
        <div class="kv"><span class="k">recent visits</span><span>612 loads · 14 pages</span></div>`)}
      ${card("Top countries", table([{t:"Country"},{t:"Loads",n:1},{t:"Subs",n:1}],
        [["United States",5210,88],["United Kingdom",942,14],["Canada",711,11],["Germany",486,7],
         ["Singapore",341,5],["Portugal",228,3]].map(r=>[esc(r[0]), r[1].toLocaleString(), r[2]])))}
    </div>`;
};

/* ══════════════ CONTENT ══════════════ */

P.SocialMedia = () => {
  const levels = `<div class="kv"><span class="k">regime</span>${pill("POSITIVE GAMMA","gn")}</div>
    ${[["Spot",6412.4],["Prior close",6398.2],["Gamma flip",6388],["Net GEX","+4.12B"],["Call wall",6450],["Put wall",6350],["Expected move","±1.28%"],["ES overnight","6428 / 6444"]]
      .map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}`;
  const cardPreview = `<div style="background:#0a0d13;border:1px solid var(--lineStrong);border-radius:14px;padding:18px">
    <div style="font-size:10px;letter-spacing:.16em;color:var(--cy);font-weight:800">CB EDGE · SPX DAILY LEVELS</div>
    <div style="font-size:26px;font-weight:800;margin:8px 0 2px">6,412<span style="font-size:14px;opacity:.5"> spot</span></div>
    <div class="chips" style="margin:10px 0 14px">${pill("+GEX · walls absorb","gn")}${pill("EM ±1.28%","cy")}</div>
    ${[["Call wall","6450"],["Gamma flip","6388"],["Put wall","6350"]].map(r=>
      `<div class="kv"><span class="k">${r[0]}</span><b>${r[1]}</b></div>`).join("")}
    <div style="margin-top:14px;font-size:10px;opacity:.35;letter-spacing:.1em">@bzilatrades · cbedge.net</div></div>
    <div class="chips" style="margin-top:12px">${pill("Copy card","mt")}${pill("Copy & open X","cy")}${pill("Share to Discord","og")}</div>`;
  return head("Social Media","Live market data → finished posts", seg(["Probe","Day Posts","Daily Levels","Explainer"],"Daily Levels"))
    + `<div class="grid2">${card("Daily input · from dashboard state", levels)}${card("Share card", cardPreview)}</div>`
    + card("Day posts", `<div class="chips" style="margin-bottom:12px">
        ${["Premarket Analysis","Midday Update","EOD Summary","Custom"].map((s,i)=>pill(s, i===0?"cy":"mt")).join("")}</div>
      <div class="chips">${["GEX Chart","Option Flow","Option Chain","Multi Greeks","ES Candles"].map(s=>pill(s,"mt")).join("")}</div>
      <p class="note">Visuals are captured from the live customer dashboard, not redrawn — the post shows the real product.</p>`);
};

P.Affiliates = () => {
  const t = tiles([
    {l:"Awaiting review",n:"2"},{l:"Code requests",n:"1"},{l:"Active affiliates",n:"3",d:"45 referred"},
    {l:"Commission owed",n:"$2,404"},{l:"Paid to date",n:"$6,880"},{l:"Commission rate",n:"25%"}],6);
  const pend = table([{t:"Applicant"},{t:"Email"},{t:"Wants code"},{t:"Audience"},{t:"Applied"},{t:""}],
    D.affPending.map(a=>[`<b>${esc(a.name)}</b>`, `<span class="mono">${esc(a.email)}</span>`,
      `<span class="mono">${esc(a.want)}</span>`, `<span class="mut">${esc(a.audience)}</span>`,
      `<span class="mut">${esc(a.when)}</span>`, `${pill("Approve","gn")} ${pill("Decline","rd")}`]));
  const roster = table([{t:"Affiliate"},{t:"Code"},{t:"Rate",n:1},{t:"Clicks",n:1},{t:"Members",n:1},{t:"Gross MTD",n:1},{t:"Owed",n:1},{t:"Method"},{t:"Status"}],
    D.affiliates.map(a=>[`<b>${esc(a.name)}</b>`, `<span class="mono">${esc(a.code)}</span>`, a.rate+"%",
      a.clicks.toLocaleString(), a.members, money(a.gross), money(a.owed), `<span class="mut">${esc(a.method)}</span>`,
      a.status==="active"?pill("active","gn"):pill("paused","mt")]));
  const pay = table([{t:"Affiliate"},{t:"Sales",n:1},{t:"Gross",n:1},{t:"Refunds",n:1},{t:"Rate",n:1},{t:"Payout",n:1},{t:"Method"},{t:"Status"}],
    D.payouts.map(p=>[`<b>${esc(p.name)}</b>`, p.sales, money(p.gross), money(p.refunds), p.rate+"%", `<b>${money(p.pay)}</b>`,
      `<span class="mut">${esc(p.method)}</span>`,
      p.status==="approved"?pill("approved","gn"):p.status==="awaiting"?pill("awaiting","gd"):pill("held","mt")]));
  return head("Affiliates · affiliate.cbedge.net","Onboarding, roster, payouts", seg(["Onboarding","Active","Payouts"],"Active"))
    + synth("Affiliate identities and payout amounts are synthetic.")
    + t
    + card("Pending applications", pend)
    + card("Active affiliates", roster)
    + card("Payouts · Sept 2026", pay, {sub:"held until the refund window closes"});
};

P.Emails = () => {
  const aud = `<div class="chips" style="margin-bottom:14px">${D.audiences.map((a,i)=>
    `<span class="pill ${i===1?"p-cy":"p-mt"}">${a.ic} ${esc(a.k)} · ${a.n.toLocaleString()}</span>`).join("")}</div>
    <div class="kv"><span class="k">recipients</span><b>141</b></div>
    <div class="kv"><span class="k">duplicates merged</span><b>0</b></div>
    <div class="kv"><span class="k">from</span><span class="mono">brandon@cbedge.net</span></div>`;
  const comp = `<div class="kv"><span class="k">subject</span><b>September levels are live</b></div>
    <div class="kv"><span class="k">campaign</span><span>Newsletter · sept-levels</span></div>
    <div class="kv"><span class="k">tracking</span><span class="mono mut">?utm_source=email&utm_campaign=sept-levels</span></div>
    <div style="margin-top:12px;background:var(--inset);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:12.5px;opacity:.7">
      Hey — the September level set is published. Weekly estimated moves updated Saturday, and the
      no-long / no-short zones are live on the Estimated Moves page…</div>
    <div class="chips" style="margin-top:12px">${pill("Show rendered preview","mt")}${pill("Send to 141","cy")}</div>`;
  const hist = table([{t:"Subject"},{t:"Sent at"},{t:"Audience"},{t:"Delivered",n:1},{t:"Failed",n:1}],
    D.sends.map(s=>[`<b>${esc(s.subj)}</b>`, `<span class="mut">${esc(s.when)}</span>`, esc(s.aud),
      s.sent.toLocaleString(), s.fail?`<span class="neg">${s.fail}</span>`:"0"]));
  return head("Email Broadcast","Recipients hidden via BCC")
    + synth("Audience counts and addresses are synthetic. Nothing on this screen can send.")
    + `<div class="grid2">${card("Audience", aud)}${card("Compose", comp)}</div>`
    + card("Sent history", hist);
};

P.Feedback = () => {
  const list = D.feedback.map((f,i)=>`
    <div style="padding:11px 12px;border-radius:11px;border:1px solid ${i===0?"var(--lineStrong)":"transparent"};
      background:${i===0?"var(--panelSolid)":"transparent"};margin-bottom:6px">
      <div class="chips" style="margin-bottom:5px">${pill(f.cat, f.cat==="Bug"?"rd":f.cat==="Idea"?"gd":"mt")}
        ${f.open?pill("open","cy"):pill("complete","mt")}<span class="mut" style="font-size:10.5px;margin-left:auto">${esc(f.when)}</span></div>
      <div class="mono" style="font-size:11.5px;opacity:.6">${esc(f.email)}</div>
      <div style="font-size:12.5px;margin-top:3px;opacity:.85">${esc(f.msg)}</div>
      <div class="mut" style="font-size:10.5px;margin-top:4px">#${f.id} · ${f.replies} replies · ${esc(f.page)}</div>
    </div>`).join("");
  const thread = `
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="align-self:flex-start;max-width:80%;background:var(--inset);border:1px solid var(--line);border-radius:12px 12px 12px 4px;padding:10px 13px;font-size:12.5px">
        Chain stops updating if I leave the tab for ~10 min and come back.
        <div class="mut" style="font-size:10px;margin-top:5px">j.ferreira · 2h ago</div></div>
      <div style="align-self:flex-end;max-width:80%;background:rgba(33,158,188,.14);border:1px solid rgba(33,158,188,.3);border-radius:12px 12px 4px 12px;padding:10px 13px;font-size:12.5px">
        That's the idle auto-shutoff on the market feed. Fix is in the next deploy — it'll reconnect on focus.
        <div class="mut" style="font-size:10px;margin-top:5px">CB Edge · 1h ago</div></div>
    </div>
    <div style="margin-top:14px;background:var(--inset);border:1px solid var(--line);border-radius:10px;padding:10px 13px;font-size:12.5px;opacity:.4">
      Reply to this customer…</div>
    <div class="chips" style="margin-top:10px">${pill("Mark complete","gn")}${pill("Send","cy")}</div>`;
  return head("Customer feedback","2 open · the other end of the in-app feedback button")
    + synth()
    + `<div class="grid2">${card("Tickets", list, {right:seg(["Open","Complete","All"],"Open")})}${card("Thread #1042", thread)}</div>`;
};

P.BzilaAlerts = () => {
  const alerts = D.alerts.map(a=>`
    <div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <div style="font-size:13px">${esc(a.t)}</div>
      <div class="chips" style="margin-top:7px">${pill("👍 "+a.up,"gn")}${pill("👎 "+a.dn,"mt")}
        <span class="mut" style="font-size:10.5px;margin-left:auto">${esc(a.age)}</span></div></div>`).join("");
  const react = table([{t:"Subscriber"},{t:"👍",n:1},{t:"👎",n:1},{t:"Alerts",n:1},{t:"First"},{t:"Last"}],
    D.reactors.map(r=>[`<span class="mono">${esc(r.who)}</span>`, r.up, r.dn, r.alerts,
      `<span class="mut">${esc(r.first)}</span>`, `<span class="mut">${esc(r.last)}</span>`]));
  return head("Bzila Alerts","Broadcasts to paid subscribers · reaction tally")
    + synth()
    + tiles([{l:"Alerts sent",n:"112"},{l:"👍 total",n:"2,841"},{l:"👎 total",n:"188"}],3)
    + `<div class="grid2">${card("All alerts", alerts)}${card("New alert",
      `<div style="background:var(--inset);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:12.5px;opacity:.4">Title (optional)</div>
       <div style="background:var(--inset);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:12.5px;opacity:.4;margin-top:8px;min-height:88px">Type an alert…</div>
       <div class="chips" style="margin-top:10px">${pill("Send alert","cy")}</div>`)}</div>`
    + card("Reactions by user", react, {sub:"all-time, survives alert deletion"});
};

P.MediaDump = () => {
  const items = [
    ["ΔGEX board on the day SPX pinned 6400","gex, screenshot"],
    ["Stripe MRR curve — August close","revenue"],
    ["Mobile GEX heatmap, iPhone 15","mobile, design"],
    ["Partner deck v1 cover","deck"],
  ];
  const grid = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${items.map((it,i)=>`
    <div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panelSolid)">
      <div style="height:88px;background:linear-gradient(135deg,rgba(33,158,188,.${2+i}),rgba(18,103,131,.1))"></div>
      <div style="padding:9px 11px"><div style="font-size:12px">${esc(it[0])}</div>
        <div class="chips" style="margin-top:6px">${it[1].split(", ").map(t=>pill(t,"mt")).join("")}</div></div></div>`).join("")}</div>`;
  return head("Media Dump","Paste anything · caption it · find it later")
    + tiles([{l:"In the dump",n:"148"},{l:"Showing",n:"4"},{l:"Pinned",n:"6"},{l:"Stored",n:"412 MB"}],4)
    + card("Sept 2026", grid);
};

P.PostStudio = () => head("Post Studio","Standalone graphic composer")
  + card("Studio", `<div style="background:#0a0d13;border:1px solid var(--line);border-radius:14px;min-height:300px;display:grid;place-items:center;text-align:center;gap:8px">
      <div style="font-size:30px;opacity:.2">✎</div>
      <div style="font-size:13px;opacity:.5">Canvas composer · PNG export</div>
      <div class="chips">${pill("Download","cy")}</div></div>`);

P.Changelog = () => head("Changelog","Read live off the running server", seg(["CHANGELOG.md","md files/"],"CHANGELOG.md"))
  + card("Source file", `<div class="kv"><span class="k">last written</span><b>2026-09-07 18:04 ET</b></div>
      <div class="kv"><span class="k">size</span><b>412 KB</b></div>`)
  + card("", `<pre class="mono" style="white-space:pre-wrap;margin:0;font-size:11.5px;opacity:.75;line-height:1.7">${esc(D.changelog)}</pre>`);

/* ══════════════ MARKET ══════════════ */

P.GexGrowth = () => {
  const rail = D.gexBoard.map((b,i)=>`
    <div style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;
      border:1px solid ${i===0?"var(--lineStrong)":"transparent"};background:${i===0?"var(--panelSolid)":"transparent"};margin-bottom:4px">
      <b style="width:52px;font-size:13px">${esc(b.sym)}</b>
      <span class="mut" style="font-size:11.5px;width:62px;text-align:right">${esc(b.net)}</span>
      <span style="font-size:11.5px;width:56px;text-align:right" class="${b.chg.startsWith("+")?"pos":"neg"}">${esc(b.chg)}</span>
      <span class="sp" style="flex:1"></span>${pill(b.regime, b.regime==="+GEX"?"gn":"rd")}</div>`).join("");
  const read = `${[["regime","+GEX · walls absorb"],["call wall","6450"],["gamma flip","6388"],["put wall","6350"],
      ["structural range","6350 – 6450"],["call vs put lean","58% call"],["0DTE share","41%"]]
      .map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}`;
  const openCard = `${[["Call wall","6450"],["Gamma flip","6388"],["Put wall","6350"],["Cushion","6400"],["Regime","+GEX"]]
      .map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}
    <div class="chips" style="margin-top:10px">${pill("SPX → ES +26","mt")}${pill("Copy as text","cy")}</div>`;
  return head("ΔGEX Board","Whole board ex-0DTE · recorded 16:05 ET · OI re-stamped 09:25 · ~400 sessions on file",
      seg(["Net GEX","Δ 1 day","Prior → now"],"Prior → now"))
    + `<div class="chips" style="margin-bottom:14px">
        ${pill("OI + Vol","cy")}${pill("OI only","mt")}${pill("Volume only","mt")}${pill("Flow (signed)","mt")}
        <span style="width:14px"></span>${pill("net","cy")}${pill("call","mt")}${pill("put","mt")}${pill("split","mt")}
        <span style="width:14px"></span>${pill("All","mt")}${pill("±5%","cy")}${pill("±3%","mt")}
        <span style="width:14px"></span><span class="mut" style="font-size:11px">session 2026-09-05</span></div>`
    + `<div style="display:grid;grid-template-columns:340px 1fr;gap:16px">
        ${card("Board · biggest move", rail)}
        ${card("SPX · strike ladder", ladder(D.ladder, 6410), {sub:"outline = prior session, fill = today"})}</div>`
    + `<div class="grid2">${card("Read", read)}${card("Open card", openCard, {sub:"the five levels to write down before the bell"})}</div>`;
};

P.DailyGrades = () => {
  const t = tiles([{l:"On watchlist",n:"169"},{l:"Graded",n:"169"},{l:"Above flip",n:"104"},
    {l:"Below flip",n:"65"},{l:"Within 0.5%",n:"41"},{l:"Session grade",n:"A-",d:"score 86",up:true}],6);
  const regime = `<div class="chips">${["+gex · walls absorb","−gex · breaks run","on the flip · chop","fade calls","break calls","stand down","wall chasing price"]
    .map((s,i)=>pill(s, i===0?"gn":i===1?"rd":"mt")).join("")}</div>`;
  const rows = table(
    [{t:"Ticker"},{t:"Regime"},{t:"The call"},{t:"Grade"},{t:"Score",n:1},{t:"Setup"},{t:"Pts",n:1},{t:"Cap",n:1},{t:"Floor",n:1},{t:"Flip",n:1},{t:"Outcome"}],
    D.grades.map(g=>[`<b>${esc(g.sym)}</b>`, pill(g.reg, g.reg==="+GEX"?"gn":"rd"), `<span class="mut">${esc(g.call)}</span>`,
      pill(g.grade, g.grade[0]==="A"?"gn":g.grade[0]==="B"?"cy":g.grade[0]==="C"?"gd":"rd"), g.score,
      `<span class="mut">${esc(g.setup)}</span>`, g.pts, g.cap, g.floor, g.flip,
      pill(g.out, /held|absorbed/.test(g.out)?"gn":/failed/.test(g.out)?"rd":"mt")]));
  const days = table([{t:"Date"},{t:"Grade"},{t:"Score",n:1},{t:"Graded",n:1},{t:"Regime held",n:1},{t:"Calls hit",n:1}],
    D.gradeDays.map(d=>[`<span class="mono">${esc(d.date)}</span>`,
      pill(d.grade, d.grade[0]==="A"?"gn":d.grade[0]==="B"?"cy":"gd"), d.score, d.graded,
      (d.held*100).toFixed(0)+"%", (d.calls*100).toFixed(0)+"%"]));
  return head("Daily Grades","Sealed 09:26 ET · graded 16:20 ET · 2026-09-05",
      seg(["Levels","Grades","Sessions"],"Grades"))
    + t
    + card("Regime read", regime)
    + card("Grades · 2026-09-05", rows)
    + card("Sessions", days, {sub:"the board is sealed before the open, so the record can't be revised"});
};

P.Results = () => {
  const cards = `<div class="grid3">${D.setups.map(s=>{
    const tot = s.w+s.l+s.c, wr = s.w/(s.w+s.l);
    return `<div class="card" style="margin:0">
      <div class="ch"><span class="t" style="font-size:13.5px">${esc(s.name)}</span><span class="sp"></span>${pill(tot+" samples","mt")}</div>
      <div style="font-size:26px;font-weight:800">${(wr*100).toFixed(0)}%<span style="font-size:12px;opacity:.4"> win rate</span></div>
      ${bar(wr, wr>0.6?"var(--ok)":wr>0.5?"var(--gold)":"var(--softred)")}
      <div class="kv" style="margin-top:8px"><span class="k">avg R</span><b>${s.r.toFixed(2)}</b></div>
      <div class="kv"><span class="k">avg MFE</span><b>${s.mfe.toFixed(2)}</b></div>
      <div class="kv"><span class="k">W / L / chop</span><b>${s.w} / ${s.l} / ${s.c}</b></div></div>`;
  }).join("")}</div>`;
  const trades = table([{t:"Date"},{t:"Time"},{t:"Contract"},{t:"Entry",n:1},{t:"Peak",n:1},{t:"P/L",n:1},{t:""}],
    D.trades.map(t=>[`<span class="mono mut">${esc(t.d)}</span>`, `<span class="mut">${esc(t.t)}</span>`,
      `<span class="mono">${esc(t.c)}</span>`, "$"+t.e.toFixed(2), t.p?"$"+t.p.toFixed(2):"—",
      t.skip?`<span class="mut">—</span>`:`<span class="${t.pl>=0?"pos":"neg"}">${money(t.pl)}</span>`,
      t.skip?pill("skipped","mt"):""]));
  const walls = table([{t:"Ticker"},{t:"Spot",n:1},{t:"Put wall",n:1},{t:"Core",n:1},{t:"Call wall",n:1},{t:"Reach (ATR)",n:1},{t:"Reaction"}],
    D.walls.map(w=>[`<b>${esc(w.sym)}</b>`, w.spot, w.put, w.core, w.call, w.reach.toFixed(1),
      pill(w.react, w.react==="rejected"?"gn":w.react==="broke"?"rd":"mt")]));
  return head("Results","Setup scoreboard, trade log and level reactions",
      seg(["ICT Results","Fail Rate","Confidence","Contracts","Walls"],"ICT Results"))
    + `<div class="chips" style="margin-bottom:14px">${pill("Today","mt")}${pill("Last 7d","mt")}${pill("All-time","cy")}</div>`
    + cards
    + `<div style="height:16px"></div>`
    + card("Contracts · trade log", trades, {sub:"disqualified candidates stay visible so the record isn't cherry-picked"})
    + card("Walls · level reactions", walls);
};

P.Backtests = () => {
  const study = (t, q, params, body) => card(t, `
    <p class="note" style="margin-top:0">${esc(q)}</p>
    <div class="chips" style="margin:12px 0">${params.map(p=>pill(p,"mt")).join("")}${pill("Run","cy")}</div>${body||""}`);
  const cbsize = table([{t:"Size bucket"},{t:"Samples",n:1},{t:"Touched",n:1},{t:"Held",n:1}],
    [["top decile",412,"0.81","0.62"],["upper half",1840,"0.66","0.51"],["lower half",1902,"0.48","0.39"],["bottom decile",388,"0.31","0.22"]]
      .map(r=>[esc(r[0]), r[1].toLocaleString(), r[2], r[3]]));
  const calib = table([{t:"Predicted"},{t:"n",n:1},{t:"Actual reach",n:1},{t:"Actual hold",n:1}],
    [["reach · high",620,"0.78","0.61"],["reach · med",1204,"0.59","0.47"],["reach · low",840,"0.34","0.28"]]
      .map(r=>[esc(r[0]), r[1].toLocaleString(), r[2], r[3]]));
  const watch = table([{t:"Symbol"},{t:"Strike",n:1},{t:"× normal",n:1},{t:"Lift LB",n:1},{t:"Flags"}],
    [["NVDA",190,"4.2×","2.1×","FLIP"],["TSLA",340,"3.8×","1.9×","UNTESTED"],["SPX",6450,"2.9×","1.6×","—"],
     ["META",730,"2.6×","1.4×","OPEX"],["AMD",178,"2.4×","1.3×","—"]]
      .map(r=>[`<b>${esc(r[0])}</b>`, r[1], r[2], r[3], r[4]==="—"?`<span class="mut">—</span>`:pill(r[4],"gd")]));
  return head("Backtests","Re-runnable edge studies over the live historical database · owner-only")
    + study("CB size → reach","Does a bigger level get touched, and held, more often?",["strike tol 2.5pt"], cbsize)
    + study("Confidence calibration","Predicted reach / hold / break vs what actually happened.",["all sessions"], calib)
    + study("GEX Watch","Strikes growing faster than that ticker normally grows, at a statistically earned cutoff.",
        ["×normal 2.0","history 90d","big move 1.5σ","run checks"], watch)
    + `<div class="grid2">${study("Normalized GEX per strike","Live chain, per ticker and expiration.",["SPX","09/12"])}
        ${study("GEX change · by ticker","One row per ticker from the very-strong change board.",["2026-09-05"])}</div>`;
};

P.EstimatedMove = () => {
  const em = table([{t:"Ticker"},{t:"Close",n:1},{t:"Exp"},{t:"EM %",n:1},{t:"Up",n:1},{t:"Down",n:1},{t:"CB conf"}],
    D.em.map(e=>[`<b>${esc(e.sym)}</b>`, e.close.toLocaleString(), `<span class="mut">${esc(e.exp)}</span>`,
      "±"+e.em.toFixed(2)+"%", e.up.toLocaleString(), e.dn.toLocaleString(),
      pill(e.conf+"%", e.conf>=75?"gn":e.conf>=65?"gd":"rd")]));
  const zn = table([{t:"Ticker"},{t:"Close",n:1},{t:"Pivot",n:1},{t:"Range",n:1},{t:"No long above",n:1},{t:"No short below",n:1}],
    D.zones.map(z=>[`<b>${esc(z.sym)}</b>`, z.close.toLocaleString(), z.pivot.toLocaleString(), z.range,
      `<span class="neg">${z.nolong.toLocaleString()}</span>`, `<span class="pos">${z.noshort.toLocaleString()}</span>`]));
  const rec = table([{t:"Week of"},{t:"Hits",n:1},{t:"Misses",n:1},{t:"Rate",n:1}],
    D.emRecord.map(r=>[`<span class="mono">${esc(r.wk)}</span>`, r.hits, r.miss,
      `<span class="${r.rate>=0.7?"pos":""}">${(r.rate*100).toFixed(0)}%</span>`]));
  return head("Estimated Moves · back end","Weekly publish — 2026-09-06 09:00 ET",
      seg(["Estimated Moves","No Short / No Long","EM Tracker","Iron Condors"],"Estimated Moves"))
    + `<div class="chips" style="margin-bottom:14px">${pill("Source: weekly publish · 2026-09-06","gn")}
        ${pill("Recompute live (inspection only)","mt")}${pill("Save snapshot","mt")}${pill("Export CSV","mt")}</div>`
    + card("Weekly estimated move · week of 09/08", em, {sub:"writes the values customers see"})
    + `<div class="grid2">${card("No short / no long zones", zn)}${card("EM Tracker · win / loss", rec)}</div>`;
};

P.Greeks = () => {
  const g = D.greeks;
  const gs = `<div class="gauges">
    ${gauge("GEX", g.GEX.v, g.GEX.pct, "var(--ok)")}
    ${gauge("DEX", g.DEX.v, g.DEX.pct, "var(--softred)")}
    ${gauge("CHEX", g.CHEX.v, g.CHEX.pct, "var(--ok)")}
    ${gauge("VEX", g.VEX.v, g.VEX.pct, "var(--softred)")}</div>`;
  const vol = `${[["30D VIX","14.8"],["1-day VIX proxy","11.2"],["10-day realized","9.4"],["IV rank","28%"],["IV percentile","34%"]]
    .map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}`;
  const matrix = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:11px">
    ${["+GEX / +DEX","+GEX / −DEX","flip / chop","−GEX / +DEX","−GEX / −DEX","pin risk","opex drift","vanna pull","charm decay"]
      .map((s,i)=>`<div style="padding:10px;border-radius:10px;text-align:center;border:1px solid ${i===1?"rgba(33,158,188,.5)":"var(--line)"};
        background:${i===1?"rgba(33,158,188,.12)":"var(--inset)"};opacity:${i===1?1:i===0||i===2?.6:.28}">${esc(s)}</div>`).join("")}</div>`;
  const flips = table([{t:"Time"},{t:"Series"},{t:"Direction"},{t:"Note"}],
    D.flips.map(f=>[`<span class="mono">${esc(f.t)}</span>`, `<b>${esc(f.w)}</b>`,
      pill(f.d, f.d.includes("→ +")?"gn":"rd"), `<span class="mut">${esc(f.note)}</span>`]));
  return head("Greeks","SPX dealer exposure · updated 15:41 ET",
      `<span class="chips">${pill("OI + Vol","cy")}${pill("Vol only","mt")}${pill("● DATA ON","gn")}</span>`)
    + gs + `<div style="height:16px"></div>`
    + `<div class="grid2">${card("Regime matrix", matrix)}${card("Volatility", vol)}</div>`
    + card("Zero-line crossings", flips, {sub:"GEX / DEX sign flips · 3 today"});
};

P.Probe = () => {
  const cards = `<div class="grid3">${D.probe.map(p=>`
    <div class="card" style="margin:0">
      <div class="ch"><span class="t" style="font-size:13.5px">${esc(p.c)}</span><span class="sp"></span>
        ${pill(p.side==="C"?"CALL":"PUT", p.side==="C"?"gn":"rd")}</div>
      <div style="font-size:28px;font-weight:800" class="${p.pct>=0?"pos":"neg"}">${p.pct>0?"+":""}${p.pct}%</div>
      <div class="kv" style="margin-top:6px"><span class="k">in → now</span><b>$${p.fill.toFixed(2)} → $${p.now.toFixed(2)}</b></div>
      <div class="kv"><span class="k">per contract</span><b class="${p.pct>=0?"pos":"neg"}">${money(Math.round((p.now-p.fill)*100))}</b></div>
      <div class="kv"><span class="k">expiry</span><b>${esc(p.exp)}</b></div>
      ${spark([p.fill*100, p.fill*112, p.fill*104, p.fill*130, p.now*88, p.now*96, p.now*100].map(Math.round), p.pct>=0?"var(--ok)":"var(--softred)")}
    </div>`).join("")}</div>`;
  return head("Probe","Records your entry, then tracks the result live")
    + card("Probe a contract", `<div class="chips">
        <span class="pill p-mt" style="padding:8px 14px">TSLA 420c 7/17 →</span>
        ${pill("Ticker","mt")}${pill("Expiration","mt")}${pill("Strike","mt")}${pill("Call","cy")}${pill("Fill price","mt")}</div>
      <p class="note">Tracking continues server-side while the browser is closed.</p>`)
    + cards;
};

P.Watchlists = () => {
  const bucket = (name, syms, hot) => `
    <div style="margin-bottom:16px">
      <div class="chips" style="margin-bottom:8px"><b style="font-size:12.5px">${esc(name)}</b>
        ${hot?pill("HOT · 2-min sweeps","og"):""}<span class="mut" style="font-size:11px">${syms.length} symbols</span></div>
      <div class="chips">${syms.map(s=>pill(s,"mt")).join("")}</div></div>`;
  const r = D.rosters;
  return head("Watchlists","Edit here — every downstream job picks it up on its next sweep",
      seg(["scanner","em","far-cb"],"scanner"))
    + `<div class="chips" style="margin-bottom:14px">${pill("● LIVE","gn")}${pill("Source: roster-store + overrides","mt")}${pill("Reset to file","mt")}</div>`
    + card("scanner", bucket("HOT", r.scanner.HOT, true)+bucket("Core", r.scanner.Core)+bucket("Wide", r.scanner.Wide),
        {sub:"34 of 169 shown"})
    + `<div class="grid2">${card("em", bucket("Weekly", r.em.Weekly))}${card("far-cb", bucket("Watch", r.farcb.Watch))}</div>`;
};

P.LseData = () => {
  const cat = table([{t:"Symbol"},{t:"Dataset"},{t:"From"},{t:"To"},{t:"Rows",n:1}],
    [["ES","futures candles","2008-01-02","2026-09-05","24,180,411"],
     ["SPX","index candles","2004-01-02","2026-09-05","18,204,880"],
     ["SPXW","option chain","2019-06-03","2026-09-05","1,204,880,102"],
     ["NQ","futures candles","2008-01-02","2026-09-05","23,914,006"],
     ["SPY","option flow","2021-01-04","2026-09-05","880,412,660"]]
      .map(r=>[`<b>${esc(r[0])}</b>`, `<span class="mut">${esc(r[1])}</span>`, `<span class="mono mut">${esc(r[2])}</span>`,
        `<span class="mono mut">${esc(r[3])}</span>`, r[4]]));
  return head("LSE Data","Licensed historical vault — preview here, download the full pull as CSV",
      seg(["Catalog","Candles","Options Chain","Options Flow","Contract Candles"],"Catalog"))
    + `<div class="chips" style="margin-bottom:14px">${pill("All datasets","cy")}${pill("Search","mt")}${pill("Timeframe 1m","mt")}${pill("Max history","mt")}${pill("Download CSV","gd")}</div>`
    + card("Catalog", cat, {sub:"preview capped at 300 rows — use Download CSV for everything"});
};

P.ChartsUI = () => {
  const fig = (t, svg, n) => `<div style="border:1px solid var(--line);border-radius:12px;padding:12px;background:var(--panelSolid)">
    <div style="font-size:11.5px;font-weight:700;margin-bottom:8px">${esc(t)}</div>${svg}
    <div class="mut" style="font-size:10.5px;margin-top:7px">${esc(n)}</div></div>`;
  const l1 = lineChart([{n:"a",v:[20,34,28,46,40,58,52,66],c:"var(--cy)",fill:1}],{w:240,h:80});
  const l2 = lineChart([{n:"a",v:[60,52,58,44,50,38,44,30],c:"var(--gold)"},{n:"b",v:[20,28,24,34,30,40,36,48],c:"var(--green)"}],{w:240,h:80});
  const b1 = barChart([{m:"M",a:40,b:22},{m:"T",a:62,b:31},{m:"W",a:48,b:26},{m:"T",a:71,b:38},{m:"F",a:55,b:29}],{w:240,h:90,la:"a",lb:"b"});
  const hm = heat([["Mon",[2,4,7,9,6,3]],["Tue",[3,6,9,8,5,2]],["Wed",[1,3,5,8,9,6]],["Thu",[4,7,8,6,4,2]],["Fri",[2,5,9,9,7,4]]]);
  return head("Chart types","Reference · 17 styles in the product palette", seg(["Wide","Grid"],"Grid"))
    + card("Time series", `<div class="grid3">${fig("Line",l1,"Trend over time")}${fig("Multi-series",l2,"Two measures, one axis")}${fig("Bar",b1,"Compare two per bucket")}</div>`)
    + card("Categorical", `<div class="grid2">${fig("Heatmap",hm,"Activity by day and hour, GEX by strike and expiry")}
        ${fig("Progress", bar(0.68,"var(--gold)")+bar(0.41,"var(--cy)")+bar(0.22,"var(--softred)"), "Share of a whole")}</div>`)
    + `<p class="note">Static sample numbers — no live feed, no charting library.</p>`;
};

/* ══════════════ SYSTEM ══════════════ */

P.Database = () => {
  const eod = `<div class="grid3">${D.eodStatus.map(e=>`
    <div class="tile"><div class="l">${esc(e.sym)}</div><div class="n" style="font-size:19px">${esc(e.gex)}</div>
      <div class="d">spot ${e.spot.toLocaleString()} · saved ${esc(e.at)}</div></div>`).join("")}</div>`;
  const picker = `<div class="chips">${D.tables.map((t,i)=>
    `<span class="pill ${i===0?"p-cy":"p-mt"}">${esc(t[0])} <span style="opacity:.5">${t[1].toLocaleString()}</span>${t[2]?` <span style="color:var(--softred)">+${t[2].toLocaleString()}</span>`:""}</span>`).join("")}</div>`;
  const grid = table([{t:"session"},{t:"symbol"},{t:"strike",n:1},{t:"call_gex",n:1},{t:"put_gex",n:1},{t:"net_gex",n:1},{t:"oi",n:1},{t:"basis"}],
    [["2026-09-05","SPX",6450,"+712,004,110","-7,102,880","+704,901,230","124,880","oi+vol"],
     ["2026-09-05","SPX",6440,"+318,220,004","-68,004,120","+250,215,884","98,204","oi+vol"],
     ["2026-09-05","SPX",6430,"+286,110,220","-50,220,884","+235,889,336","81,442","oi+vol"],
     ["2026-09-05","SPX",6400,"+402,880,110","-14,880,220","+387,999,890","142,006","oi+vol"],
     ["2026-09-05","SPX",6390,"+61,220,004","-271,880,410","-210,660,406","110,884","oi+vol"],
     ["2026-09-05","SPX",6350,"+22,110,880","-567,220,004","-545,109,124","188,402","oi+vol"]]
      .map(r=>[`<span class="mono mut">${esc(r[0])}</span>`,`<b>${esc(r[1])}</b>`,r[2],
        `<span class="pos">${r[3]}</span>`,`<span class="neg">${r[4]}</span>`,
        `<span class="${r[5].startsWith("+")?"pos":"neg"}">${r[5]}</span>`,r[6],`<span class="mut">${esc(r[7])}</span>`]));
  return head("Database","Read-only browser over the production schema",
      `<span class="chips">${pill("Date: 2026-09-05","mt")}${pill("Limit 100","mt")}</span>`)
    + synth("Rows shown are illustrative. The live console reads the production schema directly.")
    + card("EOD GEX · today", eod)
    + card("Tables · 84", picker)
    + card("eod_strike_gex", grid, {sub:"6 of 100 rows"});
};

P.Dev = () => {
  const feed = (t, rows) => `<div style="border:1px solid var(--line);border-radius:11px;padding:11px;background:var(--panelSolid)">
    <div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.4;font-weight:800;margin-bottom:7px">${esc(t)}</div>
    ${rows.map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b class="mono">${esc(r[1])}</b></div>`).join("")}</div>`;
  const oi = table([{t:"Leg"},{t:"ThetaData OI",n:1},{t:"TT REST OI",n:1},{t:"Diff",n:1},{t:"Δ%",n:1},{t:""}],
    [["Call","124,880","124,902","22","0.02%","gn"],["Put","110,884","112,004","1,120","1.01%","gn"]]
      .map(r=>[`<b>${esc(r[0])}</b>`,r[1],r[2],r[3],r[4],pill("within tolerance","gn")]));
  const calc = table([{t:"Leg"},{t:"γ",n:1},{t:"Buy",n:1},{t:"Sell",n:1},{t:"× Net",n:1},{t:"× S²",n:1},{t:"= Flow GEX",n:1}],
    [["Call","0.00412","8,204","6,110","2,094","41,118,544","+354,880,110"],
     ["Put","0.00388","5,880","9,204","-3,324","41,118,544","-530,220,884"]]
      .map(r=>[`<b>${esc(r[0])}</b>`,r[1],r[2],r[3],r[4],r[5],`<span class="${r[6].startsWith("+")?"pos":"neg"}">${r[6]}</span>`]));
  return head("Dev · symbol probe","Chain → strike resolve → market data",
      `<span class="chips">${pill("REST","cy")}${pill("SPXW","mt")}${pill("6410","mt")}${pill("09/08","mt")}${pill("Render","cy")}</span>`)
    + `<div class="grid2">
        ${card("Resolved", `<div class="kv"><span class="k">ticker</span><b>SPXW</b></div>
          <div class="kv"><span class="k">strike</span><b>6410</b></div>
          <div class="kv"><span class="k">symbol</span><b class="mono">SPXW 260908C06410000</b></div>
          <div class="kv"><span class="k">elapsed</span><b>412 ms</b></div>`)}
        ${card("Net greeks · call + put", `
          ${[["GEX","+4.12B"],["DEX","-1.86B"],["VEX","-94M"],["Theta exp","-212M"],["Vanna","+41M"],["Charm","-18M"]]
            .map(r=>`<div class="kv"><span class="k">${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("")}
          <div class="chips" style="margin-top:10px">${pill("⧉ Copy img","mt")}${pill("↗ Discord","og")}</div>`)}</div>`
    + `<div class="grid2">${card("Calls", feed("Quote",[["bid","4.10"],["ask","4.30"],["mark","4.20"]])+
        `<div style="height:8px"></div>`+feed("Greeks",[["delta","0.482"],["gamma","0.00412"],["iv","11.4%"]]))}
      ${card("Puts", feed("Quote",[["bid","3.80"],["ask","4.00"],["mark","3.90"]])+
        `<div style="height:8px"></div>`+feed("Greeks",[["delta","-0.518"],["gamma","0.00388"],["iv","12.1%"]]))}</div>`
    + card("OI check · ThetaData vs TT REST", oi, {sub:"the safeguard against publishing a number one vendor got wrong"})
    + card("Flow GEX · raw calc", calc);
};

/* ══════════════ HUB ══════════════ */

P.Hub = () => {
  const groups = NAV.groups.map(g=>`
    <div style="margin-bottom:18px">
      <div style="font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:${g.accent};margin-bottom:8px">
        ${esc(g.label)} <span style="opacity:.4">· ${g.links.length}</span></div>
      <div class="chips">${g.links.map(l=>`<span class="pill p-mt" data-go="${esc(l.key)}" style="cursor:pointer">${esc(l.glyph)} ${esc(l.label)}</span>`).join("")}</div>
    </div>`).join("");
  return head("Owner Hub","Jump to any route")
    + card("", `<div style="background:var(--inset);border:1px solid var(--line);border-radius:11px;padding:11px 14px;
        font-size:13px;opacity:.4;display:flex;align-items:center;gap:10px">Jump to a route…
        <span class="sp" style="flex:1"></span>${pill("⌘K","mt")}</div>
      <div class="chips" style="margin-top:12px"><span class="mut" style="font-size:10.5px">Pinned:</span>
        ${pill("★ Sales","gd")}${pill("★ ΔGEX Board","gd")}${pill("★ Daily Grades","gd")}</div>`)
    + card("All routes", groups);
};

/* ══════════════ PERSONAL / lite ══════════════ */

const locked = (t, s) => `<div class="card locked"><div class="lk">⌁</div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`;
const personal = t => () => head(t,"") + locked("Not included in this demo",
  "Personal household administration. No CB Edge business, customer or company data. Excluded from this build.");
P.Budget = personal("Budget"); P.Reta = personal("Reta"); P.Todo = personal("To-Do");
