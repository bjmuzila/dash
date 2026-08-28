/**
 * X Post Studio — self-contained design tool rendered into an iframe (srcDoc).
 *
 * Kept as a raw HTML string (String.raw so regex backslashes survive) rather
 * than a file in public/, because middleware's matcher skips *.html — anything
 * in public/ would be reachable without auth. As a module it ships inside the
 * bundle and is only served from the owner-gated /owner/post-studio route.
 *
 * Standalone offline copy lives at repo root: x-post-studio.html. Edit BOTH or
 * treat this one as the source of truth.
 */
export const STUDIO_HTML = String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>CB Edge — X Post Studio</title>
<style>
  /* Palette mirrors owner-vite/src/lib/theme.ts (OWNER_THEME): cyan #219EBC is
     the single accent, surfaces use the dashboard's panel/border language.
     The old #00e5a0 green is gone — it read as a different product. */
  :root{
    --bg:#05060A;--ui:#0D1119;--ui2:#16181F;--line:rgba(255,255,255,0.10);
    --lineHard:#23272F;--mut:#8E9196;--dim:#6A6E75;
    --acc:#219EBC;--acc2:#8ECAE6;--gold:#FFB703;--txt:#FFFFFF
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--txt);font-family:"Inter","Segoe UI",-apple-system,Helvetica,Arial,sans-serif;display:flex;height:100vh;overflow:hidden}

  #side{width:330px;flex:none;background:var(--ui);border-right:1px solid var(--line);overflow-y:auto;padding:16px}
  #side h3{font-size:11px;letter-spacing:1.5px;color:var(--mut);margin:20px 0 8px;text-transform:uppercase}
  #side h3:first-child{margin-top:0}
  .row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  /* Pill "bubble" buttons — the dock's tile language: faint white fill at rest,
     cyan hover/active tile with the activeGlow from DOCK_THEME. */
  button{background:rgba(255,255,255,0.04);color:var(--txt);border:1px solid var(--line);padding:8px 13px;border-radius:999px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:700;letter-spacing:.02em;transition:background .14s,border-color .14s,color .14s,box-shadow .14s}
  button:hover{border-color:rgba(33,158,188,0.30);color:var(--acc);background:rgba(33,158,188,0.10)}
  button.pri{background:linear-gradient(180deg,rgba(33,158,188,0.16),rgba(33,158,188,0.04));color:var(--acc);border-color:rgba(33,158,188,0.30);font-weight:800;box-shadow:0 0 14px rgba(33,158,188,0.22)}
  button.pri:hover{background:linear-gradient(180deg,rgba(33,158,188,0.26),rgba(33,158,188,0.08));color:var(--acc)}
  button.on{border-color:rgba(33,158,188,0.30);color:var(--acc);background:linear-gradient(180deg,rgba(33,158,188,0.16),rgba(33,158,188,0.04));box-shadow:0 0 14px rgba(33,158,188,0.22)}
  button[disabled]{box-shadow:none}
  select,input[type=text],input[type=number]{background:rgba(0,0,0,0.40);color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:12px;width:100%;font-family:inherit;font-weight:700}
  input[type=text]::placeholder{color:var(--dim);font-weight:600}
  input[type=text]:focus,input[type=number]:focus{outline:none;border-color:rgba(33,158,188,0.30);box-shadow:0 0 14px rgba(33,158,188,0.22)}
  label{font-size:11px;color:var(--mut);display:block;margin:8px 0 4px}
  .f2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  input[type=color]{width:100%;height:32px;background:none;border:1px solid var(--line);border-radius:10px;padding:2px;cursor:pointer}
  input[type=range]{width:100%;accent-color:var(--acc)}
  .empty{color:var(--dim);font-size:12px;line-height:1.6}

  /* ── Themed dropdown ────────────────────────────────────────────────────────
     Native <select> popups are drawn by the OS and ignore page CSS, so they
     rendered as a light-grey list with a blue highlight. This is a vanilla port
     of components/ThemedSelect.tsx: the real <select> stays in the DOM (hidden)
     so every existing .value / .options / onchange call still works, and this
     draws the visible trigger + a portal'd menu over it. */
  .tsel{position:relative;width:100%}
  .tsel select{position:absolute;opacity:0;pointer-events:none;width:0;height:0;padding:0;border:0}
  .tselbtn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:8px 12px;border-radius:10px;background:rgba(0,0,0,0.40);border:1px solid var(--line)}
  .tselbtn:hover{background:rgba(0,0,0,0.40);border-color:rgba(33,158,188,0.30);color:var(--txt)}
  .tselbtn.open{border-color:rgba(33,158,188,0.30);box-shadow:0 0 14px rgba(33,158,188,0.22)}
  .tselbtn .lab{color:var(--acc);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
  .tselbtn .car{display:flex;color:var(--mut);flex:none;transition:transform .18s}
  .tselbtn.open .car{transform:rotate(180deg)}
  .tselmenu{position:fixed;z-index:9999;padding:6px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;
    background:radial-gradient(circle at 50% 0%,rgba(33,158,188,0.07) 0%,transparent 55%),rgba(10,13,20,0.98);
    backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
    border-radius:14px;border:1px solid var(--line);border-top:2px solid rgba(33,158,188,0.5);
    box-shadow:0 1px 0 rgba(255,255,255,0.06) inset,0 20px 44px -14px rgba(0,0,0,0.75),0 6px 16px rgba(0,0,0,0.45)}
  /* flex:none — the menu is a flex column with a max-height, so without it the
     rows shrink and clip their own descenders. */
  .tselmenu .opt{display:block;flex:none;width:100%;padding:8px 10px;border-radius:8px;text-align:left;font-size:12px;font-weight:600;line-height:1.45;
    color:var(--txt);background:transparent;border:1px solid transparent;box-shadow:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tselmenu .opt:hover{background:rgba(33,158,188,0.10);color:var(--txt);border-color:transparent}
  .tselmenu .opt.on{font-weight:800;color:var(--acc);background:linear-gradient(180deg,rgba(33,158,188,0.16),rgba(33,158,188,0.04));border-color:rgba(33,158,188,0.30)}
  .tselmenu::-webkit-scrollbar{width:8px}
  .tselmenu::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:8px}
  #side::-webkit-scrollbar{width:8px}
  #side::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.10);border-radius:8px}

  #main{flex:1;overflow:auto;padding:26px;display:flex;flex-direction:column;align-items:center;gap:14px}
  #bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
  #hold{position:relative}
  #stage{position:relative;overflow:hidden;transform-origin:top left;box-shadow:0 18px 40px rgba(0,0,0,.45)}
  #stage .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:100px 100px;pointer-events:none}
  #stage .bar{position:absolute;left:0;bottom:0;width:100%;height:12px}

  .ly{position:absolute;cursor:move}
  .ly.sel{outline:2px solid var(--acc);outline-offset:2px}
  .ly[data-lock="1"]{cursor:default}
  .ly[data-lock="1"].sel{outline-color:var(--gold)}
  .ly .hnd{display:none;position:absolute;right:-6px;bottom:-6px;width:16px;height:16px;background:var(--acc);border-radius:3px;cursor:nwse-resize;z-index:9}
  .ly.sel .hnd{display:block}
  .ly[data-lock="1"].sel .hnd{display:none}
  .ly[data-t=text]{padding:0}
  .ly[data-t=text] .ed{outline:none;white-space:pre-wrap;word-break:break-word}
  .ly .ed[contenteditable="true"]{cursor:text;box-shadow:0 0 0 1px var(--acc) inset}
  .ly[data-t=image]{border-radius:16px;overflow:hidden;background:#0D1119;border:1px solid var(--lineHard)}
  .ly[data-t=image] img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  .ly[data-t=image] .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:14px;font-weight:700;letter-spacing:.02em;text-align:center;padding:10px}
  .ly[data-t=logo] img{width:100%;height:100%;object-fit:contain;object-position:left center;display:block;pointer-events:none}
  .ly[data-t=box]{border-radius:18px}
  .ly[data-t=list] ul{list-style:none;margin:0;padding:0}
  .ly[data-t=list] li{display:flex;align-items:center;gap:14px;margin-bottom:16px}
  .ly[data-t=list] li:last-child{margin-bottom:0}
  .ly[data-t=list] .dot{width:11px;height:11px;border-radius:50%;flex:none}
  .ly[data-t=list] .ed{outline:none;flex:1}
  #stage.exp .ly{outline:0!important;cursor:default}
  #stage.exp .hnd{display:none}
</style>
</head>
<body>

<div id="side">
  <h3>Template</h3>
  <select id="tpl"></select>
  <div class="row" style="margin-top:8px"><button id="apply" class="pri" style="flex:1">Load template</button></div>
  <div class="row">
    <button id="tsave" style="flex:1">Save current as template</button>
    <button id="tdel">Delete</button>
  </div>
  <p class="empty" style="margin:2px 0 0">Saved templates keep layout, text and colors — image slots reset to empty so you can drop new screenshots in each time.</p>

  <h3>Auto-fill</h3>
  <div class="row"><button id="autofill" class="pri" style="flex:1">Read the screenshots</button></div>
  <p class="empty" id="afmsg" style="margin:2px 0 0">Drop your shots into the image slots, then this reads the numbers off them and fills the text layers.</p>

  <h3>Canvas</h3>
  <label>Size</label>
  <select id="size">
    <option value="1600x900">16:9 landscape — 1600×900</option>
    <option value="1200x675">16:9 small — 1200×675</option>
    <option value="1080x1080">Square — 1080×1080</option>
    <option value="1080x1350">Portrait 4:5 — 1080×1350</option>
    <option value="1200x1200">Square big — 1200×1200</option>
  </select>
  <div class="f2">
    <div><label>Background</label><input type="color" id="bg" value="#05060A"></div>
    <div><label>Accent</label><input type="color" id="ac" value="#219EBC"></div>
  </div>
  <div class="row" style="margin-top:8px">
    <button id="tgrid" class="on">Grid lines</button>
    <button id="tbar" class="on">Accent bar</button>
  </div>

  <h3>Add layer</h3>
  <div class="row">
    <button data-add="text">+ Text</button>
    <button data-add="list">+ Bullets</button>
    <button data-add="image">+ Image</button>
    <button data-add="logo">+ Logo</button>
    <button data-add="box">+ Box</button>
  </div>

  <h3>Selected layer</h3>
  <div id="insp"><p class="empty">Click a layer on the canvas to edit it.<br><br>Drag = move · corner = resize · double-click text = edit it · ctrl+click = add to selection (then Group) · scroll on an image = zoom · shift+drag an image = pan crop · arrows = nudge · Delete = remove</p></div>

  <h3>Presets</h3>
  <div class="row">
    <input type="text" id="pname" placeholder="Preset name">
  </div>
  <div class="row">
    <button id="psave" style="flex:1">Save</button>
    <select id="pload" style="flex:2"><option value="">Load preset…</option></select>
  </div>
  <div class="row"><button id="pdel">Delete preset</button></div>
</div>

<div id="main">
  <div id="bar">
    <button id="dl" class="pri">Download PNG</button>
    <button id="zin">Zoom +</button>
    <button id="zout">Zoom −</button>
    <button id="zfit">Fit</button>
    <span id="zlab" style="color:var(--mut);font-size:12px"></span>
  </div>
  <div id="hold"><div id="stage"><div class="grid"></div><div class="bar"></div></div></div>
</div>

<script>
// sel = the layer whose inspector is showing (last clicked).
// selSet = every selected layer. Dragging any of them moves the whole set, so
// grouping is just "select together and remember it" — layers in the same group
// share a data-g id and clicking one always selects all of them.
var stage=document.getElementById('stage'), W=1600, H=900, Z=0.55, sel=null, selSet=[];

// C — the one palette every template draws from, mirroring OWNER_THEME in
// owner-vite/src/lib/theme.ts. mut/dim/body are white-at-reduced-opacity
// flattened over the panel, which is how the dashboard renders muted text.
// Nothing in here is green: the accent is cyan and secondaries are its family.
var C={
  bg:'#05060A',      // OWNER_THEME.bg
  panel:'#0D1119',   // OWNER_THEME.panel
  panelUp:'#16181F', // OWNER_THEME.panelHover — nested/raised tiles
  line:'#23272F',    // border rgba(255,255,255,0.10) over panel
  body:'#C2C7D0',    // white @ ~80%
  mut:'#8E9196',     // white @ ~55% — labels
  dim:'#6A6E75',     // white @ ~38% — footers, strikethroughs
  pale:'#8ECAE6',    // OWNER_THEME.green (pale blue) — secondary highlight
  blue:'#7dd3fc',    // OWNER_LIGHT_BLUE — the card accent
  gold:'#FFB703',    // OWNER_THEME.gold — codes, badges
  orange:'#FB8501',  // OWNER_THEME.orange
  red:'#f4948e'      // SOFT_RED
};

// Every logo layer starts as the real CB Edge mark. Safe for html2canvas: the
// srcdoc iframe inherits the site origin, so this is a same-origin image and
// won't taint the export canvas. Double-click a logo layer to swap it.
var LOGO_SRC='/cb-edge-logo.png';

function px(v){return v+'px'}
function setSize(){
  stage.style.width=px(W); stage.style.height=px(H);
  applyZoom();
}
function applyZoom(){
  stage.style.transform='scale('+Z+')';
  var hold=document.getElementById('hold');
  hold.style.width=px(W*Z); hold.style.height=px(H*Z);
  document.getElementById('zlab').textContent=W+'×'+H+'  ·  '+Math.round(Z*100)+'%';
}
function fit(){
  var avail=document.getElementById('main').clientWidth-60;
  Z=Math.min(1,avail/W); applyZoom();
}
function accent(){return document.getElementById('ac').value}

function mkLayer(o){
  var d=document.createElement('div');
  d.className='ly'; d.dataset.t=o.t;
  // k = the field this layer stands for ("entry", "peak", …). Auto-fill writes
  // by key, so a layer can be moved, restyled or resized without breaking it.
  // Survives save/restore for free — those round-trip stage.innerHTML.
  if(o.k) d.dataset.k=o.k;
  d.style.left=px(o.x); d.style.top=px(o.y);
  d.style.width=px(o.w); if(o.h) d.style.height=px(o.h);

  // contenteditable is OFF until you double-click. Live contenteditable swallows
  // mousedown, which is why text layers used to be undraggable.
  if(o.t==='text'){
    d.innerHTML='<div class="ed" contenteditable="false">'+(o.html||'Your text here')+'</div>';
    var e=d.firstChild;
    e.style.fontSize=px(o.fs||48);
    e.style.fontWeight=o.fw||800;
    e.style.color=o.col||'#ffffff';
    e.style.lineHeight=o.lh||1.12;
    e.style.textAlign=o.al||'left';
    e.style.letterSpacing=px(o.ls||0);
  }
  if(o.t==='list'){
    var items=o.items||['Point one','Point two','Point three'];
    d.innerHTML='<ul>'+items.map(function(i){
      return '<li><span class="dot"></span><span class="ed" contenteditable="false">'+i+'</span></li>';
    }).join('')+'</ul>';
    d.dataset.fs=o.fs||28; d.dataset.col=o.col||C.body;
    styleList(d);
  }
  if(o.t==='image'){
    d.innerHTML='<div class="ph">'+(o.label||'Click to load image')+'</div>';
    d.addEventListener('dblclick',function(){pick(d)});
  }
  if(o.t==='logo'){
    d.innerHTML='<img src="'+LOGO_SRC+'">';
    d.style.background='none'; d.style.border='0';
    d.addEventListener('dblclick',function(){pick(d)});
  }
  if(o.t==='box'){
    d.style.background=o.bgc||C.panel;
    d.style.border='1px solid '+(o.bd||C.line);
    d.dataset.bgc=o.bgc||C.panel; d.dataset.bd=o.bd||C.line;
  }
  if(o.data) setImg(d,o.data);
  wire(d);
  stage.appendChild(d);
  return d;
}
function styleList(d){
  d.querySelectorAll('.dot').forEach(function(x){x.style.background=accent()});
  d.querySelectorAll('.ed').forEach(function(x){
    x.style.fontSize=px(d.dataset.fs); x.style.fontWeight=700; x.style.color=d.dataset.col;
  });
  d.querySelectorAll('li').forEach(function(li){li.style.marginBottom=px(Math.round(d.dataset.fs*0.58))});
}
function setImg(d,url){
  var im=d.querySelector('img');
  if(!im){ d.innerHTML='<img>'; im=d.querySelector('img'); }
  im.src=url; im.dataset.url=url;
  if(d.dataset.t==='logo'){ im.style.objectFit='contain'; }
  var h=d.querySelector('.hnd'); if(!h) addHandle(d);
}
function pick(d){
  var i=document.createElement('input'); i.type='file'; i.accept='image/*';
  i.onchange=function(){
    var f=i.files[0]; if(!f)return;
    var r=new FileReader(); r.onload=function(){setImg(d,r.result)}; r.readAsDataURL(f);
  };
  i.click();
}
function addHandle(d){
  var h=document.createElement('div'); h.className='hnd'; d.appendChild(h);
  h.addEventListener('mousedown',function(e){
    e.preventDefault(); e.stopPropagation();
    if(d.dataset.lock==='1') return;
    var x0=e.clientX,y0=e.clientY,w0=d.offsetWidth,h0=d.offsetHeight;
    var ar=h0/w0;
    function mv(ev){
      var w=Math.max(40,w0+(ev.clientX-x0)/Z);
      d.style.width=px(w);
      // Shift while dragging the handle = keep the box's aspect ratio.
      d.style.height=px(ev.shiftKey ? Math.max(30,w*ar) : Math.max(30,h0+(ev.clientY-y0)/Z));
    }
    function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up)}
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}
function wire(d){
  addHandle(d);
  // Text/bullets: double-click turns editing on, blur turns it back off, so the
  // layer is draggable the rest of the time.
  if(d.dataset.t==='text'||d.dataset.t==='list'){
    d.addEventListener('dblclick',function(ev){
      if(d.dataset.lock==='1') return;
      var t=ev.target.classList.contains('ed')?ev.target:d.querySelector('.ed');
      if(!t)return;
      t.contentEditable='true'; t.focus();
      t.addEventListener('blur',function(){t.contentEditable='false'},{once:true});
    });
  }
  d.addEventListener('mousedown',function(e){
    if(e.target.classList.contains('hnd'))return;
    if(e.target.isContentEditable) return;
    select(d, e.ctrlKey||e.metaKey);
    // ctrl+click can toggle d back OFF — don't then drag it.
    if(d.dataset.lock==='1' || selSet.indexOf(d)<0) return;
    e.preventDefault();
    var img=d.querySelector('img');
    var x0=e.clientX,y0=e.clientY;
    if(e.shiftKey && img){
      var op=(img.style.objectPosition||'50% 50%').split(' ');
      var pxp=parseFloat(op[0])||50, pyp=parseFloat(op[1])||50;
      function pmv(ev){
        img.style.objectPosition=Math.min(100,Math.max(0,pxp-(ev.clientX-x0)/Z/4))+'% '+Math.min(100,Math.max(0,pyp-(ev.clientY-y0)/Z/4))+'%';
      }
      function pup(){document.removeEventListener('mousemove',pmv);document.removeEventListener('mouseup',pup)}
      document.addEventListener('mousemove',pmv);document.addEventListener('mouseup',pup);
      return;
    }
    // Drag every unlocked layer in the selection by the same delta.
    var movers=selSet.filter(function(x){return x.dataset.lock!=='1'});
    if(movers.indexOf(d)<0) movers=[d];
    var st=movers.map(function(x){return [x.offsetLeft,x.offsetTop]});
    function mv(ev){
      var dx=(ev.clientX-x0)/Z, dy=(ev.clientY-y0)/Z;
      movers.forEach(function(x,i){ x.style.left=px(st[i][0]+dx); x.style.top=px(st[i][1]+dy); });
    }
    function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up)}
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
  d.addEventListener('wheel',function(e){
    var img=d.querySelector('img'); if(!img||d.dataset.t==='logo')return;
    e.preventDefault();
    var z=Math.min(4,Math.max(1,(parseFloat(img.dataset.z||'1'))+(e.deltaY<0?0.08:-0.08)));
    img.dataset.z=z; img.style.width=(z*100)+'%'; img.style.height=(z*100)+'%';
  },{passive:false});
}
function groupOf(d){
  return d.dataset.g ? [].slice.call(stage.querySelectorAll('.ly[data-g="'+d.dataset.g+'"]')) : [d];
}
function select(d,add){
  if(!d){ selSet=[]; }
  else {
    var grp=groupOf(d);
    if(add){
      if(selSet.indexOf(d)>=0) selSet=selSet.filter(function(x){return grp.indexOf(x)<0});
      else grp.forEach(function(x){ if(selSet.indexOf(x)<0) selSet.push(x); });
    } else selSet=grp;
  }
  document.querySelectorAll('.ly').forEach(function(x){x.classList.toggle('sel',selSet.indexOf(x)>=0)});
  sel = (d && selSet.indexOf(d)>=0) ? d : (selSet[selSet.length-1]||null);
  inspector();
}
stage.addEventListener('mousedown',function(e){ if(e.target===stage||e.target.classList.contains('grid')) select(null); });

function inspector(){
  var p=document.getElementById('insp');
  if(!sel){ p.innerHTML='<p class="empty">Click a layer on the canvas to edit it.<br><br>Drag = move · corner = resize · double-click text = edit it · ctrl+click = add to selection (then Group) · scroll on an image = zoom · shift+drag an image = pan crop · arrows = nudge · Delete = remove</p>'; return; }
  // With more than one layer selected only the group/lock controls make sense —
  // per-layer styling would be ambiguous.
  var multi=selSet.length>1;
  var t=multi?'':sel.dataset.t, h='';
  if(multi){
    h+='<p class="empty" style="margin:0 0 8px">'+selSet.length+' layers selected'+(sel.dataset.g?' · grouped':'')+'</p>';
  }
  if(t==='text'){
    var e=sel.querySelector('.ed');
    h+='<label>Font size</label><input type="range" id="i_fs" min="12" max="130" value="'+parseInt(e.style.fontSize)+'">';
    h+='<div class="f2"><div><label>Weight</label><select id="i_fw"><option>400</option><option>600</option><option>700</option><option>800</option></select></div>';
    h+='<div><label>Color</label><input type="color" id="i_col" value="'+rgb2hex(e.style.color)+'"></div></div>';
    h+='<label>Align</label><div class="row"><button data-al="left">Left</button><button data-al="center">Center</button><button data-al="right">Right</button></div>';
    h+='<div class="row"><button id="i_acc">Use accent color</button></div>';
  }
  if(t==='list'){
    h+='<label>Font size</label><input type="range" id="l_fs" min="14" max="60" value="'+sel.dataset.fs+'">';
    h+='<div class="row"><button id="l_add">+ Bullet</button><button id="l_rm">− Bullet</button></div>';
  }
  if(t==='image'||t==='logo'){
    h+='<div class="row"><button id="i_load" class="pri" style="flex:1">Load image…</button></div>';
    if(t==='image'){
      var im0=sel.querySelector('img');
      var z0=im0?parseFloat(im0.dataset.z||'1'):1;
      var op0=im0?(im0.style.objectPosition||'50% 50%').split(' '):['50%','50%'];
      var fit0=im0?(im0.style.objectFit||'cover'):'cover';
      h+='<label>Fit inside the box</label><div class="row">'
        +'<button data-fit="cover" class="'+(fit0==='cover'?'on':'')+'">Crop to fill</button>'
        +'<button data-fit="contain" class="'+(fit0==='contain'?'on':'')+'">Show whole image</button>'
        +'</div>';
      h+='<label>Zoom</label><input type="range" id="i_z" min="1" max="4" step="0.02" value="'+z0+'">';
      h+='<label>Position — horizontal</label><input type="range" id="i_x" min="0" max="100" value="'+parseFloat(op0[0])+'">';
      h+='<label>Position — vertical</label><input type="range" id="i_y" min="0" max="100" value="'+parseFloat(op0[1])+'">';
      h+='<div class="row" style="margin-top:8px"><button id="i_snap" class="pri" style="flex:1">Fit box to image</button></div>';
      h+='<div class="row"><button id="i_full">Fill canvas</button><button id="i_reset">Reset image</button></div>';
    }
  }
  if(t==='box'){
    h+='<div class="f2"><div><label>Fill</label><input type="color" id="b_bg" value="'+sel.dataset.bgc+'"></div><div><label>Border</label><input type="color" id="b_bd" value="'+sel.dataset.bd+'"></div></div>';
    h+='<div class="row" style="margin-top:8px"><button id="b_op">Toggle 50% opacity</button></div>';
  }
  var anyG=selSet.some(function(x){return !!x.dataset.g});
  var allLock=selSet.length>0 && selSet.every(function(x){return x.dataset.lock==='1'});
  h+='<label style="margin-top:14px">Group &amp; lock</label><div class="row">';
  h+='<button id="i_grp"'+(selSet.length<2?' disabled style="opacity:.45"':'')+'>Group</button>';
  h+='<button id="i_ungrp"'+(anyG?'':' disabled style="opacity:.45"')+'>Ungroup</button>';
  h+='<button id="i_lock" class="'+(allLock?'on':'')+'">'+(allLock?'Unlock':'Lock')+'</button>';
  h+='</div>';
  h+='<div class="row" style="margin-top:8px"><button id="i_front">Bring front</button><button id="i_dup">Duplicate</button><button id="i_del">Delete</button></div>';
  p.innerHTML=h;

  var g=function(i){return document.getElementById(i)};
  if(t==='text'){
    var e2=sel.querySelector('.ed');
    g('i_fs').oninput=function(){e2.style.fontSize=px(this.value)};
    g('i_fw').value=e2.style.fontWeight||'800';
    g('i_fw').onchange=function(){e2.style.fontWeight=this.value};
    g('i_col').oninput=function(){e2.style.color=this.value};
    g('i_acc').onclick=function(){e2.style.color=accent(); g('i_col').value=accent()};
    p.querySelectorAll('[data-al]').forEach(function(b){b.onclick=function(){e2.style.textAlign=b.dataset.al}});
  }
  if(t==='list'){
    g('l_fs').oninput=function(){sel.dataset.fs=this.value; styleList(sel)};
    g('l_add').onclick=function(){
      var li=document.createElement('li');
      li.innerHTML='<span class="dot"></span><span class="ed" contenteditable="false">New point</span>';
      sel.querySelector('ul').appendChild(li); styleList(sel);
    };
    g('l_rm').onclick=function(){
      var ls=sel.querySelectorAll('li'); if(ls.length>1) ls[ls.length-1].remove();
    };
  }
  if(t==='image'||t==='logo'){
    g('i_load').onclick=function(){pick(sel)};
    if(t==='image'){
      var im=function(){return sel.querySelector('img')};
      var opGet=function(){ var m=im(); return (m&&m.style.objectPosition||'50% 50%').split(' '); };
      var opSet=function(x,y){ var m=im(); if(m) m.style.objectPosition=x+'% '+y+'%'; };

      p.querySelectorAll('[data-fit]').forEach(function(b){
        b.onclick=function(){
          var m=im(); if(!m) return;
          m.style.objectFit=b.dataset.fit;
          p.querySelectorAll('[data-fit]').forEach(function(o){o.classList.remove('on')});
          b.classList.add('on');
        };
      });
      g('i_z').oninput=function(){
        var m=im(); if(!m) return;
        m.dataset.z=this.value;
        m.style.width=(this.value*100)+'%'; m.style.height=(this.value*100)+'%';
      };
      g('i_x').oninput=function(){ opSet(this.value, parseFloat(opGet()[1])); };
      g('i_y').oninput=function(){ opSet(parseFloat(opGet()[0]), this.value); };

      // Reshape the frame to the screenshot's own aspect ratio: keeps the box's
      // current width, solves for the height that matches naturalWidth/Height,
      // then resets the crop. No cropping, no letterbox bars.
      g('i_snap').onclick=function(){
        var m=im();
        if(!m||!m.naturalWidth){ alert('Load an image into this box first.'); return; }
        m.dataset.z=1; m.style.width='100%'; m.style.height='100%';
        m.style.objectPosition='50% 50%'; m.style.objectFit='contain';
        var w=sel.offsetWidth;
        sel.style.height=px(Math.round(w*m.naturalHeight/m.naturalWidth));
        inspector();
      };
      g('i_full').onclick=function(){sel.style.left='0px';sel.style.top='0px';sel.style.width=px(W);sel.style.height=px(H);sel.style.borderRadius='0';sel.style.border='0'};
      g('i_reset').onclick=function(){
        var m=im(); if(!m) return;
        m.dataset.z=1; m.style.width='100%'; m.style.height='100%';
        m.style.objectPosition='50% 50%'; m.style.objectFit='cover';
        inspector();
      };
    }
  }
  if(t==='box'){
    g('b_bg').oninput=function(){sel.dataset.bgc=this.value; sel.style.background=this.value};
    g('b_bd').oninput=function(){sel.dataset.bd=this.value; sel.style.border='1px solid '+this.value};
    g('b_op').onclick=function(){sel.style.opacity = (sel.style.opacity==='0.5'?'1':'0.5')};
  }
  g('i_grp').onclick=function(){
    if(selSet.length<2) return;
    var id='g'+Date.now().toString(36);
    selSet.forEach(function(x){x.dataset.g=id});
    select(sel);
  };
  g('i_ungrp').onclick=function(){
    selSet.forEach(function(x){delete x.dataset.g});
    select(sel);
  };
  g('i_lock').onclick=function(){
    var lock=!allLock;
    selSet.forEach(function(x){ if(lock) x.dataset.lock='1'; else delete x.dataset.lock; });
    inspector();
  };
  g('i_front').onclick=function(){ selSet.forEach(function(x){stage.appendChild(x)}); };
  g('i_dup').onclick=function(){
    // Duplicating a group keeps them grouped, under a fresh id.
    var id=selSet.length>1?'g'+Date.now().toString(36):null;
    var copies=selSet.map(function(x){
      var c=x.cloneNode(true);
      c.style.left=px(x.offsetLeft+30); c.style.top=px(x.offsetTop+30);
      c.classList.remove('sel'); var oh=c.querySelector('.hnd'); if(oh)oh.remove();
      c.querySelectorAll('.ed').forEach(function(n){n.contentEditable='false'});
      if(id) c.dataset.g=id; else delete c.dataset.g;
      wire(c); stage.appendChild(c); return c;
    });
    selSet=copies; sel=copies[copies.length-1];
    document.querySelectorAll('.ly').forEach(function(x){x.classList.toggle('sel',copies.indexOf(x)>=0)});
    inspector();
  };
  g('i_del').onclick=function(){ selSet.forEach(function(x){x.remove()}); select(null)};
}
function rgb2hex(c){
  if(!c) return '#ffffff';
  if(c[0]==='#') return c;
  var m=c.match(/\d+/g); if(!m) return '#ffffff';
  return '#'+m.slice(0,3).map(function(n){return ('0'+parseInt(n).toString(16)).slice(-2)}).join('');
}

document.addEventListener('keydown',function(e){
  if(!sel || document.activeElement.isContentEditable) return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();selSet.forEach(function(x){x.remove()});select(null);return}
  var k={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(!k)return; e.preventDefault();
  var s=e.shiftKey?10:1;
  selSet.forEach(function(x){
    if(x.dataset.lock==='1') return;
    x.style.left=px(x.offsetLeft+k[0]*s); x.style.top=px(x.offsetTop+k[1]*s);
  });
});

document.querySelectorAll('[data-add]').forEach(function(b){
  b.onclick=function(){
    var t=b.dataset.add, o={t:t,x:120,y:120,w:600};
    if(t==='text'){o.html='Edit me';o.w=800;}
    if(t==='list'){o.w=760;}
    if(t==='image'){o.w=600;o.h=340;}
    if(t==='logo'){o.w=420;o.h=140;}
    if(t==='box'){o.w=500;o.h=220;}
    select(mkLayer(o));
  };
});

var TPL={
  feature:function(){return [
    {t:'logo',x:90,y:70,w:440,h:150},
    {t:'text',x:90,y:250,w:800,html:'The data desks pay for.<br><span style="color:'+accent()+'">Built for retail.</span>',fs:62,fw:800},
    {t:'list',x:90,y:430,w:800,fs:28,items:['IB stats — 8 years historical','3 years historical estimated move','Live GEX charts &amp; full greeks','400+ stock options flow','Heatmaps, stats &amp; more']},
    {t:'image',x:900,y:70,w:640,h:340,label:'GEX chart'},
    {t:'image',x:840,y:340,w:520,h:290,label:'Options flow'},
    {t:'image',x:1000,y:560,w:540,h:290,label:'Heatmap'}
  ]},
  hero:function(){return [
    {t:'image',x:0,y:0,w:W,h:H,label:'Full dashboard screenshot'},
    {t:'box',x:0,y:0,w:Math.round(W*0.62),h:H,bgc:C.bg,bd:C.bg},
    {t:'logo',x:90,y:80,w:440,h:150},
    {t:'text',x:90,y:270,w:820,html:'The data desks pay for.<br><span style="color:'+accent()+'">Built for retail.</span>',fs:62,fw:800},
    {t:'list',x:90,y:450,w:800,fs:28,items:['Live GEX charts &amp; full greeks','400+ stock options flow','8 years of IB stats','Heatmaps, stats &amp; more']}
  ]},
  grid:function(){return [
    {t:'logo',x:90,y:60,w:340,h:110},
    {t:'text',x:470,y:80,w:1040,html:'Everything you need to trade the tape.',fs:36,fw:800},
    {t:'box',x:90,y:230,w:460,h:250},
    {t:'image',x:100,y:240,w:440,h:170,label:'Shot 1'},
    {t:'text',x:110,y:420,w:420,html:'Live GEX &amp; greeks',fs:23,fw:700},
    {t:'box',x:574,y:230,w:460,h:250},
    {t:'image',x:584,y:240,w:440,h:170,label:'Shot 2'},
    {t:'text',x:594,y:420,w:420,html:'400+ ticker flow',fs:23,fw:700},
    {t:'box',x:1058,y:230,w:460,h:250},
    {t:'image',x:1068,y:240,w:440,h:170,label:'Shot 3'},
    {t:'text',x:1078,y:420,w:420,html:'Heatmaps &amp; stats',fs:23,fw:700},
    {t:'box',x:90,y:504,w:944,h:250},
    {t:'text',x:130,y:545,w:860,html:'8 YEARS',fs:60,fw:800,col:accent()},
    {t:'text',x:130,y:625,w:860,html:'of historical IB stats — backtested context on every session.',fs:26,fw:700,col:C.body},
    {t:'box',x:1058,y:504,w:460,h:250},
    {t:'text',x:1098,y:545,w:380,html:'3 YEARS',fs:60,fw:800,col:C.pale},
    {t:'text',x:1098,y:625,w:380,html:'historical estimated move',fs:24,fw:700,col:C.body}
  ]},
  stat:function(){return [
    {t:'logo',x:90,y:70,w:380,h:130},
    {t:'text',x:90,y:300,w:1400,html:'400+',fs:190,fw:800,col:accent(),lh:1},
    {t:'text',x:90,y:530,w:1100,html:'tickers of live options flow — every sweep, block and split, as it prints.',fs:44,fw:700},
    {t:'text',x:90,y:790,w:900,html:'cbedge.net',fs:26,fw:700,col:C.mut}
  ]},
  promo:function(){return [
    {t:'logo',x:90,y:70,w:400,h:140},
    {t:'text',x:90,y:260,w:900,html:'Lock in founder pricing.',fs:64,fw:800},
    {t:'box',x:90,y:390,w:420,h:200},
    {t:'text',x:130,y:420,w:340,html:'Monthly',fs:24,fw:700,col:C.mut},
    {t:'text',x:130,y:465,w:340,html:'<s style="color:'+C.dim+'">$120</s> <span style="color:'+accent()+'">$45</span>/mo',fs:46,fw:800},
    {t:'text',x:130,y:540,w:340,html:'code MONTH',fs:20,fw:700,col:C.gold},
    {t:'box',x:540,y:390,w:420,h:200},
    {t:'text',x:580,y:420,w:340,html:'Yearly',fs:24,fw:700,col:C.mut},
    {t:'text',x:580,y:465,w:340,html:'<s style="color:'+C.dim+'">$1000</s> <span style="color:'+accent()+'">$500</span>/yr',fs:46,fw:800},
    {t:'text',x:580,y:540,w:340,html:'code YEAR',fs:20,fw:700,col:C.gold},
    {t:'list',x:90,y:640,w:880,fs:24,items:['Live GEX, greeks &amp; key levels','400+ ticker options flow','8 years of IB stats · cancel anytime']},
    {t:'image',x:1010,y:120,w:520,h:660,label:'Dashboard screenshot'}
  ]},
  quote:function(){return [
    {t:'logo',x:90,y:70,w:380,h:130},
    {t:'text',x:90,y:290,w:1420,html:'Most retail traders are flying blind.<br><span style="color:'+accent()+'">CB Edge isn\'t.</span>',fs:78,fw:800},
    {t:'text',x:90,y:600,w:1200,html:'Real-time gamma, orderflow and key levels — the same read the desks are working with.',fs:34,fw:700,col:C.body},
    {t:'text',x:90,y:790,w:900,html:'cbedge.net',fs:26,fw:700,col:C.mut}
  ]},
  win:function(){return [
    {t:'logo',x:80,y:56,w:330,h:110},
    {t:'text',x:80,y:186,w:900,html:'THE SCANNER FLAGGED IT.',fs:26,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:232,w:920,html:'PLTR 140C <span style="color:'+accent()+'">+129.6%</span>',fs:72,fw:800},
    {t:'box',x:80,y:350,w:900,h:150},
    {t:'text',x:112,y:378,w:260,html:'ENTRY',fs:18,fw:700,col:C.mut,ls:2},
    {t:'text',x:112,y:410,w:260,html:'$1.35',fs:44,fw:800},
    {t:'text',x:392,y:378,w:260,html:'NOW',fs:18,fw:700,col:C.mut,ls:2},
    {t:'text',x:392,y:410,w:260,html:'$3.10',fs:44,fw:800,col:accent()},
    {t:'text',x:672,y:378,w:280,html:'PER CONTRACT',fs:18,fw:700,col:C.mut,ls:2},
    {t:'text',x:672,y:410,w:280,html:'+$175',fs:44,fw:800,col:accent()},
    {t:'list',x:80,y:540,w:900,fs:25,items:['$3.2M sweep · 8.2% OTM · +101% vs open','Scanner score 60 — flagged “Very strong”','Jul 24 expiry · spot 129.37 at the print']},
    {t:'image',x:1010,y:56,w:520,h:400,label:'Scanner card screenshot'},
    {t:'image',x:1010,y:480,w:520,h:330,label:'Option price chart screenshot'},
    {t:'text',x:80,y:812,w:900,html:'cbedge.net · not financial advice',fs:20,fw:700,col:C.dim}
  ]},

  // ── Post types that match what actually goes out on @BzilaTrades ──────────
  // levels · updates · explain · earnings · recap · signal

  /* Daily "here are the walls" post — the pinned-tweet format as a card. */
  levels:function(){return [
    {t:'logo',x:80,y:56,w:340,h:112},
    {t:'text',x:80,y:186,w:900,html:'$SPX · KEY LEVELS · 0DTE',fs:22,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:228,w:920,html:'Where the dealers are <span style="color:'+accent()+'">pinned.</span>',fs:56,fw:800},
    {t:'box',x:80,y:340,w:900,h:112},
    {t:'text',x:116,y:366,w:340,html:'CALL WALL',fs:19,fw:700,col:C.mut,ls:2},
    {t:'text',x:560,y:360,w:220,html:'7450',fs:44,fw:800,col:accent()},
    {t:'text',x:800,y:376,w:160,html:'resistance',fs:20,fw:700,col:C.dim},
    {t:'box',x:80,y:466,w:900,h:112},
    {t:'text',x:116,y:492,w:340,html:'GAMMA FLIP',fs:19,fw:700,col:C.mut,ls:2},
    {t:'text',x:560,y:486,w:220,html:'7405',fs:44,fw:800,col:C.gold},
    {t:'text',x:800,y:502,w:160,html:'regime line',fs:20,fw:700,col:C.dim},
    {t:'box',x:80,y:592,w:900,h:112},
    {t:'text',x:116,y:618,w:340,html:'PUT WALL',fs:19,fw:700,col:C.mut,ls:2},
    {t:'text',x:560,y:612,w:220,html:'7350',fs:44,fw:800,col:C.pale},
    {t:'text',x:800,y:628,w:160,html:'support',fs:20,fw:700,col:C.dim},
    {t:'text',x:80,y:736,w:900,html:'Updated live all day — not a morning screenshot.',fs:26,fw:700,col:C.body},
    {t:'text',x:80,y:790,w:900,html:'cbedge.net · not financial advice',fs:20,fw:700,col:C.dim},
    {t:'image',x:1020,y:56,w:500,h:788,label:'GEX ladder / levels screenshot'}
  ]},

  /* "Shipped this week" — changelog / newest updates post. */
  updates:function(){return [
    {t:'logo',x:80,y:56,w:340,h:112},
    {t:'text',x:80,y:186,w:900,html:'WHAT&#39;S NEW',fs:22,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:228,w:920,html:'Shipped <span style="color:'+accent()+'">this week.</span>',fs:58,fw:800},
    {t:'box',x:80,y:348,w:900,h:404},
    {t:'list',x:124,y:392,w:820,fs:27,items:['New — ES/SPX ladder with live gamma walls','New — estimated-move stat cards for earnings','Faster — GEX refresh cut to under a second','Fixed — RTH/ETH toggle now holds across pages','Discord alerts fire the moment DEX crosses zero']},
    {t:'text',x:80,y:790,w:900,html:'Full changelog at cbedge.net/whats-new',fs:22,fw:700,col:C.dim},
    {t:'image',x:1020,y:56,w:500,h:696,label:'Screenshot of the new feature'},
    {t:'box',x:1020,y:788,w:500,h:56,bgc:C.panelUp},
    {t:'text',x:1052,y:802,w:440,html:'Free 2-day trial · cbedge.net',fs:22,fw:700,col:C.pale}
  ]},

  /* Big screenshot + numbered callouts — the "here's how to read it" post. */
  explain:function(){return [
    {t:'logo',x:80,y:52,w:300,h:100},
    {t:'text',x:420,y:60,w:600,html:'HOW TO READ IT',fs:20,fw:700,col:C.mut,ls:3},
    {t:'text',x:420,y:92,w:620,html:'The GEX ladder, line by line.',fs:38,fw:800},
    {t:'image',x:80,y:186,w:940,h:620,label:'Screenshot to annotate'},
    {t:'box',x:1060,y:186,w:460,h:190},
    {t:'text',x:1092,y:210,w:400,html:'1',fs:32,fw:800,col:accent()},
    {t:'text',x:1092,y:258,w:400,html:'Say what this part of the chart is showing you.',fs:23,fw:700,col:C.body},
    {t:'box',x:1060,y:401,w:460,h:190},
    {t:'text',x:1092,y:425,w:400,html:'2',fs:32,fw:800,col:accent()},
    {t:'text',x:1092,y:473,w:400,html:'Then what it means for where price can go.',fs:23,fw:700,col:C.body},
    {t:'box',x:1060,y:616,w:460,h:190},
    {t:'text',x:1092,y:640,w:400,html:'3',fs:32,fw:800,col:accent()},
    {t:'text',x:1092,y:688,w:400,html:'Then the trade it sets up. Keep it to one idea.',fs:23,fw:700,col:C.body},
    {t:'text',x:80,y:836,w:900,html:'cbedge.net · not financial advice',fs:20,fw:700,col:C.dim}
  ]},

  /* Earnings estimated-move stat card — the $AMD-style post. */
  earnings:function(){return [
    {t:'logo',x:80,y:52,w:320,h:106},
    {t:'text',x:1140,y:74,w:380,html:'cbedge.net',fs:22,fw:700,col:C.dim,al:'right'},
    {t:'text',x:80,y:178,w:900,html:'EARNINGS · ESTIMATED MOVE',fs:22,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:216,w:900,html:'$AMD',fs:84,fw:800},
    {t:'text',x:80,y:326,w:900,html:'Reports Tuesday after the close.',fs:30,fw:700,col:C.pale},
    {t:'box',x:80,y:404,w:350,h:184},
    {t:'text',x:112,y:432,w:290,html:'EXPECTED MOVE',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:112,y:466,w:290,html:'±5.8%',fs:50,fw:800,col:accent()},
    {t:'text',x:112,y:534,w:290,html:'$9.42 either side',fs:19,fw:700,col:C.dim},
    {t:'box',x:454,y:404,w:350,h:184},
    {t:'text',x:486,y:432,w:290,html:'UPPER',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:486,y:466,w:290,html:'$172.30',fs:50,fw:800,col:C.pale},
    {t:'text',x:486,y:534,w:290,html:'1σ to the upside',fs:19,fw:700,col:C.dim},
    {t:'box',x:828,y:404,w:350,h:184},
    {t:'text',x:860,y:432,w:290,html:'LOWER',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:860,y:466,w:290,html:'$153.46',fs:50,fw:800,col:C.red},
    {t:'text',x:860,y:534,w:290,html:'1σ to the downside',fs:19,fw:700,col:C.dim},
    {t:'box',x:1202,y:404,w:350,h:184},
    {t:'text',x:1234,y:432,w:290,html:'IV CRUSH',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:1234,y:466,w:290,html:'−38%',fs:50,fw:800,col:C.gold},
    {t:'text',x:1234,y:534,w:290,html:'front-month, post-print',fs:19,fw:700,col:C.dim},
    {t:'image',x:80,y:624,w:1472,h:224,label:'Estimated-move stat card screenshot'}
  ]},

  /* "Called it" recap — the level on the left, what price did on the right. */
  recap:function(){return [
    {t:'logo',x:80,y:52,w:320,h:106},
    {t:'text',x:80,y:176,w:1000,html:'CALLED IT.',fs:24,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:216,w:1300,html:'7450 retest — <span style="color:'+accent()+'">clean rejection.</span>',fs:62,fw:800},
    {t:'box',x:80,y:344,w:720,h:412},
    {t:'text',x:112,y:370,w:640,html:'THE LEVEL WE POSTED',fs:18,fw:700,col:C.mut,ls:2},
    {t:'image',x:112,y:404,w:656,h:322,label:'Levels / GEX screenshot'},
    {t:'box',x:840,y:344,w:720,h:412},
    {t:'text',x:872,y:370,w:640,html:'WHAT PRICE DID',fs:18,fw:700,col:C.mut,ls:2},
    {t:'image',x:872,y:404,w:656,h:322,label:'Chart screenshot'},
    {t:'text',x:80,y:790,w:1000,html:'Same levels, every session — cbedge.net',fs:24,fw:700,col:C.body},
    {t:'text',x:80,y:834,w:1000,html:'not financial advice',fs:20,fw:700,col:C.dim}
  ]},

  /* Live alert card — "DEX crossed 0", Discord signal posts. */
  signal:function(){return [
    {t:'logo',x:80,y:56,w:340,h:112},
    {t:'box',x:80,y:190,w:250,h:44,bgc:C.panelUp},
    {t:'text',x:104,y:200,w:210,html:'CB EDGE SIGNALS',fs:18,fw:800,col:accent(),ls:2},
    {t:'text',x:80,y:262,w:1000,html:'DEX crossed <span style="color:'+accent()+'">zero.</span>',fs:66,fw:800},
    {t:'box',x:80,y:388,w:900,h:124},
    {t:'text',x:116,y:412,w:380,html:'FIRED',fs:18,fw:700,col:C.mut,ls:2},
    {t:'text',x:116,y:442,w:380,html:'9:48 AM ET',fs:38,fw:800},
    {t:'text',x:560,y:412,w:380,html:'SPOT',fs:18,fw:700,col:C.mut,ls:2},
    {t:'text',x:560,y:442,w:380,html:'7,412.55',fs:38,fw:800,col:accent()},
    {t:'list',x:80,y:552,w:900,fs:26,items:['Gamma flipped positive — dealers buying dips','Call wall 7450 · put wall 7350','Pushed to Discord the second it fires']},
    {t:'text',x:80,y:822,w:900,html:'cbedge.net · alerts in real time · not financial advice',fs:20,fw:700,col:C.dim},
    {t:'image',x:1020,y:56,w:500,h:788,label:'Signal / alert card screenshot'}
  ]},

  /* Two-screenshot alert result — the daily "here's what the alerts did" post.
     Everything except the two image slots is rendered type, so the whole job is
     load template → drop in the alerts-table strip and the option-price chart →
     retype four numbers → Download PNG.

     The two slots are sized to the aspect ratio the tracker actually exports,
     so object-fit:cover lands flush and nothing has to be zoomed or panned:
       · alerts table strip  ~1013x196  (5.17:1)  → 660x128
       · option price chart  ~1014x624  (1.63:1)  → 660x406
     Resize a slot from its corner with shift held to keep that ratio. */
  alerts:function(){return [
    // ── left column: the rendered story ──────────────────────────────────
    {t:'logo',x:80,y:52,w:320,h:106},
    {t:'text',x:80,y:184,w:720,html:'0DTE ALERT · RESULT',fs:22,fw:700,col:C.mut,ls:3},
    {t:'text',x:80,y:222,w:760,html:'SPXW 7750C',fs:62,fw:800,k:'contract'},
    {t:'text',x:80,y:300,w:760,html:'<span style="color:'+accent()+'">+440.9%</span> to the peak',fs:44,fw:800,k:'pct'},
    {t:'box',x:80,y:392,w:720,h:158},
    {t:'text',x:112,y:420,w:200,html:'ENTRY',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:112,y:452,w:200,html:'$4.65',fs:44,fw:800,k:'entry'},
    {t:'text',x:352,y:420,w:200,html:'PEAK',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:352,y:452,w:200,html:'$25.15',fs:44,fw:800,col:accent(),k:'peak'},
    {t:'text',x:592,y:420,w:200,html:'PER CONTRACT',fs:17,fw:700,col:C.mut,ls:2},
    {t:'text',x:592,y:452,w:200,html:'+$2,050',fs:40,fw:800,col:accent(),k:'perContract'},
    {t:'list',x:80,y:586,w:720,fs:25,items:['Called 10:30 AM · peak 11:01 AM','Three alerts fired — all three ran','Posted live, tracked to the tick after'],k:'bullets'},
    {t:'text',x:80,y:834,w:900,html:'cbedge.net · not financial advice',fs:20,fw:700,col:C.dim},

    // ── right column: the two screenshot slots + CTA ─────────────────────
    {t:'text',x:860,y:56,w:660,html:'THE ALERTS THAT FIRED',fs:18,fw:700,col:C.mut,ls:2},
    {t:'image',x:860,y:90,w:660,h:128,label:'Alerts table screenshot · wide strip',k:'shot-table'},
    {t:'text',x:860,y:258,w:660,html:'THE 7750C, ALL SESSION',fs:18,fw:700,col:C.mut,ls:2},
    {t:'image',x:860,y:292,w:660,h:406,label:'Option price chart screenshot',k:'shot-chart'},
    {t:'box',x:860,y:732,w:660,h:112,bgc:C.panelUp},
    {t:'text',x:892,y:756,w:600,html:'Every alert tracked to the tick.',fs:26,fw:800,col:C.pale},
    {t:'text',x:892,y:794,w:600,html:'cbedge.net · free 2-day trial',fs:22,fw:700,col:C.dim}
  ]},

  blank:function(){return []}
};

function customTpls(){ try{return JSON.parse(localStorage.getItem('cbe_tpls')||'{}')}catch(e){return {}} }

function refreshT(){
  var sel0=document.getElementById('tpl'), cur=sel0.value;
  var built=[['alerts','Alert result — 2 screenshots'],
             ['levels','Key levels — walls &amp; flip'],['earnings','Earnings — estimated move'],
             ['explain','Screenshot + callouts'],['recap','Called it — level vs price'],
             ['signal','Live signal / alert'],['updates','What&#39;s new / changelog'],
             ['feature','Feature list + shots'],['hero','Hero screenshot'],['grid','Feature grid'],
             ['stat','Big stat'],['promo','Pricing / promo'],['quote','Quote / one-liner'],
             ['win','Scanner win / trade result'],['blank','Blank canvas']];
  var c=customTpls();
  sel0.innerHTML=built.map(function(b){return '<option value="'+b[0]+'">'+b[1]+'</option>'}).join('')
    + Object.keys(c).map(function(k){return '<option value="custom:'+k+'">★ '+k+'</option>'}).join('');
  if([].some.call(sel0.options,function(o){return o.value===cur})) sel0.value=cur;
}

function loadTpl(name){
  if(name.indexOf('custom:')===0){
    var t=customTpls()[name.slice(7)];
    if(t) restore(t);
    return;
  }
  stage.querySelectorAll('.ly').forEach(function(x){x.remove()});
  TPL[name]().forEach(mkLayer);
  select(null);
}

document.getElementById('apply').onclick=function(){loadTpl(document.getElementById('tpl').value)};

document.getElementById('tsave').onclick=function(){
  var n=prompt('Template name'); if(!n) return;
  select(null);
  var clone=stage.cloneNode(true);
  clone.querySelectorAll('.hnd').forEach(function(h){h.remove()});
  clone.querySelectorAll('.ly[data-t=image]').forEach(function(d){
    var lbl=(d.querySelector('.ph')||{}).textContent||'Click to load image';
    d.innerHTML='<div class="ph">'+lbl+'</div>';
  });
  clone.querySelectorAll('.ly[data-t=logo] img').forEach(function(im){ im.src=LOGO_SRC; delete im.dataset.url; });
  var t=customTpls();
  t[n]={W:W,H:H,bg:document.getElementById('bg').value,ac:accent(),html:clone.innerHTML};
  try{ localStorage.setItem('cbe_tpls',JSON.stringify(t)); }
  catch(e){ alert('Could not save: '+e); return; }
  refreshT();
  document.getElementById('tpl').value='custom:'+n;
  syncSelects();
};

document.getElementById('tdel').onclick=function(){
  var v=document.getElementById('tpl').value;
  if(v.indexOf('custom:')!==0){ alert('Only your own saved templates can be deleted.'); return; }
  var n=v.slice(7);
  if(!confirm('Delete template "'+n+'"?')) return;
  var t=customTpls(); delete t[n];
  localStorage.setItem('cbe_tpls',JSON.stringify(t));
  refreshT();
};
document.getElementById('size').onchange=function(){
  var p=this.value.split('x'); W=+p[0]; H=+p[1]; setSize(); fit();
};
document.getElementById('bg').oninput=function(){stage.style.background=this.value};
document.getElementById('ac').oninput=function(){
  stage.querySelector('.bar').style.background=this.value;
  stage.querySelectorAll('.ly[data-t=list] .dot').forEach(function(x){x.style.background=this.value}.bind(this));
};
document.getElementById('tgrid').onclick=function(){
  var g=stage.querySelector('.grid'); var on=g.style.display!=='none';
  g.style.display=on?'none':'block'; this.classList.toggle('on',!on);
};
document.getElementById('tbar').onclick=function(){
  var b=stage.querySelector('.bar'); var on=b.style.display!=='none';
  b.style.display=on?'none':'block'; this.classList.toggle('on',!on);
};
document.getElementById('zin').onclick=function(){Z=Math.min(1.5,Z+0.1);applyZoom()};
document.getElementById('zout').onclick=function(){Z=Math.max(0.15,Z-0.1);applyZoom()};
document.getElementById('zfit').onclick=fit;

// html2canvas is NOT loaded from a CDN here: the prod CSP is script-src 'self'
// (see server-v2/server-with-proxy.js), so a cdnjs tag is blocked. The parent
// React page imports it from node_modules and assigns it onto this iframe's
// window once the frame loads. See app/owner/post-studio/page.tsx.
document.getElementById('dl').onclick=function(){
  if(typeof html2canvas!=='function'){ alert('Renderer still loading — try again in a second.'); return; }
  select(null);
  stage.classList.add('exp');
  var pz=Z; Z=1; applyZoom();
  html2canvas(stage,{width:W,height:H,scale:1,backgroundColor:document.getElementById('bg').value,useCORS:true}).then(function(cv){
    stage.classList.remove('exp'); Z=pz; applyZoom();
    var a=document.createElement('a');
    a.download='cb-edge-post-'+Date.now()+'.png';
    a.href=cv.toDataURL('image/png'); a.click();
  }).catch(function(e){
    stage.classList.remove('exp'); Z=pz; applyZoom();
    alert('Export failed: '+e);
  });
};

// ── Auto-fill ───────────────────────────────────────────────────────────────
// The image slots already hold the screenshots as data: URLs, so "read the
// numbers off them" is just: POST those bytes to /api/post-studio/read-shots
// and write what comes back into the layers by their data-k key.
//
// The Anthropic key lives on the server and only on the server — this document
// is a plain iframe and would hand it to anyone who viewed source. The route is
// registered auth:'owner' in server-v2/api-router.js, and the srcdoc iframe
// inherits the site origin, so the session cookie rides along same-origin.
function afmsg(t,bad){
  var p=document.getElementById('afmsg');
  p.textContent=t; p.style.color=bad?'#f4948e':'';
}
function fillK(k,html){
  if(html==null||html==='') return 0;
  var d=stage.querySelector('.ly[data-k="'+k+'"]'); if(!d) return 0;
  var e=d.querySelector('.ed'); if(!e) return 0;
  e.innerHTML=html; return 1;
}
function shotsOnStage(){
  var out=[];
  stage.querySelectorAll('.ly[data-t=image] img').forEach(function(im){
    var m=/^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(im.dataset.url||im.getAttribute('src')||'');
    if(!m) return;                       // logo default and stale slots aren't screenshots
    out.push({mediaType:m[1],data:m[2],slot:im.parentNode.dataset.k||''});
  });
  return out.slice(0,2);                 // the template has two slots; cap the bill
}
document.getElementById('autofill').onclick=function(){
  var btn=this, shots=shotsOnStage();
  if(!shots.length){ afmsg('No screenshots loaded yet — double-click an image slot to add one.',1); return; }
  btn.disabled=true;
  afmsg('Reading '+shots.length+' screenshot'+(shots.length>1?'s':'')+'…');
  fetch('/api/post-studio/read-shots',{
    method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({shots:shots})
  }).then(function(r){
    return r.json().catch(function(){return {}}).then(function(j){
      if(!r.ok) throw new Error(j.error||('HTTP '+r.status));
      return j;
    });
  }).then(function(j){
    var f=j.fields||{}, n=0;
    n+=fillK('contract',f.contract);
    if(f.pct) n+=fillK('pct','<span style="color:'+accent()+'">'+f.pct+'</span> to the peak');
    n+=fillK('entry',f.entry);
    n+=fillK('peak',f.peak);
    n+=fillK('perContract',f.perContract);
    var list=stage.querySelector('.ly[data-k="bullets"]');
    if(list && f.bullets && f.bullets.length){
      var eds=list.querySelectorAll('.ed');
      f.bullets.slice(0,eds.length).forEach(function(b,i){ eds[i].innerHTML=b; n++; });
    }
    if(!n){ afmsg('Nothing to fill — load the “Alert result” template first.',1); return; }
    // Never let this read as finished. It is OCR on a screenshot, and a misread
    // digit here becomes a public claim about a trade.
    var miss=(j.missing||[]).length ? ' Could not read: '+j.missing.join(', ')+'.' : '';
    afmsg('Filled '+n+' field'+(n>1?'s':'')+'.'+miss+' Check every number against the screenshot before you post.',!!miss);
  }).catch(function(e){
    afmsg('Auto-fill failed: '+e.message,1);
  }).then(function(){ btn.disabled=false; });
};

function serialize(){
  return {W:W,H:H,bg:document.getElementById('bg').value,ac:accent(),html:stage.innerHTML};
}
function restore(s){
  W=s.W;H=s.H; document.getElementById('size').value=W+'x'+H;
  document.getElementById('bg').value=s.bg; stage.style.background=s.bg;
  document.getElementById('ac').value=s.ac;
  stage.innerHTML=s.html;
  stage.querySelectorAll('.ly').forEach(function(d){
    var h=d.querySelector('.hnd'); if(h)h.remove();
    d.classList.remove('sel');
    // Presets saved before the dblclick-to-edit change stored contenteditable=true,
    // which would make those layers undraggable again.
    d.querySelectorAll('.ed').forEach(function(n){n.contentEditable='false'});
    wire(d);
    if(d.dataset.t==='image'||d.dataset.t==='logo') d.addEventListener('dblclick',function(){pick(d)});
  });
  setSize(); fit(); select(null); syncSelects();
}
function presets(){ try{return JSON.parse(localStorage.getItem('cbe_posts')||'{}')}catch(e){return {}} }
function refreshP(){
  var p=presets(), s=document.getElementById('pload');
  s.innerHTML='<option value="">Load preset…</option>'+Object.keys(p).map(function(k){return '<option>'+k+'</option>'}).join('');
}
document.getElementById('psave').onclick=function(){
  var n=document.getElementById('pname').value.trim(); if(!n){alert('Name it first');return}
  var p=presets(); p[n]=serialize();
  try{ localStorage.setItem('cbe_posts',JSON.stringify(p)); }catch(e){ alert('Too large to save (big images). Export the PNG instead.'); return; }
  refreshP();
};
document.getElementById('pload').onchange=function(){
  if(!this.value)return; restore(presets()[this.value]);
  document.getElementById('pname').value=this.value;
};
document.getElementById('pdel').onclick=function(){
  var n=document.getElementById('pload').value; if(!n)return;
  var p=presets(); delete p[n]; localStorage.setItem('cbe_posts',JSON.stringify(p)); refreshP();
};

// ── Themed dropdown ─────────────────────────────────────────────────────────
// Wraps a native <select> without replacing it: the element stays in the DOM
// (visually hidden) so el.value / el.options / el.onchange keep working, and a
// MutationObserver re-labels the trigger whenever refreshT/refreshP rewrite the
// option list. The menu is appended to <body> so the sidebar's overflow:auto
// can't clip it, and flips above the trigger near the viewport bottom.
function themeSelect(el){
  var wrap=document.createElement('div'); wrap.className='tsel';
  el.parentNode.insertBefore(wrap,el); wrap.appendChild(el);
  var btn=document.createElement('button'); btn.type='button'; btn.className='tselbtn';
  btn.innerHTML='<span class="lab"></span><span class="car"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>';
  wrap.appendChild(btn);
  var menu=null;

  function label(){
    var o=el.options[el.selectedIndex];
    btn.querySelector('.lab').textContent=o?o.textContent:'—';
  }
  function close(){ if(menu){menu.remove();menu=null;} btn.classList.remove('open'); }
  function open(){
    close();
    menu=document.createElement('div'); menu.className='tselmenu';
    [].forEach.call(el.options,function(o,i){
      var b=document.createElement('button');
      b.type='button'; b.className='opt'+(i===el.selectedIndex?' on':'');
      b.textContent=o.textContent;
      b.onclick=function(ev){
        ev.stopPropagation();
        el.selectedIndex=i; label(); close();
        el.dispatchEvent(new Event('change',{bubbles:true}));
      };
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var r=btn.getBoundingClientRect(), GAP=6, PAD=8;
    var below=window.innerHeight-r.bottom-GAP-PAD, above=r.top-GAP-PAD;
    var flip=below<160&&above>below;
    menu.style.width=r.width+'px';
    menu.style.left=Math.max(PAD,Math.min(r.left,window.innerWidth-r.width-PAD))+'px';
    menu.style.maxHeight=Math.max(120,Math.min(340,flip?above:below))+'px';
    if(flip) menu.style.bottom=(window.innerHeight-r.top+GAP)+'px';
    else menu.style.top=(r.bottom+GAP)+'px';
    btn.classList.add('open');
  }
  btn.onclick=function(ev){ ev.stopPropagation(); if(menu) close(); else open(); };
  document.addEventListener('mousedown',function(ev){
    if(menu&&!menu.contains(ev.target)&&!btn.contains(ev.target)) close();
  });
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape') close(); });
  el.addEventListener('change',label);
  new MutationObserver(label).observe(el,{childList:true,subtree:true,characterData:true});
  el._sync=label;
  label();
}
// Call after any programmatic el.value assignment — those fire no mutation.
function syncSelects(){
  document.querySelectorAll('.tsel select').forEach(function(s){ if(s._sync) s._sync(); });
}

stage.style.background=C.bg;
stage.querySelector('.bar').style.background=accent();
['tpl','size','pload'].forEach(function(id){ themeSelect(document.getElementById(id)); });
// 'alerts' is now the first option, so the dropdown has to be pointed at the
// template we actually load or the label and the canvas disagree on first paint.
setSize(); refreshT(); document.getElementById('tpl').value='levels'; loadTpl('levels'); fit(); refreshP(); syncSelects();
window.addEventListener('resize',fit);
</script>
</body>
</html>`;
