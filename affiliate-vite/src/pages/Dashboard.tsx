import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import {
  Banner, Card, CodePill, Empty, ErrorNote, Pill, Spark, Stat,
  TableCard, numCell, td, th,
} from "../components/ui";
import { useSession } from "../App";
import { api, maskEmail, money, money2, shortDate, type Stats } from "../lib/api";
import { THEME, TYPE, buttonStyle, inputStyle, secondaryButtonStyle } from "../lib/theme";

/**
 * The affiliate's overview.
 *
 * TWO VIEWS, ONE ROUTE. A pending applicant lands here too — they get the
 * waiting room, which is the same shell with the same tiles at zero and an
 * honest explanation instead of a paywall. The alternative (bounce them to a
 * separate /pending page) means a URL that goes stale the moment they're
 * approved, and a bookmark that then 404s.
 *
 * Every number is read from /api/aff/stats. Nothing is computed here on
 * purpose: the ledger is the source of truth, and a second implementation of
 * "what am I owed" in a React component is how two numbers start disagreeing.
 */
export default function Dashboard() {
  const { affiliate } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [link, setLink] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api.stats();
      setStats(j.stats);
      setLink(j.link || "");
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = (what: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  if (!affiliate) return null;

  // ── Waiting room ──────────────────────────────────────────────────────────
  if (affiliate.status !== "active") {
    return (
      <Shell>
        <Card>
          <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
            <div style={{
              width: 52, height: 52, borderRadius: 16, margin: "0 auto", display: "grid", placeItems: "center",
              background: "rgba(251,133,1,0.12)", border: "1px solid rgba(251,133,1,0.30)", fontSize: 22,
            }}>{affiliate.status === "declined" ? "—" : affiliate.status === "paused" ? "❚❚" : "⏳"}</div>

            <h1 style={{ margin: "18px 0 8px", fontSize: 22, letterSpacing: "-0.02em" }}>
              {affiliate.status === "pending" ? "Application under review"
                : affiliate.status === "paused" ? "Your code is paused"
                : "Application not approved"}
            </h1>

            <p style={{ margin: "0 auto", maxWidth: "52ch", fontSize: 13.5, lineHeight: 1.6, color: THEME.dim }}>
              {affiliate.status === "pending" && (
                <>We've got it, {affiliate.name.split(" ")[0]}. Applications are reviewed by hand — you'll get an
                  email at <b style={{ color: "#fff" }}>{affiliate.email}</b> as soon as it's decided, usually
                  within 24 hours.</>
              )}
              {affiliate.status === "paused" && (
                <>Your code isn't attributing new sales right now. Anything already earned is safe and still shows
                  on your payouts. Email affiliates@cbedge.net if you think this is a mistake.</>
              )}
              {affiliate.status === "declined" && (
                <>{affiliate.decline_reason || "We're not taking this application forward right now."}</>
              )}
            </p>
          </div>

          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", marginTop: 26 }}>
            <Stat label="Submitted" value={<span style={{ fontSize: 18 }}>{shortDate(affiliate.applied_at)}</span>} />
            <Stat label={affiliate.code ? "Your code" : "Requested code"}
                  value={<CodePill code={affiliate.code || affiliate.requested_code} />} />
            <Stat label="Status"
                  value={
                    affiliate.status === "pending" ? <Pill tone="orange">In review</Pill>
                      : affiliate.status === "paused" ? <Pill tone="grey">Paused</Pill>
                      : <Pill tone="red">Declined</Pill>
                  } />
          </div>

          {affiliate.status === "pending" && (
            <div style={{ marginTop: 20 }}>
              <Banner tone="cyan">
                <Pill tone="cyan">While you wait</Pill>
                <span>
                  Have a look at <a href="https://cbedge.net" style={{ color: THEME.cyan }}>the terminal</a> so you can
                  speak to it, and think about which of your posts would carry a GEX screenshot best. Your creatives
                  unlock the moment you're approved.
                </span>
              </Banner>
            </div>
          )}
        </Card>
      </Shell>
    );
  }

  // ── Active dashboard ──────────────────────────────────────────────────────
  return (
    <Shell wide>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Welcome back, {affiliate.name.split(" ")[0]}</h1>
        <span style={{ fontSize: TYPE.label, color: THEME.dim2 }}>Period {stats?.period ?? "—"}</span>
        <button style={{ ...secondaryButtonStyle, marginLeft: "auto" }} onClick={() => void load()}>Refresh</button>
      </div>

      {err && <ErrorNote>{err}</ErrorNote>}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Stat tone="green" label="Unpaid earnings" value={money(stats?.unpaid_cents)} sub="Clears after the refund window" />
        <Stat tone="blue" label="Paid to date" value={money(stats?.paid_cents)} sub={`${stats?.payouts.filter((p) => p.status === "paid").length ?? 0} payouts`} />
        <Stat tone="cyan" label="Active members" value={stats?.members ?? 0} sub={`${money(stats?.mtd_cents)} earned this period`} />
        <Stat tone="orange" label="Conversion"
              value={stats?.conversion_pct != null ? `${stats.conversion_pct}%` : "—"}
              sub="Clicks → paid member" />
        <Stat label="Clicks" value={(stats?.clicks ?? 0).toLocaleString()} sub={`${stats?.clicks_today ?? 0} today`} />
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0,1.55fr) minmax(280px,1fr)" }}>
        <Card title="Earnings · last 30 days" right={<Pill tone="cyan">{affiliate.tier_pct}% of every payment</Pill>}>
          <Spark values={(stats?.series ?? []).map((s) => s.cents)} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 9.5, color: THEME.dim2, letterSpacing: "0.06em" }}>
            <span>{stats?.series?.[0]?.d ?? ""}</span>
            <span>{stats?.series?.[stats.series.length - 1]?.d ?? ""}</span>
          </div>
        </Card>

        <Card title="Your link">
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700, marginBottom: 7 }}>
            Referral link
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={link} style={{ ...inputStyle, fontSize: 12, fontFamily: "var(--font-mono)" }} />
            <button style={{ ...buttonStyle, flexShrink: 0 }} onClick={() => copy("link", link)}>
              {copied === "link" ? "Copied" : "Copy"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: THEME.dim2, marginTop: 6, lineHeight: 1.5 }}>
            {affiliate.cookie_days}-day cookie. A code typed at checkout always wins over a cookie.
          </div>

          <div style={{ height: 1, background: THEME.border, margin: "18px 0" }} />

          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700, marginBottom: 9 }}>
            Checkout code
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <CodePill code={affiliate.code} size={16} />
            <button style={secondaryButtonStyle} onClick={() => copy("code", affiliate.code || "")}>
              {copied === "code" ? "Copied" : "Copy"}
            </button>
            <Link to="/dashboard/code" style={{ ...secondaryButtonStyle, display: "inline-block" }}>Request edit</Link>
          </div>
          {affiliate.prev_code && affiliate.prev_code_until && new Date(affiliate.prev_code_until) > new Date() && (
            <div style={{ fontSize: 11, color: THEME.dim2, marginTop: 8 }}>
              <b style={{ fontFamily: "var(--font-mono)", color: THEME.dim }}>{affiliate.prev_code}</b> still credits you
              until {shortDate(affiliate.prev_code_until)}.
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <TableCard title="Recent referrals" right={<Pill tone="grey">Last 12</Pill>}>
          {(stats?.recent?.length ?? 0) === 0 ? (
            <Empty>Nothing yet. The first paid invoice from your code lands here within minutes of the charge.</Empty>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Member</th><th style={th}>Type</th><th style={th}>Date</th>
                  <th style={{ ...th, ...numCell }}>Your cut</th><th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats!.recent.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", color: THEME.dim }}>{maskEmail(r.customer_email)}</td>
                    <td style={{ ...td, color: THEME.dim, textTransform: "capitalize" }}>{r.kind}</td>
                    <td style={{ ...td, color: THEME.dim2 }}>{shortDate(r.created_at)}</td>
                    <td style={{ ...td, ...numCell, color: r.commission_cents < 0 ? THEME.softRed : THEME.green }}>
                      {money2(r.commission_cents)}
                    </td>
                    <td style={td}>
                      {r.status === "paid" ? <Pill tone="blue">Paid</Pill>
                        : r.status === "cleared" ? <Pill tone="green">Cleared</Pill>
                        : r.status === "refunded" ? <Pill tone="red">Refunded</Pill>
                        : <Pill tone="orange">Holding</Pill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>

        <Card title="How you're doing">
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12.5 }}>
            <Row label="Clicks, last 30 days" value={(stats?.clicks_30d ?? 0).toLocaleString()} />
            <Row label="Clicks today" value={(stats?.clicks_today ?? 0).toLocaleString()} />
            <Row label="Members referred" value={String(stats?.members ?? 0)} />
            <Row label="Earned this period" value={money2(stats?.mtd_cents)} />
            <Row label="Commission rate" value={`${affiliate.tier_pct}% flat`} />
          </div>
          <div style={{ height: 1, background: THEME.border, margin: "18px 0" }} />
          <div style={{ fontSize: 11.5, color: THEME.dim2, lineHeight: 1.6 }}>
            One flat rate, no ladder to climb: {affiliate.tier_pct}% of every payment a member on your code
            makes, the first one and every renewal, for as long as they stay.
          </div>
        </Card>
      </div>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      <span style={{ color: THEME.dim, flex: 1 }}>{label}</span>
      <b style={{ fontVariantNumeric: "tabular-nums" }}>{value}</b>
    </div>
  );
}
