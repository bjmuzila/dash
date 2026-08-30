/**
 * GAMMA BOOK CHURN — sits under GEX Watch on /premarket.
 *
 * GEX Watch answers "which STRIKE grew far more than normal". This answers the
 * question that one immediately raises: was that strike an outlier inside a
 * quiet book, or did the whole book rewrite itself overnight? On 2026-08-27
 * CRWD's 230 strike read 8.3× normal — and this card would have said its entire
 * ladder churned 153%, which is the context that changes what the strike means.
 *
 * ── ONE READ, NO SCAN ───────────────────────────────────────────────────────
 * /api/gex-gross-feed serves the gex_gross_daily rollup gex-gross-recorder.js
 * wrote at 16:50 ET. The engine behind it is a full-ladder window scan across
 * ~169 symbols; running that per page load would be indefensible on a
 * subscriber page, and reading yesterday's close is exactly right for a
 * premarket surface anyway.
 *
 * ── WHY GROSS, NOT NET ──────────────────────────────────────────────────────
 * net_gex is a signed sum, so summing it across a ladder cancels: $500M of call
 * gamma added and $500M of put gamma added nets to nothing and reads as a quiet
 * day. Every number here takes its absolute value at the LEG first —
 * |call_gex| + |put_gex| — so nothing can hide behind an offsetting build.
 *
 * ── THE BAR SAYS TWO THINGS ─────────────────────────────────────────────────
 * FILL is how much of the book changed (× a normal day FOR THAT TICKER — SPY
 * carries a $92B book and WEN $3.7M, so a roster-wide percentage would just
 * rank by size). COLOR is whether that gamma was added, rotated in place, or
 * pulled off. Churn alone cannot tell a giant roll from a giant build.
 *
 * The encoding — fill math and color ramp — is imported from
 * components/shared/GexHeatBar, NOT re-derived, so this card and the Level Log
 * strip cannot drift on what a bar means.
 *
 * ── OPEX AND EARNINGS ARE LABELLED, NOT HIDDEN ──────────────────────────────
 * Unlike GEX Watch, which drops opex rows entirely, this card keeps them and
 * badges them. The reason for the difference: a watch row claims a strike is
 * worth acting on, and the calendar is not a signal. A churn row only claims
 * the book changed, which on opex is TRUE and worth knowing — it just must not
 * set the scale, and server-side it never does (`clean = false`).
 *
 * Fails quiet: an empty rollup, a stalled recorder and a missing table all
 * render as one calm line rather than an error.
 */

import { useEffect, useState } from "react";
import { buildShareColor, heatFill, type GexGrossRow } from "@/pages/premarket/GexHeatBar";

export const GEX_CHURN_CSS = `
.gcf{margin-top:16px}
.gcf .gcf-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:9px}
.gcf .gcf-t{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--txt)}
.gcf .gcf-as{font-size:var(--text-xs);color:var(--muted);font-variant-numeric:tabular-nums}
.gcf .gcf-note{font-size:11.5px;color:var(--muted);line-height:1.55;margin:0 0 10px;max-width:78ch}
.gcf .gcf-rows{display:flex;flex-direction:column;gap:3px}
.gcf .gcf-row{display:grid;grid-template-columns:3px 1fr;border-radius:6px;overflow:hidden;
  background:color-mix(in srgb, var(--color-fg) 3%, transparent)}
.gcf .gcf-sev{background:var(--gc-edge)}
.gcf .gcf-in{padding:9px 12px;display:flex;flex-direction:column;gap:5px}
.gcf .gcf-l1{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.gcf .gcf-sym{font-size:13.5px;font-weight:800;letter-spacing:.01em;color:var(--txt)}
.gcf .gcf-k{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.gcf .gcf-what{font-size:12px;color:var(--gc-edge);font-weight:700}
.gcf .gcf-tag{font-size:9.5px;font-weight:800;letter-spacing:.09em;padding:1px 5px;border-radius:4px;
  color:var(--muted);border:1px solid color-mix(in srgb, var(--color-fg) 16%, transparent)}
.gcf .gcf-l2{display:flex;gap:9px;align-items:center;flex-wrap:wrap;font-size:var(--text-xs);color:var(--muted);
  font-variant-numeric:tabular-nums}
.gcf .gcf-bar{flex:0 1 150px;height:6px;border-radius:4px;background:color-mix(in srgb, var(--color-fg) 7%, transparent);overflow:hidden}
.gcf .gcf-bar.prov{background-image:repeating-linear-gradient(135deg,color-mix(in srgb, var(--color-fg) 5%, transparent) 0 4px,transparent 4px 8px)}
.gcf .gcf-bar i{display:block;height:100%;border-radius:4px;background:var(--gc-edge)}
.gcf .gcf-x{font-weight:800;color:var(--gc-edge)}
.gcf .gcf-legend{display:flex;align-items:center;gap:9px;font-size:var(--text-2xs);color:var(--muted);margin-top:9px}
.gcf .gcf-ramp{flex:0 1 120px;height:4px;border-radius:4px}
.gcf .gcf-empty{font-size:12px;color:var(--muted);padding:12px 0;line-height:1.6}
`;

export default function GexChurnFeed({ limit = 8 }: { limit?: number }) {
  const [rows, setRows] = useState<GexGrossRow[]>([]);
  const [note, setNote] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [state, setState] = useState<"load" | "done">("load");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/gex-gross-feed?limit=${limit}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setNote(typeof j.note === "string" ? j.note : "");
        setAsOf(j.asOf ?? null);
      } catch {
        if (alive) { setRows([]); setNote("Feed unavailable right now."); }
      } finally {
        if (alive) setState("done");
      }
    })();
    return () => { alive = false; };
  }, [limit]);

  if (state === "load") {
    return (
      <div className="gcf">
        <div className="gcf-head"><span className="gcf-t">Gamma Book Churn</span></div>
        <div className="gcf-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="gcf">
      <div className="gcf-head">
        <span className="gcf-t">Gamma Book Churn</span>
        {asOf && <span className="gcf-as">at the {asOf} close</span>}
      </div>
      {note && <p className="gcf-note">{note}</p>}

      {rows.length === 0 ? (
        <div className="gcf-empty">Nothing on file for the last session.</div>
      ) : (
        <>
          <div className="gcf-rows">
            {rows.map((r) => {
              const { frac, provisional } = heatFill(r);
              const edge = buildShareColor(r.buildShare);
              const tag = r.isOpex ? "OPEX" : r.isEarnings ? "EARNINGS" : null;
              return (
                <div
                  className="gcf-row"
                  key={r.symbol}
                  style={{ ["--gc-edge" as string]: edge }}
                >
                  <div className="gcf-sev" />
                  <div className="gcf-in">
                    <div className="gcf-l1">
                      <span className="gcf-sym">{r.symbol}</span>
                      <span className="gcf-k">{Math.round(r.churnPct)}% of its gamma book changed</span>
                      <span className="gcf-what">{r.what}</span>
                      {tag && <span className="gcf-tag">{tag}</span>}
                    </div>
                    <div className="gcf-l2">
                      {/* The readout is ×normal once the ticker has a baseline
                          and the raw percentage before that — never a ratio
                          quoted against an average of three sessions. */}
                      <span className="gcf-x">
                        {provisional ? `${Math.round(r.churnPct)}%` : `${(r.heat as number).toFixed(1)}×`}
                      </span>
                      <span className={provisional ? "gcf-bar prov" : "gcf-bar"}>
                        <i style={{ width: `${Math.max(3, frac * 100)}%` }} />
                      </span>
                      <span>
                        {provisional
                          ? `no baseline yet — needs a few more clean sessions`
                          : `a normal day for ${r.symbol}`}
                      </span>
                      {r.grossM != null && <span>· ${r.grossM.toLocaleString()}M on the board</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* A diverging scale nobody can read is just a colourful bar. */}
          <div className="gcf-legend">
            <span>pulled off</span>
            <span
              className="gcf-ramp"
              style={{
                background: `linear-gradient(90deg, ${buildShareColor(-1)}, ${buildShareColor(0)}, ${buildShareColor(1)})`,
              }}
            />
            <span>added</span>
          </div>
        </>
      )}
    </div>
  );
}
