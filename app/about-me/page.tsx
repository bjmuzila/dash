"use client";

import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

const p: React.CSSProperties = {
  fontSize: 13.5,
  color: HOME_THEME.text,
  lineHeight: 1.75,
  margin: "0 0 14px",
};

const STYLE_TAGS = [
  "Order Flow & Footprint Charts",
  "Delta Analysis",
  "Market Profile & Volume Profile",
  "Options Gamma (GEX) & Dealer Positioning",
  "High-Probability Futures Setups",
  "Rule-Based Execution & Risk Management",
];

const colStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "clamp(16px, 2vw, 24px)",
};

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        backgroundImage: `linear-gradient(90deg, ${HOME_THEME.cyan}, ${HOME_THEME.green})`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        color: HOME_THEME.cyan,
      }}
    >
      {children}
    </span>
  );
}

export default function AboutMePage() {
  return (
    <PageShell maxWidth={1040} align="center">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "clamp(16px, 2vw, 24px)",
          width: "100%",
          alignItems: "stretch",
        }}
      >
        {/* LEFT COLUMN */}
        <div style={colStyle}>
          <Card
            accent="cyan"
            title={<CardTitle>About Me</CardTitle>}
            subtitle="Futures trader, educator, and builder."
          >
            <p style={p}>
              Most traders don&apos;t lose because they lack signals — they lose
              because they lack structure. I build the tools and education that
              fix that. I&apos;m Brandon, a full-time futures trader, educator,
              and entrepreneur focused on order flow, market structure, and
              dealer positioning — the data institutions actually trade on.
            </p>
            <p style={p}>
              Over the years I&apos;ve built trading tools, automated strategies,
              custom indicators, and educational resources that simplify complex
              concepts like delta, gamma exposure (GEX), volume profile, and
              auction market theory into practical trading systems.
            </p>
            <p style={p}>
              I&apos;m the founder of <strong>Bzila Trades</strong>, where I
              provide market analysis, trading education, MotiveWave templates,
              and a Discord community focused on consistency rather than hype. My
              goal has never been to sell unrealistic dreams — it&apos;s to teach
              traders how to think independently, manage risk, and build
              repeatable processes.
            </p>
            <p style={{ ...p, marginBottom: 0 }}>
              Outside of trading, I enjoy building businesses, creating software
              and automation, designing trading tools, and finding ways to make
              complex market data easier to understand.
            </p>
          </Card>

          <Card
            accent="orange"
            title={<CardTitle>Where the Name Comes From</CardTitle>}
            subtitle="CB Edge is named after the two people who matter most."
            style={{ flex: 1 }}
          >
            <p style={p}>
              The <strong>CB</strong> in CB Edge stands for my two sons,{" "}
              <strong>Conor</strong> and <strong>Brennan</strong> — their first
              initials. The <strong>Edge</strong> is the purpose behind the work:
              building something durable and self-sufficient, with their names on
              it.
            </p>
            <p style={{ ...p, marginBottom: 0 }}>
              One of my core beliefs is that financial freedom isn&apos;t about
              expensive cars or luxury watches — it&apos;s about having control
              over your time and the ability to spend it with the people who
              matter most. Everything I build reflects that philosophy.
            </p>
          </Card>
        </div>

        {/* RIGHT COLUMN */}
        <div style={colStyle}>
          <Card
            accent="purple"
            title={<CardTitle>My Trading Style</CardTitle>}
            subtitle="What I trade and how."
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {STYLE_TAGS.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 12.5,
                    color: HOME_THEME.text,
                    lineHeight: 1.4,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid ${HOME_THEME.border}`,
                    background: HOME_THEME.panelBg,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </Card>

          <Card
            accent="green"
            title={<CardTitle>The Philosophy</CardTitle>}
            subtitle="Practical education, honest analysis, real independence."
          >
            <p style={p}>
              Everything I build is designed to help traders become
              self-sufficient rather than dependent on someone else&apos;s
              signals: practical education, honest analysis, and tools that make
              institutional-grade market data easier to understand.
            </p>
            <p style={{ ...p, marginBottom: 0 }}>
              At the end of the day, I&apos;m always looking for ways to improve —
              whether that&apos;s refining a strategy, building better software,
              or helping traders gain confidence through discipline and
              education.
            </p>
          </Card>

          <Card
            accent="cyan"
            title={<CardTitle>Get in Touch</CardTitle>}
            subtitle="Questions or feedback."
            style={{ flex: 1 }}
          >
            <p style={{ ...p, marginBottom: 0 }}>
              Reach me at{" "}
              <a
                href="mailto:support@cbedge.net"
                style={{ color: HOME_THEME.cyan, textDecoration: "none" }}
              >
                support@cbedge.net
              </a>{" "}
              or through the Bzila Trades Discord community.
            </p>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
