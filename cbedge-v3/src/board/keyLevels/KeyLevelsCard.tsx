import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { LevelsAxis, type AxisMark } from './LevelsAxis'
import { useField } from '@/data/hooks'
import { useQuery } from '@/data/api'
import { useLiveGex } from '@/data/liveGex'
import { isSocketSymbol, usePageSymbol } from '@/data/symbol'
import type { GexFrame, GexRow } from '@/contract/frames'
import type { CoreNode } from '@/data/levels'
import { chainGexUrl, chainToGex } from '../chainGex'
import { parseChain } from '../multiGreek/mgMath'
import { CardHeading } from '../cardTitle'
import { computeMaxPain, fmtPts, fmtPx, priceDp, strikeDp } from './levelsMath'

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
// A level FURTHER FROM SPOT THAN `MAX_DIST_PCT` is left off entirely. See the
// block on that below — an axis is a picture of distance, and one outlier sets
// the scale for everything else.
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
//   useLiveGex (data/liveGex.ts)  rows, spot, and every LEVEL — SPX ONLY.
//                            The hook derives the walls, the CORE and the flip
//                            through data/levels.ts; this card reads them and
//                            draws them. It does not compute a level of its own
//                            except max pain.
//   /api/chains              the same shape, through the same deriveLevels(),
//                            for every other page symbol (board/chainGex.ts).
//                            The socket streams one underlying, so this is what
//                            lets the card follow the toolbar's ticker at all.
//   /api/em-tracker          this week's estimated-move band (Postgres)
//
// The `/api/premarket-baseline` fetch went with the migration notes. A level's
// note is now its DISTANCE and nothing else — "building", "eroding",
// "deepening", "rose 15" are gone, and with them the only thing that request
// fed. A word that says a wall is thickening is a second reading laid on top of
// a price, and this card is the price.
//
// Max pain is computed here rather than read: the server does not publish it,
// it is pure open interest with no gamma in it, and no other surface draws it.
// The walls, the CORE and the flip are NOT computed here — they arrive derived
// from data/levels.ts, which is the one place they are defined. See the block
// in LevelsBody for what used to happen here and why it moved.
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
  core: CoreNode | null
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
  // useLiveGex, NOT the raw `gex` frame. The hook is the ONE place the walls,
  // the CORE and the flip are derived (data/levels.ts) — this card used to pull
  // the frame's own callWall/putWall/gexFlip and then patch them locally, which
  // is how it and the premarket rail ended up printing different levels off one
  // feed. It subscribes to the same frames this component did, so the topic
  // scope is unchanged.
  const g = useLiveGex()
  return (
    <>
      {render({
        rows: g.chain as unknown as GexRow[],
        callWall: g.callWall,
        putWall: g.putWall,
        core: g.core,
        flip: g.flip,
        spot: g.spot,
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

// ── The heading ──────────────────────────────────────────────────────────────
//
//   AMZN - Key Levels - 8-31-26
//
// A separate component from the card, mounted by BoardPage into the Card
// header (CardDef.Title), because a board tile's title is drawn by the board
// and not by the card body. It costs nothing extra to read the expiry twice:
// on SPX both readers are the same store subscription, and off SPX both are the
// same /api/chains URL, which useQuery dedupes to ONE request.
//
// Split the same way the card is, and for the same reason — see SocketLevels:
// an unconditional useField('gex') would keep SPX frames on the wire while the
// board is looking at AMZN.

export function KeyLevelsTitle() {
  const { symbol } = usePageSymbol()
  return isSocketSymbol(symbol) ? (
    <SocketTitle symbol={symbol} />
  ) : (
    <ChainTitle key={symbol} symbol={symbol} />
  )
}

/** SPX: the expiry the socket says it is streaming. */
function SocketTitle({ symbol }: { symbol: string }) {
  const expiry = useField<GexFrame, string>('gex', (f) => f?.data.expiry ?? '')
  return <CardHeading symbol={symbol} label="Key Levels" date={expiry} />
}

/**
 * Everything else: the FRONT expiry of the chain the ladder was derived from —
 * `chainToGex()` picks `expiries[0]` and this reads the same element, so the
 * heading can never name an expiry the axis was not built from. Parsed rather
 * than re-derived through chainToGex(), which would recompute every strike's
 * gamma to read one string.
 */
function ChainTitle({ symbol }: { symbol: string }) {
  const q = useQuery<unknown>(chainGexUrl(symbol), { staleMs: 15_000, pollMs: 15_000 })
  const expiry = useMemo(() => parseChain(q.data).expiries[0]?.expiration ?? '', [q.data])
  return <CardHeading symbol={symbol} label="Key Levels" date={expiry} />
}

// ─────────────────────────────────────────────────────────────────────────────
// HOW FAR IS TOO FAR
//
// The axis spans its own marks, so the FURTHEST one sets the scale for all of
// them. One level a thousand points from spot therefore does not just add a
// label out on the left — it compresses put wall, max pain, core, spot and call
// wall into a few pixels at the other end, and the card stops being able to
// answer the only question it exists for.
//
// So a level beyond this fraction of spot is not drawn at all. 2.5% is ~190
// points on a 7,650 SPX, which comfortably contains a real day's walls, and
// scales on its own for a $214 name (~$5) — a fixed point budget would be
// nonsense on anything but the index.
//
// Dropping a level is honest here in a way it would not be in a table: this is
// a picture of where price sits inside the gamma, and something a thousand
// points away is not part of that picture. SPOT is never dropped.
const MAX_DIST_PCT = 0.025

function LevelsBody({
  symbol,
  rows,
  callWall,
  putWall,
  core,
  flip: flipShown,
  spot,
}: LevelsSource & { symbol: string }) {
  const kDp = useMemo(() => strikeDp(rows, spot), [rows, spot])
  const pDp = priceDp(spot)

  // The only level still computed here: max pain is pure open interest, has
  // nothing to do with gamma, and no other surface draws it.
  const maxPain = useMemo(() => computeMaxPain(rows), [rows])

  // ── Where these come from ──────────────────────────────────────────────────
  // All of them arrive DERIVED — from useLiveGex on SPX, from chainToGex on
  // every other symbol, and both of those call the same deriveLevels(). This
  // component used to do three jobs here that are now done once, upstream:
  //
  //   * bump a wall off the CORE when the two collided. Still happens; it is
  //     the `exclude` inside deriveLevels. The premarket rail never did it,
  //     which is why the two surfaces disagreed about the put wall.
  //   * take the CORE as the biggest node within ±12 strikes of spot. That
  //     window moves with price, so the CORE could jump twenty points on a
  //     quote with nothing having changed in the book. It is the whole-board
  //     maximum now — the server's Core Bullseye, and what the premarket rail
  //     already documented itself as drawing.
  //   * repair an implausible flip. Also upstream, and better: the first answer
  //     is now the spot-sweep profile's zero rather than the server's
  //     first-crossing-from-the-bottom, so there is usually nothing to repair.
  //     This card drew NO flip at all on a positive-gamma board, because every
  //     rung it had tested for a cumulative crossing that does not exist there.
  //
  // What is left is distance, formatting and the axis.

  const distCall = callWall == null || !spot ? null : callWall - spot
  const distPut = putWall == null || !spot ? null : putWall - spot
  const distFlip = flipShown == null || !spot ? null : spot - flipShown

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
      // Too far to be part of the picture — see MAX_DIST_PCT. `spot` itself is
      // exempt by definition: it is the thing everything else is measured from,
      // and an axis without it is unreadable.
      if (key !== 'spot' && spot > 0 && Math.abs(price - spot) > spot * MAX_DIST_PCT) return
      out.push({ key, code, name, price, text: fmtPx(price, dp), colourVar, note, sub })
    }

    add('pw', 'PW', 'Put Wall', putWall, '--color-level-pw', fmtPts(distPut))
    add('flip', 'FLIP', 'Gamma Flip', flipShown, '--color-accent', fmtPts(distFlip))
    add('pain', 'PAIN', 'Max Pain', maxPain, '--color-muted', maxPain != null && spot ? fmtPts(maxPain - spot) : '')
    add(
      'core',
      'CORE',
      'Max γ Strike',
      core?.strike ?? null,
      '--color-level-cb',
      core && spot ? fmtPts(core.strike - spot) : '',
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
  }, [putWall, distPut, flipShown, distFlip, maxPain, spot, core, callWall, distCall, kDp, pDp, weeklyEm])

  return (
    <div className={['flex min-h-0 flex-1 flex-col', emptyFeed ? 'stale' : ''].join(' ')}>
      <LevelsAxis marks={marks} spotPrice={spot || null} />
    </div>
  )
}
