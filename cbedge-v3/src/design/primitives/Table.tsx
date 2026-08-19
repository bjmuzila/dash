import type { ReactNode } from 'react'

// A dense data table. Deliberately generic and deliberately unstyled beyond
// tokens — option chains, scanners and ladders all render through this, so
// none of them gets to invent its own row height.
//
// For anything over ~200 rows, virtualise. A table primitive should not try to
// solve that itself; wrap it.

export interface Column<Row> {
  key: string
  header: ReactNode
  /** Cell renderer. Keep it cheap — this runs per row, per render. */
  cell: (row: Row, index: number) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Any valid CSS width. Fixed widths stop columns jumping as values tick. */
  width?: string
  /** Numeric column — applies tabular figures. */
  numeric?: boolean
}

export interface TableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string | number
  /** Row-level emphasis, e.g. highlighting the ATM strike. */
  rowClassName?: (row: Row, index: number) => string | undefined
  stale?: boolean
  empty?: ReactNode
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

export function Table<Row>({
  columns,
  rows,
  rowKey,
  rowClassName,
  stale = false,
  empty = 'No data',
}: TableProps<Row>) {
  if (rows.length === 0) {
    return <div className="p-6 text-center text-sm text-faint">{empty}</div>
  }

  return (
    <div className={stale ? 'stale min-h-0 flex-1 overflow-auto' : 'min-h-0 flex-1 overflow-auto'}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={[
                  'border-b border-line px-2 py-1.5 text-xs font-normal text-muted',
                  ALIGN[c.align ?? (c.numeric ? 'right' : 'left')],
                ].join(' ')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className={rowClassName?.(row, i)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[
                    'border-b border-line/50 px-2 py-1',
                    ALIGN[c.align ?? (c.numeric ? 'right' : 'left')],
                    c.numeric ? 'tabular' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {c.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
