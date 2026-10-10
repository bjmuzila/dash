"use client";

/**
 * useTableSort — click-a-column-title sorting for the app's hand-rolled tables.
 *
 * The dashboards render plain <table> markup with inline styles (no data-grid
 * library), so every table that wanted sorting used to grow its own useState +
 * comparator + arrow glyph. This is that logic once:
 *
 *   const sort = useTableSort<"n" | "lift">();
 *   ...
 *   <SortTh sort={sort} sortKey="lift" style={th}>Lift</SortTh>
 *   ...
 *   {sort.apply(rows, (r, k) => (k === "n" ? r.n : r.lift)).map(...)}
 *
 * Behaviour, deliberately: the first click on a column sorts DESC (the useful
 * direction for the rate/lift/count columns these tables are made of), the
 * second flips to ASC, the third clears the sort and puts the rows back in the
 * order the server sent them — which is itself meaningful on most of these
 * tables, so it has to be reachable without a reload.
 *
 * Nulls always sink to the bottom regardless of direction: a missing number is
 * not a small one, and letting "—" win the top of a descending sort is the
 * fastest way to misread a table.
 */

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { HOME_THEME } from "./homeTheme";

export type SortDir = "asc" | "desc";

/** What a column can sort on. Booleans rank true above false. */
export type SortValue = number | string | boolean | null | undefined;

export type TableSort<K extends string> = {
  key: K | null;
  dir: SortDir;
  /** Cycle a column: desc → asc → unsorted. */
  toggle: (k: K) => void;
  /** Back to the incoming order. */
  reset: () => void;
  /**
   * A sorted COPY of `rows` (never mutates the input), or `rows` unchanged when
   * no column is active. Stable: equal values keep their incoming order.
   */
  apply: <T>(rows: readonly T[], get: (row: T, key: K) => SortValue) => T[];
  /** "▲" / "▼" for the active column, "" otherwise. */
  arrow: (k: K) => string;
};

function cmp(a: SortValue, b: SortValue): number {
  // Nulls last, always — the direction flip must not float them to the top.
  const aNull = a == null || a === "" || (typeof a === "number" && !Number.isFinite(a));
  const bNull = b == null || b === "" || (typeof b === "number" && !Number.isFinite(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const av = typeof a === "boolean" ? (a ? 1 : 0) : a;
  const bv = typeof b === "boolean" ? (b ? 1 : 0) : b;

  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
}

export function useTableSort<K extends string>(
  initialKey: K | null = null,
  initialDir: SortDir = "desc",
): TableSort<K> {
  // One piece of state, not two: the cycle reads the current pair and writes the
  // next one, so a setState-inside-a-setState (which StrictMode may run twice)
  // never enters into it.
  const [state, setState] = useState<{ key: K | null; dir: SortDir }>({ key: initialKey, dir: initialDir });
  const { key, dir } = state;

  const toggle = useCallback((k: K) => {
    setState((cur) => {
      if (cur.key !== k) return { key: k, dir: "desc" };
      if (cur.dir === "desc") return { key: k, dir: "asc" };
      return { key: null, dir: "desc" };
    });
  }, []);

  const reset = useCallback(() => setState({ key: null, dir: "desc" }), []);

  const apply = useCallback(
    <T,>(rows: readonly T[], get: (row: T, key: K) => SortValue): T[] => {
      if (!key) return rows as T[];
      const sign = dir === "asc" ? 1 : -1;
      return rows
        .map((row, i) => ({ row, i }))
        .sort((x, y) => {
          const d = cmp(get(x.row, key), get(y.row, key));
          return d !== 0 ? d * sign : x.i - y.i;
        })
        .map((w) => w.row);
    },
    [key, dir],
  );

  const arrow = useCallback((k: K) => (key !== k ? "" : dir === "asc" ? "▲" : "▼"), [key, dir]);

  return useMemo(
    () => ({ key, dir, toggle, reset, apply, arrow }),
    [key, dir, toggle, reset, apply, arrow],
  );
}

/**
 * A sortable column title. Drop-in for a plain <th>: pass the same `style` the
 * table's other headers use and it keeps the look, adding a pointer cursor, a
 * hover tint and the direction caret.
 */
export function SortTh<K extends string>({
  sort,
  sortKey,
  style,
  title,
  children,
  colSpan,
}: {
  sort: TableSort<K>;
  sortKey: K;
  style?: CSSProperties;
  title?: string;
  children?: ReactNode;
  colSpan?: number;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      colSpan={colSpan}
      onClick={() => sort.toggle(sortKey)}
      title={title ? `${title}\n\nClick to sort.` : "Click to sort"}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      style={{
        ...style,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
        color: active ? HOME_THEME.cyan : (style?.color as string | undefined),
      }}
    >
      {children}
      <span
        aria-hidden
        style={{
          marginLeft: 4,
          fontSize: 9,
          opacity: active ? 1 : 0.32,
          color: active ? HOME_THEME.cyan : "inherit",
        }}
      >
        {active ? sort.arrow(sortKey) : "↕"}
      </span>
    </th>
  );
}

export default useTableSort;
