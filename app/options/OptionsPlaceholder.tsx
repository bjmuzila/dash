"use client";

import { HOME_THEME, LIGHT_BLUE } from "@/components/shared/homeTheme";
import { useTicker } from "./tickerContext";

type Shape = "bars" | "candles" | "radial" | "rows";

/**
 * "Nothing wired up yet" panel body. Reads the selected ticker so every slot
 * re-labels when the dropdown changes.
 *
 * FLUID BY DESIGN: the cards live in a resizable grid, so this fills whatever
 * box it's handed — the skeleton takes the leftover height, every bar is sized
 * as a PERCENTAGE of that, and the caption scales with the tile. No fixed pixel
 * heights below, which is what lets a card be dragged from tall to short
 * without the content either overflowing or stranding empty space.
 *
 * Skeleton fills use HOME_THEME.cyan / .orange as data-encoding stand-ins for
 * the up/down series each real panel will draw — they are chart colors, not
 * chrome, and stay tokenized.
 */
const PH_CLASS = "opt-ph";

/**
 * Container queries, not media queries: these react to the CARD's box, which is
 * the thing the user is dragging. Under ~120px of body height the caption is
 * the first thing to go — the skeleton alone still reads as "nothing wired up
 * here", and keeping the text would leave no room to draw it.
 */
const PH_CSS = `
.${PH_CLASS} { container-type: size; }
@container (max-height: 120px) { .${PH_CLASS}-cap-note { display: none; } }
@container (max-height: 84px)  { .${PH_CLASS}-cap { display: none; } }
@container (max-height: 60px)  { .${PH_CLASS} { padding: 4px; } }
`;

export default function OptionsPlaceholder({
  label,
  note,
  shape = "bars",
  minHeight = 0,
}: {
  label: string;
  note?: string;
  shape?: Shape;
  /** Floor for the body. Leave at 0 inside a resizable card so it can shrink. */
  minHeight?: number;
}) {
  const { ticker } = useTicker();
  return (
    <div
      className={PH_CLASS}
      style={{
        flex: 1,
        height: "100%",
        minHeight,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "clamp(6px, 2%, 14px)",
        padding: "clamp(8px, 3%, 16px)",
        border: `1px dashed ${HOME_THEME.border}`,
        borderRadius: 12,
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <style>{PH_CSS}</style>
      <Skeleton shape={shape} />
      <div className={`${PH_CLASS}-cap`} style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, minHeight: 0 }}>
        <div
          style={{
            fontSize: "clamp(10px, 8px + 1.6cqh, 13px)",
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: LIGHT_BLUE,
            whiteSpace: "nowrap",
          }}
        >
          {ticker} · {label}
        </div>
        <div
          className={`${PH_CLASS}-cap-note`}
          style={{
            fontSize: "clamp(9px, 7px + 1.2cqh, 11px)",
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

/**
 * Every shape fills the space the caption doesn't use: flex:1 for height,
 * width:100% for width, and each bar/candle expressed as a percentage of that
 * box rather than a pixel count.
 */
function Skeleton({ shape }: { shape: Shape }) {
  const up = HOME_THEME.cyan;
  const down = HOME_THEME.orange;
  const fill = { flex: 1, minHeight: 0, width: "100%", opacity: 0.45 } as const;

  if (shape === "radial") {
    // Square, capped by whichever axis runs out first.
    return (
      <div style={{ ...fill, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", height: "100%", aspectRatio: "1 / 1", maxWidth: "100%" }}>
          {[
            { inset: "0%", color: up },
            { inset: "14%", color: HOME_THEME.purple },
            { inset: "28%", color: down },
          ].map((r) => (
            <div
              key={r.inset}
              style={{
                position: "absolute",
                inset: r.inset,
                borderRadius: "50%",
                borderWidth: "7%",
                borderStyle: "solid",
                borderColor: r.color,
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (shape === "rows") {
    return (
      <div
        style={{
          ...fill,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "3%",
          maxWidth: 420,
          alignSelf: "center",
        }}
      >
        {[0.9, 0.7, 0.85, 0.55, 0.7].map((w, i) => (
          <div
            key={i}
            style={{
              flex: "0 1 8px",
              minHeight: 3,
              maxHeight: 10,
              width: `${w * 100}%`,
              borderRadius: 4,
              background: HOME_THEME.border,
            }}
          />
        ))}
      </div>
    );
  }

  if (shape === "candles") {
    const bodies = [38, 60, 48, 74, 56, 88, 66, 52, 80, 62, 44, 70];
    return (
      <div style={{ ...fill, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "1.5%" }}>
        {bodies.map((h, i) => (
          <div
            key={i}
            style={{
              flex: "1 1 0",
              maxWidth: 22,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
            }}
          >
            <div style={{ width: 2, flex: `0 0 ${h * 0.12}%`, background: i % 2 ? up : down }} />
            <div style={{ width: "60%", flex: `0 0 ${h * 0.8}%`, borderRadius: 1, background: i % 2 ? up : down }} />
            <div style={{ width: 2, flex: `0 0 ${h * 0.09}%`, background: i % 2 ? up : down }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ ...fill, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "2%" }}>
      {[0.3, 0.55, 0.8, 0.45, 0.95, 0.6, 0.35, 0.7, 0.5].map((h, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            maxWidth: 28,
            height: `${h * 100}%`,
            borderRadius: 2,
            background: i % 2 ? up : down,
          }}
        />
      ))}
    </div>
  );
}
