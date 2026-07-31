"use client";

/**
 * GEX PULSE — the 15-minute SPX directional scorecard, rendered as a home tab.
 *
 * Presentational only: every number and every note comes from
 * `computeGexPulse` in lib/gexPulse.ts, so this panel and the Discord poster
 * can never disagree. Colors/typography come from homeTheme — no local hex.
 */

import React, { useEffect, useRef, useState } from "react";
import { HOME_THEME, LIGHT_BLUE, REFRESH_GREEN } from "@/components/shared/homeTheme";
import { computeGexPulse, type GexPulseInput, type PulseRow } from "@/lib/gexPulse";

/** Direction roles — all three sourced from homeTheme, never re-declared. */
const UP = REFRESH_GREEN;
const DN = HOME_THEME.red;
const NEU = HOME_THEME.orange;
const toneColor = { up: UP, dn: DN, neu: NEU } as const;

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: HOME_THEME.text,
};
/**
 * Typography comes from globals.css, not from this file. The app ships NO web
 * fonts — the Inter download was removed and `--font-inter` is now an alias to
 * `--font-sans` (the native system stack). Never hardcode a family here or the
 * card drifts from every other panel.
 */
const SANS = "var(--font-sans)";
const MONO = "var(--font-mono)";

export interface GexPulsePanelProps extends Omit<GexPulseInput, "prevScore"> {
  /** Header stamp, e.g. "14:45 ET · Fri Jul 31". Defaults to live clock. */
  timeLabel?: string;
}

export default function GexPulsePanel(props: GexPulsePanelProps) {
  // Previous score, re-stamped every 15 minutes so the delta line means what
  // it says. Ref holds the live score; state is what the card renders.
  const [prevScore, setPrevScore] = useState<number | null>(null);
  const liveScoreRef = useRef<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setPrevScore(liveScoreRef.current), 15 * 60_000);
    return () => clearInterval(id);
  }, []);

  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }) +
          " ET · " +
          new Date().toLocaleDateString("en-US", {
            timeZone: "America/New_York",
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
      );
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const p = computeGexPulse({ ...props, prevScore });
  liveScoreRef.current = p.score;
  const col = toneColor[p.tone];
  const big = p.tone === "up" ? "▲" : p.tone === "dn" ? "▼" : "◆";
  const sp = (n: number) => `${n > 0 ? "+" : ""}${n}`;
  const fillPct = (Math.min(Math.abs(p.score), 100) / 100) * 50;
  const delta = p.prevScore == null ? null : p.score - p.prevScore;

  const Row = ({ r }: { r: PulseRow }) => {
    const c = r.p > 0 ? UP : r.p < 0 ? DN : NEU;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "9px 0",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ width: 120, fontSize: 13, fontWeight: 700 }}>{r.n}</div>
        <div style={{ width: 104, fontFamily: MONO, fontSize: 15, fontWeight: 600, textAlign: "right" }}>
          {r.v}
        </div>
        {/* Per-signal point contribution still drives the row color, but the
            number itself is deliberately not rendered — the card shows the
            read, not the arithmetic. */}
        <div style={{ flex: 1, paddingLeft: 20, fontFamily: MONO, fontSize: 12, color: c }}>{r.note}</div>
      </div>
    );
  };

  const Section = ({ title }: { title: string }) => (
    <div style={{ margin: "17px 24px 0", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ ...LABEL, letterSpacing: "0.14em", color: LIGHT_BLUE }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
    </div>
  );

  const Tile = ({ k, v, s, color }: { k: string; v: string; s: string; color: string }) => (
    <div
      style={{
        flex: 1,
        borderRadius: 16,
        padding: "11px 14px",
        background: HOME_THEME.panelBg,
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={LABEL}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, marginTop: 4, color }}>{v}</div>
      <div style={{ fontSize: 11, marginTop: 2, opacity: 0.75 }}>{s}</div>
    </div>
  );

  const money = (v: number | null) =>
    v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        color: HOME_THEME.text,
        fontFamily: SANS,
        padding: "4px 0 20px",
      }}
    >
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", padding: "20px 24px 16px" }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.4px" }}>SPX</div>
          <div style={{ ...LABEL, letterSpacing: "0.14em", color: HOME_THEME.cyan, marginTop: 3 }}>
            GEX · 15-Minute Pulse
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={LABEL}>Spot</div>
          <div style={{ fontFamily: MONO, fontSize: 26, fontWeight: 700, letterSpacing: "-0.8px", marginTop: 3 }}>
            {props.spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11, marginTop: 3, opacity: 0.75 }}>
            {props.timeLabel ?? clock}
          </div>
        </div>
      </div>

      {/* verdict strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          margin: "0 24px",
          padding: "15px 18px",
          borderRadius: 16,
          border: `1px solid ${col}40`,
          background: `linear-gradient(180deg, ${col}1F, ${col}08)`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ fontSize: 22, lineHeight: 1, color: col }}>{big}</div>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "0.03em", color: col }}>{p.bias}</div>
        <div
          style={{
            ...LABEL,
            fontSize: 9.5,
            letterSpacing: "0.14em",
            padding: "4px 9px",
            borderRadius: 6,
            color: col,
            background: `${col}1F`,
            border: `1px solid ${col}33`,
          }}
        >
          {p.conf}
        </div>
        <div
          style={{
            marginLeft: "auto",
            fontFamily: MONO,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: "-1.2px",
            lineHeight: 1,
            color: col,
          }}
        >
          {sp(p.score)}
          <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.6 }}> / 100</span>
        </div>
      </div>

      {/* meter */}
      <div
        style={{
          margin: "12px 24px 0",
          height: 10,
          borderRadius: 5,
          background: "rgba(0,0,0,0.4)",
          border: `1px solid ${HOME_THEME.border}`,
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.18)" }} />
        <i
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            borderRadius: 4,
            boxShadow: `0 0 14px ${col}59`,
            ...(p.score >= 0
              ? { left: "50%", width: `${fillPct}%`, background: `linear-gradient(90deg, ${col}55, ${col})` }
              : { right: "50%", width: `${fillPct}%`, background: `linear-gradient(270deg, ${col}55, ${col})` }),
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          margin: "5px 24px 0",
          fontFamily: MONO,
          fontSize: 9.5,
          opacity: 0.55,
        }}
      >
        <span>−100</span><span>−50</span><span>0</span><span>+50</span><span>+100</span>
      </div>

      <Section title="Levels" />
      <div style={{ margin: "4px 24px 0" }}>{p.levels.map((r) => <Row key={r.n} r={r} />)}</div>

      <Section title="Flow" />
      <div style={{ margin: "4px 24px 0" }}>{p.flow.map((r) => <Row key={r.n} r={r} />)}</div>

      <div
        style={{
          margin: "15px 24px 0",
          padding: "11px 15px",
          borderRadius: 16,
          fontSize: 12.5,
          background: HOME_THEME.panelBg,
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        Regime <b style={{ fontWeight: 800, color: col }}>{p.regime}</b>
        {delta != null && (
          <>
            {" · "}prev score {sp(p.prevScore!)}{" "}
            <span style={{ color: delta >= 0 ? UP : DN }}>({sp(delta)} in 15m)</span>
          </>
        )}
        {" · "}{p.note}
      </div>

      <div style={{ display: "flex", gap: 10, margin: "12px 24px 0" }}>
        <Tile k="Upside Target" v={money(p.tgtUp)} s={p.tgtUpNote} color={UP} />
        <Tile k="Downside Target" v={money(p.tgtDn)} s={p.tgtDnNote} color={DN} />
        <Tile k="Invalidation" v={money(p.invalid)} s={p.invalidNote} color={NEU} />
      </div>

      <div
        style={{
          marginTop: 16,
          padding: "11px 24px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          justifyContent: "space-between",
          ...LABEL,
          fontSize: 9.5,
          letterSpacing: "0.14em",
          opacity: 0.7,
        }}
      >
        <span style={{ color: HOME_THEME.cyan }}>CB Edge — SPX GEX Engine</span>
        <span>Bzila</span>
      </div>
    </div>
  );
}
