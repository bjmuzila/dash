/**
 * The OLD menus: what Voltick ships today, drawn as clickable pictures for the
 * left/right comparison on the Mockups page. Labels are copied from Voltick's
 * own source (HeatChart.jsx, pages/Flow.jsx, AccountMenu.jsx, pages/Settings.jsx).
 *
 * <Mark> wrappers light up what moves or goes when the page's "Show changes"
 * switch is on; with it off these render exactly as before.
 */
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Mark } from "./mockupsMark";
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

/* ── shared primitives · each mirrors the inline style of the real control ── */

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

function OnOff({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: SANS,
        fontSize: 12,
        fontWeight: 700,
        padding: "5px 11px",
        borderRadius: 9,
        cursor: "pointer",
        flexShrink: 0,
        border: `1px solid ${on ? ACCENT : LINE}`,
        background: on ? rgba(ACCENT, 0.2) : "transparent",
        color: on ? ACCENT_TEXT : PAPER,
      }}
    >
      {on ? "✓ On" : "Off"}
    </button>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: 38,
        height: 22,
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        position: "relative",
        background: on ? ACCENT : rgba(PAPER, 0.18),
        transition: "background .15s",
      }}
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

function SecHead({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        margin: "16px 0 2px",
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: PAPER_QUIET,
      }}
    >
      {children}
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: LINE }} />
    </div>
  );
}

function Row({ label, children, indent = false }: { label: string; children?: ReactNode; indent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: `9px 0 9px ${indent ? 12 : 0}px`, fontFamily: SANS }}>
      <span style={{ fontSize: indent ? 12 : 12.5, fontWeight: 700, color: PAPER, whiteSpace: "nowrap" }}>{label}</span>
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

function Pop({ width = 348, children }: { width?: number; children: ReactNode }) {
  return (
    <div style={{ width, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "11px 14px", boxShadow: "0 14px 40px rgba(0,0,0,0.5)" }}>
      {children}
    </div>
  );
}


function Menu({ items, value, width = 180 }: { items: string[]; value?: string; width?: number }) {
  return (
    <div style={{ width, background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: 5, boxShadow: "0 14px 40px rgba(0,0,0,0.5)", display: "grid", gap: 1 }}>
      {items.map((it) => (
        <div key={it} style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 600, padding: "7px 10px", borderRadius: 8, color: PAPER, background: it === value ? rgba(ACCENT, 0.18) : "transparent" }}>
          {it}
        </div>
      ))}
    </div>
  );
}

function Box({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ background: rgba(PAPER, 0.02), border: `1px solid ${LINE}`, borderRadius: R_LG, padding: "14px 16px", ...style }}>{children}</div>;
}


const Bar = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG }}>{children}</div>
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





/* ════════════════════════════════════════════════════════════════════════
   1 · CHART ⚙ STYLE
   ════════════════════════════════════════════════════════════════════════ */

// HeatChart.jsx CALM_ROWS. The button above them says "Fine tune the six" and
// there are EIGHT rows under it, noted on the board rather than fixed here.
const CALM_ROWS = [
  "No volume bars",
  "Rail tags on one line",
  "Ribbons fade toward history",
  "Ribbons grow and shrink with the level",
  "Session ranges as hairlines",
  "Session captions at the foot",
  "Volume in its own strip",
  "Watermark in the corner",
];

const IND_ROWS: { name: string; color: string; desc: string; params?: string[] }[] = [
  { name: "VWAP", color: PAPER, desc: "Volume-weighted average price · the day's true VWAP." },
  { name: "VWAP bands", color: PAPER_QUIET, desc: "Standard-deviation bands around the session VWAP.", params: ["2σ", "2.5σ"] },
  { name: "RSI", color: ACCENT_TEXT, desc: "A 0 to 100 momentum meter in its own strip. Near 70 = hot, near 30 = cold.", params: ["14"] },
  { name: "MACD", color: ACCENT_TEXT, desc: "Momentum from the gap between a fast and slow EMA, in its own strip.", params: ["12", "26", "9"] },
  { name: "Williams %R", color: VOLT, desc: "A 0 to −100 momentum meter in its own strip.", params: ["14"] },
];

function StyleTabBody() {
  const [trails, setTrails] = useState(true);
  const [shape, setShape] = useState<"core" | "profile" | "ribbon" | "path" | "pathband">("path");
  const [bubbles, setBubbles] = useState<"all" | "key">("key");
  const [density, setDensity] = useState<"full" | "calm" | "minimal">("full");
  const [fine, setFine] = useState(false);
  const [calm, setCalm] = useState<boolean[]>(() => CALM_ROWS.map(() => false));
  const [g, setG] = useState(24);
  const [n, setN] = useState(43);
  const [dp, setDp] = useState(0);
  const [shown, setShown] = useState(6);
  const [keyOnly, setKeyOnly] = useState(false);
  const [len, setLen] = useState<"ext" | "small" | "label">("ext");
  const [prior, setPrior] = useState(true);
  const [priorN, setPriorN] = useState<"1" | "3" | "5">("3");
  const [prev, setPrev] = useState(true);
  const [pre, setPre] = useState(false);
  const [orng, setOrng] = useState(false);
  const [over, setOver] = useState<"5" | "15" | "30">("15");
  const [ext, setExt] = useState(true);
  const [wm, setWm] = useState(true);
  return (
    <>
      <Mark tone="moved" tag="→ footer" block>
        <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: PAPER_QUIET, marginBottom: 6 }}>YOUR DEVICE REMEMBERS</div>
      </Mark>
      <SecHead>Level trails</SecHead>
      <Mark tone="moved" tag="→ Layers" block>
      <Row label="Level trails">
        <OnOff on={trails} onClick={() => setTrails(!trails)} />
      </Row>
      {trails && (
        <>
          <div style={{ margin: "9px 0 9px 12px", display: "grid", gap: 6 }}>
            <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: PAPER }}>Trail shape</span>
            <Seg value={shape} onChange={setShape} size={11.5} options={[["core", "Core"], ["profile", "Profile"], ["ribbon", "Ribbon"], ["path", "Path"], ["pathband", "Path Ribbon"]] as const} />
          </div>
          <Mark tone="gone" tag="removed" block>
          <Row label="Bubble rows" indent>
            <Seg value={bubbles} onChange={setBubbles} options={[["all", "All"], ["key", "Key only"]] as const} />
          </Row>
          </Mark>
          <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER, lineHeight: 1.5, margin: "0 0 4px 12px" }}>
            Thicker where a level grew, thinner where it shrank. Brighter means a bigger day. Recorded history, not a forecast.
          </div>
        </>
      )}
      </Mark>
      <SecHead>Density</SecHead>
      <Mark tone="moved" tag="→ Look · preset cards" block>
      <Row label="Density">
        <Seg
          value={density}
          onChange={(v) => {
            setDensity(v);
            setFine(false);
          }}
          options={[["full", "Full"], ["calm", "Calm"], ["minimal", "Minimal"]] as const}
        />
      </Row>
      </Mark>
      <Mark tone="gone" tag="dissolved into Layers" block>
      <button
        type="button"
        onClick={() => setFine(!fine)}
        style={{ width: "100%", padding: "8px 10px", borderRadius: 9, border: `1px dashed ${LINE}`, background: "transparent", color: PAPER_QUIET, cursor: "pointer", fontFamily: SANS, fontSize: 11.5, fontWeight: 600 }}
      >
        Fine tune the six {fine ? "▴" : "▾"}
      </button>
      {fine &&
        CALM_ROWS.map((lbl, i) => (
          <Row key={lbl} label={lbl} indent>
            <OnOff on={!!calm[i]} onClick={() => setCalm(calm.map((v, j) => (j === i ? !v : v)))} />
          </Row>
        ))}
      </Mark>
      <SecHead>How bold</SecHead>
      <Mark tone="moved" tag="→ Look · folded" block>
      <Slider label="Gamma levels" value={g} onChange={setG} color={ACCENT} />
      <Slider label="Node levels" value={n} onChange={setN} color={VOLT} />
      <Slider label="Dark pool" value={dp} onChange={setDp} color={DARK_POOL} />
      </Mark>
      <SecHead>Which lines</SecHead>
      <Slider label="Levels shown" value={shown} onChange={setShown} color={GOOD} min={4} max={14} suffix="" />
      <Row label="Key levels only">
        <OnOff on={keyOnly} onClick={() => setKeyOnly(!keyOnly)} />
      </Row>
      <Row label="Line length">
        <Seg value={len} onChange={setLen} options={[["ext", "Extended"], ["small", "Small"], ["label", "Labels"]] as const} />
      </Row>
      <Mark tone="moved" tag="→ Layers" block>
      <Row label="Prior levels">
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {prior && <Seg value={priorN} onChange={setPriorN} options={[["1", "1"], ["3", "3"], ["5", "5"]] as const} />}
          <OnOff on={prior} onClick={() => setPrior(!prior)} />
        </span>
      </Row>
      {prior && (
        <div style={{ fontFamily: SANS, fontSize: 11, color: PAPER, lineHeight: 1.5, margin: "-2px 0 4px" }}>
          <b style={{ color: rgba(VOLT, 0.85) }}>--- ★</b> prior Volt · <b style={{ color: rgba(GOOD, 0.85) }}>--- ‖</b> prior ceiling · <b style={{ color: rgba(BAD, 0.85) }}>--- ‖</b> prior floor · faded by age.
        </div>
      )}
      </Mark>
      <SecHead>Session ranges</SecHead>
      <Mark tone="moved" tag="→ Layers · one row" block>
      <Row label="Previous day">
        <OnOff on={prev} onClick={() => setPrev(!prev)} />
      </Row>
      <Row label="Pre-market">
        <OnOff on={pre} onClick={() => setPre(!pre)} />
      </Row>
      <Row label="Opening range">
        <OnOff on={orng} onClick={() => setOrng(!orng)} />
      </Row>
      {orng && (
        <Row label="Measured over" indent>
          <Seg value={over} onChange={setOver} options={[["5", "5m"], ["15", "15m"], ["30", "30m"]] as const} />
        </Row>
      )}
      </Mark>
      <Mark tone="moved" tag="→ Layers" block>
      <Row label="Extended hours">
        <OnOff on={ext} onClick={() => setExt(!ext)} />
      </Row>
      </Mark>
      <SecHead>Watermark</SecHead>
      <Mark tone="moved" tag="→ Layers" block>
      <Row label="Watermark">
        <OnOff on={wm} onClick={() => setWm(!wm)} />
      </Row>
      </Mark>
    </>
  );
}

type MaLine = { id: number; p: number; on: boolean };

function IndicatorsTabBody() {
  const [ma, setMa] = useState<Record<"emas" | "smas", MaLine[]>>({
    emas: [
      { id: 1, p: 9, on: true },
      { id: 2, p: 21, on: false },
    ],
    smas: [],
  });
  const [on, setOn] = useState<Record<string, boolean>>({ VWAP: true });
  const add = (k: "emas" | "smas") => setMa({ ...ma, [k]: [...ma[k], { id: Date.now(), p: k === "emas" ? 9 : 20, on: true }] });
  const lines = [
    ["emas", "EMA · exponential", ACCENT_TEXT],
    ["smas", "SMA · simple", VOLT],
  ] as const;
  return (
    <>
      {lines.map(([k, title, color]) => (
        <div key={k}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 4px" }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: PAPER }}>{title}</span>
            <button type="button" onClick={() => add(k)} style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: PAPER, border: `1px solid ${LINE}`, borderRadius: 8, padding: "3px 10px", background: "transparent", cursor: "pointer" }}>
              ＋ Add
            </button>
          </div>
          {!ma[k].length && <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER, padding: "2px 8px 8px" }}>None yet · tap Add</div>}
          {ma[k].map((x) => (
            <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 8px", borderRadius: 10, background: x.on ? rgba(color, 0.08) : "transparent" }}>
              <Toggle on={x.on} onClick={() => setMa({ ...ma, [k]: ma[k].map((y) => (y.id === x.id ? { ...y, on: !y.on } : y)) })} />
              <span style={{ width: 11, height: 3, borderRadius: 2, background: color }} />
              <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: PAPER, width: 32 }}>{k === "emas" ? "EMA" : "SMA"}</span>
              <span style={{ width: 44, fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: PAPER, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: "3px 6px", textAlign: "center" }}>{x.p}</span>
              <span style={{ width: 28, height: 24, borderRadius: 8, border: `1px solid ${LINE}`, background: color }} />
              <button
                type="button"
                onClick={() => setMa({ ...ma, [k]: ma[k].filter((y) => y.id !== x.id) })}
                style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: 8, border: `1px solid ${LINE}`, background: "transparent", color: PAPER, cursor: "pointer", fontWeight: 700 }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
      <div style={{ height: 1, background: LINE, margin: "8px 4px" }} />
      {IND_ROWS.map(({ name, color, desc, params }) => (
        <div key={name} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 8px", borderRadius: 10, background: on[name] ? rgba(color, 0.08) : "transparent" }}>
          <Toggle on={!!on[name]} onClick={() => setOn({ ...on, [name]: !on[name] })} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 12, height: 3, borderRadius: 2, background: color }} />
              <span style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: PAPER }}>{name}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                {(params || []).map((p) => (
                  <span key={p} style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: PAPER, border: `1px solid ${LINE}`, borderRadius: 7, padding: "2px 7px", background: PANEL }}>
                    {p}
                  </span>
                ))}
              </span>
            </div>
            <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER, marginTop: 4, lineHeight: 1.4 }}>{desc}</div>
          </div>
        </div>
      ))}
    </>
  );
}

function DrawTabBody() {
  const [drawing, setDrawing] = useState(false);
  const [lines, setLines] = useState(2);
  const btn: CSSProperties = { flex: 1, fontFamily: SANS, fontSize: 12.5, fontWeight: 700, padding: "7px 11px", borderRadius: 10, border: `1px solid ${LINE}`, background: "transparent", color: PAPER, cursor: "pointer" };
  return (
    <div style={{ display: "grid", gap: 11 }}>
      <div>
        <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: PAPER_QUIET, marginBottom: 7 }}>COLOUR</div>
        <div style={{ height: 30, border: `1px solid ${LINE}`, borderRadius: 8, background: VOLT }} />
      </div>
      <button
        type="button"
        onClick={() => setDrawing(!drawing)}
        style={{ fontFamily: SANS, fontSize: 13, fontWeight: 700, padding: "9px 12px", borderRadius: 10, cursor: "pointer", border: `1px solid ${drawing ? ACCENT : LINE}`, background: drawing ? rgba(ACCENT, 0.18) : "transparent", color: drawing ? ACCENT_TEXT : PAPER }}
      >
        ✎ {drawing ? "Drawing · tap to stop" : "Start drawing"}
      </button>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={btn} onClick={() => setLines(Math.max(0, lines - 1))}>
          ⤺ Undo
        </button>
        <button type="button" style={btn} onClick={() => setLines(0)}>
          Clear
        </button>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET, lineHeight: 1.55 }}>
        {lines ? `${lines} line${lines === 1 ? "" : "s"} on this symbol · they follow the browser, not the account.` : "Nothing drawn on this symbol yet."}
      </div>
    </div>
  );
}

function StylePopover({ start }: { start: "style" | "ind" | "draw" }) {
  const [tab, setTab] = useState(start);
  return (
    <Pop>
      <div style={{ marginBottom: 8 }}>
        <Mark tone="moved" tag="Indicators → Studies · Draw → toolbar">
          <Seg value={tab} onChange={setTab} options={[["style", "Style"], ["ind", "Indicators"], ["draw", "Draw"]] as const} />
        </Mark>
      </div>
      {tab === "style" ? <StyleTabBody /> : tab === "ind" ? <IndicatorsTabBody /> : <DrawTabBody />}
    </Pop>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2 · FLOW TOOLBARS
   ════════════════════════════════════════════════════════════════════════ */

type FlowView = "options" | "repeats" | "oneshots" | "roster" | "quiet" | "oi" | "leaders" | "sectors" | "drift" | "premium" | "dark" | "cross";

const FLOW_GROUPS: { key: string; label: string; views: [FlowView, string][] }[] = [
  {
    key: "tape",
    label: "⚡︎ The Tape",
    views: [
      ["options", "⚡︎ Options Flow"],
      ["repeats", "⟳ Repeated"],
      ["oneshots", "▮ One-Shots"],
      ["roster", "▲ Being Built"],
      ["quiet", "⌁ Waking Up"],
    ],
  },
  { key: "oi", label: "Δ OI Changes", views: [["oi", "Δ OI Changes"]] },
  { key: "market", label: "◉ Most Active", views: [["leaders", "Leaders"]] },
  { key: "sectors", label: "▤ Sector Flow", views: [["sectors", "Sector Flow"]] },
  { key: "drift", label: "✦ Net Drift", views: [["drift", "Net Drift"]] },
  { key: "premium", label: "$ Premium", views: [["premium", "Premium by Expiry"]] },
  {
    key: "dark",
    label: "◐ Dark Pool",
    views: [
      ["dark", "◐ Dark Pool Flow"],
      ["cross", "⧖ Cross-Confirm"],
    ],
  },
];

const DAYS = ["0DTE", "1 to 30", "31 to 90", "90+"];

const DD = ({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick?: () => void }) => (
  <Chip on={on} onClick={onClick}>
    {children} ▾
  </Chip>
);

function StatsStrip() {
  const [sort, setSort] = useState<"new" | "big">("new");
  const [paused, setPaused] = useState(false);
  const cell: CSSProperties = { padding: "10px 14px", borderLeft: `1px solid ${LINE}`, minWidth: 120 };
  const lab: CSSProperties = { fontFamily: SANS, fontSize: 11, color: PAPER_QUIET, marginBottom: 4 };
  const big = (c: string): CSSProperties => ({ fontFamily: MONO, fontSize: 20, fontWeight: W_DATA, color: c });
  return (
    <Mark tone="moved" tag="→ one summary line" block>
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG, overflow: "hidden" }}>
      <div style={{ ...cell, borderLeft: "none" }}>
        <div style={lab}>
          Net premium <span style={{ color: GOOD, border: `1px solid ${rgba(GOOD, 0.4)}`, borderRadius: 99, padding: "0 7px", marginLeft: 4 }}>▲ Bought</span>
        </div>
        <div style={big(GOOD)}>+$17.7M</div>
        <div style={{ ...lab, marginTop: 4 }}>of $331M with a clear buyer or seller</div>
      </div>
      <div style={cell}>
        <div style={lab}>Prints</div>
        <div style={big(PAPER)}>14,789</div>
        <div style={{ ...lab, marginTop: 4 }}>
          Swept · in a hurry <b style={{ color: ACCENT_TEXT }}>7%</b>
        </div>
      </div>
      <div style={cell}>
        <div style={lab}>Call $ · Put $</div>
        <span style={big(GOOD)}>$692M</span> <span style={big(BAD)}>$200M</span>
      </div>
      <div style={cell}>
        <div style={lab}>Buys · Sells</div>
        <span style={big(GOOD)}>$174M</span> <span style={big(BAD)}>$157M</span>
        <div style={{ ...lab, marginTop: 4 }}>Put / call 0.41 · two-sided · neither in control</div>
      </div>
      <div style={{ ...cell, display: "flex", gap: 8, alignItems: "center" }}>
        <Seg value={sort} onChange={setSort} options={[["new", "⏱ Newest"], ["big", "＄ Biggest"]] as const} />
        <Mark tone="moved" tag="→ Live menu">
        <Chip on={paused} tone={VOLT} onClick={() => setPaused(!paused)}>
          {paused ? "▶ Resume" : "❚❚ Pause"}
        </Chip>
        </Mark>
      </div>
    </div>
    </Mark>
  );
}

const FILTER_ROWS: [string, string[]][] = [
  ["Presets", ["Whales $250K+", "Big LEAPs $500K+"]],
  ["Direction", ["Both", "Bullish", "Bearish"]],
  ["Type", ["Calls", "Puts"]],
  ["Fill", ["Buys", "Sells"]],
  ["Size", ["$50K+", "$250K+", "$500K+", "$1M+"]],
  ["OI under", ["500", "1K", "2.5K"]],
  ["Volume over", ["500", "1K", "2K", "5K"]],
  ["Vol/OI over", ["1x", "2x", "3x", "5x", "10x"]],
  ["Days out", DAYS],
  ["Expiry", ["Any date ▾"]],
  ["Contract price", ["Any price ▾"]],
];

function FiltersPanel() {
  const [sel, setSel] = useState<Record<string, string | null>>({ Direction: "Both" });
  return (
    <Box style={{ display: "grid", gap: 8 }}>
      {FILTER_ROWS.map(([k, opts]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ width: 110, fontFamily: MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: PAPER_QUIET, textTransform: "uppercase" }}>{k}</span>
          {opts.map((o) => (
            <Chip key={o} on={sel[k] === o} onClick={() => setSel({ ...sel, [k]: sel[k] === o ? null : o })} style={{ padding: "4px 10px", fontSize: 11.5 }}>
              {o}
            </Chip>
          ))}
        </div>
      ))}
    </Box>
  );
}

function PresetsPop() {
  return (
    <Pop width={340}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", color: PAPER_QUIET, marginBottom: 8 }}>PRESETS · OPTIONS TAPE</div>
      {[
        ["Whales", "$250K+ · at ask · bullish"],
        ["Morning sweep", "$500K+ · 0DTE"],
      ].map(([nm, s]) => (
        <div key={nm} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, background: rgba(PAPER, 0.03), marginBottom: 4 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: 700, color: PAPER }}>{nm}</div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: PAPER_QUIET }}>{s}</div>
          </div>
          <span style={{ marginLeft: "auto", color: PAPER_QUIET }}>✕</span>
        </div>
      ))}
      <div style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: ACCENT_TEXT, padding: "8px 8px 4px" }}>＋ Save the chips that are on now as…</div>
      <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, padding: "4px 8px" }}>Clear every filter on this board</div>
    </Pop>
  );
}

function OptionsFlowToolbar() {
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [open, setOpen] = useState<null | "names" | "presets" | "live">(null);
  const t = (k: string) => setOn({ ...on, [k]: !on[k] });
  const tog = (k: "names" | "presets" | "live") => setOpen(open === k ? null : k);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <StatsStrip />
      <Bar>
        <Field ph="Search ticker…" />
        <DD on={open === "names"} onClick={() => tog("names")}>
          Stocks
        </DD>
        <span style={{ width: 1, height: 22, background: LINE }} />
        <Mark tone="moved" tag="→ Filters">
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: PAPER_QUIET }}>SIZE</span>
        {["Mega", "Large", "Mid", "Small"].map((c) => (
          <Chip key={c} on={on[c]} onClick={() => t(c)} style={{ padding: "4px 9px" }}>
            {c}
          </Chip>
        ))}
        </span>
        </Mark>
        <Mark tone="moved" tag="→ one switch">
        <span style={{ display: "inline-flex", gap: 8 }}>
        <Chip on={on.up} tone={GOOD} onClick={() => t("up")}>
          ▲
        </Chip>
        <Chip on={on.dn} tone={BAD} onClick={() => t("dn")}>
          ▼
        </Chip>
        </span>
        </Mark>
        <Chip on={on.unu} tone={VOLT} onClick={() => t("unu")}>
          ★ Unusual
        </Chip>
        <Chip on={on.dte} onClick={() => t("dte")}>
          ⚡︎ 0DTE
        </Chip>
        <Chip on={on.lvl} onClick={() => t("lvl")}>
          ⌖ On a level
        </Chip>
        <Chip on={on.wl} onClick={() => t("wl")}>
          ★ My watchlist
        </Chip>
        <Mark tone="moved" tag="→ Filters">
        <Chip on={on.out} onClick={() => t("out")}>
          ⌥ Outright only
        </Chip>
        </Mark>
        <Chip on={showFilters} onClick={() => setShowFilters(!showFilters)}>
          ⚙ Filters {showFilters ? "▴" : "▾"}
        </Chip>
        <Mark tone="moved" tag="→ inside Filters">
        <DD on={open === "presets"} onClick={() => tog("presets")}>
          ★ Presets
        </DD>
        </Mark>
        <Mark tone="gone" tag="→ Patterns tab">
        <Chip>⟳ Repeated · 1162</Chip>
        </Mark>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <DD on={open === "live"} onClick={() => tog("live")}>
            <span style={{ color: GOOD }}>●</span> Live
          </DD>
          <Mark tone="moved" tag="→ Settings">
          <Chip>◑ CB</Chip>
          </Mark>
        </span>
      </Bar>
      {open === "names" && <Menu value="Stocks" items={["Stocks", "ETFs", "All"]} />}
      {open === "presets" && <PresetsPop />}
      {open === "live" && <Menu value="● Live" items={["● Live", "↺ 2026-09-24", "↺ 2026-09-23", "↺ 2026-09-22"]} />}
      {showFilters && <FiltersPanel />}
      <Mark tone="moved" tag="→ search box" block>
      <Bar>
        <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: PAPER }}>Find a contract</span>
        <Field ph="Strike" w={80} />
        <Field ph="YYYY-MM-DD" w={120} />
        <Seg value="C" options={[["C", "C"], ["P", "P"]] as const} />
        <Chip>Open</Chip>
        <span style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET }}>type a ticker above first</span>
      </Bar>
      </Mark>
      <Heads cols={["Time", "Premium", "Symbol", "Spot", "Strike", "Type", "Level", "Expiring", "Read", "Execution", "Price", "Size", "Score", "Vol/OI", "Volume", "Open Int"]} />
    </div>
  );
}

function TickerRow() {
  return (
    <Bar>
      <Field ph="Ticker" w={110} />
      <Seg value="both" options={[["both", "Both"], ["bull", "Bullish"], ["bear", "Bearish"]] as const} />
      {DAYS.map((d) => (
        <Chip key={d} style={{ padding: "4px 9px" }}>
          {d}
        </Chip>
      ))}
    </Bar>
  );
}

function ViewToolbar({ view }: { view: FlowView }) {
  const quick = (list: string[]) =>
    list.map((s) => (
      <Chip key={s} style={{ padding: "4px 8px" }}>
        {s}
      </Chip>
    ));
  const live = (
    <DD>
      <span style={{ color: GOOD }}>●</span> Live
    </DD>
  );
  const stack = (...kids: ReactNode[]) => <div style={{ display: "grid", gap: 10 }}>{kids}</div>;
  switch (view) {
    case "options":
      return <OptionsFlowToolbar />;
    case "repeats":
      return stack(
        <TickerRow key="t" />,
        <Bar key="b">
          <DD>★ Presets</DD>
          <DD>⊘ Hide · 3</DD>
          <DD>Stocks</DD>
          <Chip>⊙ Building</Chip>
          <Chip>◑ ITM off</Chip>
          <Chip>↑ Vol &gt; OI</Chip>
          <DD>Any premium</DD>
          <DD>Any price</DD>
          <Chip>⚙ Rolls &amp; financing off</Chip>
          <Chip>⌃ 80% at ask</Chip>
          <Seg value="all" options={[["all", "≡ All contracts"], ["name", "▤ By name"]] as const} />
          <Chip>⧉ Copy</Chip>
        </Bar>,
        <Heads key="h" cols={["Ticker", "Position", "Shape", "Last print", "Hits", "Span", "Vol/OI", "Premium", "Size", "Price"]} />,
      );
    case "oneshots":
      return stack(
        <TickerRow key="t" />,
        <Bar key="b">
          <Chip>⌃ 80% at ask</Chip>
          <Chip>◑ No ITM</Chip>
          <DD>Any premium</DD>
          <DD>Any price</DD>
          <Chip>⏱ Time order</Chip>
          <DD>★ Presets</DD>
        </Bar>,
        <Heads key="h" cols={["Time", "Symbol", "Contract", "Level", "Expiring", "Premium", "Size", "Fill", "Vol/OI", "Price"]} />,
      );
    case "roster":
      return (
        <Bar>
          <DD>Stocks</DD>
          <Chip>≥80% at ask</Chip>
          <Seg value="10d" options={[["5d", "5d"], ["10d", "10d"], ["20d", "20d"], ["40d", "40d"]] as const} />
        </Bar>
      );
    case "quiet":
      return stack(
        <Bar key="b">
          <Chip>⌃ 80% at ask</Chip>
          <Chip>$500K+</Chip>
          <Chip>◑ ITM in</Chip>
          <DD>★ Presets</DD>
          {quick(["0DTE", "1-30d", "31-90d", "90d+"])}
        </Bar>,
        <Heads key="h" cols={["Ticker", "What kind of loud", "Who reached", "Calls / puts", "Biggest contract", "Premium today", "Normal by now", "× on premium", "Prints", "× on prints", "Sessions"]} />,
      );
    case "oi":
      return (
        <Box>
          <span style={{ fontFamily: SANS, fontSize: 13, color: PAPER_QUIET }}>Δ OI Changes is its own page component. Its controls get captured in a follow-up pass.</span>
        </Box>
      );
    case "leaders":
      return stack(
        <Bar key="b">
          <span style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET }}>Sectors · 11 · tap to filter</span>
          <Chip>All sectors</Chip>
          <Chip>☆ My watchlist 0</Chip>
        </Bar>,
        <Heads key="h" cols={["Board", "Sector", "Price", "Premium", "Lean", "Pace", "Prints"]} />,
      );
    case "sectors":
      return (
        <Bar>
          <Seg value="today" options={[["today", "Today"], ["week", "Week"], ["month", "Month"]] as const} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: PAPER_QUIET }}>SORT</span>
          <Seg value="act" options={[["act", "Activity"], ["net", "Net"], ["move", "% Move"]] as const} />
        </Bar>
      );
    case "drift":
      return (
        <Bar>
          <Field ph="Ticker" w={110} />
          {quick(["SPY", "QQQ", "IWM", "NVDA", "TSLA", "AAPL", "AMZN", "META", "MSFT", "GOOGL", "AMD", "PLTR"])}
          {live}
          <DD>Core strikes</DD>
          <Chip>＋ Show Calls &amp; Puts</Chip>
        </Bar>
      );
    case "premium":
      return stack(
        <Bar key="b">
          <Field ph="Ticker" w={110} />
          {quick(["SPY", "QQQ", "IWM", "NVDA", "TSLA"])}
          {live}
        </Bar>,
        <Heads key="h" cols={["Expires", "DTE", "Total", "Size", "Calls", "Calls versus puts", "Puts", "Call %"]} />,
      );
    case "dark":
      return stack(
        <Bar key="b">
          <Seg value="tape" options={[["tick", "◧ By ticker"], ["tape", "⚡︎ Live tape"], ["lead", "★ Leaders"]] as const} />
          <Seg value="all" options={[["all", "All"], ["50", "50K+"], ["100", "100K+"], ["250", "250K+"]] as const} />
          <Seg value="time" options={[["time", "Time"], ["score", "◆ Score"]] as const} />
          <Chip>★ Standout</Chip>
          <span style={{ color: GOOD, fontFamily: SANS, fontSize: 12 }}>● live</span>
        </Bar>,
        <Heads key="h" cols={["Time", "Stock", "Price", "Level", "Size", "Notional", "Score", "Day Volume", "% of Day", "Venue", "Why it scored"]} />,
      );
    case "cross":
      return (
        <Box>
          <span style={{ fontFamily: SANS, fontSize: 13, color: PAPER_QUIET }}>⧖ Cross-Confirm has no controls: a list of cards.</span>
        </Box>
      );
  }
}

/* ════════════════════════════════════════════════════════════════════════
   3 · ACCOUNT MENU (bottom-left of the rail)
   ════════════════════════════════════════════════════════════════════════ */

type Who = "member" | "owner" | "free";

function AccountPop({ who }: { who: Who }) {
  const admin = who === "owner";
  const member = who !== "free";
  const plan: [string, string] = admin ? ["VOLTICK · OWNER", VOLT] : member ? ["Voltick member", GOOD] : ["Free account", PAPER_QUIET];
  const sec = (t: string) => (
    <div style={{ fontFamily: MONO, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: PAPER_QUIET, padding: "9px 12px 4px", textTransform: "uppercase" }}>{t}</div>
  );
  const row = (icon: string, label: string, right?: ReactNode, danger = false) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: R_MD, fontFamily: SANS, fontSize: 13, fontWeight: W_MED, color: danger ? BAD : PAPER }}>
      <span aria-hidden="true" style={{ width: 16, textAlign: "center" }}>
        {icon}
      </span>
      <span>{label}</span>
      {right}
    </div>
  );
  return (
    <div style={{ width: 256, display: "flex", flexDirection: "column", gap: 1, padding: 6, background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, boxShadow: "0 16px 44px rgba(0,0,0,0.6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 13px 14px", borderBottom: `1px solid ${LINE}`, marginBottom: 2 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: ACCENT, border: `1px solid ${rgba(ACCENT, 0.33)}`, color: PAPER, fontFamily: MONO, fontWeight: W_DATA, fontSize: 15 }}>
          B
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: SANS, fontSize: 12.5, fontWeight: W_BOLD, color: PAPER }}>member@example.com</div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.05em", color: plan[1], marginTop: 3 }}>● {plan[0]}</div>
        </div>
      </div>
      {admin && (
        <Mark tone="moved" tag="→ link by the plan tag" block>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "3px 0 5px", padding: "11px 12px", borderRadius: R_MD, background: rgba(ACCENT, 0.16), border: `1px solid ${rgba(ACCENT, 0.4)}` }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: SANS, fontSize: 13, fontWeight: W_BOLD, color: PAPER }}>Owner Dashboard + tools</span>
            <span style={{ display: "block", fontFamily: MONO, fontSize: 10, color: ACCENT_TEXT, marginTop: 1 }}>the research panels</span>
          </span>
          <span style={{ marginLeft: "auto", color: ACCENT_TEXT }}>→</span>
        </div>
        </Mark>
      )}
      {sec("Account")}
      <Mark tone="moved" tag="→ rail head" block>{row("⌕", "Search", <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, border: `1px solid ${LINE}`, borderRadius: R_SM, padding: "1px 6px" }}>⌘K</span>)}</Mark>
      <Mark tone="gone" tag="already in rail" block>{row("▤", "Trade Journal")}</Mark>
      {row("⚙", "Settings")}
      {row("✦", "What's New")}
      {member && <Mark tone="moved" tag="→ API & agents" block>{row("✦", "Connect An Agent")}</Mark>}
      {member && row("▭", "Manage Billing")}
      {sec("Learn")}
      <Mark tone="moved" tag="→ Help & support" block>{row("▯", "How To Use Voltick")}</Mark>
      <Mark tone="moved" tag="→ Help & support" block>{row("≡", "Blog")}</Mark>
      <Mark tone="moved" tag="→ API & agents" block>{row("‹›", "API")}</Mark>
      {sec("Community")}
      <Mark tone="moved" tag="→ Community" block>{row("⚇", "Affiliates")}</Mark>
      <Mark tone="moved" tag="→ Help & support" block>{row("?", "Contact Support", <span style={{ marginLeft: "auto", background: ACCENT, color: PAPER, fontFamily: MONO, fontSize: 10, fontWeight: W_DATA, borderRadius: 99, padding: "1px 7px" }}>1</span>)}</Mark>
      {row("◌", "Suggestions")}
      <Mark tone="moved" tag="→ Community" block>{row("⚇", "Connect Discord")}</Mark>
      <div style={{ height: 1, background: LINE, margin: "4px 6px" }} />
      {row("⇥", "Sign out", undefined, true)}
    </div>
  );
}

/* ── the rails the preview can draw ─────────────────────────────────────── */

type Shelf = { label: string; icon: string; items: [string, string][] };

// Voltick's own rail, copied from its theme.jsx TOOLS_GROUPS / RAIL_VIEWS.
const VOLTICK_SHELVES: Shelf[] = [
  { label: "Education", icon: "?", items: [["Where To Start", "/start"], ["How To Use Voltick", "/how-to-use"], ["Learn", "/learn"], ["FAQ", "/faq"]] },
  { label: "The Board", icon: "▦", items: [["Single", "/"], ["Multi", "/multi"], ["Chart", "/chart"], ["Terminal", "/terminal"], ["Scanner", "/scanner"], ["Grid", "/grid"], ["Replay", "/replay"]] },
  { label: "Flow", icon: "≈", items: [["Flow", "/flow"]] },
  {
    label: "Read The Market",
    icon: "≡",
    items: [["News Feed", "/news"], ["News Calendar", "/calendar"], ["Earnings", "/earnings"], ["The Daily", "/daily"], ["Seasonality", "/seasonality"], ["Expected Moves", "/expected-moves"], ["Filings", "/filings"], ["Dividends", "/dividends"]],
  },
  { label: "Track Record", icon: "▤", items: [["Track Record", "/calibration"]] },
  { label: "Yours", icon: "☆", items: [["Today", "/today"], ["Trade Journal", "/journal"], ["Your Fuse Agent", "/agent"], ["Alerts", "/alerts"], ["Your Positions", "/book"], ["Your Levels", "/export"]] },
];

// This sandbox's own contents rail, read live from lib/nav.ts.
function MiniRail({ shelves, hidden, hiddenShelves, footer }: { shelves: Shelf[]; hidden: Set<string>; hiddenShelves: Set<string>; footer?: ReactNode }) {
  return (
    <div style={{ width: 180, minHeight: 520, display: "flex", flexDirection: "column", background: ELEV, border: `1px solid ${LINE}`, borderRadius: R_LG, overflow: "hidden", flex: "none" }}>
      <div style={{ padding: "12px 12px 8px", fontFamily: SANS, fontWeight: W_BOLD, fontSize: 14, color: PAPER }}>Menu</div>
      <div style={{ flex: 1, paddingBottom: 8 }}>
        {shelves
          .filter((s) => !hiddenShelves.has(s.label))
          .map((s) => {
            const kids = s.items.filter(([, to]) => !hidden.has(to));
            if (!kids.length) return null;
            const leaf = s.items.length === 1;
            return (
              <div key={s.label} style={{ marginBottom: 7 }}>
                <div style={{ display: "flex", alignItems: "center", height: 30, fontFamily: SANS, fontSize: 12.5, fontWeight: 600, color: PAPER }}>
                  <span style={{ width: 44, textAlign: "center", flex: "none" }}>{s.icon}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leaf ? kids[0]![0] : s.label}</span>
                  {!leaf && <span style={{ marginLeft: "auto", marginRight: 10, color: PAPER_QUIET, fontSize: 10 }}>▾</span>}
                </div>
                {!leaf &&
                  kids.map(([l, to]) => (
                    <div key={to} style={{ height: 24, display: "flex", alignItems: "center", paddingLeft: 44, fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, overflow: "hidden", whiteSpace: "nowrap" }}>
                      {l}
                    </div>
                  ))}
              </div>
            );
          })}
      </div>
      {footer}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════════════════
   THE OLD MENUS, one per tab of the Mockups page
   ════════════════════════════════════════════════════════════════════════ */

export function OldChart() {
  const [fwd, setFwd] = useState(false);
  return (
    <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
      <Bar>
        <Mark tone="moved" tag="renamed">
          <Chip on>⚙ Style</Chip>
        </Mark>
        <Mark tone="moved" tag="→ Layers">
          <Chip on={fwd} onClick={() => setFwd(!fwd)}>
            Forward off ▾
          </Chip>
        </Mark>
        <Mark tone="gone" tag="duplicate">
          <Chip on>
            <span style={{ color: ACCENT }}>●</span> Trails
          </Chip>
        </Mark>
        <Chip>⛶ Full screen</Chip>
      </Bar>
      {fwd && <Menu width={170} value="Forward off" items={["Forward off", "Forward · today", "Forward · week"]} />}
      <StylePopover start="style" />
    </div>
  );
}

export function OldFlow() {
  const [group, setGroup] = useState("tape");
  const [view, setView] = useState<FlowView>("options");
  const g = FLOW_GROUPS.find((x) => x.key === group) ?? FLOW_GROUPS[0]!;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 8, justifyItems: "center", padding: 12, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}>
          <Mark tone="moved" tag="7 tabs → 4">
            <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {FLOW_GROUPS.map((x) => (
                <Chip
                  key={x.key}
                  on={group === x.key}
                  tone={x.key === "dark" ? DARK_POOL : ACCENT}
                  onClick={() => {
                    setGroup(x.key);
                    setView(x.views[0]![0]);
                  }}
                >
                  {x.label}
                </Chip>
              ))}
            </span>
          </Mark>
          <Mark tone="moved" tag="→ ?">
            <Chip style={{ borderColor: ACCENT, background: "transparent" }}>▶ Show me around</Chip>
          </Mark>
        </div>
        {g.views.length > 1 && (
          <Mark tone="moved" tag="→ sub-switch">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", padding: 6, borderRadius: R_MD, background: rgba(ACCENT, 0.06) }}>
              {g.views.map(([k, lbl]) => (
                <Chip key={k} on={view === k} onClick={() => setView(k)}>
                  {lbl}
                </Chip>
              ))}
            </div>
          </Mark>
        )}
      </div>
      <Mark tone="moved" tag="→ ⚑ pill" block>
        <Bar>
          <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: PAPER }}>⚑ Alerts Set</span>
          {["⟳ Repeated $500K+ · 80% ask · OTM", "⚡︎ One print $500K+ · 80% ask · OTM", "▮ One-shot $1M+ · 80% ask · OTM"].map((x) => (
            <span key={x} style={{ fontFamily: MONO, fontSize: 11.5, color: PAPER, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "5px 9px", background: ELEV }}>
              <b>Whole tape</b> {x} <span style={{ color: PAPER_QUIET, marginLeft: 6 }}>✕</span>
            </span>
          ))}
          <span style={{ marginLeft: "auto" }}>
            <Chip on>Manage</Chip>
          </span>
        </Bar>
      </Mark>
      <ViewToolbar view={view} />
    </div>
  );
}

export function OldAccount({ who }: { who: Who }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap" }}>
      <MiniRail
        shelves={VOLTICK_SHELVES}
        hidden={new Set()}
        hiddenShelves={new Set()}
        footer={
          <div style={{ borderTop: `1px solid ${LINE}`, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", background: ACCENT, color: PAPER, fontFamily: MONO, fontWeight: W_DATA, boxShadow: `0 0 0 2px ${ACCENT}` }}>B</span>
            <span style={{ fontFamily: SANS, fontSize: 12, color: PAPER }}>Account</span>
          </div>
        }
      />
      <div style={{ marginLeft: 8, marginBottom: 8 }}>
        <AccountPop who={who} />
      </div>
    </div>
  );
}

/** Voltick's Settings page as it ships (web/src/pages/Settings.jsx). */
export function OldSettings() {
  const [cb, setCb] = useState(false);
  const [push, setPush] = useState(true);
  const [brief, setBrief] = useState(false);
  const [big, setBig] = useState(true);
  const [lean, setLean] = useState(false);
  const card = (title: string, desc: string, right: ReactNode) => (
    <Box style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: SANS, fontSize: 13, fontWeight: W_BOLD, color: PAPER }}>{title}</div>
        <div style={{ fontFamily: SANS, fontSize: 11.5, color: PAPER_QUIET, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
      </div>
      {right}
    </Box>
  );
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ fontFamily: SANS, fontSize: 19, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: PAPER, marginBottom: 6 }}>Settings</div>
      <SecHead>Appearance</SecHead>
      <Mark tone="moved" tag="→ Display" block>
        {card("Colorblind-friendly colors", "Swap the green and red for a colorblind-safe blue and orange ramp. Every board and chart re-paints.", <OnOff on={cb} onClick={() => setCb(!cb)} />)}
      </Mark>
      <SecHead>Your board</SecHead>
      <Mark tone="moved" tag="→ Left menu · Open Voltick on" block>
        {card("Default view", "Which view the board opens in. Switching views on the board updates this too.", <Chip>Single board ▾</Chip>)}
      </Mark>
      <SecHead>Notifications</SecHead>
      {card("Alerts on this device", "Push alerts in this browser.", <OnOff on={push} onClick={() => setPush(!push)} />)}
      {card("Morning brief email", "The morning read, by email before the open.", <OnOff on={brief} onClick={() => setBrief(!brief)} />)}
      <Mark tone="moved" tag="→ Alerts page" block>
        {card("Big moves on your starred boards", "The Live Agent's alerts for boards you starred.", <OnOff on={big} onClick={() => setBig(!big)} />)}
        {card("The daily “money leaning” card", "The once-a-day Net Drift read, by push and email.", <OnOff on={lean} onClick={() => setLean(!lean)} />)}
      </Mark>
      {card("Your individual alerts", "Every alert you set, on its own page.", <Chip>Open Alerts →</Chip>)}
      <Box style={{ marginBottom: 8, textAlign: "center", fontFamily: SANS, fontSize: 12.5, color: PAPER }}>★★★★★ Enjoying Voltick? Leave a review</Box>
      <SecHead>Your account</SecHead>
      {card("Delete account", "Permanently removes your account and data.", <Chip tone={BAD} on>
        Delete…
      </Chip>)}
      <Mark tone="gone" tag="missing today" block>
        <Box style={{ marginTop: 14, fontFamily: SANS, fontSize: 12, color: PAPER_QUIET }}>No way to hide, pin or reorder pages in the left menu. No search. No chart or Flow defaults.</Box>
      </Mark>
    </div>
  );
}
