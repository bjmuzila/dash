import { useMemo } from 'react'
import { CardToolbar } from '@/design/primitives/Card'
import { LevelsAxis, type AxisMark } from './LevelsAxis'
import { useField } from '@/data/hooks'
import { useQuery } from '@/data/api'
import type { GexData, GexFrame, SpotFrame } from '@/contract/frames'
import {
  BASIS_LABEL,
  computeMagnet,
  computeMaxPain,
  fmtPct,
  fmtPts,
  fmtPx,
  fmtUsd,
  legValue,
  pinEpsilon,
  priceDp,
  pxEpsilon,
  strikeDp,
  wallState,
  type LevelBasis,
} from './levelsMath'

// ─────────────────────────────────────────────────────────────────────────────
// Key Levels — every level on ONE horizontal price axis.
//
//   Put Wall · Gamma Flip · Max Pain · Core (max γ) · Spot · Call Wall
//   … plus this week's estimated-move band when it is close enough to matter.
//
// Was six tiles in a row. Tiles answer "what is the call wall" one at a time,
// and the question actually being asked is "where is price sitting inside the
// gamma" — which is a question about the DISTANCES BETWEEN the levels, and six
// boxes cannot show a distance at all. On one axis the gap between spot and the
// wall above it is a gap you can see. See LevelsAxis.tsx for the rail itself.
//
// Nothing was dropped in the move: every tile's level is a mark, and each tile's
// migration line ("building", "deepening", "rose 4.00") survives as the note
// under its price. The arithmetic is untouched — levelsMath.ts is still a
// straight transcription of Premarket.tsx's derivations, so v2 and v3 cannot
// quietly disagree about what a level is.
//
// One deliberate difference from v2: no ES sub-line. v2 prints "ES 6,880" under
// each level because its charts are ES futures and its levels are SPX cash. v3
// dropped the futures, so a level is quoted in the units it is already in and
// the whole /proxy/es-spx-basis path went with it.
//
// ── Where the numbers come from ──────────────────────────────────────────────
//   the live `gex` frame     rows, callWall, putWall, gexFlip
//   the live `spot` frame    spot, prevClose
//   /api/premarket-baseline  the "was → now" migration notes
//   /api/em-tracker          this week's estimated-move band (Postgres)
//
// Max pain and the magnet are computed here rather than read: the server does
// not publish either, and both are a few lines over a chain we already have.
// ─────────────────────────────────────────────────────────────────────────────

const BASIS_KEY = 'cb-v3-key-levels-basis'

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

interface BaselineResponse {
  ok?: boolean
  date?: string
  spot?: number
  flip?: number | null
  callWall?: number | null
  putWall?: number | null
  byStrike?: Record<string, number>
}

function readBasisPref(): LevelBasis {
  try {
    const v = localStorage.getItem(BASIS_KEY)
    return v === 'oivol' || v === 'vol' ? v : 'oi'
  } catch {
    return 'oi'
  }
}

// ── The card ─────────────────────────────────────────────────────────────────

export function KeyLevelsCard() {
  const basisPref: LevelBasis = readBasisPref()

  const gex = useField<GexFrame, GexData | null>('gex', (f) => f?.data ?? null)
  const spot = useField<SpotFrame, number>('spot', (f) => f?.data.spot ?? 0)
  const prevClose = useField<SpotFrame, number>('spot', (f) => f?.data.prevClose ?? 0)

  const rows = gex?.gexRows ?? []
  const expiry = gex?.expiry ?? ''
  const baselineQ = useQuery<BaselineResponse>(
    expiry ? `/api/premarket-baseline?expiry=${encodeURIComponent(expiry)}&basis=oi&symbol=%24SPX` : null,
    { staleMs: 300_000 },
  )
  const baseline = baselineQ.data?.ok ? baselineQ.data : null

  const kDp = useMemo(() => strikeDp(rows, spot), [rows, spot])
  const pDp = priceDp(spot)
  const pxEps = pxEpsilon(spot)
  const pinEps = pinEpsilon(spot)

  const callWall = gex?.callWall ?? null
  const putWall = gex?.putWall ?? null
  const flip = gex?.gexFlip ?? null
  const maxPain = useMemo(() => computeMaxPain(rows), [rows])
  const magnet = useMemo(() => computeMagnet(rows, spot, 'oivol'), [rows, spot])

  const byStrike = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of rows) m.set(r.strike, legValue(r, basisPref))
    return m
  }, [rows, basisPref])

  const wallGex = {
    call: callWall == null ? null : (byStrike.get(callWall) ?? null),
    put: putWall == null ? null : (byStrike.get(putWall) ?? null),
  }

  const distCall = callWall == null || !spot ? null : callWall - spot
  const distPut = putWall == null || !spot ? null : putWall - spot
  const distFlip = flip == null || !spot ? null : spot - flip

  // Day change comes off the socket's own prevClose rather than a quotes call —
  // it is already on the frame the spot arrives in.
  const dayChange = spot && prevClose ? spot - prevClose : null
  const dayPct = dayChange != null && prevClose ? (dayChange / prevClose) * 100 : null

  /** Prior-close gamma at a strike, on the baseline's basis. */
  const wasGexAt = (strike: number | null): number | null => {
    if (strike == null || !baseline?.byStrike) return null
    const v = baseline.byStrike[String(strike)]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  /** A percent change only survives when the base is big enough to mean one. */
  const pctOf = (was: number | null, now: number | null): number | null => {
    if (was == null || now == null || Math.abs(was) <= 1e6) return null
    return ((now - was) / Math.abs(was)) * 100
  }

  const callWas = wasGexAt(callWall)
  const putWas = wasGexAt(putWall)
  const magnetWas = wasGexAt(magnet?.strike ?? null)
  const callPct = pctOf(callWas, wallGex.call)
  const putPct = pctOf(putWas, wallGex.put)
  const magnetPct = pctOf(magnetWas, magnet?.value ?? null)

  const callMig = wallState(callPct, 'building', 'eroding')
  // A put wall's gamma is negative, so a bigger number is a SHALLOWER wall:
  // 'deepening' is the down direction, not the up one. Getting this backwards
  // paints the support tile green on the day support is falling away.
  const putMig = wallState(putPct, 'easing', 'deepening')

  const flipWas = typeof baseline?.flip === 'number' ? baseline.flip : null
  const flipMove = flipWas != null && flip != null ? flip - flipWas : null
  const emptyFeed = rows.length === 0 && !spot

  // ── This week's estimated move ─────────────────────────────────────────────
  // Rows come back newest-first (ORDER BY week_start DESC), so [0] is the
  // current week once it has been struck. `up` / `down` are the band's prices
  // and are what the axis wants; `ref_close ± em` is the fallback for a row
  // imported before the bounds were being stored.
  //
  // Ten minutes of cache and no poll: this is a weekly number.
  const emQ = useQuery<{ rows?: EmTrackerRow[] }>('/api/em-tracker?ticker=SPX', { staleMs: 600_000 })
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

    // A wall's migration is the same word its tile carried; it is the most
    // useful thing that can sit under a price in one line, so it goes there
    // rather than being lost with the tile.
    const withMig = (pts: string, was: number | null, mig: { text: string }) =>
      was == null ? pts : `${pts} · ${mig.text}`

    add(
      'pw',
      'PW',
      'Put Wall',
      putWall,
      '--color-level-pw',
      withMig(fmtPts(distPut), putWas, putMig),
      fmtUsd(wallGex.put, false),
    )
    add(
      'flip',
      'FLIP',
      'Gamma Flip',
      flip,
      '--color-accent',
      flipMove == null || Math.abs(flipMove) < pxEps
        ? fmtPts(distFlip)
        : `${fmtPts(distFlip)} · ${flipMove > 0 ? 'rose' : 'fell'} ${Math.abs(flipMove).toFixed(pDp)}`,
    )
    add(
      'pain',
      'PAIN',
      'Max Pain',
      maxPain,
      '--color-muted',
      maxPain != null && spot ? fmtPts(maxPain - spot) : 'oi-weighted',
    )
    add(
      'core',
      'CORE',
      'Max γ Strike',
      magnet?.strike ?? null,
      '--color-level-cb',
      magnet && spot
        ? withMig(
            Math.abs(magnet.strike - spot) <= pinEps ? `${fmtPts(magnet.strike - spot)} · pinning` : fmtPts(magnet.strike - spot),
            magnetWas,
            wallState(magnetPct, 'building', 'eroding'),
          )
        : 'magnet',
      fmtUsd(magnet?.value ?? null, false),
    )
    add(
      'spot',
      'SPOT',
      'Spot',
      spot || null,
      '--color-fg',
      dayChange == null
        ? 'live'
        : `${dayChange >= 0 ? '+' : '−'}${Math.abs(dayChange).toFixed(pDp)} · ${fmtPct(dayPct)}`,
      undefined,
      pDp,
    )
    add(
      'cw',
      'CW',
      'Call Wall',
      callWall,
      '--color-level-cw',
      withMig(fmtPts(distCall), callWas, callMig),
      fmtUsd(wallGex.call, false),
    )

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
      if (fits(weeklyEm.down)) add('emd', 'EM', 'Weekly EM Low', weeklyEm.down, '--color-warn', note)
      if (fits(weeklyEm.up)) add('emu', 'EM', 'Weekly EM High', weeklyEm.up, '--color-warn', note)
    }

    return out
  }, [
    putWall, distPut, putWas, putMig,
    flip, distFlip, flipMove, pxEps, pDp,
    maxPain, spot,
    magnet, pinEps, magnetWas, magnetPct,
    dayChange, dayPct,
    callWall, distCall, callWas, callMig,
    kDp, wallGex.call, wallGex.put,
    weeklyEm,
  ])

  return (
    <div className={['flex min-h-0 flex-1 flex-col', emptyFeed ? 'stale' : ''].join(' ')}>
      {/* The baseline caption is this card's whole toolbar, so it belongs in the
          Card header beside the title rather than on a row of its own. */}
      <CardToolbar>
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted opacity-60">
          {baseline ? (
            <>
              vs <span className="font-bold text-fg">{baseline.date}</span> close · {BASIS_LABEL[basisPref]} basis
            </>
          ) : baselineQ.loading || !expiry ? (
            'prior-close baseline loading…'
          ) : (
            'no prior-close baseline — levels only'
          )}
        </span>
      </CardToolbar>

      <LevelsAxis marks={marks} spotPrice={spot || null} />
    </div>
  )
}
