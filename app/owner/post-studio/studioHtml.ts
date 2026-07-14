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
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<style>
  :root{--ui:#0b111c;--ui2:#111b2c;--line:#22314c;--mut:#7b91b4;--grn:#00e5a0;--txt:#e8eefb}
  *{box-sizing:border-box}
  body{margin:0;background:#05080e;color:var(--txt);font-family:"Segoe UI",-apple-system,Helvetica,Arial,sans-serif;display:flex;height:100vh;overflow:hidden}

  #side{width:330px;flex:none;background:var(--ui);border-right:1px solid var(--line);overflow-y:auto;padding:16px}
  #side h3{font-size:11px;letter-spacing:1.5px;color:var(--mut);margin:20px 0 8px;text-transform:uppercase}
  #side h3:first-child{margin-top:0}
  .row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  button{background:var(--ui2);color:var(--txt);border:1px solid var(--line);padding:8px 11px;border-radius:7px;font-size:12px;cursor:pointer;font-family:inherit}
  button:hover{border-color:var(--grn);color:var(--grn)}
  button.pri{background:var(--grn);color:#05140e;border-color:var(--grn);font-weight:700}
  button.pri:hover{filter:brightness(1.12);color:#05140e}
  button.on{border-color:var(--grn);color:var(--grn)}
  select,input[type=text],input[type=number]{background:var(--ui2);color:var(--txt);border:1px solid var(--line);border-radius:7px;padding:8px;font-size:12px;width:100%;font-family:inherit}
  label{font-size:11px;color:var(--mut);display:block;margin:8px 0 4px}
  .f2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  input[type=color]{width:100%;height:32px;background:none;border:1px solid var(--line);border-radius:7px;padding:2px;cursor:pointer}
  input[type=range]{width:100%}
  .empty{color:#4b5f80;font-size:12px;line-height:1.6}

  #main{flex:1;overflow:auto;padding:26px;display:flex;flex-direction:column;align-items:center;gap:14px}
  #bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
  #hold{position:relative}
  #stage{position:relative;overflow:hidden;transform-origin:top left;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  #stage .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:100px 100px;pointer-events:none}
  #stage .bar{position:absolute;left:0;bottom:0;width:100%;height:12px}

  .ly{position:absolute;cursor:move}
  .ly.sel{outline:2px solid var(--grn);outline-offset:2px}
  .ly .hnd{position:absolute;right:-6px;bottom:-6px;width:16px;height:16px;background:var(--grn);border-radius:3px;cursor:nwse-resize;z-index:9}
  .ly[data-t=text]{padding:0}
  .ly[data-t=text] .ed{outline:none;white-space:pre-wrap;word-break:break-word}
  .ly[data-t=image]{border-radius:12px;overflow:hidden;background:#101a2c;border:1px solid #2a3c5e}
  .ly[data-t=image] img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}
  .ly[data-t=image] .ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#43597d;font-size:14px;font-weight:600;text-align:center;padding:10px}
  .ly[data-t=logo] img{width:100%;height:100%;object-fit:contain;object-position:left center;display:block;pointer-events:none}
  .ly[data-t=box]{border-radius:14px}
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
    <div><label>Background</label><input type="color" id="bg" value="#070b12"></div>
    <div><label>Accent</label><input type="color" id="ac" value="#00e5a0"></div>
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
  <div id="insp"><p class="empty">Click a layer on the canvas to edit it.<br><br>Drag = move · corner = resize · scroll on an image = zoom · shift+drag an image = pan crop · arrows = nudge · Delete = remove</p></div>

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
var stage=document.getElementById('stage'), W=1600, H=900, Z=0.55, sel=null;

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
  d.style.left=px(o.x); d.style.top=px(o.y);
  d.style.width=px(o.w); if(o.h) d.style.height=px(o.h);

  if(o.t==='text'){
    d.innerHTML='<div class="ed" contenteditable="true">'+(o.html||'Your text here')+'</div>';
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
      return '<li><span class="dot"></span><span class="ed" contenteditable="true">'+i+'</span></li>';
    }).join('')+'</ul>';
    d.dataset.fs=o.fs||28; d.dataset.col=o.col||'#e8eefb';
    styleList(d);
  }
  if(o.t==='image'){
    d.innerHTML='<div class="ph">'+(o.label||'Click to load image')+'</div>';
    d.addEventListener('dblclick',function(){pick(d)});
  }
  if(o.t==='logo'){
    d.innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    d.style.background='none'; d.style.border='0';
    d.addEventListener('dblclick',function(){pick(d)});
  }
  if(o.t==='box'){
    d.style.background=o.bgc||'#0e1626';
    d.style.border='1px solid '+(o.bd||'#22314c');
    d.dataset.bgc=o.bgc||'#0e1626'; d.dataset.bd=o.bd||'#22314c';
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
    var x0=e.clientX,y0=e.clientY,w0=d.offsetWidth,h0=d.offsetHeight;
    function mv(ev){
      d.style.width=px(Math.max(40,w0+(ev.clientX-x0)/Z));
      d.style.height=px(Math.max(30,h0+(ev.clientY-y0)/Z));
    }
    function up(){document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up)}
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}
function wire(d){
  addHandle(d);
  d.addEventListener('mousedown',function(e){
    if(e.target.classList.contains('hnd'))return;
    select(d);
    if(e.target.isContentEditable && !e.shiftKey) return;
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
    var l0=d.offsetLeft,t0=d.offsetTop;
    function mv(ev){ d.style.left=px(l0+(ev.clientX-x0)/Z); d.style.top=px(t0+(ev.clientY-y0)/Z); }
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
function select(d){
  document.querySelectorAll('.ly').forEach(function(x){x.classList.remove('sel')});
  if(d) d.classList.add('sel');
  sel=d; inspector();
}
stage.addEventListener('mousedown',function(e){ if(e.target===stage||e.target.classList.contains('grid')) select(null); });

function inspector(){
  var p=document.getElementById('insp');
  if(!sel){ p.innerHTML='<p class="empty">Click a layer on the canvas to edit it.<br><br>Drag = move · corner = resize · scroll on an image = zoom · shift+drag an image = pan crop · arrows = nudge · Delete = remove</p>'; return; }
  var t=sel.dataset.t, h='';
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
      h+='<div class="row" style="margin-top:8px"><button id="i_full">Fill canvas</button><button id="i_reset">Reset image</button></div>';
    }
  }
  if(t==='box'){
    h+='<div class="f2"><div><label>Fill</label><input type="color" id="b_bg" value="'+sel.dataset.bgc+'"></div><div><label>Border</label><input type="color" id="b_bd" value="'+sel.dataset.bd+'"></div></div>';
    h+='<div class="row" style="margin-top:8px"><button id="b_op">Toggle 50% opacity</button></div>';
  }
  h+='<div class="row" style="margin-top:14px"><button id="i_front">Bring front</button><button id="i_dup">Duplicate</button><button id="i_del">Delete</button></div>';
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
      li.innerHTML='<span class="dot"></span><span class="ed" contenteditable="true">New point</span>';
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
  g('i_front').onclick=function(){stage.appendChild(sel)};
  g('i_dup').onclick=function(){
    var c=sel.cloneNode(true);
    c.style.left=px(sel.offsetLeft+30); c.style.top=px(sel.offsetTop+30);
    c.classList.remove('sel'); var oh=c.querySelector('.hnd'); if(oh)oh.remove();
    wire(c); stage.appendChild(c); select(c);
  };
  g('i_del').onclick=function(){sel.remove(); select(null)};
}
function rgb2hex(c){
  if(!c) return '#ffffff';
  if(c[0]==='#') return c;
  var m=c.match(/\d+/g); if(!m) return '#ffffff';
  return '#'+m.slice(0,3).map(function(n){return ('0'+parseInt(n).toString(16)).slice(-2)}).join('');
}

document.addEventListener('keydown',function(e){
  if(!sel || document.activeElement.isContentEditable) return;
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();sel.remove();select(null);return}
  var k={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(!k)return; e.preventDefault();
  var s=e.shiftKey?10:1;
  sel.style.left=px(sel.offsetLeft+k[0]*s); sel.style.top=px(sel.offsetTop+k[1]*s);
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
    {t:'box',x:0,y:0,w:Math.round(W*0.62),h:H,bgc:'#05090f',bd:'#05090f'},
    {t:'logo',x:90,y:80,w:440,h:150},
    {t:'text',x:90,y:270,w:820,html:'The data desks pay for.<br><span style="color:'+accent()+'">Built for retail.</span>',fs:62,fw:800},
    {t:'list',x:90,y:450,w:800,fs:28,items:['Live GEX charts &amp; full greeks','400+ stock options flow','8 years of IB stats','Heatmaps, stats &amp; more']}
  ]},
  grid:function(){return [
    {t:'logo',x:90,y:60,w:340,h:110},
    {t:'text',x:470,y:80,w:1040,html:'Everything you need to trade the tape.',fs:36,fw:800},
    {t:'box',x:90,y:230,w:460,h:250,bgc:'#0e1626'},
    {t:'image',x:100,y:240,w:440,h:170,label:'Shot 1'},
    {t:'text',x:110,y:420,w:420,html:'Live GEX &amp; greeks',fs:23,fw:700},
    {t:'box',x:574,y:230,w:460,h:250,bgc:'#0e1626'},
    {t:'image',x:584,y:240,w:440,h:170,label:'Shot 2'},
    {t:'text',x:594,y:420,w:420,html:'400+ ticker flow',fs:23,fw:700},
    {t:'box',x:1058,y:230,w:460,h:250,bgc:'#0e1626'},
    {t:'image',x:1068,y:240,w:440,h:170,label:'Shot 3'},
    {t:'text',x:1078,y:420,w:420,html:'Heatmaps &amp; stats',fs:23,fw:700},
    {t:'box',x:90,y:504,w:944,h:250,bgc:'#0e1626'},
    {t:'text',x:130,y:545,w:860,html:'8 YEARS',fs:60,fw:800,col:accent()},
    {t:'text',x:130,y:625,w:860,html:'of historical IB stats — backtested context on every session.',fs:26,fw:700},
    {t:'box',x:1058,y:504,w:460,h:250,bgc:'#0e1626'},
    {t:'text',x:1098,y:545,w:380,html:'3 YEARS',fs:60,fw:800,col:'#37b6ff'},
    {t:'text',x:1098,y:625,w:380,html:'historical estimated move',fs:24,fw:700}
  ]},
  stat:function(){return [
    {t:'logo',x:90,y:70,w:380,h:130},
    {t:'text',x:90,y:300,w:1400,html:'400+',fs:190,fw:800,col:accent(),lh:1},
    {t:'text',x:90,y:530,w:1100,html:'tickers of live options flow — every sweep, block and split, as it prints.',fs:44,fw:700},
    {t:'text',x:90,y:790,w:900,html:'cbedge.net',fs:26,fw:700,col:'#7b91b4'}
  ]},
  promo:function(){return [
    {t:'logo',x:90,y:70,w:400,h:140},
    {t:'text',x:90,y:260,w:900,html:'Lock in founder pricing.',fs:64,fw:800},
    {t:'box',x:90,y:390,w:420,h:200,bgc:'#0e1626'},
    {t:'text',x:130,y:420,w:340,html:'Monthly',fs:24,fw:700,col:'#7b91b4'},
    {t:'text',x:130,y:465,w:340,html:'<s style="color:#5c7295">$120</s> <span style="color:'+accent()+'">$45</span>/mo',fs:46,fw:800},
    {t:'text',x:130,y:540,w:340,html:'code MONTH',fs:20,fw:700,col:'#37b6ff'},
    {t:'box',x:540,y:390,w:420,h:200,bgc:'#0e1626'},
    {t:'text',x:580,y:420,w:340,html:'Yearly',fs:24,fw:700,col:'#7b91b4'},
    {t:'text',x:580,y:465,w:340,html:'<s style="color:#5c7295">$1000</s> <span style="color:'+accent()+'">$500</span>/yr',fs:46,fw:800},
    {t:'text',x:580,y:540,w:340,html:'code YEAR',fs:20,fw:700,col:'#37b6ff'},
    {t:'list',x:90,y:640,w:880,fs:24,items:['Live GEX, greeks &amp; key levels','400+ ticker options flow','8 years of IB stats · cancel anytime']},
    {t:'image',x:1010,y:120,w:520,h:660,label:'Dashboard screenshot'}
  ]},
  quote:function(){return [
    {t:'logo',x:90,y:70,w:380,h:130},
    {t:'text',x:90,y:290,w:1420,html:'Most retail traders are flying blind.<br><span style="color:'+accent()+'">CB Edge isn\'t.</span>',fs:78,fw:800},
    {t:'text',x:90,y:600,w:1200,html:'Real-time gamma, orderflow and key levels — the same read the desks are working with.',fs:34,fw:700,col:'#a9bcd8'},
    {t:'text',x:90,y:790,w:900,html:'cbedge.net',fs:26,fw:700,col:'#7b91b4'}
  ]},
  win:function(){return [
    {t:'logo',x:80,y:56,w:330,h:110},
    {t:'text',x:80,y:186,w:900,html:'THE SCANNER FLAGGED IT.',fs:26,fw:700,col:'#7b91b4',ls:3},
    {t:'text',x:80,y:232,w:920,html:'PLTR 140C <span style="color:'+accent()+'">+129.6%</span>',fs:72,fw:800},
    {t:'box',x:80,y:350,w:900,h:150,bgc:'#0e1626'},
    {t:'text',x:112,y:378,w:260,html:'ENTRY',fs:18,fw:700,col:'#7b91b4',ls:2},
    {t:'text',x:112,y:410,w:260,html:'$1.35',fs:44,fw:800},
    {t:'text',x:392,y:378,w:260,html:'NOW',fs:18,fw:700,col:'#7b91b4',ls:2},
    {t:'text',x:392,y:410,w:260,html:'$3.10',fs:44,fw:800,col:accent()},
    {t:'text',x:672,y:378,w:280,html:'PER CONTRACT',fs:18,fw:700,col:'#7b91b4',ls:2},
    {t:'text',x:672,y:410,w:280,html:'+$175',fs:44,fw:800,col:accent()},
    {t:'list',x:80,y:540,w:900,fs:25,items:['$3.2M sweep · 8.2% OTM · +101% vs open','Scanner score 60 — flagged “Very strong”','Jul 24 expiry · spot 129.37 at the print']},
    {t:'image',x:1010,y:56,w:520,h:400,label:'Scanner card screenshot'},
    {t:'image',x:1010,y:480,w:520,h:330,label:'Option price chart screenshot'},
    {t:'text',x:80,y:812,w:900,html:'cbedge.net · not financial advice',fs:20,fw:700,col:'#5c7295'}
  ]},
  blank:function(){return []}
};

var BLANKPX='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function customTpls(){ try{return JSON.parse(localStorage.getItem('cbe_tpls')||'{}')}catch(e){return {}} }

function refreshT(){
  var sel0=document.getElementById('tpl'), cur=sel0.value;
  var built=[['feature','Feature list + shots'],['hero','Hero screenshot'],['grid','Feature grid'],
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
  clone.querySelectorAll('.ly[data-t=logo] img').forEach(function(im){ im.src=BLANKPX; delete im.dataset.url; });
  var t=customTpls();
  t[n]={W:W,H:H,bg:document.getElementById('bg').value,ac:accent(),html:clone.innerHTML};
  try{ localStorage.setItem('cbe_tpls',JSON.stringify(t)); }
  catch(e){ alert('Could not save: '+e); return; }
  refreshT();
  document.getElementById('tpl').value='custom:'+n;
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

document.getElementById('dl').onclick=function(){
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
    wire(d);
    if(d.dataset.t==='image'||d.dataset.t==='logo') d.addEventListener('dblclick',function(){pick(d)});
  });
  setSize(); fit(); select(null);
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

stage.style.background='#070b12';
stage.querySelector('.bar').style.background='#00e5a0';
setSize(); refreshT(); loadTpl('feature'); fit(); refreshP();
window.addEventListener('resize',fit);
</script>
</body>
</html>`;
