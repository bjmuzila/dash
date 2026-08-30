// Part F — the ladder. Bars run out from a centre rail: +GEX right, −GEX left.
//
// A LEVEL IS SAID ONCE, by a named tag beside its strike (CB / CW / PW). The row
// behind it is not tinted and the bars are not outlined — both fought the one
// thing the bars exist to say, which is magnitude and sign. A strike that is two
// levels at once could only ever wear one of the wash colours, which made the
// wash a worse copy of the tags beside it.
//
// Spot is the ONE exception and keeps its chrome: "where price is" must never be
// ambiguous.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FS, Label, fmtBig } from '../kit'
import type { TlLevels, TlRow } from './levels'
import { LEVEL_COLORS, V2, V2W } from '@/design/theme'

export function TlLadder({
  rows,
  spot,
  levels,
  changes = null,
  missing = null,
  anchor = null,
}: {
  rows: TlRow[]
  spot: number | null
  levels: TlLevels
  /**
   * strike → ΔGEX vs the previous end-of-day snapshot, already differenced by
   * the backend. Only the RIGHT pane passes it: the recorder snapshots the
   * BOARD, so hanging a board-level Δ off the left pane's single-expiry ladder
   * would print a change that does not belong to the number beside it.
   */
  changes?: Map<number, number> | null
  /** Replay only — strikes this sweep did not record. Drawn with no bar and an em dash. */
  missing?: Set<number> | null
  /** The strike the pane scrolls to, held steady by useTlAnchor. */
  anchor?: number | null
}) {
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.gex)), 0) || 1
  const spotRow =
    spot == null
      ? null
      : rows.reduce<TlRow | null>(
          (best, r) =>
            best == null || Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best,
          null,
        )
  const withChg = changes != null

  // The strike column is sized for the WIDEST it ever gets — a five-digit strike
  // and two level tags — because the row must stay ONE line. A narrower column
  // made the tags wrap and a single strike took two rows.
  const cols = withChg ? '132px 1fr 68px 66px' : '132px 1fr 68px'

  // ── Auto-centre ────────────────────────────────────────────────────────────
  // Park the anchor row in the MIDDLE of the pane, not at the top of it.
  // tlWindow already centres spot in the row DATA, but the pane is a
  // fixed-height scroller that opens at scrollTop 0 — so the card painted the
  // highest strikes and spot sat below the fold, which is the one row a ladder
  // exists to show.
  //
  // Measured with getBoundingClientRect rather than offsetTop: the scroll
  // wrapper is position:static, so offsetParent is some ancestor Card and
  // offsetTop would be measured against the wrong box.
  //
  // It centres on the ANCHOR, not on spot. Rewound, spot moves every frame and
  // re-centring on each move is exactly the jitter this pane used to show.
  const rootRef = useRef<HTMLDivElement>(null)
  const anchorRow =
    anchor == null
      ? null
      : rows.reduce<TlRow | null>(
          (best, r) =>
            best == null || Math.abs(r.strike - anchor) < Math.abs(best.strike - anchor) ? r : best,
          null,
        )
  const spotStrike = (anchorRow ?? spotRow)?.strike ?? null
  const firstRow = rows[0]
  const lastRow = rows[rows.length - 1]
  const windowKey = firstRow && lastRow ? `${firstRow.strike}:${lastRow.strike}` : ''

  useEffect(() => {
    const root = rootRef.current
    if (!root || spotStrike == null) return
    const scroller = root.parentElement
    if (!scroller) return
    const el = root.querySelector<HTMLElement>(`[data-tl-strike="${spotStrike}"]`)
    if (!el) return
    const slack = scroller.scrollHeight - scroller.clientHeight
    if (slack <= 0) return // the whole ladder already fits — nothing to centre
    const rootBox = root.getBoundingClientRect()
    const elBox = el.getBoundingClientRect()
    const offsetInRoot = elBox.top - rootBox.top // stable regardless of scroll
    const target = offsetInRoot - scroller.clientHeight / 2 + elBox.height / 2
    scroller.scrollTop = Math.max(0, Math.min(target, slack))
    // Re-centres when the ticker/expiry changes the window, or when spot walks
    // to a new anchor strike — NOT on every tick.
  }, [spotStrike, windowKey])

  // ── The spot line ──────────────────────────────────────────────────────────
  // One line straight across the ladder, sitting at the PRICE itself rather than
  // on the nearest rung: the lit row says which strike price is closest to, the
  // line says where inside that strike it actually is — the difference between
  // "769, roughly" and "769.9, leaning on 770".
  //
  // Position is DERIVED DURING RENDER, never state fed by an effect: an effect
  // would paint the line one commit behind the spot it is labelled with, and
  // during replay it would visibly trail.
  //
  // Row pitch IS measured off the DOM — rows carry padding and a border, so a
  // guessed px-per-row drifts — but from first→last / (n−1) so nothing compounds,
  // and only when the ladder changes size.
  const rowsColRef = useRef<HTMLDivElement | null>(null)
  const [rowGeom, setRowGeom] = useState<{ top0: number; pitch: number } | null>(null)
  const geomKey = `${windowKey}:${withChg ? 1 : 0}`

  useLayoutEffect(() => {
    const root = rootRef.current
    const col = rowsColRef.current
    if (!root || !col || !col.firstElementChild || !col.lastElementChild) {
      setRowGeom(null)
      return
    }
    const measure = () => {
      const first = col.firstElementChild as HTMLElement | null
      const last = col.lastElementChild as HTMLElement | null
      if (!root || !first || !last) return
      const n = col.childElementCount
      const rTop = root.getBoundingClientRect().top
      const fr = first.getBoundingClientRect()
      const lr = last.getBoundingClientRect()
      const top0 = fr.top - rTop + fr.height / 2
      const pitch = n > 1 ? (lr.top - rTop + lr.height / 2 - top0) / (n - 1) : fr.height
      // Identity-stable unless it really moved, so a ResizeObserver tick cannot
      // re-render the whole ladder for a sub-pixel reflow.
      setRowGeom((prev) =>
        prev && Math.abs(prev.top0 - top0) < 0.5 && Math.abs(prev.pitch - pitch) < 0.01
          ? prev
          : { top0, pitch },
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(col)
    return () => ro.disconnect()
  }, [geomKey])

  // Continuous row index of spot, interpolated between the two strikes that
  // bracket it so an uneven strike grid still lands in the right place, then
  // mapped to pixels through the measured pitch. `rows` runs high→low.
  const spotTop = useMemo(() => {
    const n = rows.length
    if (!rowGeom || n === 0 || spot == null || !(spot > 0)) return null
    let i = 0
    while (i < n && (rows[i]?.strike ?? -Infinity) > spot) i++
    let pos: number
    const above = rows[i - 1]
    const below = rows[i]
    if (i === 0) pos = 0 // above the top rung — pin to it
    else if (i >= n || !above || !below) pos = n - 1 // below the bottom rung
    else {
      const hi = above.strike
      const lo = below.strike
      pos = i - 1 + (hi === lo ? 0 : (hi - spot) / (hi - lo))
    }
    return rowGeom.top0 + pos * rowGeom.pitch
  }, [rowGeom, rows, spot])

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, position: 'relative' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          alignItems: 'center',
          gap: 8,
          paddingBottom: 4,
        }}
      >
        <Label>Strike</Label>
        <span style={{ textAlign: 'center' }}>
          <Label>Net GEX</Label>
        </span>
        <span style={{ textAlign: 'right' }}>
          <Label>Value</Label>
        </span>
        {withChg && (
          <span style={{ textAlign: 'right' }}>
            <Label>Δ 1D</Label>
          </span>
        )}
      </div>

      {spotTop !== null && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: spotTop,
            height: 0,
            borderTop: `1px dashed ${V2.text}`,
            pointerEvents: 'none',
            zIndex: 2,
            // NO css transition. Replay already eases spot frame by frame; a
            // transition on top of that restarts every frame and the line ends
            // up permanently trailing the price written on it.
          }}
        >
          <span
            style={{
              position: 'absolute',
              right: 0,
              top: -13,
              fontFamily: 'var(--font-mono)',
              fontSize: FS.tag,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: V2.text,
              // SOLID, not a wash — this chip sits on top of the bars.
              background: V2.panel,
              padding: '0 4px',
              borderRadius: 3,
            }}
          >
            {spot!.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}

      <div ref={rowsColRef} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => {
          const unrecorded = missing?.has(r.strike) ?? false
          const pos = r.gex >= 0
          // Floor of 2% so a tiny non-zero strike still shows a sliver.
          const pct = Math.max(2, (Math.abs(r.gex) / maxAbs) * 100)
          const isSpot = spotRow != null && r.strike === spotRow.strike

          // A strike can BE more than one level — core and call wall coincide
          // often — so every match gets its own tag.
          const marks: { key: string; label: string; color: string; title: string }[] = []
          if (levels.core === r.strike)
            marks.push({ key: 'cb', label: 'CB', color: LEVEL_COLORS.cb, title: 'Core — biggest magnet' })
          if (levels.callWall === r.strike)
            marks.push({ key: 'cw', label: 'CW', color: LEVEL_COLORS.cw, title: 'Call wall — ceiling' })
          if (levels.putWall === r.strike)
            marks.push({ key: 'pw', label: 'PW', color: LEVEL_COLORS.pw, title: 'Put wall — floor' })

          return (
            <div
              key={r.strike}
              data-tl-strike={r.strike}
              style={{
                display: 'grid',
                gridTemplateColumns: cols,
                alignItems: 'center',
                gap: 8,
                padding: '2px 6px',
                borderRadius: 8,
                border: `1px solid ${isSpot ? V2.cyan : 'transparent'}`,
                background: isSpot ? V2W.spotRow : 'transparent',
              }}
            >
              {/* ONE STRIKE = ONE ROW. Never wrap: the tags are annotations on
                  the strike beside them, and pushing one to a second line reads
                  as a second strike with a blank number. */}
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  minWidth: 0,
                  flexWrap: 'nowrap',
                  whiteSpace: 'nowrap',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: FS.row,
                    fontWeight: isSpot ? 800 : 600,
                    color: isSpot ? V2.cyan : V2.text,
                    flexShrink: 0,
                  }}
                >
                  {r.strike.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
                {/* Named tags, not anonymous dots. Three dot colours is a legend
                    to memorise; "CB" is not. Solid fill + ink on top, because
                    these sit over the bars. */}
                {marks.map((m) => (
                  <span
                    key={m.key}
                    title={m.title}
                    style={{
                      fontSize: FS.tag,
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      padding: '1px 4px',
                      borderRadius: 3,
                      flexShrink: 0,
                      background: m.color,
                      color: V2.ink,
                    }}
                  >
                    {m.label}
                  </span>
                ))}
              </span>

              {/* The bars are deliberately UNTOUCHED by the level marking — no
                  outline, no glow. A bar's job is magnitude and sign; the level
                  is said by the tag beside the strike and nowhere else. */}
              <span style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <span style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  {!unrecorded && !pos && (
                    <span
                      style={{
                        width: `${pct}%`,
                        height: 14,
                        borderRadius: '4px 0 0 4px',
                        background: V2.red,
                      }}
                    />
                  )}
                </span>
                <span style={{ width: 1, height: 18, background: V2W.border, flexShrink: 0 }} />
                <span style={{ flex: 1, display: 'flex' }}>
                  {!unrecorded && pos && (
                    <span
                      style={{
                        width: `${pct}%`,
                        height: 14,
                        borderRadius: '0 4px 4px 0',
                        background: V2.pos,
                      }}
                    />
                  )}
                </span>
              </span>

              <span
                title={
                  unrecorded
                    ? 'not recorded in this sweep — the recorder stores the walls, not every strike'
                    : undefined
                }
                style={{
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: FS.row,
                  fontWeight: 700,
                  color: unrecorded ? V2.muted : pos ? V2.pos : V2.red,
                  opacity: unrecorded ? 0.5 : 1,
                }}
              >
                {unrecorded ? '—' : fmtBig(r.gex)}
              </span>

              {withChg && <ChangeCell chg={changes?.get(r.strike)} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The Δ 1D cell.
 *
 * `undefined` means this strike is outside the recorded ±40 window, or no
 * snapshot exists for it yet. Print an em dash, NOT 0 — "no reading" and "did
 * not move" are different answers, and a 0 here would be a lie about a wall that
 * may have moved a long way.
 */
function ChangeCell({ chg }: { chg: number | undefined }) {
  const has = chg != null && Number.isFinite(chg) && chg !== 0
  return (
    <span
      title={
        chg == null
          ? 'no end-of-day snapshot for this strike'
          : `${chg > 0 ? '+' : ''}${fmtBig(chg)} vs prior session close`
      }
      style={{
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontSize: FS.caption,
        fontWeight: 700,
        // A zero that IS a reading paints white — it moved nowhere, which is
        // information. Only a missing reading is muted.
        color: chg == null ? V2.muted : has ? (chg > 0 ? V2.pos : V2.red) : V2.text,
        opacity: chg == null ? 0.5 : 1,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {chg == null ? '—' : `${chg > 0 ? '+' : chg < 0 ? '−' : ''}${fmtBig(Math.abs(chg))}`}
    </span>
  )
}
