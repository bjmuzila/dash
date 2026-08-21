import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Shell from "../components/Shell";
import { Banner, Card, ChipToggle, ErrorNote, Field, Pill } from "../components/ui";
import { useSession } from "../App";
import { api } from "../lib/api";
import { THEME, TYPE, inputStyle, orangeButtonStyle } from "../lib/theme";

/**
 * The application form.
 *
 * SHORT ON PURPOSE. Every extra question is a percentage of applicants who
 * close the tab, and none of the ones we could add change the approve/decline
 * call — that comes down to where their audience is and what they plan to post.
 *
 * The code field checks availability LIVE, debounced, against
 * /api/aff/code-check. Finding out your code was taken after you hit submit is
 * the single most annoying thing this form could do, and it is the one thing it
 * can cheaply prevent.
 *
 * Submitting signs them in immediately as `pending` — see the note in App.tsx.
 */

const CHANNELS = ["X / Twitter", "Discord", "YouTube", "Newsletter", "TikTok / Reels", "Blog / SEO", "Other"] as const;
const AUDIENCE = ["Under 1,000", "1,000 – 10,000", "10,000 – 50,000", "50,000+"] as const;

export default function Apply() {
  const navigate = useNavigate();
  const { affiliate, setAffiliate } = useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [channels, setChannels] = useState<string[]>([]);
  const [primaryLink, setPrimaryLink] = useState("");
  const [audience, setAudience] = useState<string>(AUDIENCE[1]);
  const [plan, setPlan] = useState("");
  const [other, setOther] = useState("");
  const [code, setCode] = useState("");
  const [payout, setPayout] = useState<"stripe" | "paypal" | "zelle">("stripe");
  const [payoutDetail, setPayoutDetail] = useState("");
  const [agree, setAgree] = useState(false);

  const [check, setCheck] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? There is nothing to apply for — send them to whichever
  // dashboard view their status earns.
  useEffect(() => { if (affiliate) navigate("/dashboard", { replace: true }); }, [affiliate, navigate]);

  // Debounced availability check. 300ms is long enough that typing a 9-letter
  // code is one request rather than nine, short enough to feel live.
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!agree) { setErr("You need to accept the affiliate terms."); return; }
    setBusy(true);
    try {
      const j = await api.apply({
        name, email, password,
        channels,
        primary_link: primaryLink,
        audience_size: audience,
        promo_plan: plan,
        other_products: other,
        requested_code: code,
        payout_method: payout,
        payout_detail: payoutDetail,
        // Recorded server-side with a timestamp and the terms version — the
        // checkbox alone is not a record of anything.
        accept_terms: agree,
      });
      setAffiliate(j.affiliate);
      navigate("/dashboard", { replace: true });
    } catch (e2) {
      setErr(String((e2 as Error).message || e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form onSubmit={submit}>
        <Card>
          <div style={{ fontSize: TYPE.micro, letterSpacing: "0.16em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700 }}>
            Affiliate application
          </div>
          <h1 style={{ margin: "10px 0 6px", fontSize: 24, letterSpacing: "-0.02em" }}>Request your code</h1>
          <p style={{ margin: "0 0 24px", fontSize: 13, color: THEME.dim }}>
            Reviewed by hand. You'll hear either way, usually within 24 hours.
          </p>

          <div style={{ display: "grid", gap: "0 18px", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <Field label="Full name">
              <input required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Your name" />
            </Field>
            <Field label="Email">
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="you@example.com" />
            </Field>
          </div>

          <Field label="Password" hint="At least 10 characters. This is how you get back into your dashboard.">
            <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="••••••••••" />
          </Field>

          <Field label="Where will you promote CB Edge?">
            <ChipToggle options={CHANNELS} value={channels} onChange={setChannels} />
          </Field>

          <div style={{ display: "grid", gap: "0 18px", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <Field label="Primary channel link">
              <input value={primaryLink} onChange={(e) => setPrimaryLink(e.target.value)} style={inputStyle} placeholder="x.com/yourhandle" />
            </Field>
            <Field label="Audience size">
              <select value={audience} onChange={(e) => setAudience(e.target.value)} style={inputStyle}>
                {AUDIENCE.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </div>

          <Field label="How do you plan to promote it?">
            <textarea
              value={plan} onChange={(e) => setPlan(e.target.value)} rows={4}
              style={{ ...inputStyle, resize: "vertical", minHeight: 88 }}
              placeholder="A couple of sentences is plenty — what you'd post, where, and how often."
            />
          </Field>

          <Field label="Do you promote other trading products? (optional)">
            <input value={other} onChange={(e) => setOther(e.target.value)} style={inputStyle} placeholder="Anything we should know about" />
          </Field>

          <div style={{ height: 1, background: THEME.border, margin: "18px 0" }} />

          <Field
            label="Requested code"
            hint={
              <>4–16 characters, letters and numbers. Customers type this at checkout, and your link becomes{" "}
                <span style={{ color: THEME.cyan, fontFamily: "var(--font-mono)" }}>
                  affiliate.cbedge.net/r/{code || "YOURCODE"}
                </span>
              </>
            }
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16))}
                style={{ ...inputStyle, flex: 1, minWidth: 200, letterSpacing: "0.1em", fontWeight: 700, fontFamily: "var(--font-mono)" }}
                placeholder="YOURCODE"
              />
              {check && (check.ok ? <Pill tone="green">Available</Pill> : <Pill tone="red">Taken</Pill>)}
            </div>
            {check && !check.ok && check.reason && (
              <div style={{ marginTop: 6, fontSize: 11, color: THEME.softRed }}>{check.reason}</div>
            )}
          </Field>

          <Field label="Payout method">
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))" }}>
              {(["stripe", "paypal", "zelle"] as const).map((m) => (
                <button
                  key={m} type="button" onClick={() => setPayout(m)}
                  style={{
                    padding: "10px 12px", borderRadius: 8, cursor: "pointer", fontSize: TYPE.label, fontWeight: 600,
                    border: `1px solid ${payout === m ? "rgba(33,158,188,0.35)" : THEME.border}`,
                    background: payout === m ? "rgba(33,158,188,0.10)" : "rgba(255,255,255,0.03)",
                    color: payout === m ? THEME.cyan : THEME.dim,
                  }}
                >{m === "stripe" ? "Stripe" : m === "paypal" ? "PayPal" : "Zelle"}</button>
              ))}
            </div>
          </Field>

          {payout !== "stripe" && (
            <Field
              label={payout === "paypal" ? "PayPal email" : "Zelle email or phone"}
              hint={payout === "zelle" ? "Zelle is US bank accounts only. Use whichever email or phone your bank has enrolled." : undefined}
            >
              <input
                required
                value={payoutDetail}
                onChange={(e) => setPayoutDetail(e.target.value)}
                style={inputStyle}
                placeholder={payout === "paypal" ? "you@example.com" : "you@example.com or (555) 555-5555"}
              />
            </Field>
          )}
          {payout === "stripe" && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="cyan">
                <Pill tone="cyan">Stripe</Pill>
                <span>You'll get a Stripe onboarding link once you're approved — nothing to enter here now.</span>
              </Banner>
            </div>
          )}

          <div style={{ margin: "20px 0" }}>
            <Banner tone="cyan">
              <Pill tone="cyan">Terms</Pill>
              <span>
                The short version: no paid search on CB Edge brand terms, no guaranteed-return or performance
                claims, no impersonating CB Edge, and you disclose that you earn a commission. Commission is paid
                on collected revenue after the 30-day holding window.{" "}
                <Link to="/terms" style={{ color: THEME.cyan, textDecoration: "underline" }}>Read the full terms →</Link>
              </span>
            </Banner>
          </div>

          <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, color: THEME.dim, cursor: "pointer", marginBottom: 18 }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ accentColor: THEME.cyan, marginTop: 2 }} />
            <span>
              I've read and accept the{" "}
              <Link to="/terms" style={{ color: THEME.cyan, textDecoration: "underline" }}>affiliate program terms</Link>.
            </span>
          </label>

          {err && <div style={{ marginBottom: 14 }}><ErrorNote>{err}</ErrorNote></div>}

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={busy || (check ? !check.ok : false)}
              style={{ ...orangeButtonStyle, padding: "12px 22px", fontSize: 11, borderRadius: 8, opacity: busy ? 0.6 : 1 }}
            >{busy ? "Submitting…" : "Submit application"}</button>
            <span style={{ fontSize: 11.5, color: THEME.dim2 }}>
              Already applied? <Link to="/login" style={{ color: THEME.cyan }}>Sign in</Link>
            </span>
          </div>
        </Card>
      </form>
    </Shell>
  );
}
