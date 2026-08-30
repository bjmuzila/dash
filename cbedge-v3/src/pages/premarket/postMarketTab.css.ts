// ─────────────────────────────────────────────────────────────────────────────
// The post-market tab's stylesheet, in its own module.
//
// Split out of PostMarketTab.tsx so that component can be lazy(). The component is the
// heavy half; this is a few KB of selectors the page needs on the FIRST paint,
// because every premarket stylesheet is concatenated into the single <style>
// block at the top of Premarket.tsx and the cascade depends on them all
// arriving together.
//
// Importing the constant from the component would have dragged the component
// into the entry chunk with it — exactly the import edge lazy() exists to cut.
// PostMarketTab.tsx re-exports the name, so nothing that imported it from there
// had to change.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row pitch of section 3's build-time ladder, in px.
 *
 * Interpolated into the stylesheet below AND used by centerEv's scroll maths,
 * so the two cannot drift. They were a literal 21 in each place, and the
 * centring is off by (rows x delta) the moment one of them moves — a one-pixel
 * edit to the CSS would have parked the close a row and a half off centre at
 * the bottom of a 121-row ladder with nothing on screen explaining why.
 */
export const EV_ROW_H = 21;

export const POSTMARKET_CSS = `
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
.pmk .sechead h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);margin:0;font-weight:600}
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
.pmk .sc .src{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim2);margin-top:6px}
.pmk .sc .nm{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--dim2);
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
  align-items:center;height:${EV_ROW_H}px;gap:7px}
.pmk .evrow .sgn{font-size:11px;font-weight:800;text-align:center;line-height:1}
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
.pmk .evrow .tagcol{font-size:9px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap}
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
.pmk .mrow .mk3{font-size:10px;text-align:center;color:var(--dim)}

/* Positioned vs written — one stacked bar per strike, OI then volume. */
.pmk .srow{display:grid;grid-template-columns:54px 1fr 128px;align-items:center;height:22px;gap:9px}
.pmk .srow .k{font-size:10.5px;text-align:right;color:var(--dim)}
.pmk .srow .v{font-size:10.5px;text-align:right;white-space:nowrap}
.pmk .stack{display:flex;height:13px;border-radius:3px;overflow:hidden;background:var(--sunken)}
.pmk .stack i{display:block;height:100%}

.pmk .heat{display:grid;gap:2px;margin-top:6px}
.pmk .heat i{height:22px;border-radius:3px;background:var(--sunken)}
.pmk .heatx{display:flex;justify-content:space-between;font-size:9px;color:var(--dim2);margin-top:4px}

/* 4/5/6 */
.pmk .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pmk .tile{position:relative;border:1px solid var(--card);border-radius:9px;background:var(--panel2);
  padding:9px 10px;overflow:hidden}
.pmk .tile .n2{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim2)}
.pmk .tile .v2{font-size:16px;font-weight:640;margin-top:2px;letter-spacing:-.02em}
.pmk .tile .m2{font-size:10px;color:var(--dim)}
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
.pmk .premrow .pl{font-size:11px;color:var(--txt);font-weight:600}
.pmk .premrow .ptrack{height:9px;border-radius:5px;background:var(--sunken);overflow:hidden}
.pmk .premrow .ptrack i{display:block;height:100%;border-radius:5px}
.pmk .premrow .pu{font-size:10.5px;text-align:right;font-weight:640;white-space:nowrap}

@media (max-width:1180px){
  .pmk .snap{grid-template-columns:1fr}
  .pmk .scorecard{grid-template-columns:repeat(2,1fr)}
  .pmk .tiles{grid-template-columns:repeat(2,1fr)}
}
`;
