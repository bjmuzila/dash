const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/PostMarketTab-BNDkSjfi.js","assets/react-BuQOX7bh.js","assets/index-BCryxehe.js","assets/index-DrxaVLaO.css","assets/levels-DmVY4zyt.js","assets/liveGex-jiu0cTm-.js","assets/hooks-BxzXZ4Wb.js","assets/econCalendar-B261v__j.js","assets/HistoricalRecap-Pquj7mK4.js","assets/CbContracts-DHgA-Sjm.js"])))=>i.map(i=>d[i]);
import{H as J,a as ae,m as Rs,E as Ze,d as gt,T as Z,S as Ra,e as Ds,f as st,_ as Da}from"./index-BCryxehe.js";import{r as o,j as e}from"./react-BuQOX7bh.js";import{u as Ls}from"./liveGex-jiu0cTm-.js";import{d as rt,u as Ws,a as _s,b as Gs,i as Hs}from"./econCalendar-B261v__j.js";import{c as bs,p as vs,n as ft,f as La,a as Xs}from"./levels-DmVY4zyt.js";const Bs=21,Vs=`
.pmk .tabs{display:inline-flex;border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden}
.pmk .tabs button{background:transparent;border:0;border-right:1px solid var(--line2);color:var(--dim);
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 13px;cursor:pointer}
.pmk .tabs button:last-child{border-right:0}
.pmk .tabs button.on{background:var(--cyanWash);color:var(--cyan);font-weight:600}
.pmk .tabs button .tdot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;
  vertical-align:middle;background:var(--amber)}

/* Post-market shell — same card as .prep (border, radius, shadow all inherited);
   only the regime tint changes to the blue that means "settled session". The
   coloured 1px ring went with .prep's for the same reason: no other card in the
   app has a second border. */
.pmk .prep.is-post{
  border-top-color:var(--blueFill1);
  background:linear-gradient(180deg,var(--blueWash),transparent 190px), var(--panel);
}
.pmk .sec{padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .sec:last-child{border-bottom:0}
/* Section headers: title, then whatever the section's legend is, then a spacer.
   The legend belongs BESIDE the thing it explains — flung to the far right of a
   1560px header it reads as unrelated chrome, and on the build-time ramp that
   is five swatches nobody connects to the bars under them. A trailing item opts
   back out to the right edge with the .right class below.

   NOTE — NO BACKTICKS IN THIS COMMENT, or anywhere in this string. It is a
   template literal: one stray backtick ends it and turns everything after into
   a property access on a string, which is exactly how this block shipped broken
   ("Cannot read properties of undefined (reading 'right')" — the text after the
   stray backtick was a .sechead .right selector mentioned in prose).
   Premarket.tsx carries the same warning on its own CSS for the same reason. */
.pmk .sechead{display:flex;align-items:baseline;justify-content:flex-start;gap:14px;margin-bottom:11px;flex-wrap:wrap}
.pmk .sechead .right{margin-left:auto}
.pmk .sechead h3{font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .secn{width:17px;height:17px;border-radius:5px;background:var(--cyanWash);color:var(--cyan);display:inline-grid;
  place-items:center;font-size:9.5px;font-weight:700;margin-right:8px;vertical-align:1px}
.pmk .warnbar{padding:8px 11px;border-radius:var(--r2);border:1px solid var(--amberEdge);
  background:var(--amberWash);font-size:11.5px;color:var(--dim)}

/* 1 — snapshot. Every column carries a min-width: the captions under the range
   bar are absolutely positioned, and without a floor the grid squeezes a column
   until a caption lands on top of the pill in the next one. */
/* SEVEN tracks and SEVEN children — the row shipped with six, so the verdict
   card landed in the 1px divider track and wrapped one word per line while the
   spare divider drew a stray line under the row. Count them together when
   either changes: close | vr | range | vr | net gex | vr | verdict. */
.pmk .snap{display:grid;
  grid-template-columns:minmax(180px,auto) 1px minmax(300px,1.3fr) 1px minmax(240px,1fr) 1px minmax(240px,300px);
  align-items:start;row-gap:14px}
.pmk .snap .vr{align-self:center}
.pmk .snap .bias{justify-self:stretch;max-width:none;text-align:left}
.pmk .rangebar{position:relative;height:42px;margin-top:8px}
.pmk .rangebar .wallband{position:absolute;left:0;right:0;top:16px;height:14px;border-radius:7px;
  background:linear-gradient(90deg,var(--negBand),color-mix(in srgb, var(--color-fg) 5%, transparent),var(--posBand));border:1px solid var(--line)}
.pmk .rangebar .act{position:absolute;top:19px;height:8px;border-radius:5px;
  background:linear-gradient(90deg,var(--blueFill1),var(--blueFill3))}
.pmk .rangebar .mk3{position:absolute;top:11px;width:2px;height:24px;border-radius:2px;transform:translateX(-50%)}
.pmk .rangebar .cp3{position:absolute;top:0;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .rangelabs{display:flex;justify-content:space-between;gap:8px;font-size:9.5px;color:var(--dim)}

/* 2 — scorecard */
.pmk .scorecard{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
/* NO ACCENT STRIPES. Cards carry their meaning in the label colour and the
   pill, not in a coloured edge — a page of striped cards reads as a page of
   warnings. This went through three shapes (a ::before painted by tone classes,
   an absolutely-positioned child, an inline border) before the answer turned out
   to be "none of them". Do not add a fourth. */
.pmk .sc{position:relative;border:1px solid var(--card);
  border-radius:var(--r);background:var(--panel2);padding:10px 11px 11px}
.pmk .sc .src{font-size:var(--text-3xs);letter-spacing:.06em;text-transform:uppercase;color:var(--dim2);margin-top:6px}
.pmk .sc .nm{font-size:var(--text-2xs);letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .sc .px{font-size:20px;font-weight:660;letter-spacing:-.03em;margin:3px 0 1px}
.pmk .sc .sub{font-size:10.5px;color:var(--dim)}
.pmk .taps{display:flex;gap:2px;margin-top:8px;height:16px;align-items:flex-end}
.pmk .taps i{flex:1;background:var(--sunken);border-radius:2px;height:5px}
.pmk .taps i.t{background:var(--pos);height:13px}
.pmk .taps i.b{background:var(--neg);height:16px}
.pmk .taps i.c{background:var(--amber);height:10px}

/* 3 — evolution. ONE bar per strike (where it closed), coloured by WHEN it took
   its share of the board, plus a separate 15:00→close column.
   There is no peak tick and no "given back" hatch any more — on an expiring book
   every strike ends ~100% off its own high, so the hatch was a constant. See the
   EvRow header.
   ALL BARS GROW RIGHT off a shared left edge. The mirrored layout this replaced
   put negative strikes on the left of a centre axis, which meant bar LENGTH read
   in two different directions and the two halves could not be compared at all.
   Sign now lives in its own two columns — a +/− chip and the signed dollar
   value — so length always means the same thing. */
.pmk .evrow{display:grid;grid-template-columns:54px 13px 60px 1fr 78px 112px 76px;
  align-items:center;height:${Bs}px;gap:7px}
.pmk .evrow .sgn{font-size:var(--text-xs);font-weight:800;text-align:center;line-height:1}
.pmk .evrow .sgn.p{color:var(--pos)}
.pmk .evrow .sgn.n{color:var(--neg)}
.pmk .evrow .netcol{font-size:9.5px;text-align:right;white-space:nowrap;font-weight:600}
/* Left-anchored rail. Overrides the centre-axis .track the premarket profile
   uses (higher specificity, so it wins regardless of sheet order) — that
   gradient draws a zero line down the middle, which is meaningless here. */
.pmk .evrow .track{position:relative;height:13px;border-radius:3px;background:var(--sunken);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .evrow .track.neg{background:var(--negWash)}
/* Build-time segments: bar LENGTH is where the strike closed in dollars, its
   COLOUR composition is when it took its share of the board — blue morning,
   violet midday, amber power hour. Laid left→right in time order, so a bar reads
   the way the day ran. Shares are normalised over the ABSOLUTE share moves, so a
   strike that built and then gave some back reads as its two moves, not >100%. */
.pmk .evrow .seg{position:absolute;top:3px;bottom:3px}
.pmk .evrow .seg:first-of-type{border-radius:2px 0 0 2px}
.pmk .evrow .bar{position:absolute;left:0;top:3px;bottom:3px;border-radius:2px}
.pmk .evrow .bar.p{background:var(--pos)}
.pmk .evrow .bar.n{background:var(--neg)}
.pmk .builtcol{font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dim)}
.pmk .builtcol .sep{color:var(--dim2)}
.pmk .evrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .evrow.key .k{color:var(--txt);font-weight:700}
.pmk .evrow .tagcol{font-size:var(--text-3xs);letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
/* ── POWER HOUR, ON ITS OWN SCALE ───────────────────────────────────────────
   15:00→close change in the strike's SHARE OF THE BOARD, in percentage points,
   normalised over its own column and not over the main bar.
   Share rather than dollars, because dollars cannot answer the question: γ ∝
   1/√T drains every non-ATM strike toward zero into the bell whatever anyone
   traded, so a dollar reading says "−100%" on almost every row and means only
   "the options expired". A share has that term in numerator and denominator, so
   it cancels and what is left is the board changing hands.
   Right/amber = the strike TOOK board share into the close. Left/red = it lost
   share. Magnitude-based, so a put wall going more negative reads as growth —
   which is what it is. */
.pmk .evrow .pmtrack{position:relative;height:13px;border-radius:3px;background:var(--sunken);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .evrow .pmtrack .zero{position:absolute;left:50%;top:1px;bottom:1px;width:1px;background:var(--line3)}
.pmk .evrow .pmtrack i{position:absolute;top:3px;bottom:3px;border-radius:2px}
.pmk .evrow .pmtrack i.up{background:var(--amber);left:50%}
.pmk .evrow .pmtrack i.dn{background:var(--neg);right:50%}
.pmk .evrow .pmtrack.off{background:none;box-shadow:none}
.pmk .evlegend{display:flex;gap:14px;flex-wrap:wrap;font-size:9.5px;letter-spacing:.05em;
  text-transform:uppercase;color:var(--dim2)}
.pmk .evlegend i{display:inline-block;width:9px;height:8px;border-radius:2px;margin-right:5px;vertical-align:middle}
/* ── THE LADDER FILLS ITS COLUMN ────────────────────────────────────────────
   .chart caps every ladder on the page at 440px, which is right for the short
   ones on the Premarket tab and wrong for this one: section 3's other column
   carries the wall-migration chart AND the written-vs-traded rows, so the grid
   row is far taller than 440 and the ladder stopped halfway down with several
   hundred pixels of empty card under it — while the strikes it could not show
   were a scroll away.

   The column is a grid item and is therefore ALREADY stretched to the row's
   height; making it a flex column and letting the ladder grow is what hands
   that height to the ladder. min-height:0 is what actually lets the flex child
   scroll rather than growing to fit all 121 rows.

   The fixed row pitch is what keeps this cheap: a taller viewport is more rows
   on screen and no re-layout of anything inside them. */
.pmk .col.evcol{display:flex;flex-direction:column;min-height:0}
/* flex-basis MUST be 0, not auto.
   With basis:auto the flex item's base size is its CONTENT — all 121 rows,
   ~2,500px — and a column flex container reports that as its max-content
   height, so the auto-sized grid row grew to fit the whole ladder, the
   overflow scroller had nothing to scroll, and the section became a page four
   screens tall with the close nowhere near the middle. basis:0 makes the
   ladder claim no height of its own and take only what is left over, which is
   the whole point: it ends up exactly as tall as the wall-migration and
   written-vs-traded column beside it, ~30 strikes.

   min-height is the OLD 440 cap, so a session where the right column happens
   to be short (both its panels needing the recorded ladder, say) never shows
   LESS than it did before this change. It is also the flex item's hypothetical
   size, so it — not the content — is what the grid row falls back to. */
.pmk .col.evcol .evchart{flex:1 1 0;min-height:440px;max-height:none}
/* ...but only while there IS a column to fill. Below 1180px .body collapses to
   one column (see the Premarket stylesheet), the column's height becomes its
   own content, and a flex child with an indefinite parent height ignores
   flex-grow — so max-height:none would render all 121 rows and turn section 3
   into a page. The cap comes back. */
@media (max-width:1180px){
  .pmk .col.evcol .evchart{flex:0 1 auto;max-height:440px}
}
/* Written vs traded — two bars growing away from a centred strike label. */
.pmk .mrow{display:grid;grid-template-columns:1fr 52px 1fr;align-items:center;height:18px;gap:6px}
.pmk .mrow .mleft{display:flex;justify-content:flex-end}
.pmk .mrow .mbar{height:11px;border-radius:2px}
.pmk .mrow .mk3{font-size:var(--text-2xs);text-align:center;color:var(--dim)}

/* Positioned vs written — one stacked bar per strike, OI then volume. */
.pmk .srow{display:grid;grid-template-columns:54px 1fr 128px;align-items:center;height:22px;gap:9px}
.pmk .srow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .srow .v{font-size:10.5px;text-align:right;white-space:nowrap}
.pmk .stack{display:flex;height:13px;border-radius:3px;overflow:hidden;background:var(--sunken)}
.pmk .stack i{display:block;height:100%}

.pmk .heat{display:grid;gap:2px;margin-top:6px}
.pmk .heat i{height:22px;border-radius:3px;background:var(--sunken)}
.pmk .heatx{display:flex;justify-content:space-between;font-size:var(--text-3xs);color:var(--dim2);margin-top:4px}

/* 4/5/6 */
.pmk .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pmk .tile{position:relative;border:1px solid var(--card);border-radius:9px;background:var(--panel2);
  padding:9px 10px;overflow:hidden}
.pmk .tile .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .tile .v2{font-size:16px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .tile .m2{font-size:var(--text-2xs);color:var(--dim)}
.pmk .split{display:flex;height:9px;border-radius:5px;overflow:hidden;margin-top:10px;border:1px solid var(--line)}
.pmk .split i{display:block;height:100%}
.pmk .biasbox{margin-top:10px;padding:10px 12px;border-radius:var(--r);
  background:var(--blueWash);border:1px solid var(--blueEdge);font-size:12.5px}
.pmk .biasbox b{color:var(--blue)}
.pmk .jot{width:100%;min-height:86px;resize:vertical;background:var(--plate);color:var(--txt);
  border:1px solid var(--line2);border-radius:8px;padding:9px 10px;font:inherit;font-size:12px}
.pmk .jot:focus{outline:none;border-color:var(--cyanEdge)}
.pmk .acc{display:flex;align-items:flex-end;gap:5px;height:60px;margin-top:6px}
.pmk .acc .c{flex:1;background:var(--sunken);border-radius:3px 3px 0 0;position:relative;min-height:4px}
.pmk .acc .c i{position:absolute;left:0;right:0;bottom:0;border-radius:3px 3px 0 0;
  background:linear-gradient(180deg,var(--pos),var(--posDim))}
.pmk .movelog{display:grid;gap:0;margin-top:10px}
/* The log is the WHOLE day, not the last eight rows — a silently truncated list
   reads as "that is all that happened". It scrolls instead, capped at ~9 rows so
   it never pushes section 3 off the screen. */
.pmk .movelog .mvscroll{max-height:212px;overflow-y:auto;overscroll-behavior:contain;
  padding-right:6px;scrollbar-width:thin;scrollbar-color:var(--line2) transparent}
.pmk .movelog .mvscroll::-webkit-scrollbar{width:7px}
.pmk .movelog .mvscroll::-webkit-scrollbar-track{background:transparent}
.pmk .movelog .mvscroll::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.pmk .movelog .mvscroll::-webkit-scrollbar-thumb:hover{background:var(--dim2)}
.pmk .movelog .mv{display:grid;grid-template-columns:52px 74px 1fr auto;gap:10px;align-items:center;
  padding:5px 0;border-bottom:1px dashed var(--line);font-size:11.5px}
.pmk .movelog .mv:last-child{border-bottom:0}
.pmk .rx{font-size:9.5px;padding:2px 6px;border-radius:5px;white-space:nowrap;border:1px solid var(--line2)}
.pmk .premlist{display:grid;gap:7px;margin-top:8px}
.pmk .premrow{display:grid;grid-template-columns:52px 1fr 54px;gap:9px;align-items:center}
.pmk .premrow .pl{font-size:var(--text-xs);color:var(--txt);font-weight:600}
.pmk .premrow .ptrack{height:9px;border-radius:5px;background:var(--sunken);overflow:hidden}
.pmk .premrow .ptrack i{display:block;height:100%;border-radius:5px}
.pmk .premrow .pu{font-size:10.5px;text-align:right;font-weight:640;white-space:nowrap}

@media (max-width:1180px){
  .pmk .snap{grid-template-columns:1fr}
  .pmk .scorecard{grid-template-columns:repeat(2,1fr)}
  .pmk .tiles{grid-template-columns:repeat(2,1fr)}
}
`,Us=`
.pmk .hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.pmk .hev{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.pmk .hrow{display:grid;grid-template-columns:64px 1fr 104px 96px;align-items:center;height:22px;gap:9px}
.pmk .hrow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .hrow .v{font-size:var(--text-2xs);text-align:right;white-space:nowrap}
.pmk .hrow .track{position:relative;height:13px;border-radius:3px;background:var(--bg);
  box-shadow:inset 1px 0 0 var(--line2)}
.pmk .hrow .track i{position:absolute;left:0;top:2px;bottom:2px;border-radius:2px}
.pmk .hrow .track i.p{background:var(--pos)}
.pmk .hrow .track i.n{background:var(--neg)}
/* Level strip: the day's five SPX levels as one row of labelled figures. */
.pmk .hlev{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:10px}
.pmk .hlev .l{border:1px solid var(--card);border-radius:var(--r2);background:var(--panel2);padding:9px 10px}
.pmk .hlev .l .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .hlev .l .v2{font-size:17px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .hlev .l .m2{font-size:var(--text-2xs);color:var(--dim)}
/* Cumulative gamma curve. Sized by its wrapper, drawn edge to edge. */
.pmk .hcurve{margin-top:12px;border:1px solid var(--card);border-radius:var(--r);
  background:var(--panel2);padding:10px 12px 8px}
.pmk .hcurve svg{display:block;width:100%;height:132px}
.pmk .hcurvex{display:flex;justify-content:space-between;font-size:var(--text-3xs);color:var(--dim2);margin-top:4px}
@media (max-width:1180px){
  .pmk .hgrid{grid-template-columns:1fr}
  .pmk .hlev{grid-template-columns:repeat(2,1fr)}
}
`,Ys=`
.pmk .cbc{padding:14px 18px;border-top:1px solid var(--line)}
.pmk .cbchead{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.pmk .cbchead h3{margin:0;font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:600}
.pmk .cbchead .tiny{text-transform:none;letter-spacing:0;font-size:var(--text-xs)}
/* Amber, the page's "check this" colour: the table is real, it is just not
   today's. It disappears the moment today has a row. */
.pmk .cbchead .cbclast{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--amber);border:1px solid var(--amberEdge);background:var(--amberWash);
  border-radius:999px;padding:2px 8px;white-space:nowrap}

.pmk .cbcnote{font-size:11.5px;color:var(--dim2);padding:10px 0}
.pmk .cbcnote.bad{color:var(--neg)}

.pmk .cbcwrap{border:1px solid var(--card);border-radius:var(--r);overflow:hidden;background:var(--sunken)}
.pmk .cbctbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.pmk .cbctbl th{padding:9px 13px;font-size:var(--text-2xs);font-weight:600;letter-spacing:.09em;text-transform:uppercase;
  color:var(--dim2);text-align:left;white-space:nowrap;border-bottom:1px solid var(--line)}
.pmk .cbctbl td{padding:9px 13px;font-size:12px;white-space:nowrap;color:var(--txt)}
.pmk .cbctbl tbody tr + tr td{border-top:1px solid var(--line)}
.pmk .cbctbl tbody tr:hover{background:var(--active)}
.pmk .cbctbl tr.skip{opacity:.55}
.pmk .cbctbl .r{text-align:right}
.pmk .cbctbl .dim{color:var(--dim)}
.pmk .cbctbl .dim2{color:var(--dim2)}
.pmk .cbctbl .ck{font-weight:600;color:var(--dim)}
.pmk .cbctbl .up{color:var(--pos)}
.pmk .cbctbl .down{color:var(--neg)}
.pmk .cbctbl .at{margin-left:5px;font-size:10.5px;color:var(--dim2)}
.pmk .cbctbl .pl{font-weight:700}
.pmk .cbctbl .pl.flat{color:var(--dim2);font-weight:400}
/* An unrealized mark that reads exactly like a booked one is how a board starts
   lying to you — hence the star and the step down in weight. */
.pmk .cbctbl .pl.live{opacity:.75}
.pmk .cbctbl .pl .usd{margin-left:7px;font-size:10.5px;font-weight:600;color:var(--dim2)}

.pmk .cbcchip{font:inherit;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;
  font-weight:700;cursor:pointer;background:transparent;border:1px solid var(--cyanEdge);color:var(--cyan);
  border-radius:6px;padding:3px 9px;letter-spacing:.02em}
.pmk .cbcchip:hover{background:var(--cyanWash)}
.pmk .cbcchip.off{border-color:var(--line2);color:var(--dim2)}
.pmk .cbcchip .cb{margin-left:6px;font-size:10.5px;font-weight:600;color:var(--dim2)}

.pmk .cbcfoot{display:flex;gap:16px;flex-wrap:wrap;align-items:center;padding:8px 13px;
  border-top:1px solid var(--line);font-size:10.5px;color:var(--dim2);
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.pmk .cbcfoot .cbclegend{margin-left:auto}

/* ── Probe card ─────────────────────────────────────────────────────────── */
.pmk .cbcmask{position:fixed;inset:0;z-index:60;background:color-mix(in srgb, var(--color-shadow) 72%, transparent);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;padding:24px}
.pmk .cbcmodal{width:min(1040px,100%);max-height:90vh;overflow-y:auto;padding:18px 20px;
  background:var(--plate);border:1px solid var(--card);border-radius:var(--r);
  display:flex;flex-direction:column;gap:14px}
.pmk .cbcmhead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.pmk .cbcmhead .sym{font-size:var(--text-base);font-weight:700;color:var(--cyan)}
.pmk .cbcmhead .sub{font-size:var(--text-xs);color:var(--dim2)}
.pmk .cbcmhead .x{margin-left:auto;font:inherit;font-size:var(--text-base);font-weight:700;line-height:1;cursor:pointer;
  background:transparent;border:1px solid var(--line2);color:var(--dim);border-radius:7px;padding:4px 11px}
.pmk .cbcmhead .x:hover{background:var(--active)}

.pmk .cbcbig .hl{font-size:var(--text-xl);font-weight:800;line-height:1;color:var(--txt)}
.pmk .cbcbig .line{font-size:12px;color:var(--dim);margin-top:6px}
.pmk .cbcbig .line .t{color:var(--dim2);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;margin-right:3px}
.pmk .cbcbig .line .ar{color:var(--dim2);margin:0 6px}

.pmk .cbcstats{display:flex;gap:24px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--line)}
.pmk .cbcstats .s{display:flex;flex-direction:column;gap:3px}
.pmk .cbcstats .k{font-size:9.5px;font-weight:600;color:var(--dim2);letter-spacing:.08em;text-transform:uppercase}
.pmk .cbcstats .v{font-size:12px;font-weight:700;color:var(--txt)}

.pmk .cbc .up{color:var(--pos)}
.pmk .cbc .down{color:var(--neg)}
.pmk .cbc .flat{color:var(--dim2)}
.pmk .cbc .cy{color:var(--cyan)}
.pmk .cbc .am{color:var(--amber)}

.pmk .cbctgls{display:flex;gap:8px;flex-wrap:wrap}
.pmk .cbctgl{font:inherit;font-size:var(--text-xs);font-weight:600;padding:5px 12px;border-radius:7px;cursor:pointer;
  letter-spacing:.06em;text-transform:uppercase;background:transparent;border:1px solid var(--line2);color:var(--dim)}
.pmk .cbctgl:hover{background:var(--active)}
.pmk .cbctgl.on{border-color:var(--cyanEdge);background:var(--cyanWash);color:var(--cyan)}

.pmk .cbcwarn{font-size:11.5px;color:var(--amber);border:1px solid var(--amberEdge);background:var(--amberWash);
  border-radius:var(--r2);padding:8px 11px;line-height:1.6;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}

.pmk .cbcskip{padding:24px 20px;text-align:center;border:1px dashed var(--line2);border-radius:var(--r2);line-height:1.7;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11.5px;color:var(--dim)}
.pmk .cbcskip .t{font-size:12px;font-weight:700;color:var(--amber);margin-bottom:5px;font-family:inherit}
.pmk .cbcskip .sub{margin-top:7px;color:var(--dim2)}

.pmk .cbcsvg{width:100%;height:auto;display:block}
.pmk .cbchint{font-size:10.5px;color:var(--dim2);letter-spacing:.04em}

@media (max-width:900px){
  .pmk .cbcwrap{overflow-x:auto}
  .pmk .cbcfoot .cbclegend{margin-left:0}
}
`,Ks=4,qs=100,qa=t=>t<0?0:t>1?1:t,Zs=.55,Za=.4;function Qa(t,s=1){const n=Number.isFinite(t)?Math.max(-1,Math.min(1,t)):0,r=n<0?Ze:gt,l=Za+(1-Za)*Math.abs(n)**Zs;return ae(Rs(r,J.panel,l),s)}const Ja=(t,s)=>ae(t,s);function Qs(t){const s=t.heat;return s==null||!Number.isFinite(s)?{frac:qa(t.churnPct/qs),provisional:!0}:{frac:qa(s/Ks),provisional:!1}}function Js(t,s=45){const[n,r]=o.useState([]),[l,i]=o.useState(""),[d,p]=o.useState(!1);return o.useEffect(()=>{if(!t){r([]),i("");return}let m=!0;return p(!0),(async()=>{try{const h=await(await fetch(`/api/gex-gross-feed?symbol=${encodeURIComponent(t)}&days=${s}`,{cache:"no-store"})).json();if(!m)return;r(Array.isArray(h.rows)?h.rows:[]),i(typeof h.note=="string"?h.note:"")}catch{m&&(r([]),i("Churn history unavailable right now."))}finally{m&&p(!1)}})(),()=>{m=!1}},[t,s]),{rows:n,note:l,loading:d}}function en({symbol:t,rows:s,note:n,loading:r,limit:l=12,style:i}){const d=[...s].reverse().slice(0,l);return e.jsxs("div",{style:{padding:"12px 18px",borderTop:`1px solid ${J.border}`,display:"flex",flexDirection:"column",gap:8,...i},children:[e.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:10,flexWrap:"wrap"},children:[e.jsx("span",{style:{fontSize:13,fontWeight:800,letterSpacing:"0.14em",textTransform:"uppercase",color:J.text},children:"Gamma book churn"}),e.jsx("span",{style:{fontSize:11,color:J.text},children:t?`how much of ${t}'s book rewrote itself, session by session`:"pick a ticker"})]}),r?e.jsx("div",{style:{fontSize:12,color:J.text},children:"Loading…"}):t?d.length?e.jsxs(e.Fragment,{children:[e.jsx("div",{style:{display:"flex",flexDirection:"column",gap:5},children:d.map(p=>{const{frac:m,provisional:c}=Qs(p),h=Qa(p.buildShare),x=p.isOpex?"OPEX":p.isEarnings?"ERN":null;return e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:9},children:[e.jsx("span",{style:{fontSize:11,fontFamily:"var(--font-mono)",color:J.text,width:46,flex:"0 0 auto"},children:p.date.slice(5)}),e.jsx("div",{title:`${p.date} — ${Math.round(p.churnPct)}% of the book changed`+(p.heat!=null?`, ${p.heat.toFixed(1)}× a normal day`:" (no baseline yet)")+` · build share ${p.buildShare.toFixed(2)}`+(x?` · ${x}`:""),style:{position:"relative",flex:1,height:8,borderRadius:8,overflow:"hidden",background:Ja(J.muted,.06),backgroundImage:c?`repeating-linear-gradient(135deg, ${Ja(J.muted,.05)} 0 4px, transparent 4px 8px)`:void 0,opacity:p.clean===!1?.45:1},children:e.jsx("div",{style:{width:`${m*100}%`,height:"100%",background:`linear-gradient(90deg, ${Qa(p.buildShare,.82)}, ${h})`}})}),e.jsx("span",{style:{fontSize:11,fontFamily:"var(--font-mono)",fontWeight:700,color:h,width:54,textAlign:"right",flex:"0 0 auto"},children:p.heat!=null?`${p.heat.toFixed(1)}×`:`${Math.round(p.churnPct)}%`}),e.jsx("span",{style:{fontSize:9,letterSpacing:.5,width:34,flex:"0 0 auto",color:J.text},children:x||""})]},p.date)})}),n&&e.jsx("div",{style:{fontSize:10,lineHeight:1.5,color:J.text},children:n})]}):e.jsx("div",{style:{fontSize:12,lineHeight:1.6,color:J.text},children:n||`Nothing on file for ${t}.`}):null]})}function tn({options:t,active:s,onChange:n,accent:r=Z.cyan,wrap:l=!1}){return e.jsx("div",{style:{display:"flex",alignItems:"center",gap:"clamp(2px, 0.4vw, 5px)",rowGap:l?4:void 0,flexWrap:l?"wrap":"nowrap",height:l?void 0:34,minHeight:34,padding:4,background:ae(Ra,.22),borderRadius:12,border:`1px solid ${ae(Z.text,.04)}`,flexShrink:0,maxWidth:"100%",boxSizing:"border-box"},children:t.map(i=>{const d=i.value===s;return e.jsxs("button",{type:"button",onClick:()=>n(i.value),style:{display:"flex",flexDirection:"row",alignItems:"center",justifyContent:"center",gap:"clamp(3px, 0.4vw, 5px)",flexShrink:0,height:l?26:"100%",padding:"0 clamp(7px, 1vw, 14px)",fontSize:"clamp(10px, 0.85vw, 12px)",border:d?`1px solid ${ae(r,.35)}`:"1px solid transparent",borderRadius:8,whiteSpace:"nowrap",background:d?`linear-gradient(180deg,${ae(r,.18)},${ae(r,.05)})`:ae(Z.text,.04),color:d?r:Z.text,fontWeight:700,cursor:"pointer",fontFamily:"inherit",transition:"background .14s, color .14s, border-color .14s",boxShadow:d?`0 0 14px ${ae(r,.25)}, 0 2px 8px ${ae(Ra,.35)}`:"none"},children:[e.jsx("span",{children:i.label}),i.sub&&e.jsx("span",{style:{fontSize:"clamp(9px, 0.7vw, 10.5px)",opacity:.7,fontWeight:600},children:i.sub})]},i.value)})})}function Gt({children:t,onClick:s,title:n,style:r,caret:l=!1,open:i=!1}){return e.jsxs("button",{type:"button",onClick:d=>{d.currentTarget.blur(),s?.()},title:n,"aria-haspopup":l?"menu":void 0,"aria-expanded":l?i:void 0,style:{minWidth:34,height:34,padding:"0 clamp(7px, 0.9vw, 11px)",borderRadius:9,boxSizing:"border-box",border:`1px solid ${l&&!i?"transparent":ae(Z.text,.06)}`,background:`linear-gradient(180deg,${ae(Z.text,.06)},${ae(Z.text,.02)})`,color:Z.text,fontSize:"clamp(11px, 0.9vw, 13px)",fontWeight:700,cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",gap:5,...r},children:[t,l&&e.jsx("span",{"aria-hidden":!0,style:{fontSize:8,lineHeight:1,marginLeft:1,display:"inline-block",opacity:i?.95:.45,transform:i?"rotate(180deg)":"none",transition:"transform 120ms ease, opacity 120ms ease"},children:"▼"})]})}function an({label:t,value:s,min:n,max:r,step:l=.01,onChange:i,format:d=w=>w.toFixed(2),width:p=90,accent:m=Z.cyan,title:c,steppers:h=!0,labelWidth:x,valueWidth:f=34,disabled:E=!1}){const w=p==="auto",T=o.useRef(s);T.current=s;const M=o.useRef(null),y=o.useRef(null),k=(String(l).split(".")[1]||"").length,N=z=>{const X=T.current+z*l,B=Number(Math.min(r,Math.max(n,X)).toFixed(k));B!==T.current&&i(B)},F=()=>{y.current&&(clearTimeout(y.current),y.current=null),M.current&&(clearInterval(M.current),M.current=null)},q=z=>{F(),N(z),y.current=setTimeout(()=>{M.current=setInterval(()=>N(z),60)},350)};o.useEffect(()=>F,[]);const V=E||s<=n,de=E||s>=r,le=(z,X)=>e.jsx("button",{type:"button",tabIndex:-1,disabled:X,"aria-label":z===1?"increase":"decrease",onPointerDown:B=>{B.preventDefault(),X||q(z)},onPointerUp:F,onPointerLeave:F,onPointerCancel:F,style:{display:"flex",alignItems:"center",justifyContent:"center",width:15,height:9,padding:0,fontSize:6,fontWeight:900,border:"none",background:"transparent",borderBottom:z===1?`1px solid ${ae(Z.text,.1)}`:"none",color:X?ae(Z.text,.16):m,cursor:X?"default":"pointer"},children:z===1?"▲":"▼"});return e.jsxs("span",{title:c,style:{display:"flex",alignItems:"center",gap:5,...w?{width:"100%",minWidth:0}:{flexShrink:0},...E?{opacity:.42,pointerEvents:"none"}:null},children:[e.jsx("style",{children:`
        input.dock-slider{-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;background:${ae(Z.text,.12)};outline:none;cursor:pointer}
        input.dock-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,${Z.text},${Z.cyan});border:1px solid ${ae(Z.text,.5)};box-shadow:0 0 8px ${ae(Z.cyan,.6)},0 1px 3px ${ae(Ra,.5)};cursor:pointer}
        input.dock-slider::-moz-range-thumb{width:13px;height:13px;border-radius:99px;background:linear-gradient(180deg,${Z.text},${Z.cyan});border:1px solid ${ae(Z.text,.5)};box-shadow:0 0 8px ${ae(Z.cyan,.6)};cursor:pointer}
        input.dock-slider::-moz-range-track{height:4px;border-radius:99px;background:${ae(Z.text,.12)}}
      `}),e.jsxs("label",{style:{display:"flex",alignItems:"center",gap:7,fontSize:10,color:ae(Z.text,.55),fontWeight:700,whiteSpace:"nowrap",...w?{flex:1,minWidth:0}:{flexShrink:0}},children:[t&&e.jsx("span",{style:x?{width:x,flexShrink:0}:void 0,children:t}),e.jsx("input",{className:"dock-slider",type:"range",min:n,max:r,step:l,value:s,disabled:E,onChange:z=>i(Number(z.target.value)),style:w?{flex:1,minWidth:0,accentColor:m}:{width:p,accentColor:m}}),e.jsx("span",{style:{width:f,flexShrink:0,textAlign:"right",fontVariantNumeric:"tabular-nums",fontSize:10,color:m},children:d(s)})]}),h&&e.jsxs("span",{style:{display:"flex",flexDirection:"column",flexShrink:0,borderRadius:4,overflow:"hidden",border:`1px solid ${ae(Z.text,.14)}`,background:ae(Z.text,.04)},children:[le(1,de),le(-1,V)]})]})}const ba=.03,sn=60,nn=.3,rn=20,on=150,ln=48,es=14,cn=.86,dn=1.16,pn=18,ia={oi:{tab:"OI+VOL",long:"OI + Volume",hint:"γ × (OI + Volume) × S². The whole board: positioning carried into the session PLUS everything traded on top of it. SPX trades nearly around the clock, so the volume leg is never really empty and stripping it out understates the board."},vol:{tab:"VOL",long:"Volume only",hint:"γ × Volume × S². Today's trading only — the cleanest read on fresh repositioning, with the carried-in OI leg stripped out."}},ma={auto:{tab:"AUTO",hint:"Spot ± 4.5σ of the gamma mass, widened to keep spot, flip and both walls on screen and to show at least 20 strikes each side. The peak fills the card instead of hiding in the middle of a 400-point axis."},1:{tab:"±1%",hint:"Fixed ±1% of spot."},2:{tab:"±2%",hint:"Fixed ±2% of spot."},3:{tab:"±3%",hint:"Fixed ±3% of spot. On SPX that is the whole board these cards read; on a name whose ±3% holds only a handful of strikes, AUTO reads wider (see wideHalfOf)."}},la=(t,s,n)=>Math.min(n,Math.max(s,t));function Nt(t,s=!0){const n=Math.abs(t),r=t<0?"−":s?"+":"";return n>=1e9?`${r}${(n/1e9).toFixed(n>=1e10?0:1)}B`:n>=1e6?`${r}${(n/1e6).toFixed(0)}M`:n>=1e3?`${r}${(n/1e3).toFixed(0)}K`:`${r}${n.toFixed(0)}`}function ks(t,s,n){return s==="vol"?ft(t,"vol",n):ft(t,"net",n)}function hn(t,s,n){if(t.callGamma==null&&t.putGamma==null&&(t.netGEX!=null||t.netVolGEX!=null))return Math.abs(ks(t,s,n));const r=s==="vol"?"vol":"net";return Math.abs(bs(t,r,n))+Math.abs(vs(t,r,n))}function Wa(t){const s=t.reduce((l,i)=>l+i.mass,0);if(!(s>0))return null;const n=t.reduce((l,i)=>l+i.k*i.mass,0)/s,r=t.reduce((l,i)=>l+i.mass*(i.k-n)**2,0)/s;return{mu:n,sigma:Math.sqrt(Math.max(r,1e-9)),total:s}}function mn(t,s){const n=[[t[0][0],t[0][1],t[0][2],s[0]],[t[1][0],t[1][1],t[1][2],s[1]],[t[2][0],t[2][1],t[2][2],s[2]]];for(let r=0;r<3;r++){let l=r;for(let i=r+1;i<3;i++)Math.abs(n[i][r])>Math.abs(n[l][r])&&(l=i);if(Math.abs(n[l][r])<1e-12)return null;[n[r],n[l]]=[n[l],n[r]];for(let i=0;i<3;i++){if(i===r)continue;const d=n[i][r]/n[r][r];for(let p=r;p<4;p++)n[i][p]-=d*n[r][p]}}return[n[0][3]/n[0][0],n[1][3]/n[1][1],n[2][3]/n[2][2]]}function ts(t){const s=Wa(t);if(!s)return null;const n={a:Math.max(...t.map(z=>z.mass),1),mu:s.mu,sigma:s.sigma,lsq:!1},r=Math.max(...t.map(z=>z.mass)),l=t.filter(z=>z.mass>r*.005);if(l.length<5)return n;const i=l.reduce((z,X)=>z+X.k,0)/l.length;let d=0,p=0,m=0,c=0,h=0,x=0,f=0,E=0;for(const z of l){const X=z.k-i,B=z.mass,re=Math.log(z.mass),ee=X*X;d+=B,p+=B*X,m+=B*ee,c+=B*ee*X,h+=B*ee*ee,x+=B*re,f+=B*X*re,E+=B*ee*re}const w=mn([[d,p,m],[p,m,c],[m,c,h]],[x,f,E]);if(!w)return n;const[T,M,y]=w;if(!(y<0))return n;const k=Math.sqrt(-1/(2*y)),N=-M/(2*y)+i,F=Math.exp(T-M*M/(4*y)),q=l[0],V=l[l.length-1],de=V.k-q.k;return Number.isFinite(k)&&Number.isFinite(N)&&Number.isFinite(F)&&k>.3&&k<de*2&&N>q.k-de&&N<V.k+de&&F>0&&F<r*12?{a:F,mu:N,sigma:k,lsq:!0}:n}function un(t,s,n){const r=t.reduce((i,d)=>i+d.mass,0);return r>0?t.filter(i=>i.k>=s-n&&i.k<=s+n).reduce((i,d)=>i+d.mass,0)/r*100:0}function gn(t,s){const n=s*ba;if(!(s>0)||!t.length)return n;const r=t.map(i=>Math.abs(i.strike-s)).filter(i=>Number.isFinite(i)).sort((i,d)=>i-d);if(!r.length)return n;const l=r[Math.min(sn,r.length)-1];return Math.min(Math.max(n,l),s*nn)}function xn(t,s){return o.useMemo(()=>gn(t,s),[t,s])}function fn(t,s,n,r,l){return o.useMemo(()=>{if(!t.length||!(s>0)||!(r>0))return[];const i=l!=null&&l>0?l:s,d=i-r,p=i+r;return t.filter(m=>Number.isFinite(m.strike)&&m.strike>=d&&m.strike<=p).map(m=>({k:m.strike,net:ks(m,n,s),mass:hn(m,n,s)})).filter(m=>Number.isFinite(m.net)&&Number.isFinite(m.mass)).sort((m,c)=>m.k-c.k)},[t,s,n,r,l])}function bn(t){return o.useMemo(()=>{if(t.length<2)return 5;const s=[];for(let n=1;n<t.length;n++)s.push(t[n].k-t[n-1].k);return s.sort((n,r)=>n-r),Math.max(.5,s[Math.floor(s.length/2)]||5)},[t])}function as(t,s=on){if(t.length<=s)return t;const n=t[0].k,l=(t[t.length-1].k-n)/s||1,i=[];for(const d of t){const p=Math.min(s-1,Math.floor((d.k-n)/l)),m=n+(p+.5)*l,c=i[i.length-1];c&&Math.abs(c.k-m)<1e-9?(c.net+=d.net,c.mass+=d.mass):i.push({k:m,net:d.net,mass:d.mass})}return i}function vn(t,s,n){if(!(s>0)||!t.length||n<1)return 0;const r=[],l=[];for(const d of t)Number.isFinite(d.k)&&(d.k<=s&&r.push(s-d.k),d.k>=s&&l.push(d.k-s));r.sort((d,p)=>d-p),l.sort((d,p)=>d-p);const i=d=>d.length?d[Math.min(n,d.length)-1]:0;return Math.max(i(r),i(l))}function kn(t,s,n,r,l,i,d){if(!(n>0))return 0;const p=d!=null&&d>0?d:n*ba;if(s!=="auto")return Math.min(n*(Number(s)/100),p);const m=Wa(t);let c=m?Math.max(4.5*m.sigma,n*.0035):n*.01;for(const h of[r,l,i])h!=null&&Number.isFinite(h)&&(c=Math.max(c,Math.abs(h-n)*1.12));return m&&(c=Math.max(c,Math.abs(m.mu-n)+2*m.sigma)),c=Math.max(c,vn(t,n,rn)),Math.min(c,p)}function ss(t,s,n){const[r,l]=o.useState(s);o.useEffect(()=>{try{const d=localStorage.getItem(t);d&&d in n&&l(d)}catch{}},[t]);const i=o.useCallback(d=>{l(d);try{localStorage.setItem(t,d)}catch{}},[t]);return[r,i]}function wn(t){const{spot:s,wide:n,zoom:r,flip:l,callWall:i,putWall:d,W:p,padL:m,plotW:c,svgRef:h}=t,x=t.center!=null&&t.center>0?t.center:s,f=t.maxHalf!=null&&t.maxHalf>0?t.maxHalf:x*ba,E=t.minHalf!=null&&t.minHalf>0?Math.min(t.minHalf,es):es,w=t.floorHalf!=null&&t.floorHalf>0?Math.min(t.floorHalf,f):0,[T,M]=o.useState(null),[y,k]=o.useState(1),[N,F]=o.useState(!1),q=o.useRef(null),V=o.useCallback(()=>{M(null),k(1)},[]),de=o.useMemo(()=>kn(n,r,x,l,i,d,f),[n,r,x,l,i,d,f]),le=T?T.c:x,z=T?T.h:Math.max(de,w),X=le-z,B=le+z,re=o.useRef({k0:X,k1:B,W:p,padL:m,plotW:c,spot:x,maxHalf:f,minHalf:E});o.useEffect(()=>{re.current={k0:X,k1:B,W:p,padL:m,plotW:c,spot:x,maxHalf:f,minHalf:E}},[X,B,p,m,c,x,f,E]);const ee=o.useCallback((C,v)=>{const I=re.current;return{c:la(C,I.spot-I.maxHalf,I.spot+I.maxHalf),h:la(v,Math.min(I.minHalf,I.maxHalf),I.maxHalf)}},[]),Le=o.useCallback(C=>{const v=h.current,I=re.current;if(!v||!(I.k1>I.k0))return;C.preventDefault();const G=v.getBoundingClientRect();if(G.width<=0)return;const se=(C.clientX-G.left)/G.width*I.W,Pe=la((se-I.padL)/I.plotW,0,1),Ae=I.k0+Pe*(I.k1-I.k0),Qe=(I.k1-I.k0)/2,ot=la(Qe*(C.deltaY>0?dn:cn),Math.min(I.minHalf,I.maxHalf),I.maxHalf);Math.abs(ot-Qe)<1e-6||M(ee(Ae-(Pe-.5)*2*ot,ot))},[ee,h]);o.useEffect(()=>{const C=h.current;if(C)return C.addEventListener("wheel",Le,{passive:!1}),()=>C.removeEventListener("wheel",Le)},[Le,h]);const oe=o.useCallback(C=>{if(C.button!==0)return;const v=re.current,I=C.currentTarget.getBoundingClientRect();if(I.width<=0||!(v.k1>v.k0))return;const G=v.W/I.width,se=(C.clientX-I.left)*G;q.current={mode:se<v.padL+pn?"yscale":"pan",startX:C.clientX,startY:C.clientY,startC:(v.k0+v.k1)/2,startYScale:y,kPerPx:(v.k1-v.k0)/v.plotW*G},F(!0),C.currentTarget.setPointerCapture(C.pointerId),C.preventDefault()},[y]),pe=o.useCallback(C=>{const v=q.current;if(!v)return!1;if(v.mode==="yscale")k(la(v.startYScale*Math.pow(1.003,v.startY-C.clientY),.1,12));else{const I=re.current;M(ee(v.startC-(C.clientX-v.startX)*v.kPerPx,(I.k1-I.k0)/2))}return!0},[ee]),$=o.useCallback(()=>{q.current=null,F(!1)},[]);return{k0:X,k1:B,center:le,half:z,yScale:y,dragging:N,touched:T!=null||y!==1,reset:V,onPointerDown:oe,onPointerMove:pe,endDrag:$}}function yn(t,s){const n=[-1/0,-1/0,-1/0];return t.filter(r=>r.k!=null&&Number.isFinite(r.k)&&r.k>=s.k0&&r.k<=s.k1).map(r=>{const l=r.label.length*5.5+10,i=Math.abs(r.k-s.spot)<1e-9?0:r.k<s.spot?-1:1,d=s.x(r.k)+i*(l/2+12),p=Math.min(Math.max(d,s.padL+l/2),s.W-s.padR-l/2);return{...r,w:l,cx:p}}).sort((r,l)=>r.cx-l.cx).map((r,l)=>{const i=r.cx-r.w/2;let d=n.findIndex(p=>i>p+6);return d<0&&(d=l%3),n[d]=i+r.w,{...r,row:d}})}const jn="cb-premarket-gbell-basis-v1",Nn="cb-premarket-gbell-zoom-v1",K={t:58,r:18,b:38,l:72},Ta=16,Sn=.6,Mn=`
.gdist{margin-top:14px;border-top:1px solid var(--line);padding:14px 18px 6px}
.gdist .gd-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  flex-wrap:wrap;margin-bottom:9px}
.gdist .gd-lh{display:flex;align-items:baseline;gap:9px;min-width:0;flex-wrap:wrap}
.gdist .gd-lh h3{font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.gdist .gd-sub{font-size:var(--text-2xs);letter-spacing:.04em;color:var(--dim2);
  font-variant-numeric:tabular-nums}
.gdist .gd-rh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.gdist .gd-ctl{display:flex;align-items:center;gap:5px}
.gdist .gd-ctl>b{font-size:var(--text-3xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim2);
  font-weight:600}
.gdist .gd-reset{background:transparent;border:1px solid var(--amberEdge);color:var(--amber);
  font:inherit;font-size:var(--text-2xs);letter-spacing:.05em;padding:3px 9px;border-radius:var(--r2);
  cursor:pointer;white-space:nowrap}
.gdist .gd-reset:hover{background:var(--amberWash)}

/* KPI STRIP — six tiles, never floated over the plot. Three describe the FIT
   (peak, width, mass inside 1σ) and three describe the BOARD (its moment
   centre, net GEX, total mass). They are deliberately adjacent: "curve peak"
   and "center of mass" are different numbers and the gap between them is a
   real read — see the least-squares note in this file's header. */
.gdist .gd-kpis{display:grid;grid-template-columns:repeat(var(--gd-cols,6),minmax(0,1fr));
  gap:7px;margin-bottom:9px}
.gdist .gd-kpi{border:1px solid var(--line);border-radius:var(--r2);background:var(--sunken);
  padding:6px 9px;min-width:0}
.gdist .gd-kpi .n{font-size:var(--text-3xs);letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gdist .gd-kpi .v{font-size:13.5px;font-weight:650;color:var(--txt);margin-top:2px;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.gdist .gd-kpi .m{font-size:9.5px;color:var(--dim2);font-variant-numeric:tabular-nums;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.gdist .gd-wrap{position:relative;width:100%}
/* pan-y keeps the PAGE scrollable under a vertical flick on a phone while a
   horizontal drag still pans the chart. */
.gdist svg{display:block;width:100%;height:auto;touch-action:pan-y;cursor:grab;
  user-select:none;-webkit-user-select:none}
.gdist svg.dragging{cursor:grabbing}
.gdist .gd-pane-l{font-size:var(--text-3xs);letter-spacing:.09em;text-transform:uppercase;font-weight:700}
.gdist .gd-tip{position:absolute;pointer-events:none;z-index:3;transform:translateX(-50%);
  background:var(--plate);border:1px solid var(--line2);border-radius:var(--r2);
  padding:6px 9px;font-size:10.5px;font-variant-numeric:tabular-nums;color:var(--txt);
  box-shadow:0 8px 22px color-mix(in srgb, var(--color-shadow) 35%, transparent);white-space:nowrap;line-height:1.55}
.gdist .gd-tip b{font-weight:700}
.gdist .gd-tip .r{display:flex;justify-content:space-between;gap:14px;color:var(--dim2)}
.gdist .gd-tip .r span:last-child{color:var(--txt)}
.gdist .gd-foot{font-size:var(--text-xs);color:var(--dim2);line-height:1.6;margin:9px 0 4px;max-width:104ch}
.gdist .gd-foot b{color:var(--dim);font-weight:650}
.gdist .gd-empty{padding:48px 0;text-align:center;color:var(--dim);font-size:12px}
@media (max-width:1300px){ .gdist .gd-kpis{--gd-cols:3} }
@media (max-width:680px){ .gdist .gd-kpis{--gd-cols:2} }
`;function En({chain:t,spot:s,expiry:n,isZeroDte:r,flip:l,callWall:i,putWall:d,frozen:p,axisAnchor:m}){const c=s>=1e3?0:2,h=o.useCallback(g=>g.toLocaleString("en-US",{minimumFractionDigits:c,maximumFractionDigits:c}),[c]),x=o.useId().replace(/[^a-zA-Z0-9_-]/g,""),[f,E]=ss(jn,"oi",ia),[w,T]=ss(Nn,"auto",ma),M=o.useRef(null),y=o.useRef(null),[k,N]=o.useState(760),F=o.useCallback(g=>{if(M.current=g,!g||typeof ResizeObserver>"u")return;new ResizeObserver(([A])=>{const ne=A?.contentRect?.width??0;ne>0&&N(Math.max(320,Math.round(ne)))}).observe(g)},[]),q=Math.round(Math.min(660,Math.max(440,k*.44))),V=Math.max(80,k-K.l-K.r),de=q-K.t-K.b,le=Math.max(60,(de-Ta)*Sn),z=Math.max(50,de-Ta-le),X=K.t,B=K.t+le,re=B+Ta,ee=re+z,Le=m&&m.center>0?m.center:s,oe=m&&m.halfSpan>0?m.halfSpan:0,$=xn(t,Le)+oe,C=fn(t,s,f,$,Le),v=bn(C),I=wn({spot:s,wide:C,zoom:w,flip:l,callWall:i,putWall:d,W:k,padL:K.l,plotW:V,svgRef:y,center:Le,floorHalf:oe>0?oe+v*3:0,maxHalf:$,minHalf:v*3}),{k0:G,k1:se,yScale:Pe,dragging:Ae,touched:Qe,reset:ot}=I,Tt=o.useCallback(g=>{T(g),ot()},[T,ot]),Pt=o.useMemo(()=>!C.length||!(se>G)?[]:as(C.filter(g=>g.k>=G-2*v&&g.k<=se+2*v)),[C,G,se,v]),xe=o.useMemo(()=>Pt.filter(g=>g.k>=G&&g.k<=se),[Pt,G,se]),Je=o.useMemo(()=>C.length?as(C):[],[C]),Ve=o.useMemo(()=>{const g=ts(Je);if(!g)return null;const W=Wa(Je);return{...g,com:W?W.mu:g.mu,insidePct:un(Je,g.mu,g.sigma),totalMass:Je.reduce((A,ne)=>A+ne.mass,0),netTotal:Je.reduce((A,ne)=>A+ne.net,0)}},[Je]),Me=o.useMemo(()=>{const g=W=>{if(!Je.length)return null;const A=Je.map(ie=>({k:ie.k,net:ie.net,mass:Math.max(0,W*ie.net)})).filter(ie=>ie.mass>0);if(A.length<5)return null;const ne=ts(A);return!ne||!(ne.a>0)||!(ne.sigma>0)?null:{...ne,total:A.reduce((ie,Ne)=>ie+Ne.mass,0)}};return{long:g(1),short:g(-1)}},[Je]),ct=o.useMemo(()=>{if(!xe.length||!Ve)return null;const g=be=>K.l+(be-G)/(se-G)*V,W=Ve.mu>=G&&Ve.mu<=se,A=Math.max(...xe.map(be=>be.mass),W?Ve.a:0,1),ne=le/A*Pe,ie=be=>B-be*ne,Ne=Math.max(0,...xe.map(be=>be.net)),Ue=Math.max(0,...xe.map(be=>-be.net)),ta=Ne+Ue||1,ge=re+z*(Ne/ta),me=z/ta*Pe,H=be=>ge-be*me;let et=1/0;for(let be=1;be<xe.length;be++){const zt=xe[be].k-xe[be-1].k;zt>1e-9&&zt<et&&(et=zt)}const ja=Number.isFinite(et)?Math.min(et,v):v,Ge=V/Math.max(1e-9,se-G)*ja,Na=Math.min(ln,Ge>6?Math.max(3,Ge-3):Math.max(1.5,Ge*.82));return{x:g,yTop:ie,yNet:H,maxMass:A,maxP:Ne,maxN:Ue,zeroY:ge,barW:Na}},[xe,Ve,G,se,V,le,B,re,z,Pe,v]),[ke,Mt]=o.useState(null),va=o.useCallback(g=>{if(I.onPointerMove(g)){Mt(null);return}if(!ct||!xe.length)return;const W=g.currentTarget.getBoundingClientRect();if(W.width<=0)return;const A=(g.clientX-W.left)/W.width*k;if(A<K.l||A>k-K.r){Mt(null);return}let ne=0,ie=1/0;for(let Ne=0;Ne<xe.length;Ne++){const Ue=Math.abs(ct.x(xe[Ne].k)-A);Ue<ie&&(ie=Ue,ne=Ne)}Mt(ne)},[I,ct,xe,k]),je=ke!=null&&ke<xe.length?xe[ke]:null,he=ia[f],j=e.jsxs("div",{className:"gd-head",children:[e.jsxs("div",{className:"gd-lh",children:[e.jsx("h3",{children:"Gamma Bell Curve"}),e.jsxs("span",{className:"gd-sub",children:[r?"0DTE":"front",n?` ${n}`:""," · ",he.long,Ve?` · ${Ve.lsq?"least-squares":"moment"} fit`:"",Pe!==1?` · y ×${Pe.toFixed(2)}`:""]})]}),e.jsxs("div",{className:"gd-rh",children:[Qe&&e.jsx("button",{type:"button",className:"gd-reset",onClick:ot,title:"Back to the Range tab's window and y-scale (or just double-click the chart)",children:"⤾ reset"}),e.jsxs("div",{className:"gd-ctl",children:[e.jsx("b",{children:"Range"}),e.jsx("div",{className:"seg",role:"group","aria-label":"Strike window",children:Object.keys(ma).map(g=>e.jsx("button",{type:"button",className:w===g&&!Qe?"on":"","aria-pressed":w===g&&!Qe,title:ma[g].hint,onClick:()=>Tt(g),children:ma[g].tab},g))})]}),e.jsxs("div",{className:"gd-ctl",children:[e.jsx("b",{children:"Basis"}),e.jsx("div",{className:"seg",role:"group","aria-label":"Gamma basis",children:Object.keys(ia).map(g=>e.jsx("button",{type:"button",className:f===g?"on":"","aria-pressed":f===g,title:ia[g].hint,onClick:()=>E(g),children:ia[g].tab},g))})]})]})]});if(!xe.length||!Ve||!ct)return e.jsxs("div",{className:"gdist",children:[j,e.jsx("div",{className:"gd-empty",children:t.length===0?"Waiting for the chain…":f==="vol"?"No volume on this board yet — nothing has traded. Switch to OI+VOL.":Qe?"Nothing in this window — double-click to reset the view.":`No gamma within ±${s>0?($/s*100).toFixed(0):(ba*100).toFixed(0)}% of spot on this basis.`})]});const{a:fe,mu:R,sigma:O,lsq:Ut,com:bt,insidePct:Te,totalMass:Oe,netTotal:We}=Ve,{x:Ee,yTop:dt,yNet:Ft,maxMass:Yt,maxP:Kt,maxN:qt,zeroY:it,barW:Et}=ct,pa=(()=>{const W=[];for(let A=0;A<=220;A++){const ne=G+(se-G)*A/220,ie=fe*Math.exp(-((ne-R)**2)/(2*O*O));W.push(`${A===0?"M":"L"}${Ee(ne).toFixed(2)},${dt(ie).toFixed(2)}`)}return W.join(" ")})(),$t=(g,W)=>{if(!g)return null;const A=220,ne=[];for(let ie=0;ie<=A;ie++){const Ne=G+(se-G)*ie/A,Ue=g.a*Math.exp(-((Ne-g.mu)**2)/(2*g.sigma*g.sigma));ne.push(`${ie===0?"M":"L"}${Ee(Ne).toFixed(2)},${Ft(W*Ue).toFixed(2)}`)}return ne.join(" ")},_e=$t(Me.long,1),Ct=$t(Me.short,-1),Zt=(se-G)/6,Qt=10**Math.floor(Math.log10(Math.max(Zt,1))),Jt=[1,2,2.5,5,10].map(g=>g*Qt).find(g=>g>=Zt)??Qt*10,vt=[];for(let g=Math.ceil(G/Jt)*Jt;g<=se;g+=Jt)vt.push(g);const ka=[Yt,Yt*.5],ea=[Kt,-qt].filter(g=>Math.abs(g)>0),wa=yn([{k:d,label:`Put wall ${h(d??0)}`,color:"var(--pw)",dash:"3 3"},{k:i,label:`Call wall ${h(i??0)}`,color:"var(--cw)",dash:"3 3"},{k:l,label:`Flip ${h(l??0)}`,color:"var(--violet)",dash:"5 4"},{k:s,label:`Spot ${h(s)}`,color:"var(--txt)",dash:"6 4"}],{k0:G,k1:se,spot:s,x:Ee,W:k,padL:K.l,padR:K.r}),kt=Ee(Math.max(G,R-O)),ya=Ee(Math.min(se,R+O));return e.jsxs("div",{className:"gdist",children:[j,e.jsxs("div",{className:"gd-kpis",children:[e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Curve peak"}),e.jsx("div",{className:"v",children:h(R)}),e.jsxs("div",{className:"m",children:[R>=s?"+":"−",h(Math.abs(R-s))," vs spot"]})]}),e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Width 1σ"}),e.jsxs("div",{className:"v",children:["±",h(O)," pts"]}),e.jsxs("div",{className:"m",children:[h(R-O)," – ",h(R+O)]})]}),e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Mass inside 1σ"}),e.jsxs("div",{className:"v",children:[Te.toFixed(0),"%"]}),e.jsx("div",{className:"m",children:Te>=80?"more peaked than normal":Te>=68?"tighter than normal":"flatter than normal"})]}),e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Center of mass"}),e.jsx("div",{className:"v",children:h(bt)}),e.jsxs("div",{className:"m",children:[bt>=s?"+":"−",h(Math.abs(bt-s))," vs spot"]})]}),e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Net GEX, board"}),e.jsx("div",{className:`v ${We>=0?"chg-pos":"chg-neg"}`,children:Nt(We)}),e.jsx("div",{className:"m",children:We>=0?"dealers dampen":"dealers amplify"})]}),e.jsxs("div",{className:"gd-kpi",children:[e.jsx("div",{className:"n",children:"Gamma mass, total"}),e.jsx("div",{className:"v",children:Nt(Oe,!1)}),e.jsx("div",{className:"m",children:he.long})]})]}),e.jsxs("div",{className:"gd-wrap",ref:F,children:[e.jsxs("svg",{ref:y,className:Ae?"dragging":void 0,viewBox:`0 0 ${k} ${q}`,width:k,height:q,role:"img","aria-label":`Gamma mass per strike on the ${he.long} basis with a fitted normal curve, over a net GEX pane. Scroll to zoom, drag to pan, double-click to reset.`,onPointerDown:I.onPointerDown,onPointerMove:va,onPointerUp:I.endDrag,onPointerCancel:I.endDrag,onDoubleClick:ot,onMouseLeave:()=>{I.endDrag(),Mt(null)},children:[e.jsxs("defs",{children:[e.jsx("clipPath",{id:`gb-top-${x}`,children:e.jsx("rect",{x:K.l,y:X-8,width:V,height:le+8})}),e.jsx("clipPath",{id:`gb-bot-${x}`,children:e.jsx("rect",{x:K.l,y:re,width:V,height:z})})]}),e.jsx("rect",{x:kt,y:X,width:Math.max(0,ya-kt),height:ee-X,fill:"var(--amberWash)"}),ka.map(g=>{const W=dt(g);return W<X-2||W>B||Math.abs(W-B)<11?null:e.jsxs("g",{children:[e.jsx("line",{x1:K.l,x2:k-K.r,y1:W,y2:W,stroke:"var(--line)",strokeWidth:1}),e.jsx("text",{x:K.l-9,y:W+3.5,textAnchor:"end",fontSize:10,fill:"var(--dim2)",style:{fontVariantNumeric:"tabular-nums"},children:Nt(g,!1)})]},`m${g}`)}),e.jsx("line",{x1:K.l,x2:k-K.r,y1:B,y2:B,stroke:"var(--line2)",strokeWidth:1}),e.jsx("text",{x:K.l-9,y:B+3.5,textAnchor:"end",fontSize:10,fill:"var(--dim2)",children:"0"}),e.jsx("text",{x:K.l,y:X-6,fontSize:9,fill:"var(--dim2)",className:"gd-pane-l",stroke:"var(--panel)",strokeWidth:3,paintOrder:"stroke",children:"Gamma mass"}),e.jsxs("g",{clipPath:`url(#gb-top-${x})`,children:[Pt.map(g=>{const W=dt(g.mass);return e.jsx("rect",{x:Ee(g.k)-Et/2,y:W,width:Et,height:Math.max(.6,B-W),fill:"var(--blue)",opacity:je==null||je.k===g.k?.72:.4},`m${g.k}`)}),e.jsx("path",{d:pa,fill:"none",stroke:"var(--amber)",strokeWidth:2.2,strokeLinejoin:"round"})]}),ea.map(g=>{const W=Ft(g);return W<re-2||W>ee+2||Math.abs(W-it)<11?null:e.jsxs("g",{children:[e.jsx("line",{x1:K.l,x2:k-K.r,y1:W,y2:W,stroke:"var(--line)",strokeWidth:1}),e.jsx("text",{x:K.l-9,y:W+3.5,textAnchor:"end",fontSize:10,fill:"var(--dim2)",style:{fontVariantNumeric:"tabular-nums"},children:Nt(g)})]},`n${g}`)}),e.jsx("line",{x1:K.l,x2:k-K.r,y1:it,y2:it,stroke:"var(--line3)",strokeWidth:1}),e.jsx("text",{x:K.l-9,y:it+3.5,textAnchor:"end",fontSize:10,fill:"var(--dim2)",children:"0"}),e.jsxs("g",{clipPath:`url(#gb-bot-${x})`,children:[Pt.map(g=>{const W=g.net>=0,A=Ft(g.net);return e.jsx("rect",{x:Ee(g.k)-Et/2,y:W?A:it,width:Et,height:Math.max(.6,Math.abs(A-it)),fill:W?"var(--pos)":"var(--neg)",opacity:je==null||je.k===g.k?.92:.5},`n${g.k}`)}),_e&&e.jsx("path",{d:_e,fill:"none",stroke:"var(--amber)",strokeWidth:1.1,strokeDasharray:"7 5",strokeLinejoin:"round",strokeLinecap:"round",opacity:.42}),Ct&&e.jsx("path",{d:Ct,fill:"none",stroke:"var(--amber)",strokeWidth:1.1,strokeDasharray:"7 5",strokeLinejoin:"round",strokeLinecap:"round",opacity:.42})]}),e.jsxs("text",{x:K.l+6,y:re+11,fontSize:9,fill:"var(--pos)",className:"gd-pane-l",stroke:"var(--panel)",strokeWidth:3,paintOrder:"stroke",children:["long gamma · dealers dampen",Me.long?` · peak ${h(Me.long.mu)} · σ ${h(Me.long.sigma)}`:""]}),e.jsxs("text",{x:K.l+6,y:ee-4,fontSize:9,fill:"var(--neg)",className:"gd-pane-l",stroke:"var(--panel)",strokeWidth:3,paintOrder:"stroke",children:["short gamma · dealers amplify",Me.short?` · peak ${h(Me.short.mu)} · σ ${h(Me.short.sigma)}`:""]}),wa.map(g=>{const W=14+g.row*14;return e.jsxs("g",{children:[e.jsx("line",{x1:Ee(g.k),x2:Ee(g.k),y1:X-6,y2:ee,stroke:g.color,strokeWidth:1.2,strokeDasharray:g.dash,opacity:.85}),e.jsx("path",{d:`M${g.cx.toFixed(1)},${W+4} L${g.cx.toFixed(1)},${(X-12).toFixed(1)} L${Ee(g.k).toFixed(1)},${X-6}`,fill:"none",stroke:g.color,strokeWidth:1,opacity:.45}),e.jsx("text",{x:g.cx,y:W,textAnchor:"middle",fontSize:10,fill:g.color,fontWeight:700,style:{letterSpacing:".04em"},children:g.label})]},g.label)}),je&&!Ae&&e.jsx("line",{x1:Ee(je.k),x2:Ee(je.k),y1:X-6,y2:ee,stroke:"var(--cyan)",strokeWidth:1,opacity:.55}),e.jsx("line",{x1:K.l,x2:k-K.r,y1:ee,y2:ee,stroke:"var(--line2)",strokeWidth:1}),vt.map(g=>e.jsx("text",{x:Ee(g),y:ee+16,textAnchor:"middle",fontSize:10,fill:"var(--dim2)",style:{fontVariantNumeric:"tabular-nums"},children:h(g)},`x${g}`)),e.jsx("text",{x:K.l+V/2,y:q-5,textAnchor:"middle",fontSize:9,fill:"var(--dim2)",style:{letterSpacing:".1em",textTransform:"uppercase"},children:"Strike"}),e.jsx("text",{x:k-K.r,y:q-5,textAnchor:"end",fontSize:9,fill:"var(--dim2)",opacity:.7,children:"scroll=zoom · drag=pan · dbl=reset"})]}),je&&!Ae&&e.jsxs("div",{className:"gd-tip",style:{left:`clamp(76px, ${(Ee(je.k)/k*100).toFixed(2)}%, calc(100% - 76px))`,top:4},children:[e.jsx("b",{children:h(je.k)}),e.jsxs("div",{className:"r",children:[e.jsx("span",{children:"mass"}),e.jsx("span",{children:Nt(je.mass,!1)})]}),e.jsxs("div",{className:"r",children:[e.jsx("span",{children:"net"}),e.jsx("span",{children:Nt(je.net)})]}),e.jsxs("div",{className:"r",children:[e.jsx("span",{children:"fit"}),e.jsx("span",{children:Nt(fe*Math.exp(-((je.k-R)**2)/(2*O*O)),!1)})]})]})]}),e.jsxs("p",{className:"gd-foot",children:["Bell peaks at ",e.jsx("b",{children:h(R)})," with a 1σ width of ",e.jsxs("b",{children:["±",h(O)]})," pts (",(O/s*100).toFixed(2),"% of spot); ",Te.toFixed(0),"% of the mass is inside it, so the board is"," ",Te>=80?"far more concentrated than the fitted normal":Te>=68?"tighter than normal":"flatter than normal","."," ","Net GEX over the window is ",e.jsx("b",{children:Nt(We)}),".",Ut?"":" Not bell-shaped enough to fit — falling back to the moment curve.",p?" Captured session, not live.":""]})]})}const fa=19,ws=440,Pa=(ws-fa)/2,$n=60;function ns(t,s){return!t.length||!(s>0)?null:t.reduce((n,r)=>Math.abs(r-s)<Math.abs(n-s)?r:n,t[0])}function rs({title:t,sub:s,rows:n,spot:r,flip:l,kDp:i,pxDp:d,tagFor:p,resetKey:m,empty:c="Waiting for the chain…",fmtUsd:h,nf:x,fmtPx:f,children:E}){const w=o.useMemo(()=>n.filter($=>Number.isFinite($.strike)&&Number.isFinite($.net)).slice().sort(($,C)=>$.strike-C.strike),[n]),T=o.useMemo(()=>!w.length||!(r>0)?-1:w.reduce(($,C,v)=>Math.abs(C.strike-r)<Math.abs(w[$].strike-r)?v:$,0),[w,r]),M=o.useCallback($=>{if(T<0)return[];const C=Math.max(0,T-$),v=Math.min(w.length,T+$+1);return w.slice(C,v).slice().reverse()},[w,T]),y=o.useMemo(()=>M($n),[M]),k=Math.max(1,...y.filter($=>$.net>0).map($=>$.net)),N=Math.max(1,...y.filter($=>$.net<0).map($=>-$.net)),F=Math.max(k,N)*.55,q=ns(y.map($=>$.strike),r),V=l?ns(y.map($=>$.strike),l):null,de=o.useRef(null),le=o.useRef(!0),z=o.useRef(0),[X,B]=o.useState(!0),re=o.useCallback(()=>{const $=de.current;if(!$)return!1;const C=y.findIndex(G=>G.strike===q);if(C<0)return!1;const v=$.querySelectorAll(".row")[C];if(!v||$.clientHeight<=0||$.scrollHeight<=0)return!1;const I=Math.max(0,Math.min(v.offsetTop-($.clientHeight-v.offsetHeight)/2,$.scrollHeight-$.clientHeight));return Math.abs($.scrollTop-I)>1&&($.scrollTop=I),!0},[y,q]);o.useEffect(()=>{let $=0,C=0;const v=()=>{$=0,le.current&&!re()&&C++<90&&($=requestAnimationFrame(v))};le.current&&v();const I=de.current,G=I&&typeof ResizeObserver<"u"?new ResizeObserver(()=>{le.current&&re()}):null;return I&&G&&G.observe(I),()=>{$&&cancelAnimationFrame($),G?.disconnect()}},[re]);const ee=o.useCallback(()=>{z.current=Date.now()},[]),Le=o.useCallback(()=>{Date.now()-z.current>700||le.current&&(le.current=!1,B(!1))},[]),oe=o.useCallback(()=>{le.current=!0,B(!0),re()},[re]);o.useEffect(()=>{le.current=!0,B(!0),z.current=0},[m]);const pe=$=>{if($==null)return null;const C=y.findIndex(v=>v.strike===$);return C<0?null:Pa+C*fa+fa/2};return e.jsxs("div",{className:"col",children:[e.jsxs("div",{className:"colhead",children:[e.jsx("h3",{children:t}),e.jsx("span",{className:"tiny",children:s})]}),e.jsxs("div",{style:{position:"relative"},children:[e.jsxs("div",{className:"chart",ref:de,onScroll:Le,onWheel:ee,onTouchMove:ee,onPointerDown:ee,onKeyDown:ee,style:y.length?{height:ws,paddingTop:Pa,paddingBottom:Pa,overflowX:"hidden"}:{overflowX:"hidden"},children:[y.length===0&&e.jsx("div",{style:{padding:"40px 0",textAlign:"center",color:"var(--dim)",fontSize:12},children:c}),y.map($=>{const C=$.net>=0,v=Math.min(50,Math.abs($.net)/(C?k:N)*50),I=p?.($.strike)??null;return e.jsxs("div",{className:`row${I?" key":""}`,children:[e.jsx("div",{className:"k mono",children:x($.strike,i)}),e.jsxs("div",{className:"track",children:[e.jsx("div",{className:`bar ${C?"p":"n"}${Math.abs($.net)>F?"":" dimmed"}`,style:{width:`${v}%`}}),I&&(()=>{const G=v>=22,se=G?C?{right:`calc(50% - ${v}% + 4px)`}:{left:`calc(50% - ${v}% + 4px)`}:C?{left:`calc(50% + ${v}% + 6px)`}:{right:`calc(50% + ${v}% + 6px)`};return e.jsx("span",{className:`tag${G?" inside":""}`,style:{...se,color:I.color,border:`1px solid ${I.color}`},children:I.text})})()]})]},$.strike)}),pe(q)!=null&&e.jsx("div",{className:"spotline",style:{top:pe(q)},children:e.jsxs("span",{children:["SPOT ",f(r,d)]})}),pe(V)!=null&&e.jsx("div",{className:"flipline",style:{top:pe(V)},children:e.jsxs("span",{children:["FLIP ",f(l,d)]})})]}),!X&&y.length>0&&e.jsx("button",{type:"button",className:"recenter",onClick:oe,children:"⤒ back to spot"})]}),e.jsxs("div",{className:"axis",children:[e.jsx("span",{children:h(-N,!1)}),e.jsx("span",{children:"0"}),e.jsx("span",{children:h(k,!1)})]}),E]})}const ye=(t,s=0)=>t.toLocaleString("en-US",{minimumFractionDigits:s,maximumFractionDigits:s}),P=(t,s=0)=>t==null||!Number.isFinite(t)||t<=0?"—":ye(t,s),lt=t=>t==null||!Number.isFinite(t)?"—":`${t>=0?"+":"−"}${ye(Math.abs(t),0)} pts`,nt=(t,s=2)=>t==null||!Number.isFinite(t)?"—":`${t>=0?"+":"−"}${Math.abs(t).toFixed(s)}%`;function we(t,s=!0){if(t==null||!Number.isFinite(t))return"—";const n=Math.abs(t),r=t<0?"−":s?"+":"";return n>=1e9?`${r}$${(n/1e9).toFixed(2)}B`:n>=1e6?`${r}$${(n/1e6).toFixed(0)}M`:n>=1e3?`${r}$${(n/1e3).toFixed(1)}K`:`${r}$${n.toFixed(0)}`}const cr=t=>`${String(Math.floor(t/60)).padStart(2,"0")}:${String(Math.round(t%60)).padStart(2,"0")}`,dr=t=>t==="ok"?"pill cool":t==="bad"?"pill hot":t==="warn"?"pill warn":t==="vio"?"pill vio":"pill",Cn=[],Fa={chain:Cn,spot:0,prevClose:0,flip:null,callWall:null,putWall:null,totalNetGex:null,expiry:"",isZeroDte:!1,esFut:0,basis:null,connected:!1,hasData:!1,updatedAt:null,source:"off"},ce=t=>{const s=parseFloat(String(t??0));return Number.isFinite(s)?s:0},ua=t=>{const s=parseInt(String(t??0),10);return Number.isFinite(s)?s:0};function In(){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(new Date)}function os(t){if(!t)return 0;const s=ce(t.mark)||ce(t["mark-price"]);if(s>0)return s;const n=ce(t.bid)||ce(t["bid-price"]),r=ce(t.ask)||ce(t["ask-price"]);return n>0||r>0?(n+r)/2:ce(t.last)||ce(t["last-price"])||ce(t.close)}function is(t){if(!t)return 0;const s=ce(t["implied-volatility"])||ce(t.iv)||ce(t.impliedVolatility);return s>0?s>5?s/100:s:0}function Tn(t,s,n){const r=t,l=r.filter(p=>String(p["expiration-date"]??"").slice(0,10)===s.slice(0,10)),i=l.length?l:r,d=[];for(const p of i)for(const m of p.strikes??[]){const c=m,h=ce(c["strike-price"]);if(!h)continue;const x=c.call,f=c.put,E=ua(x?.["open-interest"]??x?.openInterest),w=ua(f?.["open-interest"]??f?.openInterest),T=ua(x?.volume),M=ua(f?.volume);if(!E&&!w&&!T&&!M)continue;const y=ce(x?.vanna),k=ce(f?.vanna),N=y!==0||k!==0,F=n*100;d.push({strike:h,spot:n,callGamma:Math.abs(ce(x?.gamma)),putGamma:Math.abs(ce(f?.gamma)),callDelta:ce(x?.delta),putDelta:ce(f?.delta),callOI:E,putOI:w,callVolume:T,putVolume:M,callMark:os(x),putMark:os(f),callIV:is(x),putIV:is(f),...N?{netVanna:y*E*F-k*w*F,netVolVanna:y*T*F-k*M*F}:{}})}return d.sort((p,m)=>p.strike-m.strike),d}function Pn(t,s){if(!t.length||!(s>0))return{callWall:null,putWall:null};let n=null,r=null;for(const l of t){const i=ft(l,"net",s);Number.isFinite(i)&&(l.strike>s&&i>0&&(n==null||i>n.v)&&(n={k:l.strike,v:i}),l.strike<s&&i<0&&(r==null||i<r.v)&&(r={k:l.strike,v:i}))}return{callWall:n?.k??null,putWall:r?.k??null}}function Fn(t,s,n=6e4){const r=(t||"").trim().toUpperCase(),[l,i]=o.useState(Fa),d=o.useRef(0);return o.useEffect(()=>{i(Fa)},[r,s]),o.useEffect(()=>{if(!s||!r)return;let p=!1;const m=new AbortController,c=async()=>{const x=++d.current,f=()=>p||x!==d.current;try{const E=In(),w=await fetch(`/api/expirations?ticker=${encodeURIComponent(r)}`,{cache:"no-store",signal:m.signal});if(!w.ok||f())return;const T=await w.json(),y=[...new Set((T?.data?.items??[]).map(z=>String(z["expiration-date"]??"").slice(0,10)).filter(Boolean))].sort().find(z=>z>=E);if(!y||f())return;const k=await fetch(`/api/chains?ticker=${encodeURIComponent(r)}&expiration=${encodeURIComponent(y)}&range=all`,{cache:"no-store",signal:m.signal});if(!k.ok||f())return;const N=await k.json(),F=ce(N?.data?.underlyingPrice),q=F>0?Tn(N?.data?.items??[],y,F):[];if(f())return;if(!q.length||!(F>0)){i(z=>z.hasData?z:{...Fa,source:"rest"});return}const V=q.reduce((z,X)=>z+ft(X,"net",F),0),{callWall:de,putWall:le}=Pn(q,F);i({chain:q,spot:F,prevClose:0,flip:La(q,F),callWall:de,putWall:le,totalNetGex:Number.isFinite(V)?V:null,expiry:y,isZeroDte:y===E,esFut:0,basis:null,connected:!0,hasData:!0,updatedAt:Date.now(),source:"rest"})}catch{!p&&!m.signal.aborted&&i(E=>E.hasData?{...E,connected:!1}:E)}};c();const h=setInterval(c,n);return()=>{p=!0,m.abort(),clearInterval(h)}},[r,s,n]),l}const ga={all:null,ex0dte:null,expiryCount:0,updatedAt:null,state:"idle"},xa=t=>{if(t==null||t==="")return null;const s=Number(t);return Number.isFinite(s)?s:null};function ls(t){const s=t;return!s||!Array.isArray(s.rows)?null:{rows:s.rows.map(r=>({strike:ce(r.strike),net:ce(r.netGEX)+ce(r.netVolGEX)})).filter(r=>Number.isFinite(r.strike)&&r.strike>0&&Number.isFinite(r.net)),totalNetGex:xa(s.totalNetGex),gexFlip:xa(s.gexFlip),callWall:xa(s.callWall),putWall:xa(s.putWall)}}function zn(t,s,n,r=6e4){const l=(t||"").trim().toUpperCase(),[i,d]=o.useState(ga),p=o.useRef(0),m=o.useRef(s);m.current=s;const c=s>0;return o.useEffect(()=>{d(ga)},[l,n]),o.useEffect(()=>{if(!n||!l||!c)return;let h=!1;const x=new AbortController,f=async()=>{const T=++p.current,M=()=>h||T!==p.current,y=m.current;if(y>0)try{const N=await fetch(`/proxy/gex-by-strike-multi?symbol=${encodeURIComponent(l==="SPX"?"$SPX":l)}&spot=${y.toFixed(2)}`,{cache:"no-store",signal:x.signal});if(M())return;const F=await N.json();if(M())return;if(!F?.ok){d(de=>({...de,state:de.all?de.state:"error"}));return}const q=ls(F.all),V=ls(F.ex0dte);d({all:q,ex0dte:V,expiryCount:ce(F.expiryCount),updatedAt:ce(F.updatedAt)||Date.now(),state:V?.rows.length||q?.rows.length?"ok":"empty"})}catch{!h&&!x.signal.aborted&&d(k=>k.all?k:{...ga,state:"error"})}};d(T=>T.all?T:{...ga,state:"loading"});const E=setTimeout(()=>{f()},400),w=setInterval(f,r);return()=>{h=!0,x.abort(),clearTimeout(E),clearInterval(w)}},[l,n,c,r]),i}const za=t=>new Date(t).toLocaleDateString("en-CA",{timeZone:"America/New_York"}),An=t=>new Date(t).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:!1}),ys=t=>{const[s,n]=An(t).split(":").map(Number);return s!==void 0&&Number.isFinite(s)?s*60+(n||0):-1},On=t=>{const s=new Date(new Date(t).toLocaleString("en-US",{timeZone:"America/New_York"}));return s.getDay()===0||s.getDay()===6},js=570,Ns=960,pr="cb-postmarket-notes-v1";function Rn(t,s=15){const n=[t];let r=Date.parse(`${t}T12:00:00Z`);if(!Number.isFinite(r))return n;for(;n.length<s;){r-=864e5;const l=new Date(r);l.getUTCDay()===0||l.getUTCDay()===6||n.push(l.toISOString().slice(0,10))}return n}function Ss(t){let s=Date.parse(`${t}T12:00:00Z`);if(!Number.isFinite(s))return t;for(let n=0;n<7;n++){s-=864e5;const r=new Date(s);if(!(r.getUTCDay()===0||r.getUTCDay()===6))return r.toISOString().slice(0,10)}return t}function St(t){const s=Date.parse(`${t}T12:00:00Z`);return Number.isFinite(s)?new Date(s).toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric"}):t}const ue=t=>{const s=Number(t);return Number.isFinite(s)?s:0},xt=t=>{if(t==null||t==="")return null;const s=Number(t);return Number.isFinite(s)?s:null};function Aa(t,s){if(!t||!Array.isArray(t.gexRows)||!t.gexRows.length)return null;const n=t.gexRows;return{chain:n,spot:t.spot,flip:La(n,t.spot)??t.gexFlip,callWall:t.callWall,putWall:t.putWall,totalNetGex:t.totalNetGex,esFut:t.esFut,basis:t.basis,expiry:t.expiry,isZeroDte:!!t.expiry&&t.expiry.slice(0,10)===s,connected:!1,hasData:!0,updatedAt:t.updatedAt,source:"off"}}function Dn(t,s){const[n,r]=o.useState(null),[l,i]=o.useState(null),[d,p]=o.useState("loading");return o.useEffect(()=>{if(!s||!t){p("empty"),r(null),i(null);return}let m=!0;return p("loading"),r(null),i(null),(async()=>{try{const h=await(await rt(`/proxy/premarket-freeze?date=${encodeURIComponent(t)}&symbol=SPX`,{cache:"no-store"},3e4)).json();if(!m)return;if(!h?.ok||!Array.isArray(h.rows)){p("error");return}const x=h.rows,f=T=>x.find(M=>M.slot===T)?.payload??null,E=f("pre"),w=f("post");r(E),i(w),p(E||w?"ok":"empty")}catch{m&&p("error")}})(),()=>{m=!1}},[t,s]),{pre:n,post:l,state:d}}function Ln(t=120){const[s,n]=o.useState([]),[r,l]=o.useState("loading");o.useEffect(()=>{let d=!0;return(async()=>{try{const m=await(await rt(`/proxy/premarket-freeze?dates=1&limit=${t}&symbol=SPX`,{cache:"no-store"},6e4)).json();if(!d)return;if(!m?.ok||!Array.isArray(m.rows)){l("error");return}const c=m.rows.map(h=>({date:String(h.date??"").slice(0,10),pre:!!h.has_pre,post:!!h.has_post})).filter(h=>h.date);n(c),l(c.length?"ok":"empty")}catch{d&&l("error")}})(),()=>{d=!1}},[t]);const i=o.useMemo(()=>new Map(s.map(d=>[d.date,d])),[s]);return{rows:s,byDate:i,state:r}}function Oa(t){if(!Number.isFinite(t)||t<0)return"—";const s=Math.floor(t/60)%24,n=Math.floor(t%60);return`${String(s).padStart(2,"0")}:${String(n).padStart(2,"0")}`}function Wn(t,s,n="SPX"){const[r,l]=o.useState([]),[i,d]=o.useState("loading");return o.useEffect(()=>{if(!s||!t){l([]),d("empty");return}let p=!0;return d("loading"),l([]),(async()=>{try{const c=await(await rt(`/proxy/premarket-replay?date=${encodeURIComponent(t)}&symbol=${encodeURIComponent(n)}`,{cache:"no-store"},3e4)).json();if(!p)return;if(!c?.ok||!Array.isArray(c.frames)){d("error");return}const h=c.frames.map(x=>({minute:ue(x.minute),ts:ue(x.ts),payload:x.payload})).filter(x=>x.payload&&Array.isArray(x.payload.gexRows)&&x.payload.gexRows.length>0).sort((x,f)=>x.minute-f.minute);l(h),d(h.length?"ok":"empty")}catch{p&&d("error")}})(),()=>{p=!1}},[t,s,n]),{frames:r,state:i}}function _n(t=120,s="SPX"){const[n,r]=o.useState([]),[l,i]=o.useState("loading");o.useEffect(()=>{let p=!0;return(async()=>{try{const c=await(await rt(`/proxy/premarket-replay?dates=1&limit=${t}&symbol=${encodeURIComponent(s)}`,{cache:"no-store"},6e4)).json();if(!p)return;if(!c?.ok||!Array.isArray(c.rows)){i("error");return}const h=c.rows.map(x=>({date:String(x.date??"").slice(0,10),frames:ue(x.frames),firstMin:ue(x.first_min),lastMin:ue(x.last_min)})).filter(x=>x.date&&x.frames>0);r(h),i(h.length?"ok":"empty")}catch{p&&i("error")}})(),()=>{p=!1}},[t,s]);const d=o.useMemo(()=>new Map(n.map(p=>[p.date,p])),[n]);return{rows:n,byDate:d,state:l}}async function cs(t){const n=await(await rt(`/api/snapshots/candles?date=${encodeURIComponent(t)}&interval=5&limit=600&lite=1`,{cache:"no-store"},3e4)).json(),r=Array.isArray(n?.cols)?n.cols:[],l=Array.isArray(n?.rows)?n.rows:[];if(!r.length||!l.length)return[];const i=w=>r.indexOf(w),d=i("timestamp"),p=i("date"),m=i("slotKey"),c=i("open"),h=i("high"),x=i("low"),f=i("close"),E=i("volume");return l.map(w=>({timestamp:ue(w[d]),date:String(w[p]??t),slotKey:String(w[m]??""),open:ue(w[c]),high:ue(w[h]),low:ue(w[x]),close:ue(w[f]),volume:ue(w[E])})).filter(w=>w.timestamp>0&&w.close>0&&w.slotKey)}function Gn(t,s){const[n,r]=o.useState([]),[l,i]=o.useState("loading");return o.useEffect(()=>{if(!s||!t){r([]),i("empty");return}let d=!0;return i("loading"),r([]),(async()=>{try{const[p,m]=await Promise.all([cs(Ss(t)),cs(t)]);if(!d)return;const c=[...p,...m].sort((h,x)=>h.timestamp-x.timestamp||h.slotKey.localeCompare(x.slotKey));r(c),i(c.length?"ok":"empty")}catch{d&&i("error")}})(),()=>{d=!1}},[t,s]),{rows:n,state:l}}const Ms=40;function Hn(t=Ms,s="SPX"){const[n,r]=o.useState([]),[l,i]=o.useState("loading");o.useEffect(()=>{let m=!0;return(async()=>{try{const h=await(await rt(`/proxy/gex-levels-history?symbol=${encodeURIComponent(s)}&limit=${t}`,{cache:"no-store"},2e4)).json();if(!m)return;if(!h?.ok||!Array.isArray(h.rows)){i("error");return}const x=h.rows.map(f=>({date:String(f.date??"").slice(0,10),spot:ue(f.spot),resistance:xt(f.resistance),support:xt(f.support),neutral:xt(f.neutral),dollarGamma:ue(f.dollar_gamma),cpgRatio:ue(f.cpg_ratio),r2:xt(f.r2),s2:xt(f.s2),openInt:ue(f.open_int),curve:Array.isArray(f.curve)?f.curve.map(E=>({k:ue(E.k),c:ue(E.c)})).filter(E=>E.k>0):null,source:String(f.source??"")})).filter(f=>f.date&&f.spot>0).sort((f,E)=>f.date<E.date?1:-1);r(x),i(x.length?"ok":"empty")}catch{m&&i("error")}})(),()=>{m=!1}},[t,s]);const d=o.useMemo(()=>new Map(n.map(m=>[m.date,m])),[n]),p=o.useMemo(()=>n.map(m=>m.date),[n]);return{rows:n,byDate:d,dates:p,state:l}}function hr(t){const[s,n]=o.useState(null),[r,l]=o.useState("loading");return o.useEffect(()=>{if(!t)return;let i=!0;return l("loading"),n(null),(async()=>{try{const p=await(await rt(`/api/eod-gex?date=${encodeURIComponent(t)}&limit=50`,{cache:"no-store"},15e3)).json();if(!i)return;const c=(Array.isArray(p?.rows)?p.rows:[]).find(h=>{const x=String(h.symbol??"").toUpperCase();return x==="$SPX"||x==="SPX"});if(!c){l("empty");return}n({date:String(c.date??t).slice(0,10),totalGex:ue(c.total_gex),spot:ue(c.spot),gex0dte:xt(c.total_gex_0dte),gexEx0dte:xt(c.total_gex_ex0dte),pinStrike:xt(c.pin_strike),pinShare:xt(c.pin_share),source:String(c.source??"")}),l("ok")}catch{i&&l("error")}})(),()=>{i=!1}},[t]),{row:s,state:r}}function mr(t){const[s,n]=o.useState([]),[r,l]=o.useState("loading");o.useEffect(()=>{if(!t)return;let d=!0;return l("loading"),n([]),(async()=>{try{const m=await(await rt(`/api/snapshots/candles?date=${encodeURIComponent(t)}&interval=5&limit=600&lite=1`,{cache:"no-store"},2e4)).json();if(!d)return;const c=Array.isArray(m?.cols)?m.cols:[],h=Array.isArray(m?.rows)?m.rows:[];if(!c.length||!h.length){l("empty");return}const x=k=>c.indexOf(k),f=x("timestamp"),E=x("open"),w=x("high"),T=x("low"),M=x("close");if(f<0||M<0){l("error");return}const y=h.map(k=>({ts:ue(k[f]),open:ue(k[E]),high:ue(k[w]),low:ue(k[T]),close:ue(k[M])})).filter(k=>k.ts>0&&k.close>0).sort((k,N)=>k.ts-N.ts);n(y),l(y.length?"ok":"empty")}catch{d&&l("error")}})(),()=>{d=!1}},[t]);const i=o.useMemo(()=>s.filter(d=>{const p=ys(d.ts);return p>=js&&p<=Ns}),[s]);return{bars:s,rth:i,state:r}}function ur(t,s,n,r="SPX"){const[l,i]=o.useState([]),[d,p]=o.useState("loading"),m=o.useMemo(()=>{const c=n||za(Date.now());return On(Date.parse(`${c}T12:00:00Z`))?Ss(c):c},[n]);return o.useEffect(()=>{if(!s||!m)return;let c=!1;const h=async()=>{try{const f=await rt(`/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=0&date=${encodeURIComponent(m)}&expiry=${encodeURIComponent(s)}&symbol=${encodeURIComponent(r)}`,{cache:"no-store"},2e4);if(!f.ok){c||p("error");return}const E=await f.json();if(E?.error||!Array.isArray(E?.columns)){c||p("error");return}const w=E.columns.filter(M=>Array.isArray(M.cells)&&M.cells.length);if(!w.length){c||(i([]),p("empty"));return}const T=w.filter(M=>za(M.slotTs)===m).filter(M=>{const y=ys(M.slotTs);return y>=js&&y<=Ns}).sort((M,y)=>M.slotTs-y.slotTs).map(M=>{const y=new Map;for(const k of M.cells)!Number.isFinite(k.strike)||!Number.isFinite(k.net)||y.set(k.strike,k.net);return{ts:M.slotTs,spot:Number(M.spot??0),cells:[...y.entries()].map(([k,N])=>({strike:k,net:N}))}});if(c)return;i(T),p(T.length?"ok":"empty")}catch{c||p("error")}};if(h(),m!==za(Date.now()))return()=>{c=!0};const x=setInterval(h,12e4);return()=>{c=!0,clearInterval(x)}},[t,s,m,r]),{cols:l,state:d}}function Xn(t,s,n){const r=t.filter(h=>String(h["expiration-date"]??"").slice(0,10)===s.slice(0,10));if(!r.length||!(n>0))return null;const l=[],i=n;for(const h of r)for(const x of h.strikes||[]){const f=x,E=parseFloat(String(f["strike-price"]??0));if(!E)continue;const w=F=>{if(!F)return{gamma:0,n:0};const q=parseFloat(String(F.gamma))||0,V=parseInt(String(F["open-interest"]??F.openInterest??0),10)||0,de=parseInt(String(F.volume??0),10)||0;return{gamma:q,n:V+de}},T=w(f.call),M=w(f.put),y=i*i*.01*100,k=T.gamma*T.n*y,N=-(M.gamma*M.n*y);!Number.isFinite(k)||!Number.isFinite(N)||l.push({strike:E,call:k,put:N,net:k+N})}if(l.length<5)return null;l.sort((h,x)=>h.strike-x.strike);const d=l.map(h=>({strike:h.strike,netGEX:h.net,netVolGEX:0})),p=l.reduce((h,x)=>x.call>h.call?x:h,l[0]),m=l.reduce((h,x)=>Math.abs(x.put)>Math.abs(h.put)?x:h,l[0]),c=l.reduce((h,x)=>Math.abs(x.net)>Math.abs(h.net)?x:h,l[0]);return{expiry:s,flip:La(d,n),callWall:p.call>0?p.strike:null,putWall:m.put<0?m.strike:null,cb:c.strike,netGex:l.reduce((h,x)=>h+x.net,0)}}function gr(t,s,n,r="SPX"){const[l,i]=o.useState(null),[d,p]=o.useState("loading"),m=o.useRef("");return o.useEffect(()=>{if(!t||!s||!(n>0))return;const c=`${r}|${s}|${Math.round(n)}`;if(m.current===c)return;m.current=c;let h=!1;return(async()=>{try{const f=await rt(`/api/expirations?ticker=${encodeURIComponent(r)}`,{cache:"no-store"},15e3);if(!f.ok){h||p("error");return}const T=((await f.json())?.data?.items??[]).map(F=>String(F["expiration-date"]??"").slice(0,10)).filter(Boolean).sort().find(F=>F>s.slice(0,10));if(!T){h||p("empty");return}const M=await rt(`/api/chains?ticker=${encodeURIComponent(r)}&expiration=${encodeURIComponent(T)}&range=all`,{cache:"no-store"},25e3);if(!M.ok){h||p("error");return}const k=(await M.json())?.data?.items??[],N=Xn(k,T,n);if(h)return;if(!N){p("empty");return}i(N),p("ok")}catch{h||p("error")}})(),()=>{h=!0}},[t,s,n,r]),{next:l,state:d}}const xr={reject:"REJECTED",break_lt5:"BROKE <5",break_5:"BROKEN",consolidated:"BROKE & HELD",new_wall:"WALL ROLLED",pin:"PINNED",rolled_over:"HELD AT DISTANCE",reached:"TAGGED",stalled:"STALLED NEAR"},fr={reject:"ok",rolled_over:"ok",break_lt5:"warn",break_5:"bad",consolidated:"bad",new_wall:"bad",pin:"vio",reached:"warn",stalled:"warn"},br={call_wall:"Call Wall",put_wall:"Put Wall",cb:"CORE"};function ds(t){return t===0?569:585+(t-1)*15}function vr(t,s="SPX",n){const[r,l]=o.useState([]),[i,d]=o.useState([]),[p,m]=o.useState("loading");o.useEffect(()=>{if(!t)return;let f=!0;return(async()=>{try{const w=await(await fetch(`/proxy/walls?date=${encodeURIComponent(t)}&symbol=${encodeURIComponent(s)}`,{cache:"no-store"})).json();if(!f)return;if(!w?.ok){m("error");return}const T=Array.isArray(w.log)?w.log:[],M=Array.isArray(w.events)?w.events:[];l(T),d(M),m(T.length||M.length?"ok":"empty")}catch{f&&m("error")}})(),()=>{f=!1}},[t,s]);const c=o.useMemo(()=>n==null?r:r.filter(f=>ds(f.slot)<=n),[r,n]),h=o.useMemo(()=>n==null?i:i.filter(f=>ds(f.hit_slot)<=n),[i,n]),x=o.useMemo(()=>{const f=new Map;for(const E of["call_wall","put_wall","cb"]){const w=c.filter(y=>y.level_type===E).sort((y,k)=>y.slot-k.slot);if(!w.length)continue;const T=w.find(y=>y.reason==="open")??w[0],M=w[w.length-1];f.set(E,{open:T.strike??null,last:M.strike??null,moves:w.filter(y=>y.reason==="change").length,events:h.filter(y=>y.level_type===E).sort((y,k)=>y.hit_slot-k.hit_slot)})}return f},[c,h]);return{log:c,events:h,byLevel:x,state:p}}const Bn=o.lazy(()=>Da(()=>import("./PostMarketTab-BNDkSjfi.js"),__vite__mapDeps([0,1,2,3,4,5,6,7]))),Vn=o.lazy(()=>Da(()=>import("./HistoricalRecap-Pquj7mK4.js"),__vite__mapDeps([8,1,2,3,5,6,4,7]))),Un=o.lazy(()=>Da(()=>import("./CbContracts-DHgA-Sjm.js"),__vite__mapDeps([9,1,2,3,5,6,4,7]))),Q=(t,s)=>ae(t,s),Ht=t=>ae(Z.text,t),Yn=`
.pmk{
  /* SURFACE TOKENS — interpolated from components/shared/homeTheme, never typed
     as hex here (AGENTS.md). This block used to be the mockup's own slate ramp
     (#0a0d12 / #11161f / #151b26 / #242e3b), which is why the page read as a
     different product from the rest of the app: the cards sat a full step
     lighter than every other card in the dashboard and their edges were a solid
     slate line rather than the app's white hairline.
     Everything below is now the SAME surface language as the shared Card and
     the earnings week board: HT.panelBg fill, HT.border hairline, one radius. */
  --bg:${J.bg}; --panel:${J.panel}; --panel2:${J.panelBg};
  --line:${J.border}; --line2:${Ht(.2)};
  /* Card outline. Still a white alpha, and now literally the app's border token:
     the cards sit on three different backgrounds (panel, panel2, the green/red
     regime wash) and a fixed hex reads as a different weight on each. */
  --card:${J.border};
  /* Card interior + the hover/active fill controls use. Both are white alphas
     over --bg for the same reason the border is. */
  --sunken:${Ht(.05)}; --active:${Ht(.08)};
  --line3:${Ht(.3)}; --off:${Ht(.28)};
  /* The one SOLID plate on the page. Bar tags, the ladder's spot/flip labels and
     the footer sit ON TOP of coloured bars, so they cannot use a white alpha —
     it would let the bar read straight through the text. HT.panel is the app's
     opaque panel colour, which is what the old var(--plate) was approximating. */
  --plate:${J.panel};
  --cyan:${J.cyan}; --cyanEdge:${Q(J.cyan,.45)}; --cyanWash:${Q(J.cyan,.1)};
  --txt:${J.text}; --dim:${J.text}; --dim2:${J.muted};
  /* --muted was MISSING from this alias layer while GexChurnFeed and
     GexWatchFeed both style their secondary text with it. An undefined
     custom property makes the whole color declaration invalid, so those
     lines silently fell back to the inherited colour instead of the muted
     one — the same class of bug as v2's grey text, in the other direction. */
  --muted:${J.muted};
  /* The +/- gamma pair is the app's CANDLE pair now (homeTheme ES_CANDLE_UP /
     ES_CANDLE_DOWN), not this page's private green/red — so a bar on the
     premarket ladder is the same green as an up-candle two tabs over. */
  --pos:${st}; --posDim:${Q(st,.45)};
  --neg:${Ze}; --negDim:${Q(Ze,.45)};
  /* WALL COLOURS, kept separate from the +/− gamma pair on purpose.
     --pos / --neg say "positive or negative gamma" and belong to the bars.
     --cw / --pw say "call wall / put wall" and belong to the LEVELS. They were
     the same tokens until 2026-08-20, which meant flipping the wall convention
     would have re-coloured every bar on the page. Call wall reads GREEN and put
     wall RED on every ticker and every surface — change it here, once.
     NOT re-pointed at LEVEL_COLORS.cw/.pw (blue/red): that would silently undo
     the 2026-08-20 green/red decision as a side effect of a re-theme. */
  --cw:${st}; --pw:${Ze};
  --amber:${J.orange}; --blue:${gt}; --violet:var(--color-violet);
  /* ALPHA RUNGS. Every wash, edge, glow and bar-fill on this page is derived
     from the five accent tokens above instead of being typed as a literal
     rgba(). That is not tidiness: PostMarketTab.tsx and HistoricalRecap.tsx are
     separate template literals with no access to the JS side, so a hand-typed
     green in one of them silently keeps the OLD hue after this block moves —
     which is exactly how a "pill.cool" ends up with a border one shade off its
     own text. Change an accent above and every rung follows, in all four
     files. */
  --posWash:${Q(st,.08)}; --posEdge:${Q(st,.22)};
  --posEdgeUp:${Q(st,.4)}; --posBand:${Q(st,.28)};
  --posGlow:${Q(st,.16)}; --posGlow2:${Q(st,.05)};
  --negWash:${Q(Ze,.08)}; --negEdge:${Q(Ze,.22)};
  --negEdgeUp:${Q(Ze,.4)}; --negBand:${Q(Ze,.28)};
  --negGlow:${Q(Ze,.16)};
  --blueWash:${Q(gt,.06)}; --blueBand:${Q(gt,.14)};
  --blueEdge:${Q(gt,.22)}; --blueSoft:${Q(gt,.3)};
  --blueFill1:${Q(gt,.4)}; --blueFill2:${Q(gt,.6)};
  --blueFill3:${Q(gt,.85)};
  --amberWash:${Q(J.orange,.07)}; --amberEdge:${Q(J.orange,.4)};
  --amberSoft:${Q(J.orange,.5)};
  /* Two radii for the whole page — the week board's card (12) and its inner
     tile (9). Every rounded surface picks one; nothing types its own. */
  --r:12px; --r2:9px;
  background:var(--bg);color:var(--txt);
  /* --font-sans is v3's own stack (design/tokens.css). v2 asked for
     --font-inter here, which is a Next font variable that does not exist in
     this app — the page fell through to the generic list every render. */
  font:13px/1.45 var(--font-sans);
  -webkit-font-smoothing:antialiased;height:100%;overflow:auto;
}
.pmk *{box-sizing:border-box}
.pmk .wrap{max-width:1560px;margin:0 auto;padding:18px 20px 60px}
.pmk .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.pmk .muted{color:var(--dim)}
.pmk .tiny{font-size:var(--text-2xs);letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}

.pmk .pagehead{display:flex;align-items:baseline;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.pmk .pagehead h1{font-size:17px;margin:0;font-weight:650;letter-spacing:-.01em}
.pmk .badge-concept{font-size:var(--text-2xs);padding:3px 8px;border:1px solid var(--line2);border-radius:999px;color:var(--dim);letter-spacing:.06em}

/* SESSION PICKER — the same shell as .tabs so the head reads as one control
   strip: 1px var(--line2) border, 9px radius, 11.5px type. A native select is
   used (it is a one-of-many choice and the OS list is the right affordance on
   a phone) but its chrome is stripped and the caret is redrawn from theme
   tokens, because the platform caret is the one part that cannot be themed.
   The caret is on the WRAPPER, so it stays put whatever the label's width. */
.pmk .dsel{position:relative;display:inline-flex;align-items:center;align-self:center}
.pmk .dsel::after{content:"";position:absolute;right:11px;top:50%;width:5px;height:5px;
  border-right:1.5px solid var(--dim);border-bottom:1.5px solid var(--dim);
  transform:translateY(-70%) rotate(45deg);pointer-events:none}
.pmk .dsel select{appearance:none;-webkit-appearance:none;-moz-appearance:none;
  background:transparent;color:var(--txt);border:1px solid var(--line2);border-radius:9px;
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 27px 5px 12px;cursor:pointer;
  font-variant-numeric:tabular-nums}
.pmk .dsel select:hover{background:var(--active)}
.pmk .dsel select:focus{outline:none;border-color:var(--cyanEdge)}
/* The popup list is drawn by the OS and inherits nothing — these two are the
   only properties it honours, and without them a dark page opens a white menu. */
.pmk .dsel option{background:var(--plate);color:var(--txt)}
.pmk .dsel.past select{border-color:var(--amberEdge);color:var(--amber)}
.pmk .dsel.past::after{border-color:var(--amber)}

/* FROZEN banner. Violet, not amber: amber on this page means "caution, check
   this" (the warnbars, the stale-calendar chip) and a frozen session is not a
   warning — it is a correct, complete render of a day that has ended. It sits
   above the section so it cannot read as one panel's caveat. */
.pmk .frozenbar{margin-bottom:12px;padding:9px 13px;border-radius:var(--r);
  border:1px solid color-mix(in srgb, var(--color-violet) 30%, transparent);background:color-mix(in srgb, var(--color-violet) 7%, transparent);
  font-size:12px;color:var(--dim)}
.pmk .frozenbar b{color:var(--violet)}

/* ── REPLAY ───────────────────────────────────────────────────────────────
   Cyan, not violet: violet on this page means "a finished day, rendered
   correctly" (the frozen banner) and this is the opposite — a session you are
   DRIVING. Cyan is the app's action colour everywhere else, so the bar reads as
   a control strip rather than as another disclosure.

   The transport is DOCKED TO THE BOTTOM of the page, not carried in the head.
   Two reasons, and the second is the real one:

     • It is five controls, a scrubber and a clock. Pushed into .pagehead it
       wraps onto a second row on anything narrower than a wide desktop and the
       head stops reading as one strip (the same reason the symbol picker
       became a select).
     • The page IS the replay and the page is five screens tall. A transport
       that scrolls away above the fold is one you have to scroll back up to
       reach, and the panel most worth watching build — the book, on the
       Post-Market tab — is nowhere near the top. Docked, it stays under the
       cursor wherever you are reading.

   .pmk is the scroll container (height:100%; overflow:auto), so the bar is
   the LAST CHILD of it with position:sticky; bottom:0 — pinned to the viewport
   edge for the whole scroll, then at rest in flow at the very end, so it never
   permanently covers anything. It needs an OPAQUE plate under the cyan wash for
   the same reason: page content runs underneath it. */
.pmk .rplbtn{background:transparent;border:1px solid var(--line2);color:var(--dim);
  font:inherit;font-size:11.5px;letter-spacing:.04em;padding:5px 12px;border-radius:9px;
  cursor:pointer;align-self:center;white-space:nowrap}
.pmk .rplbtn:hover{background:var(--active)}
.pmk .rplbtn.on{border-color:var(--cyanEdge);background:var(--cyanWash);color:var(--cyan);font-weight:600}
.pmk .rplbtn:disabled{opacity:.4;cursor:not-allowed}

.pmk .rplbar{position:sticky;bottom:0;z-index:30;
  padding:9px 20px 10px;border-top:1px solid var(--cyanEdge);
  /* Cyan wash OVER the app's opaque plate: the wash alone is translucent and
     the page scrolls beneath this bar. */
  background:linear-gradient(var(--cyanWash),var(--cyanWash)), var(--plate);
  box-shadow:0 -14px 34px color-mix(in srgb, var(--color-shadow) 34%, transparent)}
/* Same centred column as .wrap, so the transport lines up with the page. */
.pmk .rplwrap{max-width:1560px;margin:0 auto}
.pmk .rplrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.pmk .rplrow+.rplrow{margin-top:9px}
.pmk .rpltag{font-size:var(--text-2xs);font-weight:800;letter-spacing:.08em;text-transform:uppercase;
  color:var(--cyan);white-space:nowrap}
/* One cluster of keys — /es-candles groups its transport the same way, so the
   bar reads as three controls rather than nine buttons. */
.pmk .rplgrp{display:flex;align-items:center;gap:4px;flex-shrink:0}
.pmk .rpldate{font-size:12px;font-weight:800;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  color:var(--cyan);min-width:78px;text-align:center;white-space:nowrap}
.pmk .rplsp{font-size:var(--text-2xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dim2)}
/* Close, pinned right. Same shape and reason as /es-candles' ✕: the
   no-frames branch renders one sentence and no transport, so without this the
   bar could be opened and not closed. */
.pmk .rplx{width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;
  background:${Ht(.04)};border:1px solid ${J.border};color:var(--dim2);cursor:pointer;
  font:inherit;font-size:var(--text-base);line-height:1;font-weight:700;flex-shrink:0}
.pmk .rplx:hover{background:var(--active);color:var(--txt)}
/* Transport buttons. Square-ish and monospaced so ▶ / ❚❚ do not change the
   button's width when the state flips — a play control that resizes as you use
   it is the one place a 2px shift is genuinely annoying. */
.pmk .rplt{background:var(--sunken);border:1px solid var(--line2);color:var(--txt);
  font:inherit;font-size:12px;min-width:34px;padding:4px 9px;border-radius:var(--r2);
  cursor:pointer;font-variant-numeric:tabular-nums}
.pmk .rplt:hover:not(:disabled){background:var(--active)}
.pmk .rplt:disabled{opacity:.35;cursor:not-allowed}
.pmk .rplt.play{min-width:74px;border-color:var(--cyanEdge);color:var(--cyan);font-weight:600}
.pmk .rplclock{font-size:14px;font-weight:650;color:var(--txt);font-variant-numeric:tabular-nums;
  white-space:nowrap}
.pmk .rplclock small{font-size:10.5px;font-weight:500;color:var(--dim2);letter-spacing:.06em}
/* The scrub is a DockSlider now (width:"auto" → it flexes), so the old bare
   <input type=range> rule is gone rather than left to rot. */
/* Coverage toggle. Square, so ⓘ never changes the row's height. */
.pmk .rplt.info{min-width:30px;padding:4px 8px}
.pmk .rplt.info.on{border-color:var(--cyanEdge);color:var(--cyan)}
/* Takes the scrubber's place when a session has no frames — a dead track
   spanning the bar reads as "loading forever" rather than "nothing recorded". */
.pmk .rplmsg{flex:1;min-width:160px;font-size:11.5px;color:var(--dim2)}
.pmk .rplnote{border-top:1px solid var(--line);padding-top:8px}
.pmk .rplbar .note{font-size:var(--text-xs);color:var(--dim2);line-height:1.55;max-width:110ch}
.pmk .rplbar .note b{color:var(--dim);font-weight:650}

/* OUTER SHELL — the app's card, with a regime tint on top.
   The tint is semantic (green = positive gamma, red = negative) so it stays,
   but the SURFACE underneath is now the shared card: the app's panel colour,
   one hairline border, the app's drop shadow, and the cyan top edge every other
   glossy panel in the dashboard carries. The old coloured 1px ring is gone — it
   read as a second border in a UI where no other card has one, and 190px of
   gradient already makes the regime unmistakable. */
.pmk .prep{
  border:1px solid var(--card);border-top:2px solid var(--cyanEdge);
  border-radius:16px;overflow:hidden;
  background:linear-gradient(180deg,${Q(st,.07)},${Q(st,0)} 190px), var(--panel);
  box-shadow:0 18px 40px color-mix(in srgb, var(--color-shadow) 22%, transparent);
}
.pmk .prep.is-neg{
  border-top-color:${Q(Ze,.45)};
  background:linear-gradient(180deg,${Q(Ze,.08)},${Q(Ze,0)} 190px), var(--panel);
}

.pmk .regime{
  display:grid;grid-template-columns:minmax(230px,auto) 1px 1fr 1px 1fr 1px 1fr auto;
  gap:0;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);
}
.pmk .vr{background:var(--line);height:44px;width:1px;margin:0 18px}
.pmk .regbadge{display:flex;align-items:center;gap:11px}
.pmk .dot{width:9px;height:9px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 4px var(--posGlow);animation:pmkpulse 2.6s infinite}
.pmk .dot.neg{background:var(--neg);box-shadow:0 0 0 4px var(--negGlow)}
.pmk .dot.off{background:var(--off);box-shadow:none;animation:none}
@keyframes pmkpulse{0%,100%{box-shadow:0 0 0 4px var(--posGlow)}50%{box-shadow:0 0 0 8px var(--posGlow2)}}
.pmk .regbadge .lbl{font-size:19px;font-weight:700;letter-spacing:-.02em;color:var(--pos)}
.pmk .regbadge .lbl.neg{color:var(--neg)}
.pmk .regbadge .sub{font-size:10.5px;color:var(--dim)}
.pmk .kpi .k{font-size:var(--text-2xs);letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:3px}
.pmk .kpi .v{font-size:19px;font-weight:640;letter-spacing:-.02em}
.pmk .kpi .v small{font-size:var(--text-xs);font-weight:500;color:var(--dim)}
.pmk .chg-pos{color:var(--pos)}
.pmk .chg-neg{color:var(--neg)}
.pmk .bias{
  justify-self:end;text-align:right;max-width:300px;padding:8px 12px;border-radius:var(--r);
  background:var(--posWash);border:1px solid var(--posEdge);
}
.pmk .bias.neg{background:var(--negWash);border-color:var(--negEdge)}
.pmk .bias .t{font-size:12.5px;font-weight:600;color:var(--pos)}
.pmk .bias.neg .t{color:var(--neg)}
.pmk .bias .d{font-size:var(--text-xs);color:var(--dim);margin-top:2px}

/* ── GEX LEVEL RAIL ──────────────────────────────────────────────────────────
   ONE price axis carrying every level the page cares about — put wall, gamma
   flip, CORE, spot, call wall — so their ORDER and SPACING is readable
   before any of the six cards below are read. It replaces nothing; it is the
   index to the cards.
   Two levels can print a handful of points apart, so the captions alternate
   above / below the rail in PRICE order (not by code) instead of overprinting.
   Captions are absolutely positioned with translateX(-50%) and clamped to
   4%..96%, and the outer domain carries 14% padding, so a cap can never run off
   the card. */
.pmk .gexrail{padding:15px 18px 12px;border-bottom:1px solid var(--line)}
.pmk .gexrail .rh{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.pmk .gexrail .rh h3{margin:0;font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:600}
.pmk .rail{position:relative;height:120px;margin-top:2px}
.pmk .rail .track2{position:absolute;left:0;right:0;top:54px;height:10px;border-radius:6px;background:var(--sunken);border:1px solid var(--line)}
.pmk .rail .band{position:absolute;top:-1px;bottom:-1px;border-radius:6px;background:linear-gradient(90deg,var(--negBand),var(--blueBand),var(--posBand))}
.pmk .rail .mk2{position:absolute;top:44px;width:2px;height:30px;border-radius:2px;transform:translateX(-50%)}
.pmk .rail .mk2.spot{width:3px;height:34px;top:42px;box-shadow:0 0 0 3px color-mix(in srgb, var(--color-fg) 10%, transparent)}
.pmk .rail .cap2{position:absolute;transform:translateX(-50%);text-align:center;white-space:nowrap;line-height:1.25}
.pmk .rail .cap2.up{top:4px}
.pmk .rail .cap2.dn{top:78px}
.pmk .rail .cap2 .n2{font-size:var(--text-3xs);letter-spacing:.07em;text-transform:uppercase}
.pmk .rail .cap2 .v2{font-size:14px;font-weight:660;letter-spacing:-.02em;color:var(--txt)}
.pmk .rail .cap2 .d2{font-size:9.5px;color:var(--dim)}
.pmk .rail-empty{height:120px;display:grid;place-items:center;font-size:12px;color:var(--dim)}

.pmk .levels{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.pmk .lvl{position:relative;border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);padding:10px 11px 11px;overflow:hidden}
.pmk .lvl .name{font-size:var(--text-2xs);letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);display:flex;justify-content:space-between;align-items:center;gap:6px}
.pmk .lvl .name em{font-style:normal;font-size:var(--text-3xs);padding:1px 5px;border-radius:4px;background:var(--plate);border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .lvl .px{font-size:21px;font-weight:660;letter-spacing:-.03em;margin:4px 0 1px}
.pmk .lvl .es{font-size:10.5px;color:var(--dim)}
.pmk .lvl .dist{font-size:var(--text-xs);margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px}

/* KEY LEVELS HEAD — the basis switch plus what the Δ below is measured against.
   The grid used to start straight after the rail with no header at all, which
   was fine while every tile printed one basis. It does not survive a SWITCH:
   the tiles would silently change meaning with nothing on screen naming the
   leg they are on. The head is the label, and the switch lives in it so the
   two can never drift apart. */
.pmk .lvlhead{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 18px 0}
.pmk .lvlhead .lh{display:flex;align-items:baseline;gap:10px;min-width:0}
.pmk .lvlhead h3{font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);
  margin:0;font-weight:600;white-space:nowrap}
.pmk .lvlhead .vs{font-size:var(--text-2xs);color:var(--dim2);letter-spacing:.04em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmk .lvlhead .vs b{color:var(--dim);font-weight:600}
.pmk .lvlhead .vs.warn{color:var(--amber)}

/* MIGRATION LINE — the "was" row Option B folds into each tile.
   Sits below .dist behind its own hairline so a tile with no baseline (max
   pain, or any tile before the fetch lands) simply ends where it always did
   instead of leaving a gap where a rule used to be. */
.pmk .lvl .mig{margin-top:7px;padding-top:6px;border-top:1px dashed var(--line);
  display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10.5px;color:var(--dim2)}
.pmk .lvl .mig .arw{color:var(--line3)}
.pmk .lvl .mig .now{color:var(--dim)}
/* Tag = the STATE of the move, one word. Neutral by default; only a move that
   actually means something takes a colour, so a screen of grey tags reads
   correctly as "nothing migrated overnight". */
.pmk .mtag{font-size:var(--text-3xs);letter-spacing:.06em;text-transform:uppercase;padding:1px 5px;
  border-radius:999px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .mtag.up{color:var(--pos);border-color:var(--posEdge);background:var(--posWash)}
.pmk .mtag.down{color:var(--neg);border-color:var(--negEdge);background:var(--negWash)}
.pmk .mtag.warnt{color:var(--amber);border-color:var(--amberEdge);background:var(--amberWash)}
.pmk .mtag.flipt{color:var(--violet);border-color:color-mix(in srgb, var(--color-violet) 35%, transparent);background:color-mix(in srgb, var(--color-violet) 8%, transparent)}

.pmk .pill{font-size:var(--text-2xs);padding:2px 6px;border-radius:5px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.pmk .pill.hot{border-color:var(--negEdgeUp);color:var(--neg);background:var(--negWash)}
.pmk .pill.cool{border-color:var(--posEdgeUp);color:var(--pos);background:var(--posWash)}
.pmk .pill.warn{border-color:var(--amberEdge);color:var(--amber);background:var(--amberWash)}
/* The fourth tone. PINNED (a level that held price against it) and a
   PRESIDENTIAL calendar entry both take it: neither is good news or bad
   news, which is what hot/cool/warn are for — they are the third thing,
   and violet is the hue this page already gives the third thing (the
   gamma flip, the CORE marker). Was an inline style in PostMarketTab and
   nothing at all in HistoricalRecap, which is how the Recap tab quietly
   lost the violet on every PINNED row. */
.pmk .pill.vio{border-color:color-mix(in srgb, var(--color-violet) 45%, transparent);color:var(--violet);background:color-mix(in srgb, var(--color-violet) 9%, transparent)}

.pmk .body{display:grid;grid-template-columns:1.55fr 1fr 1fr;gap:0}
/* Two equal columns. A CLASS, not an inline style: an inline
   grid-template-columns outranks the stylesheet, so the narrow-screen rule
   at the bottom of this block could never collapse it and a phone got two
   scrolling ladders side by side. */
.pmk .body.two{grid-template-columns:1fr 1fr}
.pmk .col{padding:14px 18px;border-right:1px solid var(--line);min-width:0}
.pmk .col:last-child{border-right:0}
.pmk .colhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px}
.pmk .colhead h3{font-size:var(--text-xs);letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
.pmk .seg{display:inline-flex;border:1px solid var(--line2);border-radius:var(--r2);overflow:hidden}
.pmk .seg button{background:transparent;border:0;color:var(--dim);font:inherit;font-size:10.5px;padding:3px 9px;cursor:pointer;border-right:1px solid var(--line2)}
.pmk .seg button:last-child{border-right:0}
/* Active states are CYAN across the page — the app's selection colour, the
   same one the earnings week board and the toolbars use. They were a flat
   slate fill, which is why a selected tab here did not look selected next to
   any other page. */
.pmk .seg button.on{background:var(--cyanWash);color:var(--cyan);font-weight:600}

/* SCROLLING PROFILE.
   The ladder renders ±60 strikes but only ~22 rows are ever in view, so the
   panel is the scroll container. Two consequences worth knowing:
   - .spotline / .flipline are absolutely positioned INSIDE this box, so they
     scroll with their rows, which is what makes them mean anything.
   - overscroll-behavior:contain stops a flick at the end of the ladder from
     scrolling the whole page behind it.
   - overflow-x:hidden is NOT decoration. Declaring overflow-y:auto alone makes
     the OTHER axis compute to auto too, so a bar wider than its track turned
     the ladder into a horizontally scrolling box: the over-wide bars all ran
     off the right edge and were sliced to the same length, which read as a
     dozen strikes tied at the maximum. GexProfile now clamps the width, so
     this is the belt to that braces. */
.pmk .chart{position:relative;max-height:440px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;
  scrollbar-width:thin;scrollbar-color:var(--line2) transparent;padding-right:2px}
.pmk .chart::-webkit-scrollbar{width:8px}
.pmk .chart::-webkit-scrollbar-thumb{background:var(--line2);border-radius:4px}
.pmk .chart::-webkit-scrollbar-thumb:hover{background:var(--line3)}
.pmk .chart::-webkit-scrollbar-track{background:transparent}
.pmk .recenter{position:absolute;right:10px;bottom:8px;z-index:3;font:inherit;font-size:var(--text-2xs);
  letter-spacing:.06em;text-transform:uppercase;color:var(--dim);cursor:pointer;
  background:color-mix(in srgb, var(--color-bg) 92%, transparent);border:1px solid var(--line2);border-radius:6px;padding:3px 8px}
.pmk .recenter:hover{color:var(--txt);border-color:var(--cyanEdge)}
.pmk .row{display:grid;grid-template-columns:52px 1fr;align-items:center;height:${fa}px;gap:8px}
.pmk .row .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .row.key .k{color:var(--txt);font-weight:600}
.pmk .track{position:relative;height:13px;background:linear-gradient(90deg,transparent calc(50% - .5px),var(--line2) calc(50% - .5px),var(--line2) calc(50% + .5px),transparent calc(50% + .5px))}
.pmk .bar{position:absolute;top:1px;bottom:1px;border-radius:2px}
.pmk .bar.p{left:50%;background:linear-gradient(90deg,var(--posDim),var(--pos))}
.pmk .bar.n{right:50%;background:linear-gradient(270deg,var(--negDim),var(--neg))}
.pmk .bar.dimmed{opacity:.45}
/* Strike labels. A tagged strike is usually the LARGEST bar in the window, so a
   tag hung off the end of the bar ran past the track and over the neighbouring
   column (call wall) or over the strike gutter (put wall). Wide bars carry the
   tag INSIDE, flush to the bar's end; only short bars hang it outside, where
   there is room by definition. The .inside variant also drops the dark plate
   so the tag reads on the bar's own colour.

   NOTE: no backticks anywhere in this string — it is a template literal, and a
   stray backtick in a CSS comment ends it and turns the rest into a tagged
   template call. That shipped once and blew up the page at runtime. */
.pmk .row .tag{position:absolute;top:-1px;font-size:9.5px;padding:1px 5px;border-radius:4px;white-space:nowrap;letter-spacing:.03em;background:var(--plate);max-width:calc(50% - 8px);overflow:hidden;text-overflow:ellipsis}
.pmk .row .tag.inside{background:color-mix(in srgb, var(--color-bg) 55%, transparent);border-color:transparent!important;color:var(--color-fg)!important}
.pmk .spotline,.pmk .flipline{position:absolute;left:60px;right:0;border-top:1px dashed;display:flex;justify-content:flex-end;pointer-events:none}
.pmk .spotline{border-color:color-mix(in srgb, var(--color-fg) 60%, transparent)}
.pmk .flipline{border-color:var(--amber)}
.pmk .spotline span,.pmk .flipline span{transform:translateY(-50%);font-size:9.5px;padding:1px 6px;border-radius:4px;background:var(--plate)}
.pmk .spotline span{color:var(--color-fg);border:1px solid color-mix(in srgb, var(--color-fg) 25%, transparent)}
.pmk .flipline span{color:var(--amber);border:1px solid var(--amberEdge)}
.pmk .axis{display:flex;justify-content:space-between;font-size:9.5px;color:var(--dim2);margin-top:6px;padding-left:60px}

.pmk .stat{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line);gap:10px}
.pmk .stat:last-child{border-bottom:0}
.pmk .stat .l{font-size:11.5px;color:var(--dim)}
.pmk .stat .r{font-size:12.5px;font-weight:600;white-space:nowrap}
.pmk .onrange{margin:12px 0 4px;position:relative;height:52px}
.pmk .onrange .bar2{position:absolute;left:0;right:0;top:22px;height:8px;border-radius:5px;background:var(--sunken);overflow:hidden}
.pmk .onrange .fill{position:absolute;top:0;bottom:0;background:linear-gradient(90deg,var(--blueFill1),var(--blueFill2));border-radius:5px}
.pmk .onrange .mk{position:absolute;top:12px;width:2px;height:28px;border-radius:2px}
.pmk .onrange .cap{position:absolute;font-size:9.5px;white-space:nowrap;transform:translateX(-50%)}
.pmk .onrange .cap.top{top:0}
.pmk .onrange .cap.bot{top:40px;color:var(--dim)}

/* Gap fill. The bar is the only place a PARTIAL fill is visible — the two rows
   above can only say filled or not. */
.pmk .stat.gap-filled .l{color:var(--pos)}
.pmk .gapbar{display:flex;align-items:center;gap:8px;padding:6px 0 2px}
.pmk .gapbar .t{flex:1;height:5px;border-radius:3px;background:var(--sunken);overflow:hidden}
.pmk .gapbar .t .f{height:100%;border-radius:3px;transition:width .3s}
.pmk .gapbar .lbl{font-size:var(--text-2xs);color:var(--dim2);white-space:nowrap}

.pmk .deltas .d{display:grid;grid-template-columns:54px 1fr 66px;align-items:center;gap:8px;padding:4px 0}
.pmk .deltas .d .s{font-size:var(--text-xs);color:var(--dim)}
.pmk .deltas .d .t{height:6px;background:var(--sunken);border-radius:4px;position:relative;overflow:hidden}
.pmk .deltas .d .t i{position:absolute;top:0;bottom:0;border-radius:4px}
.pmk .deltas .d .v{font-size:var(--text-xs);text-align:right}

.pmk .sect{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:4px}
.pmk .sect .s{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-radius:var(--r2);font-size:11.5px;border:1px solid var(--card);gap:8px;min-width:0}
.pmk .sect .s > span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmk .sect .s b{font-weight:600;font-size:11.5px}

.pmk .play{border:1px solid var(--card);border-radius:var(--r);background:var(--panel2);padding:11px 12px;margin-top:10px}
.pmk .play .h{font-size:var(--text-2xs);letter-spacing:.08em;text-transform:uppercase;color:var(--dim2);margin-bottom:6px}
.pmk .play p{margin:0;font-size:12.5px;line-height:1.5}
.pmk .play .k{color:var(--amber);font-weight:600}
.pmk .play .g{color:var(--pos);font-weight:600}
.pmk .play .r{color:var(--neg);font-weight:600}
.pmk .scen{display:grid;gap:6px;margin-top:9px}
.pmk .scen > div{display:grid;grid-template-columns:16px 1fr;gap:8px;font-size:11.5px;color:var(--dim)}
.pmk .scen b{color:var(--txt);font-weight:600}

/* SCOPED TO .greeks ON PURPOSE. As a bare .pmk .g this also matched the
   <span class="g"> the one-liner uses for its green highlight, which then
   inherited the tile's panel background, border and padding — that is what put
   a black box through the middle of the sentence. */
.pmk .greeks{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}
.pmk .greeks .g{border:1px solid var(--card);border-radius:var(--r2);padding:8px 9px;background:var(--panel2)}
.pmk .greeks .g .n{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .greeks .g .v{font-size:var(--text-base);font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .greeks .g .m{font-size:var(--text-2xs);color:var(--dim)}

.pmk .footbar{display:flex;justify-content:space-between;align-items:center;padding:9px 18px;border-top:1px solid var(--line);background:var(--plate);gap:10px;flex-wrap:wrap}
.pmk .footbar .l{font-size:10.5px;color:var(--dim2)}
.pmk .chips{display:flex;gap:6px;flex-wrap:wrap}
.pmk .chip{font-size:var(--text-2xs);padding:3px 8px;border-radius:6px;border:1px solid var(--line2);color:var(--dim);cursor:pointer;background:transparent;font:inherit;font-size:var(--text-2xs)}
.pmk .chip.on{background:var(--cyanWash);color:var(--cyan);border-color:var(--cyanEdge)}

@media (max-width:1180px){ .pmk .body,.pmk .body.two{grid-template-columns:1fr} .pmk .col{border-right:0;border-bottom:1px solid var(--line)}
  .pmk .levels{grid-template-columns:repeat(3,1fr)} .pmk .regime{grid-template-columns:1fr;gap:12px} .pmk .vr{display:none} .pmk .bias{justify-self:start;text-align:left;max-width:none}
  /* Five caps on a narrow rail: keep the code, drop the long name. */
  .pmk .rail .cap2 .ln{display:none} }
`,Xt=570,Bt=960,Kn="cb-premarket-eod-v1",ps="cb-premarket-tab-v1",hs="cb-premarket-sym-v1",ms="cb-premarket-date-v1",ca=Ms,qn=[.5,1,2,4,8],Zn=700,us=["SPX",...Ds.filter(t=>t!=="SPX")];function Qn(t=Date.now()){const s=new Date(t),n=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York"}).format(s),r=new Intl.DateTimeFormat("en-GB",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",hour12:!1}).format(s),[l,i]=r.split(":").map(Number);return{date:n,minutes:(l??0)*60+(i??0)}}const Jn=[];function gs(t,s){return!t.length||!(s>0)?null:t.reduce((n,r)=>Math.abs(r-s)<Math.abs(n-s)?r:n,t[0])}function er(t){const s=t.filter(l=>(l.callOI??0)>0||(l.putOI??0)>0);if(s.length<5)return null;let n=null,r=1/0;for(const l of s){const i=l.strike;let d=0;for(const p of s)i>p.strike?d+=(p.callOI??0)*(i-p.strike):i<p.strike&&(d+=(p.putOI??0)*(p.strike-i));d<r&&(r=d,n=i)}return n}const xs="cb-premarket-lvlbasis-v1",Vt={oi:{tab:"OI",long:"OI only",hint:"γ × OI × S². Both sides of the overnight Δ carry the same settled OI, so the change is pure gamma re-pricing. The honest premarket basis."},oivol:{tab:"OI+VOL",long:"OI + Vol",hint:"γ × (OI+Vol) × S² — what the profile bars and the Net GEX KPI print. Premarket the Δ drags yesterday's whole session volume in; read the levels, not the change."},vol:{tab:"VOL",long:"Vol only",hint:"γ × Volume × S². Today's trading only — near zero before 09:30, and the cleanest read on what is actually being traded once the session is running."}};function Es(t,s){return ft(t,"net",s)-ft(t,"vol",s)}function da({tag:t,tagClass:s,was:n,now:r,pct:l,note:i}){return!t&&!n&&!i?null:e.jsxs("div",{className:"mig",children:[t&&e.jsx("span",{className:`mtag ${s??""}`,children:t}),n&&e.jsxs("span",{className:"mono",children:["was ",n,r&&e.jsxs(e.Fragment,{children:[e.jsx("span",{className:"arw",children:" → "}),e.jsx("span",{className:"now",children:r})]}),l&&e.jsxs(e.Fragment,{children:[" · ",l]})]}),i&&e.jsx("span",{className:"mono",children:i})]})}function fs(t,s,n){if(!t)return null;if(t.flipped)return{text:"flipped sign",cls:"flipt"};const r=Math.abs(t.now)-Math.abs(t.was);return t.pct!=null&&Math.abs(t.pct)<2?{text:"unchanged",cls:""}:r>=0?{text:s,cls:s==="deepening"?"down":"up"}:{text:n,cls:"warnt"}}function tr(t,s,n){return s==="vol"?ft(t,"vol",n):s==="oivol"?ft(t,"net",n):Es(t,n)}function ar(t,s){if(!t)return null;const n=t.byStrikeOi,r=t.byStrikeVol;if(s==="oi")return n??(t.basis==="oi"?t.byStrike:null);if(!n||!r)return null;if(s==="vol")return r;const l={};for(const i of Object.keys(n))l[i]=(n[i]??0)+(r[i]??0);return l}function sr(){const[t,s]=o.useState(()=>Date.now());o.useEffect(()=>{const a=setInterval(()=>s(Date.now()),3e4);return()=>clearInterval(a)},[]);const{date:n,minutes:r}=Qn(t),l=r>=Bt+5,[i,d]=o.useState("pre"),p=o.useRef(!1);o.useEffect(()=>{try{const a=sessionStorage.getItem(ps);(a==="pre"||a==="post")&&(p.current=!0,d(a))}catch{}},[]),o.useEffect(()=>{p.current||d(l?"post":"pre")},[l]);const m=o.useCallback(a=>{p.current=!0,d(a);try{sessionStorage.setItem(ps,a)}catch{}},[]),[c,h]=o.useState("SPX");o.useEffect(()=>{try{const a=sessionStorage.getItem(hs);a&&us.includes(a)&&h(a)}catch{}},[]);const x=o.useCallback(a=>{h(a);try{sessionStorage.setItem(hs,a)}catch{}},[]),[f,E]=o.useState("oi");o.useEffect(()=>{try{const a=localStorage.getItem(xs);a&&a in Vt&&E(a)}catch{}},[]);const w=o.useCallback(a=>{E(a);try{localStorage.setItem(xs,a)}catch{}},[]),{dates:T,state:M}=Hn(ca),{byDate:y}=Ln(ca),k=o.useMemo(()=>{const a=Rn(n,ca);if(M!=="ok"||!T.length)return a;const u=T.filter(b=>b<n).slice(0,ca-1);return[n,...u]},[n,T,M]),[N,F]=o.useState(n);o.useEffect(()=>{try{const a=sessionStorage.getItem(ms);a&&/^\d{4}-\d{2}-\d{2}$/.test(a)&&a<=n&&F(a)}catch{}},[]),o.useEffect(()=>{M!=="loading"&&(k.includes(N)||F(n))},[k,N,n,M]);const q=o.useCallback(a=>{F(a);try{sessionStorage.setItem(ms,a)}catch{}},[]);o.useEffect(()=>{N!==n&&c!=="SPX"&&h("SPX")},[N,n,c]);const V=N!==n,de=Ls("oi-vol"),le=Fn(c,c!=="SPX"&&!V),{pre:z,post:X,state:B}=Dn(N,V),re=o.useMemo(()=>Aa(z,N),[z,N]),ee=o.useMemo(()=>Aa(X,N),[X,N]),Le=i==="post"?ee??re:re??ee,oe=V&&!!Le,[pe,$]=o.useState(!1),{byDate:C}=_n(ca),{frames:v,state:I}=Wn(N,pe,"SPX"),[G,se]=o.useState(0),[Pe,Ae]=o.useState(!1),[Qe,ot]=o.useState(1),[Tt,Pt]=o.useState(!1),xe=o.useMemo(()=>[...C.keys()].sort().reverse(),[C]),Je=o.useCallback(a=>{if(!a)return"—";const[u,b,S]=a.split("-").map(Number);return!u||!b||!S?a:new Date(u,b-1,S,12).toLocaleDateString("en-US",{weekday:"short",month:"numeric",day:"numeric"})},[]),Ve=o.useCallback(a=>{if(!xe.length)return;const u=xe.indexOf(N),b=u<0?xe[0]:xe[u-a];!b||b===N||(Ae(!1),F(b))},[xe,N]);o.useEffect(()=>{pe&&c!=="SPX"&&h("SPX")},[pe,c]),o.useEffect(()=>{se(Math.max(0,v.length-1)),Ae(!1)},[v]),o.useEffect(()=>{pe||Ae(!1)},[pe]),o.useEffect(()=>{if(!Pe||!v.length)return;const a=setInterval(()=>{se(u=>u>=v.length-1?u:u+1)},Zn/Qe);return()=>clearInterval(a)},[Pe,Qe,v.length]),o.useEffect(()=>{Pe&&v.length&&G>=v.length-1&&Ae(!1)},[Pe,G,v.length]);const Me=pe&&v.length?v[Math.min(G,v.length-1)]:null,ct=o.useMemo(()=>Aa(Me?.payload??null,N),[Me,N]),ke=pe&&!!ct,Mt=Me?.payload?.trimmedSide??0,va=o.useMemo(()=>{if(!pe||!v.length)return null;let a=1/0,u=-1/0;for(const b of v){const S=Number(b.payload?.spot);Number.isFinite(S)&&S>0&&(a=Math.min(a,S),u=Math.max(u,S))}return!Number.isFinite(a)||!Number.isFinite(u)?null:{center:(a+u)/2,halfSpan:(u-a)/2}},[pe,v]),je=ke&&ct?ct:oe&&Le?Le:c==="SPX"?de:le,{chain:he,spot:j,flip:fe,callWall:R,putWall:O,totalNetGex:Ut,esFut:bt,basis:Te,expiry:Oe,isZeroDte:We,connected:Ee,hasData:dt,updatedAt:Ft}=je,Yt="source"in je&&je.source==="live"?"live":"rest",{sessionCandles:Kt,historical:qt}=Ws(!0,8,5,!1),it=oe||ke&&V,{rows:Et}=Gn(N,it),{rows:pa}=_s(c==="SPX"?"":c,8,5),$t=o.useMemo(()=>it?Et:c!=="SPX"?pa:qt.length?[...qt,...Kt]:Kt,[it,Et,c,pa,qt,Kt]),_e=ke||oe?N:n,Ct=ke&&Me?Me.minute:oe?Bt+10:r,{events:Zt,earnByDate:Qt,now:Jt}=Gs({withQuote:!1}),[vt,ka]=o.useState({}),[ea,wa]=o.useState(null),[kt,ya]=o.useState(null),g=o.useCallback(async()=>{try{const a=["SPX","/ES","/NQ","VIX"].includes(c)?"":`,${c}`,u=await fetch(`/api/quotes-batch?symbols=SPX,/ES,/NQ,VIX${a}`,{cache:"no-store"});if(!u.ok)return;const S=(await u.json())?.data?.items??[],D={};for(const L of S)D[L.symbol]={symbol:L.symbol,last:L.last??null,change:L.change??null,pct:L["percent-change"]??null,prevClose:L["prev-close"]??null};ka(D)}catch{}},[c]),W=o.useCallback(async()=>{try{const a=await fetch("/api/scanner/market-quality",{cache:"no-store"});if(!a.ok)return;const b=(await a.json())?.data;if(!b)return;Array.isArray(b.sectorBars)&&wa(b.sectorBars),Number.isFinite(b.globalScore)&&ya({score:b.globalScore,decision:String(b.decision??"")})}catch{}},[]);o.useEffect(()=>{g(),W();const a=setInterval(g,3e4),u=setInterval(W,6e4);return()=>{clearInterval(a),clearInterval(u)}},[g,W]);const[A,ne]=o.useState(null),[ie,Ne]=o.useState("idle");o.useEffect(()=>{try{localStorage.removeItem(Kn)}catch{}},[]);const Ue=o.useRef(0),ta=o.useCallback(async(a,u,b)=>{const S=++Ue.current;Ne("loading");try{const D=await fetch(`/api/premarket-baseline?expiry=${encodeURIComponent(a)}&basis=oi&symbol=${encodeURIComponent(u)}`+(b?`&today=${encodeURIComponent(b)}`:""),{cache:"no-store"});if(S!==Ue.current)return;if(!D.ok){ne(null),Ne("empty");return}const L=await D.json();if(S!==Ue.current)return;if(!L?.ok||!L?.byStrike||L?.expiry!==a){ne(null),Ne("empty");return}ne(L),Ne("ok")}catch{if(S!==Ue.current)return;ne(null),Ne("empty")}},[]);o.useEffect(()=>{Oe&&(ne(null),ta(Oe,c,oe||ke?_e:void 0))},[Oe,c,ta,oe,ke,_e]);const ge=o.useMemo(()=>!he.length||!(j>0)?[]:he.map(a=>({strike:a.strike,net:ft(a,"net",j)})).filter(a=>Number.isFinite(a.net)).sort((a,u)=>a.strike-u.strike),[he,j]),me=o.useMemo(()=>{let a=1/0;for(let u=1;u<ge.length;u++){const b=ge[u],S=ge[u-1];if(!b||!S)continue;const D=Math.abs(b.strike-S.strike);D>0&&D<a&&(a=D)}return Number.isFinite(a)?a<.5?2:a<1?1:0:j>=1e3?0:2},[ge,j]),H=j>=1e3?0:2,et=Math.max(.01,j*15e-5),ja=Math.max(.05,j*.0015),Ge=c==="SPX"?bt:j,Na=12,be=o.useMemo(()=>{if(!ge.length)return-1;let a=0,u=ge[0];for(let b=1;b<ge.length;b++){const S=ge[b];S&&Math.abs(S.strike-j)<Math.abs(u.strike-j)&&(a=b,u=S)}return a},[ge,j]),zt=o.useCallback(a=>{if(be<0)return[];const u=Math.max(0,be-a),b=Math.min(ge.length,be+a+1);return ge.slice(u,b).slice().reverse()},[ge,be]),ha=o.useMemo(()=>zt(Na),[zt]),Ye=o.useMemo(()=>er(he),[he]),ve=o.useMemo(()=>ha.length?ha.reduce((a,u)=>Math.abs(u.net)>Math.abs(a.net)?u:a,ha[0]):null,[ha]),aa=o.useMemo(()=>{const a=new Map;if(!he.length||!(j>0))return a;for(const u of he){const b=tr(u,f,j);Number.isFinite(b)&&a.set(u.strike,b)}return a},[he,j,f]),_a=o.useMemo(()=>{const a=u=>u==null?null:aa.get(u)??null;return{call:a(R),put:a(O)}},[aa,R,O]),U=o.useMemo(()=>{const a=ar(A,f),u={available:!1,basisHasBaseline:!1,callWall:null,putWall:null,flip:null,spot:null,magnet:null};if(!A)return u;const b=D=>{if(D==null||!a)return null;const L=a[String(D)],Ce=aa.get(D);if(L==null||Ce==null||!Number.isFinite(L)||!Number.isFinite(Ce))return null;const Xe=Ce-L,ze=Math.abs(L)>1e6?Xe/Math.abs(L)*100:null;return{was:L,now:Ce,delta:Xe,pct:ze,flipped:L>=0!=Ce>=0}},S=(D,L)=>D==null||L==null||!Number.isFinite(D)||!Number.isFinite(L)?null:{was:D,now:L,move:L-D};return{available:!0,basisHasBaseline:!!a,callWall:{gex:b(R),px:S(A.callWall,R)},putWall:{gex:b(O),px:S(A.putWall,O)},flip:S(A.flip,fe),spot:S(A.spot,j>0?j:null),magnet:ve?b(ve.strike):null}},[A,f,aa,R,O,fe,j,ve]),He=o.useMemo(()=>{let a=0,u=0,b=0,S=0,D=!1;for(const L of he)a+=Xs(L,"net",j),(L.netVanna!=null||L.netVolVanna!=null)&&(D=!0,u+=(L.netVanna??0)+(L.netVolVanna??0)),b+=bs(L,"net",j),S+=vs(L,"net",j);return{dex:a,vanna:D?u:null,callGex:b,putGex:S}},[he,j]),Fe=o.useMemo(()=>{if(!he.length||!(j>0))return null;const a=he.reduce((D,L)=>Math.abs(L.strike-j)<Math.abs(D.strike-j)?L:D,he[0]),u=a.callMark??((a.bid??0)+(a.ask??0))/2,b=a.putMark??0;if(u>0&&b>0)return(u+b)*.85;const S=((a.callIV??0)+(a.putIV??0))/2;return S>0?j*S*Math.sqrt(1/252):null},[he,j]),At=o.useMemo(()=>!he.length||!(j>0)?[]:he.map(a=>({strike:a.strike,oi:Es(a,j)})).filter(a=>Number.isFinite(a.oi)),[he,j]),sa=o.useMemo(()=>{if(!A||!At.length)return null;let a=0,u=0,b=0;for(const S of At){const D=A.byStrike[String(S.strike)];D!=null&&(a+=S.oi,u+=D,b++)}return b?{live:a,base:u,n:b}:null},[A,At]),Sa=o.useMemo(()=>!A||!At.length?[]:At.map(a=>({strike:a.strike,oi:a.oi,base:A.byStrike[String(a.strike)]})).filter(a=>a.base!=null).map(a=>({strike:a.strike,delta:a.oi-a.base})).filter(a=>Number.isFinite(a.delta)&&a.delta!==0).sort((a,u)=>Math.abs(u.delta)-Math.abs(a.delta)).slice(0,4),[A,At]),_=o.useMemo(()=>{if(!$t.length)return null;const a=_e,u=te=>{const Be=te.slice(11,16),[Ie,Os]=Be.split(":").map(Number);return Ie!=null&&Number.isFinite(Ie)?Ie*60+(Os||0):-1},b=1080;let S="",D="";for(const te of $t){const Be=te.date??te.slotKey.slice(0,10);if(!Be||Be>=a)continue;const Ie=u(te.slotKey);Ie<0||(Ie>=Xt&&Ie<Bt&&Be>S&&(S=Be),Ie>=b&&Be>D&&(D=Be))}let L=-1/0,Ce=1/0,Xe=-1/0,ze=1/0,It=null,_t=-1,Se=null,qe=-1/0,De=1/0;for(const te of $t){const Be=te.date??te.slotKey.slice(0,10),Ie=u(te.slotKey);Ie<0||((Be===a&&Ie<Xt||D&&Be===D&&Ie>=b)&&(te.high>L&&(L=te.high),te.low<Ce&&(Ce=te.low)),S&&Be===S&&Ie>=Xt&&Ie<Bt&&(te.high>Xe&&(Xe=te.high),te.low<ze&&(ze=te.low),te.timestamp>_t&&(_t=te.timestamp,It=te.close)),Be===a&&Ie>=Xt&&Ie<Bt&&(Ie===Xt&&(Se=te.open),te.high>qe&&(qe=te.high),te.low<De&&(De=te.low)))}return{hi:Number.isFinite(L)?L:null,lo:Number.isFinite(Ce)?Ce:null,pdc:It,pd:Number.isFinite(Xe)&&Number.isFinite(ze)?{hi:Xe,lo:ze}:null,openPx:Se,rthHi:Number.isFinite(qe)?qe:null,rthLo:Number.isFinite(De)?De:null,pdDate:S||null}},[$t,_e]),Ga=Math.max(.01,j*4e-5),Y=o.useMemo(()=>{const a=_?.pdc;if(a==null||!(a>0))return null;const u=_?.openPx??null,b=u==null,S=u??(Ge>0?Ge:null);if(S==null)return null;const D=S-a,L=D/a*100,Ce=Math.abs(D)<Ga,Xe=D>0,ze=b||Ce?!1:Xe?_?.rthLo!=null&&_.rthLo<=a:_?.rthHi!=null&&_.rthHi>=a,It=Xe?_?.rthLo:_?.rthHi,_t=b||Ce||It==null?null:Math.max(0,Math.min(100,(S-It)/(S-a)*100)),Se=Ge>0?Ge:S,qe=ze?0:a-Se,De=_?.pd??null,te=De?S>De.hi||S<De.lo:null;return{pts:D,pct:L,projected:b,flat:Ce,up:Xe,filled:ze,retrace:_t,remaining:qe,outside:te,openPx:u,pdc:a,pd:De}},[_,Ge,Ga]),Ha=o.useMemo(()=>Zt.filter(a=>a.date===_e&&a.country==="USD"&&(a.impact==="High"||a.impact==="Medium"||a.impact==="President")).slice(0,4),[Zt,_e]),Xa=o.useMemo(()=>{const a=Qt.get(_e);return a?[...a.pre,...a.after].sort((u,b)=>(b.market_cap??0)-(u.market_cap??0)).slice(0,2):[]},[Qt,_e]),tt=(Ut??0)>=0,$e=j>0&&fe?j-fe:null,Ot=j>0&&R?R-j:null,Rt=j>0&&O?O-j:null,na=sa&&sa.base!==0?(sa.live-sa.base)/Math.abs(sa.base)*100:null,Ma=Xt-Ct,Ea=oe?"session closed":Ma>0?`RTH open in ${Math.floor(Ma/60)}h ${String(Ma%60).padStart(2,"0")}m`:Ct<Bt?"RTH open":"after the close",wt=vt["/ES"],ra=vt["/NQ"],Dt=vt.VIX,$s=vt.SPX,pt=c==="SPX"?$s:vt[c],Cs=c==="SPX"?bt:wt?.last??0,Ba=_?.hi!=null&&_?.lo!=null?_.hi-_.lo:null,Lt=a=>{if(a==null||_?.hi==null||_?.lo==null)return null;const u=_.hi-_.lo;if(!(u>0))return null;const b=u*.18;return Math.max(0,Math.min(100,(a-(_.lo-b))/(u+b*2)*100))},ht=Fe!=null&&j>0?j-Fe:null,yt=Fe!=null&&j>0?j+Fe:null,jt=a=>{if(a==null||ht==null||yt==null)return null;const u=yt-ht;if(!(u>0))return null;const b=u*.1;return Math.max(0,Math.min(100,(a-(ht-b))/(u+b*2)*100))},Wt=o.useMemo(()=>{if(ht==null||yt==null||R==null||O==null)return null;const a=Math.max(ht,Math.min(O,R)),u=Math.min(yt,Math.max(O,R));return Math.max(0,u-a)/(yt-ht)*100},[ht,yt,R,O]),Va=fe?gs(ge.map(a=>a.strike),fe):null,Is=a=>R!=null&&a===R?{text:"CALL WALL",color:"var(--cw)"}:O!=null&&a===O?{text:"PUT WALL",color:"var(--pw)"}:ve&&a===ve.strike?{text:"0DTE MAGNET",color:"var(--violet)"}:Ye!=null&&a===Ye?{text:"MAX PAIN",color:"var(--blue)"}:Va!=null&&a===Va?{text:"GAMMA FLIP",color:"var(--amber)"}:null,mt=zn(c,j,!oe&&!ke),Re=mt.ex0dte,Ua=Re?.rows??Jn,$a=mt.all?.totalNetGex!=null&&Re?.totalNetGex!=null?mt.all.totalNetGex-Re.totalNetGex:null,Ya=Re?.gexFlip!=null?gs(Ua.map(a=>a.strike),Re.gexFlip):null,Ts=a=>Re?.callWall!=null&&a===Re.callWall?{text:"CALL WALL",color:"var(--cw)"}:Re?.putWall!=null&&a===Re.putWall?{text:"PUT WALL",color:"var(--pw)"}:Ya!=null&&a===Ya?{text:"GAMMA FLIP",color:"var(--amber)"}:null,{rows:Ps,note:Fs,loading:zs}=Js(c),Ka=o.useMemo(()=>{if(!ea?.length)return[];const u=[...ea.filter(b=>Number.isFinite(b.chg5d))].sort((b,S)=>(S.chg5d??0)-(b.chg5d??0));return[...u.slice(0,3),...u.slice(-3)].filter((b,S,D)=>D.indexOf(b)===S)},[ea]),Ke=a=>a==null||Te==null?null:a+Te,oa="core"in je?je.core:null,Ca=o.useMemo(()=>oa?ge.find(u=>u.strike===oa.strike)??{strike:oa.strike,net:oa.value}:ge.length?ge.reduce((a,u)=>Math.abs(u.net)>Math.abs(a.net)?u:a,ge[0]):null,[oa,ge]),ut=o.useMemo(()=>{const a=[],u=(Se,qe,De,te)=>{De!=null&&Number.isFinite(De)&&De>0&&a.push({code:Se,name:qe,px:De,color:te})};if(u("PW","Put Wall",O,"var(--pw)"),u("FLIP","Gamma Flip",fe,"var(--amber)"),u("CORE","max γ strike",Ca?.strike,"var(--violet)"),u("SPOT","Spot",j>0?j:null,Z.text),u("CW","Call Wall",R,"var(--cw)"),a.length<2)return null;const b=Math.min(...a.map(Se=>Se.px)),S=Math.max(...a.map(Se=>Se.px)),D=S-b;if(!(D>0))return null;const L=D*.14,Ce=b-L,Xe=S+L,ze=Se=>(Se-Ce)/(Xe-Ce)*100,It=a.slice().sort((Se,qe)=>Se.px-qe.px).map((Se,qe)=>({...Se,pos:ze(Se.px),side:qe%2===0?"dn":"up",dist:j>0&&Se.code!=="SPOT"?Se.px-j:null})),_t=O!=null&&R!=null&&O>0&&R>0&&R!==O?{left:Math.min(ze(O),ze(R)),width:Math.abs(ze(R)-ze(O))}:null;return{marks:It,band:_t,lo:b,hi:S,span:D}},[O,R,fe,Ca,j]),Ia=ke?`REPLAY ${Oa(Ct)} ET`:c!=="SPX"&&!oe?Ee?"CHAIN POLL · 1m":"CHAIN POLL · retrying":Yt==="live"?Ee?"LIVE":"RECONNECTING":Yt==="rest"?"REST FALLBACK":"PAUSED",at=V&&!oe&&!ke&&B!=="loading"&&!(pe&&I==="loading"),As=i==="post"&&!ee&&re?" — the settle capture is missing for this session, so this is the pre-open one":i==="pre"&&!re&&ee?" — the pre-open capture is missing for this session, so this is the settle one":"";return e.jsxs("div",{className:"pmk",style:{flex:1,minHeight:0},children:[e.jsx("style",{dangerouslySetInnerHTML:{__html:Yn+Vs+Us+Mn+Ys}}),e.jsxs("div",{className:"wrap",children:[e.jsxs("div",{className:"pagehead",children:[e.jsx("h1",{children:at?"Session Recap":i==="post"?"Post-Market Recap":"Premarket Prep"}),e.jsx("span",{className:"dsel",children:e.jsx("select",{value:c,onChange:a=>x(a.target.value),title:ke?"Replayed sessions are SPX only":oe?"Frozen sessions are SPX only":"Which symbol to show. SPX is the live-socket board; every other MAIN name is a one-minute chain poll.","aria-label":"Symbol",children:us.map(a=>e.jsx("option",{value:a,disabled:(oe||pe)&&a!=="SPX",children:a},a))})}),e.jsx("span",{className:"badge-concept",children:at?`${c} · RECORDED · ${St(N)}`:ke?`${We?"0DTE":"FRONT"} ${Oe||"—"} · ${Ia} · ${St(N)}`:oe?`${We?"0DTE":"FRONT"} ${Oe||"—"} · FROZEN ${St(N)}`:c==="SPX"?`${We?"0DTE":"FRONT"} ${Oe||"—"} · ${Ia} · ${Ea}`:`${c} · CHAIN POLL · ${Ea}`}),e.jsx("span",{className:`dsel${V?" past":""}`,style:{marginLeft:"auto"},children:e.jsx("select",{value:N,onChange:a=>q(a.target.value),title:"Which session to show. Today is live; • marks a captured session that drives the full tabs, ▸ one that can also be replayed minute by minute.","aria-label":"Session date",children:k.map(a=>e.jsx("option",{value:a,children:a===n?`Today · ${St(a)}`:`${C.has(a)?"▸ ":y.has(a)?"• ":"  "}${St(a)}`},a))})}),e.jsx("button",{type:"button",className:`rplbtn${pe?" on":""}`,"aria-pressed":pe,disabled:!pe&&!C.has(N),title:C.has(N)?`Step ${St(N)} through its recorded frames — the whole page, minute by minute`:"No frames recorded for this session. The replay recorder captures the page every 5 minutes from 04:00 ET and cannot back-fill a day it was not running for.",onClick:()=>$(a=>!a),children:pe?"■ Exit replay":"▶ Replay"}),e.jsxs("div",{className:"tabs",children:[e.jsx("button",{className:!at&&i==="pre"?"on":"",disabled:at,title:at?"No captured chain for this session — showing the recorded recap instead":void 0,style:at?{opacity:.4,cursor:"not-allowed"}:void 0,onClick:()=>m("pre"),children:"Premarket"}),e.jsxs("button",{className:!at&&i==="post"?"on":"",disabled:at,title:at?"No captured chain for this session — showing the recorded recap instead":void 0,style:at?{opacity:.4,cursor:"not-allowed"}:void 0,onClick:()=>m("post"),children:[e.jsx("span",{className:"tdot",style:{background:oe?"var(--violet)":l?"var(--blue)":"var(--off)"}}),"Post-Market"]})]})]}),oe&&!ke&&e.jsxs("div",{className:"frozenbar",children:[e.jsxs("b",{children:["Frozen session — ",St(N),"."]})," Every number below is computed from that day's captured chain by the same code the live page runs",i==="post"?", captured at the 16:05 settle":", captured just before the 09:30 open",As,". Nothing here is live."]}),at?e.jsx(o.Suspense,{fallback:null,children:e.jsx(Vn,{date:N,symbol:c})}):i==="post"?e.jsx(o.Suspense,{fallback:null,children:e.jsx(Bn,{symbol:c,spot:j,prevClose:pt?.prevClose??null,flip:fe,callWall:R,putWall:O,totalNetGex:Ut??null,perStrike:ge,chain:he,coreBullseye:Ca,maxPain:Ye,em:Fe,totals:He,expiry:Oe||"",etDate:_e,etMin:Ct,hasData:dt,frozenDate:oe||ke&&V?N:void 0})}):e.jsxs("section",{className:`prep${tt?"":" is-neg"}`,children:[e.jsxs("div",{className:"regime",children:[e.jsxs("div",{className:"regbadge",children:[e.jsx("span",{className:`dot${dt?tt?"":" neg":" off"}`}),e.jsxs("div",{children:[e.jsx("div",{className:`lbl${tt?"":" neg"}`,children:dt?tt?"POSITIVE GAMMA":"NEGATIVE GAMMA":"WAITING FOR FEED"}),e.jsx("div",{className:"sub",children:dt?tt?"Dealers long gamma · mean-reverting tape":"Dealers short gamma · moves get amplified":"no chain frame yet"})]})]}),e.jsx("div",{className:"vr"}),e.jsxs("div",{className:"kpi",children:[e.jsx("div",{className:"k",children:"Net GEX"}),e.jsxs("div",{className:"v mono",children:[we(Ut)," ",na!=null&&e.jsxs("span",{className:na>=0?"chg-pos":"chg-neg",style:{fontSize:11},title:`OI-basis change vs the ${A?.date??"prior"} close`,children:[na>=0?"▲":"▼"," ",Math.abs(na).toFixed(0),"% ",e.jsx("small",{children:"OI"})]}),na==null&&e.jsx("small",{children:"vs prior close —"})]})]}),e.jsx("div",{className:"vr"}),e.jsxs("div",{className:"kpi",children:[e.jsx("div",{className:"k",children:"Gamma Flip"}),e.jsxs("div",{className:"v mono",children:[P(fe,H)," ",e.jsx("small",{className:$e==null?void 0:$e>=0?"chg-pos":"chg-neg",children:$e==null?"":`${lt($e)} / ${nt($e/j*100)}`})]})]}),e.jsx("div",{className:"vr"}),e.jsxs("div",{className:"kpi",children:[e.jsx("div",{className:"k",children:c==="SPX"?"SPX / ES":c}),e.jsxs("div",{className:"v mono",children:[P(j,H)," ",c==="SPX"?e.jsxs("small",{children:["· ES ",P(bt,2)]}):e.jsx("small",{className:(pt?.change??0)>=0?"chg-pos":"chg-neg",children:pt?.pct!=null?nt(pt.pct):"·"})]})]}),e.jsxs("div",{className:`bias${tt?"":" neg"}`,children:[e.jsx("div",{className:"t",children:tt?"Range day — fade the walls":"Trend day — follow the breaks"}),e.jsx("div",{className:"d",children:$e==null?"Flip unavailable — no crossing in the current chain.":`${$e>=0?"Above":"Below"} flip by ${ye(Math.abs($e),H)} pts. ${tt?`Suppression regime until ${P(fe,H)} breaks.`:`Acceleration regime until ${P(fe,H)} is reclaimed.`}`})]})]}),e.jsxs("div",{className:"gexrail",children:[e.jsxs("div",{className:"rh",children:[e.jsx("h3",{children:"GEX Levels · one axis"}),e.jsx("span",{className:"tiny",children:ut?`${P(ut.lo,me)} – ${P(ut.hi,me)} · ${ye(ut.span,H)} pts`:"waiting for the chain"})]}),ut?e.jsxs("div",{className:"rail",children:[e.jsx("div",{className:"track2",children:ut.band&&e.jsx("div",{className:"band",style:{left:`${ut.band.left}%`,width:`${ut.band.width}%`}})}),ut.marks.map(a=>e.jsxs("div",{children:[e.jsx("div",{className:`mk2${a.code==="SPOT"?" spot":""}`,style:{left:`${a.pos}%`,background:a.color}}),e.jsxs("div",{className:`cap2 ${a.side}`,style:{left:`${Math.max(4,Math.min(96,a.pos))}%`},children:[e.jsxs("div",{className:"n2",style:{color:a.color},children:[a.code,e.jsxs("span",{className:"ln",children:[" · ",a.name]})]}),e.jsx("div",{className:"v2 mono",children:P(a.px,me)}),e.jsx("div",{className:"d2 mono",children:a.code==="SPOT"?Ke(a.px)!=null?`ES ${P(Ke(a.px),0)}`:"live":lt(a.dist)})]})]},a.code))]}):e.jsx("div",{className:"rail-empty",children:"Waiting for the chain…"})]}),e.jsxs("div",{className:"lvlhead",children:[e.jsxs("div",{className:"lh",children:[e.jsx("h3",{children:"Key Levels"}),e.jsx("span",{className:`vs${U.available&&!U.basisHasBaseline?" warn":""}`,children:A?U.basisHasBaseline?e.jsxs(e.Fragment,{children:["vs ",e.jsx("b",{children:A.date})," close · ",Vt[f].long," basis"]}):`no prior-close baseline on the ${Vt[f].long} basis — levels only`:ie==="loading"||ie==="idle"?"prior-close baseline loading…":"no prior-close baseline — levels only"})]}),e.jsx("div",{className:"seg",role:"group","aria-label":"Key levels basis",children:Object.keys(Vt).map(a=>e.jsx("button",{type:"button",className:f===a?"on":"","aria-pressed":f===a,title:Vt[a].hint,onClick:()=>w(a),children:Vt[a].tab},a))})]}),e.jsxs("div",{className:"levels",children:[e.jsxs("div",{className:"lvl call",children:[e.jsxs("div",{className:"name",children:["Call Wall ",e.jsx("em",{children:"resistance"})]}),e.jsx("div",{className:"px mono",children:P(R,me)}),e.jsxs("div",{className:"es mono",children:[Ke(R)!=null?`ES ${P(Ke(R),0)} · `:"",we(_a.call,!1)]}),e.jsxs("div",{className:"dist",children:[e.jsx("span",{className:`mono ${Ot!=null&&Ot>=0?"chg-pos":"chg-neg"}`,children:lt(Ot)}),_?.hi!=null&&R!=null&&Te!=null&&_.hi>=R+Te?e.jsx("span",{className:"pill hot",children:"ON high tagged"}):e.jsx("span",{className:"pill",children:"untested o/n"})]}),(()=>{const a=U.callWall;if(!a||!a.gex&&!a.px)return null;const u=fs(a.gex,"building","eroding");return e.jsx(da,{tag:u?.text,tagClass:u?.cls,was:a.gex?we(a.gex.was,!1):null,now:a.gex?we(a.gex.now,!1):null,pct:a.gex?.pct!=null?nt(a.gex.pct,0):null,note:a.px&&Math.abs(a.px.move)>=et?`wall moved ${lt(a.px.move)} from ${P(a.px.was,me)}`:null})})()]}),e.jsxs("div",{className:"lvl magnet",children:[e.jsxs("div",{className:"name",children:["0DTE Magnet ",e.jsx("em",{children:"max γ"})]}),e.jsx("div",{className:"px mono",children:ve?P(ve.strike,me):"—"}),e.jsxs("div",{className:"es mono",children:[ve&&Ke(ve.strike)!=null?`ES ${P(Ke(ve.strike),0)} · `:"",ve?we(aa.get(ve.strike)??ve.net,!1):"—"]}),e.jsxs("div",{className:"dist",children:[e.jsx("span",{className:"mono",children:ve?lt(ve.strike-j):"—"}),e.jsx("span",{className:"pill",children:ve&&Math.abs(ve.strike-j)<=ja?"pinning":"magnet"})]}),U.magnet&&e.jsx(da,{tag:U.magnet.flipped?U.magnet.now>=0?"flipped +γ":"flipped −γ":Math.abs(U.magnet.now)>=Math.abs(U.magnet.was)?"building":"eroding",tagClass:U.magnet.flipped?"flipt":Math.abs(U.magnet.now)>=Math.abs(U.magnet.was)?"up":"warnt",was:we(U.magnet.was,!1),now:we(U.magnet.now,!1),pct:U.magnet.pct!=null?nt(U.magnet.pct,0):null})]}),e.jsxs("div",{className:"lvl spot",children:[e.jsxs("div",{className:"name",children:["Spot ",e.jsx("em",{children:"live"})]}),e.jsx("div",{className:"px mono",children:P(j,H)}),e.jsx("div",{className:"es mono",children:c==="SPX"?e.jsxs(e.Fragment,{children:["ES ",P(bt,2),wt?.pct!=null?` · ${nt(wt.pct)}`:""]}):e.jsxs(e.Fragment,{children:[pt?.change!=null?`${pt.change>=0?"+":"−"}${Math.abs(pt.change).toFixed(2)}`:"—",pt?.pct!=null?` · ${nt(pt.pct)}`:""]})}),e.jsx("div",{className:"dist",children:e.jsx("span",{className:"mono muted",children:Ea})}),U.spot&&e.jsx(da,{tag:Math.abs(U.spot.move)<et?"flat o/n":U.spot.move>0?"gap up":"gap down",tagClass:Math.abs(U.spot.move)<et?"":U.spot.move>0?"up":"down",was:P(U.spot.was,H),now:P(U.spot.now,H),pct:lt(U.spot.move)})]}),e.jsxs("div",{className:"lvl pain",children:[e.jsxs("div",{className:"name",children:["Max Pain ",e.jsx("em",{children:We?"0DTE":"front"})]}),e.jsx("div",{className:"px mono",children:P(Ye,me)}),e.jsx("div",{className:"es mono",children:Ke(Ye)!=null?`ES ${P(Ke(Ye),0)}`:"OI-weighted"}),e.jsxs("div",{className:"dist",children:[e.jsx("span",{className:`mono ${Ye!=null&&Ye-j>=0?"chg-pos":"chg-neg"}`,children:Ye!=null?lt(Ye-j):"—"}),e.jsx("span",{className:"pill",children:Ye!=null?Ye>j?"drift ↑":"drift ↓":"—"})]})]}),e.jsxs("div",{className:"lvl flip",children:[e.jsxs("div",{className:"name",children:["Gamma Flip ",e.jsx("em",{children:"regime"})]}),e.jsx("div",{className:"px mono",children:P(fe,H)}),e.jsx("div",{className:"es mono",children:Ke(fe)!=null?`ES ${P(Ke(fe),0)} · zero γ`:"zero γ"}),e.jsxs("div",{className:"dist",children:[e.jsx("span",{className:`mono ${$e!=null&&$e>=0?"chg-pos":"chg-neg"}`,children:lt($e)}),Fe!=null&&$e!=null&&Fe>0&&e.jsxs("span",{className:`pill ${Math.abs($e)/Fe<.5?"warn":""}`,children:[(Math.abs($e)/Fe).toFixed(1),"× EM away"]})]}),U.flip&&e.jsx(da,{tag:Math.abs(U.flip.move)<et?"held":U.flip.move>0?`rose ${ye(U.flip.move,H)}`:`fell ${ye(Math.abs(U.flip.move),H)}`,tagClass:Math.abs(U.flip.move)<et?"":"flipt",was:P(U.flip.was,me),now:P(U.flip.now,me)})]}),e.jsxs("div",{className:"lvl put",children:[e.jsxs("div",{className:"name",children:["Put Wall ",e.jsx("em",{children:"support"})]}),e.jsx("div",{className:"px mono",children:P(O,me)}),e.jsxs("div",{className:"es mono",children:[Ke(O)!=null?`ES ${P(Ke(O),0)} · `:"",we(_a.put,!1)]}),e.jsxs("div",{className:"dist",children:[e.jsx("span",{className:`mono ${Rt!=null&&Rt>=0?"chg-pos":"chg-neg"}`,children:lt(Rt)}),_?.lo!=null&&O!=null&&Te!=null&&_.lo<=O+Te?e.jsx("span",{className:"pill hot",children:"ON low tagged"}):e.jsx("span",{className:"pill cool",children:"untested"})]}),(()=>{const a=U.putWall;if(!a||!a.gex&&!a.px)return null;const u=fs(a.gex,"deepening","easing");return e.jsx(da,{tag:u?.text,tagClass:u?.cls,was:a.gex?we(a.gex.was,!1):null,now:a.gex?we(a.gex.now,!1):null,pct:a.gex?.pct!=null?nt(a.gex.pct,0):null,note:a.px&&Math.abs(a.px.move)>=et?`wall moved ${lt(a.px.move)} from ${P(a.px.was,me)}`:null})})()]})]}),e.jsxs("div",{className:"body two",children:[e.jsx(rs,{title:"GEX Profile by Strike",sub:`${We?"0DTE":"front"}${Oe?` ${Oe}`:""} · OI + Vol · scroll`,rows:ge,spot:j,flip:fe,kDp:me,pxDp:H,tagFor:Is,resetKey:`${c}|front`,fmtUsd:we,nf:ye,fmtPx:P,children:e.jsxs("div",{className:"greeks",children:[e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"DEX"}),e.jsx("div",{className:`v mono ${He.dex>=0?"chg-pos":"chg-neg"}`,children:we(He.dex)}),e.jsx("div",{className:"m",children:He.dex>=0?"calls leading · tilt ↑":"puts leading · tilt ↓"})]}),e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"Vanna"}),e.jsx("div",{className:`v mono ${He.vanna==null?"":He.vanna>=0?"chg-pos":"chg-neg"}`,children:we(He.vanna)}),e.jsx("div",{className:"m",children:He.vanna==null?"no per-contract vanna on this feed":He.vanna>=0?"vol down helps ↑":"vol down helps ↓"})]}),e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"Call / Put γ"}),e.jsxs("div",{className:"v mono",children:[e.jsx("span",{className:"chg-pos",children:we(He.callGex,!1)}),e.jsx("span",{style:{color:"var(--dim2)"},children:" / "}),e.jsx("span",{className:"chg-neg",children:we(Math.abs(He.putGex),!1)})]}),e.jsx("div",{className:"m",children:Math.abs(He.callGex)>=Math.abs(He.putGex)?"call side heavier":"put side heavier"})]})]})}),e.jsx(rs,{title:"GEX Profile · ex-0DTE",sub:mt.expiryCount?`all ${mt.expiryCount} expirations less 0DTE · OI + Vol · scroll`:"all expirations less 0DTE · OI + Vol",rows:Ua,spot:j,flip:Re?.gexFlip??null,kDp:me,pxDp:H,tagFor:Ts,resetKey:`${c}|ex0dte`,empty:oe||ke?"The whole-board sweep reads the live chain, so there is no version of it for a past session.":mt.state==="error"?"The whole-board sweep did not answer.":mt.state==="empty"?"Nothing but 0DTE listed on this board.":"Sweeping every expiration…",fmtUsd:we,nf:ye,fmtPx:P,children:e.jsxs("div",{className:"greeks",children:[e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"Net GEX · whole board"}),e.jsx("div",{className:`v mono ${(mt.all?.totalNetGex??0)>=0?"chg-pos":"chg-neg"}`,children:we(mt.all?.totalNetGex)}),e.jsx("div",{className:"m",children:"every listed expiration"})]}),e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"Net GEX · ex-0DTE"}),e.jsx("div",{className:`v mono ${(Re?.totalNetGex??0)>=0?"chg-pos":"chg-neg"}`,children:we(Re?.totalNetGex)}),e.jsx("div",{className:"m",children:Re?.totalNetGex==null?"no standing book yet":Re.totalNetGex>=0?"the book underneath dampens":"the book underneath amplifies"})]}),e.jsxs("div",{className:"g",children:[e.jsx("div",{className:"n",children:"Leaves at the bell"}),e.jsx("div",{className:`v mono ${$a==null?"":$a>=0?"chg-pos":"chg-neg"}`,children:we($a)}),e.jsx("div",{className:"m",children:"the front tranche's share of the net"})]})]})})]}),e.jsxs("div",{className:"body two",children:[e.jsxs("div",{className:"col",children:[e.jsxs("div",{className:"colhead",children:[e.jsx("h3",{children:"Overnight Context"}),e.jsxs("span",{className:"tiny",children:[c==="SPX"?"ES · 18:00":`${c} · ext`," → ",String(Math.floor(r/60)).padStart(2,"0"),":",String(r%60).padStart(2,"0")," ET"]})]}),e.jsx("div",{className:"onrange",children:_?.lo!=null&&_?.hi!=null?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"cap top",style:{left:"12%",color:"var(--pos)"},children:["ON low ",P(_.lo,H)]}),e.jsxs("div",{className:"cap top",style:{left:"88%",color:"var(--neg)"},children:["ON high ",P(_.hi,H)]}),e.jsx("div",{className:"bar2",children:e.jsx("div",{className:"fill",style:{left:"12%",right:"12%"}})}),e.jsx("div",{className:"mk",style:{left:"12%",background:"var(--pw)"}}),e.jsx("div",{className:"mk",style:{left:"88%",background:"var(--cw)"}}),Lt(Ge)!=null&&e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"mk",style:{left:`${Lt(Ge)}%`,background:Z.text,height:34,top:9}}),e.jsxs("div",{className:"cap bot",style:{left:`${Lt(Ge)}%`,color:Z.text},children:[c==="SPX"?"ES":c," ",P(Ge,H)]})]}),Lt(_.pdc)!=null&&e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"mk",style:{left:`${Lt(_.pdc)}%`,background:"var(--dim2)"}}),e.jsxs("div",{className:"cap bot",style:{left:`${Lt(_.pdc)}%`},children:["PDC ",P(_.pdc,H)]})]})]}):e.jsx("div",{style:{paddingTop:18,fontSize:11.5,color:"var(--dim)"},children:"No overnight bars yet."})}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"ES change"}),e.jsx("span",{className:`r mono ${(wt?.change??0)>=0?"chg-pos":"chg-neg"}`,children:wt?.change!=null?`${wt.change>=0?"+":"−"}${Math.abs(wt.change).toFixed(2)} (${nt(wt.pct)})`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"NQ change"}),e.jsx("span",{className:`r mono ${(ra?.change??0)>=0?"chg-pos":"chg-neg"}`,children:ra?.change!=null?`${ra.change>=0?"+":"−"}${Math.abs(ra.change).toFixed(2)} (${nt(ra.pct)})`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"ON range"}),e.jsx("span",{className:"r mono",children:Ba!=null?`${ye(Ba,H)} pts`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsxs("span",{className:"l",children:["Prior RTH close (",c==="SPX"?"ES":c,")",_?.pdDate&&e.jsxs(e.Fragment,{children:[" ",e.jsx("span",{className:"muted",children:St(_.pdDate)})]})]}),e.jsx("span",{className:"r mono",children:P(_?.pdc,H)})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"VIX"}),e.jsxs("span",{className:"r mono",children:[Dt?.last!=null?Dt.last.toFixed(2):"—"," ",Dt?.change!=null&&e.jsxs("span",{className:Dt.change>=0?"chg-neg":"chg-pos",children:[Dt.change>=0?"+":"−",Math.abs(Dt.change).toFixed(2)]})]})]}),e.jsxs("div",{className:`stat${Y?.filled?" gap-filled":""}`,children:[e.jsxs("span",{className:"l",children:["Gap ",Y?.projected?"(projected)":"(4pm → 9:30)"]}),e.jsx("span",{className:"r mono",children:Y?e.jsxs(e.Fragment,{children:[e.jsx("span",{className:Y.flat?"muted":Y.up?"chg-pos":"chg-neg",children:Y.flat?"flat":`${Y.up?"+":"−"}${Math.abs(Y.pts).toFixed(2)} (${nt(Y.pct)})`})," ",Y.filled?e.jsx("span",{className:"pill cool",children:"✓ FILLED"}):Y.projected?e.jsx("span",{className:"pill",children:"projected · pre-open"}):e.jsx("span",{className:`pill ${Y.outside?"warn":""}`,children:Y.outside==null?Y.up?"gap up":"gap down":Y.outside?"outside PD range":"inside PD range"})]}):"—"})]}),e.jsxs("div",{className:`stat${Y?.filled?" gap-filled":""}`,children:[e.jsx("span",{className:"l",children:"Gap fill target"}),e.jsx("span",{className:"r mono",children:!Y||Y.flat?"—":Y.filled?e.jsxs("span",{className:"chg-pos",children:["✓ filled at ",P(Y.pdc,H)]}):e.jsxs(e.Fragment,{children:[P(Y.pdc,H)," ",e.jsxs("span",{className:"muted",children:["(",ye(Math.abs(Y.remaining),H)," pts ",Y.remaining>=0?"up":"down",Y.retrace!=null?` · ${Y.retrace.toFixed(0)}% retraced`:"",")"]})]})})]}),Y&&!Y.flat&&!Y.projected&&e.jsxs("div",{className:"gapbar",children:[e.jsx("div",{className:"t",children:e.jsx("div",{className:"f",style:{width:`${Math.max(2,Math.min(100,Y.filled?100:Y.retrace??0))}%`,background:Y.filled?"var(--pos)":"var(--blue)"}})}),e.jsx("span",{className:"lbl",children:Y.filled?"gap closed":`${(Y.retrace??0).toFixed(0)}% of the gap retraced`})]}),e.jsxs("div",{className:"stat",children:[e.jsxs("span",{className:"l",children:["Prior day range (",c==="SPX"?"ES":c,")"]}),e.jsx("span",{className:"r mono",children:_?.pd?e.jsxs(e.Fragment,{children:[P(_.pd.lo,H)," – ",P(_.pd.hi,H)," ",e.jsxs("span",{className:"muted",children:["(",ye(_.pd.hi-_.pd.lo,H),")"]})]}):"—"})]}),e.jsxs("div",{className:"colhead",style:{margin:"16px 0 6px"},children:[e.jsx("h3",{children:"Biggest GEX Changes"}),e.jsx("span",{className:"tiny",children:A?`vs ${A.date} close · OI basis`:"vs prior close"})]}),Sa.length?e.jsx("div",{className:"deltas",children:Sa.map(a=>{const u=Math.max(...Sa.map(D=>Math.abs(D.delta))),b=Math.abs(a.delta)/u*50,S=a.delta>=0;return e.jsxs("div",{className:"d",children:[e.jsx("span",{className:"s mono",children:ye(a.strike,me)}),e.jsx("span",{className:"t",children:e.jsx("i",{style:S?{left:"50%",width:`${b}%`,background:"var(--pos)"}:{right:"50%",width:`${b}%`,background:"var(--neg)"}})}),e.jsx("span",{className:`v mono ${S?"chg-pos":"chg-neg"}`,children:we(a.delta)})]},a.strike)})}):e.jsx("div",{style:{fontSize:11,color:"var(--dim)"},children:ie==="loading"||ie==="idle"?"Loading the prior-close board…":ie==="empty"?`No prior-session board for ${c} ${Oe||"this expiry"} yet — server-v2/premarket-baseline.js records one at 16:05 ET each session (and its ALLOWED_SYMBOLS list gates which symbols it will sweep), so this fills in after the next close.`:"No strike moved against the prior close."}),e.jsxs("div",{className:"colhead",style:{margin:"16px 0 6px"},children:[e.jsx("h3",{children:"Sector Heat"}),e.jsx("span",{className:"tiny",children:"Market Quality · 5d %"})]}),Ka.length?e.jsx("div",{className:"sect",children:Ka.map(a=>{const u=a.chg5d??0,b=Math.min(.35,Math.abs(u)/12),S=u>=0?Z.green:Z.red;return e.jsxs("div",{className:"s",style:{borderColor:ae(S,.15+b),background:ae(S,b*.25)},children:[e.jsxs("span",{children:[a.name," ",e.jsx("span",{className:"muted",children:a.symbol})]}),e.jsx("b",{className:u>=0?"chg-pos":"chg-neg",children:nt(u)})]},a.symbol)})}):e.jsx("div",{style:{fontSize:11,color:"var(--dim)"},children:"Loading sector data…"})]}),e.jsxs("div",{className:"col",children:[e.jsxs("div",{className:"colhead",children:[e.jsx("h3",{children:"Expected Range"}),e.jsx("span",{className:"tiny",children:We?"0DTE":"front"})]}),e.jsx("div",{className:"onrange",style:{height:58},children:Fe!=null&&ht!=null&&yt!=null?e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"cap top",style:{left:"8%",color:"var(--dim)"},children:P(ht,H)}),e.jsxs("div",{className:"cap top",style:{left:"50%",color:Z.text},children:["EM ±",(Fe/j*100).toFixed(2),"% / ±",ye(Fe,H)," pts"]}),e.jsx("div",{className:"cap top",style:{left:"92%",color:"var(--dim)"},children:P(yt,H)}),e.jsx("div",{className:"bar2",style:{top:26},children:e.jsx("div",{className:"fill",style:{left:"8%",right:"8%",background:"linear-gradient(90deg,color-mix(in srgb, var(--color-violet) 25%, transparent),color-mix(in srgb, var(--color-violet) 50%, transparent),color-mix(in srgb, var(--color-violet) 25%, transparent))"}})}),jt(O)!=null&&e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"mk",style:{left:`${jt(O)}%`,background:"var(--pw)",top:18,height:24}}),e.jsx("div",{className:"cap bot",style:{left:`${jt(O)}%`,top:46,color:"var(--pw)"},children:"Put Wall"})]}),jt(R)!=null&&e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"mk",style:{left:`${jt(R)}%`,background:"var(--cw)",top:18,height:24}}),e.jsx("div",{className:"cap bot",style:{left:`${jt(R)}%`,top:46,color:"var(--cw)"},children:"Call Wall"})]}),jt(j)!=null&&e.jsx("div",{className:"mk",style:{left:`${jt(j)}%`,background:Z.text,top:14,height:32}})]}):e.jsx("div",{style:{paddingTop:18,fontSize:11.5,color:"var(--dim)"},children:"No ATM straddle yet — expected move unavailable."})}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"IV-implied move"}),e.jsx("span",{className:"r mono",children:Fe!=null?`±${ye(Fe,H)} pts (${(Fe/j*100).toFixed(2)}%)`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"GEX-implied range"}),e.jsx("span",{className:"r mono",children:O!=null&&R!=null?`${P(O,me)} – ${P(R,me)} (${ye(Math.abs(R-O),H)})`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"Overlap / conviction"}),e.jsx("span",{className:"r mono",children:Wt==null?"—":e.jsxs("span",{className:Wt>=60?"chg-pos":Wt>=35?"":"chg-neg",children:[Wt>=60?"HIGH":Wt>=35?"MEDIUM":"LOW"," ",e.jsxs("span",{className:"muted",children:[Wt.toFixed(0),"%"]})]})})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"Overnight range"}),e.jsx("span",{className:"r mono",children:_?.lo!=null&&_?.hi!=null?`${P(_.lo,H)} – ${P(_.hi,H)}`:"—"})]}),e.jsxs("div",{className:"stat",children:[e.jsx("span",{className:"l",children:"Market quality"}),e.jsx("span",{className:"r mono",children:kt?e.jsxs("span",{className:kt.score>=60?"chg-pos":kt.score>=40?"":"chg-neg",children:[Math.round(kt.score)," / 100 ",e.jsx("span",{className:"muted",children:kt.decision})]}):"—"})]}),e.jsxs("div",{className:"play",children:[e.jsx("div",{className:"h",children:"Today's one-liner"}),e.jsx("p",{children:dt?e.jsxs(e.Fragment,{children:[tt?"Positive gamma":"Negative gamma",", flip"," ",e.jsx("span",{className:"k",children:$e==null?"n/a":`${ye(Math.abs($e),H)} pts ${$e>=0?"below":"above"}`}),", Call Wall ",e.jsx("span",{className:"r",children:Ot==null?"n/a":`${ye(Math.abs(Ot),H)} ${Ot>=0?"above":"below"}`}),","," ","Put Wall ",e.jsx("span",{className:"g",children:Rt==null?"n/a":`${ye(Math.abs(Rt),H)} ${Rt>=0?"above":"below"}`})," —"," ",e.jsx("b",{children:tt?`fade extremes, scalp toward the ${ve?ye(ve.strike,me):"magnet"} magnet.`:"stand aside at the edges, trade continuation through the walls."})]}):"Waiting for the first chain frame."}),e.jsxs("div",{className:"scen",children:[e.jsxs("div",{children:[e.jsx("span",{className:"g",children:"▲"}),e.jsxs("span",{children:[e.jsxs("b",{children:["Above ",P(R,me)]})," — call wall break. Chase only with DEX confirming; gamma thins out above."]})]}),e.jsxs("div",{children:[e.jsx("span",{className:"k",children:"◆"}),e.jsxs("span",{children:[e.jsxs("b",{children:[P(O,me),"–",P(R,me)]})," — base case. ",tt?`Fade the edges, target ${ve?ye(ve.strike,me):"the magnet"}.`:"Two-sided and fast; size down."]})]}),e.jsxs("div",{children:[e.jsx("span",{className:"r",children:"▼"}),e.jsxs("span",{children:[e.jsxs("b",{children:["Below ",P(fe,H)]})," — flip breached, regime turns negative. Stop fading; trend short toward ",P(O,me),"."]})]})]})]}),e.jsxs("div",{className:"colhead",style:{margin:"16px 0 6px"},children:[e.jsx("h3",{children:"Catalysts"}),e.jsx("span",{className:"tiny",children:"today"})]}),Ha.length===0&&Xa.length===0&&e.jsx("div",{style:{fontSize:11,color:"var(--dim)"},children:"Nothing scheduled on the US calendar today."}),Ha.map((a,u)=>e.jsxs("div",{className:"stat",style:{opacity:Hs(a,Jt)?.5:1},children:[e.jsxs("span",{className:"l",children:[e.jsx("span",{className:`pill ${a.impact==="High"?"hot":a.impact==="Medium"?"warn":a.impact==="President"?"vio":""}`,children:a.time_formatted||a.time})," ",a.title]}),e.jsx("span",{className:"r mono muted",children:a.actual?`act ${a.actual}`:a.forecast?`exp ${a.forecast}`:"—"})]},`${a.time}-${a.title}-${u}`)),Xa.map(a=>e.jsxs("div",{className:"stat",children:[e.jsxs("span",{className:"l",children:[e.jsx("span",{className:"pill",children:a.session==="pre"?"PRE":"AMC"})," ",a.symbol," earnings"]}),e.jsx("span",{className:"r mono muted",children:a.eps_est?`EPS ${a.eps_est}`:"—"})]},a.symbol))]})]}),e.jsx(En,{chain:he,spot:j,expiry:Oe,isZeroDte:We,flip:fe,callWall:R,putWall:O,frozen:oe||ke,axisAnchor:va}),e.jsx("div",{className:"body",children:e.jsx("div",{className:"col",style:{gridColumn:"1 / -1",borderRight:0},children:e.jsx(en,{symbol:c,rows:Ps,note:Fs,loading:zs,style:{padding:0,borderTop:"none"}})})}),!oe&&!ke&&e.jsx(o.Suspense,{fallback:null,children:e.jsx(Un,{})}),e.jsxs("div",{className:"footbar",children:[e.jsxs("span",{className:"l mono",children:[_e," · ",c," · ",Ia," · spot ",P(j,2)," · ES ",P(Cs,2),Te!=null?` · basis ${Te>=0?"+":"−"}${Math.abs(Te).toFixed(2)}`:""," · ",he.length," strikes",Ft?` · ${new Date(Ft).toLocaleTimeString("en-US",{timeZone:"America/New_York",hour12:!1})} ET`:""]}),e.jsxs("div",{className:"chips",children:[e.jsxs("span",{className:"chip on",children:[We?"0DTE":"FRONT"," ",Oe||""]}),A?e.jsxs("span",{className:"chip",children:["baseline ",A.date," · ",A.strikes," strikes · OI"]}):e.jsx("span",{className:"chip",children:ie==="empty"?"no baseline":"baseline loading…"})]})]})]})]}),pe&&e.jsx("div",{className:"rplbar",children:e.jsxs("div",{className:"rplwrap",children:[e.jsxs("div",{className:"rplrow",children:[e.jsx("span",{className:"rpltag",children:"Replay"}),e.jsxs("div",{className:"rplgrp",children:[e.jsx(Gt,{onClick:()=>Ve(-1),title:"Previous recorded session",children:e.jsx("span",{children:"◀"})}),e.jsx("span",{className:"rpldate",children:Je(N)}),e.jsx(Gt,{onClick:()=>Ve(1),title:"Next recorded session",children:e.jsx("span",{children:"▶"})})]}),v.length?e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"rplgrp",children:[e.jsx(Gt,{onClick:()=>{Ae(!1),se(a=>Math.max(0,a-1))},title:"Step back one frame",children:e.jsx("span",{children:"⏮"})}),e.jsx(Gt,{onClick:()=>{G>=v.length-1&&se(0),Ae(a=>!a)},title:Pe?"Pause":"Play",children:e.jsx("span",{style:{minWidth:12,display:"inline-block",textAlign:"center"},children:Pe?"⏸":"▶"})}),e.jsx(Gt,{onClick:()=>{Ae(!1),se(a=>Math.min(v.length-1,a+1))},title:"Step forward one frame",children:e.jsx("span",{children:"⏭"})})]}),e.jsx(an,{label:"min",value:Math.min(G,v.length-1),min:0,max:Math.max(0,v.length-1),step:1,width:"auto",title:"Scrub through the session",format:a=>Oa(v[Math.min(Math.round(a),v.length-1)]?.minute??0),onChange:a=>{Ae(!1),se(Math.round(a))}}),e.jsxs("span",{className:"rplclock",children:[Me?Oa(Me.minute):"—:—"," ",e.jsx("small",{children:"ET"}),v.length?e.jsxs("small",{children:[" · ",Math.min(G,v.length-1)+1,"/",v.length]}):null,Me?e.jsxs("small",{children:[" · spot ",P(Me.payload.spot,2)]}):null]}),e.jsxs("div",{className:"rplgrp",children:[e.jsx("span",{className:"rplsp",children:"Speed"}),e.jsx(tn,{options:qn.map(a=>({label:`${a}×`,value:String(a)})),active:String(Qe),onChange:a=>ot(Number(a))})]}),e.jsx(Gt,{onClick:()=>$(!1),title:"Exit replay — back to the live page",style:{color:J.cyan},children:e.jsx("span",{children:"● Live"})})]}):e.jsx("span",{className:"rplmsg",children:I==="loading"?"Loading this session’s frames…":I==="error"?"Could not load this session’s frames.":"No frames recorded for this session — step ◀ / ▶ to another."}),e.jsx("button",{type:"button",className:`rplt info${Tt?" on":""}`,style:{marginLeft:"auto"},"aria-expanded":Tt,title:Tt?"Hide what this replay covers":"What this replay covers",onClick:()=>Pt(a=>!a),children:"ⓘ"}),e.jsx("button",{type:"button",className:"rplx",title:"Close replay — back to live","aria-label":"Close replay",onClick:()=>$(!1),children:"✕"})]}),Tt&&e.jsx("div",{className:"rplrow rplnote",children:e.jsx("p",{className:"note",style:{margin:0},children:I==="loading"?e.jsx(e.Fragment,{children:"Loading this session's frames…"}):I==="error"?e.jsx(e.Fragment,{children:"Could not load this session's frames."}):v.length?e.jsxs(e.Fragment,{children:[e.jsx("b",{children:"The page IS the replay."})," Every level, tile and panel above is recomputed from that minute's own captured chain by the same code the live page runs, and the page's clock is rewound with it — both tabs, so the Post-Market side rebuilds the book frame by frame too. Nothing driven by the chain is live. (The GEX-watch strip in the last row is not date-scoped and still shows the latest recorded close.)",Mt>0&&e.jsxs(e.Fragment,{children:[" ","Frames keep ",e.jsxs("b",{children:["±",Mt," strikes"]})," around spot, so the walls, gamma flip and total net GEX are that minute's full-board values, while anything scanned off the chain here — max pain, the DEX and vanna totals, the profile's and bell curve's wings — is over that window."]})]}):e.jsx(e.Fragment,{children:"No frames recorded for this session. The recorder captures the page every 5 minutes from 04:00 ET and cannot back-fill a day it was not running for."})})})]})})]})}const kr=Object.freeze(Object.defineProperty({__proto__:null,default:sr},Symbol.toStringTag,{value:"Module"}));export{Ys as C,Bs as E,Us as H,br as L,pr as N,Vs as P,js as R,gr as a,vr as b,Ns as c,lt as d,ys as e,P as f,Oa as g,nt as h,we as i,cr as j,An as k,xr as l,fr as m,ye as n,Hn as o,dr as p,hr as q,mr as r,St as s,kr as t,ur as u};
