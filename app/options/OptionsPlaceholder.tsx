"use client";

import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { useTicker } from "./tickerContext";

type Shape = "bars" | "candles" | "radial" | "rows";

/**
 * "Nothing wired up yet" panel body. Reads the selected ticker so every slot
 * re-labels when the dropdown changes.
 *
 * Skeleton fills use HOME_THEME.cyan / .orange as data-encoding stand-ins for
 * the up/down series each real panel will draw — they are chart colors, not
 * chrome, and stay tokenized.
 */
export default function OptionsPlaceholder({
  label,
  note,
  shape = "bars",
  minHeight = 220,
}: {
  label: string;
  note?: string;
  shape?: Shape;
  minHeight?: number;
}) {
  const { ticker } = useTicker();
  return (
    <div
      style={{
        flex: 1,
        minHeight,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 16,
        border: `1px dashed ${HOME_THEME.border}`,
        borderRadius: 12,
        textAlign: "center",
      }}
    >
      <Skeleton shape={shape} />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: LIGHT_BLUE }}>
          {ticker} · {label}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: HOME_THEME.text,
            opacity: 0.5,
          }}
        >
          {note ?? "placeholder — no data wired"}
        </div>
      </div>
    </div>
  );
}

function Skeleton({ shape }: { shape: Shape }) {
  const up = HOME_THEME.cyan;
  const down = HOME_THEME.orange;

  if (shape === "radial") {
    return (
      <div style={{ position: "relative", width: 132, height: 132, opacity: 0.45 }}>
        {[64, 46, 28].map((r, i) => (
          <div
            key={r}
            style={{
              position: "absolute",
              inset: 66 - r,
              borderRadius: "50%",
              border: `10px solid ${[up, HOME_THEME.purple, down][i]}`,
              opacity: 0.6,
            }}
          />
        ))}
      </div>
    );
  }

  if (shape === "rows") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "min(100%, 320px)", opacity: 0.45 }}>
        {[0.9, 0.7, 0.85, 0.55, 0.7].map((w, i) => (
          <div key={i} style={{ height: 8, width: `${w * 100}%`, borderRadius: 4, background: HOME_THEME.border }} />
        ))}
      </div>
    );
  }

  if (shape === "candles") {
    return (
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 110, opacity: 0.45 }}>
        {[38, 60, 48, 74, 56, 88, 66, 52, 80, 62, 44, 70].map((h, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 2, height: 10, background: i % 2 ? up : down }} />
            <div style={{ width: 9, height: h, borderRadius: 1, background: i % 2 ? up : down }} />
            <div style={{ width: 2, height: 8, background: i % 2 ? up : down }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, height: 96, opacity: 0.45 }}>
      {[0.3, 0.55, 0.8, 0.45, 0.95, 0.6, 0.35, 0.7, 0.5].map((h, i) => (
        <div key={i} style={{ width: 15, height: `${h * 100}%`, borderRadius: 2, background: i % 2 ? up : down }} />
      ))}
    </div>
  );
}
