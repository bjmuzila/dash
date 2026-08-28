import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { LevelsAxis, type AxisMark } from './LevelsAxis'
import { useField } from '@/data/hooks'
import { useQuery } from '@/data/api'
import { isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexData, GexFrame, GexRow, SpotFrame } from '@/contract/frames'
import { chainGexUrl, chainToGex, findCallWall, findPutWall } from '../chainGex'
import { computeMagnet, computeMaxPain, fmtPts, fmtPx, priceDp, strikeDp } from './levelsMath'

// ─────────────────────────────────────────────────────────────────────────────
// Key Levels — every level on ONE horizontal price axis.
//
//   Put Wall · Gamma Flip · Max Pain · Core (max γ) · Spot · Call Wall
//   … plus this week's estimated-move band when it is close enough to matter.
//
// Each mark is a label, a price and its distance from spot. Nothing else.
//
// The core and a wall never share a strike: when they collide the core keeps the
// top node and the wall steps down to the second on its own side. See the block
// on that in LevelsBody.
//
// Was six tiles in a row. Tiles answer "what is the call wall" one at a time,
// and the question actually being asked is "where is price sitting inside the
// gamma" — which is a question about the DISTANCES BETWEEN the levels, and six
// boxes cannot show a distance at all. On one axis the gap between spot and the
// wall above it is a gap you can see. See LevelsAxis.tsx for the rail itself.
//
// The arithmetic is untouched — levelsMath.ts is still a straight transcription
// of Premarket.tsx's derivations, so v2 and v3 cannot quietly disagree about
// what a level is.
//
// One deliberate difference from v2: no ES sub-line. v2 prints "ES 6,880" under
// each level because its charts are ES futures and its levels are SPX cash. v3
// dropped the futures, so a level is quoted in the units it is already in and
// the whole /proxy/es-spx-basis path went with it.
//
// ── Where the numbers come from ──────────────────────────────────────────────
//   the live `gex` frame     rows, callWall, putWall, gexFlip — SPX ONLY
//   the live `spot` frame    spot — SPX ONLY
//   /api/chains              the same, derived, for every other page symbol
//                            (board/chainGex.ts). The socket streams one
//                            underlying, so this is what lets the card follow
//                            the toolbar's ticker at all.
//   /api/em-tracker          this week's estimated-move band (Postgres)
//
// The `/api/premarket-baseline` fetch went with the migration notes. A level's
// note is now its DISTANCE and nothing else — "building", "eroding",
// "deepening", "rose 15" are gone, and with them the only thing that request
// fed. A word that says a wall is thickening is a second reading laid on top of
// a price, and this card is the price.
//
// Max pain and the magnet are computed here rather than read: the server does
// not publish either, and both are a few lines over a chain we already have.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `/api/em-tracker` — one row per (ticker, week), owner-gated, Postgres-backed.
 *
 * `up` / `down` are the band's PRICES and are what goes on the axis. `em` is the
 * magnitude and `ref_close` the price it was struck from; together they are the
 * fallback for a row imported before the bounds were being stored.
 */
interface EmTrackerRow {
  week_label?: string | null
  week_start?: string | null
  em?: number | null
  ref_close?: number | null
  up?: number | null
  down?: number | null
}

// ── The card ─────────────────────────────────────────────────────────────────

/** What the body needs, whichever source produced it. */
interface LevelsSource {
  rows: GexRow[]
  callWall: number | null
  putWall: number | null
  flip: number | null
  spot: number
}

/**
 * ── SPX: the socket ────────────────────────────────────────────────────────
 * A COMPONENT rather than a branch inside the card, because `useField` cannot
 * be called conditionally and subscribing to a frame the board is not showing
 * is not free: the socket derives its `?topics=` from what is actually
 * subscribed, so an unconditional useField('gex') would keep pulling SPX frames
 * across the wire on a board that is looking at AMZN. Not mounting the
 * component is what unsubscribes.
 */
function SocketLevels({ render }: { render: (s: LevelsSource) => ReactNode }) {
  const frame = useField<GexFrame, GexData | null>('gex', (f) => f?.data ?? null)
  const spot = useField<SpotFrame, number>('spot', (f) => f?.data.spot ?? 0)
  return (
    <>
      {render({
        rows: frame?.gexRows ?? [],
        callWall: frame?.callWall ?? null,
        putWall: frame?.putWall ?? null,
        flip: frame?.gexFlip ?? null,
        spot,
      })}
    </>
  )
}

/** Every other symbol: the same ladder, derived from its option chain. */
function ChainLevels({ symbol, render }: { symbol: string; render: (s: LevelsSource) => ReactNode }) {
  // 15s, the cadence Multi Greek polls its ladders on. `staleMs` alone would
  // never refetch — it is a cache TTL, not an interval.
  const q = useQuery<unknown>(chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const chain = useMemo(() => chainToGex(q.data), [q.data])
  return <>{render(chain)}</>
}

export function KeyLevelsCard() {
  const { symbol } = usePageSymbol()
  const onSocket = isSocketSymbol(symbol)
  const body = (s: LevelsSource) => <LevelsBody symbol={symbol} {...s} />
  // Keyed by symbol so a source swap remounts rather than carrying the previous
  // ticker's rows into the next one's first render.
  return onSocket ? (
    <SocketLevels key={symbol} render={body} />
  ) : (
    <ChainLevels key={symbol} symbol={symbol} render={body} />
  )
}

function LevelsBody({
  symbol,
  rows,
  callWall: rawCallWall,
  putWall: rawPutWall,
  flip,
  spot,
}: LevelsSource & { symbol: string }) {
  const kDp = useMemo(() => strikeDp(rows, spot), [rows, spot])
  const pDp = priceDp(spot)

  const maxPain = useMemo(() => computeMaxPain(rows), [rows])
  const magnet = useMemo(() => computeMagnet(rows, spot, 'oivol'), [rows, spot])

  // ── The core and a wall must never be the same strike ──────────────────────
  //
  // They land on one strike often: the CORE is the biggest |OI+VOL| node near
  // spot, and the biggest node near spot is frequently also the biggest on one
  // SIDE of it. When that happens the axis drew one level where there should be
  // two — and the price that is lost is the one that actually has to get
  // through AFTER the core, which is the more useful of the pair.
  //
  // So the core keeps the top node and the wall steps down to the SECOND on its
  // own side: second-largest positive above spot for the call wall,
  // second-most-negative below spot for the put wall.
  //
  // Only on a collision. When they already differ the value is passed through
  // untouched — that matters on the SPX path, where the wall was computed
  // server-side and silently replacing it with a local re-derivation would be a
  // way for the two to drift apart without anyone noticing. Here the local
  // re-pick runs only in the one case the server's own findCallWall() has an
  // `exclude` parameter for and this caller never passes.
  //
  // Null is a legitimate answer: if the core was the ONLY qualifying strike on
  // that side, there is no second wall, and no mark is better than a wrong one.
  const core = magnet?.strike ?? null
  const callWall = core != null && rawCallWall === core ? findCallWall(rows, spot, core) : rawCallWall
  const putWall = core != null && rawPutWall === core ? findPutWall(rows, spot, core) : rawPutWall

  const distCall = callWall == null || !spot ? null : callWall - spot
  const distPut = putWall == null || !spot ? null : putWall - spot
  const distFlip = flip == null || !spot ? null : spot - flip

  const emptyFeed = rows.length === 0 && !spot

  // ── This week's estimated move ─────────────────────────────────────────────
  // Rows come back newest-first (ORDER BY week_start DESC), so [0] is the
  // current week once it has been struck. `up` / `down` are the band's prices
  // and are what the axis wants; `ref_close ± em` is the fallback for a row
  // imported before the bounds were being stored.
  //
  // Ten minutes of cache and no poll: this is a weekly number.
  const emQ = useQuery<{ rows?: EmTrackerRow[] }>(`/api/em-tracker?ticker=${encodeURIComponent(symbol)}`, {
    staleMs: 600_000,
  })
  const weeklyEm = useMemo(() => {
    const row = emQ.data?.rows?.[0]
    if (!row) return null
    const ref = typeof row.ref_close === 'number' ? row.ref_close : null
    const em = typeof row.em === 'number' ? row.em : null
    const up = typeof row.up === 'number' ? row.up : ref != null && em != null ? ref + em : null
    const down = typeof row.down === 'number' ? row.down : ref != null && em != null ? ref - em : null
    if (up == null || down == null || !(up > 0) || !(down > 0)) return null
    return { up, down, label: row.week_label ?? '' }
  }, [emQ.data])

  const marks = useMemo(() => {
    const out: AxisMark[] = []
    const add = (
      key: string,
      code: string,
      name: string,
      price: number | null | undefined,
      colourVar: string,
      note: string,
      sub?: string,
      dp = kDp,
    ) => {
      if (price == null || !Number.isFinite(price) || price <= 0) return
      out.push({ key, code, name, price, text: fmtPx(price, dp), colourVar, note, sub })
    }

    add('pw', 'PW', 'Put Wall', putWall, '--color-level-pw', fmtPts(distPut))
    add('flip', 'FLIP', 'Gamma Flip', flip, '--color-accent', fmtPts(distFlip))
    add('pain', 'PAIN', 'Max Pain', maxPain, '--color-muted', maxPain != null && spot ? fmtPts(maxPain - spot) : '')
    add(
      'core',
      'CORE',
      'Max γ Strike',
      magnet?.strike ?? null,
      '--color-level-cb',
      magnet && spot ? fmtPts(magnet.strike - spot) : '',
    )
    add('spot', 'SPOT', 'Spot', spot || null, '--color-fg', 'live', undefined, pDp)
    add('cw', 'CW', 'Call Wall', callWall, '--color-level-cw', fmtPts(distCall))

    // ── The EM band, and only when it is close enough to be worth an axis ─────
    // The gamma levels set the scale. A weekly band on a quiet week sits inside
    // them and is the most useful thing on the card; on a wide week it can be
    // fifty points outside the put wall, and putting it on the axis would
    // squash every level that matters into the middle third to make room for a
    // number nobody is trading against today. So it is drawn only if it already
    // fits the picture the gamma drew.
    if (weeklyEm && out.length) {
      let lo = Infinity
      let hi = -Infinity
      for (const m of out) {
        if (m.price < lo) lo = m.price
        if (m.price > hi) hi = m.price
      }
      const fits = (v: number) => v >= lo && v <= hi
      const note = weeklyEm.label ? `wk ${weeklyEm.label}` : 'weekly em'
      if (fits(weeklyEm.down)) add('emd', 'EM', 'Weekly EM Low', weeklyEm.down, '--color-warn', note, undefined, pDp)
      if (fits(weeklyEm.up)) add('emu', 'EM', 'Weekly EM High', weeklyEm.up, '--color-warn', note, undefined, pDp)
    }

    return out
  }, [putWall, distPut, flip, distFlip, maxPain, spot, magnet, callWall, distCall, kDp, pDp, weeklyEm])

  return (
    <div className={['flex min-h-0 flex-1 flex-col', emptyFeed ? 'stale' : ''].join(' ')}>
      <LevelsAxis marks={marks} spotPrice={spot || null} />
    </div>
  )
}
