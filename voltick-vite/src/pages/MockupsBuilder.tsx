/**
 * Mockups · TOOLBAR BUILDER. Mock the menus up yourself.
 *
 * Pick a surface (Chart, Flow, Account menu, Left rail). Every control that
 * surface has today is a tile. Move tiles between zones (toolbar, popover tabs,
 * filters drawer, menu sections, rail shelves, removed), rename them, change
 * what kind of control they are, add your own, add or rename zones, and watch
 * the live preview rebuild. Sliders set size, spacing, corners and density.
 *
 * Moving works two ways so it is usable on a phone: drag a tile onto a zone
 * (desktop), or tap a tile and then tap "Move here" on the zone you want.
 *
 * Start from Today (what ships) or Proposed (the consolidated tabs), save as
 * many named layouts as you like (this browser only), and Export / Import JSON
 * to hand a layout to someone else or back to Claude.
 *
 * NOTHING HERE TOUCHES THE REAL SITE. It is a sketchpad with the real labels.
 * Copy rules hold: no em-dashes in anything a person reads.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent } from "react";
import { ACCENT, ACCENT_TEXT, BAD, DARK_POOL, ELEV, GOOD, LINE, MONO, PANEL, PAPER, PAPER_QUIET, R_LG, R_MD, SANS, VOLT, W_BOLD, rgba } from "../theme";

/* ── model ─────────────────────────────────────────────────────────────── */

type Kind = "button" | "dropdown" | "toggle" | "chip" | "tab" | "seg" | "slider" | "search" | "row" | "page";
type ZoneKind = "bar" | "tabs" | "panel" | "menu" | "drawer" | "shelf" | "bin";

type Item = { id: string; label: string; icon: string; kind: Kind };
type Zone = { id: string; name: string; kind: ZoneKind; group?: string };
type Layout = { zones: Zone[]; items: Record<string, Item>; place: Record<string, string[]> };
type SurfaceKey = "chart" | "flow" | "account" | "rail";

const KINDS: [Kind, string][] = [
  ["button", "Button"],
  ["dropdown", "Dropdown ▾"],
  ["toggle", "On / off"],
  ["chip", "Chip"],
  ["tab", "Tab"],
  ["seg", "Segmented"],
  ["slider", "Slider"],
  ["search", "Search box"],
  ["row", "Menu row"],
  ["page", "Page link"],
];
const ZONE_KINDS: [ZoneKind, string][] = [
  ["bar", "Toolbar row"],
  ["tabs", "Tab row"],
  ["panel", "Popover tab"],
  ["menu", "Menu section"],
  ["drawer", "Drawer"],
  ["shelf", "Rail shelf"],
  ["bin", "Removed / hidden"],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "x";

/** Build a layout from a compact spec: zone → list of "icon|label|kind" items. */
function build(spec: { zone: Zone; items: string[] }[], all?: string[]): Layout {
  const items: Record<string, Item> = {};
  const place: Record<string, string[]> = {};
  const mk = (raw: string) => {
    const [icon = "", label = raw, kind = "button"] = raw.split("|");
    const id = slug(label);
    if (!items[id]) items[id] = { id, label, icon, kind: kind as Kind };
    return id;
  };
  for (const { zone, items: list } of spec) place[zone.id] = list.map(mk);
  // anything in the full inventory but not placed lands in the last zone (Removed)
  if (all) {
    const binZone = spec[spec.length - 1]!.zone.id;
    for (const raw of all) {
      const id = mk(raw);
      if (!Object.values(place).some((l) => l.includes(id))) place[binZone]!.push(id);
    }
  }
  return { zones: spec.map((s) => s.zone), items, place };
}

/* ── inventories · labels copied from the live Voltick source ─────────── */

const CHART_ALL = [
  "⚙|Style|dropdown", "|Forward|dropdown", "●|Trails|toggle", "⛶|Full screen|button", "✎|Draw|button",
  "|Level trails|toggle", "|Trail shape|seg", "|Bubble rows|seg", "|Density preset|seg", "|No volume bars|toggle", "|Volume in its own strip|toggle",
  "|Session ranges as hairlines|toggle", "|Session captions at the foot|toggle", "|Ribbons fade toward history|toggle", "|Ribbons grow and shrink|toggle", "|Rail tags on one line|toggle",
  "|Gamma levels boldness|slider", "|Node levels boldness|slider", "|Dark pool boldness|slider", "|Levels shown|slider", "|Key levels only|toggle", "|Line length|seg", "|Prior levels|toggle",
  "|Previous day|toggle", "|Pre-market|toggle", "|Opening range|toggle", "|Extended hours|toggle", "|Watermark|toggle", "|Watermark in the corner|toggle",
  "|EMA|row", "|SMA|row", "|VWAP|toggle", "|VWAP bands|toggle", "|RSI|toggle", "|MACD|toggle", "|Williams %R|toggle",
  "|Drawing colour|button", "⤺|Undo|button", "|Clear drawings|button", "↺|Reset to default|button",
];

const CHART_TODAY = build(
  [
    { zone: { id: "toolbar", name: "Toolbar", kind: "bar" }, items: ["⚙|Style|dropdown", "|Forward|dropdown", "●|Trails|toggle", "⛶|Full screen|button"] },
    {
      zone: { id: "p1", name: "Style", kind: "panel", group: "pop" },
      items: ["|Level trails|toggle", "|Trail shape|seg", "|Bubble rows|seg", "|Density preset|seg", "|No volume bars|toggle", "|Rail tags on one line|toggle", "|Ribbons fade toward history|toggle", "|Ribbons grow and shrink|toggle", "|Session ranges as hairlines|toggle", "|Session captions at the foot|toggle", "|Volume in its own strip|toggle", "|Watermark in the corner|toggle", "|Gamma levels boldness|slider", "|Node levels boldness|slider", "|Dark pool boldness|slider", "|Levels shown|slider", "|Key levels only|toggle", "|Line length|seg", "|Prior levels|toggle", "|Previous day|toggle", "|Pre-market|toggle", "|Opening range|toggle", "|Extended hours|toggle", "|Watermark|toggle"],
    },
    { zone: { id: "p2", name: "Indicators", kind: "panel", group: "pop" }, items: ["|EMA|row", "|SMA|row", "|VWAP|toggle", "|VWAP bands|toggle", "|RSI|toggle", "|MACD|toggle", "|Williams %R|toggle"] },
    { zone: { id: "p3", name: "Draw", kind: "panel", group: "pop" }, items: ["|Drawing colour|button", "✎|Draw|button", "⤺|Undo|button", "|Clear drawings|button"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: [] },
  ],
  CHART_ALL,
);

const CHART_PROPOSED = build(
  [
    { zone: { id: "toolbar", name: "Toolbar", kind: "bar" }, items: ["⚙|Style|dropdown", "✎|Draw|button", "⛶|Full screen|button"] },
    { zone: { id: "p1", name: "Look", kind: "panel", group: "pop" }, items: ["|Density preset|seg", "|Levels shown|slider", "|Key levels only|toggle", "|Line length|seg", "|Gamma levels boldness|slider", "|Node levels boldness|slider", "|Dark pool boldness|slider"] },
    { zone: { id: "p2", name: "Layers", kind: "panel", group: "pop" }, items: ["|Level trails|toggle", "|Trail shape|seg", "|Prior levels|toggle", "|Forward|dropdown", "|Previous day|toggle", "|Pre-market|toggle", "|Opening range|toggle", "|Extended hours|toggle", "|No volume bars|toggle", "|Watermark|toggle"] },
    { zone: { id: "p3", name: "Studies", kind: "panel", group: "pop" }, items: ["|EMA|row", "|VWAP|toggle", "|RSI|toggle"] },
    { zone: { id: "draw", name: "Drawing strip", kind: "bar" }, items: ["|Drawing colour|button", "⤺|Undo|button", "|Clear drawings|button"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: ["●|Trails|toggle", "|Bubble rows|seg"] },
  ],
  CHART_ALL,
);

const FLOW_ALL = [
  "⚡︎|The Tape|tab", "Δ|OI Changes|tab", "◉|Most Active|tab", "▤|Sector Flow|tab", "✦|Net Drift|tab", "$|Premium|tab", "◐|Dark Pool|tab",
  "⚡︎|Options Flow|tab", "⟳|Repeated|tab", "▮|One-Shots|tab", "▲|Being Built|tab", "⌁|Waking Up|tab", "⧖|Cross-Confirm|tab",
  "▶|Show me around|button", "⚑|Alerts set|dropdown", "|Stats strip|row",
  "⌕|Search ticker|search", "|Stocks / ETFs / All|dropdown", "|Company size|seg", "▲|Bullish|chip", "▼|Bearish|chip", "★|Unusual|chip", "|0DTE|chip", "⌖|On a level|chip", "★|My watchlist|chip", "⌥|Outright only|chip",
  "⚙|Filters|dropdown", "★|Presets|dropdown", "⟳|Repeated count|chip", "●|Live / past sessions|dropdown", "◑|CB colours|toggle", "|Newest / Biggest|seg", "❚❚|Pause|button", "|Find a contract|search",
  "|Direction|seg", "|Calls / Puts|seg", "|Fill|seg", "|Premium size|seg", "|OI under|seg", "|Volume over|seg", "|Vol / OI over|seg", "|Days out|seg", "|Expiry|dropdown", "|Contract price|dropdown", "★|Whales preset|chip", "★|Big LEAPs preset|chip",
];

const FLOW_TODAY = build(
  [
    { zone: { id: "tabs", name: "View tabs", kind: "tabs" }, items: ["⚡︎|The Tape|tab", "Δ|OI Changes|tab", "◉|Most Active|tab", "▤|Sector Flow|tab", "✦|Net Drift|tab", "$|Premium|tab", "◐|Dark Pool|tab", "▶|Show me around|button"] },
    { zone: { id: "subs", name: "Sub-tabs", kind: "tabs" }, items: ["⚡︎|Options Flow|tab", "⟳|Repeated|tab", "▮|One-Shots|tab", "▲|Being Built|tab", "⌁|Waking Up|tab"] },
    { zone: { id: "above", name: "Above the toolbar", kind: "bar" }, items: ["⚑|Alerts set|dropdown", "|Stats strip|row", "|Newest / Biggest|seg", "❚❚|Pause|button"] },
    { zone: { id: "toolbar", name: "Toolbar", kind: "bar" }, items: ["⌕|Search ticker|search", "|Stocks / ETFs / All|dropdown", "|Company size|seg", "▲|Bullish|chip", "▼|Bearish|chip", "★|Unusual|chip", "|0DTE|chip", "⌖|On a level|chip", "★|My watchlist|chip", "⌥|Outright only|chip", "⚙|Filters|dropdown", "★|Presets|dropdown", "⟳|Repeated count|chip", "●|Live / past sessions|dropdown", "◑|CB colours|toggle"] },
    { zone: { id: "row2", name: "Second row", kind: "bar" }, items: ["|Find a contract|search"] },
    { zone: { id: "drawer", name: "Filters panel", kind: "drawer" }, items: ["★|Whales preset|chip", "★|Big LEAPs preset|chip", "|Direction|seg", "|Calls / Puts|seg", "|Fill|seg", "|Premium size|seg", "|OI under|seg", "|Volume over|seg", "|Vol / OI over|seg", "|Days out|seg", "|Expiry|dropdown", "|Contract price|dropdown"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: [] },
  ],
  FLOW_ALL,
);

const FLOW_PROPOSED = build(
  [
    { zone: { id: "tabs", name: "View tabs", kind: "tabs" }, items: ["⚡︎|Tape|tab", "⟳|Patterns|tab", "◉|Market|tab", "◐|Dark Pool|tab", "⚑|Alerts set|dropdown", "?|Show me around|button"] },
    { zone: { id: "subs", name: "Sub-tabs", kind: "tabs" }, items: ["⟳|Repeated|tab", "▮|One-Shots|tab", "▲|Being Built|tab", "⌁|Waking Up|tab"] },
    { zone: { id: "toolbar", name: "Toolbar", kind: "bar" }, items: ["⌕|Search ticker|search", "|Stocks / ETFs / All|dropdown", "|Direction|seg", "★|Unusual|chip", "|0DTE|chip", "⌖|On a level|chip", "★|My watchlist|chip", "⚙|Filters|dropdown", "|Newest / Biggest|seg", "●|Live / past sessions|dropdown"] },
    { zone: { id: "below", name: "Below the toolbar", kind: "bar" }, items: ["|Stats strip|row"] },
    { zone: { id: "drawer", name: "Filters drawer", kind: "drawer" }, items: ["★|Whales preset|chip", "★|Big LEAPs preset|chip", "|Calls / Puts|seg", "|Days out|seg", "|Expiry|dropdown", "|Contract price|dropdown", "|Premium size|seg", "|Volume over|seg", "|Vol / OI over|seg", "|OI under|seg", "|Fill|seg", "⌥|Outright only|chip", "|Company size|seg"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: ["▲|Bullish|chip", "▼|Bearish|chip", "★|Presets|dropdown", "⟳|Repeated count|chip", "◑|CB colours|toggle", "❚❚|Pause|button", "|Find a contract|search"] },
  ],
  FLOW_ALL,
);

const ACCOUNT_ALL = [
  "→|Owner Dashboard|row", "⌕|Search|row", "▤|Trade Journal|row", "⚙|Settings|row", "✦|What's New|row", "✦|Connect An Agent|row", "▭|Manage Billing|row",
  "▯|How To Use Voltick|row", "≡|Blog|row", "‹›|API|row", "⚇|Affiliates|row", "?|Contact Support|row", "◌|Suggestions|row", "⚇|Connect Discord|row", "⇥|Sign out|row",
];

const ACCOUNT_TODAY = build(
  [
    { zone: { id: "top", name: "Top", kind: "menu" }, items: ["→|Owner Dashboard|row"] },
    { zone: { id: "s1", name: "Account", kind: "menu" }, items: ["⌕|Search|row", "▤|Trade Journal|row", "⚙|Settings|row", "✦|What's New|row", "✦|Connect An Agent|row", "▭|Manage Billing|row"] },
    { zone: { id: "s2", name: "Learn", kind: "menu" }, items: ["▯|How To Use Voltick|row", "≡|Blog|row", "‹›|API|row"] },
    { zone: { id: "s3", name: "Community", kind: "menu" }, items: ["⚇|Affiliates|row", "?|Contact Support|row", "◌|Suggestions|row", "⚇|Connect Discord|row"] },
    { zone: { id: "end", name: "Bottom", kind: "menu" }, items: ["⇥|Sign out|row"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: [] },
  ],
  ACCOUNT_ALL,
);

const ACCOUNT_PROPOSED = build(
  [
    { zone: { id: "top", name: "Top", kind: "menu" }, items: ["→|Owner Dashboard|row"] },
    { zone: { id: "s1", name: "You", kind: "menu" }, items: ["⚙|Settings|row", "▭|Manage Billing|row", "✦|What's New|row"] },
    { zone: { id: "s2", name: "Help", kind: "menu" }, items: ["?|Contact Support|row", "▯|How To Use Voltick|row", "◌|Suggestions|row"] },
    { zone: { id: "s3", name: "More", kind: "menu" }, items: ["⚇|Connect Discord|row", "⚇|Affiliates|row", "‹›|API|row"] },
    { zone: { id: "end", name: "Bottom", kind: "menu" }, items: ["⇥|Sign out|row"] },
    { zone: { id: "bin", name: "Removed", kind: "bin" }, items: ["⌕|Search|row", "▤|Trade Journal|row", "≡|Blog|row", "✦|Connect An Agent|row"] },
  ],
  ACCOUNT_ALL,
);

const RAIL_SHELVES: [string, string[]][] = [
  ["Education", ["Where To Start", "How To Use Voltick", "Learn", "FAQ"]],
  ["The Board", ["Single", "Multi", "Chart", "Terminal", "Scanner", "Grid", "Replay"]],
  ["Flow", ["Flow"]],
  ["Read The Market", ["News Feed", "News Calendar", "Earnings", "The Daily", "Seasonality", "Expected Moves", "Filings", "Dividends"]],
  ["Track Record", ["Track Record"]],
  ["Yours", ["Today", "Trade Journal", "Your Fuse Agent", "Alerts", "Your Positions", "Your Levels"]],
];
const RAIL_ALL = RAIL_SHELVES.flatMap(([, ps]) => ps.map((p) => `|${p}|page`));

const RAIL_TODAY = build(
  [
    { zone: { id: "pinned", name: "Pinned", kind: "shelf" }, items: [] },
    ...RAIL_SHELVES.map(([name, ps]) => ({ zone: { id: slug(name) + "-shelf", name, kind: "shelf" as ZoneKind }, items: ps.map((p) => `|${p}|page`) })),
    { zone: { id: "bin", name: "Hidden", kind: "bin" }, items: [] },
  ],
  RAIL_ALL,
);

const RAIL_PROPOSED = build(
  [
    { zone: { id: "pinned", name: "Pinned", kind: "shelf" }, items: ["|Flow|page", "|Chart|page", "|Alerts|page"] },
    { zone: { id: "board", name: "The Board", kind: "shelf" }, items: ["|Single|page", "|Multi|page", "|Scanner|page", "|Replay|page"] },
    { zone: { id: "market", name: "Read The Market", kind: "shelf" }, items: ["|News Calendar|page", "|Earnings|page", "|The Daily|page", "|Expected Moves|page"] },
    { zone: { id: "yours", name: "Yours", kind: "shelf" }, items: ["|Today|page", "|Trade Journal|page", "|Your Positions|page", "|Your Levels|page", "|Your Fuse Agent|page"] },
    { zone: { id: "help", name: "Learn", kind: "shelf" }, items: ["|Where To Start|page", "|Learn|page", "|Track Record|page"] },
    { zone: { id: "bin", name: "Hidden", kind: "bin" }, items: [] },
  ],
  RAIL_ALL,
);

const SURFACES: Record<SurfaceKey, { label: string; today: Layout; proposed: Layout; note: string }> = {
  chart: { label: "⚙ Chart", today: CHART_TODAY, proposed: CHART_PROPOSED, note: "Toolbar buttons, and the popover's tabs. Rename a Popover tab zone to rename that tab." },
  flow: { label: "⚡︎ Flow", today: FLOW_TODAY, proposed: FLOW_PROPOSED, note: "Tabs, the toolbar and the filters drawer. Anything in a Drawer zone opens from the Filters button." },
  account: { label: "◉ Account menu", today: ACCOUNT_TODAY, proposed: ACCOUNT_PROPOSED, note: "Each Menu section zone is a titled group in the pop-up. Rename it to rename the section." },
  rail: { label: "☰ Left rail", today: RAIL_TODAY, proposed: RAIL_PROPOSED, note: "Each Rail shelf zone is a shelf. Pinned sits at the top under search. Hidden is what a member turned off." },
};

/* ── look ──────────────────────────────────────────────────────────────── */

type Look = { scale: number; gap: number; radius: number; pad: number; labels: "both" | "text" | "icon"; frame: number };
const LOOK0: Look = { scale: 100, gap: 8, radius: 10, pad: 7, labels: "both", frame: 1100 };

/* ── storage (this browser only; every read/write guarded) ─────────────── */

type Saved = { name: string; surface: SurfaceKey; layout: Layout; look: Look; at: string };
type Store = { current: Partial<Record<SurfaceKey, Layout>>; look: Look; saves: Saved[] };
const KEY = "vk-mockup-builder:v1";
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      return { current: s.current || {}, look: { ...LOOK0, ...(s.look || {}) }, saves: s.saves || [] };
    }
  } catch {
    /* private mode or bad JSON */
  }
  return { current: {}, look: LOOK0, saves: [] };
}
function writeStore(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ── small ui ───────────────────────────────────────────────────────────── */

const btn = (on = false, tone = ACCENT): CSSProperties => ({
  fontFamily: SANS,
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 10px",
  borderRadius: R_MD,
  cursor: "pointer",
  border: `1px solid ${on ? tone : LINE}`,
  background: on ? rgba(tone, 0.16) : ELEV,
  color: PAPER,
  whiteSpace: "nowrap",
});
const input: CSSProperties = { fontFamily: SANS, fontSize: 12.5, color: PAPER, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_MD, padding: "6px 9px", outline: "none", boxSizing: "border-box" };
const cap: CSSProperties = { fontFamily: MONO, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: PAPER_QUIET, textTransform: "uppercase" };

function Seg<K extends string>({ options, value, onChange }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void }) {
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 9, overflow: "hidden", flexWrap: "wrap", maxWidth: "100%" }}>
      {options.map(([k, l], i) => (
        <button key={k} type="button" onClick={() => onChange(k)} style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, padding: "5px 10px", border: "none", borderLeft: i ? `1px solid ${LINE}` : "none", cursor: "pointer", background: value === k ? rgba(ACCENT, 0.2) : "transparent", color: value === k ? ACCENT_TEXT : PAPER }}>
          {l}
        </button>
      ))}
    </span>
  );
}

function Range({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return (
    <label style={{ display: "grid", gap: 4, minWidth: 150 }}>
      <span style={{ ...cap, display: "flex", justifyContent: "space-between" }}>
        {label}
        <span style={{ color: PAPER }}>
          {value}
          {suffix}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ accentColor: ACCENT, cursor: "pointer" }} />
    </label>
  );
}

/* ── preview rendering ──────────────────────────────────────────────────── */

function Ctl({ it, look }: { it: Item; look: Look }) {
  const s = look.scale / 100;
  const text = look.labels === "icon" && it.icon ? "" : it.label;
  const icon = look.labels === "text" ? "" : it.icon;
  const content = (
    <>
      {icon && <span aria-hidden="true">{icon}</span>}
      {icon && text ? " " : ""}
      {text}
    </>
  );
  const base: CSSProperties = { fontFamily: SANS, fontSize: 12 * s, fontWeight: 700, padding: `${look.pad * s * 0.8}px ${look.pad * s * 1.5}px`, borderRadius: look.radius, border: `1px solid ${LINE}`, background: ELEV, color: PAPER, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6 * s };
  switch (it.kind) {
    case "dropdown":
      return <span style={base}>{content} ▾</span>;
    case "toggle":
      return (
        <span style={base}>
          {content}
          <span style={{ width: 26 * s, height: 14 * s, borderRadius: 99, background: ACCENT, position: "relative", marginLeft: 4 }}>
            <span style={{ position: "absolute", right: 2, top: 2, width: 10 * s, height: 10 * s, borderRadius: 99, background: PAPER }} />
          </span>
        </span>
      );
    case "chip":
      return <span style={{ ...base, borderRadius: Math.max(look.radius, 99) }}>{content}</span>;
    case "tab":
      return <span style={{ ...base, background: "transparent" }}>{content}</span>;
    case "seg":
      return (
        <span style={{ ...base, padding: 0, overflow: "hidden" }}>
          <span style={{ padding: `${look.pad * s * 0.8}px ${look.pad * s * 1.3}px`, background: rgba(ACCENT, 0.2), color: ACCENT_TEXT }}>{content}</span>
          <span style={{ padding: `${look.pad * s * 0.8}px ${look.pad * s}px`, borderLeft: `1px solid ${LINE}`, color: PAPER_QUIET }}>···</span>
        </span>
      );
    case "slider":
      return (
        <span style={{ ...base, background: "transparent", border: "none" }}>
          {content}
          <span style={{ width: 70 * s, height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${ACCENT} 45%, ${rgba(PAPER, 0.2)} 45%)` }} />
        </span>
      );
    case "search":
      return <span style={{ ...base, minWidth: 150 * s, color: PAPER_QUIET, background: PANEL, fontWeight: 500 }}>{content}…</span>;
    default:
      return <span style={base}>{content}</span>;
  }
}

function PanelRow({ it, look }: { it: Item; look: Look }) {
  const s = look.scale / 100;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: `${look.pad * s * 0.7}px 0`, borderTop: `1px solid ${LINE}` }}>
      <span style={{ fontFamily: SANS, fontSize: 12.5 * s, fontWeight: 700, color: PAPER }}>
        {it.icon && look.labels !== "text" ? `${it.icon} ` : ""}
        {it.label}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10 * s, color: PAPER_QUIET }}>{KINDS.find(([k]) => k === it.kind)?.[1]}</span>
    </div>
  );
}

function Preview({ surface, layout, look }: { surface: SurfaceKey; layout: Layout; look: Look }) {
  const [popTab, setPopTab] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const s = look.scale / 100;
  const items = (z: Zone) => (layout.place[z.id] || []).map((id) => layout.items[id]).filter((x): x is Item => !!x);
  const live = layout.zones.filter((z) => z.kind !== "bin");
  const panels = live.filter((z) => z.kind === "panel");
  const frame: CSSProperties = { width: "100%", maxWidth: look.frame, background: "#0a0d10", border: `1px solid ${LINE}`, borderRadius: R_LG, padding: 14, boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: look.gap + 4, alignContent: "start", overflow: "hidden" };

  if (surface === "account") {
    return (
      <div style={frame}>
        <div style={{ width: 250 * s, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: look.radius + 2, padding: 6, boxShadow: "0 16px 44px rgba(0,0,0,0.6)" }}>
          <div style={{ padding: "10px 10px 12px", borderBottom: `1px solid ${LINE}`, fontFamily: SANS, fontSize: 12.5 * s, fontWeight: W_BOLD, color: PAPER }}>
            member@example.com
            <div style={{ fontFamily: MONO, fontSize: 9.5 * s, color: GOOD, marginTop: 3 }}>● Voltick member</div>
          </div>
          {live.map((z) => {
            const list = items(z);
            if (!list.length) return null;
            const titled = z.name && !/^(top|bottom)$/i.test(z.name);
            return (
              <div key={z.id} style={{ paddingTop: 4 }}>
                {titled && <div style={{ ...cap, fontSize: 9 * s, padding: "8px 10px 3px" }}>{z.name}</div>}
                {list.map((it) => (
                  <div key={it.id} style={{ display: "flex", gap: 10, padding: `${look.pad * s}px 10px`, fontFamily: SANS, fontSize: 13 * s, fontWeight: 600, color: it.label === "Sign out" ? BAD : PAPER }}>
                    <span style={{ width: 16, textAlign: "center" }}>{look.labels === "text" ? "" : it.icon}</span>
                    {look.labels === "icon" ? "" : it.label}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (surface === "rail") {
    return (
      <div style={frame}>
        <div style={{ width: 190 * s, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: look.radius + 2, overflow: "hidden", paddingBottom: 8 }}>
          <div style={{ padding: 10 }}>
            <div style={{ fontFamily: SANS, fontSize: 12 * s, color: PAPER_QUIET, border: `1px solid ${LINE}`, borderRadius: look.radius, padding: "6px 9px" }}>⌕ Search ⌘K</div>
          </div>
          {live.map((z) => {
            const list = items(z);
            if (!list.length) return null;
            const pinned = z.id === "pinned";
            const leaf = list.length === 1 && !pinned;
            return (
              <div key={z.id} style={{ marginBottom: look.gap, borderBottom: pinned ? `1px solid ${LINE}` : "none", paddingBottom: pinned ? 6 : 0 }}>
                {!pinned && <div style={{ padding: "4px 12px", fontFamily: SANS, fontSize: 12.5 * s, fontWeight: 700, color: PAPER }}>{leaf ? list[0]!.label : z.name}</div>}
                {(pinned || !leaf) &&
                  list.map((it) => (
                    <div key={it.id} style={{ padding: `${look.pad * s * 0.45}px 12px ${look.pad * s * 0.45}px ${pinned ? 12 : 26}px`, fontFamily: SANS, fontSize: 12 * s, color: pinned ? PAPER : PAPER_QUIET, fontWeight: pinned ? 700 : 400 }}>
                      {pinned ? <span style={{ color: VOLT }}>★ </span> : null}
                      {it.label}
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // chart + flow: stacked rows, one popover for the panel zones, drawers under a Filters toggle
  const drawerZones = live.filter((z) => z.kind === "drawer");
  const safeTab = Math.min(popTab, Math.max(0, panels.length - 1));
  return (
    <div style={frame}>
      {live
        .filter((z) => z.kind === "bar" || z.kind === "tabs" || z.kind === "menu" || z.kind === "shelf")
        .map((z) => {
          const list = items(z);
          if (!list.length) return null;
          return (
            <div key={z.id}>
              <div style={{ ...cap, fontSize: 8.5, marginBottom: 4 }}>{z.name}</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: look.gap,
                  alignItems: "center",
                  padding: z.kind === "tabs" ? 0 : look.gap,
                  background: z.kind === "tabs" ? "transparent" : PANEL,
                  border: z.kind === "tabs" ? "none" : `1px solid ${LINE}`,
                  borderRadius: look.radius + 2,
                }}
              >
                {list.map((it, i) =>
                  z.kind === "tabs" ? (
                    <span key={it.id} style={{ fontFamily: SANS, fontSize: 12.5 * s, fontWeight: 700, padding: `${look.pad * s}px ${look.pad * s * 1.6}px`, borderRadius: look.radius, color: PAPER, border: `1px solid ${i === 0 ? ACCENT : LINE}`, background: i === 0 ? rgba(ACCENT, 0.16) : ELEV }}>
                      {look.labels !== "text" && it.icon ? `${it.icon} ` : ""}
                      {look.labels === "icon" && it.icon ? "" : it.label}
                    </span>
                  ) : (
                    <Ctl key={it.id} it={it} look={look} />
                  ),
                )}
              </div>
            </div>
          );
        })}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {panels.length > 0 && (
          <div style={{ width: 340 * s, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: look.radius + 2, padding: "10px 14px", boxShadow: "0 14px 40px rgba(0,0,0,0.5)" }}>
            <div style={{ ...cap, fontSize: 8.5, marginBottom: 6 }}>Popover</div>
            <div style={{ display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 9, overflow: "hidden", marginBottom: 8, flexWrap: "wrap" }}>
              {panels.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setPopTab(i)} style={{ fontFamily: SANS, fontSize: 12 * s, fontWeight: 700, padding: "5px 11px", border: "none", borderLeft: i ? `1px solid ${LINE}` : "none", cursor: "pointer", background: i === safeTab ? rgba(ACCENT, 0.2) : "transparent", color: i === safeTab ? ACCENT_TEXT : PAPER }}>
                  {p.name}
                </button>
              ))}
            </div>
            {items(panels[safeTab]!).map((it) => (
              <PanelRow key={it.id} it={it} look={look} />
            ))}
            {!items(panels[safeTab]!).length && <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, padding: "8px 0" }}>Empty tab</div>}
          </div>
        )}
        {drawerZones.map((z) => (
          <div key={z.id} style={{ width: 380 * s, maxWidth: "100%", boxSizing: "border-box", background: ELEV, border: `1px solid ${LINE}`, borderRadius: look.radius + 2, padding: "10px 14px" }}>
            <button type="button" onClick={() => setDrawerOpen(!drawerOpen)} style={{ ...btn(drawerOpen), marginBottom: 6 }}>
              {z.name} {drawerOpen ? "▴" : "▾"}
            </button>
            {drawerOpen && items(z).map((it) => <PanelRow key={it.id} it={it} look={look} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── the builder ────────────────────────────────────────────────────────── */

export function ToolbarBuilder() {
  const [store, setStore] = useState<Store>(readStore);
  const [surface, setSurface] = useState<SurfaceKey>("flow");
  const [sel, setSel] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [io, setIo] = useState<null | "export" | "import">(null);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState("");
  const dragId = useRef<string | null>(null);

  useEffect(() => writeStore(store), [store]);
  useEffect(() => setSel(null), [surface]);

  const layout: Layout = store.current[surface] ?? SURFACES[surface].today;
  const look = store.look;
  const setLayout = (l: Layout) => setStore((s) => ({ ...s, current: { ...s.current, [surface]: l } }));
  const setLook = (patch: Partial<Look>) => setStore((s) => ({ ...s, look: { ...s.look, ...patch } }));
  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(""), 2500);
  };

  const zoneOf = (id: string) => layout.zones.find((z) => (layout.place[z.id] || []).includes(id));

  const moveTo = (id: string, zoneId: string, index?: number) => {
    const place = clone(layout.place);
    for (const k of Object.keys(place)) place[k] = place[k]!.filter((x) => x !== id);
    const list = place[zoneId] || (place[zoneId] = []);
    list.splice(index == null ? list.length : index, 0, id);
    setLayout({ ...layout, place });
  };
  const nudge = (id: string, d: -1 | 1) => {
    const z = zoneOf(id);
    if (!z) return;
    const list = [...(layout.place[z.id] || [])];
    const i = list.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    setLayout({ ...layout, place: { ...layout.place, [z.id]: list } });
  };
  const patchItem = (id: string, p: Partial<Item>) => setLayout({ ...layout, items: { ...layout.items, [id]: { ...layout.items[id]!, ...p } } });
  const addItem = (zoneId: string) => {
    let id = "custom";
    let n = 1;
    while (layout.items[id]) id = `custom-${++n}`;
    const items = { ...layout.items, [id]: { id, label: "New control", icon: "", kind: "button" as Kind } };
    const place = { ...layout.place, [zoneId]: [...(layout.place[zoneId] || []), id] };
    setLayout({ ...layout, items, place });
    setSel(id);
  };
  const deleteItem = (id: string) => {
    const place = clone(layout.place);
    for (const k of Object.keys(place)) place[k] = place[k]!.filter((x) => x !== id);
    const items = { ...layout.items };
    delete items[id];
    setLayout({ ...layout, items, place });
    setSel(null);
  };
  const patchZone = (zid: string, p: Partial<Zone>) => setLayout({ ...layout, zones: layout.zones.map((z) => (z.id === zid ? { ...z, ...p } : z)) });
  const addZone = () => {
    let id = "zone";
    let n = 1;
    while (layout.zones.some((z) => z.id === id)) id = `zone-${++n}`;
    const kind = (surface === "account" ? "menu" : surface === "rail" ? "shelf" : "bar") as ZoneKind;
    const zones = [...layout.zones];
    const binAt = zones.findIndex((z) => z.kind === "bin");
    zones.splice(binAt < 0 ? zones.length : binAt, 0, { id, name: "New group", kind, group: kind === "panel" ? "pop" : undefined });
    setLayout({ ...layout, zones, place: { ...layout.place, [id]: [] } });
  };
  const deleteZone = (zid: string) => {
    const bin = layout.zones.find((z) => z.kind === "bin" && z.id !== zid);
    const place = clone(layout.place);
    if (bin) place[bin.id] = [...(place[bin.id] || []), ...(place[zid] || [])];
    delete place[zid];
    setLayout({ ...layout, zones: layout.zones.filter((z) => z.id !== zid), place });
  };
  const moveZone = (zid: string, d: -1 | 1) => {
    const zones = [...layout.zones];
    const i = zones.findIndex((z) => z.id === zid);
    const j = i + d;
    if (j < 0 || j >= zones.length) return;
    [zones[i], zones[j]] = [zones[j]!, zones[i]!];
    setLayout({ ...layout, zones });
  };

  const loadPreset = (which: "today" | "proposed") => {
    setLayout(clone(SURFACES[surface][which]));
    setSel(null);
    flash(which === "today" ? "Loaded Today" : "Loaded Proposed");
  };
  const saveLayout = () => {
    const name = saveName.trim() || `${SURFACES[surface].label} ${new Date().toLocaleString()}`;
    const entry: Saved = { name, surface, layout: clone(layout), look: clone(look), at: new Date().toISOString() };
    setStore((s) => ({ ...s, saves: [entry, ...s.saves.filter((x) => !(x.name === name && x.surface === surface))].slice(0, 40) }));
    setSaveName("");
    flash(`Saved “${name}”`);
  };
  const loadSaved = (sv: Saved) => {
    setSurface(sv.surface);
    setStore((s) => ({ ...s, look: clone(sv.look), current: { ...s.current, [sv.surface]: clone(sv.layout) } }));
    flash(`Loaded “${sv.name}”`);
  };
  const exportJson = useMemo(() => JSON.stringify({ kind: "voltick-mockup-layout", version: 1, surface, look, layout }, null, 2), [surface, look, layout]);
  const copyExport = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      flash("Copied to clipboard");
    } catch {
      flash("Copy failed · select the text and copy it");
    }
  };
  const downloadExport = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportJson], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `voltick-${surface}-layout.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      flash("Download failed");
    }
  };
  const doImport = () => {
    try {
      const j = JSON.parse(importText) as { surface?: SurfaceKey; look?: Look; layout?: Layout };
      if (!j.layout || !j.surface || !SURFACES[j.surface]) throw new Error("bad");
      setSurface(j.surface);
      setStore((s) => ({ ...s, look: { ...LOOK0, ...(j.look || {}) }, current: { ...s.current, [j.surface!]: j.layout! } }));
      setIo(null);
      setImportText("");
      flash("Imported");
    } catch {
      flash("That is not a layout export");
    }
  };

  const visibleCount = layout.zones.filter((z) => z.kind === "bar" || z.kind === "tabs").reduce((a, z) => a + (layout.place[z.id] || []).length, 0);
  const tuckedCount = layout.zones.filter((z) => z.kind === "panel" || z.kind === "drawer").reduce((a, z) => a + (layout.place[z.id] || []).length, 0);
  const removedCount = layout.zones.filter((z) => z.kind === "bin").reduce((a, z) => a + (layout.place[z.id] || []).length, 0);
  const shownCount = layout.zones.filter((z) => z.kind !== "bin").reduce((a, z) => a + (layout.place[z.id] || []).length, 0);
  const selItem = sel ? layout.items[sel] : undefined;

  const onDrop = (e: DragEvent, zoneId: string, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId.current || e.dataTransfer.getData("text/plain");
    dragId.current = null;
    setOver(null);
    if (id) moveTo(id, zoneId, index);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16 }}>
      {/* ── top bar: surface, presets, saves, export ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: 10, background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG }}>
        <Seg value={surface} onChange={setSurface} options={(Object.keys(SURFACES) as SurfaceKey[]).map((k) => [k, SURFACES[k].label] as const)} />
        <span style={{ width: 1, height: 22, background: LINE }} />
        <span style={cap}>Start from</span>
        <button type="button" style={btn()} onClick={() => loadPreset("today")}>
          Today
        </button>
        <button type="button" style={btn()} onClick={() => loadPreset("proposed")}>
          Proposed
        </button>
        <span style={{ width: 1, height: 22, background: LINE }} />
        <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name this layout" style={{ ...input, width: 170, maxWidth: "100%" }} />
        <button type="button" style={btn(true, GOOD)} onClick={saveLayout}>
          Save
        </button>
        <button type="button" style={btn(io === "export")} onClick={() => setIo(io === "export" ? null : "export")}>
          Export
        </button>
        <button type="button" style={btn(io === "import")} onClick={() => setIo(io === "import" ? null : "import")}>
          Import
        </button>
        {msg && <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 700, color: GOOD }}>{msg}</span>}
      </div>

      {io === "export" && (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea readOnly value={exportJson} style={{ ...input, width: "100%", height: 160, fontFamily: MONO, fontSize: 11 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btn()} onClick={copyExport}>
              Copy
            </button>
            <button type="button" style={btn()} onClick={downloadExport}>
              Download .json
            </button>
            <span style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, alignSelf: "center" }}>Paste this to Claude to build the real thing from it.</span>
          </div>
        </div>
      )}
      {io === "import" && (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste an exported layout here" style={{ ...input, width: "100%", height: 120, fontFamily: MONO, fontSize: 11 }} />
          <div>
            <button type="button" style={btn(true)} onClick={doImport}>
              Load it
            </button>
          </div>
        </div>
      )}

      {store.saves.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={cap}>Saved</span>
          {store.saves.map((sv) => (
            <span key={sv.surface + sv.name} style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${LINE}`, borderRadius: 99, background: ELEV, overflow: "hidden" }}>
              <button type="button" onClick={() => loadSaved(sv)} style={{ border: "none", background: "transparent", color: PAPER, fontFamily: SANS, fontSize: 11.5, fontWeight: 700, padding: "4px 6px 4px 10px", cursor: "pointer" }}>
                <span style={{ color: PAPER_QUIET }}>{SURFACES[sv.surface].label.split(" ")[0]}</span> {sv.name}
              </button>
              <button type="button" title="Delete this save" onClick={() => setStore((s) => ({ ...s, saves: s.saves.filter((x) => x !== sv) }))} style={{ border: "none", background: "transparent", color: PAPER_QUIET, padding: "4px 9px 4px 4px", cursor: "pointer" }}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── look sliders ── */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end", padding: "12px 14px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_LG }}>
        <Range label="Size" value={look.scale} min={75} max={135} suffix="%" onChange={(v) => setLook({ scale: v })} />
        <Range label="Spacing" value={look.gap} min={2} max={20} suffix="px" onChange={(v) => setLook({ gap: v })} />
        <Range label="Padding" value={look.pad} min={3} max={12} suffix="px" onChange={(v) => setLook({ pad: v })} />
        <Range label="Corners" value={look.radius} min={0} max={18} suffix="px" onChange={(v) => setLook({ radius: v })} />
        <Range label="Screen width" value={look.frame} min={360} max={1500} step={10} suffix="px" onChange={(v) => setLook({ frame: v })} />
        <label style={{ display: "grid", gap: 4 }}>
          <span style={cap}>Labels</span>
          <Seg value={look.labels} onChange={(v) => setLook({ labels: v })} options={[["both", "Icon + text"], ["text", "Text"], ["icon", "Icon"]] as const} />
        </label>
        <button type="button" style={btn()} onClick={() => setLook(LOOK0)}>
          ↺ Reset look
        </button>
      </div>

      {/* ── counts ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {(
          [
            ["Always visible", visibleCount, "in toolbars and tab rows"],
            ["Tucked away", tuckedCount, "in popovers and drawers"],
            ["Shown in total", shownCount, "everything not removed"],
            ["Removed / hidden", removedCount, ""],
          ] as const
        ).map(([l, n, sub]) => (
          <div key={l} style={{ minWidth: 140, padding: "8px 12px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: R_MD }}>
            <div style={cap}>{l}</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 800, color: PAPER }}>{n}</div>
            {sub && <div style={{ fontFamily: SANS, fontSize: 10.5, color: PAPER_QUIET }}>{sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET }}>
        {SURFACES[surface].note} Drag a tile onto a group, or tap a tile then tap <b style={{ color: PAPER }}>Move here</b>. Your work saves in this browser as you go.
      </div>

      {/* ── editor + inspector ── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 560px", minWidth: 0, display: "grid", gap: 10 }}>
          {layout.zones.map((z, zi) => {
            const list = layout.place[z.id] || [];
            const isOver = over === z.id;
            const canDrop = sel && zoneOf(sel)?.id !== z.id;
            return (
              <div
                key={z.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(z.id);
                }}
                onDragLeave={() => setOver((o) => (o === z.id ? null : o))}
                onDrop={(e) => onDrop(e, z.id)}
                style={{ border: `1px ${z.kind === "bin" ? "dashed" : "solid"} ${isOver ? ACCENT : LINE}`, borderRadius: R_LG, background: isOver ? rgba(ACCENT, 0.08) : z.kind === "bin" ? "transparent" : ELEV, padding: 10 }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                  <input value={z.name} onChange={(e) => patchZone(z.id, { name: e.target.value })} style={{ ...input, width: 160, fontWeight: 700, padding: "4px 8px" }} />
                  <select value={z.kind} onChange={(e) => patchZone(z.id, { kind: e.target.value as ZoneKind, group: e.target.value === "panel" ? "pop" : undefined })} style={{ ...input, padding: "4px 6px", fontSize: 11.5 }}>
                    {ZONE_KINDS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: PAPER_QUIET }}>{list.length}</span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {canDrop && (
                      <button type="button" style={btn(true, GOOD)} onClick={() => moveTo(sel!, z.id)}>
                        ⤓ Move here
                      </button>
                    )}
                    <button type="button" title="Add a control" style={btn()} onClick={() => addItem(z.id)}>
                      ＋
                    </button>
                    <button type="button" title="Move group up" disabled={zi === 0} style={{ ...btn(), opacity: zi === 0 ? 0.35 : 1 }} onClick={() => moveZone(z.id, -1)}>
                      ↑
                    </button>
                    <button type="button" title="Move group down" disabled={zi === layout.zones.length - 1} style={{ ...btn(), opacity: zi === layout.zones.length - 1 ? 0.35 : 1 }} onClick={() => moveZone(z.id, 1)}>
                      ↓
                    </button>
                    {z.kind !== "bin" && (
                      <button type="button" title="Delete group (its controls go to Removed)" style={btn()} onClick={() => deleteZone(z.id)}>
                        🗑
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 30 }}>
                  {list.length === 0 && <span style={{ fontFamily: SANS, fontSize: 12, color: PAPER_QUIET, padding: "6px 2px" }}>Empty · drop here</span>}
                  {list.map((id, i) => {
                    const it = layout.items[id];
                    if (!it) return null;
                    const on = sel === id;
                    return (
                      <span
                        key={id}
                        draggable
                        onDragStart={(e) => {
                          dragId.current = id;
                          try {
                            e.dataTransfer.setData("text/plain", id);
                          } catch {
                            /* ignore */
                          }
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => onDrop(e, z.id, i)}
                        onClick={() => setSel(on ? null : id)}
                        title={`${it.label} · ${KINDS.find(([k]) => k === it.kind)?.[1]}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontFamily: SANS,
                          fontSize: 12,
                          fontWeight: 700,
                          padding: "5px 9px",
                          borderRadius: 8,
                          cursor: "grab",
                          userSelect: "none",
                          border: `1px solid ${on ? VOLT : LINE}`,
                          background: on ? rgba(VOLT, 0.14) : z.kind === "bin" ? "transparent" : PANEL,
                          color: z.kind === "bin" ? PAPER_QUIET : PAPER,
                          textDecoration: z.kind === "bin" ? "line-through" : "none",
                        }}
                      >
                        <span style={{ color: PAPER_QUIET, fontSize: 10 }}>⠿</span>
                        {it.icon && <span>{it.icon}</span>}
                        {it.label}
                        <span style={{ fontFamily: MONO, fontSize: 9, color: kindTone(it.kind), marginLeft: 2 }}>{kindTag(it.kind)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <button type="button" style={{ ...btn(), borderStyle: "dashed", color: ACCENT_TEXT }} onClick={addZone}>
            ＋ Add a group
          </button>
        </div>

        {/* inspector */}
        <div style={{ flex: "0 1 280px", minWidth: 250, position: "sticky", top: 12, display: "grid", gap: 10, padding: 14, background: ELEV, border: `1px solid ${selItem ? VOLT : LINE}`, borderRadius: R_LG }}>
          {!selItem ? (
            <div style={{ fontFamily: SANS, fontSize: 12.5, color: PAPER_QUIET, lineHeight: 1.5 }}>Tap any tile to rename it, change what kind of control it is, reorder it or move it to another group.</div>
          ) : (
            <>
              <div style={cap}>Selected control</div>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={cap}>Label</span>
                <input value={selItem.label} onChange={(e) => patchItem(selItem.id, { label: e.target.value })} style={input} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={cap}>Icon (any character)</span>
                <input value={selItem.icon} onChange={(e) => patchItem(selItem.id, { icon: e.target.value })} style={{ ...input, width: 80 }} />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={cap}>Kind of control</span>
                <select value={selItem.kind} onChange={(e) => patchItem(selItem.id, { kind: e.target.value as Kind })} style={input}>
                  {KINDS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={cap}>Group</span>
                <select value={zoneOf(selItem.id)?.id ?? ""} onChange={(e) => moveTo(selItem.id, e.target.value)} style={input}>
                  {layout.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={btn()} onClick={() => nudge(selItem.id, -1)}>
                  ← Earlier
                </button>
                <button type="button" style={btn()} onClick={() => nudge(selItem.id, 1)}>
                  Later →
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={btn()} onClick={() => setSel(null)}>
                  Done
                </button>
                <button type="button" style={{ ...btn(), color: BAD }} onClick={() => deleteItem(selItem.id)}>
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── live preview ── */}
      <div>
        <div style={{ ...cap, color: ACCENT_TEXT, fontSize: 10, marginBottom: 6 }}>Live preview · {SURFACES[surface].label}</div>
        <Preview surface={surface} layout={layout} look={look} />
      </div>
    </div>
  );
}

function kindTag(k: Kind): string {
  return { button: "BTN", dropdown: "▾", toggle: "ON/OFF", chip: "CHIP", tab: "TAB", seg: "SEG", slider: "SLIDE", search: "⌕", row: "ROW", page: "PAGE" }[k];
}
function kindTone(k: Kind): string {
  return k === "slider" ? DARK_POOL : k === "toggle" ? GOOD : k === "dropdown" ? ACCENT_TEXT : k === "tab" ? VOLT : PAPER_QUIET;
}
