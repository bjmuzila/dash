/**
 * Mockups · PROPOSED. Four consolidated redesigns of the four surfaces the
 * "today" tabs in Mockups.tsx picture as they ship:
 *
 *   1. Chart ⚙ Style    one popover, three tabs by intent (Look · Layers ·
 *                        Studies), Draw moved to the toolbar, Forward and
 *                        Trails folded in, "Fine tune the six" dissolved
 *   2. Flow toolbars     four tabs instead of seven + five, ONE toolbar shape
 *                        on every view, filters in a drawer with removable chips
 *   3. Account menu      account things only: no row that duplicates the rail
 *   4. Settings          one searchable page that owns every preference,
 *                        including the left menu (hide, pin, reorder)
 *
 * Deliberately self-contained: its primitives are copied from Mockups.tsx
 * rather than imported, so the "today" tabs stay byte-for-byte what they were.
 * NOTHING HERE IS WIRED. Every control holds local React state only.
 *
 * Copy rules hold: no em-dashes in anything a person reads, nothing that reads
 * as advice.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ACCENT,
  ACCENT_TEXT,
  BAD,
  DARK_POOL,
  ELEV,
  GOOD,
  LINE,
  MONO,
  PANEL,
  PAPER,
  PAPER_QUIET,
  R_LG,
  R_MD,
  R_SM,
  SANS,
  VOLT,
  W_BOLD,
  W_DATA,
  W_MED,
  rgba,
} from "../theme";

type Opt<K extends string> = readonly (readonly [K, string])[];

/* ── primitives (copied from Mockups.tsx on purpose, see header) ─────────── */

function Seg<K extends string>({ options, value, onChange, size = 12 }: { options: Opt<K>; value: K; onChange?: (k: K) => void; size?: number }) {
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 9, overflow: "hidden", flexWrap: "wrap" }}>
      {options.map(([k, lbl], i) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange?.(k)}
          style={{
            fontFamily: SANS,
            fontSize: size,
            fontWeight: 700,
            padding: "5px 11px",
            border: "none",
            borderLeft: i ? `1px solid ${LINE}` : "none",
            cursor: "pointer",
            background: value === k ? rgba(ACCENT, 0.2) : "transparent",
            color: value === k ? ACCENT_TEXT : PAPER,
          }}
        >
          {lbl}
        </button>
      ))}
    </span>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{ flexShrink: 0, width: 38, height: 22, borderRadius: 999, border: "none", cursor: "pointer", position: "relative", background: on ? ACCENT : rgba(PAPER, 0.18), transition: "background .15s" }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: PAPER, transition: "left .15s" }} />
    </button>
  );
}

function Chip({ children, on, tone = ACCENT, onClick, style }: { children: ReactNode; on?: boolean; tone?: string; onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: SANS,
        fontSize: 12,
        fontWeight: 700,
        padding: "6px 11px",
        borderRadius: R_MD,
        cursor: "pointer",
        border: `1px solid ${on ? tone : LINE}`,
        background: on ? rgba(tone, 0.16) : ELEV,
        boxShadow: on ? `inset 0 -1px 0 ${tone}, 0 0 16px -8px ${tone}` : "none",
        color: PAPER,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SecHead({ children, top = 14 }: { children: ReactNode; top?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: `${top}px 0 4px`, fontFamily: MONO, fontSize: 9, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: PAPER_QUIET }}>
      {children}
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: LINE }} />
    </div>
  );
}

function Row({ label, hint, children, indent = false }: { label: string; hint?: string; children?: ReactNode; indent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: `8px 0 8px ${indent ? 12 : 0}px`, fontFamily: SANS }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: PAPER, whiteSpace: "nowrap" }}>{label}</span>
        {hint && <span style={{ display: "block", fontSize: 11, color: PAPER_QUIET, marginTop: 2 }}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function Slider({ label, value, onChange, color, min = 0, max = 100, suffix = "%" }: { label: string; value: number; onChange: (n: number) => void; color: string; min?: number; max?: number; suffix?: string }) {
  return (
    <Row label={label}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
        <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: 120, accentColor: color, cursor: "pointer" }} />
        <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: PAPER, width: 34, textAlign: "right" }}>
          {value}
          {suffix}
        </span>
      </span>
    </Row>
  );
}

function Pop({ width = 348, children, style }: { width?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ width, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "11px 14px", boxShadow: "0 14px 40px rgba(0,0,0,0.5)", ...style }}>
      {children}
    </div>
  );
}

function Frame({ title, note, children, style }: { title: string; note?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{ minWidth: 0, ...style }}>
      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: ACCENT_TEXT, marginBottom: 6, textTransform: "uppercase" }}>{title}</div>
      {note && <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, lineHeight: 1.45, marginBottom: 8, maxWidth: 620 }}>{note}</div>}
      {children}
    </section>
  );
}

function Menu({ items, value, width = 190 }: { items: (string | [string, string])[]; value?: string; width?: number }) {
  return (
    <div style={{ width, background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: 5, boxShadow: "0 14px 40px rgba(0,0,0,0.5)", display: "grid", gap: 1 }}>
      {items.map((it) => {
        const [label, sub] = Array.isArray(it) ? it : [it, ""];
        return (
          <div key={label} style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, padding: "7px 10px", borderRadius: 8, color: PAPER, background: label === value ? rgba(ACCENT, 0.18) : "transparent" }}>
            {label}
            {sub && <div style={{ fontSize: 11, fontWeight: 400, color: PAPER_QUIET, marginTop: 2 }}>{sub}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Box({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: rgba(PAPER, 0.02), border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "14px 16px", ...style }}>{children}</div>;
}

const Bar = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, ...style }}>{children}</div>
);

const Field = ({ ph, w = 150 }: { ph: string; w?: number }) => (
  <span style={{ width: w, fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "7px 11px", boxSizing: "border-box" }}>{ph}</span>
);

const Heads = ({ cols }: { cols: string[] }) => (
  <div style={{ display: "flex", flexWrap: "wrap", border: `1px solid ${LINE}`, borderRadius: R_MD, overflow: "hidden", background: PANEL }}>
    {cols.map((c, i) => (
      <span key={c} style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, color: PAPER_QUIET, padding: "8px 11px", borderLeft: i ? `1px solid ${LINE}` : "none", whiteSpace: "nowrap" }}>
        {c}
      </span>
    ))}
  </div>
);

const flexWrap = (gap = 16): CSSProperties => ({ display: "flex", gap, flexWrap: "wrap", alignItems: "flex-start" });

/** The before → after scorecard every proposed tab opens with. */
function Scorecard({ rows }: { rows: [string, string | number, string | number][] }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {rows.map(([label, before, after]) => (
        <div key={label} style={{ minWidth: 150, padding: "10px 14px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_MD }}>
          <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: PAPER_QUIET, textTransform: "uppercase" }}>{label}</div>
          <div style={{ marginTop: 5, fontFamily: MONO, fontSize: 18, fontWeight: W_DATA, color: PAPER }}>
            <span style={{ color: PAPER_QUIET, textDecoration: "line-through", fontSize: 14, marginRight: 8 }}>{before}</span>
            <span style={{ color: GOOD }}>{after}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** What moved, what merged, what went. */
function Changes({ items, onCompare }: { items: [string, string][]; onCompare?: () => void }) {
  return (
    <Frame title="What changed and why">
      <Box>
        <div style={{ display: "grid", gap: 8 }}>
          {items.map(([what, why]) => (
            <div key={what} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 280px) 1fr", gap: 14, fontFamily: SANS, fontSize: 12.5, lineHeight: 1.5 }}>
              <span style={{ fontWeight: 700, color: PAPER }}>{what}</span>
              <span style={{ color: PAPER_QUIET }}>{why}</span>
            </div>
          ))}
        </div>
        {onCompare && (
          <div style={{ marginTop: 14 }}>
            <Chip onClick={onCompare}>⇄ Compare with today</Chip>
          </div>
        )}
      </Box>
    </Frame>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   1 · CHART STYLE · PROPOSED
   Toolbar: ⚙ Chart · ✎ Draw · ⛶  (three buttons, down from four; Draw was a
   tab inside a settings popover and is a TOOL, so it becomes a button.)
   Popover: Look (how busy, how bold) · Layers (what is drawn) · Studies.
   ════════════════════════════════════════════════════════════════════════ */

function LookTab() {
  const [preset, setPreset] = useState<"full" | "calm" | "minimal" | "custom">("full");
  const [shown, setShown] = useState(6);
  const [keyOnly, setKeyOnly] = useState(false);
  const [len, setLen] = useState<"ext" | "small" | "label">("ext");
  const [boldOpen, setBoldOpen] = useState(false);
  const [g, setG] = useState(24);
  const [n, setN] = useState(43);
  const [dp, setDp] = useState(0);
  const touch = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPreset("custom");
  };
  return (
    <>
      <SecHead top={4}>Preset</SecHead>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        {(
          [
            ["full", "Full", "Every layer, full strength"],
            ["calm", "Calm", "Every layer, drawn quietly"],
            ["minimal", "Minimal", "Named levels only"],
          ] as const
        ).map(([k, l, sub]) => (
          <button
            key={k}
            type="button"
            onClick={() => setPreset(k)}
            style={{ textAlign: "left", padding: "8px 9px", borderRadius: R_MD, cursor: "pointer", border: `1px solid ${preset === k ? ACCENT : LINE}`, background: preset === k ? rgba(ACCENT, 0.16) : "transparent", color: PAPER, fontFamily: SANS }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 10.5, color: PAPER_QUIET, marginTop: 2, lineHeight: 1.3 }}>{sub}</div>
          </button>
        ))}
      </div>
      {preset === "custom" && <div style={{ fontFamily: SANS, fontSize: 11, color: VOLT, marginTop: 6 }}>● Custom · you changed a setting below. Pick a preset to reset.</div>}
      <SecHead>Levels</SecHead>
      <Slider label="How many" value={shown} onChange={touch(setShown)} color={GOOD} min={4} max={14} suffix="" />
      <Row label="Named levels only" hint="Hides plain gamma strikes">
        <Toggle on={keyOnly} onClick={() => touch(setKeyOnly)(!keyOnly)} />
      </Row>
      <Row label="Line length">
        <Seg value={len} onChange={touch(setLen)} options={[["ext", "Full"], ["small", "Stub"], ["label", "Tag"]] as const} />
      </Row>
      <button type="button" onClick={() => setBoldOpen(!boldOpen)} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", margin: "6px 0 0", padding: "8px 0", border: "none", borderTop: `1px solid ${LINE}`, background: "transparent", color: PAPER, fontFamily: SANS, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        Boldness <span style={{ color: PAPER_QUIET, fontSize: 11 }}>{boldOpen ? "▴" : `gamma ${g} · nodes ${n} · dark pool ${dp} ▾`}</span>
      </button>
      {boldOpen && (
        <>
          <Slider label="Gamma levels" value={g} onChange={touch(setG)} color={ACCENT} />
          <Slider label="Node levels" value={n} onChange={touch(setN)} color={VOLT} />
          <Slider label="Dark pool" value={dp} onChange={touch(setDp)} color={DARK_POOL} />
        </>
      )}
    </>
  );
}

type Layer = { key: string; label: string; hint: string; on: boolean; options?: Opt<string>; opt?: string };

function LayersTab() {
  const [layers, setLayers] = useState<Layer[]>([
    { key: "trails", label: "Level trails", hint: "How each level grew, candle by candle", on: true, options: [["core", "Core"], ["ribbon", "Ribbon"], ["path", "Path"]], opt: "path" },
    { key: "prior", label: "Prior levels", hint: "Last sessions' Volt and walls, faded", on: true, options: [["1", "1d"], ["3", "3d"], ["5", "5d"]], opt: "3" },
    { key: "forward", label: "Forward", hint: "Where today's levels sit ahead of price", on: false, options: [["today", "Today"], ["week", "Week"]], opt: "today" },
    { key: "session", label: "Session ranges", hint: "Previous day, pre-market, opening range", on: true, options: [["lines", "Lines"], ["hair", "Hairlines"]], opt: "lines" },
    { key: "ext", label: "Extended hours", hint: "Shade pre-market and after hours", on: true },
    { key: "volume", label: "Volume", hint: "Bars along the bottom", on: true, options: [["under", "Under"], ["strip", "Own strip"]], opt: "under" },
    { key: "wm", label: "Watermark", hint: "Voltick behind the candles", on: true, options: [["large", "Large"], ["corner", "Corner"]], opt: "large" },
  ]);
  const set = (k: string, patch: Partial<Layer>) => setLayers(layers.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  return (
    <>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET, margin: "2px 0 6px" }}>One row per thing on the chart. A switch turns it on, the choice beside it says how.</div>
      {layers.map((l) => (
        <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
          <Toggle on={l.on} onClick={() => set(l.key, { on: !l.on })} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: l.on ? PAPER : PAPER_QUIET }}>{l.label}</div>
            <div style={{ fontFamily: SANS, fontSize: 10.5, color: PAPER_QUIET, marginTop: 1 }}>{l.hint}</div>
          </div>
          {l.options && l.on && <Seg size={11} value={l.opt ?? ""} onChange={(v) => set(l.key, { opt: v })} options={l.options} />}
        </div>
      ))}
    </>
  );
}

function StudiesTab() {
  const [rows, setRows] = useState([
    { id: 1, name: "EMA", len: "9", on: true, color: ACCENT_TEXT },
    { id: 2, name: "VWAP", len: "", on: true, color: PAPER },
  ]);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET, margin: "2px 0 8px" }}>Only what is on the chart is listed. Add one from the catalogue.</div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 10, background: r.on ? rgba(r.color, 0.08) : "transparent" }}>
          <Toggle on={r.on} onClick={() => setRows(rows.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))} />
          <span style={{ width: 11, height: 3, borderRadius: 2, background: r.color }} />
          <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: PAPER }}>{r.name}</span>
          {r.len && <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: PAPER, border: `1px solid ${LINE}`, borderRadius: 7, padding: "2px 7px", background: PANEL }}>{r.len}</span>}
          <button type="button" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 7, border: `1px solid ${LINE}`, background: "transparent", color: PAPER, cursor: "pointer" }}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setAdding(!adding)} style={{ marginTop: 8, width: "100%", padding: "8px 10px", borderRadius: 9, border: `1px dashed ${LINE}`, background: "transparent", color: ACCENT_TEXT, cursor: "pointer", fontFamily: SANS, fontSize: 12, fontWeight: 700 }}>
        ＋ Add a study
      </button>
      {adding && (
        <div style={{ marginTop: 8 }}>
          <Menu
            width={320}
            items={[
              ["EMA · SMA", "Moving averages on price, any length"],
              ["VWAP · VWAP bands", "Session average, with 2σ / 2.5σ bands"],
              ["RSI · MACD · Williams %R", "Momentum, each in its own strip"],
            ]}
          />
        </div>
      )}
    </>
  );
}

function ChartPopover() {
  const [tab, setTab] = useState<"look" | "layers" | "studies">("look");
  return (
    <Pop>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <Seg value={tab} onChange={setTab} options={[["look", "Look"], ["layers", "Layers"], ["studies", "Studies"]] as const} />
      </div>
      {tab === "look" ? <LookTab /> : tab === "layers" ? <LayersTab /> : <StudiesTab />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: `1px solid ${LINE}`, fontFamily: SANS, fontSize: 11, color: PAPER_QUIET }}>
        <span>Saved on this device</span>
        <span style={{ color: ACCENT_TEXT, fontWeight: 700 }}>↺ Reset</span>
      </div>
    </Pop>
  );
}

export function ChartProposed({ onCompare }: { onCompare?: () => void } = {}) {
  const [drawing, setDrawing] = useState(false);
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <Scorecard
        rows={[
          ["Toolbar buttons", 4, 3],
          ["Popover tabs", 3, 3],
          ["Style-tab controls", "~22", 11],
          ["Places to toggle Trails", 2, 1],
        ]}
      />
      <Frame title="Toolbar" note="⚙ Chart opens the one popover. ✎ Draw is a tool, so it lives on the toolbar and arms straight away; its colour, undo and clear ride along in a slim strip while drawing.">
        <div style={{ display: "grid", gap: 8 }}>
          <Bar style={{ width: "fit-content" }}>
            <Chip on>⚙ Chart ▾</Chip>
            <Chip on={drawing} onClick={() => setDrawing(!drawing)}>
              ✎ Draw
            </Chip>
            <Chip>⛶</Chip>
          </Bar>
          {drawing && (
            <Bar style={{ width: "fit-content" }}>
              <span style={{ width: 18, height: 18, borderRadius: 5, background: VOLT, border: `1px solid ${LINE}` }} />
              <Chip>⤺ Undo</Chip>
              <Chip>Clear</Chip>
              <span style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET }}>Click a start point, then an end point · Esc to stop</span>
            </Bar>
          )}
        </div>
      </Frame>
      <Frame title="⚙ Chart popover" note="Three tabs by intent. Look is how busy and how bold. Layers is what is drawn, one row each. Studies lists only what is on the chart, with one Add button.">
        <div style={flexWrap(18)}>
          <ChartPopover />
        </div>
      </Frame>
      <Changes
        onCompare={onCompare}
        items={[
          ["Draw → toolbar button", "It is a tool you use, not a setting you keep. Arming it no longer means opening a menu."],
          ["Forward ▾ → Layers", "One more thing drawn on the chart. The toolbar dropdown goes."],
          ["Trails button → Layers", "Two doors to one switch became one."],
          ["“Fine tune the six” (8 rows) → dissolved", "Each hidden switch was really a style of a layer: Watermark Large/Corner, Volume Under/Own strip, Session ranges Lines/Hairlines."],
          ["Density → Preset cards", "Each card says what it does. Touching any setting shows “Custom” instead of silently leaving the preset."],
          ["How bold → one fold under Look", "Three sliders most people never move, summarised on one line until opened."],
          ["Indicators → Studies with one Add", "Seven always-visible rows became only the ones in use."],
          ["“YOUR DEVICE REMEMBERS” → footer", "Said once, at the bottom, with Reset beside it."],
        ]}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2 · FLOW · PROPOSED
   Seven top tabs + five sub-tabs + a stray Repeated chip → four tabs, each
   with a sub-switch, and ONE toolbar shape on every view.
   ════════════════════════════════════════════════════════════════════════ */

const P_FLOW: { key: string; label: string; subs: [string, string][] }[] = [
  { key: "tape", label: "⚡︎ Tape", subs: [["all", "Every print"]] },
  { key: "patterns", label: "⟳ Patterns", subs: [["repeated", "Repeated · 1162"], ["oneshots", "One-shots"], ["building", "Being built"], ["waking", "Waking up"]] },
  { key: "market", label: "◉ Market", subs: [["active", "Most active"], ["sectors", "Sectors"], ["drift", "Net drift"], ["premium", "Premium by expiry"], ["oi", "OI changes"]] },
  { key: "dark", label: "◐ Dark Pool", subs: [["flow", "Prints"], ["confirm", "Cross-confirm"]] },
];

type ActiveFilter = { id: string; label: string };

function SummaryLine() {
  return (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline", padding: "10px 14px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, fontFamily: SANS, fontSize: 12.5, color: PAPER }}>
      <span>
        Net <b style={{ fontFamily: MONO, fontSize: 16, color: GOOD }}>+$17.7M</b> <span style={{ color: PAPER_QUIET }}>bought</span>
      </span>
      <span>
        <b style={{ fontFamily: MONO }}>14,789</b> <span style={{ color: PAPER_QUIET }}>prints · 7% swept</span>
      </span>
      <span>
        Calls <b style={{ fontFamily: MONO, color: GOOD }}>$692M</b> · Puts <b style={{ fontFamily: MONO, color: BAD }}>$200M</b>
      </span>
      <span style={{ color: PAPER_QUIET }}>Put / call 0.41 · two-sided</span>
      <span style={{ marginLeft: "auto", color: ACCENT_TEXT, fontWeight: 700 }}>Details ▾</span>
    </div>
  );
}

function FiltersDrawer({ onClose, lit }: { onClose: () => void; lit: string[] }) {
  const group = (title: string, rows: [string, string[]][]) => (
    <div style={{ marginBottom: 10 }}>
      <SecHead top={6}>{title}</SecHead>
      {rows.map(([k, opts]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", margin: "7px 0" }}>
          <span style={{ width: 92, fontFamily: SANS, fontSize: 12, fontWeight: 700, color: PAPER }}>{k}</span>
          {opts.map((o) => (
            <Chip key={o} on={lit.includes(o)} style={{ padding: "3px 9px", fontSize: 11.5 }}>
              {o}
            </Chip>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <Pop width={400}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: W_BOLD, color: PAPER }}>Filters</span>
        <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", color: PAPER, cursor: "pointer", fontSize: 14 }}>
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 8px" }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAPER_QUIET, alignSelf: "center" }}>SAVED</span>
        <Chip on tone={VOLT} style={{ padding: "3px 9px", fontSize: 11.5 }}>
          ★ Whales
        </Chip>
        <Chip style={{ padding: "3px 9px", fontSize: 11.5 }}>★ Big LEAPs</Chip>
        <Chip style={{ padding: "3px 9px", fontSize: 11.5 }}>★ Morning sweep</Chip>
      </div>
      {group("The contract", [
        ["Type", ["Calls", "Puts"]],
        ["Days out", ["0DTE", "1 to 30", "31 to 90", "90+"]],
        ["Expiry", ["Any date ▾"]],
        ["Price", ["Any ▾"]],
      ])}
      {group("How big", [
        ["Premium", ["$50K+", "$250K+", "$500K+", "$1M+"]],
        ["Volume", ["500+", "1K+", "5K+"]],
        ["Vol / OI", ["2x", "3x", "5x", "10x"]],
        ["Open int", ["< 500", "< 1K", "< 2.5K"]],
      ])}
      {group("The trade", [
        ["Fill", ["At ask", "At bid"]],
        ["Shape", ["Outright only", "Swept only"]],
        ["Company", ["Mega", "Large", "Mid", "Small"]],
      ])}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
        <Chip>Clear all</Chip>
        <Chip on>＋ Save as preset</Chip>
      </div>
    </Pop>
  );
}

function FlowToolbarP({ tab }: { tab: string }) {
  const [dir, setDir] = useState<"all" | "up" | "dn">("all");
  const [quick, setQuick] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<ActiveFilter[]>([
    { id: "p", label: "$250K+" },
    { id: "a", label: "At ask" },
  ]);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<null | "universe" | "when">(null);
  const q = (k: string) => setQuick({ ...quick, [k]: !quick[k] });
  const quicks = tab === "dark" ? ["★ Standout", "On a level"] : tab === "market" ? ["My watchlist"] : ["★ Unusual", "0DTE", "On a level", "My watchlist"];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Bar>
        <Field ph="Ticker or contract · SPY 600C 10/2" w={250} />
        <Chip on={menu === "universe"} onClick={() => setMenu(menu === "universe" ? null : "universe")}>
          Stocks ▾
        </Chip>
        {tab !== "market" && <Seg value={dir} onChange={setDir} options={[["all", "All"], ["up", "▲ Bullish"], ["dn", "▼ Bearish"]] as const} />}
        <span style={{ width: 1, height: 22, background: LINE }} />
        {quicks.map((k) => (
          <Chip key={k} on={quick[k]} tone={k.startsWith("★") ? VOLT : ACCENT} onClick={() => q(k)}>
            {k}
          </Chip>
        ))}
        <Chip on={drawer} onClick={() => setDrawer(!drawer)}>
          ⚙ Filters{active.length ? ` · ${active.length}` : ""}
        </Chip>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <Seg value="new" options={[["new", "Newest"], ["big", "Biggest"]] as const} />
          <Chip on={menu === "when"} onClick={() => setMenu(menu === "when" ? null : "when")}>
            <span style={{ color: GOOD }}>●</span> Live ▾
          </Chip>
        </span>
      </Bar>
      {active.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {active.map((f) => (
            <span key={f.id} style={{ fontFamily: SANS, fontSize: 11.5, fontWeight: 700, color: PAPER, border: `1px solid ${rgba(ACCENT, 0.5)}`, background: rgba(ACCENT, 0.1), borderRadius: 99, padding: "3px 6px 3px 10px" }}>
              {f.label}{" "}
              <button type="button" onClick={() => setActive(active.filter((x) => x.id !== f.id))} style={{ border: "none", background: "transparent", color: PAPER_QUIET, cursor: "pointer" }}>
                ✕
              </button>
            </span>
          ))}
          <button type="button" onClick={() => setActive([])} style={{ border: "none", background: "transparent", color: ACCENT_TEXT, fontFamily: SANS, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            Clear
          </button>
        </div>
      )}
      <div style={flexWrap()}>
        {menu === "universe" && <Menu value="Stocks" items={[["Stocks", "Company names only"], ["ETFs", "Funds and index products"], ["All", "Everything the tape saw"]]} />}
        {menu === "when" && <Menu value="● Live" items={["● Live", "⏸ Pause the tape", "↺ Sep 24", "↺ Sep 23", "↺ Sep 22"]} />}
        {drawer && <FiltersDrawer lit={active.map((f) => f.label)} onClose={() => setDrawer(false)} />}
      </div>
    </div>
  );
}

export function FlowProposed({ onCompare }: { onCompare?: () => void } = {}) {
  const [tab, setTab] = useState("tape");
  const [sub, setSub] = useState("all");
  const t = P_FLOW.find((x) => x.key === tab) ?? P_FLOW[0]!;
  const heads: Record<string, string[]> = {
    tape: ["Time", "Symbol", "Contract", "Premium", "Read", "Fill", "Size", "Vol/OI", "Level"],
    patterns: ["Symbol", "Contract", "Hits", "Premium", "Read", "Last print", "Level"],
    market: ["Symbol", "Premium", "Lean", "Pace", "Prints", "Sector"],
    dark: ["Time", "Stock", "Notional", "Price", "% of day", "Score", "Level"],
  };
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Scorecard
        rows={[
          ["Tabs to choose from", "7 + 5 + 2", "4"],
          ["Controls in the toolbar", "~18", 11],
          ["Toolbar shapes", 8, 1],
          ["Places to set size", 3, 1],
        ]}
      />
      <Frame title="Page header" note="Four tabs, each with a sub-switch. Alerts collapse to one pill beside the tour button.">
        <div style={{ display: "grid", gap: 8, padding: 12, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {P_FLOW.map((x) => (
              <Chip
                key={x.key}
                on={tab === x.key}
                tone={x.key === "dark" ? DARK_POOL : ACCENT}
                onClick={() => {
                  setTab(x.key);
                  setSub(x.subs[0]![0]);
                }}
              >
                {x.label}
              </Chip>
            ))}
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <Chip>⚑ 3 alerts ▾</Chip>
              <Chip>?</Chip>
            </span>
          </div>
          {t.subs.length > 1 && (
            <div style={{ display: "flex", gap: 0 }}>
              <Seg value={sub} onChange={setSub} options={t.subs} />
            </div>
          )}
        </div>
      </Frame>
      <Frame title={`Toolbar · ${t.label}${t.subs.length > 1 ? ` › ${t.subs.find(([k]) => k === sub)?.[1] ?? ""}` : ""}`} note="The same row on every tab: search, universe, direction, a few one-tap chips, Filters, then sort and time on the right. Chips that do not apply to a tab drop out rather than moving. Click ⚙ Filters, Stocks ▾ and Live ▾.">
        <FlowToolbarP key={tab} tab={tab} />
      </Frame>
      <SummaryLine />
      <Heads cols={heads[tab] ?? heads.tape!} />
      <Changes
        onCompare={onCompare}
        items={[
          ["7 top tabs + 5 sub-tabs → 4 tabs", "Tape, Patterns (repeated, one-shots, being built, waking up), Market (most active, sectors, drift, premium, OI) and Dark Pool."],
          ["⟳ Repeated · 1162 chip → Patterns tab badge", "It was a tab pretending to be a filter."],
          ["▲ and ▼ → one Direction switch", "All / Bullish / Bearish, so both can never be on at once."],
          ["Size chips + Filters Size + preset chips → Filters › How big", "Market cap moves to Filters › The trade. One place to answer “how big”."],
          ["⚙ Filters panel → grouped drawer", "The contract · How big · The trade, with saved presets at the top and Save as preset at the bottom."],
          ["★ Presets menu → inside Filters", "Presets are saved filters, so they live with filters."],
          ["Find a contract row → search box", "Type SPY 600C 10/2 into the same field as a ticker."],
          ["Active filters → removable chips", "What is narrowing the tape is always visible and one ✕ away."],
          ["Stats strip → one summary line", "Same numbers, one line, Details opens the full strip."],
          ["Pause + Live ▾ → one Live menu", "Live, pause and past sessions are all answers to “which tape am I looking at”."],
          ["Alerts bar → ⚑ pill", "Still one click away, no longer a full row above every view."],
          ["◑ CB → Settings › Display", "A preference, not a per-page control."],
        ]}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   3 · ACCOUNT MENU · PROPOSED
   The rail is where you GO. This menu is about YOU. Anything that is a place
   to go is either in the rail already or moves there.
   ════════════════════════════════════════════════════════════════════════ */

type Who = "member" | "owner" | "free";

function AccountPopP({ who }: { who: Who }) {
  const admin = who === "owner";
  const member = who !== "free";
  const plan: [string, string] = admin ? ["Owner", VOLT] : member ? ["Member", GOOD] : ["Free", PAPER_QUIET];
  const row = (icon: string, label: string, right?: ReactNode, danger = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: R_MD, fontFamily: SANS, fontSize: 13, fontWeight: W_MED, color: danger ? BAD : PAPER }}>
      <span aria-hidden="true" style={{ width: 16, textAlign: "center" }}>
        {icon}
      </span>
      <span>{label}</span>
      {right}
    </div>
  );
  const badge = (n: string | number) => <span style={{ marginLeft: "auto", background: ACCENT, color: PAPER, fontFamily: MONO, fontSize: 10, fontWeight: W_DATA, borderRadius: 99, padding: "1px 7px" }}>{n}</span>;
  const hr = <div style={{ height: 1, background: LINE, margin: "4px 6px" }} />;
  return (
    <div style={{ width: 256, display: "flex", flexDirection: "column", gap: 1, padding: 6, background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, boxShadow: "0 16px 44px rgba(0,0,0,0.6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 12px 13px" }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: ACCENT, color: PAPER, fontFamily: MONO, fontWeight: W_DATA, fontSize: 15 }}>B</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: W_BOLD, color: PAPER, overflow: "hidden", textOverflow: "ellipsis" }}>member@example.com</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", color: plan[1], border: `1px solid ${rgba(plan[1], 0.45)}`, borderRadius: R_SM, padding: "1px 6px", textTransform: "uppercase" }}>{plan[0]}</span>
            {admin && <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: ACCENT_TEXT }}>Owner tools →</span>}
            {!member && <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 700, color: ACCENT_TEXT }}>Upgrade →</span>}
          </div>
        </div>
      </div>
      {hr}
      {row("⚙", "Settings")}
      {member && row("▭", "Plan & billing")}
      {row("✦", "What's new", badge("3"))}
      {hr}
      {row("?", "Help & support", badge("1"))}
      {row("◌", "Suggest a feature")}
      {row("⚇", "Community", <span style={{ marginLeft: "auto", fontFamily: SANS, fontSize: 11, color: PAPER_QUIET }}>Discord · Affiliates</span>)}
      {member && row("‹›", "API & agents")}
      {hr}
      {row("⇥", "Sign out", undefined, true)}
    </div>
  );
}

function HelpPanel() {
  return (
    <Pop width={300}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", color: PAPER_QUIET, marginBottom: 6 }}>HELP & SUPPORT</div>
      <Menu
        width={272}
        items={[
          ["How to use Voltick", "The walkthrough, page by page"],
          ["Blog", "Session write-ups"],
          ["Contact support · 1 reply", "Your open conversation"],
          ["Start the tour", "On the page you are on"],
        ]}
      />
    </Pop>
  );
}

export function AccountProposed({ onCompare }: { onCompare?: () => void } = {}) {
  const [who, setWho] = useState<Who>("member");
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Scorecard
        rows={[
          ["Rows (member)", 16, 8],
          ["Sections", 4, 3],
          ["Rows that duplicate the rail", 3, 0],
        ]}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: SANS, fontSize: 13, color: PAPER_QUIET }}>Signed in as</span>
        <Seg value={who} onChange={setWho} options={[["member", "Member"], ["owner", "Owner"], ["free", "Free account"]] as const} />
      </div>
      <Frame title="Rail foot + account pop-up" note="Search moves to the rail head (⌘K), where it already has a door. Help & support opens a small sub-menu instead of spreading four rows through the main one.">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <div style={{ width: 180, minHeight: 470, display: "flex", flexDirection: "column", background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, overflow: "hidden" }}>
            <div style={{ padding: 10 }}>
              <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "6px 9px", display: "flex", justifyContent: "space-between" }}>
                ⌕ Search <span style={{ fontFamily: MONO, fontSize: 10 }}>⌘K</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: "4px 12px", fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, lineHeight: 2 }}>
              Education
              <br />
              The Board
              <br />
              Flow
              <br />
              Read The Market
              <br />
              Track Record
              <br />
              Yours · Trade Journal
            </div>
            <div style={{ borderTop: `1px solid ${LINE}`, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: ACCENT, color: PAPER, fontFamily: MONO, fontWeight: W_DATA, boxShadow: `0 0 0 2px ${ACCENT}` }}>B</span>
              <span style={{ fontFamily: SANS, fontSize: 12, color: PAPER }}>Account</span>
            </div>
          </div>
          <AccountPopP who={who} />
          <HelpPanel />
        </div>
      </Frame>
      <Changes
        onCompare={onCompare}
        items={[
          ["Search → rail head", "It is how you go somewhere, and ⌘K works from anywhere."],
          ["Trade Journal → removed here", "It is already in the rail under Yours."],
          ["How to use, Blog, Contact support → Help & support", "One row with one badge, opening a four-item sub-menu."],
          ["Affiliates + Discord → Community", "Two outside places behind one row."],
          ["API + Connect An Agent → API & agents", "The same audience, one door."],
          ["Owner Dashboard tile → link beside the plan tag", "Still one click, no longer a large tile at the top of every owner menu."],
          ["Plan line → tag + Upgrade link", "A free account sees how to change that in the one place it is asked."],
        ]}
      />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   4 · SETTINGS · PROPOSED
   One page owns every preference. Searchable, one card per section, the same
   row pattern everywhere, and a Menu section that can hide, pin and reorder.
   ════════════════════════════════════════════════════════════════════════ */

type Page = { label: string; path: string };
type Shelf = { label: string; icon: string; items: Page[] };

const SHELVES: Shelf[] = [
  { label: "Education", icon: "?", items: [{ label: "Where To Start", path: "/start" }, { label: "How To Use Voltick", path: "/how-to-use" }, { label: "Learn", path: "/learn" }, { label: "FAQ", path: "/faq" }] },
  {
    label: "The Board",
    icon: "▦",
    items: ["Single", "Multi", "Chart", "Terminal", "Scanner", "Grid", "Replay"].map((l) => ({ label: l, path: `/${l.toLowerCase()}` })),
  },
  { label: "Flow", icon: "≈", items: [{ label: "Flow", path: "/flow" }] },
  {
    label: "Read The Market",
    icon: "≡",
    items: ["News Feed", "News Calendar", "Earnings", "The Daily", "Seasonality", "Expected Moves", "Filings", "Dividends"].map((l) => ({ label: l, path: `/${l.toLowerCase().replace(/ /g, "-")}` })),
  },
  { label: "Track Record", icon: "▤", items: [{ label: "Track Record", path: "/calibration" }] },
  {
    label: "Yours",
    icon: "☆",
    items: ["Today", "Trade Journal", "Your Fuse Agent", "Alerts", "Your Positions", "Your Levels"].map((l) => ({ label: l, path: `/${l.toLowerCase().replace(/ /g, "-")}` })),
  },
];

const MENU_PRESETS: Record<string, { label: string; hide: string[] }> = {
  everything: { label: "Everything", hide: [] },
  trader: { label: "Trader essentials", hide: ["/start", "/how-to-use", "/learn", "/faq", "/filings", "/dividends", "/seasonality", "/grid", "/terminal"] },
  minimal: {
    label: "Minimal",
    hide: ["/start", "/how-to-use", "/learn", "/faq", "/filings", "/dividends", "/seasonality", "/grid", "/terminal", "/multi", "/replay", "/news-feed", "/the-daily", "/expected-moves", "/your-fuse-agent", "/your-positions", "/your-levels", "/calibration"],
  },
};

type SecKey = "menu" | "chart" | "flow" | "display" | "notifications" | "account";
const SECTIONS: { key: SecKey; label: string; keywords: string }[] = [
  { key: "menu", label: "Left menu", keywords: "rail pages hide pin reorder start page" },
  { key: "chart", label: "Chart", keywords: "preset levels boldness layers trails watermark studies" },
  { key: "flow", label: "Flow", keywords: "tape default tab filters presets universe" },
  { key: "display", label: "Display", keywords: "colour blind tips ribbon compact" },
  { key: "notifications", label: "Notifications", keywords: "push email brief alerts" },
  { key: "account", label: "Account & plan", keywords: "email billing password delete" },
];

function MenuSection({ hidden, setHidden, pinned, setPinned, order, setOrder }: { hidden: Set<string>; setHidden: (s: Set<string>) => void; pinned: string[]; setPinned: (p: string[]) => void; order: string[]; setOrder: (o: string[]) => void }) {
  const [preset, setPreset] = useState("everything");
  const applyPreset = (k: string) => {
    setPreset(k);
    setHidden(new Set(MENU_PRESETS[k]!.hide));
  };
  const move = (label: string, d: -1 | 1) => {
    const i = order.indexOf(label);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const nx = [...order];
    [nx[i], nx[j]] = [nx[j]!, nx[i]!];
    setOrder(nx);
  };
  const flipPage = (p: string) => {
    const nx = new Set(hidden);
    if (nx.has(p)) nx.delete(p);
    else nx.add(p);
    setHidden(nx);
    setPreset("custom");
  };
  const flipPin = (p: string) => setPinned(pinned.includes(p) ? pinned.filter((x) => x !== p) : [...pinned, p].slice(0, 5));
  const shelves = order.map((l) => SHELVES.find((s) => s.label === l)!).filter(Boolean);
  const total = SHELVES.reduce((a, s) => a + s.items.length, 0);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Row label="Start with" hint="A starting point. Change any row below after.">
        <Seg value={preset} onChange={applyPreset} options={[["everything", "Everything"], ["trader", "Trader essentials"], ["minimal", "Minimal"], ...(preset === "custom" ? ([["custom", "Custom"]] as const) : [])]} />
      </Row>
      <Row label="Open Voltick on" hint="The page a new tab lands on">
        <Chip>Single board ▾</Chip>
      </Row>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET }}>
        {total - hidden.size} of {total} pages shown · ☆ pins a page to the top of the menu (up to 5) · ↑↓ reorders a shelf
      </div>
      {shelves.map((s, si) => (
        <div key={s.label} style={{ border: `1px solid ${LINE}`, borderRadius: R_MD, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: PANEL }}>
            <span style={{ width: 18, textAlign: "center" }}>{s.icon}</span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", color: PAPER, textTransform: "uppercase" }}>{s.label}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              <button type="button" disabled={si === 0} onClick={() => move(s.label, -1)} style={arrowBtn(si === 0)}>
                ↑
              </button>
              <button type="button" disabled={si === shelves.length - 1} onClick={() => move(s.label, 1)} style={arrowBtn(si === shelves.length - 1)}>
                ↓
              </button>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {s.items.map((p) => {
              const on = !hidden.has(p.path);
              const pin = pinned.includes(p.path);
              return (
                <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderTop: `1px solid ${LINE}` }}>
                  <Toggle on={on} onClick={() => flipPage(p.path)} />
                  <span style={{ flex: 1, fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: on ? PAPER : PAPER_QUIET, textDecoration: on ? "none" : "line-through" }}>{p.label}</span>
                  <button type="button" title="Pin to the top" disabled={!on} onClick={() => flipPin(p.path)} style={{ border: "none", background: "transparent", cursor: on ? "pointer" : "default", color: pin ? VOLT : PAPER_QUIET, fontSize: 14, opacity: on ? 1 : 0.3 }}>
                    {pin ? "★" : "☆"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const arrowBtn = (disabled: boolean): CSSProperties => ({ width: 24, height: 22, borderRadius: 6, border: `1px solid ${LINE}`, background: "transparent", color: PAPER, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.3 : 1 });

function RailPreview({ hidden, pinned, order }: { hidden: Set<string>; pinned: string[]; order: string[] }) {
  const all = SHELVES.flatMap((s) => s.items);
  const pinnedPages = pinned.map((p) => all.find((x) => x.path === p)).filter((x): x is Page => !!x && !hidden.has(x.path));
  const shelves = order.map((l) => SHELVES.find((s) => s.label === l)!).filter(Boolean);
  return (
    <div style={{ width: 180, minHeight: 520, display: "flex", flexDirection: "column", background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, overflow: "hidden" }}>
      <div style={{ padding: 10 }}>
        <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "6px 9px", display: "flex", justifyContent: "space-between" }}>
          ⌕ Search <span style={{ fontFamily: MONO, fontSize: 10 }}>⌘K</span>
        </div>
      </div>
      {pinnedPages.length > 0 && (
        <div style={{ paddingBottom: 6, marginBottom: 6, borderBottom: `1px solid ${LINE}` }}>
          {pinnedPages.map((p) => (
            <div key={p.path} style={{ display: "flex", alignItems: "center", height: 26, fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: PAPER }}>
              <span style={{ width: 40, textAlign: "center", color: VOLT }}>★</span>
              {p.label}
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, paddingBottom: 8 }}>
        {shelves.map((s) => {
          const kids = s.items.filter((p) => !hidden.has(p.path));
          if (!kids.length) return null;
          const leaf = s.items.length === 1;
          return (
            <div key={s.label} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", height: 28, fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: PAPER }}>
                <span style={{ width: 40, textAlign: "center" }}>{s.icon}</span>
                {leaf ? kids[0]!.label : s.label}
              </div>
              {!leaf &&
                kids.map((p) => (
                  <div key={p.path} style={{ height: 22, display: "flex", alignItems: "center", paddingLeft: 40, fontFamily: SANS, fontSize: 12, color: PAPER_QUIET }}>
                    {p.label}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsCard({ id, title, desc, children }: { id: string; title: string; desc: string; children: ReactNode }) {
  return (
    <section id={`set-${id}`} style={{ background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "16px 18px" }}>
      <div style={{ fontFamily: SANS, fontSize: 15, fontWeight: W_BOLD, color: PAPER }}>{title}</div>
      <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, marginTop: 3, marginBottom: 10 }}>{desc}</div>
      {children}
    </section>
  );
}

export function SettingsProposed({ onCompare }: { onCompare?: () => void } = {}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState<SecKey>("menu");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [pinned, setPinned] = useState<string[]>(["/flow", "/chart"]);
  const [order, setOrder] = useState<string[]>(() => SHELVES.map((s) => s.label));
  const [cb, setCb] = useState(false);
  const [tips, setTips] = useState(true);
  const [ribbon, setRibbon] = useState(true);
  const [compact, setCompact] = useState(false);
  const [push, setPush] = useState(true);
  const [brief, setBrief] = useState(false);
  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (k: SecKey) => !s || SECTIONS.find((x) => x.key === k)!.label.toLowerCase().includes(s) || SECTIONS.find((x) => x.key === k)!.keywords.includes(s);
  }, [q]);
  const visible = SECTIONS.filter((s) => match(s.key));
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Scorecard
        rows={[
          ["Places preferences live", "5+", 1],
          ["Left-menu controls", "hide", "hide · pin · reorder"],
        ]}
      />
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ width: 190, flex: "none", display: "grid", gap: 4, position: "sticky", top: 12 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search settings"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: SANS, fontSize: 12.5, color: PAPER, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "8px 10px", marginBottom: 6, outline: "none" }}
          />
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setActive(s.key)}
              style={{
                textAlign: "left",
                fontFamily: SANS,
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 12px",
                borderRadius: R_MD,
                cursor: "pointer",
                border: "none",
                color: match(s.key) ? PAPER : rgba(PAPER, 0.35),
                backgroundColor: "transparent",
                backgroundImage: active === s.key ? `linear-gradient(90deg, ${rgba(ACCENT, 0.24)}, ${rgba(ACCENT, 0.04)} 72%, transparent)` : "none",
                boxShadow: active === s.key ? `inset 2px 0 0 ${ACCENT}` : "none",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div style={{ flex: "1 1 460px", minWidth: 0, display: "grid", gap: 12 }}>
          {!visible.length && <Box>Nothing matches “{q}”.</Box>}
          {match("menu") && (
            <SettingsCard id="menu" title="Left menu" desc="Hide pages you never open, pin the ones you always do. Hidden pages stay reachable from search.">
              <MenuSection hidden={hidden} setHidden={setHidden} pinned={pinned} setPinned={setPinned} order={order} setOrder={setOrder} />
            </SettingsCard>
          )}
          {match("chart") && (
            <SettingsCard id="chart" title="Chart" desc="The defaults every chart opens with. The ⚙ Chart button changes the one you are looking at.">
              <Row label="Preset">
                <Seg value="full" options={[["full", "Full"], ["calm", "Calm"], ["minimal", "Minimal"]] as const} />
              </Row>
              <Row label="Layers and studies" hint="Same panel as ⚙ Chart, opened here">
                <Chip>Open ⚙ Chart settings</Chip>
              </Row>
            </SettingsCard>
          )}
          {match("flow") && (
            <SettingsCard id="flow" title="Flow" desc="How the tape opens.">
              <Row label="Open on">
                <Seg value="tape" options={[["tape", "Tape"], ["patterns", "Patterns"], ["market", "Market"], ["dark", "Dark Pool"]] as const} />
              </Row>
              <Row label="Universe">
                <Seg value="stocks" options={[["stocks", "Stocks"], ["etfs", "ETFs"], ["all", "All"]] as const} />
              </Row>
              <Row label="Start with preset" hint="Your saved filters">
                <Chip>None ▾</Chip>
              </Row>
            </SettingsCard>
          )}
          {match("display") && (
            <SettingsCard id="display" title="Display" desc="Applies to every page.">
              <Row label="Colour-blind palette" hint="Moved here from the ◑ CB button on each page">
                <Toggle on={cb} onClick={() => setCb(!cb)} />
              </Row>
              <Row label="Hover tips">
                <Toggle on={tips} onClick={() => setTips(!tips)} />
              </Row>
              <Row label="Plain-English ribbon">
                <Toggle on={ribbon} onClick={() => setRibbon(!ribbon)} />
              </Row>
              <Row label="Compact rows" hint="Tighter tables on Flow and the scanner">
                <Toggle on={compact} onClick={() => setCompact(!compact)} />
              </Row>
            </SettingsCard>
          )}
          {match("notifications") && (
            <SettingsCard id="notifications" title="Notifications" desc="Where alerts reach you. Which alerts fire lives on the Alerts page.">
              <Row label="Push on this device">
                <Toggle on={push} onClick={() => setPush(!push)} />
              </Row>
              <Row label="Morning brief email">
                <Toggle on={brief} onClick={() => setBrief(!brief)} />
              </Row>
              <Row label="Your alerts">
                <Chip>Open Alerts →</Chip>
              </Row>
            </SettingsCard>
          )}
          {match("account") && (
            <SettingsCard id="account" title="Account & plan" desc="The only settings that follow you to every device.">
              <Row label="Email">
                <span style={{ fontFamily: MONO, fontSize: 12, color: PAPER }}>member@example.com</span>
              </Row>
              <Row label="Password">
                <Chip>Change</Chip>
              </Row>
              <Row label="Plan" hint="Voltick membership">
                <Chip>Manage billing</Chip>
              </Row>
              <Row label="Delete account">
                <Chip tone={BAD} on>
                  Delete…
                </Chip>
              </Row>
            </SettingsCard>
          )}
        </div>

        <Frame title="Preview · your left menu" style={{ flex: "none", position: "sticky", top: 12 }}>
          <RailPreview hidden={hidden} pinned={pinned} order={order} />
        </Frame>
      </div>
      <Changes
        onCompare={onCompare}
        items={[
          ["Five sections in tabs → one page of cards", "Scroll or search. Nothing is hidden behind a tab you did not open."],
          ["Search settings", "Type “watermark” or “billing” and only the matching card stays."],
          ["Left menu: hide → hide, pin, reorder", "Pins sit at the top of the rail under search. Shelves move with ↑↓."],
          ["Start with: Everything · Trader essentials · Minimal", "A starting point instead of 27 switches. Any change shows Custom."],
          ["Open Voltick on", "Moved from Board into Left menu: it is a question about where you land."],
          ["Chart defaults + ⚙ Chart", "Settings holds the defaults, the chart button changes the one on screen, and both open the same panel."],
          ["◑ CB → Display", "One switch for every page instead of a button on each."],
          ["Notifications say where, Alerts say what", "The line that stops the two pages drifting apart."],
        ]}
      />
    </div>
  );
}
