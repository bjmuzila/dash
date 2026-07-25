"use client";

import { HOME_THEME, LIGHT_BLUE, homeButtonStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";
import SpxHeatmap from "@/components/spx/SpxHeatmap";

/** Placeholder slots — replace each with the real panel as it gets built.
 *  "chain" is now wired up (see the SpxHeatmap card below); remaining slots
 *  are still scaffold. */
const SLOTS = [
  { key: "filters", title: "Filters", note: "Symbol, expiry, strike range." },
  { key: "summary", title: "Summary", note: "IV, OI, volume, put/call." },
];

export default function OptionsPage() {
  return (
    <PageShell>
      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="Options"
        subtitle="Scaffold — panels get wired up here."
      >
        <p style={{ fontSize: 15, color: HOME_THEME.text, lineHeight: 1.6, margin: 0 }}>
          Placeholder page. Drop real panels into the slots below as they come
          online, or add new <code>&lt;Card&gt;</code>s underneath — they stack
          with the shell gap automatically.
        </p>

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ ...homeButtonStyle, padding: "8px 16px" }}>Action</button>
        </div>
      </Card>

      <Card
        variant="budget"
        accent={LIGHT_BLUE}
        title="SPX Heatmap"
        subtitle="2-year daily close · ^GSPC"
      >
        <SpxHeatmap />
      </Card>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "clamp(16px, 2vw, 32px)",
        }}
      >
        {SLOTS.map((slot) => (
          <Card key={slot.key} variant="budget" accent={LIGHT_BLUE} title={slot.title}>
            <div
              style={{
                minHeight: 160,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                border: `1px dashed ${HOME_THEME.border}`,
                borderRadius: 12,
                padding: 16,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: LIGHT_BLUE,
                }}
              >
                Coming soon
              </div>
              <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6, lineHeight: 1.5 }}>
                {slot.note}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
