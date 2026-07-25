"use client";

import { useMemo, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, homeButtonStyle, homeInputStyle } from "@/components/shared/homeTheme";
import { PageShell, Card } from "@/components/shared/PageCard";

/** Placeholder slots — replace each with the real panel as it gets built. */
const SLOTS = [
  { key: "chain", title: "Chain", note: "Strikes, bid/ask, greeks." },
  { key: "filters", title: "Filters", note: "Symbol, expiry, strike range." },
  { key: "summary", title: "Summary", note: "IV, OI, volume, put/call." },
];

/** Tickers available in the selector. Only SPX has real placeholder data for
 * now — everything else renders a "coming soon" note until it's wired up. */
const TICKERS = ["SPX", "SPY", "QQQ", "NDX", "IWM"] as const;
type Ticker = (typeof TICKERS)[number];

const HEATMAP_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Deterministic static placeholder grid (7 weekdays × 24 hours), same shape
 * as the Overview tab's real hourly load heatmap. Stands in for a real
 * per-ticker activity feed (e.g. |% move| or volume by hour) until that's
 * wired up — seeded off hour/day index so it's stable across renders, not
 * random.
 */
function buildStaticHeatmapGrid(): { grid: number[][]; max: number } {
  const grid: number[][] = HEATMAP_WEEKDAYS.map((_, di) =>
    Array.from({ length: 24 }, (_, h) => {
      const wave = Math.abs(Math.sin((di * 24 + h) * 0.28) + Math.sin(h * 0.5));
      return Math.round(wave * 12);
    }),
  );
  const max = Math.max(1, ...grid.flat());
  return { grid, max };
}

function TickerHeatmap({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px repeat(24, 1fr)", gap: 2 }}>
      <div />
      {Array.from({ length: 24 }, (_, h) => (
        <div key={"h" + h} style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.6, textAlign: "center" }}>
          {h % 6 === 0 ? h : ""}
        </div>
      ))}
      {HEATMAP_WEEKDAYS.map((d, di) => (
        <div key={d} style={{ display: "contents" }}>
          <div style={{ fontSize: 12, color: HOME_THEME.text, opacity: 0.7, lineHeight: "26px" }}>{d}</div>
          {grid[di].map((count, h) => {
            const v = count > 0 ? 0.08 + (count / max) * 0.85 : 0.04;
            return (
              <div
                key={d + h}
                title={`${d} ${h}:00 · ${count}`}
                style={{ height: 26, borderRadius: 2, background: `${LIGHT_BLUE}${Math.round(v * 255).toString(16).padStart(2, "0")}` }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function OptionsPage() {
  const [ticker, setTicker] = useState<Ticker>("SPX");
  const staticSpxHeatmap = useMemo(() => buildStaticHeatmapGrid(), []);

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
        title="Activity heatmap"
        subtitle={`${ticker} · static placeholder — swap for the real feed once it's picked`}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: HOME_THEME.text, opacity: 0.7 }}>
            Ticker
          </label>
          <select
            value={ticker}
            onChange={(e) => setTicker(e.target.value as Ticker)}
            style={{ ...homeInputStyle, minWidth: 100 }}
          >
            {TICKERS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {ticker === "SPX" ? (
          <TickerHeatmap grid={staticSpxHeatmap.grid} max={staticSpxHeatmap.max} />
        ) : (
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
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: LIGHT_BLUE }}>
              Coming soon
            </div>
            <div style={{ fontSize: 13, color: HOME_THEME.text, opacity: 0.6, lineHeight: 1.5 }}>
              {ticker} heatmap data isn't wired up yet — only SPX has placeholder data for now.
            </div>
          </div>
        )}
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
