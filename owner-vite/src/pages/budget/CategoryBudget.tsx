import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HOME_THEME,
  RETA_PALETTE,
  TYPE,
  rgba,
  homeInputStyle,
  homeSecondaryButtonStyle,
} from "../../lib/theme";
import { Card } from "../../components/PageCard";

/**
 * Category budgets: the month x category grid, and one category's trend.
 *
 * Lives in its own module because it is rendered in TWO places — the page-level
 * Categories tab (where budgets are created) and Real Month > Categories (where
 * the statement rows behind the numbers are). One component, one definition of
 * "average", so the two surfaces can never disagree about what a category costs.
 *
 * Both readings come from budget_statement_tx via /api/budget/real — what
 * actually cleared, not the plan in budget_register. RealMonth already holds
 * that response, so it passes it in; the Categories tab has no such loader and
 * lets this component fetch for itself.
 */

// ── theme-derived styling (no hardcoded chrome; see DONUT_RAMP for the one
//    deliberate exception, which is a data encoding rather than chrome) ───────
const MONEY_IN = RETA_PALETTE.green;
const MONEY_OUT = HOME_THEME.red;
const ACCENT = HOME_THEME.lightBlue;
const WARN = HOME_THEME.gold;

/**
 * Series colours, shared with the spend donut so a category is the same hue on
 * every chart. Eight hues stepped off the theme's cyan at fixed chroma with
 * lightness alternating between two values — the alternation is what survives
 * deuteranopia, which flattens the red-green axis and would otherwise collapse
 * neighbouring hues into each other.
 *
 * Slots are assigned by STABLE category id order, never by this month's
 * ranking, so "Groceries is violet" stays true when the amounts move.
 */
export const DONUT_RAMP = ["#006e9f", "#7583e0", "#834790", "#d06480", "#9b4803", "#a68a00", "#347426", "#00a698"];
/** Neutral, reserved for the folded tail and for Uncategorized. */
export const DONUT_NEUTRAL = "#6b7480";
export const UNCATEGORIZED = "Uncategorized";

const MUTED: React.CSSProperties = { color: HOME_THEME.muted, opacity: 0.62 };

/**
 * Lift a category colour off the near-black page.
 *
 * Category colours are picked by hand in the editor, and a dark one — the deep
 * maroon on Rent, say — renders as a line you cannot see and a headline number
 * you cannot read, because the chart draws on a near-black ground. This keeps
 * the hue and saturation the user chose and only raises the lightness until it
 * clears a floor, so the colour stays recognisably "the Rent colour" while
 * actually being legible. Anything that is not a plain hex is returned as-is.
 */
export function readable(color: string | null | undefined, minL = 0.5): string {
  const raw = String(color ?? "").trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!m) return raw || HOME_THEME.cyan;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l >= minL) return raw;

  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  // Saturation is nudged up a little too: lightening alone washes a deep hue
  // toward grey, and a grey "Rent" is no more identifiable than a black one.
  const S = Math.min(1, sat * 1.05 + 0.12);
  const c = (1 - Math.abs(2 * minL - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = minL - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, (v + mm) * 255))).toString(16).padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

function field(): React.CSSProperties {
  return {
    ...homeInputStyle,
    width: "100%",
    boxShadow: `inset 0 1px 3px ${rgba("#000000", 0.45)}`,
    colorScheme: "dark",
    accentColor: HOME_THEME.cyan,
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "textfield" as const,
  };
}
function ghost(): React.CSSProperties {
  return { ...homeSecondaryButtonStyle, fontWeight: 800, whiteSpace: "nowrap" };
}
function th(align: "left" | "right" | "center"): React.CSSProperties {
  return {
    textAlign: align, padding: "10px 14px", fontSize: TYPE.label, fontWeight: 800,
    letterSpacing: "0.1em", textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.66,
    borderBottom: `1px solid ${HOME_THEME.border}`, whiteSpace: "nowrap",
  };
}
function td(align: "left" | "right" | "center"): React.CSSProperties {
  return { textAlign: align, padding: "8px 14px", fontSize: TYPE.body, borderBottom: `1px solid ${rgba("#ffffff", 0.05)}` };
}
function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function SectionHead({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "flex-start", gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: TYPE.label, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: ACCENT }}>{title}</div>
        {sub && <div style={{ fontSize: TYPE.label, ...MUTED, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

// ── shared types ────────────────────────────────────────────────────────────
export type Category = { id: number; name: string; amount: number; color?: string | null; period?: string };
/** One (month, category) spend total, as returned by GET /api/budget/real. */
export type TrendPoint = { month: string; categoryId: number | null; spent: number; count: number };
export type MonthStat = { month: string; n: number };

// ── budget vs actual ────────────────────────────────────────────────────────

type BudgetStatus = "crushed" | "ontrack" | "watch" | "over" | "none";
type BudgetRow = {
  name: string; id: number | null; color: string; period: string;
  values: number[]; avg: number; budget: number; ratio: number | null;
  status: BudgetStatus; total: number;
};

const BUDGET_STATUS_UI: Record<BudgetStatus, { label: string; color: string }> = {
  crushed: { label: "CRUSHED IT", color: MONEY_IN },
  ontrack: { label: "ON TRACK", color: HOME_THEME.green },
  watch: { label: "WATCH IT", color: WARN },
  over: { label: "OVER BUDGET", color: MONEY_OUT },
  none: { label: "NO BUDGET", color: HOME_THEME.muted },
};

/** Compact money for a dense grid: no cents, they never survive a 12-wide row. */
function gridMoney(v: number, currency: string): string {
  return fmtMoney(v, currency).replace(/\.\d+$/, "");
}

/**
 * Budget vs actual — every category across the imported months, with the
 * monthly budget editable in place.
 *
 * Status is judged on the AVERAGE, not on the latest month. One expensive
 * week is not a broken budget, and a row that flips to red every time a
 * quarterly bill lands teaches you to ignore the colour.
 *
 * The edit writes through to budget_categories (upsert on name), which is the
 * same row the Categories tab edits — so a budget set here is the budget
 * everywhere, not a copy living in this browser.
 */
function BudgetGrid({
  grid, imported, currency, onSave, onOpenCategories,
}: {
  grid: { axis: string[]; rows: BudgetRow[]; good: number; watch: number; over: number };
  imported: Set<string>;
  currency: string;
  onSave: (row: { name: string; budget: number; color: string; period: string }, amount: number) => Promise<void>;
  onOpenCategories?: () => void;
}) {
  /** Keystrokes live here; nothing is written until blur or Enter. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const commit = async (row: BudgetRow) => {
    const raw = draft[row.name];
    if (raw == null) return;
    const amount = Math.max(0, Number(raw.replace(/[^0-9.]/g, "")) || 0);
    setDraft((d) => { const n = { ...d }; delete n[row.name]; return n; });
    if (amount === row.budget) return;
    setBusy(row.name);
    setErr(null);
    try {
      await onSave({ name: row.name, budget: row.budget, color: row.color, period: row.period }, amount);
    } catch {
      setErr(`Could not save the budget for ${row.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const tile = (label: string, value: number, color: string) => (
    <Card variant="classic" padding="12px 14px" style={{ flex: "1 1 180px", borderColor: rgba(color, 0.35), background: `linear-gradient(180deg, ${rgba(color, 0.1)}, ${rgba("#000000", 0.25)})` }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color, opacity: 0.9 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, marginTop: 2, color: HOME_THEME.text, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </Card>
  );

  const cell: React.CSSProperties = {
    padding: "8px 10px", textAlign: "right", fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    borderBottom: `1px solid ${rgba("#ffffff", 0.05)}`,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {tile("On track / under", grid.good, HOME_THEME.green)}
        {tile("Watch it", grid.watch, WARN)}
        {tile("Over budget", grid.over, MONEY_OUT)}
      </div>

      <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
        <SectionHead
          title="Budget vs actual"
          sub="Every category across the imported months. The monthly budget is editable in place and saves to the category itself, so it is the same budget everywhere. Status reads the average, not the last month."
          right={
            onOpenCategories && (
              <button onClick={onOpenCategories} style={ghost()}>Add / rename categories</button>
            )
          }
        />
        {err && (
          <div style={{ margin: "0 16px 10px", padding: "8px 12px", borderRadius: 10, fontSize: TYPE.label, color: MONEY_OUT, border: `1px solid ${rgba(MONEY_OUT, 0.4)}`, background: rgba(MONEY_OUT, 0.1) }}>
            {err}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...th("left"), position: "sticky", left: 0, background: HOME_THEME.panel, zIndex: 2 }}>Category</th>
                <th style={{ ...th("center"), width: 108 }}>Budget/mo</th>
                {grid.axis.map((m) => (
                  <th key={m} style={{ ...th("right"), width: 70, fontSize: 10 }}>{axisMonth(m).toUpperCase()}</th>
                ))}
                <th style={{ ...th("right"), width: 80 }}>Avg</th>
                <th style={{ ...th("center"), width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((r) => {
                const ui = BUDGET_STATUS_UI[r.status];
                const tint = r.status === "over" ? rgba(MONEY_OUT, 0.07)
                  : r.status === "watch" ? rgba(WARN, 0.06)
                    : "transparent";
                return (
                  <tr key={r.name} style={{ background: tint }}>
                    <td style={{ ...td("left"), position: "sticky", left: 0, background: tint === "transparent" ? HOME_THEME.panel : "transparent", zIndex: 1, fontWeight: 700 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color, flex: "none" }} />
                        {r.name}
                      </div>
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      {r.id == null ? (
                        <span style={{ ...MUTED, fontSize: 11 }}>—</span>
                      ) : (
                        <input
                          value={draft[r.name] ?? (r.budget > 0 ? String(Math.round(r.budget)) : "")}
                          onChange={(e) => setDraft((d) => ({ ...d, [r.name]: e.target.value }))}
                          onBlur={() => void commit(r)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          inputMode="decimal"
                          placeholder="—"
                          disabled={busy === r.name}
                          style={{
                            ...field(), width: 78, textAlign: "right", padding: "5px 8px",
                            fontSize: 12, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                            opacity: busy === r.name ? 0.5 : 1,
                          }}
                        />
                      )}
                    </td>
                    {r.values.map((v, i) => {
                      const known = imported.has(grid.axis[i]);
                      const overThisMonth = r.budget > 0 && v > r.budget;
                      return (
                        <td
                          key={grid.axis[i]}
                          style={{
                            ...cell,
                            color: !known || v === 0 ? HOME_THEME.muted
                              : overThisMonth ? MONEY_OUT : HOME_THEME.text,
                            opacity: !known || v === 0 ? 0.4 : 1,
                            fontWeight: overThisMonth ? 800 : 600,
                          }}
                          title={known ? `${axisMonth(grid.axis[i])} · ${gridMoney(v, currency)}` : "No statement imported"}
                        >
                          {!known ? "·" : v === 0 ? "—" : gridMoney(v, currency)}
                        </td>
                      );
                    })}
                    <td style={{ ...cell, fontWeight: 900, color: r.budget > 0 && r.avg > r.budget ? MONEY_OUT : HOME_THEME.text }}>
                      {r.avg > 0 ? gridMoney(r.avg, currency) : "—"}
                    </td>
                    <td style={{ ...cell, textAlign: "center" }}>
                      <span style={{
                        display: "inline-block", padding: "3px 9px", borderRadius: 999,
                        fontSize: 10, fontWeight: 900, letterSpacing: "0.07em",
                        color: ui.color,
                        border: `1px solid ${rgba(ui.color, 0.45)}`,
                        background: rgba(ui.color, 0.12),
                      }}>
                        {ui.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {grid.rows.length === 0 && (
                <tr><td colSpan={grid.axis.length + 4} style={{ ...td("center"), ...MUTED, padding: 20 }}>No categories yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
// ── category trend ──────────────────────────────────────────────────────────

/** One category's month-over-month spend, with its own average. */
type TrendSeries = {
  name: string; values: number[]; total: number;
  avg: number; months: number; budget: number; color: string;
};

/** Axis label: "Jan", but a January carries its year so a 12-month window
    that straddles New Year doesn't silently restart. */
function axisMonth(m: string): string {
  const mm = Number(m.slice(5, 7));
  const short = new Date(2000, (Number.isFinite(mm) ? mm : 1) - 1, 1).toLocaleDateString("en-US", { month: "short" });
  return mm === 1 ? `${short} '${m.slice(2, 4)}` : short;
}

/** Round a max up to something a human would put on an axis. */
function niceMax(v: number): number {
  if (!(v > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return step * pow;
}

/**
 * Category trend — one category's spend, month over month.
 *
 * The table below it is a single month, which cannot answer the question that
 * immediately follows every single-month number: is that normal? This draws
 * the same category across the imported history, with its own average as the
 * reference line and its budget as a second one.
 *
 * Drawn as BARS, not a line. Monthly spend is twelve separate measurements,
 * not a continuous quantity sampled twelve times — there is no value "between
 * March and April" for a curve to pass through. A spline through those points
 * invented one anyway: it swung below zero between a $281 March and a $0 May
 * and drew hills in months that never had them. A bar can only ever be as tall
 * as the month it stands on.
 *
 * A month with NO statement imported gets a hollow slot rather than a zero-height
 * bar. An unimported month and a month where you genuinely spent nothing are
 * indistinguishable in the totals, and drawing the first as the second invents
 * a floor that was never measured.
 */
function CategoryTrend({
  axis, imported, series, active, onPick, currency,
}: {
  axis: string[];
  imported: Set<string>;
  series: TrendSeries[];
  active: TrendSeries | null;
  onPick: (name: string) => void;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const s = active;

  const W = 880, H = 300, PADL = 62, PADR = 16, PADT = 16, PADB = 30;
  const n = Math.max(axis.length, 1);
  const plotW = W - PADL - PADR;
  const plotH = H - PADT - PADB;

  const top = niceMax(Math.max(s ? Math.max(...s.values) : 0, s?.budget ?? 0, 1) * 1.08);
  const px = (i: number) => (n === 1 ? PADL + plotW / 2 : PADL + (i / (n - 1)) * plotW);
  const py = (v: number) => PADT + plotH - (Math.min(v, top) / top) * plotH;

  // One bar per month. Slot width comes from the axis spacing so twelve months
  // and three months both fill the plot; the bar itself takes 62% of its slot,
  // which keeps the gutters readable without the bars going hairline.
  const slotW = plotW / Math.max(n - 1, 1);
  const barW = Math.max(6, Math.min(46, slotW * 0.62));
  const bars = useMemo(
    () => axis.map((m, i) => {
      const known = imported.has(m);
      const v = known ? s?.values[i] ?? 0 : 0;
      // Clamped into the plot: the first and last bars are centred on the axis
      // ends, so half of each would otherwise hang over the value labels.
      const x = Math.min(Math.max(px(i) - barW / 2, PADL), W - PADR - barW);
      return { i, m, known, v, x, y: py(v), h: Math.max(known && v > 0 ? 2 : 0, PADT + plotH - py(v)) };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [axis, imported, s, top, barW]
  );

  if (!s) return null;

  const gid = `catTrendFill-${s.name.replace(/[^a-z0-9]/gi, "")}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => top * (1 - f));
  const last = s.values[s.values.length - 1] ?? 0;
  const vsAvg = s.avg > 0 ? last - s.avg : 0;
  const hoverM = hover != null ? axis[hover] : null;
  const hoverV = hover != null ? s.values[hover] ?? 0 : 0;
  const hoverKnown = hoverM ? imported.has(hoverM) : false;

  return (
    <Card variant="classic" padding={0} style={{ overflow: "hidden" }}>
      <SectionHead
        title="Category trend"
        sub="Spend per month for one category, against its own average. A break in the line is a month with no statement imported."
        right={
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.color, fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(hover != null && hoverKnown ? hoverV : last, currency)}
            </div>
            <div style={{ fontSize: TYPE.label, ...MUTED }}>
              {hover != null && hoverM ? axisMonth(hoverM) : "this month"}
              {hover == null && s.avg > 0 && (
                <> · <span style={{ color: vsAvg > 0 ? MONEY_OUT : MONEY_IN }}>{vsAvg > 0 ? "+" : ""}{fmtMoney(vsAvg, currency)}</span> vs avg</>
              )}
            </div>
          </div>
        }
      />

      {/* category picker */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", padding: "0 16px 12px" }}>
        {series.map((c) => (
          <button
            key={c.name}
            onClick={() => onPick(c.name)}
            style={{
              padding: "6px 13px", borderRadius: 999, cursor: "pointer",
              fontSize: 12, fontWeight: 800,
              display: "inline-flex", alignItems: "center", gap: 7,
              border: `1px solid ${c.name === s.name ? rgba(c.color, 0.8) : HOME_THEME.border}`,
              background: c.name === s.name
                ? `linear-gradient(180deg, ${rgba(c.color, 0.3)}, ${rgba(c.color, 0.1)})`
                : rgba("#ffffff", 0.03),
              boxShadow: c.name === s.name ? `0 0 20px ${rgba(c.color, 0.35)}` : "none",
              color: HOME_THEME.text,
              opacity: c.name === s.name ? 1 : 0.72,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 3, background: c.color, flex: "none" }} />
            {c.name}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 8px 6px" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img" aria-label={`${s.name} spend by month`}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.85} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.3} />
            </linearGradient>
          </defs>

          {/* value grid */}
          {ticks.map((t, i) => {
            const y = py(t);
            return (
              <g key={i}>
                <line x1={PADL} x2={W - PADR} y1={y} y2={y} stroke={rgba("#ffffff", 0.07)} strokeDasharray="4 5" />
                <text x={PADL - 10} y={y + 3.5} textAnchor="end" fontSize={10} fill={HOME_THEME.muted} opacity={0.62}>
                  {fmtMoney(t, currency).replace(/\.\d+$/, "")}
                </text>
              </g>
            );
          })}

          {hover != null && hoverKnown && (
            <rect
              x={px(hover) - slotW / 2} y={PADT} width={slotW} height={plotH}
              fill={rgba(s.color, 0.07)} pointerEvents="none"
            />
          )}

          {/* one bar per month */}
          {bars.map((b) => {
            if (!b.known) {
              // No statement for this month. A hollow, dashed slot sitting on
              // the baseline — visibly "not measured", never mistaken for a
              // month that cost nothing.
              return (
                <rect
                  key={b.m}
                  x={b.x} y={PADT + plotH - 9} width={barW} height={9}
                  fill="none" stroke={rgba("#ffffff", 0.16)} strokeDasharray="3 3" rx={2}
                />
              );
            }
            const on = hover === b.i;
            return (
              <rect
                key={b.m}
                x={b.x} y={b.y} width={barW} height={b.h} rx={3}
                fill={on ? s.color : `url(#${gid})`}
                stroke={rgba(s.color, on ? 0.95 : 0.7)}
                strokeWidth={1}
              />
            );
          })}
          {/* Reference lines sit ON TOP of the bars — the whole point of
              them is reading which bars cross, and a bar drawn over the line
              hides exactly the crossing you are looking for. */}
          {/* budget line — the target this category was given */}
          {s.budget > 0 && s.budget <= top && (
            <>
              <line x1={PADL} x2={W - PADR} y1={py(s.budget)} y2={py(s.budget)} stroke={rgba(WARN, 0.55)} strokeDasharray="7 5" />
              <text x={W - PADR} y={py(s.budget) - 5} textAnchor="end" fontSize={9} fontWeight={800} fill={WARN} opacity={0.85}>
                BUDGET {fmtMoney(s.budget, currency).replace(/\.\d+$/, "")}
              </text>
            </>
          )}

          {/* the category's own average */}
          {s.avg > 0 && (
            <>
              <line x1={PADL} x2={W - PADR} y1={py(s.avg)} y2={py(s.avg)} stroke={rgba("#ffffff", 0.34)} strokeDasharray="2 4" />
              <text x={PADL + 4} y={py(s.avg) - 5} fontSize={9} fontWeight={800} fill={HOME_THEME.muted}>
                AVG {fmtMoney(s.avg, currency).replace(/\.\d+$/, "")}
              </text>
            </>
          )}

          {axis.map((_, i) => (
            <rect
              key={i}
              x={px(i) - plotW / (2 * Math.max(n - 1, 1))} y={PADT}
              width={plotW / Math.max(n - 1, 1)} height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}

          {/* month axis */}
          <g fontSize={10} textAnchor="middle" fill={HOME_THEME.muted}>
            {axis.map((m, i) => (
              <text key={m} x={px(i)} y={H - 9} opacity={hover === i ? 1 : 0.62} fontWeight={hover === i ? 800 : 600}>
                {axisMonth(m)}
              </text>
            ))}
          </g>
        </svg>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "4px 16px 14px", fontSize: TYPE.label }}>
        <span style={MUTED}>Average <b style={{ color: HOME_THEME.text }}>{fmtMoney(s.avg, currency)}</b> / mo</span>
        <span style={MUTED}>Highest <b style={{ color: HOME_THEME.text }}>{fmtMoney(Math.max(...s.values), currency)}</b></span>
        <span style={MUTED}>Total <b style={{ color: HOME_THEME.text }}>{fmtMoney(s.total, currency)}</b> over {s.months} imported mo</span>
        {s.budget > 0 && (
          <span style={MUTED}>
            Budget <b style={{ color: s.avg > s.budget ? MONEY_OUT : MONEY_IN }}>{fmtMoney(s.budget, currency)}</b> / mo
          </span>
        )}
      </div>
    </Card>
  );
}

// ── derivation ──────────────────────────────────────────────────────────────

/**
 * One category's spend, month over month, plus the per-category rollup the
 * grid renders. Pure — the same inputs always give the same table, which is
 * what lets the two tabs share it without sharing state.
 */
export function buildCategoryTrend(
  trend: TrendPoint[],
  categories: Category[],
  month: string,
  importedMonths: Set<string>,
) {
  // The axis is built from the CALENDAR, not from the months that happen to
  // have rows. A month with no statement imported has to read as a gap in the
  // line, not get quietly closed up so the curve looks continuous.
  const ry = Number(month.slice(0, 4));
  const rm = Number(month.slice(5, 7));
  const all: string[] = [];
  if (Number.isFinite(ry) && Number.isFinite(rm)) {
    for (let k = 11; k >= 0; k--) {
      const d = new Date(Date.UTC(ry, rm - 1 - k, 1));
      all.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
    }
  }

  const byId = new Map(categories.map((c) => [c.id, c]));
  const nameOf = (id: number | null) => (id == null ? UNCATEGORIZED : byId.get(id)?.name || UNCATEGORIZED);
  const byName = new Map<string, Map<string, number>>();
  for (const p of trend) {
    const n = nameOf(p.categoryId);
    const slot = byName.get(n) ?? new Map<string, number>();
    slot.set(p.month, (slot.get(p.month) ?? 0) + p.spent);
    byName.set(n, slot);
  }

  // Trim the empty run on the left. Two months of imported statements
  // stretched across a full year of empty slots is unreadable.
  const anyIn = (m2: string) => [...byName.values()].some((v) => (v.get(m2) ?? 0) > 0);
  const first = all.findIndex(anyIn);
  const axis = first < 0 ? all.slice(-1) : all.slice(first);

  const slotOf = new Map<string, number>();
  [...categories].sort((a, b) => a.id - b.id).forEach((c, i) => slotOf.set(c.name, i % DONUT_RAMP.length));

  // The divisor for every average here: months with a statement behind them.
  // NOT months where this category happened to see spend — that would be the
  // average size of a Travel trip, when what a budget asks is the average
  // Travel cost PER MONTH, quiet months included. And not the whole axis
  // either, since an unimported month is unknown, not zero.
  const importedN = axis.filter((m) => importedMonths.has(m)).length || 1;

  const series: TrendSeries[] = [...byName.entries()]
    .map(([name, slot]) => {
      const values = axis.map((mm) => slot.get(mm) ?? 0);
      const total = values.reduce((s, v) => s + v, 0);
      const cat = categories.find((c) => c.name === name);
      return {
        name,
        values,
        total,
        avg: total / importedN,
        months: importedN,
        budget: cat?.amount ?? 0,
        color: readable(cat?.color || (name === UNCATEGORIZED ? DONUT_NEUTRAL : DONUT_RAMP[slotOf.get(name) ?? 0])),
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total);

  return { months: axis, series };
}

/**
 * Every category with a budget gets a row whether or not it saw spend — a
 * category you budgeted for and did not touch is a result, and dropping the
 * row hides it.
 */
export function buildBudgetGrid(
  catTrend: { months: string[]; series: TrendSeries[] },
  categories: Category[],
) {
  const axis = catTrend.months;
  const bySeries = new Map(catTrend.series.map((s) => [s.name, s]));
  const names = new Set<string>([...categories.map((c) => c.name), ...bySeries.keys()]);

  const slotOf = new Map<string, number>();
  [...categories].sort((a, b) => a.id - b.id).forEach((c, i) => slotOf.set(c.name, i % DONUT_RAMP.length));

  const rows: BudgetRow[] = [...names].map((name) => {
    const s = bySeries.get(name);
    const cat = categories.find((c) => c.name === name);
    const values = s?.values ?? axis.map(() => 0);
    // The same per-imported-month average the trend chart draws, so the two
    // views can never disagree about what a category costs.
    const avg = s?.avg ?? 0;
    const budget = cat?.amount ?? 0;
    const ratio = budget > 0 ? avg / budget : null;
    // Judged on the AVERAGE, never on the latest month. One expensive week is
    // not a broken budget, and a row that flips red every time a quarterly
    // bill lands teaches you to stop reading the colour.
    const status: BudgetStatus =
      ratio == null ? "none"
        : ratio <= 0.6 ? "crushed"
          : ratio <= 1 ? "ontrack"
            : ratio <= 1.15 ? "watch"
              : "over";
    return {
      name,
      id: cat?.id ?? null,
      color: readable(cat?.color || s?.color || (name === UNCATEGORIZED ? DONUT_NEUTRAL : DONUT_RAMP[slotOf.get(name) ?? 0])),
      period: cat?.period ?? "monthly",
      values, avg, budget, ratio, status,
      total: values.reduce((a, b) => a + b, 0),
    };
  });

  // Budgeted rows first, biggest budget down; unbudgeted noise last.
  rows.sort((a, b) => (b.budget - a.budget) || (b.total - a.total) || a.name.localeCompare(b.name));

  const counted = rows.filter((r) => r.status !== "none");
  return {
    axis,
    rows,
    good: counted.filter((r) => r.status === "ontrack" || r.status === "crushed").length,
    watch: counted.filter((r) => r.status === "watch").length,
    over: counted.filter((r) => r.status === "over").length,
  };
}

// ── the section both tabs render ────────────────────────────────────────────

/**
 * Budget vs actual + category trend, as one block.
 *
 * `trend`/`months` are optional. RealMonth already holds the /api/budget/real
 * response and passes them in; the page-level Categories tab passes nothing
 * and this fetches once per month. Two callers, one fetch each, never both.
 */
export function CategoryBudgetSection({
  month,
  categories,
  currency,
  trend: providedTrend,
  months: providedMonths,
  onCategoriesChanged,
  onOpenCategories,
}: {
  month: string;
  categories: Category[];
  currency: string;
  trend?: TrendPoint[] | null;
  months?: MonthStat[] | null;
  onCategoriesChanged?: () => void | Promise<void>;
  onOpenCategories?: () => void;
}) {
  const [ownTrend, setOwnTrend] = useState<TrendPoint[]>([]);
  const [ownMonths, setOwnMonths] = useState<MonthStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [trendCat, setTrendCat] = useState<string | null>(null);

  const selfLoad = providedTrend == null;

  useEffect(() => {
    if (!selfLoad) return;
    let dead = false;
    setLoading(true);
    fetch(`/api/budget/real?month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (dead || !data) return;
        setOwnTrend(
          (data.trend || []).map((p: TrendPoint) => ({
            month: String(p.month),
            categoryId: p.categoryId == null ? null : Number(p.categoryId),
            spent: Number(p.spent) || 0,
            count: Number(p.count) || 0,
          }))
        );
        setOwnMonths((data.months || []).map((x: MonthStat) => ({ month: x.month, n: Number(x.n) })));
      })
      .catch(() => { /* the section just stays empty — it is never the only thing on a tab */ })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [selfLoad, month]);

  const trend = providedTrend ?? ownTrend;
  const months = providedMonths ?? ownMonths;

  const importedMonths = useMemo(() => new Set(months.map((m) => m.month)), [months]);
  const catTrend = useMemo(
    () => buildCategoryTrend(trend, categories, month, importedMonths),
    [trend, categories, month, importedMonths]
  );
  const grid = useMemo(() => buildBudgetGrid(catTrend, categories), [catTrend, categories]);
  const active = useMemo(
    () => catTrend.series.find((s) => s.name === trendCat) ?? catTrend.series[0] ?? null,
    [catTrend, trendCat]
  );

  /** Persist one category's budget. Upserts on name, so the row keeps its id,
      colour and period — the same write the category editor makes. */
  const save = useCallback(async (row: { name: string; budget: number; color: string; period: string }, amount: number) => {
    const res = await fetch("/api/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "category", name: row.name, amount, period: row.period, color: row.color }),
    });
    if (!res.ok) throw new Error("save failed");
    // The budget lives on the category, not on anything this component owns,
    // so the refresh that matters is the parent re-reading `categories`. The
    // statement history is untouched by a budget edit — no refetch here.
    await onCategoriesChanged?.();
  }, [onCategoriesChanged]);

  if (loading && !trend.length) {
    return (
      <Card variant="classic" padding="18px 16px">
        <div style={{ ...MUTED, fontSize: TYPE.body }}>Loading category history…</div>
      </Card>
    );
  }
  if (!grid.rows.length) return null;

  return (
    <>
      <BudgetGrid
        grid={grid}
        imported={importedMonths}
        currency={currency}
        onSave={save}
        onOpenCategories={onOpenCategories}
      />
      {catTrend.series.length > 0 && (
        <CategoryTrend
          axis={catTrend.months}
          imported={importedMonths}
          series={catTrend.series}
          active={active}
          onPick={setTrendCat}
          currency={currency}
        />
      )}
    </>
  );
}
