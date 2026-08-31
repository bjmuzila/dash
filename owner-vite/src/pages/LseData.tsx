import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  OWNER_THEME,
  classicCardStyle,
  homeButtonStyle,
  homeContentStyle,
  homeInputStyle,
  homeSecondaryButtonStyle,
  homeShellStyle,
  ownerRgba,
} from "../lib/theme";

/**
 * LSE Data — London Strategic Edge vault browser.
 *
 * The Node port of the interactive futures_data_downloader.py CLI: its menu is
 * the tab strip, its input() prompts are the fields, and save_to_csv() is the
 * Download CSV button (which hits the same endpoint with format=csv and lets
 * the browser stream the file straight to disk — the big pulls never land in
 * this tab's memory).
 *
 * Every request goes to /api/lse/* on this origin, which is owner-gated in
 * server-v2/api-router.js and holds the API key server-side. The key is never
 * shipped to the client.
 */

type Row = Record<string, unknown>;

/**
 * What the status probe actually learned. Kept as a union rather than two
 * booleans because "the key is missing" and "the route isn't deployed" need
 * completely different fixes, and collapsing them sends you to the wrong one.
 */
type StatusState =
  | { kind: "ok" }
  | { kind: "nokey" }
  | { kind: "unreachable"; error: string }
  | { kind: "denied"; http: number }
  | { kind: "route-missing"; http: number }
  | { kind: "failed"; error: string };
type TabId = "catalog" | "candles" | "chain" | "flow" | "contract";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "catalog", label: "Catalog", hint: "every symbol the vault holds, with its history span" },
  { id: "candles", label: "Candles", hint: "OHLCV for futures, stocks, FX, crypto, indices" },
  { id: "chain", label: "Options Chain", hint: "current chain with IV, greeks and today's volume" },
  { id: "flow", label: "Options Flow", hint: "the print tape — trailing week" },
  { id: "contract", label: "Contract Candles", hint: "1m premium bars for one option contract" },
];

const PREVIEW_ROWS = 300;

// ── shared bits of chrome ────────────────────────────────────────────────────

const cardStyle: CSSProperties = { ...classicCardStyle, padding: 18, position: "relative", zIndex: 1 };

/**
 * The filter card, raised above every card below it.
 *
 * WHY THIS IS NOT JUST A z-index ON THE DROPDOWN. `classicCardStyle` carries
 * `backdrop-filter: blur(16px)`, and a backdrop-filter creates a STACKING
 * CONTEXT. That makes each card an atomic layer: the z-index on the popup
 * inside this card only orders it against its siblings INSIDE this card, and
 * the results card below — a later sibling, its own stacking context — still
 * paints over the whole thing. The popup was drawing correctly and getting
 * covered anyway.
 *
 * The fix has to be at the layer that actually competes: this card outranks
 * the ones after it, so anything it contains does too.
 */
const filterCardStyle: CSSProperties = { ...cardStyle, zIndex: 30 };

/**
 * ONE control height for every input, select, checkbox row and button in the
 * filter bar. The first version let each control size itself and aligned the
 * row on `flex-end`, which meant a field WITH a hint sat lower than one
 * without, and the labels staggered across the row. Fixing the label block and
 * the control to the same height in every field, then aligning the row to the
 * TOP, makes the labels share a line and the inputs share a line — hints can
 * then wrap to two lines without moving anything above them.
 */
const CONTROL_H = 40;
const LABEL_H = 14;

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: OWNER_THEME.text,
  display: "block",
  height: LABEL_H,
  lineHeight: `${LABEL_H}px`,
  marginBottom: 7,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const hintStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: "14px",
  color: OWNER_THEME.text,
  marginTop: 5,
};

const fieldRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  columnGap: 14,
  rowGap: 16,
};

function Field({
  label,
  hint,
  width = 160,
  grow = false,
  children,
}: {
  label: string;
  hint?: string;
  width?: number;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <div style={{ flex: `${grow ? 1 : 0} 1 ${width}px`, minWidth: width, maxWidth: grow ? undefined : width }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint ? <div style={hintStyle}>{hint}</div> : null}
    </div>
  );
}

const inputStyle: CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  height: CONTROL_H,
  padding: "0 12px",
  boxSizing: "border-box",
  color: OWNER_THEME.text,
  colorScheme: "dark",
};

/**
 * A native <select> renders its popup with the OS's own widget, which on
 * Windows is a light-grey menu no matter what the closed control looks like.
 * `color-scheme: dark` is the property Chrome honours there - it repaints the
 * popup, its scrollbar and the highlight row dark. The explicit per-<option>
 * colors back it up in browsers that ignore it. `appearance: none` drops the
 * native arrow so the caret below can be a themed one instead of a grey OS
 * triangle sitting on a dark field.
 */
const selectStyle: CSSProperties = {
  ...homeInputStyle,
  width: "100%",
  height: CONTROL_H,
  boxSizing: "border-box",
  color: OWNER_THEME.text,
  colorScheme: "dark",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  padding: "0 30px 0 12px",
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0l5 6 5-6z' fill='white'/></svg>\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 11px center",
  cursor: "pointer",
};

const optionStyle: CSSProperties = {
  background: OWNER_THEME.panelBgStrong,
  color: OWNER_THEME.text,
};

/** A checkbox styled to occupy exactly one control slot, so it lines up. */
function CheckField({
  label,
  hint,
  text,
  checked,
  onChange,
  width = 190,
}: {
  label: string;
  hint?: string;
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  width?: number;
}) {
  return (
    <Field label={label} hint={hint} width={width}>
      <label
        style={{
          ...inputStyle,
          display: "flex",
          alignItems: "center",
          gap: 9,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 600,
          color: checked ? OWNER_THEME.cyan : OWNER_THEME.text,
          borderColor: checked ? ownerRgba(OWNER_THEME.cyan, 0.45) : OWNER_THEME.border,
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: OWNER_THEME.cyan, width: 15, height: 15, flexShrink: 0, cursor: "pointer" }}
        />
        {text}
      </label>
    </Field>
  );
}

type CatalogHit = {
  symbol: string;
  name: string;
  dataset: string;
  category: string;
  first: string | null;
  last: string | null;
  ticks: number | null;
};

const pickerListStyle: CSSProperties = {
  position: "absolute",
  top: CONTROL_H + 5,
  left: 0,
  zIndex: 40,
  minWidth: 380,
  maxWidth: 520,
  maxHeight: 320,
  overflowY: "auto",
  background: OWNER_THEME.panelBgStrong,
  border: `1px solid ${OWNER_THEME.borderStrong}`,
  borderRadius: 12,
  boxShadow: "0 22px 48px rgba(0,0,0,0.55)",
  padding: 5,
};

const pickerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "7px 10px",
  border: "none",
  borderRadius: 8,
  background: "transparent",
  color: OWNER_THEME.text,
  fontSize: 12.5,
  cursor: "pointer",
};

/**
 * Type-ahead over the vault catalog.
 *
 * THE CATALOG IS THE ANSWER TO "what is the symbol for ES". Guessing between
 * ES, ESU6, ESU26, ES=F and ESc1 is exactly the 404 the original Python script
 * printed a four-line hint about, and futures alone are only 69 rows — so the
 * fix is not a hint, it is showing the list. Typing filters symbol AND name
 * server-side; picking a row writes the exact catalog string into the field,
 * along with the history span so a start date can't be set before the data
 * begins.
 */
function SymbolPicker({
  value,
  onChange,
  dataset,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  dataset?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    // Debounced: the catalog is 22k rows and the filter runs server-side, so
    // firing per keystroke would queue requests behind each other.
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ limit: "40" });
        if (value.trim()) p.set("search", value.trim());
        if (dataset) p.set("dataset", dataset);
        const r = await fetch(`/api/lse/catalog?${p}`, { credentials: "include" });
        const j = await r.json();
        if (live) setHits(Array.isArray(j.rows) ? j.rows.slice(0, 40) : []);
      } catch {
        if (live) setHits([]);
      } finally {
        if (live) setLoading(false);
      }
    }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [value, dataset, open]);

  return (
    <div style={{ position: "relative" }}>
      <input
        style={inputStyle}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Delayed so a click on a row lands before the list unmounts; the
        // rows also preventDefault on mousedown so the input never blurs first.
        onBlur={() => window.setTimeout(() => setOpen(false), 160)}
      />
      {open && !disabled ? (
        <div style={pickerListStyle}>
          {loading && !hits.length ? (
            <div style={{ ...pickerRowStyle, cursor: "default" }}>searching the catalog…</div>
          ) : null}
          {!loading && !hits.length ? (
            <div style={{ ...pickerRowStyle, cursor: "default" }}>
              nothing in the catalog matches that
            </div>
          ) : null}
          {hits.map((h) => (
            <button
              key={`${h.dataset}:${h.symbol}`}
              type="button"
              style={pickerRowStyle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(h.symbol); setOpen(false); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = OWNER_THEME.panelHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontWeight: 800, color: OWNER_THEME.cyan, minWidth: 92 }}>{h.symbol}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.name || h.category}
              </span>
              <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                {h.first ? `${String(h.first).slice(0, 10)} → ${String(h.last || "").slice(0, 10)}` : h.category}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── themed date picker ──────────────────────────────────────────────────────

/** Local-time YYYY-MM-DD. Never via toISOString(), which shifts to UTC and
 *  hands back yesterday for anyone west of Greenwich after 7pm. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The 6x7 block a month is drawn on, padded out with its neighbours' days. */
function monthGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const calPopStyle: CSSProperties = {
  position: "absolute",
  top: CONTROL_H + 5,
  left: 0,
  zIndex: 41,
  padding: 12,
  background: OWNER_THEME.panelBgStrong,
  border: `1px solid ${OWNER_THEME.borderStrong}`,
  borderRadius: 14,
  boxShadow: "0 22px 48px rgba(0,0,0,0.55)",
};

const calNavStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: `1px solid ${OWNER_THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  color: OWNER_THEME.text,
  fontSize: 15,
  lineHeight: "1",
  cursor: "pointer",
};

const calFootStyle: CSSProperties = {
  height: 28,
  padding: "0 11px",
  borderRadius: 8,
  border: `1px solid ${OWNER_THEME.border}`,
  background: "rgba(255,255,255,0.04)",
  color: OWNER_THEME.text,
  fontSize: 11.5,
  fontWeight: 700,
  cursor: "pointer",
};

/**
 * A date field with a calendar built from the theme's own tokens.
 *
 * `<input type="date">` was the first cut, but its popup is the browser's —
 * `color-scheme: dark` makes it dark and that is the entire extent of the
 * control you get over it, so it never matches the surfaces around it. This
 * draws the month itself: same panel, same border, same cyan as everything
 * else on the page.
 *
 * The text input stays editable on purpose. The Candles Start field accepts
 * the literal `MAX` (all available history), which no calendar can express —
 * so `allowMax` adds it as a button rather than taking typing away.
 */
function DateField({
  value,
  onChange,
  placeholder,
  allowMax = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  allowMax?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(() => parseYmd(value) ?? new Date());
  const todayKey = ymd(new Date());
  const days = useMemo(() => monthGrid(view), [view]);

  // Typing a full date walks the calendar to it, so the two never disagree.
  useEffect(() => {
    const sel = parseYmd(value);
    if (sel) setView(new Date(sel.getFullYear(), sel.getMonth(), 1));
  }, [value]);

  const pick = (v: string) => { onChange(v); setOpen(false); };

  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ ...inputStyle, paddingRight: 36 }}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        aria-label="Open calendar"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "absolute",
          right: 4,
          top: 4,
          width: 30,
          height: CONTROL_H - 8,
          borderRadius: 7,
          border: "none",
          background: "transparent",
          color: open ? OWNER_THEME.cyan : OWNER_THEME.text,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ▤
      </button>

      {open ? (
        <>
          {/* Click-away. A fixed backdrop is used instead of the input's blur
              because the calendar's own buttons are focusable and blur would
              close it out from under the click. */}
          <div onMouseDown={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={calPopStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <button type="button" style={calNavStyle} onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}>‹</button>
              <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 800, color: OWNER_THEME.text, whiteSpace: "nowrap" }}>
                {view.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </div>
              <button type="button" style={calNavStyle} onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}>›</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 32px)", gap: 2 }}>
              {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
                <div
                  key={i}
                  style={{ textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", color: OWNER_THEME.text, padding: "3px 0" }}
                >
                  {w}
                </div>
              ))}
              {days.map((d) => {
                const key = ymd(d);
                const inMonth = d.getMonth() === view.getMonth();
                const isSel = String(value).trim() === key;
                const isToday = key === todayKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => pick(key)}
                    style={{
                      height: 30,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: isSel ? 800 : 600,
                      fontVariantNumeric: "tabular-nums",
                      border: isToday && !isSel ? `1px solid ${ownerRgba(OWNER_THEME.cyan, 0.55)}` : "1px solid transparent",
                      background: isSel ? OWNER_THEME.cyan : "transparent",
                      color: isSel ? OWNER_THEME.bg : OWNER_THEME.text,
                      opacity: inMonth ? 1 : 0.32,
                    }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = OWNER_THEME.panelHover; }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
              <button type="button" style={calFootStyle} onClick={() => pick(todayKey)}>Today</button>
              {allowMax ? (
                <button type="button" style={calFootStyle} onClick={() => pick("MAX")}>Max history</button>
              ) : null}
              <button type="button" style={{ ...calFootStyle, marginLeft: "auto" }} onClick={() => pick("")}>Clear</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const OSI_RE = /^([A-Z][A-Z0-9.]{0,5})(\d{6})([CP])(\d{8})$/;

/**
 * ticker + expiry + strike + type → the OSI contract ticker the vault indexes
 * option candles by: root, YYMMDD, C or P, then the strike in thousandths
 * padded to eight digits. AAPL + 2026-06-12 + 205 + call → AAPL260612C00205000.
 * Returns null while the parts are incomplete, which is what greys the readout.
 */
function buildOsi(root: string, expiry: string, strike: string, type: string): string | null {
  const r = root.trim().toUpperCase();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry.trim());
  const s = Number(String(strike).trim());
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(r) || !m || !Number.isFinite(s) || s <= 0) return null;
  return `${r}${m[1].slice(2)}${m[2]}${m[3]}${type === "put" ? "P" : "C"}` +
    String(Math.round(s * 1000)).padStart(8, "0");
}

/** The same thing backwards, so pasting an OSI fills the four fields. */
function parseOsi(osi: string): { root: string; expiry: string; strike: string; type: string } | null {
  const m = OSI_RE.exec(String(osi).trim().toUpperCase());
  if (!m) return null;
  return {
    root: m[1],
    expiry: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`,
    type: m[3] === "P" ? "put" : "call",
    strike: String(Number(m[4]) / 1000),
  };
}

/** Cells: numbers get thousands separators, ISO stamps get trimmed, rest clipped. */
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    return Number.isInteger(v)
      ? v.toLocaleString("en-US")
      : v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s.replace("T", " ").replace(/(\.\d+)?Z?$/, "");
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

function DataTable({ rows }: { rows: Row[] }) {
  const cols = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows.slice(0, 50)) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
    return out;
  }, [rows]);

  if (!rows.length) return null;

  return (
    <div style={{ overflow: "auto", maxHeight: "52vh", borderRadius: 12, border: `1px solid ${OWNER_THEME.border}` }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: OWNER_THEME.panelBgStrong,
                  textAlign: "left",
                  padding: "9px 12px",
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: OWNER_THEME.text,
                  borderBottom: `1px solid ${OWNER_THEME.border}`,
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? ownerRgba(OWNER_THEME.text, 0.02) : "transparent" }}>
              {cols.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "7px 12px",
                    borderBottom: `1px solid ${ownerRgba(OWNER_THEME.text, 0.05)}`,
                    whiteSpace: "nowrap",
                    color: OWNER_THEME.text,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmt(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function LseData() {
  const [tab, setTab] = useState<TabId>("catalog");
  const [status, setStatus] = useState<StatusState | null>(null);
  const [datasets, setDatasets] = useState<{ id: string; label: string; count: number }[]>([]);
  const [timeframes, setTimeframes] = useState<string[]>([
    "1s", "5s", "15s", "30s", "1m", "3m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1mo",
  ]);

  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalog
  const [catDataset, setCatDataset] = useState("");
  const [catSearch, setCatSearch] = useState("");

  // Candles
  const [cSymbol, setCSymbol] = useState("NQ");
  const [cTimeframe, setCTimeframe] = useState("1m");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const [cDataset, setCDataset] = useState("");
  const [cAll, setCAll] = useState(false);

  // Chain
  const [chUnderlying, setChUnderlying] = useState("SPY");
  const [chType, setChType] = useState("");
  const [chExpiry, setChExpiry] = useState("");
  const [chMinDte, setChMinDte] = useState("");
  const [chMaxDte, setChMaxDte] = useState("30");

  // Flow
  const [flUnderlying, setFlUnderlying] = useState("");
  const [flType, setFlType] = useState("");
  const [flMinPremium, setFlMinPremium] = useState("100000");
  const [flMaxDte, setFlMaxDte] = useState("");
  const [flStart, setFlStart] = useState("");
  const [flEnd, setFlEnd] = useState("");
  const [flAll, setFlAll] = useState(false);

  // Contract candles. The four PARTS are the source of truth; the paste box is
  // transient — an OSI dropped into it is split into the parts and cleared.
  const [ctPaste, setCtPaste] = useState("");
  const [ctUnderlying, setCtUnderlying] = useState("");
  const [ctStrike, setCtStrike] = useState("");
  const [ctExpiry, setCtExpiry] = useState("");
  const [ctType, setCtType] = useState("call");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch("/api/lse/status", { credentials: "include" });
        const ct = r.headers.get("content-type") || "";
        // A non-JSON body here means the request never reached the route: the
        // SPA/Next fallback answered with HTML. That is a DEPLOY problem, and
        // the first version of this page reported it as "key not set", which
        // sent you to the VPS to fix an env var that was already correct.
        if (!r.ok || !ct.includes("application/json")) {
          if (live) {
            setStatus(r.status === 401 || r.status === 403
              ? { kind: "denied", http: r.status }
              : { kind: "route-missing", http: r.status });
          }
        } else {
          const j = await r.json();
          if (live) {
            if (j.configured === false) setStatus({ kind: "nokey" });
            else if (j.reachable === false) setStatus({ kind: "unreachable", error: String(j.error || "unknown error") });
            else setStatus({ kind: "ok" });
          }
        }
      } catch (e) {
        if (live) setStatus({ kind: "failed", error: e instanceof Error ? e.message : String(e) });
      }
      try {
        const r = await fetch("/api/lse/catalog?datasets=1", { credentials: "include" });
        const j = await r.json();
        if (live && Array.isArray(j.datasets)) setDatasets(j.datasets);
      } catch { /* picker falls back to a free-text dataset field */ }
      try {
        const r = await fetch("/api/lse/timeframes", { credentials: "include" });
        const j = await r.json();
        if (live && Array.isArray(j.timeframes)) setTimeframes(j.timeframes);
      } catch { /* the hardcoded list above is the same list */ }
    })();
    return () => { live = false; };
  }, []);

  /**
   * Build the query for whichever tab is active. One place, so Preview and
   * Download can never disagree about what is being asked for — the only
   * difference between them is `format=csv`.
   */
  const request = useCallback((): { path: string; params: URLSearchParams } => {
    const p = new URLSearchParams();
    switch (tab) {
      case "catalog":
        if (catDataset) p.set("dataset", catDataset);
        if (catSearch.trim()) p.set("search", catSearch.trim());
        return { path: "/api/lse/catalog", params: p };
      case "candles":
        p.set("symbol", cSymbol.trim().toUpperCase());
        p.set("timeframe", cTimeframe);
        if (cStart.trim()) p.set("start", cStart.trim());
        if (cEnd.trim()) p.set("end", cEnd.trim());
        if (cDataset) p.set("dataset", cDataset);
        if (cAll) p.set("all", "1");
        return { path: "/api/lse/candles", params: p };
      case "chain":
        p.set("underlying", chUnderlying.trim());
        if (chType) p.set("type", chType);
        if (chExpiry.trim()) p.set("expiry", chExpiry.trim());
        if (chMinDte.trim()) p.set("min_dte", chMinDte.trim());
        if (chMaxDte.trim()) p.set("max_dte", chMaxDte.trim());
        return { path: "/api/lse/options-chain", params: p };
      case "flow":
        if (flUnderlying.trim()) p.set("underlying", flUnderlying.trim());
        if (flType) p.set("type", flType);
        if (flMinPremium.trim()) p.set("min_premium", flMinPremium.trim());
        if (flMaxDte.trim()) p.set("max_dte", flMaxDte.trim());
        if (flStart.trim()) p.set("start", flStart.trim());
        if (flEnd.trim()) p.set("end", flEnd.trim());
        if (flAll) p.set("all", "1");
        return { path: "/api/lse/options-flow", params: p };
      case "contract":
      default:
        // Send the parts, not the OSI we render: the server resolves a company
        // name to its ticker before assembling the contract, and it is the one
        // that has the catalog. The readout is what the user checks; this is
        // what the vault is asked.
        p.set("underlying", ctUnderlying.trim());
        p.set("strike", ctStrike.trim());
        p.set("expiry", ctExpiry.trim());
        p.set("type", ctType);
        return { path: "/api/lse/option-candles", params: p };
    }
  }, [
    tab, catDataset, catSearch,
    cSymbol, cTimeframe, cStart, cEnd, cDataset, cAll,
    chUnderlying, chType, chExpiry, chMinDte, chMaxDte,
    flUnderlying, flType, flMinPremium, flMaxDte, flStart, flEnd, flAll,
    ctUnderlying, ctStrike, ctExpiry, ctType,
  ]);

  /** The OSI the four parts spell out, live. null until they are complete. */
  const ctOsi = useMemo(
    () => buildOsi(ctUnderlying, ctExpiry, ctStrike, ctType),
    [ctUnderlying, ctExpiry, ctStrike, ctType],
  );

  /** Paste an OSI → it splits into the parts and the box empties itself. */
  const onPasteOsi = useCallback((v: string) => {
    const parsed = parseOsi(v);
    if (!parsed) { setCtPaste(v); return; }
    setCtUnderlying(parsed.root);
    setCtExpiry(parsed.expiry);
    setCtStrike(parsed.strike);
    setCtType(parsed.type);
    setCtPaste("");
  }, []);

  const preview = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRows([]);
    setMeta("");
    const { path, params } = request();
    if (tab === "catalog") params.set("limit", String(PREVIEW_ROWS * 4));
    try {
      const r = await fetch(`${path}?${params}`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      const got: Row[] = Array.isArray(j.rows) ? j.rows : [];
      setRows(got);
      const bits = [`${got.length.toLocaleString("en-US")} rows`];
      if (typeof j.total === "number" && j.total !== got.length) {
        bits.push(`${j.total.toLocaleString("en-US")} match the filter`);
      }
      if (j.start) bits.push(`from ${String(j.start).slice(0, 10)}`);
      if (j.truncated) bits.push("preview capped — use Download CSV for everything");
      if (j.note) bits.push(String(j.note));
      setMeta(bits.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [request, tab]);

  /**
   * Same URL plus format=csv, handed to the browser. A plain navigation keeps
   * the session cookie, streams to disk, and survives a pull far larger than
   * this tab could hold.
   */
  const download = useCallback(() => {
    const { path, params } = request();
    params.set("format", "csv");
    window.location.assign(`${path}?${params}`);
  }, [request]);

  const banner = (() => {
    if (!status || status.kind === "ok") return null;
    switch (status.kind) {
      case "nokey":
        return {
          tone: OWNER_THEME.red,
          text: "LSE_API_KEY is missing from the server's environment. Add it to .env.local on the VPS and recreate the dashboard container.",
        };
      case "unreachable":
        return { tone: OWNER_THEME.gold, text: `Key present, but the vault did not answer: ${status.error}` };
      case "denied":
        return {
          tone: OWNER_THEME.gold,
          text: `The owner gate refused this request (HTTP ${status.http}). Sign in again on the owner account.`,
        };
      case "route-missing":
        return {
          tone: OWNER_THEME.red,
          text: `/api/lse/status answered HTTP ${status.http} with a non-JSON body — the running build does not have the LSE routes yet. This is a deploy, not a key.`,
        };
      default:
        return { tone: OWNER_THEME.red, text: `Status check failed: ${status.error}` };
    }
  })();

  return (
    <div style={homeShellStyle}>
      <div style={{ ...homeContentStyle, overflow: "auto" }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "0.01em", color: OWNER_THEME.text }}>
          LSE Data
        </h1>
        <div style={{ fontSize: 13, color: OWNER_THEME.text, marginTop: 4 }}>
          London Strategic Edge vault — catalog, candles, option chains, flow and contract bars. Preview here,
          download the full pull as CSV.
        </div>
      </div>

      {banner ? (
        <div
          style={{
            ...cardStyle,
            padding: "12px 16px",
            border: `1px solid ${ownerRgba(banner.tone, 0.45)}`,
            color: banner.tone,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {banner.text}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", position: "relative", zIndex: 2 }}>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              title={t.hint}
              onClick={() => { setTab(t.id); setRows([]); setMeta(""); setError(null); }}
              style={{
                ...(on ? homeButtonStyle : homeSecondaryButtonStyle),
                padding: "8px 14px",
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div style={filterCardStyle}>
        <div style={{ fontSize: 12.5, color: OWNER_THEME.text, marginBottom: 14 }}>
          {TABS.find((t) => t.id === tab)?.hint}
        </div>

        <div style={fieldRowStyle}>
          {tab === "catalog" ? (
            <>
              <Field label="Dataset" width={200}>
                <select style={selectStyle} value={catDataset} onChange={(e) => setCatDataset(e.target.value)}>
                  <option style={optionStyle} value="">All datasets</option>
                  {datasets.map((d) => (
                    <option style={optionStyle} key={d.id} value={d.id}>{`${d.label} (${d.count.toLocaleString("en-US")})`}</option>
                  ))}
                </select>
              </Field>
              <Field label="Search" width={220} hint="symbol or company name">
                <input
                  style={inputStyle}
                  value={catSearch}
                  onChange={(e) => setCatSearch(e.target.value)}
                  placeholder="NQ, apple, BTC…"
                />
              </Field>
            </>
          ) : null}

          {tab === "candles" ? (
            <>
              <Field label="Symbol" width={165} hint="pick from the catalog">
                <SymbolPicker
                  value={cSymbol}
                  onChange={setCSymbol}
                  dataset={cDataset || undefined}
                  placeholder="ES, NQ, SPX…"
                />
              </Field>
              <Field label="Timeframe" width={120}>
                <select style={selectStyle} value={cTimeframe} onChange={(e) => setCTimeframe(e.target.value)}>
                  {timeframes.map((t) => <option style={optionStyle} key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Start" width={165} hint="a date, MAX, or blank for 30d">
                <DateField value={cStart} onChange={setCStart} placeholder="MAX" allowMax />
              </Field>
              <Field label="End" width={165} hint="optional">
                <DateField value={cEnd} onChange={setCEnd} placeholder="today" />
              </Field>
              <Field label="Dataset" width={150} hint="pin the asset class">
                <select style={selectStyle} value={cDataset} onChange={(e) => setCDataset(e.target.value)}>
                  <option style={optionStyle} value="">auto</option>
                  {datasets.map((d) => <option style={optionStyle} key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </Field>
              <CheckField
                label="Range"
                hint="one call caps at 5,000 bars"
                text="Walk it all"
                checked={cAll}
                onChange={setCAll}
                width={150}
              />
            </>
          ) : null}

          {tab === "chain" ? (
            <>
              <Field label="Underlying" width={175} hint="ticker or company name">
                <SymbolPicker value={chUnderlying} onChange={setChUnderlying} dataset="options" placeholder="SPY" />
              </Field>
              <Field label="Type" width={120}>
                <select style={selectStyle} value={chType} onChange={(e) => setChType(e.target.value)}>
                  <option style={optionStyle} value="">Both</option>
                  <option style={optionStyle} value="call">Calls</option>
                  <option style={optionStyle} value="put">Puts</option>
                </select>
              </Field>
              <Field label="Expiry" width={165} hint="one date, optional">
                <DateField value={chExpiry} onChange={setChExpiry} placeholder="any expiry" />
              </Field>
              <Field label="Min DTE" width={110}>
                <input style={inputStyle} value={chMinDte} onChange={(e) => setChMinDte(e.target.value)} placeholder="" />
              </Field>
              <Field label="Max DTE" width={110}>
                <input style={inputStyle} value={chMaxDte} onChange={(e) => setChMaxDte(e.target.value)} placeholder="30" />
              </Field>
            </>
          ) : null}

          {tab === "flow" ? (
            <>
              <Field label="Underlying" width={175} hint="blank sweeps the whole tape">
                <SymbolPicker value={flUnderlying} onChange={setFlUnderlying} dataset="options" placeholder="all names" />
              </Field>
              <Field label="Type" width={120}>
                <select style={selectStyle} value={flType} onChange={(e) => setFlType(e.target.value)}>
                  <option style={optionStyle} value="">Both</option>
                  <option style={optionStyle} value="call">Calls</option>
                  <option style={optionStyle} value="put">Puts</option>
                </select>
              </Field>
              <Field label="Min premium" width={150}>
                <input style={inputStyle} value={flMinPremium} onChange={(e) => setFlMinPremium(e.target.value)} placeholder="100000" />
              </Field>
              <Field label="Max DTE" width={110}>
                <input style={inputStyle} value={flMaxDte} onChange={(e) => setFlMaxDte(e.target.value)} placeholder="" />
              </Field>
              <Field label="Start" width={165} hint="optional">
                <DateField value={flStart} onChange={setFlStart} placeholder="earliest" />
              </Field>
              <Field label="End" width={165} hint="optional">
                <DateField value={flEnd} onChange={setFlEnd} placeholder="now" />
              </Field>
              <CheckField
                label="Range"
                hint="one call caps at 5,000 prints"
                text="Walk it all"
                checked={flAll}
                onChange={setFlAll}
                width={150}
              />
            </>
          ) : null}

          {tab === "contract" ? (
            <>
              <Field label="Ticker" width={165} hint="the option's underlying">
                <SymbolPicker value={ctUnderlying} onChange={setCtUnderlying} dataset="options" placeholder="AAPL" />
              </Field>
              <Field label="Expiry" width={165} hint="the contract's expiration">
                <DateField value={ctExpiry} onChange={setCtExpiry} placeholder="2026-06-12" />
              </Field>
              <Field label="Strike" width={120} hint="dollars, e.g. 205 or 205.5">
                <input style={inputStyle} inputMode="decimal" value={ctStrike} onChange={(e) => setCtStrike(e.target.value)} placeholder="205" />
              </Field>
              <Field label="Type" width={110}>
                <select style={selectStyle} value={ctType} onChange={(e) => setCtType(e.target.value)}>
                  <option style={optionStyle} value="call">Call</option>
                  <option style={optionStyle} value="put">Put</option>
                </select>
              </Field>
              <Field label="Or paste an OSI" width={225} hint="splits itself into the fields left">
                <input
                  style={inputStyle}
                  value={ctPaste}
                  onChange={(e) => onPasteOsi(e.target.value)}
                  placeholder="AAPL260612C00205000"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </>
          ) : null}

          {/* Actions ride the same label + control grid as the fields, so the
              buttons sit on the inputs' line rather than on the bottom of
              whichever field happens to be tallest. */}
          <div style={{ marginLeft: "auto", flex: "0 0 auto" }}>
            <div style={{ ...labelStyle, visibility: "hidden" }}>.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={{ ...homeSecondaryButtonStyle, height: CONTROL_H, padding: "0 18px", opacity: busy ? 0.5 : 1 }}
                onClick={preview}
                disabled={busy}
              >
                {busy ? "Loading…" : "Preview"}
              </button>
              <button
                type="button"
                style={{ ...homeButtonStyle, height: CONTROL_H, padding: "0 18px", opacity: busy ? 0.5 : 1 }}
                onClick={download}
                disabled={busy}
              >
                Download CSV
              </button>
            </div>
          </div>
        </div>

        {tab === "contract" ? (
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "11px 14px",
              borderRadius: 12,
              border: `1px solid ${ctOsi ? ownerRgba(OWNER_THEME.cyan, 0.35) : OWNER_THEME.border}`,
              background: OWNER_THEME.panelInset,
            }}
          >
            <span style={{ ...labelStyle, marginBottom: 0, width: "auto" }}>OSI ticker</span>
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: "0.07em",
                color: ctOsi ? OWNER_THEME.cyan : OWNER_THEME.text,
              }}
            >
              {ctOsi || "fill in ticker, expiry and strike"}
            </span>
            {ctOsi ? (
              <>
                <span style={{ fontSize: 12, color: OWNER_THEME.text }}>
                  {`${ctUnderlying.trim().toUpperCase()} · ${ctExpiry} · $${ctStrike} · ${ctType}`}
                </span>
                <button
                  type="button"
                  style={{ ...homeSecondaryButtonStyle, height: 30, padding: "0 13px", fontSize: 12, marginLeft: "auto" }}
                  onClick={() => { void navigator.clipboard?.writeText(ctOsi); }}
                >
                  Copy
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div style={{ ...cardStyle, padding: "12px 16px", border: `1px solid ${ownerRgba(OWNER_THEME.red, 0.45)}`, color: OWNER_THEME.red, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {rows.length ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 12.5, color: OWNER_THEME.text, marginBottom: 12 }}>
            {meta}
            {rows.length > PREVIEW_ROWS
              ? ` · showing the first ${PREVIEW_ROWS.toLocaleString("en-US")}`
              : ""}
          </div>
          <DataTable rows={rows} />
        </div>
      ) : null}

      {!rows.length && !busy && !error ? (
        <div style={{ ...cardStyle, color: OWNER_THEME.text, fontSize: 13 }}>
          {meta
            ? (tab === "candles" || tab === "contract"
                ? "No rows came back. The vault matches the symbol literally — open the Catalog tab, filter to the right dataset, and use the exact string it lists."
                : "No rows came back for those filters. Widen the DTE window or drop the minimum premium.")
            : "Set the filters above, then Preview to see the rows or Download CSV to pull the file. Large pulls stream straight to disk — they never load into this tab."}
        </div>
      ) : null}
      </div>
    </div>
  );
}
