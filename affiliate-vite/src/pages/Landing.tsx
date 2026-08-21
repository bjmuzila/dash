import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import { Card } from "../components/ui";
import { THEME, TYPE, rgba, RATE_PCT, buttonStyle, orangeButtonStyle, secondaryButtonStyle, cardStyle } from "../lib/theme";

/**
 * The public landing page — the only screen most visitors will ever see.
 *
 * Everything above the fold answers the two questions somebody deciding whether
 * to promote a product actually has: what am I sending people to, and what do I
 * make. The platform tour and the FAQ come after, because they only matter to
 * someone already interested.
 *
 * ONE RATE, NOT A LADDER. There are no tiers — 20% for everybody. See the note
 * on RATE_PCT in server-v2/_lib-affiliate.cjs for why.
 *
 * WHERE COLOUR IS ALLOWED HERE. Cards still carry no accent — no tinted border,
 * no gloss. Colour lives in the CONTENT: each of the four platform features owns
 * a hue and a small inline SVG drawn in it, and the commission facts each take a
 * different one. That is colour as identity, which reads; a tinted card edge is
 * colour as decoration, which just makes six panels look like one gradient. The
 * first version of this page had neither, and it read as a wall of grey.
 *
 * Static by design. No API call, no session wait, nothing to fail — this page
 * has to render for a cold visitor with no cookie even if the backend is down.
 * RATE_PCT is mirrored in lib/theme.ts for exactly that reason; the server stays
 * authoritative for anything that pays money.
 */

const STEPS = [
  { n: 1, h: "Apply", p: "Six questions, two minutes. Tell us where your audience lives and pick the code you want." },
  { n: 2, h: "Get approved", p: "Reviewed by hand — usually within 24 hours. Approval issues your code and switches your dashboard on." },
  { n: 3, h: "Share", p: "Your dashboard hands you ready-made posts with renders of the terminal, already stamped with your code." },
  { n: 4, h: "Get paid", p: "Commission accrues per paid invoice. Cleared after the refund window, then paid by Stripe, PayPal or Zelle." },
];

const FAQ: [string, string][] = [
  ["How is a sale attributed to me?", "Either your code was entered at checkout, or someone clicked your link inside the 60-day cookie window. Code entered at checkout always wins over a cookie."],
  ["Is it really 20% on everything?", "Yes — one rate, no tiers, no volume ladder to climb. 20% of what the customer actually pays, on the first invoice and on every renewal."],
  ["Is it recurring?", "Yes. You earn on the first invoice and on every renewal while that member stays subscribed, at the rate locked in when they signed up."],
  ["Can I change my code later?", "You can request a change from your dashboard. It goes through approval, and your old code keeps working for 30 days so links already posted don't break."],
  ["When do I get paid?", "Commission holds for 30 days to clear refunds, then the period closes and payout goes out by Stripe, PayPal or Zelle."],
  ["Can I run paid ads on the brand?", "No bidding on “CB Edge” or misspellings of it. Organic, content and community promotion only."],
  ["What happens if a referral refunds?", "That commission is reversed. It only ever affects money still holding — nothing already paid to you is clawed back."],
  ["Do I need to be a CB Edge subscriber?", "No. Plenty of affiliates aren't. Your affiliate login is its own account, separate from any subscription."],
];

// ── Feature marks ────────────────────────────────────────────────────────────
// Tiny inline SVGs, one per platform feature, each in its own hue. They exist to
// break up four paragraphs that otherwise render as one grey block — and because
// a picture of a dealer-wall ladder says more about the product to a trader than
// the sentence next to it does.
const MARK_W = 76, MARK_H = 52;

function HeatMark() {
  const rows: [number, string][] = [
    [0.30, THEME.call], [0.72, THEME.call], [0.95, THEME.gold], [0.48, THEME.put], [0.80, THEME.put],
  ];
  return (
    <svg width={MARK_W} height={MARK_H} viewBox={`0 0 ${MARK_W} ${MARK_H}`} aria-hidden="true">
      {rows.map(([v, c], i) => (
        <rect key={i} x="0" y={i * 10 + 2} width={MARK_W * v} height="7" rx="2" fill={c} opacity={0.9} />
      ))}
    </svg>
  );
}

function CandleMark() {
  const bars: [number, number, number, number][] = [
    [30, 44, 24, 40], [40, 46, 32, 34], [34, 48, 30, 46], [46, 52, 40, 50], [50, 51, 36, 38], [38, 50, 34, 48],
  ];
  const y = (v: number) => MARK_H - (v / 56) * MARK_H;
  return (
    <svg width={MARK_W} height={MARK_H} viewBox={`0 0 ${MARK_W} ${MARK_H}`} aria-hidden="true">
      {bars.map(([o, h, l, c], i) => {
        const cx = 6 + i * 12;
        const col = c >= o ? THEME.up : THEME.down;
        return (
          <g key={i}>
            <line x1={cx} y1={y(h)} x2={cx} y2={y(l)} stroke={col} strokeWidth="1.5" />
            <rect x={cx - 3.5} y={y(Math.max(o, c))} width="7" height={Math.max(2, Math.abs(y(o) - y(c)))} fill={col} rx="1" />
          </g>
        );
      })}
    </svg>
  );
}

function ChainMark() {
  return (
    <svg width={MARK_W} height={MARK_H} viewBox={`0 0 ${MARK_W} ${MARK_H}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((r) => (
        <g key={r} opacity={r === 2 ? 1 : 0.5}>
          <rect x="0" y={r * 10 + 3} width="20" height="6" rx="2" fill={THEME.lightBlue} />
          <rect x="26" y={r * 10 + 3} width="14" height="6" rx="2" fill={THEME.up} opacity="0.75" />
          <rect x="46" y={r * 10 + 3} width="14" height="6" rx="2" fill={THEME.down} opacity="0.75" />
        </g>
      ))}
    </svg>
  );
}

function PhoneMark() {
  return (
    <svg width={MARK_W} height={MARK_H} viewBox={`0 0 ${MARK_W} ${MARK_H}`} aria-hidden="true">
      <rect x="26" y="1" width="24" height="50" rx="6" fill="none" stroke={THEME.orange} strokeWidth="1.6" />
      <rect x="34" y="4" width="8" height="2" rx="1" fill={THEME.orange} opacity="0.7" />
      {[0, 1, 2, 3].map((r) => (
        <rect key={r} x="30" y={11 + r * 8} width={16 - r * 3} height="4" rx="1.5" fill={THEME.orange} opacity={0.85 - r * 0.15} />
      ))}
      <rect x="30" y="44" width="16" height="3" rx="1.5" fill={THEME.orange} opacity="0.35" />
      <rect x="30" y="44" width="5" height="3" rx="1.5" fill={THEME.orange} />
    </svg>
  );
}

const FEATURES = [
  {
    hue: THEME.cyan, Mark: HeatMark,
    h: "GEX heatmap & dealer walls",
    p: "Core Bullseye, Call Wall and Put Wall by strike, updating live off the same socket the desk reads.",
  },
  {
    hue: THEME.up, Mark: CandleMark,
    h: "ES candles + estimated moves",
    p: "Overnight ES against SPX levels, with the daily expected-move band drawn straight on the chart.",
  },
  {
    hue: THEME.lightBlue, Mark: ChainMark,
    h: "Options chain, flow & scanner",
    p: "Full chain with greeks, whale prints as they cross, and a scanner tuned for 0DTE.",
  },
  {
    hue: THEME.orange, Mark: PhoneMark,
    h: "A real phone build",
    p: "Purpose-built iPhone pages, not a squeezed desktop. Members open it at the bell.",
  },
];

// The four facts that actually decide whether the deal is worth taking.
const TERMS = [
  { v: "Recurring", l: "Every renewal, not just the first sale", c: THEME.lightBlue },
  { v: "60 days", l: "Cookie window on your link", c: THEME.up },
  { v: "No cap", l: "No ceiling, no volume ladder", c: THEME.gold },
  { v: "Monthly", l: "Paid by Stripe, PayPal or Zelle", c: THEME.orange },
];

export default function Landing() {
  return (
    <Shell wide>
      {/* Hero. The one deliberately tinted surface on the page — it earns it by
          being the single focal point rather than a repeated card. */}
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
          options chain and order flow, streaming off one socket. Share your code and earn{" "}
          <b style={{ color: "#fff" }}>{RATE_PCT}% of every payment</b> it brings in, for as long as that member stays.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 26, flexWrap: "wrap" }}>
          <Link to="/apply" style={{ ...orangeButtonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
            Apply for a code →
          </Link>
          <a href="https://cbedge.net" style={{ ...secondaryButtonStyle, display: "inline-block", padding: "12px 22px", fontSize: 11, borderRadius: 8 }}>
            See the platform
          </a>
        </div>
      </div>

      {/* How it works. Each step number takes the hue of the feature family it
          belongs to, so the row is not four identical grey chips. */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {STEPS.map((s, i) => {
          const hue = [THEME.cyan, THEME.lightBlue, THEME.gold, THEME.up][i];
          return (
            <div key={s.n} className="card-hover" style={{ ...cardStyle, padding: 18 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center",
                fontSize: 12, fontWeight: 800, background: rgba(hue, 0.14),
                border: `1px solid ${rgba(hue, 0.32)}`, color: hue,
              }}>{s.n}</div>
              <h4 style={{ margin: "12px 0 6px", fontSize: TYPE.body, fontWeight: 700 }}>{s.h}</h4>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: THEME.dim }}>{s.p}</p>
            </div>
          );
        })}
      </div>

      {/* The offer. One rate, so it gets one panel and all the size — the three
          tier cards this replaced spent the whole row saying "it depends". */}
      <div className="card-hover" style={{
        ...cardStyle, display: "grid", gap: "clamp(20px,3vw,40px)",
        gridTemplateColumns: "minmax(240px,0.8fr) minmax(280px,1.2fr)",
        alignItems: "center", padding: "clamp(24px,3vw,36px)",
      }}>
        <div>
          <div style={{ fontSize: TYPE.micro, letterSpacing: "0.16em", textTransform: "uppercase", color: THEME.dim2, fontWeight: 700 }}>
            Commission
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <span style={{
              fontSize: "clamp(56px,9vw,92px)", lineHeight: 0.9, fontWeight: 800, letterSpacing: "-0.05em",
              background: `linear-gradient(140deg, ${THEME.cyan}, ${THEME.lightBlue} 45%, ${THEME.orange})`,
              WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            }}>{RATE_PCT}%</span>
            <span style={{ fontSize: 15, color: THEME.dim, fontWeight: 600 }}>flat</span>
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 13.5, lineHeight: 1.6, color: THEME.dim, maxWidth: "34ch" }}>
            Of every payment a member on your code makes — the first one and every renewal after it.
            The same rate for everyone, from day one. No tiers, nothing to unlock.
          </p>
        </div>

        {/* minmax(min(100%,240px)) rather than a bare 240px: it pins this to a
            2x2 at the width the panel actually gets, and still collapses to one
            column on a phone instead of overflowing. A 4-across row wrapped
            every label onto three lines. */}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))" }}>
          {TERMS.map((t) => (
            <div key={t.v} style={{
              padding: "14px 15px", borderRadius: 12,
              border: `1px solid ${THEME.border}`, background: "rgba(255,255,255,0.02)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.c, boxShadow: `0 0 8px ${rgba(t.c, 0.8)}` }} />
                <b style={{ fontSize: 15, color: t.c, letterSpacing: "-0.01em" }}>{t.v}</b>
              </div>
              <div style={{ fontSize: 11.5, color: THEME.dim2, marginTop: 6, lineHeight: 1.45 }}>{t.l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* What they're promoting. Four tiles across, each with its own mark and
          hue — this used to be a single tall card of four paragraphs sitting
          next to a much taller FAQ, which left a third of the row empty. */}
      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
          color: THEME.dim, marginBottom: 12,
        }}>What you're actually promoting</div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
          {FEATURES.map(({ hue, Mark, h, p }) => (
            <div key={h} className="card-hover" style={{ ...cardStyle, padding: 18, display: "flex", flexDirection: "column" }}>
              <div style={{
                height: 62, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 10, background: rgba(hue, 0.06), marginBottom: 14,
              }}>
                <Mark />
              </div>
              <b style={{ fontSize: 13.5, color: hue }}>{h}</b>
              <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55, color: THEME.dim }}>{p}</p>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ, full width and two columns — it was the tall half of a lopsided
          pair and is long enough to deserve the whole row. */}
      {/* Exactly TWO columns on any desktop width, one on a phone. The divider
          below keys off `i % 2`, so a grid that silently becomes three or four
          columns puts vertical rules down the middle of nowhere — which is what
          minmax(320px) did at 1360. */}
      <Card title="FAQ" padding={0}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,560px),1fr))" }}>
          {FAQ.map(([q, a], i) => (
            <div key={q} style={{
              padding: "16px 18px",
              // No rule under the last ROW (the final pair) — it would draw a
              // second line right on top of the card's own bottom edge.
              borderBottom: i >= FAQ.length - 2 ? "none" : "1px solid rgba(255,255,255,0.05)",
              borderRight: i % 2 === 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
            }}>
              <b style={{ display: "block", fontSize: 13.5, marginBottom: 6 }}>{q}</b>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: THEME.dim }}>{a}</p>
            </div>
          ))}
        </div>
      </Card>

      <div style={{
        borderRadius: 22, border: `1px solid ${THEME.border}`, padding: 34, textAlign: "center",
        background: `radial-gradient(circle at 50% -10%, ${rgba(THEME.orange, 0.10)} 0%, transparent 62%), ${THEME.panelBgStrong}`,
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
