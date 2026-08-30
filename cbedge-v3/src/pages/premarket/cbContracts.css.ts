// ─────────────────────────────────────────────────────────────────────────────
// The CB contracts panel's stylesheet, in its own module.
//
// Split out of CbContracts.tsx so that component can be lazy(). The component is the
// heavy half; this is a few KB of selectors the page needs on the FIRST paint,
// because every premarket stylesheet is concatenated into the single <style>
// block at the top of Premarket.tsx and the cascade depends on them all
// arriving together.
//
// Importing the constant from the component would have dragged the component
// into the entry chunk with it — exactly the import edge lazy() exists to cut.
// CbContracts.tsx re-exports the name, so nothing that imported it from there
// had to change.
// ─────────────────────────────────────────────────────────────────────────────

export const CB_CONTRACTS_CSS = `
.pmk .cbc{padding:14px 18px;border-top:1px solid var(--line)}
.pmk .cbchead{display:flex;align-items:baseline;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.pmk .cbchead h3{margin:0;font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);font-weight:600}
.pmk .cbchead .tiny{text-transform:none;letter-spacing:0;font-size:11px}
/* Amber, the page's "check this" colour: the table is real, it is just not
   today's. It disappears the moment today has a row. */
.pmk .cbchead .cbclast{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--amber);border:1px solid var(--amberEdge);background:var(--amberWash);
  border-radius:999px;padding:2px 8px;white-space:nowrap}

.pmk .cbcnote{font-size:11.5px;color:var(--dim2);padding:10px 0}
.pmk .cbcnote.bad{color:var(--neg)}

.pmk .cbcwrap{border:1px solid var(--card);border-radius:var(--r);overflow:hidden;background:var(--sunken)}
.pmk .cbctbl{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.pmk .cbctbl th{padding:9px 13px;font-size:10px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;
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
.pmk .cbcmhead .sym{font-size:15px;font-weight:700;color:var(--cyan)}
.pmk .cbcmhead .sub{font-size:11px;color:var(--dim2)}
.pmk .cbcmhead .x{margin-left:auto;font:inherit;font-size:15px;font-weight:700;line-height:1;cursor:pointer;
  background:transparent;border:1px solid var(--line2);color:var(--dim);border-radius:7px;padding:4px 11px}
.pmk .cbcmhead .x:hover{background:var(--active)}

.pmk .cbcbig .hl{font-size:24px;font-weight:800;line-height:1;color:var(--txt)}
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
.pmk .cbctgl{font:inherit;font-size:11px;font-weight:600;padding:5px 12px;border-radius:7px;cursor:pointer;
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
`;
