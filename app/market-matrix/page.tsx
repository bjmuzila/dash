"use client";

import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type Tone = "bull" | "transition" | "bear";

const TONE: Record<Tone, string> = {
  bull: HOME_THEME.green,
  transition: HOME_THEME.orange,
  bear: HOME_THEME.red,
};

const COLS = [
  { key: "incline", label: "Inclining", arrow: "↗", tone: "bull" as Tone },
  { key: "flat", label: "Flat", arrow: "→", tone: "transition" as Tone },
  { key: "decline", label: "Declining", arrow: "↘", tone: "bear" as Tone },
];

const ROWS: {
  label: string;
  sub: string;
  cells: { title: string; tone: Tone }[];
}[] = [
  {
    label: "SPX Above Flip",
    sub: "Positive Gamma",
    cells: [
      { title: "Bull Strong", tone: "bull" },
      { title: "Potential Transition", tone: "transition" },
      { title: "Bull Weak", tone: "bull" },
    ],
  },
  {
    label: "SPX Below Flip",
    sub: "Negative Gamma",
    cells: [
      { title: "Bear Weak", tone: "bear" },
      { title: "Potential Transition", tone: "transition" },
      { title: "Bear Strong", tone: "bear" },
    ],
  },
];

function Cell({ title, tone }: { title: string; tone: Tone }) {
  const c = TONE[tone];
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 14,
        border: `1px solid ${HOME_THEME.border}`,
        borderLeft: `4px solid ${c}`,
        background: HOME_THEME.panelBg,
        padding: "34px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 120,
        textAlign: "center",
      }}
    >
      <span
        style={{
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          color: c,
          lineHeight: 1.15,
        }}
      >
        {title}
      </span>
    </div>
  );
}

export default function MarketMatrixPage() {
  const grid = "180px repeat(3, 1fr)";
  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Market Conditions Matrix"
        subtitle="Gamma Regime × Directional Momentum"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "end" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: HOME_THEME.green,
                textAlign: "center",
                paddingBottom: 4,
              }}
            >
              NASDAQ 10 DMA Slope
            </div>
            {COLS.map((col) => (
              <div key={col.key} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, color: TONE[col.tone], lineHeight: 1 }}>{col.arrow}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: HOME_THEME.text,
                  }}
                >
                  {col.label}
                </div>
              </div>
            ))}
          </div>

          {/* Rows */}
          {ROWS.map((row) => (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: grid, gap: 16, alignItems: "stretch" }}>
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: HOME_THEME.text,
                  }}
                >
                  {row.label}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: HOME_THEME.green,
                  }}
                >
                  {row.sub}
                </div>
              </div>
              {row.cells.map((cell, i) => (
                <Cell key={i} title={cell.title} tone={cell.tone} />
              ))}
            </div>
          ))}

          {/* Legend */}
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 24,
              borderTop: `1px solid ${HOME_THEME.border}`,
              paddingTop: 16,
            }}
          >
            {[
              { k: "Input 01", t: "Gamma Regime", d: "SPX above or below the gamma flip line." },
              { k: "Input 02", t: "Trend Momentum", d: "Slope of the 10 DMA." },
              { k: "Output", t: "Six Regimes", d: "Each regime maps to its own strategy & sizing playbook." },
            ].map((x) => (
              <div key={x.k}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: HOME_THEME.green }}>
                  {x.k}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.text, marginTop: 4 }}>
                  {x.t}
                </div>
                <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.6, marginTop: 4, lineHeight: 1.5 }}>
                  {x.d}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}
