// Part N — Net Greeks. The four board-wide totals, and for SPX how far each has
// moved in the last 15 and 30 minutes.
//
// TWO SOURCES, ONE SET OF TILES. SPX is the only ticker with a recorded series
// (greeks-ts-writer.js is $SPX-only, because it reads /proxy/gex which is a
// single-symbol engine), so QQQ and SPY come from the live chain instead —
// same OI+Vol maths, no stored history, therefore no Δ columns.
//
// Both sources are normalised to RAW dollars before they reach a tile, so
// nothing below the fetch branches on where the number came from.

import { useState } from 'react'
import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Label,
  PillSelect,
  Row,
  UpdatedStamp,
  Value,
  etDateISO,
  fmtBig,
  signColor,
  useLiveData,
} from '../kit'
import {
  GREEK_SCALE,
  computeNetGreeks,
  rowNearestAgo,
  type ChainGreeks,
  type GreeksTsResp,
  type GreeksTsRow,
} from '../greeks'
import { V2, V2W } from '@/design/theme'

const TICKERS = ['SPX', 'QQQ', 'SPY'] as const
type NgTicker = (typeof TICKERS)[number]

type GreekField = 'gex' | 'dex' | 'chex' | 'vex'

const TILES: Array<{ g: string; k: GreekField }> = [
  { g: 'Net GEX', k: 'gex' },
  { g: 'Net DEX', k: 'dex' },
  { g: 'Net CHEX', k: 'chex' },
  { g: 'Net VEX', k: 'vex' },
]

export function NetGreeksCard() {
  const [tk, setTk] = useState<NgTicker>('SPX')
  const isSpx = tk === 'SPX'
  const today = etDateISO()

  // Today's series, ascending. Empty pre-open and overnight — the writer is
  // RTH-gated — which is what the fallback below exists for.
  const { data, loading, error, lastUpdated } = useLiveData<GreeksTsResp>(
    isSpx ? `/api/snapshots/greeks?date=${today}&limit=5000` : null,
  )
  // The latest row regardless of date. Used ONLY when today has none, so the
  // card shows the last session's totals instead of going blank overnight.
  const { data: latest } = useLiveData<GreeksTsResp>(
    isSpx ? '/api/snapshots/greeks?limit=1' : null,
    60_000,
  )
  const {
    data: chain,
    loading: chainLoading,
    error: chainError,
    lastUpdated: chainAt,
  } = useLiveData<unknown>(isSpx ? null : `/api/chains?ticker=${tk}&range=all`, 60_000)

  const todayRows = data?.rows ?? []
  const usingFallback = isSpx && todayRows.length === 0 && (latest?.rows?.length ?? 0) > 0
  // The fallback endpoint returns newest-first (limit 1); today's series is
  // ascending. Hence the two different ways of reaching "current".
  const rows = usingFallback ? (latest!.rows as GreeksTsRow[]) : todayRows
  const spxCur = usingFallback ? rows[0] : rows.length ? rows[rows.length - 1] : null
  const staleDate = usingFallback ? (spxCur?.date ?? null) : null

  // Intraday deltas only mean something on today's live series — never on a
  // one-row fallback, and never for a ticker with no series at all.
  const ago15 = spxCur && !usingFallback ? rowNearestAgo(rows, spxCur.timestamp, 15) : null
  const ago30 = spxCur && !usingFallback ? rowNearestAgo(rows, spxCur.timestamp, 30) : null

  const cur: ChainGreeks | null = isSpx
    ? spxCur
      ? {
          gex: spxCur.gex * GREEK_SCALE.gex,
          dex: spxCur.dex * GREEK_SCALE.dex,
          chex: spxCur.chex * GREEK_SCALE.chex,
          vex: spxCur.vex * GREEK_SCALE.vex,
        }
      : null
    : chain
      ? computeNetGreeks(chain)
      : null

  const deltaFor = (k: GreekField, ago: GreeksTsRow | null) =>
    isSpx && spxCur && ago ? (spxCur[k] - ago[k]) * GREEK_SCALE[k] : null

  // While today's fetch is still in flight we do not yet know whether the
  // fallback will be needed, so only spin when BOTH have produced nothing.
  const showLoading = (isSpx ? loading : chainLoading) && !cur
  const showError = isSpx ? error : chainError

  return (
    <AnalysisCard>
      <Row>
        <CardTitle>Net Greeks</CardTitle>
        <CardNote size={FS.micro}>
          {!isSpx
            ? 'live chain'
            : usingFallback
              ? `last session · ${staleDate ?? ''}`
              : 'now · Δ15m · Δ30m'}
        </CardNote>
      </Row>
      <PillSelect value={tk} options={TICKERS} onChange={setTk} />
      {showLoading || showError || !cur ? (
        <CardState
          loading={showLoading}
          error={showError}
          empty={isSpx ? 'No greeks series yet.' : `No live chain for ${tk}.`}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {TILES.map(({ g, k }) => {
            const nowVal = cur[k]
            const d15 = deltaFor(k, ago15)
            const d30 = deltaFor(k, ago30)
            return (
              <div
                key={g}
                style={{
                  border: `1px solid ${V2W.border}`,
                  borderRadius: 10,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <Label>{g}</Label>
                {/* A zero here is WHITE, not muted — deliberately unlike
                    signColor, which greys it. Both are v2's and they differ. */}
                <Value color={nowVal > 0 ? V2.pos : nowVal < 0 ? V2.red : V2.text} size={FS.tile}>
                  {fmtBig(nowVal)}
                </Value>
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    fontFamily: 'var(--font-mono)',
                    fontSize: FS.body,
                  }}
                >
                  <Delta label="15m" d={d15} />
                  <Delta label="30m" d={d30} />
                </div>
              </div>
            )
          })}
        </div>
      )}
      {/* Stamp the feed that actually produced the numbers on screen. */}
      <UpdatedStamp at={isSpx ? lastUpdated : chainAt} />
    </AnalysisCard>
  )
}

function Delta({ label, d }: { label: string; d: number | null }) {
  return (
    <span style={{ opacity: d == null ? 0.5 : 1 }}>
      <span style={{ color: V2.text }}>{label}</span>{' '}
      <span style={{ color: d == null ? V2.muted : signColor(d) }}>
        {d == null ? '—' : fmtBig(d)}
      </span>
    </span>
  )
}
