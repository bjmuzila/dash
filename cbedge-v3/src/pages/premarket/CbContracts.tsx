/**
 * CONTRACTS — today's CB 0DTE checkpoints, on the premarket page.
 * ────────────────────────────────────────────────────────────────────────────
 * The same board the owner Results → Contracts tab renders, cut down to the one
 * thing a customer is reading it for: what the CB-strike 0DTE contract did at
 * each of today's checkpoints. One row per checkpoint — 9:45, 10:30, 12:00 —
 * with what was paid, the day's high-water mark, and the P/L to that mark.
 *
 * THE P/L IS ENTRY → PEAK, not held-to-the-bell, and there is no summed total
 * across the three rows. Both are deliberate; the reasons are on the cells
 * themselves.
 *
 * WHAT THIS IS NOT: the owner board's range picker, its per-checkpoint roll-up
 * cards, and its recorder controls (Run now / Diagnose) are all deliberately
 * absent. Those are operator tools for a table that spans twenty sessions; this
 * is one session, read-only. Widening this card back into that one is how a
 * customer surface ends up with a "Run now" button on it.
 *
 * WHICH SESSION: today's, the moment today has one — and the last session that
 * has rows until then. The server decides that (see the note on the route) and
 * says which it gave; the card only labels it. So on a Saturday, or at 6am
 * Monday, the card is Friday's board, and at 09:45 ET the next 60s poll flips it
 * to this morning and fills in 10:30 and 12:00 as they print. Nothing here
 * schedules anything: the poll is the whole mechanism.
 *
 * DATA: GET /api/cb-contracts (server-v2/api-router.js, auth:'subscriber') —
 * one session's rows, and ?ticks=<id> only for a row of that same session. It is
 * NOT /api/cb-trades: that route is owner-gated, also carries the POST recorder
 * actions and the ?diag= dump, and answers for any date. Read the note on the
 * route before pointing this anywhere else.
 *
 * SKIPPED ROWS STAY. A checkpoint that probed at $2.40 and never qualified is a
 * recorded decision, not a gap — it renders dimmed with the price that
 * disqualified it. Dropping them is what makes "nothing set up today" look
 * exactly like "the recorder was down".
 *
 * THE CALLER MOUNTS THIS ONLY ON A LIVE (non-frozen, non-replayed) session. The
 * route picks its own session and ignores the page's date picker entirely, so
 * rendering it under a frozen date would file one day's contracts under another
 * day's header. The card stamps the session it is showing for the same reason.
 *
 * COLOURS: every value below is a var(--…) token off the page's own .pmk block
 * (which interpolates components/shared/homeTheme). Nothing here types a hex —
 * including the chart, where the tokens go through `style` rather than SVG
 * presentation attributes because a variable in an attribute does not resolve.
 */

import { CB_CONTRACTS_CSS } from "@/pages/premarket/cbContracts.css";
// Re-exported so the old import path still resolves; Premarket.tsx takes the
// stylesheet from the .css module so it can lazy() this file.
export { CB_CONTRACTS_CSS };

import { useCallback, useEffect, useMemo, useState } from "react";
// The probe chart's crosshair reads clientX off the SVG. Type-only, so it
// costs nothing at runtime.
import type { MouseEvent as ReactMouseEvent } from "react";

type CbTrade = {
  id: number; date: string; checkpoint: string; checkpoint_label: string | null;
  ticker: string; expiration: string; side: "C" | "P";
  strike: number;
  cb_strike: number | null;
  cb_price: number | null;
  status: "skipped" | "open" | "closed"; skip_reason: string | null;
  probe_ts: number | string; probe_price: number | null;
  entry_ts: number | string | null; entry_price: number | null; entry_spot: number | null;
  best_ts: number | string | null; worst_ts: number | string | null;
  exit_price: number | null;
  last_price: number | null;
  best_price: number | null; worst_price: number | null; closest_dist: number | null;
  pnl: number | null; pnl_usd: number | null;
  last_error: string | null;
};

type CbTick = {
  ts: number | string; mark: number | null; bid: number | null; ask: number | null;
  spot: number | null; dist: number | null;
};

/**
 * BIGINT columns come back from node-pg as STRINGS, so every timestamp is
 * coerced before it goes near a Date. The null/"" guard is load-bearing rather
 * than defensive: Number(null) and Number("") are both 0 and both pass
 * Number.isFinite, which is how an open row's missing P/L renders as a
 * confident "0.00" — a fabricated number indistinguishable from a flat trade.
 */
const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const contractLabel = (t: CbTrade) =>
  t.strike ? `${Number(t.strike).toFixed(0)}${t.side}` : "—";

/**
 * "2026-08-28" → "Fri Aug 28". Built off Date.UTC and formatted in UTC on
 * purpose: `new Date("2026-08-28")` is midnight UTC, which is the 27th in ET, so
 * formatting it in America/New_York would label every session as the day before.
 */
function sessionLabel(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric",
  }).format(d);
}

function etClock(ts: number) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(new Date(t));
}

export default function CbContracts() {
  const [trades, setTrades] = useState<CbTrade[]>([]);
  const [session, setSession] = useState<{ date: string; today: boolean } | null>(null);
  const [mult, setMult] = useState(100);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [open, setOpen] = useState<CbTrade | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/cb-contracts", { cache: "no-store" });
      // 401/403 is not an error to report — it is a signed-out or non-subscriber
      // view, and the card removes itself rather than showing a permission
      // notice on a page that is otherwise fully readable.
      if (r.status === 401 || r.status === 403) { setState("denied"); return; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const rows: CbTrade[] = Array.isArray(j.trades) ? j.trades : [];
      setTrades(rows);
      setSession(j?.date ? { date: String(j.date), today: j.today !== false } : null);
      if (Number.isFinite(Number(j?.config?.MULTIPLIER))) setMult(Number(j.config.MULTIPLIER));
      setState("ok");
      // An open row that closes, or a checkpoint that prints while the card is
      // open, would otherwise leave the popup showing a frozen copy of the row
      // it was opened from. Re-point it at the row the server just sent.
      setOpen((cur) => (cur ? rows.find((t) => t.id === cur.id) ?? cur : cur));
    } catch { setState("error"); }
  }, []);

  // 60s, the same cadence the recorder polls an open position at — and the only
  // mechanism by which this card goes live: today's first row lands at 09:45 ET
  // and the next poll picks it up. Anything faster re-renders between writes.
  useEffect(() => { void load(); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id); }, [load]);

  // Counts only. There is deliberately NO summed P/L across the three
  // checkpoints: they are three separate one-contract probes of the same
  // session, not three legs of one position, and adding them up invents a
  // portfolio nobody held. A reader who wants the day's total can add the rows
  // they would actually have taken; a footer that does it for them states a
  // number that was never anyone's result.
  const totals = useMemo(() => ({
    taken: trades.filter((t) => t.status !== "skipped").length,
    open: trades.filter((t) => t.status === "open").length,
  }), [trades]);

  if (state === "denied" || state === "error") return null;

  return (
    <div className="cbc">
      <div className="cbchead">
        {/* The session is in the HEADING, not a footnote: this table is
            yesterday's board until 09:45 and today's after it, and a reader who
            has to work out which one they are looking at will assume the wrong
            one. */}
        <h3>
          Contracts · {!session ? "session" : session.today ? "today" : sessionLabel(session.date)}
        </h3>
        {session && !session.today && (
          <span className="cbclast" title="Today has no checkpoints yet. This flips to today's session on its own as soon as the 9:45 row prints.">
            last session
          </span>
        )}
        <span className="tiny">
          0DTE probed at 9:45 / 10:30 / 12:00 · from the CB, walked toward the money to the first strike
          that qualified · held and re-priced to the bell
        </span>
      </div>

      {state === "loading" ? (
        <div className="cbcnote">Loading contracts…</div>
      ) : trades.length === 0 ? (
        <div className="cbcnote">
          No checkpoints recorded yet. The first row of a session prints at 9:45 ET — this table fills
          itself in as they do.
        </div>
      ) : (
        <div className="cbcwrap">
          <table className="cbctbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Contract</th>
                <th className="r">Entry</th>
                <th className="r">Peak</th>
                <th className="r">Peak P/L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const skipped = t.status === "skipped";
                // The flag is `status`, NOT "did the server send a pnl": held
                // positions carry a mark-to-market pnl all day, so testing the
                // number would stop starring anything and every live mark would
                // read as booked.
                const unrealized = t.status === "open";
                // ENTRY → PEAK, and nothing else. This column used to be
                // `t.pnl` — the held-to-the-bell result — which put a number
                // beside the Peak column that contradicted it: 7790C peaked at
                // $3.25 off a $1.90 entry and the row still read −1.87, because
                // there is no sell rule and it gave it all back by the close.
                // Both facts are true; two of them in one row read as a
                // mistake. The table's subject is the PEAK — what the move
                // offered — so the P/L is measured to the same place, and the
                // star still says the peak can still move.
                const entryVsPeak = t.best_price != null && t.entry_price != null
                  ? Math.round((Number(t.best_price) - Number(t.entry_price)) * 100) / 100 : null;
                const shown = entryVsPeak;
                return (
                  <tr key={t.id} className={skipped ? "skip" : undefined}>
                    <td className="mono dim">{t.date}</td>
                    <td className="mono ck">{t.checkpoint_label ?? t.checkpoint}</td>
                    <td>
                      <button
                        type="button"
                        className={`cbcchip${skipped ? " off" : ""}`}
                        onClick={() => setOpen(t)}
                        title={skipped
                          ? (t.skip_reason ?? "not taken")
                          : `${t.ticker} ${t.expiration}`
                            + `${t.cb_strike != null ? ` · CB ${Number(t.cb_strike).toFixed(0)}` : ""}`}
                      >
                        {contractLabel(t)}
                        {/* The CB is the target, the strike is the instrument.
                            Showing one without the other is how a 7750C gets
                            read as the board having said the CB was 7750. */}
                        {t.cb_strike != null && Number(t.cb_strike) !== Number(t.strike) && (
                          <span className="cb">←CB {Number(t.cb_strike).toFixed(0)}</span>
                        )}
                      </button>
                    </td>
                    <td className="mono r">
                      {t.entry_price != null ? (
                        <span title={`filled ${etClock(n(t.entry_ts) ?? 0)} · SPX ${n(t.entry_spot)?.toFixed(2) ?? "—"}`}>
                          ${Number(t.entry_price).toFixed(2)}
                        </span>
                      ) : (
                        <span className="dim2" title={t.skip_reason ?? "not taken"}>
                          {t.probe_price != null ? `($${Number(t.probe_price).toFixed(2)})` : "—"}
                        </span>
                      )}
                    </td>
                    <td className="mono r">
                      {/* The day's high-water mark, not an exit. There is no sell
                          rule, so this is what was there to take rather than
                          what a rule took. */}
                      {t.best_price != null ? (
                        <span
                          className={entryVsPeak != null && entryVsPeak > 0 ? "up" : "dim"}
                          title={`peak $${Number(t.best_price).toFixed(2)}`
                            + `${t.best_ts ? ` at ${etClock(n(t.best_ts) ?? 0)}` : ""}`
                            + `${t.worst_price != null ? ` · low $${Number(t.worst_price).toFixed(2)}` : ""}`}
                        >
                          ${Number(t.best_price).toFixed(2)}
                          {t.best_ts != null && <span className="at">{etClock(n(t.best_ts) ?? 0)}</span>}
                        </span>
                      ) : <span className="dim2">—</span>}
                    </td>
                    <td className={`mono r pl${shown == null ? " flat" : shown >= 0 ? " up" : " down"}${unrealized ? " live" : ""}`}>
                      {shown != null ? (
                        <>
                          {`${shown > 0 ? "+" : ""}${shown.toFixed(2)}${unrealized ? "*" : ""}`}
                          <span className="usd">
                            {shown >= 0 ? "+" : "−"}${Math.abs(shown * mult).toFixed(0)}
                          </span>
                        </>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="cbcfoot">
            <span>{totals.taken} traded · {totals.open} open</span>
            <span className="cbclegend">
              ←CB marks a walked strike · P/L is entry → peak, per contract · <b>*</b> still open
            </span>
          </div>
        </div>
      )}

      {open && <CbProbeCard trade={open} mult={mult} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── Probe card ─────────────────────────────────────────────────────────────
// The owner probe popup, same shape: entry → high of day as the headline, the
// stat strip under it, then the poll curve from cb_trade_ticks so the x-axis
// spans exactly the minutes the position was live.

const CB_METRICS = [
  { key: "mark", label: "Price", dec: 2, prefix: "$" },
  { key: "spot", label: "SPX", dec: 2, prefix: "" },
  { key: "dist", label: "Dist", dec: 1, prefix: "" },
] as const;
type CbMetricKey = typeof CB_METRICS[number]["key"];

function CbProbeCard({ trade, mult, onClose }: { trade: CbTrade; mult: number; onClose: () => void }) {
  const [ticks, setTicks] = useState<CbTick[] | null>(null);
  const [metric, setMetric] = useState<CbMetricKey>("mark");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTicks(null); setErr(null);
    (async () => {
      try {
        const r = await fetch(`/api/cb-contracts?ticks=${trade.id}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!cancelled) setTicks(Array.isArray(j.ticks) ? j.ticks : []);
      } catch (e) { if (!cancelled) { setErr(String(e)); setTicks([]); } }
    })();
    return () => { cancelled = true; };
  }, [trade.id]);

  // Esc closes, and the page does not scroll behind the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const entry = n(trade.entry_price);
  const exitV = n(trade.exit_price);
  const pnl = n(trade.pnl) ?? (entry != null && n(trade.last_price) != null
    ? Math.round((n(trade.last_price)! - entry) * 100) / 100 : null);
  const effMark = exitV ?? n(trade.last_price);
  const peakV = n(trade.best_price);
  const peakPct = entry != null && peakV != null && entry !== 0 ? ((peakV - entry) / entry) * 100 : null;
  const pct = entry != null && effMark != null && entry !== 0 ? ((effMark - entry) / entry) * 100 : null;
  const dollars = entry != null && effMark != null ? (effMark - entry) * mult : null;
  const px = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
  const cls = (v: number | null) => (v == null ? "flat" : v > 0 ? "up" : v < 0 ? "down" : "");

  const stat = (label: string, value: string, tone = "") => (
    <div className="s">
      <span className="k">{label}</span>
      <span className={`v mono ${tone}`}>{value}</span>
    </div>
  );

  return (
    <div className="cbcmask" onClick={onClose}>
      <div className="cbcmodal" onClick={(e) => e.stopPropagation()}>
        <div className="cbcmhead">
          <span className="sym mono">{trade.ticker} {contractLabel(trade)}</span>
          <span className="sub mono">{trade.expiration} · {trade.checkpoint_label ?? trade.checkpoint}</span>
          <button className="x" onClick={onClose} title="Close (Esc)">×</button>
        </div>

        {/* Headline is entry → high of day: what was there to take. The in → now
            line under it is the current (or exited) mark. */}
        <div className="cbcbig">
          <div className={`hl mono ${cls(peakPct)}`}>
            {peakPct == null ? "—" : `${peakPct >= 0 ? "▲" : "▼"} ${Math.abs(peakPct).toFixed(1)}%`}
          </div>
          <div className="line mono">
            <span className="t">in</span>{px(entry)}
            <span className="ar">→</span>
            <span className="t">{exitV != null ? "sold" : "now"}</span>{px(effMark)}
            <span className={cls(pct)}>{pct == null ? "" : ` · ${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`}</span>
            <span className={cls(dollars)}>{dollars == null ? "" : ` · ${dollars >= 0 ? "+" : "−"}$${Math.abs(dollars).toFixed(0)}/ct`}</span>
          </div>
        </div>

        <div className="cbcstats">
          {stat("CB", trade.cb_strike != null
            ? `${Number(trade.cb_strike).toFixed(0)}${trade.cb_price != null ? ` @ $${Number(trade.cb_price).toFixed(2)}` : ""}`
            : "—", "cy")}
          {stat("Entry", entry != null ? `$${entry.toFixed(2)} · ${etClock(n(trade.entry_ts) ?? 0)}` : "not taken",
            entry != null ? "" : "flat")}
          {stat("Peak", trade.best_price != null
            ? `$${Number(trade.best_price).toFixed(2)}${trade.best_ts ? ` · ${etClock(n(trade.best_ts) ?? 0)}` : ""}`
            : "—", trade.best_price != null ? "up" : "flat")}
          {stat("Low", trade.worst_price != null
            ? `$${Number(trade.worst_price).toFixed(2)}${trade.worst_ts ? ` · ${etClock(n(trade.worst_ts) ?? 0)}` : ""}` : "—")}
          {stat("Close", exitV != null ? `$${exitV.toFixed(2)}` : trade.status === "open" ? "open" : "—",
            exitV != null ? "am" : "cy")}
          {stat("P/L", pnl != null ? `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}` : "—", cls(pnl))}
        </div>

        {trade.status !== "skipped" && (
          <div className="cbctgls">
            {CB_METRICS.map((m) => (
              <button key={m.key} className={`cbctgl${metric === m.key ? " on" : ""}`} onClick={() => setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {trade.last_error && (
          <div className="cbcwarn">Last poll unpriced — <b>{trade.last_error}</b></div>
        )}

        {err ? (
          <div className="cbcnote bad">History failed to load: {err}</div>
        ) : trade.status === "skipped" ? (
          // Never a position, so there is no curve and never will be. Say that
          // rather than drawing an empty chart frame.
          <div className="cbcskip">
            <div className="t">Not taken</div>
            <div className="mono">{trade.skip_reason ?? "—"}</div>
            <div className="mono sub">
              Probed {etClock(n(trade.probe_ts) ?? 0)}
              {trade.cb_price != null ? ` · CB ${Number(trade.cb_strike ?? 0).toFixed(0)} @ $${Number(trade.cb_price).toFixed(2)}` : ""}
            </div>
          </div>
        ) : ticks == null ? (
          <div className="cbcnote">Loading history…</div>
        ) : (
          <CbProbeChart
            ticks={ticks}
            metric={metric}
            entry={entry}
            peak={trade.best_price != null && trade.best_ts != null
              ? { v: Number(trade.best_price), ts: n(trade.best_ts) as number } : null}
          />
        )}

        <div className="cbchint mono">
          {metric === "mark" ? "Option price (mark)" : metric === "spot" ? "SPX spot" : "SPX distance to CB"}
          {" · RTH only"}
          {entry != null ? ` · entry @ $${entry.toFixed(2)}` : ""}
          {exitV != null ? ` · sold @ $${exitV.toFixed(2)}` : ""}
        </div>
      </div>
    </div>
  );
}

/**
 * CbProbeChart — the contract's line, in the OWNER PROBE's treatment.
 *
 * Re-cut 2026-09-10 to match owner-vite/src/pages/Probe.tsx's ProbeChart, which
 * is the version of this picture that actually gets read: an ice line over a
 * fading wash, a dashed break-even at the entry fill, the session high marked
 * green and the low red, a RIGHT-HAND price rail with the last mark in a pill
 * tinted by P/L, and a hover crosshair whose readout carries time, price and the
 * dollar P/L per contract.
 *
 * The two structural changes from what stood here before, and why:
 *
 *   • THE AXIS MOVED RIGHT. A left rail puts the numbers at the end you have
 *     already read past; the prices that matter — the high, the entry, the last
 *     — are all events at the RIGHT edge, and the rail belongs next to them.
 *     PADL drops to 12 and PADR opens to 78, so the line gets the width the
 *     labels used to hold.
 *   • H AND L ARE MARKED, not just the peak. The old chart flagged the recorded
 *     high-water mark and nothing else, so a curve that went nowhere and a curve
 *     that halved read the same at a glance.
 *
 * ── EVERY LABEL IS WHITE ─────────────────────────────────────────────────────
 * Not `--dim2`, and not white-at-40%: chart type sits on a wash and a line, so
 * an alpha that reads fine on a flat card turns to mud over the gradient. The
 * tokens are still tokens (`--txt` is the app's white); nothing here is a hex.
 *
 * COLOURS GO THROUGH `style`, never presentation attributes — a `var()` in
 * stroke="" does not resolve and the chart falls back to black.
 */
function CbProbeChart({ ticks, metric, entry, peak }: {
  ticks: CbTick[]; metric: CbMetricKey;
  entry: number | null;
  peak: { v: number; ts: number } | null;   // the day's high-water mark, not an exit
}) {
  const W = 960, H = 340, PADL = 12, PADR = 78, PADT = 26, PADB = 30;
  const [hover, setHover] = useState<number | null>(null);

  const pts = ticks
    .map((t) => ({ ts: n(t.ts), v: n(t[metric]) }))
    .filter((p): p is { ts: number; v: number } => p.ts != null && p.v != null);

  if (pts.length < 2) {
    return (
      <div className="cbcnote">
        {pts.length === 0
          ? "No polls recorded yet. The recorder writes one tick a minute while a position is open."
          : "Only one poll recorded — not enough for a line."}
      </div>
    );
  }

  const spec = CB_METRICS.find((m) => m.key === metric)!;
  const xs = pts.map((p) => p.ts), ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const hi = Math.max(...ys), lo = Math.min(...ys);
  const hiI = ys.indexOf(hi), loI = ys.indexOf(lo);
  // The entry line is part of the picture, not an annotation on top of it — a
  // domain that excludes it draws it off-canvas.
  const domain = [...ys];
  if (metric === "mark" && entry != null) domain.push(entry);
  let minY = Math.min(...domain), maxY = Math.max(...domain);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const gpad = (maxY - minY) * 0.1; minY -= gpad; maxY += gpad;

  const cnt = pts.length;
  const sx = (i: number) => PADL + (cnt <= 1 ? 0 : i / (cnt - 1)) * (W - PADL - PADR);
  const sy = (v: number) => H - PADB - ((v - minY) / (maxY - minY || 1)) * (H - PADT - PADB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(" ");
  const area = `${path} L${sx(cnt - 1).toFixed(1)},${H - PADB} L${sx(0).toFixed(1)},${H - PADB} Z`;
  const fmtY = (v: number) => `${spec.prefix}${v.toFixed(spec.dec)}`;
  const fmtT = (ts: number) => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ts));

  // The pill's tint is the position's direction, and it is only meaningful on
  // the price view against a real entry — on SPX spot or distance-to-CB there
  // is nothing to be up or down against, so it stays neutral.
  const last = pts[cnt - 1]!.v;
  const lastUp = metric === "mark" && entry != null ? last - entry : null;
  const pillVar = lastUp == null ? "var(--cyan)" : lastUp >= 0 ? "var(--pos)" : "var(--neg)";

  // Index of the tick nearest the recorded peak, so the high-water mark the P/L
  // is measured to is flagged where it printed. Nothing happened there — that is
  // the point of showing it.
  const peakIdx = peak
    ? pts.reduce((best, p, i) => (Math.abs(p.ts - peak.ts) < Math.abs(pts[best]!.ts - peak.ts) ? i : best), 0)
    : -1;

  const MONO = "ui-monospace,Menlo,Consolas,monospace";
  /** Every piece of type on this chart. White, mono, bold — see the note above. */
  const label = { fill: "var(--txt)", fontFamily: MONO } as const;

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;      // client px → viewBox units
    const i = Math.round(((vx - PADL) / (W - PADL - PADR)) * (cnt - 1));
    setHover(i < 0 ? 0 : i > cnt - 1 ? cnt - 1 : i);
  };

  const hp = hover == null ? null : pts[hover]!;
  const hpl = hp == null || entry == null || metric !== "mark" ? null : (hp.v - entry) * 100;
  const hx = hp == null ? 0 : sx(hover as number);
  // Flip the readout to the left of the crosshair near the right rail, or it
  // draws under the price pill.
  const tipW = 168, tipFlip = hx + 12 + tipW > W - PADR;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="cbcsvg"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <defs>
        <linearGradient id="cbcwg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--cyan)" }} stopOpacity={0.22} />
          <stop offset="100%" style={{ stopColor: "var(--cyan)" }} stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* Three rungs, not five: high, midpoint, low. The rail is there to price
          the shape, and a five-line grid over a wash is fence, not scale. */}
      {[hi, (hi + lo) / 2, lo].map((v, i) => (
        <g key={i}>
          <line x1={PADL} y1={sy(v)} x2={W - PADR} y2={sy(v)} style={{ stroke: "var(--line2)" }} strokeWidth={1} />
          <text x={W - PADR + 10} y={sy(v) + 4} fontSize={12} fontWeight={700} style={label}>{fmtY(v)}</text>
        </g>
      ))}

      <path d={area} fill="url(#cbcwg)" />

      {/* Entry line on the price view. Without it a rising curve reads as a
          winner even when it never got back to what was paid. */}
      {metric === "mark" && entry != null && (
        <>
          <line x1={PADL} y1={sy(entry)} x2={W - PADR} y2={sy(entry)}
            style={{ stroke: "var(--line3)" }} strokeWidth={1} strokeDasharray="3 5" />
          <text x={PADL + 4} y={sy(entry) - 7} fontSize={12} fontWeight={700} letterSpacing="1" style={label}>
            ENTRY {entry.toFixed(2)}
          </text>
        </>
      )}

      <path d={path} fill="none" style={{ stroke: "var(--cyan)" }} strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" />

      {peakIdx >= 0 && (
        <line x1={sx(peakIdx)} y1={PADT} x2={sx(peakIdx)} y2={H - PADB}
          style={{ stroke: "var(--posEdge)" }} strokeWidth={1} strokeDasharray="3 3" />
      )}

      {/* High and low, marked and priced. The ring is hollow so it reads as an
          annotation rather than another data point on the line. */}
      <circle cx={sx(hiI)} cy={sy(hi)} r={3.4} fill="none" style={{ stroke: "var(--pos)" }} strokeWidth={1.6} />
      <text x={sx(hiI)} y={sy(hi) - 11} fontSize={12} fontWeight={700} textAnchor="middle"
        style={{ fill: "var(--pos)", fontFamily: MONO }}>H {fmtY(hi)}</text>
      <circle cx={sx(loI)} cy={sy(lo)} r={3.4} fill="none" style={{ stroke: "var(--neg)" }} strokeWidth={1.6} />
      <text x={sx(loI)} y={sy(lo) + 18} fontSize={12} fontWeight={700} textAnchor="middle"
        style={{ fill: "var(--neg)", fontFamily: MONO }}>L {fmtY(lo)}</text>

      <text x={PADL} y={H - 8} textAnchor="start" fontSize={12} fontWeight={700} style={label}>{fmtT(minX)}</text>
      <text x={W - PADR} y={H - 8} textAnchor="end" fontSize={12} fontWeight={700} style={label}>{fmtT(maxX)}</text>

      {/* The last mark, in the rail, tinted by where it sits against the entry.
          Pill type is the PLATE colour, not white: it is sitting on a solid
          green or red and needs to read against that, not against the page. */}
      <circle cx={sx(cnt - 1)} cy={sy(last)} r={3.6} style={{ fill: pillVar }} />
      <rect x={W - PADR + 4} y={sy(last) - 11} width={62} height={22} rx={5} style={{ fill: pillVar }} />
      <text x={W - PADR + 35} y={sy(last) + 4} fontSize={13} fontWeight={700} textAnchor="middle"
        style={{ fill: "var(--plate)", fontFamily: MONO }}>{fmtY(last)}</text>

      {hp != null && (
        <g>
          <line x1={hx} y1={PADT} x2={hx} y2={H - PADB} style={{ stroke: "var(--line3)" }} strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={hx} cy={sy(hp.v)} r={4} style={{ fill: "var(--plate)", stroke: "var(--cyan)" }} strokeWidth={2} />
          <g transform={`translate(${tipFlip ? hx - 12 - tipW : hx + 12},${Math.max(PADT, sy(hp.v) - 46)})`}>
            <rect width={tipW} height={44} rx={7} style={{ fill: "var(--plate)", stroke: "var(--cyanEdge)" }} strokeWidth={1} />
            <text x={12} y={18} fontSize={11} fontWeight={700} letterSpacing="1" style={label}>{fmtT(hp.ts)}</text>
            <text x={12} y={35} fontSize={15} fontWeight={700} style={label}>{fmtY(hp.v)}</text>
            {hpl != null && (
              <text x={92} y={35} fontSize={13} fontWeight={700}
                style={{ fill: hpl >= 0 ? "var(--pos)" : "var(--neg)", fontFamily: MONO }}>
                {hpl >= 0 ? "+" : "−"}${Math.abs(hpl).toFixed(0)}
              </text>
            )}
          </g>
        </g>
      )}
    </svg>
  );
}

/**
 * Appended to the page's own <style> block, so every token below resolves
 * against .pmk — the same surface language as the rest of the page, and the
 * reason nothing here is a hex.
 */
