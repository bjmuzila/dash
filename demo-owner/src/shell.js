/* ── nav — 1:1 with owner-vite/src/lib/nav.ts ────────────── */
const NAV = {
  pinned: [{ label:"Hub", glyph:"⌂", key:"Hub", href:"/owner" }],
  groups: [
    { label:"Info", accent:"#219EBC", links:[
      { label:"Admin",      glyph:"⚿", key:"Admin",        href:"/owner/dev/admin" },
      { label:"Visitors",   glyph:"◍", key:"Visitors",     href:"/owner/visitors" },
      { label:"Overview",   glyph:"⊞", key:"ControlPanel", href:"/owner/dev/owner?tab=overview" },
      { label:"Sales",      glyph:"$", key:"Sales",        href:"/owner/dev/sales" },
    ]},
    { label:"Content", accent:"#FB8501", links:[
      { label:"Feedback",     glyph:"⚑", key:"Feedback",    href:"/owner/feedback" },
      { label:"Social Media", glyph:"🗨︎", key:"SocialMedia", href:"/social-media" },
      { label:"Post Studio",  glyph:"✎", key:"PostStudio",  href:"/owner/post-studio" },
      { label:"Changelog",    glyph:"↻", key:"Changelog",   href:"/changelog" },
      { label:"Affiliates",   glyph:"⇉", key:"Affiliates",  href:"/owner/affiliates" },
      { label:"Emails",       glyph:"✉", key:"Emails",      href:"/owner/admin/emails" },
      { label:"Media Dump",   glyph:"🖼︎", key:"MediaDump",   href:"/owner/media-dump" },
      { label:"Bzila Alerts", glyph:"🔔", key:"BzilaAlerts", href:"/owner/dev/bzila-alerts" },
    ]},
    { label:"Market", accent:"#FFB703", links:[
      { label:"Results",       glyph:"▤", key:"Results",       href:"/owner/dev/results" },
      { label:"Backtests",     glyph:"∿", key:"Backtests",     href:"/owner/backtests" },
      { label:"Probe",         glyph:"🔍", key:"Probe",         href:"/owner/probe" },
      { label:"Greeks",        glyph:"∇", key:"Greeks",        href:"/greeks" },
      { label:"ΔGEX Board",    glyph:"Δ", key:"GexGrowth",     href:"/owner/gex-growth" },
      { label:"Daily Grades",  glyph:"◆", key:"DailyGrades",   href:"/owner/daily-grades" },
      { label:"Est. Moves BE", glyph:"⇄", key:"EstimatedMove", href:"/estimated-move" },
      { label:"Watchlists",    glyph:"☰", key:"Watchlists",    href:"/owner/watchlists" },
      { label:"Chart Types",   glyph:"▦", key:"ChartsUI",      href:"/owner/charts-ui" },
      { label:"LSE Data",      glyph:"⇩", key:"LseData",       href:"/owner/lse-data" },
    ]},
    { label:"System", accent:"#7dd3fc", links:[
      { label:"Dev",      glyph:"⚙", key:"Dev",      href:"/owner/dev" },
      { label:"Database", glyph:"⛁", key:"Database", href:"/database" },
    ]},
    { label:"Personal", accent:"#8ECAE6", links:[
      { label:"Budget", glyph:"⚖", key:"Budget", href:"/owner/budget" },
      { label:"Reta",   glyph:"⌀", key:"Reta",   href:"/owner/reta" },
      { label:"To-Do",  glyph:"☑", key:"Todo",   href:"/owner/personal/todo" },
    ]},
  ],
};
const ALL = [...NAV.pinned, ...NAV.groups.flatMap(g=>g.links)];
const ACCENT_OF = {}; NAV.groups.forEach(g=>g.links.forEach(l=>ACCENT_OF[l.key]=g.accent));

/* ── state ───────────────────────────────────────────────── */
let ACTIVE = "Hub";
let TAB = {};                    // per-page active tab
const FAV_KEY = "cbedge.demoRail.favorites.v1";
let FAVS = (()=>{ try{ return JSON.parse(localStorage.getItem(FAV_KEY)) || []; }catch(e){ return []; } })();
function saveFavs(){ try{ localStorage.setItem(FAV_KEY, JSON.stringify(FAVS)); }catch(e){} }

/* ── rail (OwnerShell.tsx) ───────────────────────────────── */
function railLink(l, accent, opts){
  opts = opts || {};
  const here = l.key === ACTIVE;
  const starrable = opts.star !== false;
  const fav = !!opts.fav;
  const style = here
    ? `color:${accent};background:${accent}1f;border-color:${accent}59;font-weight:800`
    : "";
  return `<div class="rrow">
    <span class="rlink ${starrable?"":"nostar"}" data-go="${l.key}" style="${style}">
      <span class="gl" aria-hidden>${l.glyph}</span>${esc(l.label)}</span>
    ${starrable?`<button class="rstar ${fav?"on":""}" data-fav="${l.key}"
        title="${fav?"Remove from favorites":"Pin to favorites"}">${fav?"★":"☆"}</button>`:""}
  </div>`;
}

function renderRail(){
  const favSet = new Set(FAVS);
  const favLinks = FAVS.map(k=>ALL.find(l=>l.key===k)).filter(Boolean);
  const pinned = `<div class="rblock">${NAV.pinned.map(l=>railLink(l,"#219EBC",{star:false})).join("")}</div>`;
  const favBlock = favLinks.length
    ? `<div class="rblock"><div class="rhead" style="color:#FFB703">★ Favorites</div>
        ${favLinks.map(l=>railLink(l, ACCENT_OF[l.key]||"#219EBC", {fav:true})).join("")}
        <div class="rdiv"></div></div>`
    : "";
  const groups = NAV.groups.map(g=>{
    const links = g.links.filter(l=>!favSet.has(l.key));
    if(!links.length) return "";
    return `<div class="rblock"><div class="rhead" style="color:${g.accent}">${esc(g.label)}</div>
      ${links.map(l=>railLink(l,g.accent)).join("")}</div>`;
  }).join("");
  return pinned + favBlock + groups;
}

/* ── router ──────────────────────────────────────────────── */
function go(key){
  if(!P[key]) key = "Hub";
  ACTIVE = key;
  document.getElementById("rail").innerHTML = renderRail();
  const v = document.getElementById("view");
  v.innerHTML = `<div class="page">${P[key]()}</div>`;
  v.scrollTop = 0;
  document.body.classList.remove("railopen");
  try{ location.hash = "#" + key; }catch(e){}
  wire();
}

/* tab switch inside a page — re-renders just the page */
function setTab(page, tab){
  TAB[page] = tab;
  const v = document.getElementById("view");
  v.innerHTML = `<div class="page">${P[ACTIVE]()}</div>`;
  wire();
}
function tabOf(page, dflt){ return TAB[page] || dflt; }

function wire(){
  document.querySelectorAll("[data-go]").forEach(el=>{
    el.onclick = () => go(el.getAttribute("data-go"));
  });
  document.querySelectorAll("[data-fav]").forEach(el=>{
    el.onclick = e => {
      e.stopPropagation();
      const k = el.getAttribute("data-fav");
      FAVS = FAVS.includes(k) ? FAVS.filter(x=>x!==k) : [...FAVS, k];
      saveFavs();
      document.getElementById("rail").innerHTML = renderRail();
      wire();
    };
  });
  document.querySelectorAll("[data-tab]").forEach(el=>{
    el.onclick = () => setTab(el.getAttribute("data-tabpage") || ACTIVE, el.getAttribute("data-tab"));
  });
}

function clock(){
  const el = document.getElementById("tclock");
  if(!el) return;
  el.textContent = new Date().toLocaleTimeString("en-US",
    { timeZone:"America/New_York", hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" }) + " ET";
}

window.addEventListener("hashchange", () => {
  const k = location.hash.replace("#","");
  if(k && k !== ACTIVE) go(k);
});

(function init(){
  const m = document.getElementById("tmenu");
  if(m) m.onclick = () => document.body.classList.toggle("railopen");
  clock(); setInterval(clock, 1000);
  const k = location.hash.replace("#","");
  go(k && P[k] ? k : "Hub");
})();
