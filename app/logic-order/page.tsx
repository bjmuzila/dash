"use client";

import { HOME_THEME } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

type Step = { n: number; title: string; body: string };

const STEPS: Step[] = [
  { n: 1, title: "Check the bias", body: "See whether the map leans bullish, bearish, or neutral." },
  { n: 2, title: "Find the Apex Level", body: "The Apex Level is the strongest pull on the map — where options positioning is drawing price." },
  { n: 3, title: "Watch key levels", body: "Support and resistance show where price may hold, reject, or break." },
  { n: 4, title: "Wait for confirmation", body: "FlowMonkey separates active setups from times when waiting is smarter." },
];

function StepCard({ step }: { step: Step }) {
  return (
    <div
      style={{
        flex: "1 1 220px",
        minWidth: 220,
        background: HOME_THEME.panelBg,
        backdropFilter: "blur(16px)",
        border: `1px solid ${HOME_THEME.border}`,
        borderRadius: 16,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: HOME_THEME.green,
          color: HOME_THEME.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 800,
        }}
      >
        {step.n}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: HOME_THEME.text, lineHeight: 1.3 }}>
        {step.title}
      </div>
      <div style={{ fontSize: 14, color: HOME_THEME.text, opacity: 0.7, lineHeight: 1.6 }}>
        {step.body}
      </div>
    </div>
  );
}

export default function LogicOrderPage() {
  return (
    <PageShell>
      <Card
        variant="budget"
        title="Logic & Order"
        subtitle="How to read the map, step by step."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {STEPS.map((s) => (
            <StepCard key={s.n} step={s} />
          ))}
        </div>
      </Card>
    </PageShell>
  );
}
