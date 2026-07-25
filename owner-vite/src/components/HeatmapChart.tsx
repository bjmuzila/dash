/**
 * Local heatmap primitives.
 *
 * ControlPanel's "visits by hour × weekday" heatmap was written against
 * `@bklitui/ui/charts`, a package that is not published on npm — the import
 * could never resolve, so `vite build` failed and the owners image would not
 * build. This module is a drop-in replacement with the same component names and
 * the same props ControlPanel passes, implemented with plain divs. No
 * dependencies.
 *
 * Data shape (unchanged): one entry per column, each holding its bins.
 *   [{ bin: 0, bins: [{ bin: 0, count: 0-4, date: Date }, ...] }, ...]
 * `count` is already quantised to a level 0-4 by the caller.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type HeatmapBin = { bin: number; count: number; date?: Date };
export type HeatmapColumn = { bin: number; bins: HeatmapBin[] };

export type HeatmapLevelColors = {
  empty?: string;
  l1?: string;
  l2?: string;
  l3?: string;
  l4?: string;
};

const DEFAULT_LEVELS: Required<HeatmapLevelColors> = {
  empty: "rgba(255,255,255,0.06)",
  l1: "rgba(33,158,188,0.28)",
  l2: "rgba(33,158,188,0.52)",
  l3: "rgba(33,158,188,0.78)",
  l4: "#219EBC",
};

/* ── interaction context ──────────────────────────────────────────────────── */

type Hovered = { col: number; row: number; count: number; date?: Date } | null;

type Ctx = {
  hovered: Hovered;
  setHovered: (h: Hovered) => void;
  levels: Required<HeatmapLevelColors>;
  setLevels: (l: Required<HeatmapLevelColors>) => void;
};

const HeatmapCtx = createContext<Ctx | null>(null);

/** Shares hover state between the chart, its tooltip and the legend. */
export function HeatmapInteractionProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<Hovered>(null);
  const [levels, setLevels] = useState<Required<HeatmapLevelColors>>(DEFAULT_LEVELS);
  const value = useMemo(() => ({ hovered, setHovered, levels, setLevels }), [hovered, levels]);
  return <HeatmapCtx.Provider value={value}>{children}</HeatmapCtx.Provider>;
}

/** Positioning context for the tooltip; also clears hover on mouse-out. */
export function HeatmapInteractionBoundary({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ctx = useContext(HeatmapCtx);
  return (
    <div
      className={className}
      style={{ position: "relative", ...style }}
      onMouseLeave={() => ctx?.setHovered(null)}
    >
      {children}
    </div>
  );
}

/* ── configuration children ───────────────────────────────────────────────── */

export type HeatmapCellsProps = {
  /** Opacity applied to non-hovered cells while another cell is hovered. */
  inactiveOpacity?: number;
  /** Scale applied to non-hovered cells while another cell is hovered. */
  inactiveScale?: number;
  radius?: number;
  gap?: number;
};

/** Marker component — HeatmapChart reads these props and does the drawing. */
export function HeatmapCells(_props: HeatmapCellsProps) {
  return null;
}

export type HeatmapTooltipProps = {
  /** Skip the open delay. */
  instant?: boolean;
  formatLabel?: (count: number, bin: HeatmapBin) => ReactNode;
  className?: string;
};

export function HeatmapTooltip(_props: HeatmapTooltipProps) {
  return null;
}

/* ── the chart ────────────────────────────────────────────────────────────── */

export type HeatmapChartProps = {
  data: HeatmapColumn[];
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  layout?: "fluid" | "fill";
  weekStartDay?: number;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  levelColors?: HeatmapLevelColors;
  gap?: number;
};

export function HeatmapChart({
  data,
  children,
  className,
  style,
  margin,
  levelColors,
  gap = 3,
}: HeatmapChartProps) {
  const ctx = useContext(HeatmapCtx);
  const levels = resolveLevels(levelColors);

  // Pull config off the marker children rather than requiring extra props.
  const opts = readChildProps(children);
  const cells = opts.cells ?? {};
  const tooltip = opts.tooltip;

  const rows = data[0]?.bins.length ?? 0;
  const cols = data.length;
  const hovered = ctx?.hovered ?? null;

  const inactiveOpacity = cells.inactiveOpacity ?? 1;
  const inactiveScale = cells.inactiveScale ?? 1;

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: "100%",
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap,
        marginTop: margin?.top,
        marginRight: margin?.right,
        marginBottom: margin?.bottom,
        marginLeft: margin?.left,
        ...style,
      }}
    >
      {data.map((column, c) =>
        column.bins.map((bin, r) => {
          const level = Math.max(0, Math.min(4, Math.round(bin.count))) as 0 | 1 | 2 | 3 | 4;
          const fill = [levels.empty, levels.l1, levels.l2, levels.l3, levels.l4][level];
          const isHovered = hovered != null && hovered.col === c && hovered.row === r;
          const dimmed = hovered != null && !isHovered;
          return (
            <div
              key={`${c}-${r}`}
              onMouseEnter={() =>
                ctx?.setHovered({ col: c, row: r, count: bin.count, date: bin.date })
              }
              style={{
                gridColumn: c + 1,
                gridRow: r + 1,
                aspectRatio: "1 / 1",
                minHeight: 6,
                borderRadius: cells.radius ?? 3,
                background: fill,
                opacity: dimmed ? inactiveOpacity : 1,
                transform: dimmed ? `scale(${inactiveScale})` : "scale(1)",
                outline: isHovered ? "1px solid rgba(255,255,255,0.55)" : "none",
                outlineOffset: -1,
                transition: "opacity 0.12s ease, transform 0.12s ease",
                cursor: "default",
              }}
            />
          );
        }),
      )}

      {tooltip && hovered && (
        <div
          style={{
            position: "absolute",
            left: `${((hovered.col + 0.5) / cols) * 100}%`,
            top: `${(hovered.row / rows) * 100}%`,
            transform: "translate(-50%, -120%)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            background: "#0D1119",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 8,
            padding: "5px 9px",
            fontSize: 11,
            color: "#fff",
            boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
            zIndex: 20,
          }}
        >
          {tooltip.formatLabel
            ? tooltip.formatLabel(hovered.count, {
                bin: hovered.row,
                count: hovered.count,
                date: hovered.date,
              })
            : `level ${hovered.count}`}
        </div>
      )}
    </div>
  );
}

/* ── legend ───────────────────────────────────────────────────────────────── */

export function HeatmapLegend({
  align = "start",
  lessLabel = "Less",
  moreLabel = "More",
  levelColors,
  className,
}: {
  align?: "start" | "center" | "end";
  lessLabel?: string;
  moreLabel?: string;
  levelColors?: HeatmapLevelColors;
  className?: string;
}) {
  const levels = resolveLevels(levelColors);
  const swatches = [levels.empty, levels.l1, levels.l2, levels.l3, levels.l4];
  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        justifyContent: align === "end" ? "flex-end" : align === "center" ? "center" : "flex-start",
        fontSize: 11,
        color: "rgba(255,255,255,0.55)",
      }}
    >
      <span>{lessLabel}</span>
      {swatches.map((s, i) => (
        <span key={i} style={{ width: 11, height: 11, borderRadius: 3, background: s }} />
      ))}
      <span>{moreLabel}</span>
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * Callers build level colours by string concatenation (`${theme.cyan}33` for an
 * alpha suffix), which silently produces garbage when the base is already an
 * rgba() string rather than a hex — and an unparseable colour renders as
 * transparent, i.e. an invisible cell. Validate and fall back so a bad value
 * degrades to the default instead of a hole in the grid.
 */
function isColor(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return true;
  return CSS.supports("color", v);
}

function resolveLevels(input?: HeatmapLevelColors): Required<HeatmapLevelColors> {
  const merged = { ...DEFAULT_LEVELS, ...(input ?? {}) };
  return {
    empty: isColor(merged.empty) ? merged.empty : DEFAULT_LEVELS.empty,
    l1: isColor(merged.l1) ? merged.l1 : DEFAULT_LEVELS.l1,
    l2: isColor(merged.l2) ? merged.l2 : DEFAULT_LEVELS.l2,
    l3: isColor(merged.l3) ? merged.l3 : DEFAULT_LEVELS.l3,
    l4: isColor(merged.l4) ? merged.l4 : DEFAULT_LEVELS.l4,
  };
}

type ChildOpts = { cells?: HeatmapCellsProps; tooltip?: HeatmapTooltipProps };

/**
 * HeatmapCells / HeatmapTooltip render nothing — they exist so the call site
 * reads declaratively. Walk the children and lift their props onto the chart.
 */
function readChildProps(children: ReactNode): ChildOpts {
  const out: ChildOpts = {};
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const el = node as { type?: unknown; props?: Record<string, unknown> } | null;
    if (!el || typeof el !== "object" || !el.type) return;
    if (el.type === HeatmapCells) out.cells = el.props as HeatmapCellsProps;
    else if (el.type === HeatmapTooltip) out.tooltip = el.props as HeatmapTooltipProps;
  };
  visit(children);
  return out;
}
