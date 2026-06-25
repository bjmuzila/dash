"use client";

import { type ReactNode } from "react";
import {
  HOME_THEME,
  homeContentStyle,
  homeHeaderStyle,
  homePanelStyle,
  homeShellStyle,
} from "@/components/shared/homeTheme";

// Source pages this strategy view will eventually pull from. Stubbed for now —
// each section is a placeholder that the real data wiring will replace.
type Section = { id: string; label: string; from: string; note: string };

const SECTIONS: Section[] = [
  { id: "mult-greek", label: "Multi Greek", from: "/mult-greek", note: "Net DEX/GEX/CHEX/VEX regime + greek-flow direction." },
  { id: "options-chain", label: "Options Chain", from: "/options-chain", note: "Live chain OI/vol, call/put walls, GEX flip." },
  { id: "estimated-moves", label: "Estimated Moves", from: "/em", note: "Expected move bands + key levels per ticker." },
  { id: "es-candles", label: "ES Candles", from: "/es-candles", note: "Price action, volume profile (POC/VAH/VAL), session H/L." },
  { id: "premarket", label: "Premarket", from: "/premarket", note: "Overnight range, gap context, premarket movers." },
  { id: "economic-calendar", label: "Economic Calendar", from: "/economic-calendar", note: "Scheduled catalysts + event-risk windows." },
  { id: "journal", label: "Journal", from: "/trading", note: "Trade log, past outcomes, what worked." },
];

function SectionCard({ s, children }: { s: Section; children?: ReactNode }) {
  return (
    <div style={{ ...homePanelStyle, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>
          {s.label}
        </span>
        <a href={s.from} className="text-[10px] font-mono" style={{ color: HOME_THEME.muted, textDecoration: "none" }}>
          {s.from}
        </a>
      </div>
      <p className="text-xs" style={{ color: HOME_THEME.text, opacity: 0.8, margin: 0 }}>{s.note}</p>
      <div
        className="flex items-center justify-center"
        style={{
          minHeight: 90,
          borderRadius: 10,
          border: `1px dashed ${HOME_THEME.border}`,
          color: HOME_THEME.muted,
          fontSize: 11,
          fontStyle: "italic",
        }}
      >
        {children ?? "— stub —"}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <div style={homeShellStyle}>
      <div style={homeHeaderStyle}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.cyan }}>
            Analytics
          </span>
          <span className="text-xs" style={{ color: HOME_THEME.text, opacity: 0.7 }}>
            Strategy builder — pulls from the pages below. Wiring TBD.
          </span>
        </div>
      </div>

      <div style={{ ...homeContentStyle, overflow: "auto" }}>
        <div
          style={{
            ...homePanelStyle,
            padding: "10px 16px",
            borderLeft: `3px solid ${HOME_THEME.cyan}`,
            color: HOME_THEME.cyan,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".04em",
            marginBottom: 14,
          }}
        >
          Placeholder shell. Each section will feed a combined trading strategy.
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          }}
        >
          {SECTIONS.map((s) => (
            <SectionCard key={s.id} s={s} />
          ))}

          {/* Combined output — where the strategy is assembled. */}
          <div style={{ ...homePanelStyle, padding: 16, gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: HOME_THEME.green }}>
              Strategy Output
            </span>
            <p className="text-xs" style={{ color: HOME_THEME.text, opacity: 0.8, margin: 0 }}>
              Synthesized signal / bias / plan assembled from the inputs above.
            </p>
            <div
              className="flex items-center justify-center"
              style={{
                minHeight: 120,
                borderRadius: 10,
                border: `1px dashed ${HOME_THEME.border}`,
                color: HOME_THEME.muted,
                fontSize: 11,
                fontStyle: "italic",
              }}
            >
              — to be built —
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
