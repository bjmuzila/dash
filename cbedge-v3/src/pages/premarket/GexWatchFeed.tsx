/**
 * GEX WATCH — the bottom box on /premarket.
 *
 * "Which strikes grew far more than normal at yesterday's close, and did that
 * usually matter?" One read, plain language, no jargon on the face.
 *
 * ── WHY IT READS A LOG, NOT A LIVE SCAN ─────────────────────────────────────
 * /api/gex-watch-feed serves rows gex-watch-recorder.js already wrote at 16:40
 * ET. The calibration sweep behind the owner panel is a 169-ticker
 * window-function scan; running it per page load would be indefensible on a
 * subscriber page. This is one indexed read, and reading yesterday's close is
 * exactly right for a premarket surface anyway.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SHOW ──────────────────────────────────────
 * No ×normal z-score arithmetic, no lift, no calibration table, and no OPEX
 * rows at all. On the third Friday the expiring tranche leaves the chain and
 * every strike carrying it collapses — those are the biggest numbers in the
 * table and none of them are repositioning. The owner panel flags them; a
 * customer should never be shown the calendar and told it is a signal. The
 * filter lives server-side in _lib-gex-watch.cjs so both surfaces agree.
 *
 * Track record is FORWARD-TESTED — "N of the last M like this moved" counts
 * graded rows from the log, and is withheld entirely below 20 outcomes.
 *
 * Fails quiet by design: an empty feed on a quiet day, a stalled recorder and a
 * missing table all render as one calm line rather than an error.
 */

import { useEffect, useState } from "react";
import { T, LIGHT_BLUE } from "@/design/theme";

type Row = {
  date: string; symbol: string; strike: number;
  headline: string; side: string | null; isCall: boolean; flip: boolean;
  zx: number; times: string; vsSpot: string | null; above: boolean | null;
  track: { graded: number; hits: number; pct: number } | null;
  stale: number; line: string;
};

export const GEX_WATCH_CSS = `
.gwf{margin-top:14px}
.gwf .gwf-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:9px}
.gwf .gwf-t{font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--txt)}
.gwf .gwf-as{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
.gwf .gwf-note{font-size:11.5px;color:var(--muted);line-height:1.55;margin:0 0 10px;max-width:78ch}
.gwf .gwf-rows{display:flex;flex-direction:column;gap:3px}
.gwf .gwf-row{display:grid;grid-template-columns:3px 1fr;border-radius:6px;overflow:hidden;
  background:color-mix(in srgb, var(--color-fg) 3%, transparent)}
.gwf .gwf-sev{background:var(--gw-edge)}
.gwf .gwf-in{padding:9px 12px;display:flex;flex-direction:column;gap:4px}
.gwf .gwf-l1{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.gwf .gwf-sym{font-size:13.5px;font-weight:800;letter-spacing:.01em;color:var(--txt)}
.gwf .gwf-k{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.gwf .gwf-vs{font-size:11px;font-variant-numeric:tabular-nums;color:var(--gw-edge);font-weight:700}
.gwf .gwf-flip{font-size:9.5px;font-weight:800;letter-spacing:.09em;padding:1px 5px;border-radius:4px;
  color:var(--gw-flip);border:1px solid var(--gw-flip)}
.gwf .gwf-l2{font-size:12.5px;color:var(--txt);line-height:1.5}
.gwf .gwf-l3{display:flex;gap:9px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted);
  font-variant-numeric:tabular-nums}
.gwf .gwf-bar{flex:0 1 130px;height:4px;border-radius:3px;background:color-mix(in srgb, var(--color-fg) 7%, transparent);overflow:hidden}
.gwf .gwf-bar i{display:block;height:100%;border-radius:3px;background:var(--gw-edge)}
.gwf .gwf-x{font-weight:800;color:var(--gw-edge)}
.gwf .gwf-empty{font-size:12px;color:var(--muted);padding:12px 0;line-height:1.6}
`;

/* The two colours that ENCODE. Call is the app's own cyan; the clay was picked
   to pair with it and the two separate at ΔE 17.8 under deuteranopia, where a
   blue/red pair collapses. Move them together or not at all. */
const CALL = T.cyan;
const PUT = "var(--color-clay)";
const FLIP = LIGHT_BLUE;

export default function GexWatchFeed({ limit = 8 }: { limit?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  /**
   * The server's prose blurb. Kept as state and NOT rendered any more — the
   * card sits in a two-column row now and four lines of standing explanation
   * under the title pushed the rows off the fold every session, whether or not
   * there was anything to explain. The rows already say what they mean in
   * plain language; that was the point of the format. It is still read so the
   * failure path below can put a real reason on screen.
   */
  const [note, setNote] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [state, setState] = useState<"load" | "done">("load");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/gex-watch-feed?limit=${limit}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        setRows(Array.isArray(j.rows) ? j.rows : []);
        setNote(typeof j.note === "string" ? j.note : "");
        setAsOf(j.asOf ?? null);
      } catch {
        if (alive) { setRows([]); setNote("Feed unavailable right now."); setFailed(true); }
      } finally {
        if (alive) setState("done");
      }
    })();
    return () => { alive = false; };
  }, [limit]);

  if (state === "load") {
    return (
      <div className="gwf">
        <div className="gwf-head"><span className="gwf-t">GEX Watch</span></div>
        <div className="gwf-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="gwf">
      <div className="gwf-head">
        <span className="gwf-t">GEX Watch</span>
        {asOf && <span className="gwf-as">at the {asOf} close</span>}
      </div>
      {rows.length === 0 ? (
        <div className="gwf-empty">{failed && note ? note : "Nothing unusual to flag."}</div>
      ) : (
        <div className="gwf-rows">
          {rows.map((r, i) => {
            const edge = r.isCall ? CALL : PUT;
            const w = Math.max(4, Math.min(100, (r.zx / 8) * 100));
            return (
              <div
                className="gwf-row"
                key={`${r.symbol}-${r.strike}-${i}`}
                style={{ ["--gw-edge" as string]: edge, ["--gw-flip" as string]: FLIP }}
              >
                <div className="gwf-sev" />
                <div className="gwf-in">
                  <div className="gwf-l1">
                    <span className="gwf-sym">{r.symbol}</span>
                    <span className="gwf-k">{r.strike} strike</span>
                    {/* Both clauses are optional server-side — a row with no
                        spot or no leg data renders a shorter line rather than
                        "null vs spot". */}
                    {r.vsSpot && <span className="gwf-vs">{r.vsSpot} vs spot</span>}
                    {r.flip && <span className="gwf-flip">FLIP</span>}
                  </div>
                  <div className="gwf-l2">{r.headline}{r.side ? ` · ${r.side}` : ""}</div>
                  <div className="gwf-l3">
                    <span className="gwf-x">{r.zx}×</span>
                    <span className="gwf-bar"><i style={{ width: `${w}%` }} /></span>
                    <span>a normal day for {r.symbol}</span>
                    {r.track && (
                      <span>· {r.track.hits} of the last {r.track.graded} like this moved</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
