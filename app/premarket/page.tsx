"use client";

/**
 * /premarket — Premarket Prep.
 *
 * This page renders the approved concept mockup VERBATIM. The markup and CSS
 * below are the exact block from generated/2026-08-19-premarket-prep-mockup.html,
 * with one mechanical change: every selector is scoped under `.pmk` (and the
 * CSS custom properties are declared on `.pmk` instead of `:root`) so the
 * mockup's generic class names — .row, .col, .bar, .stat, .g, .s, .chart — cannot
 * leak into the rest of the app.
 *
 * All numbers are STATIC PLACEHOLDERS from the mockup. Nothing here is wired to
 * the live chain, the WebSocket, or any API yet — wiring is the next step.
 *
 * Registered in app-vite/src/App.tsx (SPA route) + app/app/premarket/route.ts
 * (Next shell handler) + GlobalToolbar NAV_ITEMS.
 */

import { useEffect, useRef } from "react";

const CSS = `
.pmk{
  --bg:#0a0d12;
  --panel:#11161f;
  --panel2:#151b26;
  --line:#1f2733;
  --line2:#2a3441;
  --txt:#e6edf6;
  --dim:#ffffff;
  --dim2:#ffffff;
  --pos:#2ecc8f;
  --posDim:#1b7a56;
  --neg:#ff5c6c;
  --negDim:#8c2f3a;
  --amber:#f5b942;
  --blue:#4da3ff;
  --violet:#a78bfa;
  --r:10px;
  background:var(--bg);color:var(--txt);
  font:13px/1.45 ui-sans-serif,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;
  height:100%;overflow:auto;
}
.pmk *{box-sizing:border-box}
.pmk .wrap{max-width:1560px;margin:0 auto;padding:18px 20px 60px}
.pmk .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.pmk .muted{color:var(--dim)}
.pmk .tiny{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}

.pmk .pagehead{display:flex;align-items:baseline;gap:14px;margin-bottom:14px}
.pmk .pagehead h1{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}
.pmk .badge-concept{font-size:10px;padding:3px 8px;border:1px solid var(--line2);border-radius:999px;color:var(--dim);letter-spacing:.06em}

.pmk .prep{
  border:1px solid var(--line);border-radius:14px;overflow:hidden;
  background:linear-gradient(180deg,rgba(46,204,143,.07),rgba(46,204,143,0) 190px), var(--panel);
  box-shadow:0 0 0 1px rgba(46,204,143,.09), 0 18px 50px -30px #000;
}
.pmk .prep.is-neg{
  background:linear-gradient(180deg,rgba(255,92,108,.08),rgba(255,92,108,0) 190px), var(--panel);
  box-shadow:0 0 0 1px rgba(255,92,108,.10), 0 18px 50px -30px #000;
}

.pmk .regime{
  display:grid;grid-template-columns:minmax(230px,auto) 1px 1fr 1px 1fr 1px 1fr auto;
  gap:0;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);
}
.pmk .vr{background:var(--line);height:44px;width:1px;margin:0 18px}
.pmk .regbadge{display:flex;align-items:center;gap:11px}
.pmk .dot{width:9px;height:9px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 4px rgba(46,204,143,.16);animation:pmkpulse 2.6s infinite}
@keyframes pmkpulse{0%,100%{box-shadow:0 0 0 4px rgba(46,204,143,.16)}50%{box-shadow:0 0 0 8px rgba(46,204,143,.05)}}
.pmk .regbadge .lbl{font-size:19px;font-weight:700;letter-spacing:-.02em;color:var(--pos)}
.pmk .regbadge .sub{font-size:10.5px;color:var(--dim)}
.pmk .kpi .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:3px}
.pmk .kpi .v{font-size:19px;font-weight:640;letter-spacing:-.02em}
.pmk .kpi .v small{font-size:11px;font-weight:500;color:var(--dim)}
.pmk .chg-pos{color:var(--pos)}
.pmk .chg-neg{color:var(--neg)}
.pmk .bias{
  justify-self:end;text-align:right;max-width:290px;padding:8px 12px;border-radius:var(--r);
  background:rgba(46,204,143,.07);border:1px solid rgba(46,204,143,.22);
}
.pmk .bias .t{font-size:12.5px;font-weight:600;color:var(--pos)}
.pmk .bias .d{font-size:11px;color:var(--dim);margin-top:2px}

.pmk .levels{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .lvl{
  position:relative;border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);
  padding:10px 11px 11px;overflow:hidden;
}
.pmk .lvl::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--dim2)}
.pmk .lvl.call::before{background:var(--neg)}
.pmk .lvl.put::before{background:var(--pos)}
.pmk .lvl.flip::before{background:var(--amber)}
.pmk .lvl.magnet::before{background:var(--violet)}
.pmk .lvl.pain::before{background:var(--blue)}
.pmk .lvl.spot::before{background:#fff}
.pmk .lvl .name{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);display:flex;justify-content:space-between;align-items:center}
.pmk .lvl .name em{font-style:normal;font-size:9px;padding:1px 5px;border-radius:4px;background:#0d1117;border:1px solid var(--line2);color:var(--dim)}
.pmk .lvl .px{font-size:21px;font-weight:660;letter-spacing:-.03em;margin:4px 0 1px}
.pmk .lvl .es{font-size:10.5px;color:var(--dim)}
.pmk .lvl .dist{font-size:11px;margin-top:6px;display:flex;justify-content:space-between;align-items:center}
.pmk .pill{font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid var(--line2);color:var(--dim)}
.pmk .pill.hot{border-color:rgba(255,92,108,.4);color:var(--neg);background:rgba(255,92,108,.08)}
.pmk .pill.cool{border-color:rgba(46,204,143,.4);color:var(--pos);background:rgba(46,204,143,.08)}
.pmk .pill.warn{border-color:rgba(245,185,66,.4);color:var(--amber);background:rgba(245,185,66,.08)}

.pmk .body{display:grid;grid-template-columns:1.55fr 1fr 1fr;gap:0}
.pmk .col{padding:14px 18px;border-right:1px solid var(--line)}
.pmk .col:last-child{border-right:0}
.pmk .colhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.pmk .colhead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .seg{display:inline-flex;border:1px solid var(--line2);border-radius:7px;overflow:hidden}
.pmk .seg button{
  background:transparent;border:0;color:var(--dim);font:inherit;font-size:10.5px;
  padding:3px 9px;cursor:pointer;border-right:1px solid var(--line2)
}
.pmk .seg button:last-child{border-right:0}
.pmk .seg button.on{background:#1e2836;color:var(--txt)}

.pmk .chart{position:relative}
.pmk .row{display:grid;grid-template-columns:52px 1fr;align-items:center;height:19px;gap:8px}
.pmk .row .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .row.key .k{color:var(--txt);font-weight:600}
.pmk .track{position:relative;height:13px;background:
    linear-gradient(90deg,transparent calc(50% - .5px),var(--line2) calc(50% - .5px),var(--line2) calc(50% + .5px),transparent calc(50% + .5px));}
.pmk .bar{position:absolute;top:1px;bottom:1px;border-radius:2px}
.pmk .bar.p{left:50%;background:linear-gradient(90deg,var(--posDim),var(--pos))}
.pmk .bar.n{right:50%;background:linear-gradient(270deg,var(--negDim),var(--neg))}
.pmk .bar.dimmed{opacity:.45}
.pmk .row .tag{position:absolute;top:-1px;font-size:9.5px;padding:1px 5px;border-radius:4px;white-space:nowrap;letter-spacing:.03em}
.pmk .spotline,.pmk .flipline{position:absolute;left:60px;right:0;border-top:1px dashed;display:flex;justify-content:flex-end;pointer-events:none}
.pmk .spotline{border-color:#fff9}
.pmk .flipline{border-color:var(--amber)}
.pmk .spotline span,.pmk .flipline span{transform:translateY(-50%);font-size:9.5px;padding:1px 6px;border-radius:4px;background:#0d1117}
.pmk .spotline span{color:#fff;border:1px solid #ffffff40}
.pmk .flipline span{color:var(--amber);border:1px solid rgba(245,185,66,.45)}
.pmk .axis{display:flex;justify-content:space-between;font-size:9.5px;color:var(--dim2);margin-top:6px;padding-left:60px}

.pmk .stat{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line)}
.pmk .stat:last-child{border-bottom:0}
.pmk .stat .l{font-size:11.5px;color:var(--dim)}
.pmk .stat .r{font-size:12.5px;font-weight:600}
.pmk .onrange{margin:12px 0 4px;position:relative;height:52px}
.pmk .onrange .bar2{position:absolute;left:0;right:0;top:22px;height:8px;border-radius:5px;background:#1a2230;overflow:hidden}
.pmk .onrange .fill{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,rgba(77,163,255,.35),rgba(77,163,255,.65));border-radius:5px}
.pmk .onrange .mk{position:absolute;top:12px;width:2px;height:28px;border-radius:2px}
.pmk .onrange .cap{position:absolute;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .onrange .cap.top{top:0}
.pmk .onrange .cap.bot{top:40px;color:var(--dim)}

.pmk .deltas .d{display:grid;grid-template-columns:54px 1fr 62px;align-items:center;gap:8px;padding:4px 0}
.pmk .deltas .d .s{font-size:11px;color:var(--dim)}
.pmk .deltas .d .t{height:6px;background:#1a2230;border-radius:4px;position:relative;overflow:hidden}
.pmk .deltas .d .t i{position:absolute;top:0;bottom:0;left:50%;border-radius:4px}
.pmk .deltas .d .v{font-size:11px;text-align:right}

.pmk .sect{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px}
.pmk .s{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:7px;font-size:11.5px;border:1px solid var(--line)}
.pmk .s b{font-weight:600;font-size:11.5px}

.pmk .play{border:1px solid var(--line);border-radius:var(--r);background:var(--panel2);padding:11px 12px;margin-top:10px}
.pmk .play .h{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:6px}
.pmk .play p{margin:0;font-size:12.5px;line-height:1.5}
.pmk .play .k{color:var(--amber);font-weight:600}
.pmk .play .g{color:var(--pos);font-weight:600}
.pmk .play .r{color:var(--neg);font-weight:600}
.pmk .scen{display:grid;gap:6px;margin-top:9px}
.pmk .scen div{display:grid;grid-template-columns:16px 1fr;gap:8px;font-size:11.5px;color:var(--dim)}
.pmk .scen b{color:var(--txt);font-weight:600}

.pmk .greeks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.pmk .g{border:1px solid var(--line);border-radius:8px;padding:8px 9px;background:var(--panel2)}
.pmk .g .n{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .g .v{font-size:15px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .g .m{font-size:10px;color:var(--dim)}

.pmk .footbar{display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-top:1px solid var(--line);background:#0d1117}
.pmk .footbar .l{font-size:10.5px;color:var(--dim2)}
.pmk .chips{display:flex;gap:6px}
.pmk .chip{font-size:10px;padding:3px 8px;border-radius:6px;border:1px solid var(--line2);color:var(--dim);cursor:pointer}
.pmk .chip.on{background:#1e2836;color:var(--txt);border-color:#33404f}

.pmk .notes{margin-top:28px}
.pmk .notes h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim);margin:0 0 10px;font-weight:600}
.pmk .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.pmk .note{border:1px solid var(--line);border-radius:var(--r);background:var(--panel);padding:12px 14px}
.pmk .note h4{margin:0 0 6px;font-size:12.5px}
.pmk .note ul{margin:0;padding-left:16px;color:var(--dim);font-size:11.5px;line-height:1.6}
.pmk .note ul b{color:var(--txt);font-weight:600}

.pmk .altbar{
  display:flex;align-items:stretch;gap:0;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel);margin-top:12px
}
.pmk .altbar > div{padding:10px 14px;border-right:1px solid var(--line);display:flex;flex-direction:column;justify-content:center;gap:2px}
.pmk .altbar > div:last-child{border-right:0;flex:1}
.pmk .altbar .big{font-size:16px;font-weight:660;letter-spacing:-.02em}
.pmk .ladder{display:flex;align-items:center;gap:0;flex:1;height:34px;position:relative;margin-top:2px}
.pmk .ladder .seg2{flex:1;height:6px;background:#1a2230;position:relative}
.pmk .ladder .tick{position:absolute;transform:translateX(-50%);text-align:center;font-size:9.5px;white-space:nowrap}
.pmk .ladder .tick i{display:block;width:2px;height:12px;margin:0 auto 3px;border-radius:2px}
`;

const MARKUP = `
<div class="wrap">

  <div class="pagehead">
    <h1>Traders Dashboard</h1>
    <span class="badge-concept">PREMARKET PREP — concept mockup · not wired to live data</span>
  </div>

  <section class="prep" id="prep">

    <div class="regime">
      <div class="regbadge">
        <span class="dot"></span>
        <div>
          <div class="lbl" id="regimeLbl">POSITIVE GAMMA</div>
          <div class="sub">Dealers long gamma · mean-reverting tape</div>
        </div>
      </div>
      <div class="vr"></div>
      <div class="kpi">
        <div class="k">Net GEX</div>
        <div class="v mono">+$4.82<small>B</small> <span class="chg-pos" style="font-size:11px">▲ 38%</span></div>
      </div>
      <div class="vr"></div>
      <div class="kpi">
        <div class="k">Gamma Flip</div>
        <div class="v mono">6675 <small class="chg-neg">−48 pts / −0.71%</small></div>
      </div>
      <div class="vr"></div>
      <div class="kpi">
        <div class="k">SPX / ES</div>
        <div class="v mono">6723 <small>· ES 6758.25</small></div>
      </div>
      <div class="bias">
        <div class="t">Range day — fade the walls</div>
        <div class="d">Above flip by 48 pts. Suppression regime until 6675 breaks.</div>
      </div>
    </div>

    <div class="levels">
      <div class="lvl call">
        <div class="name">Call Wall <em>resistance</em></div>
        <div class="px mono">6750</div>
        <div class="es mono">ES 6785 · $1.9B</div>
        <div class="dist"><span class="mono chg-pos">+27 pts</span><span class="pill hot">ON high tagged</span></div>
      </div>
      <div class="lvl magnet">
        <div class="name">0DTE Magnet <em>max γ</em></div>
        <div class="px mono">6725</div>
        <div class="es mono">ES 6760 · $840M</div>
        <div class="dist"><span class="mono">+2 pts</span><span class="pill">pinning</span></div>
      </div>
      <div class="lvl spot">
        <div class="name">Spot <em>live</em></div>
        <div class="px mono">6723</div>
        <div class="es mono">ES 6758.25 · +0.34%</div>
        <div class="dist"><span class="mono muted">RTH open in 1h 12m</span></div>
      </div>
      <div class="lvl pain">
        <div class="name">Max Pain <em>0DTE</em></div>
        <div class="px mono">6710</div>
        <div class="es mono">ES 6745</div>
        <div class="dist"><span class="mono chg-neg">−13 pts</span><span class="pill">drift ↓</span></div>
      </div>
      <div class="lvl flip">
        <div class="name">Gamma Flip <em>regime</em></div>
        <div class="px mono">6675</div>
        <div class="es mono">ES 6710 · zero γ</div>
        <div class="dist"><span class="mono chg-neg">−48 pts</span><span class="pill warn">1.0× EM away</span></div>
      </div>
      <div class="lvl put">
        <div class="name">Put Wall <em>support</em></div>
        <div class="px mono">6650</div>
        <div class="es mono">ES 6685 · −$2.4B</div>
        <div class="dist"><span class="mono chg-neg">−73 pts</span><span class="pill cool">untested</span></div>
      </div>
    </div>

    <div class="body">

      <div class="col">
        <div class="colhead">
          <h3>GEX Profile by Strike</h3>
          <div style="display:flex;gap:6px">
            <div class="seg"><button class="on">Net</button><button>Split</button><button>Abs</button></div>
            <div class="seg"><button class="on">0DTE</button><button>Full chain</button></div>
          </div>
        </div>

        <div class="chart" id="pmkChart"></div>
        <div class="axis"><span>−$2.5B</span><span>0</span><span>+$2.0B</span></div>

        <div class="greeks">
          <div class="g"><div class="n">DEX</div><div class="v mono chg-pos">+$1.24B</div><div class="m">calls leading · tilt ↑</div></div>
          <div class="g"><div class="n">VEX</div><div class="v mono chg-neg">−$318M</div><div class="m">vol supply into strength</div></div>
          <div class="g"><div class="n">CHEX</div><div class="v mono chg-pos">+$96M</div><div class="m">decay pins 6725</div></div>
        </div>
      </div>

      <div class="col">
        <div class="colhead"><h3>Overnight Context</h3><span class="tiny">18:00 → 08:47 ET</span></div>

        <div class="onrange">
          <div class="cap top" style="left:12%;color:var(--pos)">ON low 6702</div>
          <div class="cap top" style="left:88%;color:var(--neg)">ON high 6749</div>
          <div class="bar2"><div class="fill" style="left:12%;right:12%"></div></div>
          <div class="mk" style="left:12%;background:var(--pos)"></div>
          <div class="mk" style="left:88%;background:var(--neg)"></div>
          <div class="mk" style="left:62%;background:#fff;height:34px;top:9px"></div>
          <div class="cap bot" style="left:62%;color:#fff">spot 6723</div>
          <div class="mk" style="left:44%;background:var(--dim2)"></div>
          <div class="cap bot" style="left:44%">PDC 6698</div>
        </div>

        <div class="stat"><span class="l">ES change</span><span class="r mono chg-pos">+22.75 (+0.34%)</span></div>
        <div class="stat"><span class="l">NQ change</span><span class="r mono chg-pos">+118.50 (+0.49%)</span></div>
        <div class="stat"><span class="l">ON range</span><span class="r mono">47 pts <span class="muted">(0.91× avg)</span></span></div>
        <div class="stat"><span class="l">ON high vs Call Wall</span><span class="r mono chg-neg">tagged −1 pt</span></div>
        <div class="stat"><span class="l">VIX / VX front</span><span class="r mono">14.28 <span class="chg-neg">−0.41</span></span></div>
        <div class="stat"><span class="l">Yesterday's flip</span><span class="r mono">6660 → <b>6675</b> <span class="chg-pos">↑15</span></span></div>

        <div class="colhead" style="margin:16px 0 6px"><h3>Biggest GEX Changes</h3><span class="tiny">vs 15:45 close</span></div>
        <div class="deltas">
          <div class="d"><span class="s mono">6750</span><span class="t"><i style="left:50%;width:34%;background:var(--pos)"></i></span><span class="v mono chg-pos">+$640M</span></div>
          <div class="d"><span class="s mono">6725</span><span class="t"><i style="left:50%;width:22%;background:var(--pos)"></i></span><span class="v mono chg-pos">+$410M</span></div>
          <div class="d"><span class="s mono">6700</span><span class="t"><i style="left:34%;width:16%;background:var(--neg)"></i></span><span class="v mono chg-neg">−$295M</span></div>
          <div class="d"><span class="s mono">6650</span><span class="t"><i style="left:24%;width:26%;background:var(--neg)"></i></span><span class="v mono chg-neg">−$480M</span></div>
        </div>

        <div class="colhead" style="margin:16px 0 6px"><h3>Sector Heat</h3><span class="tiny">premarket %</span></div>
        <div class="sect">
          <div class="s" style="border-color:rgba(46,204,143,.35);background:rgba(46,204,143,.07)"><span>Semis <span class="muted">SMH</span></span><b class="chg-pos">+1.42%</b></div>
          <div class="s" style="border-color:rgba(46,204,143,.28);background:rgba(46,204,143,.05)"><span>Tech <span class="muted">XLK</span></span><b class="chg-pos">+0.71%</b></div>
          <div class="s" style="border-color:rgba(46,204,143,.18)"><span>Fins <span class="muted">XLF</span></span><b class="chg-pos">+0.18%</b></div>
          <div class="s"><span>Health <span class="muted">XLV</span></span><b class="muted">+0.02%</b></div>
          <div class="s" style="border-color:rgba(255,92,108,.22);background:rgba(255,92,108,.05)"><span>Energy <span class="muted">XLE</span></span><b class="chg-neg">−0.44%</b></div>
          <div class="s" style="border-color:rgba(255,92,108,.35);background:rgba(255,92,108,.07)"><span>Utils <span class="muted">XLU</span></span><b class="chg-neg">−0.88%</b></div>
        </div>
      </div>

      <div class="col">
        <div class="colhead"><h3>Expected Range</h3><span class="tiny">0DTE</span></div>

        <div class="onrange" style="height:58px">
          <div class="cap top" style="left:8%;color:var(--dim)">6672</div>
          <div class="cap top" style="left:50%;color:#fff">EM ±0.78% / ±52 pts</div>
          <div class="cap top" style="left:92%;color:var(--dim)">6776</div>
          <div class="bar2" style="top:26px"><div class="fill" style="left:8%;right:8%;background:linear-gradient(90deg,rgba(167,139,250,.25),rgba(167,139,250,.5),rgba(167,139,250,.25))"></div></div>
          <div class="mk" style="left:22%;background:var(--pos);top:18px;height:24px"></div>
          <div class="cap bot" style="left:22%;top:46px;color:var(--pos)">Put Wall</div>
          <div class="mk" style="left:74%;background:var(--neg);top:18px;height:24px"></div>
          <div class="cap bot" style="left:74%;top:46px;color:var(--neg)">Call Wall</div>
          <div class="mk" style="left:62%;background:#fff;top:14px;height:32px"></div>
        </div>

        <div class="stat"><span class="l">IV-implied move</span><span class="r mono">±52 pts <span class="muted">(0.78%)</span></span></div>
        <div class="stat"><span class="l">GEX-implied range</span><span class="r mono">6650 – 6750 <span class="muted">(100)</span></span></div>
        <div class="stat"><span class="l">Overlap / conviction</span><span class="r mono chg-pos">HIGH <span class="muted">78%</span></span></div>
        <div class="stat"><span class="l">MVC levels</span><span class="r mono">6718 · 6744 · 6690</span></div>
        <div class="stat"><span class="l">Regime score</span><span class="r mono chg-pos">+7.2 / 10</span></div>

        <div class="play">
          <div class="h">Today's one-liner</div>
          <p>Positive gamma, flip <span class="k">48 pts below</span>, Call Wall <span class="r">27 above</span>, Put Wall <span class="g">73 below</span> — <b>fade extremes, scalp toward the 6725 magnet.</b></p>
          <div class="scen">
            <div><span class="g">▲</span><span><b>Above 6750</b> — call wall break, chase only with DEX confirming; next air pocket 6775.</span></div>
            <div><span class="k">◆</span><span><b>6700–6750</b> — base case. Fade edges, target 6725. Two-sided.</span></div>
            <div><span class="r">▼</span><span><b>Below 6675</b> — flip breached, regime flips negative. Stop fading, trend short to 6650.</span></div>
          </div>
        </div>

        <div class="colhead" style="margin:16px 0 6px"><h3>Catalysts</h3><span class="tiny">today</span></div>
        <div class="stat"><span class="l"><span class="pill hot">08:30</span> Retail Sales</span><span class="r mono muted">exp +0.4%</span></div>
        <div class="stat"><span class="l"><span class="pill warn">10:00</span> UMich prelim</span><span class="r mono muted">exp 61.2</span></div>
        <div class="stat"><span class="l"><span class="pill">14:00</span> Fed speak — Williams</span><span class="r mono muted">—</span></div>
        <div class="stat"><span class="l"><span class="pill">16:05</span> NVDA earnings</span><span class="r mono muted">IM ±7.1%</span></div>
      </div>
    </div>

    <div class="footbar">
      <span class="l mono">Chain 08:47:12 ET · spot 6723.41 · WS live · 12,481 contracts priced</span>
      <div class="chips">
        <span class="chip on">SPX</span><span class="chip">SPY</span><span class="chip">NDX</span><span class="chip">QQQ</span>
        <span class="chip" style="margin-left:10px">Copy prep to notes</span>
        <span class="chip">Pin to top</span>
      </div>
    </div>
  </section>

  <div class="notes">
    <h2>Alt A — collapsed "one strip" mode (what you see after the first 30 seconds)</h2>
    <div class="altbar">
      <div style="border-left:3px solid var(--pos)">
        <span class="tiny">Regime</span><span class="big" style="color:var(--pos)">+γ</span>
      </div>
      <div><span class="tiny">Net GEX</span><span class="big mono">+4.82B</span></div>
      <div><span class="tiny">Flip</span><span class="big mono" style="color:var(--amber)">6675</span></div>
      <div><span class="tiny">Spot</span><span class="big mono">6723</span></div>
      <div><span class="tiny">EM</span><span class="big mono">±52</span></div>
      <div style="flex:1">
        <span class="tiny">Level ladder</span>
        <div class="ladder">
          <div class="seg2"></div>
          <div class="tick" style="left:8%"><i style="background:var(--pos)"></i>6650<br><span class="muted">Put Wall</span></div>
          <div class="tick" style="left:29%"><i style="background:var(--amber)"></i>6675<br><span class="muted">Flip</span></div>
          <div class="tick" style="left:50%"><i style="background:var(--blue)"></i>6710<br><span class="muted">Pain</span></div>
          <div class="tick" style="left:66%"><i style="background:#fff"></i>6723<br><span class="muted">Spot</span></div>
          <div class="tick" style="left:80%"><i style="background:var(--violet)"></i>6725<br><span class="muted">Magnet</span></div>
          <div class="tick" style="left:96%"><i style="background:var(--neg)"></i>6750<br><span class="muted">Call Wall</span></div>
        </div>
      </div>
    </div>
  </div>

  <div class="notes">
    <h2>Build notes / further ideas</h2>
    <div class="cards">
      <div class="note">
        <h4>Data you already have</h4>
        <ul>
          <li><b>Net GEX, walls, flip</b> — from the existing GEX computation, just aggregated into scalars.</li>
          <li><b>DEX / VEX / CHEX</b> — already on Multi Greek; reuse, don't recompute.</li>
          <li><b>EM</b> — from the Estimated Moves page (<code>useEmLookup</code>).</li>
          <li><b>Econ calendar</b> — <code>lib/econCalendar</code> filtered to today.</li>
          <li><b>MVC levels</b> — snapshot store.</li>
        </ul>
      </div>
      <div class="note">
        <h4>Data that needs a small addition</h4>
        <ul>
          <li><b>Overnight H/L/PDC</b> — needs an ON session aggregate off the ES candle feed.</li>
          <li><b>GEX delta vs prior close</b> — persist a 15:45 chain snapshot nightly, diff at open.</li>
          <li><b>Sector heat</b> — one premarket quote batch for the 11 SPDRs + SMH.</li>
          <li><b>Regime score</b> — combine flip distance, net GEX sign/magnitude, wall spread, VIX term.</li>
        </ul>
      </div>
      <div class="note">
        <h4>Behavior</h4>
        <ul>
          <li>Auto-expand <b>before 09:30</b>, auto-collapse to the strip after; manual pin overrides.</li>
          <li>Whole section tints <b>green/red</b> by net GEX sign — mood before reading.</li>
          <li>Flash a level card when spot crosses it; sticky "flip breached" toast.</li>
          <li>Countdown to RTH open in the spot card.</li>
          <li>One-click <b>"copy prep"</b> → plain-text block for your journal.</li>
        </ul>
      </div>
      <div class="note">
        <h4>Things worth adding later</h4>
        <ul>
          <li><b>Yesterday-vs-today wall migration</b> — arrows showing walls moving up/down overnight.</li>
          <li><b>Charm/vanna decay clock</b> — how much pin pressure burns off by 12:00 / 15:00.</li>
          <li><b>Historical analog</b>: "last 12 days with +γ and flip &gt;40 below closed inside walls 9/12."</li>
          <li><b>Failure levels</b> — where the fade thesis is wrong, printed as an explicit invalidation price.</li>
          <li>Mobile <code>/m/prep</code> tab: regime + 3 levels + one-liner only.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
`;

type Strike = { k: number; v: number; tag?: string; tc?: string };

const STRIKES: Strike[] = [
  { k: 6800, v: 0.42 }, { k: 6790, v: 0.28 }, { k: 6780, v: 0.51 }, { k: 6770, v: 0.66 },
  { k: 6760, v: 0.95 }, { k: 6750, v: 1.9, tag: "CALL WALL", tc: "var(--neg)" },
  { k: 6740, v: 0.72 }, { k: 6730, v: 0.88 },
  { k: 6725, v: 1.35, tag: "0DTE MAGNET", tc: "var(--violet)" },
  { k: 6720, v: 0.64 }, { k: 6710, v: 0.31, tag: "MAX PAIN", tc: "var(--blue)" },
  { k: 6700, v: 0.18 }, { k: 6690, v: -0.12 }, { k: 6680, v: -0.34 },
  { k: 6675, v: -0.05, tag: "GAMMA FLIP", tc: "var(--amber)" },
  { k: 6670, v: -0.58 }, { k: 6660, v: -0.91 }, { k: 6650, v: -2.4, tag: "PUT WALL", tc: "var(--pos)" },
  { k: 6640, v: -0.77 }, { k: 6630, v: -0.49 }, { k: 6620, v: -0.86 }, { k: 6600, v: -1.12 },
];

const MAXP = 2.0;
const MAXN = 2.5;
const ROW_H = 19;

export default function PremarketPage() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // ── GEX profile rows (same script as the mockup, scoped to this host) ──
    const chart = host.querySelector<HTMLDivElement>("#pmkChart");
    if (chart) {
      let html = "";
      STRIKES.forEach((s) => {
        const key = !!s.tag;
        const pos = s.v >= 0;
        const w = (Math.abs(s.v) / (pos ? MAXP : MAXN)) * 50;
        const big = Math.abs(s.v) > 1.2;
        const tag = s.tag
          ? `<span class="tag" style="${pos ? `left:calc(50% + ${w}% + 6px)` : `right:calc(50% + ${w}% + 6px)`};color:${s.tc};border:1px solid ${s.tc};background:#0d1117">${s.tag}</span>`
          : "";
        html += `<div class="row ${key ? "key" : ""}">
          <div class="k mono">${s.k}</div>
          <div class="track">
            <div class="bar ${pos ? "p" : "n"} ${big ? "" : "dimmed"}" style="width:${w}%"></div>
            ${tag}
          </div>
        </div>`;
      });
      chart.innerHTML = html;
      chart.style.position = "relative";

      const mk = (idx: number, cls: string, label: string) => {
        if (idx < 0) return;
        const d = document.createElement("div");
        d.className = cls;
        d.style.top = idx * ROW_H + ROW_H / 2 + "px";
        d.innerHTML = `<span>${label}</span>`;
        chart.appendChild(d);
      };
      mk(STRIKES.findIndex((s) => s.k === 6720), "spotline", "SPOT 6723");
      mk(STRIKES.findIndex((s) => s.k === 6675), "flipline", "FLIP 6675");
    }

    // ── cosmetic toggles ──
    const onSeg = (e: Event) => {
      const seg = e.currentTarget as HTMLElement;
      const t = e.target as HTMLElement;
      if (t.tagName !== "BUTTON") return;
      seg.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
      t.classList.add("on");
    };
    const segs = Array.from(host.querySelectorAll<HTMLElement>(".seg"));
    segs.forEach((s) => s.addEventListener("click", onSeg));

    const chips = Array.from(host.querySelectorAll<HTMLElement>(".chip"));
    const onChip = (e: Event) => (e.currentTarget as HTMLElement).classList.toggle("on");
    chips.forEach((c) => c.addEventListener("click", onChip));

    return () => {
      segs.forEach((s) => s.removeEventListener("click", onSeg));
      chips.forEach((c) => c.removeEventListener("click", onChip));
    };
  }, []);

  return (
    <div className="pmk" style={{ flex: 1, minHeight: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div ref={hostRef} dangerouslySetInnerHTML={{ __html: MARKUP }} />
    </div>
  );
}
