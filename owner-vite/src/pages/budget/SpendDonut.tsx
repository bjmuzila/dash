import { useMemo, useState } from "react";
import { HOME_THEME, TYPE, rgba } from "../../lib/theme";

/**
 * Spend donut — dependency-free SVG, replaces the Sankey in Real Month → Flow.
 *
 * Bklit's pie/donut components are not vendored into this repo
 * (`src/components/charts/index.ts` is still the empty auto-generated barrel;
 * it fills in only after `npm run charts:add`), and they carry Tailwind class
 * names expecting the `.charts-ui-root` token scope that the inline-styled
 * Budget page never sets up. So this draws its own arcs.
 *
 * Presentational only — RealMonth ranks the categories, folds the tail, and
 * assigns the colours. See DONUT_RAMP there for why the hues are what they are.
 *
 * Interaction: hover/focus a segment to isolate it and swap the centre readout;
 * click a segment or a row to expand that category's merchants. A Table toggle
 * exists because a donut cannot resolve close values — two categories a few
 * tenths of a percent apart are indistinguishable by arc, and the table gives
 * the real numbers.
 */

export type DonutChild = { name: string; total: number; count: number; recurring: boolean };
export type DonutSlice = {
  key: string;
  name: string;
  color: string;
  total: number;
  count: number;
  /** "other" is the folded tail — its children are categories, not merchants. */
  kind: "cat" | "other";
  children: DonutChild[];
};

const CX = 320, CY = 190, R_OUT = 132, R_IN = 90, GAP_DEG = 1.1;
const VIEW_W = 640, VIEW_H = 372;
/** A segment gets a leader label only when it is big enough to carry one. */
const LABEL_MIN_SHARE = 8;

const rad = (d: number) => ((d - 90) * Math.PI) / 180;
const pt = (r: number, d: number): [number, number] => [CX + r * Math.cos(rad(d)), CY + r * Math.sin(rad(d))];

function arcPath(a0: number, a1: number): string {
  // A 2px-equivalent surface gap between fills rather than a stroke outline.
  const s = a0 + GAP_DEG;
  const e = Math.max(a0 + GAP_DEG + 0.4, a1 - GAP_DEG);
  const large = e - s > 180 ? 1 : 0;
  const [x1, y1] = pt(R_OUT, s), [x2, y2] = pt(R_OUT, e);
  const [x3, y3] = pt(R_IN, e), [x4, y4] = pt(R_IN, s);
  return `M${x1} ${y1}A${R_OUT} ${R_OUT} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}A${R_IN} ${R_IN} 0 ${large} 0 ${x4} ${y4}Z`;
}

const MUTED: React.CSSProperties = { color: HOME_THEME.muted, opacity: 0.62 };

export function SpendDonut({
  slices,
  total,
  currency,
  periodLabel,
  categoryCount,
  chargeCount,
}: {
  slices: DonutSlice[];
  total: number;
  currency: string;
  periodLabel: string;
  categoryCount: number;
  chargeCount: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tableView, setTableView] = useState(false);

  const money = (n: number, max = 2) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: max }).format(n || 0);

  const laid = useMemo(() => {
    let angle = 0;
    return slices.map((s) => {
      const sweep = total > 0 ? (s.total / total) * 360 : 0;
      const o = { ...s, a0: angle, a1: angle + sweep, mid: angle + sweep / 2, share: total > 0 ? (s.total / total) * 100 : 0 };
      angle += sweep;
      return o;
    });
  }, [slices, total]);

  const toggle = (k: string) =>
    setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const active = hover != null ? laid[hover] : null;

  if (!slices.length || total <= 0) {
    return <div style={{ padding: 20, ...MUTED, fontSize: TYPE.body }}>No outgoing money in this month yet.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 16px 10px", flexWrap: "wrap" }}>
        <button onClick={() => setTableView(false)} style={togglePill(!tableView)}>Donut</button>
        <button onClick={() => setTableView(true)} style={togglePill(tableView)}>Table</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setOpen(open.size ? new Set() : new Set(slices.map((s) => s.key)))}
          style={togglePill(false)}
        >
          {open.size ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {!tableView && (
        <>
          <div style={{ display: "flex", justifyContent: "center", padding: "0 16px 14px" }}>
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" style={{ display: "block", overflow: "visible", maxWidth: 760, height: "auto" }} role="img" aria-label={`Spending by category, ${periodLabel}`}>
              {laid.map((s, i) => (
                <path
                  key={s.key}
                  d={arcPath(s.a0, s.a1)}
                  fill={s.color}
                  tabIndex={0}
                  role="button"
                  aria-label={`${s.name}, ${money(s.total)}, ${s.share.toFixed(1)} percent`}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  onClick={() => toggle(s.key)}
                  style={{
                    cursor: "pointer",
                    opacity: hover != null && hover !== i ? 0.26 : 1,
                    transition: "opacity .16s ease",
                    outline: "none",
                  }}
                />
              ))}

              {/* Selective direct labels — only the segments with room. */}
              {laid.filter((s) => s.share >= LABEL_MIN_SHARE).map((s) => {
                const [lx, ly] = pt(R_OUT + 2, s.mid);
                const [ex, ey] = pt(R_OUT + 22, s.mid);
                const right = ex >= CX;
                const tx = ex + (right ? 20 : -20);
                return (
                  <g key={`l-${s.key}`} style={{ pointerEvents: "none", opacity: hover != null && laid[hover].key !== s.key ? 0.3 : 1, transition: "opacity .16s ease" }}>
                    <path d={`M${lx} ${ly}L${ex} ${ey}h${right ? 12 : -12}`} stroke={rgba("#ffffff", 0.4)} strokeWidth={1} fill="none" />
                    <text x={tx} y={ey - 2} textAnchor={right ? "start" : "end"} fill={HOME_THEME.text} fontSize={11} fontWeight={700}>{s.name}</text>
                    <text x={tx} y={ey + 12} textAnchor={right ? "start" : "end"} fill={HOME_THEME.muted} opacity={0.62} fontSize={11}>
                      {money(s.total, 0)} · {s.share.toFixed(0)}%
                    </text>
                  </g>
                );
              })}

              <text x={CX} y={CY - 22} textAnchor="middle" fill={HOME_THEME.muted} opacity={0.62} fontSize={11} fontWeight={800} letterSpacing="0.16em" style={{ textTransform: "uppercase" }}>
                {active ? active.name.toUpperCase() : "TOTAL SPEND"}
              </text>
              <text x={CX} y={CY + 14} textAnchor="middle" fill={active ? active.color : HOME_THEME.text} fontSize={32} fontWeight={900} style={{ fontVariantNumeric: "tabular-nums" }}>
                {money(active ? active.total : total)}
              </text>
              <text x={CX} y={CY + 36} textAnchor="middle" fill={HOME_THEME.muted} opacity={0.62} fontSize={12} fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                {active
                  ? `${active.share.toFixed(1)}% · ${active.count} charge${active.count === 1 ? "" : "s"}`
                  : `${periodLabel} · ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}`}
              </text>
            </svg>
          </div>

          {/* The rows are the legend — identity is never colour-alone. */}
          <div style={{ borderTop: `1px solid ${HOME_THEME.border}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "13px 16px 4px" }}>
              <span style={{ fontSize: TYPE.body, fontWeight: 800 }}>Categories</span>
              <span style={{ fontSize: TYPE.label, ...MUTED }}>{categoryCount} categories · {chargeCount} charges</span>
            </div>
            {laid.map((s, i) => {
              const isOpen = open.has(s.key);
              const hot = hover === i;
              return (
                <div key={s.key}>
                  <div
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => toggle(s.key)}
                    style={{
                      display: "grid", gridTemplateColumns: "16px 1fr auto auto 22px", gap: 12, alignItems: "center",
                      padding: "11px 16px", cursor: "pointer",
                      borderTop: `1px solid ${rgba("#ffffff", 0.05)}`,
                      background: hot ? rgba("#ffffff", 0.045) : undefined,
                      transition: "background .15s ease",
                    }}
                  >
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color }} />
                    <span>
                      <span style={{ fontSize: TYPE.body, fontWeight: 700 }}>
                        {s.name}
                        {s.kind === "other" && <span style={{ fontSize: 11, ...MUTED, marginLeft: 6 }}>({s.children.length} categories)</span>}
                      </span>
                      <div style={{ fontSize: 11, ...MUTED, marginTop: 3 }}>
                        {s.count} charge{s.count === 1 ? "" : "s"} · {s.children.length}{" "}
                        {s.kind === "other"
                          ? s.children.length === 1 ? "category" : "categories"
                          : s.children.length === 1 ? "merchant" : "merchants"}
                      </div>
                      <div style={{ height: 3, borderRadius: 99, background: rgba("#ffffff", 0.07), marginTop: 6, maxWidth: 520 }}>
                        <div style={{ width: `${s.share}%`, height: 3, borderRadius: 99, background: s.color }} />
                      </div>
                    </span>
                    <span style={{ fontSize: TYPE.label, ...MUTED, fontVariantNumeric: "tabular-nums", minWidth: 46, textAlign: "right" }}>{s.share.toFixed(1)}%</span>
                    <span style={{ fontSize: TYPE.subhead, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 96, textAlign: "right" }}>{money(s.total)}</span>
                    <span style={{ ...MUTED, fontSize: TYPE.label, textAlign: "center", display: "inline-block", transform: isOpen ? "rotate(90deg)" : undefined, transition: "transform .16s ease" }}>▸</span>
                  </div>

                  {isOpen && (
                    <div style={{ background: rgba("#000000", 0.3), borderTop: `1px solid ${rgba("#ffffff", 0.05)}` }}>
                      {s.children.map((c) => (
                        <div key={c.name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "8px 16px 8px 44px", fontSize: 13, borderBottom: `1px solid ${rgba("#ffffff", 0.04)}` }}>
                          <span style={{ color: HOME_THEME.text, opacity: 0.86 }}>
                            {c.name}{c.recurring && <span style={{ color: HOME_THEME.gold, marginLeft: 6, fontSize: 11 }}>🔁</span>}
                          </span>
                          <span style={{ fontSize: 11, ...MUTED }}>{c.count}×</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 88, textAlign: "right" }}>{money(c.total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tableView && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={tableTh("left")}>Category</th>
              <th style={tableTh("left")}>Merchant</th>
              <th style={tableTh("right")}>Charges</th>
              <th style={tableTh("right")}>Amount</th>
              <th style={tableTh("right")}>Share</th>
            </tr>
          </thead>
          <tbody>
            {laid.flatMap((s) =>
              s.children.map((c, j) => (
                <tr key={`${s.key}-${c.name}`}>
                  <td style={tableTd("left")}>
                    {j === 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color }} />
                        {s.name}
                      </span>
                    )}
                  </td>
                  <td style={tableTd("left")}>{c.name}{c.recurring && <span style={{ color: HOME_THEME.gold, marginLeft: 6, fontSize: 11 }}>🔁</span>}</td>
                  <td style={tableTd("right")}>{c.count}</td>
                  <td style={{ ...tableTd("right"), fontWeight: 700 }}>{money(c.total)}</td>
                  <td style={{ ...tableTd("right"), ...MUTED }}>{total > 0 ? ((c.total / total) * 100).toFixed(1) : "0.0"}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function togglePill(active: boolean): React.CSSProperties {
  return {
    padding: "6px 13px", borderRadius: 999, fontSize: TYPE.label, fontWeight: 800, cursor: "pointer",
    border: `1px solid ${active ? rgba(HOME_THEME.cyan, 0.75) : HOME_THEME.border}`,
    background: active ? `linear-gradient(180deg, ${rgba(HOME_THEME.cyan, 0.3)}, ${rgba(HOME_THEME.cyan, 0.1)})` : rgba("#ffffff", 0.03),
    boxShadow: active ? `0 0 22px ${rgba(HOME_THEME.cyan, 0.45)}, inset 0 1px 0 ${rgba("#ffffff", 0.1)}` : "none",
    color: active ? HOME_THEME.cyan : HOME_THEME.text,
    opacity: active ? 1 : 0.82,
  };
}
function tableTh(align: "left" | "right"): React.CSSProperties {
  return {
    textAlign: align, padding: "10px 16px", fontSize: TYPE.label, fontWeight: 800, letterSpacing: "0.12em",
    textTransform: "uppercase", color: HOME_THEME.muted, opacity: 0.65, borderBottom: `1px solid ${HOME_THEME.border}`,
  };
}
function tableTd(align: "left" | "right"): React.CSSProperties {
  return { textAlign: align, padding: "8px 16px", fontSize: TYPE.body, borderBottom: `1px solid ${rgba("#ffffff", 0.05)}`, fontVariantNumeric: align === "right" ? "tabular-nums" : undefined };
}
