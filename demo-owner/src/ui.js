/* ── tiny render helpers ─────────────────────────────────── */
const esc = s => String(s==null?"":s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const money = n => (n<0?"-":"") + "$" + Math.abs(n).toLocaleString();
const pct = n => (n>0?"+":"") + (n*100).toFixed(0) + "%";

function card(title, body, opts={}){
  const s = opts.sub ? `<span class="s">${esc(opts.sub)}</span>` : "";
  const r = opts.right || "";
  const head = title ? `<div class="ch"><span class="t">${esc(title)}</span>${s}<span class="sp"></span>${r}</div>` : "";
  return `<div class="card">${head}${body}</div>`;
}

function tiles(list, cols){
  const c = cols || Math.min(list.length, 6);
  const items = list.map(t=>{
    const d = t.d ? `<div class="d ${t.up===true?"up":t.up===false?"dn":""}">${esc(t.d)}</div>` : "";
    const sp = t.s ? spark(t.s, t.up===false?"var(--softred)":"var(--cy)") : "";
    return `<div class="tile"><div class="l">${esc(t.l)}</div><div class="n">${esc(t.n)}</div>${d}${sp}</div>`;
  }).join("");
  return `<div class="tiles" style="grid-template-columns:repeat(${c},minmax(0,1fr))">${items}</div>`;
}

function spark(vals, color){
  const w=110,h=30, mn=Math.min(...vals), mx=Math.max(...vals), rg=(mx-mn)||1;
  const pts = vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-2-((v-mn)/rg)*(h-6)).toFixed(1)}`).join(" ");
  return `<svg class="sp" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" opacity=".8"/></svg>`;
}

function lineChart(series, opts={}){
  const w=opts.w||760, h=opts.h||190, pad=26;
  const all = series.flatMap(s=>s.v);
  const mn = opts.zero ? 0 : Math.min(...all), mx = Math.max(...all), rg=(mx-mn)||1;
  const n = series[0].v.length;
  const X = i => pad + (i/(n-1))*(w-pad*2);
  const Y = v => h-pad - ((v-mn)/rg)*(h-pad*2);
  const grid = [0,.25,.5,.75,1].map(f=>{
    const y = h-pad - f*(h-pad*2);
    return `<line x1="${pad}" x2="${w-pad}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,.06)"/>
      <text x="4" y="${(y+3).toFixed(1)}" font-size="9" fill="rgba(255,255,255,.3)">${Math.round(mn+f*rg).toLocaleString()}</text>`;
  }).join("");
  const paths = series.map(s=>{
    const d = s.v.map((v,i)=>`${i?"L":"M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const area = `${d} L${X(n-1).toFixed(1)},${h-pad} L${X(0).toFixed(1)},${h-pad} Z`;
    return `${s.fill?`<path d="${area}" fill="${s.c}" opacity=".10"/>`:""}
      <path d="${d}" fill="none" stroke="${s.c}" stroke-width="2" stroke-linejoin="round"/>`;
  }).join("");
  const labs = (opts.x||[]).map((t,i)=>`<text x="${X(i).toFixed(1)}" y="${h-8}" font-size="9"
    fill="rgba(255,255,255,.3)" text-anchor="middle">${esc(t)}</text>`).join("");
  const leg = series.length>1 ? `<div class="chips" style="margin-top:8px">`+series.map(s=>
    `<span class="pill p-mt" style="color:${s.c};border-color:${s.c}55">${esc(s.n)}</span>`).join("")+`</div>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block">${grid}${paths}${labs}</svg>${leg}`;
}

function barChart(rows, opts={}){
  const w=opts.w||760, h=opts.h||200, pad=30, n=rows.length;
  const mx = Math.max(...rows.flatMap(r=>[r.a||0, r.b||0]))||1;
  const bw = (w-pad*2)/n;
  const bars = rows.map((r,i)=>{
    const x = pad + i*bw;
    const ha = ((r.a||0)/mx)*(h-pad*2), hb=((r.b||0)/mx)*(h-pad*2);
    return `<rect x="${(x+bw*0.16).toFixed(1)}" y="${(h-pad-ha).toFixed(1)}" width="${(bw*0.36).toFixed(1)}"
        height="${ha.toFixed(1)}" fill="${opts.ca||"var(--cy)"}" opacity=".85" rx="2"/>
      <rect x="${(x+bw*0.52).toFixed(1)}" y="${(h-pad-hb).toFixed(1)}" width="${(bw*0.30).toFixed(1)}"
        height="${hb.toFixed(1)}" fill="${opts.cb||"var(--orange)"}" opacity=".7" rx="2"/>
      <text x="${(x+bw/2).toFixed(1)}" y="${h-9}" font-size="9" fill="rgba(255,255,255,.32)" text-anchor="middle">${esc(r.m)}</text>`;
  }).join("");
  const base = `<line x1="${pad}" x2="${w-pad}" y1="${h-pad}" y2="${h-pad}" stroke="rgba(255,255,255,.1)"/>`;
  const leg = `<div class="chips" style="margin-top:8px">
    <span class="pill p-cy">${esc(opts.la||"A")}</span><span class="pill p-og">${esc(opts.lb||"B")}</span></div>`;
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block">${base}${bars}</svg>${leg}`;
}

function table(cols, rows, opts={}){
  const th = cols.map(c=>`<th class="${c.n?"num":""}">${esc(c.t||c)}</th>`).join("");
  const tb = rows.map(r=>`<tr>${r.map((cell,i)=>{
    const c = cols[i]||{};
    return `<td class="${c.n?"num":""} ${c.cls||""}">${cell}</td>`;
  }).join("")}</tr>`).join("");
  return `<div class="tw"><table>${opts.nohead?"":`<thead><tr>${th}</tr></thead>`}<tbody>${tb}</tbody></table></div>`;
}

function pill(t, k){ return `<span class="pill p-${k||"mt"}">${esc(t)}</span>`; }
function bar(f, color){ return `<div class="bar"><i style="width:${Math.max(2,Math.min(100,f*100)).toFixed(0)}%;background:${color||"var(--cy)"}"></i></div>`; }
function seg(items, active){
  return `<div class="seg">${items.map(i=>`<button class="${i===active?"on":""}">${esc(i)}</button>`).join("")}</div>`;
}
function synth(txt){ return `<div class="synth">◆ ${esc(txt||"All customer records on this screen are synthetic demo data.")}</div>`; }

function gauge(label, value, frac, color){
  const r=34, cx=48, cy=48, C=Math.PI*r;
  const f = Math.max(-1, Math.min(1, frac));
  const len = Math.abs(f)*C*0.5;
  const dir = f>=0 ? 1 : 0;
  return `<div class="gauge">
    <svg viewBox="0 0 96 62" style="width:100%;height:auto">
      <path d="M14,48 A${r},${r} 0 0 1 82,48" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="7" stroke-linecap="round"/>
      <path d="M48,14 A${r},${r} 0 0 ${dir} ${(cx + (dir? 1:-1)*r*Math.sin(Math.abs(f)*Math.PI/2)).toFixed(1)},${(cy - r*Math.cos(Math.abs(f)*Math.PI/2)).toFixed(1)}"
        fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
      <line x1="48" y1="48" x2="48" y2="20" stroke="rgba(255,255,255,.25)" stroke-width="1"/>
    </svg>
    <div class="gl">${esc(label)}</div><div class="gv" style="color:${color}">${esc(value)}</div></div>`;
}

function ladder(rows, spot){
  const mx = Math.max(...rows.flatMap(r=>[Math.abs(r[1]),Math.abs(r[2])]))||1;
  return `<div class="ladder">${rows.map(r=>{
    const [k,prior,now] = r;
    const hi = Math.abs(now)===Math.max(...rows.map(x=>Math.abs(x[2])));
    const neg = now<0;
    const wPrior = Math.abs(prior)/mx*100, wNow = Math.abs(now)/mx*100;
    const delta = now-prior;
    const tag = Math.abs(delta) < 12 ? "" : (now>0
      ? (delta>0 ? "built"   : "eroded")     // positive gamma: added / taken off
      : (delta<0 ? "deepened" : "lifted"));  // negative gamma: more / less negative
    return `<div class="rung ${hi?"hi":""}">
      <div class="k">${k}</div>
      <div class="lft">${neg?`<i style="width:${wNow.toFixed(0)}%"></i><i style="width:${wPrior.toFixed(0)}%;background:transparent;border:1px solid rgba(244,148,142,.5)"></i>`:""}</div>
      <div class="rgt">${!neg?`<i style="width:${wNow.toFixed(0)}%"></i><i style="width:${wPrior.toFixed(0)}%;background:transparent;border:1px solid rgba(142,202,230,.5)"></i>`:""}</div>
      <div class="tagx">${tag?esc(tag):""}${k===spot?" ← spot":""}</div>
    </div>`;
  }).join("")}</div>`;
}

function worldMap(dots){
  const land = [
    "M60,58 L96,44 L150,40 L182,54 L196,80 L176,104 L150,112 L128,150 L112,168 L96,150 L84,116 L64,92 Z",
    "M150,178 L176,166 L196,182 L200,222 L182,262 L162,272 L150,240 L142,206 Z",
    "M300,52 L360,40 L400,48 L412,66 L396,84 L360,92 L326,86 L302,70 Z",
    "M318,96 L360,92 L392,104 L404,140 L388,182 L360,214 L336,206 L322,168 L312,130 Z",
    "M414,44 L520,32 L600,46 L648,70 L640,104 L596,126 L540,120 L488,100 L440,80 Z",
    "M600,130 L648,120 L676,140 L668,168 L634,176 L606,158 Z",
    "M652,196 L690,186 L714,206 L708,242 L678,254 L656,232 Z"
  ];
  const paths = land.map(d=>`<path d="${d}" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.07)"/>`).join("");
  const pts = dots.map(([x,y,k])=>{
    if(k===2) return `<circle cx="${x*7.6}" cy="${y*3.1}" r="3.2" fill="var(--gold)" opacity=".95"/>`;
    if(k===1) return `<circle cx="${x*7.6}" cy="${y*3.1}" r="3" fill="none" stroke="var(--gold)" stroke-width="1.3" opacity=".8"/>`;
    return `<circle cx="${x*7.6}" cy="${y*3.1}" r="2.2" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`;
  }).join("");
  return `<div class="mapwrap"><svg viewBox="0 0 760 310" style="width:100%;height:auto;display:block">${paths}${pts}</svg></div>`;
}

function heat(rows){ /* rows: [[label, [v...]]] */
  const mx = Math.max(...rows.flatMap(r=>r[1]))||1;
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:11px">
    ${rows.map(r=>`<div class="mut">${esc(r[0])}</div>
      <div style="display:grid;grid-template-columns:repeat(${r[1].length},1fr);gap:2px">
        ${r[1].map(v=>`<div style="height:14px;border-radius:2px;background:rgba(33,158,188,${(0.08+0.85*v/mx).toFixed(2)})"></div>`).join("")}
      </div>`).join("")}
  </div>`;
}
