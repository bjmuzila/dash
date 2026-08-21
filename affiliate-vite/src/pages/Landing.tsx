import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import { Card } from "../components/ui";
import { THEME, TYPE, rgba, PUBLIC_TIERS, buttonStyle, orangeButtonStyle, secondaryButtonStyle, cardStyle } from "../lib/theme";

/**
 * The public landing page — the only screen most visitors will ever see.
 *
 * Everything above the fold answers the two questions somebody deciding whether
 * to promote a product actually has: what am I sending people to, and what do I
 * make. Social proof, the platform tour and the FAQ come after, because they
 * only matter to someone already interested.
 *
 * Static by design. No API call, no session wait, nothing to fail — this page
 * has to render for a cold visitor with no cookie even if the backend is down.
 * The tier numbers are mirrored in lib/theme.ts for exactly that reason; the
 * server stays authoritative for anything that pays money.
 */

const STEPS = [
  { n: 1, h: "Apply", p: "Six questions, two minutes. Tell us where your audience lives and pick the code you want." },
  { n: 2, h: "Get approved", p: "Reviewed by hand — usually within 24 hours. Approval locks in your code and your tier." },
  { n: 3, h: "Share", p: "Your dashboard hands you ready-made posts with live renders of the terminal. Post, don't design." },
  { n: 4, h: "Get paid", p: "Commission accrues per paid invoice. Cleared after the refund window, then paid by Stripe, PayPal or Zelle." },
];

const PLATFORM = [
  ["GEX heatmap & dealer walls", "Core Bullseye, Call Wall, Put Wall by strike, updating live off the same socket the desk reads."],
  ["ES candles + estimated moves", "Overnight ES against SPX levels, with the daily EM band drawn on."],
  ["Options chain, flow & scanner", "Full chain with greeks, whale prints, and a scanner tuned for 0DTE."],
  ["A real phone build", "Purpose-built iPhone pages, not a squeezed desktop. Members open it at the open."],
];

const FAQ = [
  ["How is a sale attributed to me?", "Either your code was entered at checkout, or someone clicked your link inside the cookie window. Code entered at checkout always wins over a cookie."],
  ["Is it recurring?", "Yes. You earn on the first invoice and on every renewal while that member stays subscribed, at the rate locked in when they signed up."],
  ["Can I change my code later?", "You can request a change from your dashboard. It goes through approval, and your old code keeps working for 30 days so links already posted don't break."],
  ["When do I get paid?", "Commission holds for 30 days to clear refunds, then the period closes and payout goes out by Stripe, PayPal or Zelle."],
  ["Can I run paid ads on the brand?", "No bidding on “CB Edge” or misspellings of it. Organic, content and community promotion only."],
  ["What happens if a referral refunds?", "That commission is reversed. It only ever affects money still holding — nothing already paid to you is clawed back."],
];

export default function Landing() {
  return (
    <Shell wide>
      {/* Hero. The one place on this site with a tinted surface, and it earns it
          by being the page's single focal point rather than a repeated card. */}
      <div style={{
        position: "relative", overflow: "hidden", borderRadius: 22,
        border: `1px solid ${THEME.border}`,
        background: `radial-gradient(circle at 50% -10%, ${rgba(THEME.cyan, 0.16)} 0%, transparent 62%), ${THEME.panelBgStrong}`,
        padding: "clamp(30px,5vw,64px) clamp(20px,4vw,54px)", textAlign: "center",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 11px", borderRadius: 999,
          fontSize: TYPE.micro, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          color: THEME.cyan, border: `1px solid ${rgba(THEME.cyan, 0.35)}`, background: rgba(THEME.cyan, 0.10),
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: THEME.cyan, boxShadow: `0 0 8px ${THEME.cyan}` }} />
          Applications open
        </span>
        <h1 style={{ margin: "14px 0 0", fontSize: "clamp(30px,5vw,52px)", lineHeight: 1.06, letterSpacing: "-0.03em", fontWeight: 800 }}>
          Get paid to send traders<br />to{" "}
          <span style={{
            background: `linear-gradient(100deg, ${THEME.cyan}, ${THEME.lightBlue}, ${THEME.orange})`,
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>real options flow</span>.
        </h1>
        <p style={{ margin: "16px auto 0", maxWidth: "64ch", fontSize: 15, lineHeight: 1.65, color: THEME.dim }}>
          CB Edge is a live SPX / ES gamma-exposure terminal — GEX heatmaps, dealer walls, estimated moves,
          options chain and order flow, streaming off one socket. Share your code, earn up to 20% of every
          subscription it brings in, for as long as that member stays.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 26, flexWrap: "wrap" }}>
          <Link to="/apply" style={{ ...orangeButtonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
            Apply for a code →
          </Link>
          <a href="https://cbedge.net" style={{ ...secondaryButtonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
            See the platform
          </a>
        </div>
        <div style={{ display: "flex", gap: 32, justifyContent: "center", marginTop: 34, flexWrap: "wrap" }}>
          {[
            ["20%", "Max commission", THEME.cyan],
            ["Recurring", "Not one-off", THEME.lightBlue],
            ["60 days", "Cookie window", THEME.green],
            ["Monthly", "Payout cycle", THEME.orange],
          ].map(([v, l, c]) => (
            <div key={l as string} style={{ textAlign: "center" }}>
              <b style={{ display: "block", fontSize: 22, fontWeight: 700, color: c as string }}>{v}</b>
              <span style={{ fontSize: TYPE.micro, letterSpacing: "0.13em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700 }}>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {STEPS.map((s) => (
          <div key={s.n} className="card-hover" style={{ ...cardStyle, padding: 18 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center",
              fontSize: 11, fontWeight: 800, background: rgba(THEME.cyan, 0.14),
              border: `1px solid ${rgba(THEME.cyan, 0.3)}`, color: THEME.cyan,
            }}>{s.n}</div>
            <h4 style={{ margin: "12px 0 6px", fontSize: TYPE.body, fontWeight: 700 }}>{s.h}</h4>
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: THEME.dim }}>{s.p}</p>
          </div>
        ))}
      </div>

      {/* Tiers */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {PUBLIC_TIERS.map((t) => (
          <div key={t.pct} className="card-hover" style={{ ...cardStyle, padding: 20, textAlign: "center" }}>
            <div style={{
              fontSize: 34, fontWeight: 800, letterSpacing: "-0.03em",
              color: t.pct === 20 ? THEME.orange : t.pct === 15 ? THEME.lightBlue : THEME.cyan,
            }}>{t.pct}%</div>
            <div style={{ fontSize: TYPE.micro, letterSpacing: "0.14em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700, marginTop: 6 }}>
              {t.label}
            </div>
            <div style={{ fontSize: 12.5, color: THEME.dim, marginTop: 10, lineHeight: 1.5 }}>{t.blurb}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <Card title="What you're actually promoting">
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {PLATFORM.map(([h, p]) => (
              <div key={h}>
                <b style={{ fontSize: 13 }}>{h}</b>
                <div style={{ fontSize: 12.5, marginTop: 4, lineHeight: 1.55, color: THEME.dim }}>{p}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="FAQ" padding={0}>
          {FAQ.map(([q, a], i) => (
            <div key={q} style={{
              padding: "16px 18px",
              borderBottom: i === FAQ.length - 1 ? "none" : "1px solid rgba(255,255,255,0.05)",
            }}>
              <b style={{ display: "block", fontSize: 13.5, marginBottom: 6 }}>{q}</b>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: THEME.dim }}>{a}</p>
            </div>
          ))}
        </Card>
      </div>

      <div style={{
        borderRadius: 22, border: `1px solid ${THEME.border}`, padding: 34, textAlign: "center",
        background: `radial-gradient(circle at 50% -10%, ${rgba(THEME.cyan, 0.12)} 0%, transparent 62%), ${THEME.panelBgStrong}`,
      }}>
        <h2 style={{ margin: 0, fontSize: "clamp(22px,3vw,32px)", letterSpacing: "-0.02em" }}>
          Ready to <span style={{ color: THEME.orange }}>request your code</span>?
        </h2>
        <p style={{ margin: "12px 0 0", fontSize: TYPE.body, color: THEME.dim }}>
          Two minutes to apply. Manual review, usually the same day.
        </p>
        <div style={{ marginTop: 22 }}>
          <Link to="/apply" style={{ ...buttonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
            Start application →
          </Link>
        </div>
      </div>
    </Shell>
  );
}
