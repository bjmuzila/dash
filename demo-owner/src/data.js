/* ─────────────────────────────────────────────────────────────
   DEMO DATA — every customer record below is synthetic.
   Names, emails, amounts and locations are invented for this build.
   Market/ticker figures are static illustrative values.
   ───────────────────────────────────────────────────────────── */
const D = {};

/* ── synthetic customers (5) ───────────────────────────────── */
D.customers = [
  { email:"m.calloway@sample-mail.test", disc:"mcallo#4417", city:"Austin, TX",      country:"US",
    joined:"2026-02-11", last:"2026-09-07 09:41", mins:1840, loads:612, pages:14, top:"/app/es-candles",
    plan:"Annual",  amt:400, spent:400,  status:"active",   renew:"2027-02-11" },
  { email:"j.ferreira@sample-mail.test", disc:"jferr",       city:"Lisbon, PT",      country:"PT",
    joined:"2026-04-02", last:"2026-09-07 08:12", mins:920,  loads:341, pages:11, top:"/app/traders-dashboard",
    plan:"Monthly", amt:99,  spent:495,  status:"active",   renew:"2026-10-02" },
  { email:"d.okafor@sample-mail.test",   disc:"—",           city:"London, UK",      country:"GB",
    joined:"2026-05-19", last:"2026-09-06 15:58", mins:1310, loads:498, pages:16, top:"/app/flow",
    plan:"Annual",  amt:400, spent:400,  status:"active",   renew:"2027-05-19" },
  { email:"r.whitfield@sample-mail.test",disc:"rwhit#0092",  city:"Toronto, CA",     country:"CA",
    joined:"2026-06-27", last:"2026-09-07 07:03", mins:405,  loads:157, pages:9,  top:"/app/em",
    plan:"Monthly", amt:99,  spent:297,  status:"trialing", renew:"2026-09-11" },
  { email:"s.nakamura@sample-mail.test", disc:"—",           city:"Singapore, SG",   country:"SG",
    joined:"2026-01-08", last:"2026-08-22 11:26", mins:2210, loads:803, pages:18, top:"/app/mult-greek",
    plan:"Monthly", amt:99,  spent:693,  status:"canceled", renew:"—" },
];

D.cancels = [
  { email:"s.nakamura@sample-mail.test", when:"2026-08-24", months:7, reason:"Too expensive right now" },
  { email:"p.arden@sample-mail.test",    when:"2026-08-11", months:2, reason:"Not using it enough" },
  { email:"l.gruber@sample-mail.test",   when:"2026-07-29", months:4, reason:"Switched to a broker tool" },
];

D.signups = [
  { email:"k.tanaka@sample-mail.test",  when:"2026-09-06", src:"X / organic",  looked:"/pricing",  far:"Saw pricing",     seen:"2026-09-06", loc:"Osaka, JP" },
  { email:"a.brennan@sample-mail.test", when:"2026-09-05", src:"Discord",      looked:"/app/gex",  far:"Reached checkout",seen:"2026-09-07", loc:"Dublin, IE" },
  { email:"t.osei@sample-mail.test",    when:"2026-09-03", src:"Affiliate ES", looked:"/whats-new",far:"Never saw pricing",seen:"2026-09-03",loc:"Accra, GH" },
  { email:"n.vasquez@sample-mail.test", when:"2026-09-01", src:"Direct",       looked:"/pricing",  far:"Payment failed",  seen:"2026-09-02", loc:"Bogotá, CO" },
  { email:"h.lindqvist@sample-mail.test",when:"2026-08-30",src:"X / paid",     looked:"/docs",     far:"Saw pricing",     seen:"2026-09-04", loc:"Malmö, SE" },
];

D.feedback = [
  { id:1042, cat:"Bug",  email:"j.ferreira@sample-mail.test", page:"/app/options-chain",
    msg:"Chain stops updating if I leave the tab for ~10 min and come back.", open:true, replies:2, when:"2h ago" },
  { id:1041, cat:"Idea", email:"m.calloway@sample-mail.test", page:"/app/em",
    msg:"Any chance of alerting when price tags the no-long zone?", open:true, replies:1, when:"6h ago" },
  { id:1039, cat:"Note", email:"d.okafor@sample-mail.test",   page:"/app/traders-dashboard",
    msg:"Mobile layout is genuinely good. Rare.", open:false, replies:1, when:"2d ago" },
  { id:1037, cat:"Bug",  email:"r.whitfield@sample-mail.test",page:"/sign-in",
    msg:"Discord login bounced me back to sign-in the first time.", open:false, replies:3, when:"4d ago" },
];

D.comped = [
  { email:"press@sample-mail.test",   note:"Podcast — 90 day review access", exp:"2026-11-30", state:"active" },
  { email:"a.mentor@sample-mail.test",note:"Advisor",                        exp:"—",          state:"active" },
  { email:"beta7@sample-mail.test",   note:"Beta cohort",                    exp:"2026-09-30", state:"no password yet" },
];

D.unsubs = [
  { email:"l.gruber@sample-mail.test", when:"2026-07-29", why:"Unsubscribed" },
  { email:"old.list.412@sample-mail.test", when:"2026-06-02", why:"Hard bounce" },
];

/* ── affiliates ────────────────────────────────────────────── */
D.affiliates = [
  { name:"ES Desk Notes", code:"ESDESK", rate:25, clicks:1840, members:22, gross:4380, owed:1095, method:"Stripe", status:"active" },
  { name:"Chart Fiend",   code:"FIEND",  rate:25, clicks:960,  members:9,  gross:1791, owed:448,  method:"PayPal", status:"active" },
  { name:"0DTE Weekly",   code:"ZDTE",   rate:30, clicks:2410, members:14, gross:2786, owed:836,  method:"Zelle",  status:"active" },
  { name:"Vol Curve",     code:"VCURVE", rate:25, clicks:310,  members:1,  gross:99,   owed:25,   method:"Stripe", status:"paused" },
];
D.affPending = [
  { name:"Gamma Diary", email:"gd@sample-mail.test", want:"GDIARY", audience:"11.2k on X", when:"2026-09-05" },
  { name:"Prop Room",   email:"pr@sample-mail.test", want:"PROP",   audience:"3.4k Discord", when:"2026-09-02" },
];
D.payouts = [
  { name:"ES Desk Notes", code:"ESDESK", sales:11, gross:2180, refunds:99, rate:25, pay:520, method:"Stripe", status:"approved" },
  { name:"0DTE Weekly",   code:"ZDTE",   sales:7,  gross:1386, refunds:0,  rate:30, pay:416, method:"Zelle",  status:"awaiting" },
  { name:"Chart Fiend",   code:"FIEND",  sales:4,  gross:792,  refunds:0,  rate:25, pay:198, method:"PayPal", status:"held" },
];

/* ── email broadcast ───────────────────────────────────────── */
D.audiences = [
  { k:"All users",     n:1284, ic:"👥" }, { k:"Subscribers", n:141, ic:"💳" },
  { k:"Not paying",    n:1143, ic:"🚫" }, { k:"Waitlist",    n:206, ic:"📋" },
  { k:"Old emails",    n:412,  ic:"📇" }, { k:"Custom",      n:0,   ic:"✏️" },
];
D.sends = [
  { subj:"September levels are live", when:"2026-09-02 09:00", aud:"Subscribers", sent:141, fail:0 },
  { subj:"Birthday month — annual at $400", when:"2026-09-01 08:30", aud:"All users", sent:1279, fail:5 },
  { subj:"What shipped in August", when:"2026-08-28 17:15", aud:"All users", sent:1266, fail:3 },
];

/* ── alerts ────────────────────────────────────────────────── */
D.alerts = [
  { t:"SPX flipped positive gamma at 6,412 — walls should absorb from here.", up:38, dn:2, age:"3h" },
  { t:"NQ put wall pulled ~18% overnight. Thinner floor into the open.",       up:29, dn:5, age:"1d" },
  { t:"Est. move for the week posted. SPX ±1.31%.",                            up:44, dn:1, age:"3d" },
];
D.reactors = [
  { who:"m.calloway@sample-mail.test", up:31, dn:1, alerts:34, first:"2026-02-14", last:"3h ago" },
  { who:"d.okafor@sample-mail.test",   up:26, dn:4, alerts:31, first:"2026-05-20", last:"3h ago" },
  { who:"j.ferreira@sample-mail.test", up:19, dn:2, alerts:24, first:"2026-04-05", last:"1d ago" },
];

/* ── market / tickers (static illustrative) ────────────────── */
D.spot = { SPX:6412.4, ES:6438.25, NDX:23180.6, NQ:23241.5, SPY:639.1, QQQ:563.8, IWM:241.7, VIX:14.8 };

D.gexBoard = [
  { sym:"SPX",  net:"+4.12B", chg:"+18.4%", flip:6388, call:6450, put:6350, regime:"+GEX" },
  { sym:"NVDA", net:"-812M",  chg:"-24.1%", flip:184,  call:195,  put:172,  regime:"−GEX" },
  { sym:"SPY",  net:"+1.94B", chg:"+9.2%",  flip:637,  call:645,  put:628,  regime:"+GEX" },
  { sym:"QQQ",  net:"+640M",  chg:"-3.1%",  flip:562,  call:572,  put:551,  regime:"+GEX" },
  { sym:"TSLA", net:"-410M",  chg:"+41.6%", flip:318,  call:340,  put:300,  regime:"−GEX" },
  { sym:"AAPL", net:"+288M",  chg:"+2.4%",  flip:243,  call:250,  put:235,  regime:"+GEX" },
  { sym:"META", net:"-190M",  chg:"-11.8%", flip:702,  call:730,  put:680,  regime:"−GEX" },
  { sym:"AMZN", net:"+151M",  chg:"+6.0%",  flip:229,  call:238,  put:220,  regime:"+GEX" },
];
/* strike ladder: [strike, priorGex, todayGex] in $mm */
D.ladder = [
  [6480, 210, 240],[6470, 150, 168],[6460, 320, 402],[6450, 610, 705],[6440, 280, 250],
  [6430, 190, 236],[6420, 120, 96],[6410, -80, -64],[6400, 340, 388],[6390, -150, -210],
  [6380, -260, -318],[6370, -190, -160],[6360, -110, -140],[6350, -480, -545],[6340, -220, -190],
  [6330, -140, -175],[6320, -90, -70],[6310, -60, -84],[6300, -310, -352],
];

D.grades = [
  { sym:"SPX",  reg:"+GEX", call:"Fade the cap", grade:"A", score:92, setup:"Wall hold", pts:3, cap:6450, floor:6350, flip:6388, out:"tagged · held" },
  { sym:"NVDA", reg:"−GEX", call:"Break runs",   grade:"B", score:78, setup:"Flip break", pts:2, cap:195,  floor:172,  flip:184,  out:"broke · ran" },
  { sym:"SPY",  reg:"+GEX", call:"Fade the cap", grade:"A", score:88, setup:"Wall hold", pts:3, cap:645,  floor:628,  flip:637,  out:"absorbed" },
  { sym:"QQQ",  reg:"+GEX", call:"Stand down",   grade:"C", score:61, setup:"Chop",      pts:1, cap:572,  floor:551,  flip:562,  out:"pinned" },
  { sym:"TSLA", reg:"−GEX", call:"Break runs",   grade:"D", score:42, setup:"Flip break", pts:0, cap:340,  floor:300,  flip:318,  out:"regime failed" },
  { sym:"META", reg:"−GEX", call:"Break runs",   grade:"B", score:75, setup:"Sweep",     pts:2, cap:730,  floor:680,  flip:702,  out:"gapped through" },
];
D.gradeDays = [
  { date:"2026-09-05", grade:"A-", score:86, graded:169, held:0.71, calls:0.64 },
  { date:"2026-09-04", grade:"B+", score:81, graded:169, held:0.68, calls:0.59 },
  { date:"2026-09-03", grade:"B",  score:76, graded:168, held:0.63, calls:0.57 },
  { date:"2026-09-02", grade:"A",  score:90, graded:169, held:0.74, calls:0.68 },
  { date:"2026-08-29", grade:"C+", score:66, graded:167, held:0.55, calls:0.48 },
];

D.setups = [
  { name:"Fair Value Gap",  w:41, l:22, c:9,  r:0.62, mfe:1.41 },
  { name:"Order Block",     w:33, l:19, c:7,  r:0.54, mfe:1.22 },
  { name:"Liquidity Sweep", w:52, l:24, c:11, r:0.71, mfe:1.63 },
  { name:"Judas Swing",     w:18, l:16, c:5,  r:0.11, mfe:0.94 },
  { name:"Turtle Soup",     w:27, l:14, c:6,  r:0.58, mfe:1.30 },
];
D.trades = [
  { d:"2026-09-05", t:"10:14", c:"SPXW 6410C 0DTE", e:0.85, p:4.20, pl:335 },
  { d:"2026-09-05", t:"13:02", c:"SPXW 6390P 0DTE", e:0.95, p:1.10, pl:15 },
  { d:"2026-09-04", t:"09:52", c:"SPXW 6380C 0DTE", e:0.70, p:6.10, pl:540 },
  { d:"2026-09-04", t:"14:31", c:"SPXW 6360P 0DTE", e:1.00, p:0.40, pl:-60, skip:false },
  { d:"2026-09-03", t:"11:08", c:"SPXW 6355C 0DTE", e:0.90, p:2.65, pl:175 },
  { d:"2026-09-03", t:"09:41", c:"SPXW 6340P 0DTE", e:1.35, p:0,    pl:0,  skip:true },
];
D.walls = [
  { sym:"SPX",  spot:6412, put:6350, core:6400, call:6450, near:6450, reach:0.6, chg:"+2.1%", last:"reject", react:"rejected" },
  { sym:"NVDA", spot:184,  put:172,  core:180,  call:195,  near:180,  reach:0.2, chg:"-4.0%", last:"break",  react:"broke" },
  { sym:"SPY",  spot:639,  put:628,  core:637,  call:645,  near:637,  reach:0.1, chg:"+0.4%", last:"pin",    react:"pinned" },
  { sym:"TSLA", spot:318,  put:300,  core:320,  call:340,  near:320,  reach:0.3, chg:"+6.2%", last:"new",    react:"new wall" },
];

D.em = [
  { sym:"ESU6", close:6438, exp:"09/12", em:1.31, up:6522, dn:6354, conf:78 },
  { sym:"SPX",  close:6412, exp:"09/12", em:1.28, up:6494, dn:6330, conf:81 },
  { sym:"NQU6", close:23241,exp:"09/12", em:1.84, up:23669,dn:22813,conf:72 },
  { sym:"SPY",  close:639.1,exp:"09/12", em:1.30, up:647.4,dn:630.8,conf:80 },
  { sym:"QQQ",  close:563.8,exp:"09/12", em:1.79, up:573.9,dn:553.7,conf:74 },
  { sym:"IWM",  close:241.7,exp:"09/12", em:2.05, up:246.7,dn:236.7,conf:66 },
  { sym:"NVDA", close:184.2,exp:"09/12", em:4.10, up:191.7,dn:176.7,conf:59 },
  { sym:"TSLA", close:318.4,exp:"09/12", em:5.62, up:336.3,dn:300.5,conf:54 },
];
D.zones = [
  { sym:"ESU6", close:6438, pivot:6421, range:84, nolong:6505, noshort:6337 },
  { sym:"SPX",  close:6412, pivot:6396, range:82, nolong:6478, noshort:6314 },
  { sym:"NQU6", close:23241,pivot:23180,range:428,nolong:23608,noshort:22752 },
  { sym:"SPY",  close:639.1,pivot:637.4,range:8.3,nolong:645.7,noshort:629.1 },
];
D.emRecord = [
  { wk:"2026-09-01", hits:6, miss:2, rate:0.75 },
  { wk:"2026-08-25", hits:7, miss:1, rate:0.88 },
  { wk:"2026-08-18", hits:5, miss:3, rate:0.63 },
  { wk:"2026-08-11", hits:6, miss:2, rate:0.75 },
];

D.probe = [
  { c:"SPXW 6410C", exp:"09/08", side:"C", fill:0.85, now:2.10, pct:147 },
  { c:"NVDA 190C",  exp:"09/19", side:"C", fill:3.40, now:2.86, pct:-16 },
  { c:"TSLA 300P",  exp:"09/12", side:"P", fill:5.10, now:6.95, pct:36 },
];

D.greeks = { GEX:{v:"+4.12B", pct:0.72}, DEX:{v:"-1.86B", pct:-0.34}, CHEX:{v:"+312M", pct:0.18}, VEX:{v:"-94M", pct:-0.11} };
D.flips = [
  { t:"13:48", w:"GEX", d:"− → +", note:"crossed positive" },
  { t:"11:02", w:"DEX", d:"+ → −", note:"crossed negative" },
  { t:"09:47", w:"GEX", d:"+ → −", note:"crossed negative" },
];

D.rosters = {
  scanner:{ HOT:["SPX","SPY","QQQ","ES","NQ","NVDA","TSLA"],
            Core:["AAPL","MSFT","META","AMZN","GOOGL","AMD","AVGO","NFLX","IWM","SMH","COIN","MSTR"],
            Wide:["JPM","XOM","LLY","UNH","CRM","ORCL","INTC","MU","BA","GS","PLTR","SOFI","RIOT","F","T"] },
  em:{ Weekly:["ESU6","NQU6","SPX","NDX","SPY","QQQ","IWM","SMH","NVDA","TSLA","AAPL","MSFT","META","AMZN","GOOGL","AMD","COIN","MSTR","AVGO","NFLX"] },
  farcb:{ Watch:["SPX","SPY","QQQ","NVDA","TSLA","AMD","META","MSTR"] },
};

D.tables = [
  ["eod_strike_gex", 4820114, 31402], ["greeks_ts", 18240991, 44120], ["page_visits", 412885, 1841],
  ["es_candles", 2104338, 1560], ["premium_flow", 9938201, 22840], ["mvc_snapshots", 84120, 312],
  ["eod_gex", 41208, 3], ["daily_grade_days", 1204, 169], ["watch_snapshots", 288401, 990],
  ["flow_calls", 1204880, 6120], ["playbook_feed", 42011, 190], ["bzila_snapshots", 18402, 88],
  ["users", 1284, 4], ["subscriptions", 341, 1], ["feedback", 1042, 2], ["comp_access", 12, 0],
  ["snapshots", 640, 0], ["ticker_levels", 28401, 169], ["es_stats", 3120, 8], ["roster_overrides", 41, 0],
];
D.eodStatus = [
  { sym:"$SPX", gex:"+$4.12B", spot:6412.4, at:"16:02:14 ET" },
  { sym:"SPY",  gex:"+$1.94B", spot:639.1,  at:"16:02:19 ET" },
  { sym:"QQQ",  gex:"+$640M",  spot:563.8,  at:"16:02:23 ET" },
];

/* ── ops / infra ───────────────────────────────────────────── */
D.infra = { uptime:"41d 06h", lastFeed:"2s ago", dxlink:"connected", ttAuth:"valid · 41m",
  version:"2026.09.07-v2", cpu:18, mem:"612 MB", egress:"84 GB", cf:"1.2 TB" };
D.kpis = [
  { l:"Visits · 12d", n:"9,412", d:"+12.4%", up:true,  s:[42,48,45,61,58,72,69,80,76,88,84,94] },
  { l:"Total users",  n:"1,284", d:"+38 · 30d", up:true, s:[60,62,64,66,69,71,74,76,79,81,84,88] },
  { l:"Subscribers",  n:"141",   d:"+9 · 30d",  up:true, s:[40,42,44,43,47,49,52,54,57,59,62,66] },
  { l:"On today",     n:"87",    d:"peak 112",  up:true, s:[20,44,66,88,74,52,38,60,82,70,48,30] },
  { l:"Logged in·30d",n:"643",   d:"50% of base",up:true, s:[30,34,38,41,45,48,52,55,58,60,63,66] },
  { l:"Waitlist",     n:"206",   d:"+14 · 30d",  up:true, s:[10,12,14,18,20,24,28,31,36,40,44,48] },
];
D.topPages = [
  ["/app/traders-dashboard", 2841, 61], ["/app/es-candles", 1904, 54], ["/app/flow", 1622, 48],
  ["/app/gex", 1410, 44], ["/app/em", 1188, 39], ["/pricing", 940, 12], ["/app/options-chain", 822, 33],
  ["/app/mult-greek", 704, 29], ["/whats-new", 512, 9], ["/app/scanner", 448, 21],
];
D.acq = [
  ["X / organic", 3120, 41], ["Direct", 2410, 62], ["Discord", 1840, 55],
  ["Affiliate", 1204, 71], ["X / paid", 611, 22], ["Search", 227, 18],
];
D.tickerClicks = [["SPX",1841],["NVDA",1204],["TSLA",980],["SPY",842],["QQQ",711],["NDX",520],["AMD",412],["META",388]];

/* traffic series: 12 buckets */
D.traffic  = [420,468,512,489,560,612,588,641,690,712,760,812];
D.signups12= [18,22,19,26,24,31,28,34,30,38,41,44];
D.cumUsers = [980,1002,1021,1047,1071,1102,1130,1164,1194,1232,1273,1284];
D.revMonths= [
  { m:"Apr", cash:6100, exp:1180 }, { m:"May", cash:7400, exp:1180 },
  { m:"Jun", cash:8850, exp:1240 }, { m:"Jul", cash:9620, exp:1240 },
  { m:"Aug", cash:11480, exp:1310 }, { m:"Sep", cash:4120, exp:1310 },
];
D.expenses = [
  ["VPS · Hetzner", 68, "monthly"], ["ThetaData PRO", 480, "monthly"], ["Historical vault", 350, "monthly"],
  ["Cloudflare", 25, "monthly"], ["Resend", 20, "monthly"], ["Supabase", 25, "monthly"],
  ["Stripe fees (est.)", 342, "monthly"], ["Domain renewals", 84, "one-off"],
];
D.trials = { started:64, converted:23, active:7, lapsed:34, rate:0.36, rev:4210 };
D.bans = [
  { email:"burner+12@sample-mail.test", why:"4th trial on same card fingerprint", hits:4, state:"banned" },
  { email:"ip-cluster 84.19.x.x",       why:"6 accounts, one IP",                 hits:6, state:"watching" },
];

/* visitor dots — [x%, y%, kind] kind: 2 paid, 1 signed-in, 0 anon */
D.dots = (()=>{
  const seedPts=[[24,38],[26,41],[22,35],[28,44],[30,40],[19,46],[47,30],[49,33],[51,29],[48,36],
    [45,34],[52,32],[54,38],[57,30],[62,36],[66,41],[70,34],[72,38],[74,44],[78,40],[80,48],
    [30,58],[32,62],[28,66],[34,55],[50,52],[53,58],[56,64],[46,60],[84,62],[86,58],[20,52],
    [23,49],[43,28],[41,31],[38,42],[36,48],[60,44],[64,48],[68,52],[76,36],[82,44],[25,60],
    [27,55],[44,50],[58,42],[63,32],[71,46],[79,52],[33,44]];
  return seedPts.map((p,i)=>[p[0],p[1], i%9===0?2 : i%3===0?1 : 0]);
})();
D.visitorStats = { loads:"9,412", countries:41, plotted:"1,204", locations:"612", subs:141, signed:"643" };

D.changelog = `## 2026.09.07-v2
- ΔGEX Board: flow (signed) basis added, with the honesty caveat rendered inline
- Daily Grades: per-ticker history modal now reaches back to the first sealed session
- Sales: trial-abuse clustering by card fingerprint, not just IP

## 2026.09.04-v1
- Mobile: Economic Calendar tab added to /m/*, shares lib/econCalendar with desktop
- Socket: topic scoping now covers scalar frames (spot, aux, status)

## 2026.09.01-v3
- Affiliates: payout hold released automatically once the refund window closes
- Emails: campaign UTM preview wired into the Overview acquisition panel

## 2026.08.28-v1
- Owner rail regrouped by job (Info / Content / Market / System / Personal)
- Backtests: strike-GEX watch cutoff moved to a calibrated lift lower bound`;

D.dbTables = D.tables;
