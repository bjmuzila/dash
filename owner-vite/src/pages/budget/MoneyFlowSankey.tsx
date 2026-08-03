import { useMemo, useState } from "react";
import { HOME_THEME, TYPE, rgba } from "../../lib/theme";

/**
 * Money-flow Sankey — dependency-free SVG.
 *
 * The Bklit `SankeyChart` in the charts-ui catalog is not vendored into this
 * repo yet (`src/components/charts/index.ts` is still the empty auto-generated
 * barrel; it fills in only after `npm run charts:add`). Bklit's components also
 * carry Tailwind class names and expect the `.charts-ui-root` token scope, which
 * the inline-styled Budget page does not set up. So this draws its own ribbons
 * against the same chart palette documented in charts-ui/README.md.
 *
 * To swap in the real one later: run `node scripts/add-charts.mjs sankey-chart`,
 * then replace <MoneyFlowSankey> with <SankeyChart data={...}> — the node/link
 * shape below is already the {nodes, links} shape Bklit expects.
 *
 * Layout is a plain proportional stack per column, not a crossing-minimising
 * solver: columns are few and pre-sorted by value, so ribbons stay legible
 * without one.
 */

export type FlowNode = { id: string; label: string; value: number; color: string; col: number };
export type FlowLink = { source: string; target: string; value: number };

const NODE_W = 13;
const GAP = 9;
const PAD_TOP = 10;
const LABEL_W = 150;

export function MoneyFlowSankey({
  nodes,
  links,
  currency,
  height = 460,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  currency: string;
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n || 0);

  const layout = useMemo(() => {
    const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
    if (!cols.length) return null;

    // Scale: the tallest column decides pixels-per-dollar, so every column is
    // drawn against the same scale and ribbon widths stay comparable.
    const colTotals = cols.map((c) => nodes.filter((n) => n.col === c).reduce((s, n) => s + n.value, 0));
    const maxNodes = Math.max(...cols.map((c) => nodes.filter((n) => n.col === c).length));
    const usable = height - PAD_TOP * 2 - GAP * Math.max(0, maxNodes - 1);
    const scale = usable / Math.max(1, Math.max(...colTotals));

    const placed = new Map<string, { x: number; y: number; h: number; node: FlowNode }>();
    const colX = (c: number) => {
      const i = cols.indexOf(c);
      const span = cols.length > 1 ? (100 - 0) / (cols.length - 1) : 0;
      return cols.length > 1 ? i * span : 0; // percent, resolved by the caller's viewBox
    };

    for (const c of cols) {
      const inCol = nodes.filter((n) => n.col === c).sort((a, b) => b.value - a.value);
      let y = PAD_TOP;
      for (const n of inCol) {
        const h = Math.max(3, n.value * scale);
        placed.set(n.id, { x: colX(c), y, h, node: n });
        y += h + GAP;
      }
    }

    // Ribbons stack down each side of their endpoints in the same order the
    // links are given, so a node's outgoing band never crosses itself.
    const srcCursor = new Map<string, number>();
    const tgtCursor = new Map<string, number>();
    const ribbons = links
      .map((l) => {
        const a = placed.get(l.source);
        const b = placed.get(l.target);
        if (!a || !b) return null;
        const aTotal = links.filter((x) => x.source === l.source).reduce((s, x) => s + x.value, 0) || 1;
        const bTotal = links.filter((x) => x.target === l.target).reduce((s, x) => s + x.value, 0) || 1;
        const ah = (l.value / aTotal) * a.h;
        const bh = (l.value / bTotal) * b.h;
        const ay = a.y + (srcCursor.get(l.source) ?? 0);
        const by = b.y + (tgtCursor.get(l.target) ?? 0);
        srcCursor.set(l.source, (srcCursor.get(l.source) ?? 0) + ah);
        tgtCursor.set(l.target, (tgtCursor.get(l.target) ?? 0) + bh);
        return { link: l, ay, by, ah, bh, ax: a.x, bx: b.x, color: a.node.color };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return { placed, ribbons, cols };
  }, [nodes, links, height]);

  if (!layout || !nodes.length) {
    return <div style={{ padding: 20, color: HOME_THEME.muted, opacity: 0.6, fontSize: TYPE.body }}>Not enough data to draw a flow.</div>;
  }

  // The SVG uses a 0–1000 user-space width; columns sit at percentage stops and
  // labels are drawn in the gutter to the right of each node.
  const W = 1000;
  const xOf = (pct: number) => (pct / 100) * (W - NODE_W - LABEL_W) + 2;

  return (
    <div style={{ padding: "4px 14px 16px", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id="mf-fade" x1="0" x2="1">
            <stop offset="0%" stopOpacity="0.55" stopColor={HOME_THEME.cyan} />
            <stop offset="100%" stopOpacity="0.18" stopColor={HOME_THEME.cyan} />
          </linearGradient>
        </defs>

        {layout.ribbons.map((r, i) => {
          const x1 = xOf(r.ax) + NODE_W;
          const x2 = xOf(r.bx);
          const cx = (x1 + x2) / 2;
          const active = hover === null || hover === r.link.source || hover === r.link.target;
          const d = [
            `M ${x1} ${r.ay}`,
            `C ${cx} ${r.ay} ${cx} ${r.by} ${x2} ${r.by}`,
            `L ${x2} ${r.by + r.bh}`,
            `C ${cx} ${r.by + r.bh} ${cx} ${r.ay + r.ah} ${x1} ${r.ay + r.ah}`,
            "Z",
          ].join(" ");
          return (
            <path
              key={i}
              d={d}
              fill={r.color}
              opacity={active ? 0.3 : 0.07}
              style={{ transition: "opacity .15s ease" }}
            >
              <title>{`${r.link.source.split(":").pop()} → ${r.link.target.split(":").pop()} · ${fmt(r.link.value)}`}</title>
            </path>
          );
        })}

        {[...layout.placed.values()].map(({ x, y, h, node }) => {
          const px = xOf(x);
          const dim = hover !== null && hover !== node.id;
          return (
            <g
              key={node.id}
              onMouseEnter={() => setHover(node.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "default", opacity: dim ? 0.4 : 1, transition: "opacity .15s ease" }}
            >
              <rect x={px} y={y} width={NODE_W} height={h} rx={3} fill={node.color} opacity={0.9} />
              <text
                x={px + NODE_W + 8}
                y={y + h / 2}
                dominantBaseline="middle"
                fill={HOME_THEME.text}
                fontSize={h < 14 ? 10 : 12}
                fontWeight={700}
              >
                {node.label}
                <tspan fill={HOME_THEME.muted} opacity={0.6} fontWeight={500}> {fmt(node.value)}</tspan>
              </text>
              <title>{`${node.label} · ${fmt(node.value)}`}</title>
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 11, color: HOME_THEME.muted, opacity: 0.55, marginTop: 6, borderTop: `1px solid ${rgba("#ffffff", 0.06)}`, paddingTop: 8 }}>
        Hover a band to isolate it. Ribbon thickness is dollars; the smallest merchants are rolled into an “Other” band per category.
      </div>
    </div>
  );
}
