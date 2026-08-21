import { useCallback, useEffect, useState } from "react";
import Shell from "../components/Shell";
import {
  Card, Empty, ErrorNote, Pill, Stat, TableCard, numCell, td, th,
} from "../components/ui";
import { useSession } from "../App";
import { api, money, money2, shortDate, PAYOUT_LABEL, type Stats } from "../lib/api";
import { THEME, TYPE } from "../lib/theme";

/**
 * Payout history, from the affiliate's side.
 *
 * The same rows the owner sees on /owner/affiliates → Payouts, read-only. That
 * symmetry is the point: there is exactly one ledger, and an affiliate who
 * queries a number is looking at the same row the person paying them is.
 *
 * Statuses, in the order money moves through them:
 *   Accruing  — the period is still open
 *   Pending   — period closed, waiting on approval
 *   Approved  — cleared to send
 *   Paid      — sent, with a reference
 *   Held      — something needs sorting out before it goes
 */
export default function Payouts() {
  const { affiliate } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api.stats();
      setStats(j.stats);
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!affiliate) return null;

  const paidCount = stats?.payouts.filter((p) => p.status === "paid").length ?? 0;

  return (
    <Shell wide>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Payouts</h1>
        <span style={{ fontSize: TYPE.label, color: THEME.dim2 }}>
          Paid by {PAYOUT_LABEL[affiliate.payout_method] || affiliate.payout_method}
          {affiliate.payout_detail ? ` · ${affiliate.payout_detail}` : ""}
        </span>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <Stat tone="green" label="Unpaid earnings" value={money(stats?.unpaid_cents)} sub="Holding + cleared" />
        <Stat tone="blue" label="Paid to date" value={money(stats?.paid_cents)} sub={`${paidCount} payouts`} />
        <Stat tone="cyan" label="This period" value={money(stats?.mtd_cents)} sub={stats?.period ?? "—"} />
        <Stat tone="orange" label="Rate" value={`${affiliate.tier_pct}%`} sub="Flat, every payment" />
      </div>

      <TableCard title="By period">
        {(stats?.payouts.length ?? 0) === 0 ? (
          <Empty>
            No closed periods yet. A period appears here once it closes and its commission has cleared the
            30-day refund window.
          </Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Period</th>
                <th style={{ ...th, ...numCell }}>Sales</th>
                <th style={{ ...th, ...numCell }}>Gross</th>
                <th style={{ ...th, ...numCell }}>Refunds</th>
                <th style={{ ...th, ...numCell }}>Your cut</th>
                <th style={th}>Method</th>
                <th style={th}>Status</th>
                <th style={th}>Reference</th>
              </tr>
            </thead>
            <tbody>
              {stats!.payouts.map((p) => (
                <tr key={p.period}>
                  <td style={td}>{p.period}</td>
                  <td style={{ ...td, ...numCell }}>{p.sales}</td>
                  <td style={{ ...td, ...numCell }}>{money(p.gross_cents)}</td>
                  <td style={{ ...td, ...numCell, color: p.refunds_cents ? THEME.softRed : THEME.dim2 }}>
                    {p.refunds_cents ? `−${money(p.refunds_cents)}` : "$0"}
                  </td>
                  <td style={{ ...td, ...numCell, fontWeight: 700, color: THEME.green }}>{money2(p.commission_cents)}</td>
                  <td style={{ ...td, color: THEME.dim }}>{PAYOUT_LABEL[p.method || ""] || p.method || "—"}</td>
                  <td style={td}>
                    {p.status === "paid" ? <Pill tone="blue">Paid {shortDate(p.paid_at)}</Pill>
                      : p.status === "approved" ? <Pill tone="green">Approved</Pill>
                      : p.status === "held" ? <Pill tone="red">Held</Pill>
                      : <Pill tone="orange">Pending</Pill>}
                  </td>
                  <td style={{ ...td, color: THEME.dim2, fontFamily: "var(--font-mono)", fontSize: TYPE.label }}>
                    {p.reference || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Card title="How payment works">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5, color: THEME.dim, lineHeight: 1.6 }}>
          <div><b style={{ color: "#fff" }}>1 · Earned.</b> Every paid invoice from your code writes a row at your rate, the same day it's charged.</div>
          <div><b style={{ color: "#fff" }}>2 · Holding.</b> It sits for 30 days so a refund can reverse it before anyone is paid on money that came back.</div>
          <div><b style={{ color: "#fff" }}>3 · Cleared.</b> Past the window, it's yours and joins the period total.</div>
          <div><b style={{ color: "#fff" }}>4 · Paid.</b> The period is approved and sent by {PAYOUT_LABEL[affiliate.payout_method] || affiliate.payout_method}, with a reference recorded on the row above.</div>
          <div style={{ color: THEME.dim2 }}>
            Something look wrong? Email affiliates@cbedge.net with the period and we'll walk the ledger with you.
          </div>
        </div>
      </Card>
    </Shell>
  );
}
