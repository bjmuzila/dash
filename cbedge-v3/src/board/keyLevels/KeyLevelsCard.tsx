import type { ReactNode } from 'react'
import { useMemo } from 'react'
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
// Key Levels — the six tiles off v2's premarket page, as a board card.
//
//   Call Wall · 0DTE Magnet · Spot · Max Pain · Gamma Flip · Put Wall
//
// Same order, same anatomy (label + chip / big number / ES sub-line / distance
// + pill / migration line), same arithmetic — see levelsMath.ts, which is a
// straight transcription of Premarket.tsx's derivations so the two surfaces
// cannot quietly disagree about what a level is.
//
// The one visible difference: v2's six tiles are all identical surfaces with no
// per-tile accent (the `lvl call` / `lvl put` modifier classes it emits have no
// CSS rule anywhere). This keeps that, because colour here would compete with
// the only colour that carries meaning — the sign of the distance.
//
// ── Where the numbers come from ──────────────────────────────────────────────
//   the live `gex` frame     rows, callWall, putWall, gexFlip
//   the live `spot` frame    spot
//   /proxy/es-spx-basis      the ES sub-line's SPX→ES conversion. The socket's
//                            own `basis` field is NOT usable — see the note on
//                            SpotData in src/contract/frames.ts.
//   /api/premarket-baseline  the "was → now" migration lines
//
// Max pain and the magnet are computed here rather than read: the server does
// not publish either, and both are a few lines over a chain we already have.
// ─────────────────────────────────────────────────────────────────────────────

const BASIS_KEY = 'cb-v3-key-levels-basis'

interface BasisResponse {
  basis?: number | null
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

function isPlausibleBasis(b: unknown): b is number {
  return typeof b === 'number' && Number.isFinite(b) && b > 0 && b < 250
}

function readBasisPref(): LevelBasis {
  try {
    const v = localStorage.getItem(BASIS_KEY)
    return v === 'oivol' || v === 'vol' ? v : 'oi'
  } catch {
    return 'oi'
  }
}

// ── Tile chrome ──────────────────────────────────────────────────────────────

function Tile({
  label,
  chip,
  value,
  sub,
  dist,
  distDir,
  pill,
  pillTone = 'plain',
  mig,
}: {
  label: string
  chip: string
  value: string
  sub: ReactNode
  dist: string
  /** null suppresses the up/down colouring — the Spot tile has no direction. */
  distDir: 'up' | 'down' | null
  pill: ReactNode
  pillTone?: 'plain' | 'hot' | 'cool' | 'warn'
  mig?: ReactNode
}) {
  const pillClass =
    pillTone === 'hot'
      ? 'border-down text-down'
      : pillTone === 'cool'
        ? 'border-up text-up'
        : pillTone === 'warn'
          ? 'border-warn text-warn'
          : 'border-line text-muted opacity-70'

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface2 px-2.5 pb-2.5 pt-2">
      <div className="flex items-center justify-between gap-1.5 text-[10px] uppercase tracking-[0.07em] text-muted opacity-70">
        <span className="truncate">{label}</span>
        <span className="shrink-0 rounded-sm border border-line bg-surface px-1.5 py-px text-[9px] normal-case tracking-normal">
          {chip}
        </span>
      </div>
      <div className="tabular mt-1 truncate text-xl font-semibold tracking-tight text-fg">{value}</div>
      <div className="tabular truncate text-[10.5px] text-muted opacity-70">{sub}</div>
      <div className="mt-1.5 flex items-center justify-between gap-1.5 text-[11px]">
        <span className={['tabular', distDir === 'up' ? 'text-up' : distDir === 'down' ? 'text-down' : 'text-muted opacity-70'].join(' ')}>
          {dist}
        </span>
        {pill != null && (
          <span className={['shrink-0 rounded-sm border px-1.5 py-px text-[10px] whitespace-nowrap', pillClass].join(' ')}>
            {pill}
          </span>
        )}
      </div>
      {mig}
    </div>
  )
}

/**
 * The "was → now" line. Returns null rather than a row of dashes when there is
 * nothing to say — a migration line that always renders trains the eye to skip
 * it, and then it is useless on the day it matters.
 */
function MigLine({
  tag,
  tone,
  was,
  now,
  pct,
  note,
}: {
  tag?: string
  tone?: 'up' | 'down' | 'warn' | 'flip'
  was?: string
  now?: string
  pct?: string
  note?: string
}) {
  if (!tag && !was && !note) return null
  const toneClass =
    tone === 'up'
      ? 'border-up text-up'
      : tone === 'down'
        ? 'border-down text-down'
        : tone === 'warn'
          ? 'border-warn text-warn'
          : tone === 'flip'
            ? 'border-accent text-accent'
            : 'border-line text-muted opacity-70'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-1.5 text-[10.5px] text-muted opacity-80">
      {tag && (
        <span className={['rounded-full border px-1.5 py-px text-[9px] uppercase tracking-[0.06em]', toneClass].join(' ')}>
          {tag}
        </span>
      )}
      {was && (
        <span className="tabular">
          was {was}
          {now ? ` → ${now}` : ''}
          {pct ? ` · ${pct}` : ''}
        </span>
      )}
      {note && <span className="tabular opacity-70">{note}</span>}
    </div>
  )
}

// ── The card ─────────────────────────────────────────────────────────────────

export function KeyLevelsCard() {
  const basisPref: LevelBasis = readBasisPref()

  const gex = useField<GexFrame, GexData | null>('gex', (f) => f?.data ?? null)
  const spot = useField<SpotFrame, number>('spot', (f) => f?.data.spot ?? 0)

  const basisQ = useQuery<BasisResponse>('/proxy/es-spx-basis', { staleMs: 300_000 })
  const basis = isPlausibleBasis(basisQ.data?.basis) ? basisQ.data!.basis! : null
  const es = (px: number | null | undefined) => (px == null || basis == null ? null : px + basis)

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
  const spotWas = typeof baseline?.spot === 'number' ? baseline.spot : null
  const spotMove = spotWas != null && spot ? spot - spotWas : null

  const emptyFeed = rows.length === 0 && !spot

  return (
    <div className={['flex min-h-0 flex-1 flex-col gap-2', emptyFeed ? 'stale' : ''].join(' ')}>
      <div className="flex shrink-0 items-baseline justify-between gap-2">
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
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Call Wall"
          chip="resistance"
          value={fmtPx(callWall, kDp)}
          sub={
            <>
              {es(callWall) != null && `ES ${fmtPx(es(callWall), 0)} · `}
              {fmtUsd(wallGex.call, false)}
            </>
          }
          dist={fmtPts(distCall)}
          distDir={distCall == null ? null : distCall >= 0 ? 'up' : 'down'}
          pill="untested o/n"
          mig={
            <MigLine
              tag={callWas == null ? undefined : callMig.text}
              tone={callMig.dir === 'flat' ? undefined : callMig.dir}
              was={callWas == null ? undefined : fmtUsd(callWas, false)}
              now={wallGex.call == null ? undefined : fmtUsd(wallGex.call, false)}
              pct={callPct == null ? undefined : fmtPct(callPct, 0)}
            />
          }
        />

        <Tile
          label="0DTE Magnet"
          chip="max γ"
          value={magnet ? fmtPx(magnet.strike, kDp) : '—'}
          sub={
            <>
              {es(magnet?.strike ?? null) != null && `ES ${fmtPx(es(magnet?.strike ?? null), 0)} · `}
              {fmtUsd(magnet?.value ?? null, false)}
            </>
          }
          dist={magnet && spot ? fmtPts(magnet.strike - spot) : '—'}
          distDir={null}
          pill={magnet && spot && Math.abs(magnet.strike - spot) <= pinEps ? 'pinning' : 'magnet'}
          pillTone={magnet && spot && Math.abs(magnet.strike - spot) <= pinEps ? 'warn' : 'plain'}
          mig={
            <MigLine
              tag={
                magnetWas == null || magnet == null
                  ? undefined
                  : Math.sign(magnetWas) !== Math.sign(magnet.value)
                    ? magnet.value >= 0
                      ? 'flipped +γ'
                      : 'flipped −γ'
                    : (magnetPct ?? 0) >= 0
                      ? 'building'
                      : 'eroding'
              }
              tone={
                magnetWas == null || magnet == null
                  ? undefined
                  : Math.sign(magnetWas) !== Math.sign(magnet.value)
                    ? 'flip'
                    : (magnetPct ?? 0) >= 0
                      ? 'up'
                      : 'warn'
              }
              was={magnetWas == null ? undefined : fmtUsd(magnetWas, false)}
              now={magnet == null ? undefined : fmtUsd(magnet.value, false)}
              pct={magnetPct == null ? undefined : fmtPct(magnetPct, 0)}
            />
          }
        />

        <Tile
          label="Spot"
          chip="live"
          value={fmtPx(spot, pDp)}
          sub={basis == null ? 'SPX cash' : `ES ${fmtPx(spot + basis, pDp)}`}
          dist={gex?.updatedAt ? new Date(gex.updatedAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) + ' ET' : '—'}
          distDir={null}
          pill={null}
          mig={
            <MigLine
              tag={
                spotMove == null ? undefined : Math.abs(spotMove) < pxEps ? 'flat o/n' : spotMove > 0 ? 'gap up' : 'gap down'
              }
              tone={spotMove == null || Math.abs(spotMove) < pxEps ? undefined : spotMove > 0 ? 'up' : 'down'}
              was={spotWas == null ? undefined : fmtPx(spotWas, pDp)}
              now={spot ? fmtPx(spot, pDp) : undefined}
              pct={spotMove == null ? undefined : fmtPts(spotMove)}
            />
          }
        />

        {/* Max Pain carries NO migration line, deliberately: the baseline stores
            net GEX per strike, not per-side open interest, so a prior-close max
            pain cannot be derived from it. "unchanged" would be a claim rather
            than the gap it actually is. */}
        <Tile
          label="Max Pain"
          chip="front"
          value={fmtPx(maxPain, kDp)}
          sub={es(maxPain) != null ? `ES ${fmtPx(es(maxPain), 0)}` : 'OI-weighted'}
          dist={maxPain != null && spot ? fmtPts(maxPain - spot) : '—'}
          distDir={maxPain == null || !spot ? null : maxPain - spot >= 0 ? 'up' : 'down'}
          pill={maxPain != null && spot ? (maxPain >= spot ? 'drift ↑' : 'drift ↓') : null}
        />

        <Tile
          label="Gamma Flip"
          chip="regime"
          value={fmtPx(flip, kDp)}
          sub={es(flip) != null ? `ES ${fmtPx(es(flip), 0)} · zero γ` : 'zero γ'}
          dist={fmtPts(distFlip)}
          distDir={distFlip == null ? null : distFlip >= 0 ? 'up' : 'down'}
          pill={distFlip == null ? null : distFlip >= 0 ? 'long γ' : 'short γ'}
          pillTone={distFlip == null ? 'plain' : distFlip >= 0 ? 'cool' : 'hot'}
          mig={
            <MigLine
              tag={
                flipMove == null
                  ? undefined
                  : Math.abs(flipMove) < pxEps
                    ? 'held'
                    : flipMove > 0
                      ? `rose ${fmtPx(Math.abs(flipMove), pDp)}`
                      : `fell ${fmtPx(Math.abs(flipMove), pDp)}`
              }
              tone={flipMove == null || Math.abs(flipMove) < pxEps ? undefined : 'flip'}
              was={flipWas == null ? undefined : fmtPx(flipWas, kDp)}
              now={flip == null ? undefined : fmtPx(flip, kDp)}
            />
          }
        />

        <Tile
          label="Put Wall"
          chip="support"
          value={fmtPx(putWall, kDp)}
          sub={
            <>
              {es(putWall) != null && `ES ${fmtPx(es(putWall), 0)} · `}
              {fmtUsd(wallGex.put, false)}
            </>
          }
          dist={fmtPts(distPut)}
          distDir={distPut == null ? null : distPut >= 0 ? 'up' : 'down'}
          pill="untested"
          pillTone="cool"
          mig={
            <MigLine
              tag={putWas == null ? undefined : putMig.text}
              tone={putMig.dir === 'flat' ? undefined : putMig.dir}
              was={putWas == null ? undefined : fmtUsd(putWas, false)}
              now={wallGex.put == null ? undefined : fmtUsd(wallGex.put, false)}
              pct={putPct == null ? undefined : fmtPct(putPct, 0)}
            />
          }
        />
      </div>
    </div>
  )
}
