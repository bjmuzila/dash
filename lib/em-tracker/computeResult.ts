import { type EmTrackerRow } from "@/lib/db";

/** Inside-EM test. A week is a "hit" when the realized range stayed inside the
 *  band [ref-em, ref+em]; a "miss" when high or low broke it. Uses up/down if
 *  provided, otherwise ref_close ± em. */
export function computeResult(r: EmTrackerRow): "hit" | "miss" | null {
  const em = Number(r.em);
  if (!Number.isFinite(em) || em <= 0) return null;
  const ref = r.ref_close != null ? Number(r.ref_close) : null;
  const up = r.up != null ? Number(r.up) : (ref != null ? ref + em : null);
  const down = r.down != null ? Number(r.down) : (ref != null ? ref - em : null);
  if (up == null || down == null) return null;
  const h = r.h != null ? Number(r.h) : null;
  const l = r.l != null ? Number(r.l) : null;
  if (h == null || l == null) return null;
  return h <= up && l >= down ? "hit" : "miss";
}
