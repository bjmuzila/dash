/* ── nav (mirrors owner-vite/src/lib/nav.ts) ─────────────── */
const NAV = {
  pinned: [{ label:"Hub", glyph:"⌂", key:"Hub" }],
  groups: [
    { label:"Info", accent:"var(--cy)", links:[
      { label:"Admin",      glyph:"⚿", key:"Admin" },
      { label:"Visitors",   glyph:"◍", key:"Visitors" },
      { label:"Overview",   glyph:"⊞", key:"ControlPanel" },
      { label:"Sales",      glyph:"$", key:"Sales" },
    ]},
    { label:"Content", accent:"var(--orange)", links:[
      { label:"Feedback",     glyph:"⚑", key:"Feedback" },
      { label:"Social Media", glyph:"🗨", key:"SocialMedia" },
      { label:"Post Studio",  glyph:"✎", key:"PostStudio" },
      { label:"Changelog",    glyph:"↻", key:"Changelog" },
      { label:"Affiliates",   glyph:"⇉", key:"Affiliates" },
      { label:"Emails",       glyph:"✉", key:"Emails" },
      { label:"Media Dump",   glyph:"🖼", key:"MediaDump" },
      { label:"Bzila Alerts", glyph:"🔔", key:"BzilaAlerts" },
    ]},
    { label:"Market", accent:"var(--gold)", links:[
      { label:"Results",       glyph:"▤", key:"Results" },
      { label:"Backtests",     glyph:"∿", key:"Backtests" },
      { label:"Probe",         glyph:"🔍", key:"Probe" },
      { label:"Greeks",        glyph:"∇", key:"Greeks" },
      { label:"ΔGEX Board",    glyph:"Δ", key:"GexGrowth" },
      { label:"Daily Grades",  glyph:"◆", key:"DailyGrades" },
      { label:"Est. Moves BE", glyph:"⇄", key:"EstimatedMove" },
      { label:"Watchlists",    glyph:"☰", key:"Watchlists" },
      { label:"Chart Types",   glyph:"▦", key:"ChartsUI" },
      { label:"LSE Data",      glyph:"⇩", key:"LseData" },
    ]},
    { label:"System", accent:"var(--lblue)", links:[
      { label:"Dev",      glyph:"⚙", key:"Dev" },
      { label:"Database", glyph:"⛁", key:"Database" },
    ]},
    { label:"Personal", accent:"var(--green)", links:[
      { label:"Budget", glyph:"⚖", key:"Budget" },
      { label:"Reta",   glyph:"⌀", key:"Reta" },
      { label:"To-Do",  glyph:"☑", key:"Todo" },
    ]},
  ],
};
const ALL = [...NAV.pinned, ...NAV.groups.flatMap(g=>g.links)];

/* ── rail ────────────────────────────────────────────────── */
function renderRail(active, q){
  const f = (q||"").trim().toLowerCase();
  const match = l => !f || l.label.toLowerCase().includes(f) || l.key.toLowerCase().includes(f);
  const link = l => `<div class="rlink ${l.key===active?"on":""}" data-go="${l.key}">
      <span class="gl">${l.glyph}</span><span>${l.label}</span></div>`;
  const pin = NAV.pinned.filter(match).map(link).join("");
  const groups = NAV.groups.map(g=>{
    const links = g.links.filter(match);
    if(!links.length) return "";
    return `<div class="rgroup"><div class="lab" style="color:${g.accent}">
      <span>${g.label}</span><span style="opacity:.6">${links.length}</span></div>${links.map(link).join("")}</div>`;
  }).join("");
  return `<div class="brand"><div class="mark">CB</div>
      <div><div class="nm">Owner</div><div class="sb">cbedge.net</div></div></div>
    <div class="railsearch"><span class="ic">⌕</span><input id="q" placeholder="Filter routes…" value="${esc(q||"")}"></div>
    ${pin}${groups}`;
}

/* ── router ──────────────────────────────────────────────── */
let ACTIVE = "Hub", QUERY = "";

function go(key){
  if(!P[key]) key = "Hub";
  ACTIVE = key;
  const meta = ALL.find(l=>l.key===key) || {label:key, glyph:"⌂"};
  const grp = NAV.groups.find(g=>g.links.some(l=>l.key===key));
  document.getElementById("rail").innerHTML = renderRail(ACTIVE, QUERY);
  document.getElementById("crumb").textContent = grp ? grp.label : "Pinned";
  document.getElementById("ttl").textContent = meta.label;
  const v = document.getElementById("view");
  v.innerHTML = `<div class="page">${P[key]()}</div>`;
  v.scrollTop = 0;
  document.body.classList.remove("railopen");
  try{ location.hash = "#" + key; }catch(e){}
  wire();
}

function wire(){
  document.querySelectorAll("[data-go]").forEach(el=>{
    el.onclick = () => go(el.getAttribute("data-go"));
  });
  const q = document.getElementById("q");
  if(q){
    q.oninput = e => {
      QUERY = e.target.value;
      document.getElementById("rail").innerHTML = renderRail(ACTIVE, QUERY);
      const nq = document.getElementById("q");
      nq.focus(); nq.setSelectionRange(QUERY.length, QUERY.length);
      wire();
    };
  }
}

function clock(){
  const d = new Date();
  const et = d.toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:false});
  const el = document.getElementById("clock");
  if(el) el.textContent = et + " ET";
}

window.addEventListener("hashchange", () => {
  const k = location.hash.replace("#","");
  if(k && k !== ACTIVE) go(k);
});

document.addEventListener("keydown", e=>{
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){
    e.preventDefault(); const q=document.getElementById("q"); if(q) q.focus();
  }
});

(function init(){
  document.getElementById("menu").onclick = () => document.body.classList.toggle("railopen");
  clock(); setInterval(clock, 1000);
  const k = location.hash.replace("#","");
  go(k && P[k] ? k : "Hub");
})();
