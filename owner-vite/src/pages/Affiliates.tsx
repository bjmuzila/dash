import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { PageShell, Card } from "../components/PageCard";
import {
  OWNER_THEME, LIGHT_BLUE, SOFT_RED, TYPE,
  homeInputStyle, homeButtonStyle, homeSecondaryButtonStyle, statTileStyle, rgba,
} from "../lib/theme";

/**
 * /owner/affiliates — the back office for affiliate.cbedge.net.
 *
 * THREE TABS, ONE JOB EACH:
 *   Onboarding — the review queue. Approve issues the code + tier and flips the
 *                affiliate's dashboard live. Also where code-change requests
 *                get decided, because they are the same act (you are approving
 *                a code) and splitting them meant one of the two got forgotten.
 *   Active     — everyone live: their code, tier, clicks, members, what they're
 *                owed. Pause / reactivate / bump a tier from the row.
 *   Payouts    — one row per (affiliate, period). pending → approved → paid.
 *                Marking paid captures the method + reference and flips the
 *                underlying ledger rows so they stop counting as owed.
 *
 * Every number here comes from /api/aff/owner/* (server-v2/affiliate-routes.cjs).
 * Nothing is computed in this file — the ledger is the source of truth, and a
 * second implementation of "what is owed" living in a React component is how
 * two numbers start disagreeing.
 *
 * CARDS CARRY NO COLOUR ACCENT. Colour here means one thing only: state
 * (pending / active / owed / paid). A card that is tinted because it is a card
 * spends the signal.
 */

// ── types ────────────────────────────────────────────────────────────────────
type Tier = { pct: number; label: string };

type Affiliate = {
  id: number;
  name: string; email: string; status: string;
  code: string | null; requested_code: string;
  tier_pct: number; payout_method: string; payout_detail: string | null;
  primary_link: string | null; channels: string[] | null; audience_size: string | null;
  applied_at: string; approved_at: string | null;
  promo_plan: string | null; other_products: string | null; internal_note: string | null;
  clicks: number; members: number;
  unpaid_cents: number; paid_cents: number; mtd_gross_cents: number;
  pending_request_id: number | null;
  pending_to_code: string | null;
  pending_reason: string | null;
  pending_requested_at: string | null;
};

type Payout = {
  id: number; affiliate_id: number; period: string;
  sales: number; gross_cents: number; refunds_cents: number; commission_cents: number;
  method: string | null; status: string; reference: string | null; note: string | null;
  paid_at: string | null;
  name: string; email: string; code: string | null; tier_pct: number; payout_detail: string | null;
};

type PaidRow = {
  period: string; commission_cents: number; method: string | null;
  reference: string | null; paid_at: string; name: string; code: string | null;
};

type Summary = {
  pending: number; active: number; code_requests: number; open_payouts: number;
  owed_cents: number; paid_cents: number; mtd_gross_cents: number; referred_members: number;
};

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (cents: number | null | undefined) => {
  const v = Number(cents || 0) / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};
const money2 = (cents: number | null | undefined) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }) : "—";

const PAYOUT_LABEL: Record<string, string> = { stripe: "Stripe", paypal: "PayPal", zelle: "Zelle" };

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { cache: "no-store", credentials: "include", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}
const post = (path: string, body: unknown) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ── shared bits ──────────────────────────────────────────────────────────────
function Pill({ tone, children }: { tone: "pending" | "active" | "paused" | "declined" | "info" | "money"; children: ReactNode }) {
  const map = {
    pending: OWNER_THEME.orange,
    active: "#1FD98A",
    paused: "rgba(255,255,255,0.45)",
    declined: SOFT_RED,
    info: LIGHT_BLUE,
    money: "#1FD98A",
  } as const;
  const c = map[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999,
      fontSize: TYPE.micro, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
      color: c, border: `1px solid ${c === "rgba(255,255,255,0.45)" ? OWNER_THEME.border : rgba(String(c), 0.35)}`,
      background: c === "rgba(255,255,255,0.45)" ? "transparent" : rgba(String(c), 0.10), whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "active") return <Pill tone="active">Active</Pill>;
  if (status === "pending") return <Pill tone="pending">Pending</Pill>;
  if (status === "paused") return <Pill tone="paused">Paused</Pill>;
  if (status === "declined") return <Pill tone="declined">Declined</Pill>;
  return <Pill tone="info">{status}</Pill>;
}

function CodePill({ code, dim }: { code: string | null; dim?: boolean }) {
  if (!code) return <span style={{ color: "rgba(255,255,255,0.35)" }}>—</span>;
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 6,
      border: `1px dashed ${rgba(OWNER_THEME.cyan, 0.4)}`, background: rgba(OWNER_THEME.cyan, 0.08),
      color: OWNER_THEME.cyan, fontWeight: 700, letterSpacing: "0.06em", fontSize: TYPE.label,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace", opacity: dim ? 0.5 : 1,
    }}>{code}</span>
  );
}

function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div style={{ ...statTileStyle, border: `1px solid ${OWNER_THEME.border}`, padding: "15px 16px" }}>
      <div style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 7, lineHeight: 1 }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 7 }}>{sub}</div>}
    </div>
  );
}

const th: CSSProperties = {
  textAlign: "left", fontSize: 9.5, letterSpacing: "0.13em", textTransform: "uppercase",
  color: "rgba(255,255,255,0.38)", fontWeight: 700, padding: "10px 14px",
  borderBottom: `1px solid ${OWNER_THEME.border}`, whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)",
  fontSize: TYPE.body, verticalAlign: "middle",
};
const num: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

function Who({ name, sub }: { name: string; sub?: string | null }) {
  const initials = name.split(/\s+/).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{
        width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center",
        fontSize: 11, fontWeight: 700, background: rgba(OWNER_THEME.cyan, 0.22),
        color: "#cdeef8", border: `1px solid ${OWNER_THEME.border}`, flexShrink: 0,
      }}>{initials}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: TYPE.body, lineHeight: 1.25 }}>{name}</div>
        {sub && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>{sub}</div>}
      </div>
    </div>
  );
}

const btn = (kind: "primary" | "ghost" | "good" | "bad"): CSSProperties => {
  if (kind === "good") return { ...homeButtonStyle, borderColor: "rgba(31,217,138,0.35)", background: "linear-gradient(180deg,rgba(31,217,138,.14),rgba(31,217,138,.04))", color: "#1FD98A" };
  if (kind === "bad") return { ...homeButtonStyle, borderColor: "rgba(244,148,142,0.30)", background: "linear-gradient(180deg,rgba(244,148,142,.12),rgba(244,148,142,.03))", color: SOFT_RED };
  if (kind === "ghost") return { ...homeSecondaryButtonStyle };
  return { ...homeButtonStyle };
};

// ═══════════════════════════════════════════════════════════════════════════
export default function Affiliates() {
  const [tab, setTab] = useState<"onboarding" | "active" | "payouts">("onboarding");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tiers, setTiers] = useState<Tier[]>([{ pct: 10, label: "Starter" }, { pct: 15, label: "Partner" }, { pct: 20, label: "Elite" }]);
  const [roster, setRoster] = useState<Affiliate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [s, r] = await Promise.all([api("/api/aff/owner/summary"), api("/api/aff/owner/roster")]);
      setSummary(s.summary);
      if (Array.isArray(s.tiers)) setTiers(s.tiers);
      setRoster(r.affiliates || []);
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  }, [load]);

  const pending = useMemo(() => roster.filter((a) => a.status === "pending"), [roster]);
  const live = useMemo(() => roster.filter((a) => a.status !== "pending" && a.status !== "declined"), [roster]);
  const codeReqs = useMemo(() => roster.filter((a) => a.pending_request_id), [roster]);

  return (
    <PageShell>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: TYPE.title, fontWeight: 700, letterSpacing: "0.01em" }}>Affiliates</h1>
        <span style={{ fontSize: TYPE.label, color: "rgba(255,255,255,0.38)" }}>affiliate.cbedge.net</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <TabBtn on={tab === "onboarding"} onClick={() => setTab("onboarding")}>
            Onboarding{summary && summary.pending + summary.code_requests > 0 ? ` · ${summary.pending + summary.code_requests}` : ""}
          </TabBtn>
          <TabBtn on={tab === "active"} onClick={() => setTab("active")}>
            Active{summary ? ` · ${summary.active}` : ""}
          </TabBtn>
          <TabBtn on={tab === "payouts"} onClick={() => setTab("payouts")}>
            Payouts{summary && summary.open_payouts ? ` · ${summary.open_payouts}` : ""}
          </TabBtn>
          <button style={btn("ghost")} onClick={() => void load()} disabled={busy}>Refresh</button>
        </div>
      </div>

      {err && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, fontSize: TYPE.label,
          border: `1px solid ${rgba(SOFT_RED, 0.3)}`, background: rgba(SOFT_RED, 0.08), color: SOFT_RED,
        }}>{err}</div>
      )}

      {summary && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <StatTile label="Awaiting review" value={<span style={{ color: OWNER_THEME.orange }}>{summary.pending}</span>} sub="New applications" />
          <StatTile label="Code edit requests" value={<span style={{ color: OWNER_THEME.cyan }}>{summary.code_requests}</span>} sub="Need a decision" />
          <StatTile label="Active affiliates" value={<span style={{ color: LIGHT_BLUE }}>{summary.active}</span>} sub={`${summary.referred_members} referred members`} />
          <StatTile label="Commission owed" value={<span style={{ color: OWNER_THEME.orange }}>{money(summary.owed_cents)}</span>} sub="Accrued, not yet paid" />
          <StatTile label="Paid to date" value={<span style={{ color: "#1FD98A" }}>{money(summary.paid_cents)}</span>} sub={`${money(summary.mtd_gross_cents)} affiliate gross MTD`} />
        </div>
      )}

      {tab === "onboarding" && (
        <OnboardingTab pending={pending} codeReqs={codeReqs} tiers={tiers} run={run} busy={busy} />
      )}
      {tab === "active" && <ActiveTab rows={live} tiers={tiers} run={run} busy={busy} />}
      {tab === "payouts" && <PayoutsTab run={run} busy={busy} />}
    </PageShell>
  );
}

function TabBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...(on ? homeButtonStyle : homeSecondaryButtonStyle),
        padding: "6px 12px",
      }}
    >{children}</button>
  );
}

// ── ONBOARDING ───────────────────────────────────────────────────────────────
function OnboardingTab({
  pending, codeReqs, tiers, run, busy,
}: {
  pending: Affiliate[]; codeReqs: Affiliate[]; tiers: Tier[];
  run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <>
      <Card variant="classic" padding={0}>
        <SectionHead title="Pending applications" right={`${pending.length} waiting`} />
        {pending.length === 0 ? (
          <Empty>Nothing waiting. New applications land here the moment someone applies.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Applicant</th><th style={th}>Channels</th>
                  <th style={{ ...th, ...num }}>Audience</th><th style={th}>Requested code</th>
                  <th style={th}>Payout</th><th style={th}>Applied</th>
                  <th style={{ ...th, textAlign: "right" }}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((a) => (
                  <Fragment key={a.id}>
                    <tr>
                      <td style={td}><Who name={a.name} sub={a.email} /></td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {(a.channels || []).slice(0, 3).map((c) => <Pill key={c} tone="info">{c}</Pill>)}
                        </div>
                      </td>
                      <td style={{ ...td, ...num, color: "rgba(255,255,255,0.55)" }}>{a.audience_size || "—"}</td>
                      <td style={td}><CodePill code={a.requested_code} /></td>
                      <td style={{ ...td, color: "rgba(255,255,255,0.55)" }}>{PAYOUT_LABEL[a.payout_method] || a.payout_method}</td>
                      <td style={{ ...td, color: "rgba(255,255,255,0.38)" }}>{when(a.applied_at)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        <button style={btn("ghost")} onClick={() => setOpen(open === a.id ? null : a.id)}>
                          {open === a.id ? "Close" : "Review"}
                        </button>
                      </td>
                    </tr>
                    {open === a.id && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <DecisionPanel a={a} tiers={tiers} busy={busy} run={run} onDone={() => setOpen(null)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card variant="classic" padding={0}>
        <SectionHead title="Code change requests" right={`${codeReqs.length} open`} />
        {codeReqs.length === 0 ? (
          <Empty>No code changes waiting. An affiliate asking for a new code shows up here — their old one keeps working until you approve the swap.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {codeReqs.map((a) => (
              <CodeRequestRow key={a.pending_request_id} a={a} run={run} busy={busy} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function DecisionPanel({
  a, tiers, run, busy, onDone,
}: {
  a: Affiliate; tiers: Tier[]; busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>; onDone: () => void;
}) {
  const [code, setCode] = useState(a.requested_code);
  const [tier, setTier] = useState(a.tier_pct || 10);
  const [cookieDays, setCookieDays] = useState(60);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; reason: string | null } | null>(null);

  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const j = await api(`/api/aff/code-check?code=${encodeURIComponent(code)}`);
        if (!dead) setCheck({ ok: !!j.ok, reason: j.reason || null });
      } catch { if (!dead) setCheck(null); }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [code]);

  return (
    <div style={{ padding: 20, display: "grid", gap: 18, gridTemplateColumns: "1.4fr 1fr", background: "rgba(255,255,255,0.015)" }}>
      <div>
        <Label>How they plan to promote it</Label>
        <p style={{ margin: "8px 0 0", fontSize: TYPE.body, lineHeight: 1.6, color: "rgba(255,255,255,0.72)", whiteSpace: "pre-wrap" }}>
          {a.promo_plan || "— not answered —"}
        </p>
        <div style={{ height: 1, background: OWNER_THEME.border, margin: "16px 0" }} />
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
          <div><Label>Primary channel</Label><div style={{ marginTop: 6, fontSize: TYPE.body }}>{a.primary_link || "—"}</div></div>
          <div><Label>Audience</Label><div style={{ marginTop: 6, fontSize: TYPE.body }}>{a.audience_size || "—"}</div></div>
          <div>
            <Label>Payout</Label>
            <div style={{ marginTop: 6, fontSize: TYPE.body }}>
              {PAYOUT_LABEL[a.payout_method] || a.payout_method}
              {a.payout_detail ? <span style={{ color: "rgba(255,255,255,0.45)" }}> · {a.payout_detail}</span> : null}
            </div>
          </div>
        </div>
        <div style={{ height: 1, background: OWNER_THEME.border, margin: "16px 0" }} />
        <Label>Other products promoted</Label>
        <p style={{ margin: "8px 0 0", fontSize: TYPE.body, color: "rgba(255,255,255,0.55)" }}>{a.other_products || "None declared."}</p>
      </div>

      <div>
        <Field label="Issue code">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                 style={{ ...homeInputStyle, width: "100%", letterSpacing: "0.1em", fontWeight: 700, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }} />
          {check && (
            <div style={{ marginTop: 6, fontSize: 11, color: check.ok ? "#1FD98A" : SOFT_RED }}>
              {check.ok ? "Available" : check.reason}
            </div>
          )}
        </Field>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <Field label="Commission">
            <select value={tier} onChange={(e) => setTier(Number(e.target.value))} style={{ ...homeInputStyle, width: "100%" }}>
              {tiers.map((t) => <option key={t.pct} value={t.pct}>{t.pct}% {t.label}</option>)}
            </select>
          </Field>
          <Field label="Cookie">
            <select value={cookieDays} onChange={(e) => setCookieDays(Number(e.target.value))} style={{ ...homeInputStyle, width: "100%" }}>
              {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
            </select>
          </Field>
        </div>
        <Field label="Internal note (only you see this)">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                    style={{ ...homeInputStyle, width: "100%", resize: "vertical", fontFamily: "inherit" }} />
        </Field>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            disabled={busy || (check ? !check.ok : false)}
            style={{ ...btn("good"), flex: 1, padding: "10px 14px" }}
            onClick={() => run(async () => {
              await post("/api/aff/owner/decide", { id: a.id, action: "approve", code, tier_pct: tier, cookie_days: cookieDays, note });
              onDone();
            })}
          >Approve &amp; issue</button>
        </div>
        <Field label="Decline reason (sent to them)">
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...homeInputStyle, width: "100%" }} />
        </Field>
        <button
          disabled={busy}
          style={{ ...btn("bad"), width: "100%", padding: "8px 14px" }}
          onClick={() => run(async () => {
            await post("/api/aff/owner/decide", { id: a.id, action: "decline", reason, note });
            onDone();
          })}
        >Decline</button>
        <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>
          Approving issues the code, unlocks their dashboard and starts tracking immediately.
        </div>
      </div>
    </div>
  );
}

function CodeRequestRow({ a, run, busy }: { a: Affiliate; run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [keepOld, setKeepOld] = useState(true);
  return (
    <div style={{
      display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
      padding: "16px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ minWidth: 200 }}><Who name={a.name} sub={a.email} /></div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <CodePill code={a.code} dim /> <span style={{ color: "rgba(255,255,255,0.38)" }}>→</span> <CodePill code={a.pending_to_code} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>requested {when(a.pending_requested_at)}</span>
        </div>
        {a.pending_reason && (
          <div style={{ marginTop: 7, fontSize: TYPE.label, color: "rgba(255,255,255,0.55)" }}>&ldquo;{a.pending_reason}&rdquo;</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={keepOld} onChange={(e) => setKeepOld(e.target.checked)} style={{ accentColor: OWNER_THEME.cyan }} />
          Keep old code live 30d
        </label>
        <button disabled={busy} style={btn("bad")}
          onClick={() => run(() => post("/api/aff/owner/code-request", { id: a.pending_request_id, action: "reject" }))}>Reject</button>
        <button disabled={busy} style={btn("good")}
          onClick={() => run(() => post("/api/aff/owner/code-request", { id: a.pending_request_id, action: "approve", keep_old_days: keepOld ? 30 : 0 }))}>Approve swap</button>
      </div>
    </div>
  );
}

// ── ACTIVE ───────────────────────────────────────────────────────────────────
function ActiveTab({
  rows, tiers, run, busy,
}: {
  rows: Affiliate[]; tiers: Tier[];
  run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toUpperCase();
    if (!s) return rows;
    return rows.filter((a) =>
      a.name.toUpperCase().includes(s) || a.email.toUpperCase().includes(s) || (a.code || "").includes(s));
  }, [rows, q]);

  return (
    <Card variant="classic" padding={0}>
      <SectionHead
        title="Active affiliates"
        right={
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code"
                 style={{ ...homeInputStyle, width: 200, padding: "6px 10px", fontSize: TYPE.label }} />
        }
      />
      {filtered.length === 0 ? (
        <Empty>Nobody live yet. Approve an application on the Onboarding tab and they appear here.</Empty>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Affiliate</th><th style={th}>Code</th>
                <th style={{ ...th, ...num }}>Tier</th><th style={{ ...th, ...num }}>Clicks</th>
                <th style={{ ...th, ...num }}>Members</th><th style={{ ...th, ...num }}>Gross MTD</th>
                <th style={{ ...th, ...num }}>Owed</th><th style={th}>Payout</th>
                <th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td style={td}><Who name={a.name} sub={a.primary_link || a.email} /></td>
                  <td style={td}><CodePill code={a.code} dim={a.status === "paused"} /></td>
                  <td style={{ ...td, ...num }}>
                    <select
                      value={a.tier_pct} disabled={busy}
                      onChange={(e) => run(() => post("/api/aff/owner/affiliate", { id: a.id, action: "tier", tier_pct: Number(e.target.value) }))}
                      style={{ ...homeInputStyle, padding: "4px 8px", fontSize: TYPE.label, width: "auto" }}
                    >
                      {tiers.map((t) => <option key={t.pct} value={t.pct}>{t.pct}%</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, ...num }}>{a.clicks.toLocaleString()}</td>
                  <td style={{ ...td, ...num }}>{a.members}</td>
                  <td style={{ ...td, ...num }}>{money(a.mtd_gross_cents)}</td>
                  <td style={{ ...td, ...num, color: a.unpaid_cents > 0 ? "#1FD98A" : "rgba(255,255,255,0.38)" }}>{money(a.unpaid_cents)}</td>
                  <td style={{ ...td, color: "rgba(255,255,255,0.55)", fontSize: TYPE.label }}>
                    {PAYOUT_LABEL[a.payout_method] || a.payout_method}
                    {a.payout_detail ? <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{a.payout_detail}</div> : null}
                  </td>
                  <td style={td}>
                    {a.pending_request_id ? <Pill tone="info">Edit requested</Pill> : <StatusPill status={a.status} />}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {a.status === "paused" ? (
                      <button disabled={busy} style={btn("primary")}
                        onClick={() => run(() => post("/api/aff/owner/affiliate", { id: a.id, action: "activate" }))}>Reactivate</button>
                    ) : (
                      <button disabled={busy} style={btn("ghost")}
                        onClick={() => run(() => post("/api/aff/owner/affiliate", { id: a.id, action: "pause" }))}>Pause</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── PAYOUTS ──────────────────────────────────────────────────────────────────
function PayoutsTab({ run, busy }: { run: (fn: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [period, setPeriod] = useState<string>("");
  const [periods, setPeriods] = useState<string[]>([]);
  const [rows, setRows] = useState<Payout[]>([]);
  const [history, setHistory] = useState<PaidRow[]>([]);
  const [holdDays, setHoldDays] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Payout | null>(null);

  const load = useCallback(async (p?: string) => {
    setErr(null);
    try {
      const j = await api(`/api/aff/owner/payouts${p ? `?period=${encodeURIComponent(p)}` : ""}`);
      setPeriod(j.period);
      setPeriods(j.periods?.length ? j.periods : [j.period]);
      setRows(j.payouts || []);
      setHistory(j.history || []);
      setHoldDays(j.hold_days ?? 30);
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const t = { pending: 0, approved: 0, paid: 0, held: 0 };
    for (const r of rows) {
      if (r.status === "pending") t.pending += r.commission_cents;
      else if (r.status === "approved") t.approved += r.commission_cents;
      else if (r.status === "paid") t.paid += r.commission_cents;
      else if (r.status === "held") t.held += r.commission_cents;
    }
    return t;
  }, [rows]);

  return (
    <>
      {err && <div style={{ padding: "10px 14px", borderRadius: 10, fontSize: TYPE.label, border: `1px solid ${rgba(SOFT_RED, 0.3)}`, background: rgba(SOFT_RED, 0.08), color: SOFT_RED }}>{err}</div>}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <StatTile label="Awaiting approval" value={<span style={{ color: OWNER_THEME.orange }}>{money(totals.pending)}</span>} sub={`Period ${period}`} />
        <StatTile label="Approved, unpaid" value={<span style={{ color: "#1FD98A" }}>{money(totals.approved)}</span>} sub="Ready to send" />
        <StatTile label="Paid this period" value={<span style={{ color: LIGHT_BLUE }}>{money(totals.paid)}</span>} sub={`${rows.filter((r) => r.status === "paid").length} payouts`} />
        <StatTile label="Held" value={<span style={{ color: SOFT_RED }}>{money(totals.held)}</span>} sub={`${holdDays}-day refund window`} />
      </div>

      <Card variant="classic" padding={0}>
        <SectionHead
          title={`Payouts · ${period}`}
          right={
            <select value={period} onChange={(e) => void load(e.target.value)} style={{ ...homeInputStyle, width: "auto", padding: "6px 10px", fontSize: TYPE.label }}>
              {periods.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          }
        />
        {rows.length === 0 ? (
          <Empty>Nothing accrued in {period}. Rows appear here as soon as an attributed invoice is paid.</Empty>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Affiliate</th><th style={th}>Code</th>
                  <th style={{ ...th, ...num }}>Sales</th><th style={{ ...th, ...num }}>Gross</th>
                  <th style={{ ...th, ...num }}>Refunds</th><th style={{ ...th, ...num }}>Rate</th>
                  <th style={{ ...th, ...num }}>Payout</th><th style={th}>Method</th>
                  <th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td style={td}><Who name={p.name} sub={p.email} /></td>
                    <td style={td}><CodePill code={p.code} /></td>
                    <td style={{ ...td, ...num }}>{p.sales}</td>
                    <td style={{ ...td, ...num }}>{money(p.gross_cents)}</td>
                    <td style={{ ...td, ...num, color: p.refunds_cents ? SOFT_RED : "rgba(255,255,255,0.38)" }}>
                      {p.refunds_cents ? `−${money(p.refunds_cents)}` : "$0"}
                    </td>
                    <td style={{ ...td, ...num, color: LIGHT_BLUE }}>{p.tier_pct}%</td>
                    <td style={{ ...td, ...num, fontWeight: 700, color: "#1FD98A" }}>{money2(p.commission_cents)}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.55)", fontSize: TYPE.label }}>
                      {PAYOUT_LABEL[p.method || ""] || p.method || "—"}
                      {p.payout_detail ? <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>{p.payout_detail}</div> : null}
                    </td>
                    <td style={td}>
                      {p.status === "paid" ? <Pill tone="active">Paid</Pill>
                        : p.status === "approved" ? <Pill tone="money">Approved</Pill>
                        : p.status === "held" ? <Pill tone="declined">Held</Pill>
                        : <Pill tone="pending">Needs approval</Pill>}
                      {p.reference && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 4, fontFamily: "ui-monospace, Menlo, monospace" }}>{p.reference}</div>}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {p.status === "pending" && (
                        <button disabled={busy} style={btn("good")}
                          onClick={() => run(async () => { await post("/api/aff/owner/payout", { id: p.id, action: "approve" }); await load(period); })}>Approve</button>
                      )}
                      {p.status === "approved" && (
                        <button disabled={busy} style={btn("good")} onClick={() => setPayFor(p)}>Mark paid</button>
                      )}
                      {p.status === "held" && (
                        <button disabled={busy} style={btn("ghost")}
                          onClick={() => run(async () => { await post("/api/aff/owner/payout", { id: p.id, action: "approve" }); await load(period); })}>Release hold</button>
                      )}
                      {p.status !== "paid" && p.status !== "held" && (
                        <button disabled={busy} style={{ ...btn("ghost"), marginLeft: 6 }}
                          onClick={() => run(async () => { await post("/api/aff/owner/payout", { id: p.id, action: "hold" }); await load(period); })}>Hold</button>
                      )}
                      {p.status === "paid" && <span style={{ color: "rgba(255,255,255,0.35)", fontSize: TYPE.label }}>{when(p.paid_at)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {payFor && (
        <Card variant="classic">
          <MarkPaid p={payFor} busy={busy} onCancel={() => setPayFor(null)}
                    onDone={async () => { setPayFor(null); await load(period); }} run={run} />
        </Card>
      )}

      <Card variant="classic" padding={0}>
        <SectionHead title="Paid history" right={`${history.length} payouts`} />
        {history.length === 0 ? <Empty>No payouts have been sent yet.</Empty> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Paid</th><th style={th}>Affiliate</th><th style={th}>Code</th>
                  <th style={th}>Period</th><th style={{ ...th, ...num }}>Amount</th>
                  <th style={th}>Method</th><th style={th}>Reference</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.period}-${h.name}-${i}`}>
                    <td style={{ ...td, color: "rgba(255,255,255,0.38)" }}>{when(h.paid_at)}</td>
                    <td style={td}>{h.name}</td>
                    <td style={td}><CodePill code={h.code} /></td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.38)" }}>{h.period}</td>
                    <td style={{ ...td, ...num }}>{money2(h.commission_cents)}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.55)" }}>{PAYOUT_LABEL[h.method || ""] || h.method || "—"}</td>
                    <td style={{ ...td, color: "rgba(255,255,255,0.38)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: TYPE.label }}>{h.reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function MarkPaid({
  p, busy, run, onDone, onCancel,
}: {
  p: Payout; busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onDone: () => Promise<void> | void; onCancel: () => void;
}) {
  const [method, setMethod] = useState(p.method || "stripe");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  return (
    <div>
      <div style={{ fontSize: TYPE.title, fontWeight: 700, marginBottom: 4 }}>Mark paid — {p.name}</div>
      <div style={{ fontSize: TYPE.label, color: "rgba(255,255,255,0.45)", marginBottom: 18 }}>
        {money2(p.commission_cents)} for {p.period}
        {p.payout_detail ? ` · ${p.payout_detail}` : ""}
      </div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} style={{ ...homeInputStyle, width: "100%" }}>
            <option value="stripe">Stripe</option>
            <option value="paypal">PayPal</option>
            <option value="zelle">Zelle</option>
          </select>
        </Field>
        <Field label="Reference">
          <input value={reference} onChange={(e) => setReference(e.target.value)}
                 placeholder="po_… / txn id / Zelle confirmation"
                 style={{ ...homeInputStyle, width: "100%", fontFamily: "ui-monospace, Menlo, monospace" }} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} style={{ ...homeInputStyle, width: "100%" }} />
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          disabled={busy || !reference.trim()}
          style={{ ...btn("good"), padding: "10px 18px" }}
          onClick={() => run(async () => {
            await post("/api/aff/owner/payout", { id: p.id, action: "paid", method, reference, note });
            await onDone();
          })}
        >Confirm paid</button>
        <button style={btn("ghost")} onClick={onCancel}>Cancel</button>
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.38)" }}>
        Confirming flips every cleared ledger row for {p.period} to paid, so it stops counting as owed. A reference is required — that is the only record of the actual transfer.
      </div>
    </div>
  );
}

// ── tiny presentational helpers ──────────────────────────────────────────────
function SectionHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", borderBottom: `1px solid ${OWNER_THEME.border}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{title}</div>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", fontSize: TYPE.label, color: "rgba(255,255,255,0.38)" }}>{right}</div>
    </div>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: "28px 18px", fontSize: TYPE.body, color: "rgba(255,255,255,0.38)", lineHeight: 1.6 }}>{children}</div>;
}
function Label({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)", fontWeight: 700 }}>{children}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 7 }}><Label>{label}</Label></div>
      {children}
    </div>
  );
}
