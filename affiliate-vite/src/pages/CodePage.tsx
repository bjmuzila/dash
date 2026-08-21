import { useCallback, useEffect, useState } from "react";
import Shell from "../components/Shell";
import {
  Banner, Card, CodePill, Empty, ErrorNote, Field, Pill, TableCard, td, th,
} from "../components/ui";
import { useSession } from "../App";
import { api, PAYOUT_LABEL, shortDate, type CodeRequest } from "../lib/api";
import { THEME, TYPE, inputStyle, buttonStyle, orangeButtonStyle } from "../lib/theme";

/**
 * Code + payout settings.
 *
 * THE CODE FIELD DOES NOT EDIT THE CODE. Submitting files a request; the code
 * only moves when the owner approves it. That is spelled out on the screen
 * rather than hidden in a tooltip, because an affiliate who thinks their code
 * changed and starts posting the new one has just sent traffic to a dead code.
 *
 * The payout method, by contrast, applies immediately — it changes where money
 * goes, not who is owed it, and holding that in a queue only means a payout
 * lands in the wrong account.
 */
export default function CodePage() {
  const { affiliate, refresh } = useSession();
  const [requests, setRequests] = useState<CodeRequest[]>([]);
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [method, setMethod] = useState<"stripe" | "paypal" | "zelle">("stripe");
  const [detail, setDetail] = useState("");

  const load = useCallback(async () => {
    try {
      const j = await api.codeRequests();
      setRequests(j.requests || []);
    } catch (e) { setErr(String((e as Error).message || e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!affiliate) return;
    setMethod(affiliate.payout_method);
    setDetail(affiliate.payout_detail || "");
  }, [affiliate]);

  useEffect(() => {
    if (code.length < 4) { setCheck(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const j = await api.codeCheck(code);
        if (!dead) setCheck({ ok: j.ok, reason: j.reason });
      } catch { if (!dead) setCheck(null); }
    }, 300);
    return () => { dead = true; clearTimeout(t); };
  }, [code]);

  if (!affiliate) return null;
  const pending = requests.find((r) => r.status === "pending");

  const submitCode = async () => {
    setErr(null); setOk(null); setBusy(true);
    try {
      await api.requestCode(code, reason);
      setCode(""); setReason("");
      setOk("Request filed. Your current code keeps working until it's decided.");
      await load();
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  const savePayout = async () => {
    setErr(null); setOk(null); setBusy(true);
    try {
      await api.setPayout(method, detail);
      setOk("Payout method saved.");
      await refresh();
    } catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Shell wide>
      <h1 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.02em" }}>Code &amp; payout</h1>

      {err && <ErrorNote>{err}</ErrorNote>}
      {ok && <Banner tone="green"><Pill tone="green">Saved</Pill><span>{ok}</span></Banner>}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        <Card title="Your code" right={affiliate.status === "active" ? <Pill tone="green">Live</Pill> : <Pill tone="grey">Not live</Pill>}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <CodePill code={affiliate.code} size={20} />
            <span style={{ fontSize: 11.5, color: THEME.dim2 }}>
              Issued {shortDate(affiliate.approved_at)} · {affiliate.tier_pct}% {affiliate.tier_label}
            </span>
          </div>

          {affiliate.prev_code && affiliate.prev_code_until && new Date(affiliate.prev_code_until) > new Date() && (
            <div style={{ marginTop: 14 }}>
              <Banner tone="cyan">
                <Pill tone="cyan">Grace</Pill>
                <span>
                  Your old code <b style={{ fontFamily: "var(--font-mono)" }}>{affiliate.prev_code}</b> still credits you
                  until {shortDate(affiliate.prev_code_until)}, so links you already posted keep working.
                </span>
              </Banner>
            </div>
          )}

          <div style={{ height: 1, background: THEME.border, margin: "18px 0" }} />

          {pending ? (
            <Banner tone="orange">
              <Pill tone="orange">Waiting</Pill>
              <span>
                You've asked for <b style={{ fontFamily: "var(--font-mono)" }}>{pending.to_code}</b>, filed{" "}
                {shortDate(pending.created_at)}. Nothing changes until it's approved — keep posting{" "}
                <b style={{ fontFamily: "var(--font-mono)" }}>{affiliate.code}</b>.
              </span>
            </Banner>
          ) : (
            <>
              <Field label="Request a new code">
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
                    style={{ ...inputStyle, flex: 1, minWidth: 200, letterSpacing: "0.1em", fontWeight: 700, fontFamily: "var(--font-mono)" }}
                    placeholder="NEWCODE"
                  />
                  {check && (check.ok ? <Pill tone="green">Available</Pill> : <Pill tone="red">Taken</Pill>)}
                </div>
                {check && !check.ok && check.reason && (
                  <div style={{ marginTop: 6, fontSize: 11, color: THEME.softRed }}>{check.reason}</div>
                )}
              </Field>

              <Field label="Reason (the owner reads this)">
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                          style={{ ...inputStyle, resize: "vertical" }}
                          placeholder="Why the change — a rebrand, a handle change, a typo you've been living with." />
              </Field>

              <div style={{ marginBottom: 16 }}>
                <Banner tone="orange">
                  <Pill tone="orange">Heads up</Pill>
                  <span>
                    A code change is approved by hand. When it goes through, your old code stays live for 30 days so
                    existing links keep attributing — both codes credit you during that window.
                  </span>
                </Banner>
              </div>

              <button
                disabled={busy || code.length < 4 || (check ? !check.ok : false)}
                style={{ ...orangeButtonStyle, padding: "10px 18px", borderRadius: 8, opacity: busy ? 0.6 : 1 }}
                onClick={() => void submitCode()}
              >Submit for approval</button>
            </>
          )}
        </Card>

        <Card title="Payout method">
          <Field label="Paid by">
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
              {(["stripe", "paypal", "zelle"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setMethod(m)}
                  style={{
                    padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: TYPE.label, fontWeight: 600,
                    border: `1px solid ${method === m ? "rgba(33,158,188,0.35)" : THEME.border}`,
                    background: method === m ? "rgba(33,158,188,0.10)" : "rgba(255,255,255,0.03)",
                    color: method === m ? THEME.cyan : THEME.dim,
                  }}
                >{PAYOUT_LABEL[m]}</button>
              ))}
            </div>
          </Field>

          {method !== "stripe" ? (
            <Field
              label={method === "paypal" ? "PayPal email" : "Zelle email or phone"}
              hint={method === "zelle"
                ? "Zelle is US bank accounts only, and it moves instantly with no reversal — double-check this before you save it."
                : "The address on your PayPal account. A typo here means a payment sent to someone else."}
            >
              <input value={detail} onChange={(e) => setDetail(e.target.value)} style={inputStyle}
                     placeholder={method === "paypal" ? "you@example.com" : "you@example.com or (555) 555-5555"} />
            </Field>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="cyan">
                <Pill tone="cyan">Stripe</Pill>
                <span>Payouts go to the Stripe account connected to this email. If you haven't connected one yet, we'll send the onboarding link with your first payout.</span>
              </Banner>
            </div>
          )}

          <button
            disabled={busy}
            style={{ ...buttonStyle, padding: "10px 18px", borderRadius: 8, opacity: busy ? 0.6 : 1 }}
            onClick={() => void savePayout()}
          >Save payout method</button>

          <div style={{ marginTop: 14, fontSize: 11.5, color: THEME.dim2, lineHeight: 1.6 }}>
            Commission holds for 30 days after each invoice to clear refunds, then the period closes and gets paid.
          </div>
        </Card>
      </div>

      <TableCard title="Request history">
        {requests.length === 0 ? (
          <Empty>No requests yet. Code changes and their decisions show up here.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Requested</th><th style={th}>Change</th>
                <th style={th}>Status</th><th style={th}>Decided</th><th style={th}>Note</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...td, color: THEME.dim2 }}>{shortDate(r.created_at)}</td>
                  <td style={td}>
                    <span style={{ fontFamily: "var(--font-mono)", color: THEME.dim }}>{r.from_code || "—"}</span>
                    <span style={{ color: THEME.dim2 }}> → </span>
                    <span style={{ fontFamily: "var(--font-mono)", color: THEME.cyan }}>{r.to_code}</span>
                  </td>
                  <td style={td}>
                    {r.status === "approved" ? <Pill tone="green">Approved</Pill>
                      : r.status === "rejected" ? <Pill tone="red">Rejected</Pill>
                      : <Pill tone="orange">Pending</Pill>}
                  </td>
                  <td style={{ ...td, color: THEME.dim2 }}>{shortDate(r.decided_at)}</td>
                  <td style={{ ...td, color: THEME.dim }}>{r.decided_note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </Shell>
  );
}
