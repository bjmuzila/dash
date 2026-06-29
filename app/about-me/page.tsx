"use client";

import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

const p: React.CSSProperties = {
  fontSize: 13,
  color: HOME_THEME.text,
  lineHeight: 1.7,
  margin: "0 0 12px",
};

export default function AboutMePage() {
  return (
    <PageShell maxWidth={760} align="center">
      <Card accent="cyan" title="About Me" subtitle="The person behind CB Edge.">
        <p style={p}>
          I&apos;m Brandon — a trader focused on SPX/index options, gamma
          exposure, and the order-flow that actually moves price. CB Edge grew
          out of the tools I built for my own desk: live GEX, expected-move
          levels, confidence scoring, and the dashboards I check every morning
          before the bell.
        </p>
        <p style={{ ...p, marginBottom: 0 }}>
          Everything here is built to do one thing — turn raw options data into
          a real, usable edge.
        </p>
      </Card>

      <Card
        accent="orange"
        title="Where the name comes from"
        subtitle="CB isn&apos;t a ticker."
      >
        <p style={p}>
          The <strong>CB</strong> in CB Edge is for my two sons —{" "}
          <strong>C</strong>onor and <strong>B</strong>rennan. Their first
          initials.
        </p>
        <p style={{ ...p, marginBottom: 0 }}>
          The <strong>Edge</strong> is what the work is for: building something
          that lasts, with their names on it. Every feature on this dashboard
          carries that signature.
        </p>
      </Card>

      <Card
        accent="purple"
        title="What the dashboard does"
        subtitle="The CB Edge toolkit."
      >
        <p style={p}>
          CB Edge is a real-time options analytics platform centered on SPX and
          major indices. The core surfaces include:
        </p>
        <ul
          style={{
            fontSize: 13,
            color: HOME_THEME.text,
            lineHeight: 1.8,
            margin: 0,
            paddingLeft: 18,
          }}
        >
          <li>
            <strong>Net GEX &amp; heatmaps</strong> — gamma exposure by strike,
            call/put/flip walls, and the levels price tends to respect.
          </li>
          <li>
            <strong>Estimated Moves</strong> — weekly expected-move ranges and
            customer levels across hundreds of tickers.
          </li>
          <li>
            <strong>Confidence Score</strong> — a 0–100 read on whether a level
            is likely to hit, pivot, or chop.
          </li>
          <li>
            <strong>Live flow &amp; ES candles</strong> — net-premium tape,
            order flow, and 5-minute futures context.
          </li>
          <li>
            <strong>Morning dashboard</strong> — schedule, key drivers, futures,
            and an AI overview to start the session.
          </li>
        </ul>
      </Card>

      <Card accent="green" title="Get in touch" subtitle="Questions or feedback.">
        <p style={{ ...p, marginBottom: 0 }}>
          Reach me at{" "}
          <a
            href="mailto:bjmuzila@gmail.com"
            style={{ color: HOME_THEME.cyan, textDecoration: "none" }}
          >
            bjmuzila@gmail.com
          </a>
          . The subscriber chat is also open inside the dashboard if you want to
          talk through a setup or a level.
        </p>
      </Card>
    </PageShell>
  );
}
