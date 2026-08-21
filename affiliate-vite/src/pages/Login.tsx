import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Shell from "../components/Shell";
import { Card, ErrorNote, Field } from "../components/ui";
import { useSession } from "../App";
import { api } from "../lib/api";
import { THEME, TYPE, inputStyle, buttonStyle } from "../lib/theme";

/**
 * Affiliate sign-in. Its own credential, not a CB Edge customer login — see the
 * header comment in server-v2/_lib-affiliate.cjs for why the two identities are
 * deliberately unrelated.
 *
 * There is no "forgot password" yet, and the copy says so rather than showing a
 * link that goes nowhere. Emailing the owner is a real answer for a program
 * with tens of affiliates; a broken reset flow is not.
 */
export default function Login() {
  const navigate = useNavigate();
  const { affiliate, setAffiliate } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (affiliate) navigate("/dashboard", { replace: true }); }, [affiliate, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const j = await api.login(email, password);
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
      <div style={{ maxWidth: 440, width: "100%", marginInline: "auto" }}>
        <form onSubmit={submit}>
          <Card>
            <h1 style={{ margin: "0 0 6px", fontSize: 22, letterSpacing: "-0.02em" }}>Affiliate sign in</h1>
            <p style={{ margin: "0 0 22px", fontSize: 13, color: THEME.dim }}>
              Your stats, your code and your payouts.
            </p>

            <Field label="Email">
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" />
            </Field>
            <Field label="Password">
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
            </Field>

            {err && <div style={{ marginBottom: 14 }}><ErrorNote>{err}</ErrorNote></div>}

            <button
              type="submit" disabled={busy}
              style={{ ...buttonStyle, width: "100%", padding: "12px", fontSize: 11, borderRadius: 8, opacity: busy ? 0.6 : 1 }}
            >{busy ? "Signing in…" : "Sign in"}</button>

            <div style={{ marginTop: 16, fontSize: TYPE.label, color: THEME.dim2, lineHeight: 1.6 }}>
              Not an affiliate yet? <Link to="/apply" style={{ color: THEME.cyan }}>Apply for a code</Link>.
              <br />
              Locked out? Email <span style={{ color: THEME.dim }}>affiliates@cbedge.net</span> and we'll reset it by hand.
            </div>
          </Card>
        </form>
      </div>
    </Shell>
  );
}
