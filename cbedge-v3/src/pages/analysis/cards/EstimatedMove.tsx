// Part J — Estimated Move. The published weekly EM bands for one symbol, and
// how far spot is from the nearer of them.
//
// The card renders as soon as the BANDS exist. Spot is best-effort and its
// LABEL says which source won: a live quote ("Spot"), the stored weekly close
// ("Close"), or the midpoint of the two bands ("Mid"). A futures contract with
// no quote and no stored close still draws sane bands instead of dividing by
// zero.

import { useState } from 'react'
import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Label,
  MoreLink,
  PillSelect,
  Row,
  Stat,
  UpdatedStamp,
  Value,
  divider,
  numOr,
  useLiveData,
} from '../kit'
import { V2 } from '@/design/theme'

interface LevelsRow {
  close?: string
  em?: string
  up?: string
  down?: string
  error?: string
}

interface QuotesResp {
  data?: { items?: Array<Record<string, unknown>> }
}

const TICKERS = ['ESU', 'NQU', 'SPX', 'SPY', 'QQQ'] as const
type EmTicker = (typeof TICKERS)[number]

/**
 * Futures quote under the front-contract symbol (the proxy resolves /NQU26 to
 * the live contract); equities and indices quote under their plain symbol.
 */
const QUOTE_SYMBOL: Record<EmTicker, string> = {
  ESU: '/ESU26',
  NQU: '/NQU26',
  SPX: 'SPX',
  SPY: 'SPY',
  QQQ: 'QQQ',
}

export function EstimatedMoveCard() {
  const [tk, setTk] = useState<EmTicker>('SPX')
  const {
    data: lv,
    loading: lvLoading,
    error: lvError,
    lastUpdated,
  } = useLiveData<LevelsRow>(`/api/levels?ticker=${tk}`)
  const { data: q } = useLiveData<QuotesResp>(
    `/api/tt-quotes?symbols=${encodeURIComponent(QUOTE_SYMBOL[tk])}`,
    15_000,
  )

  const up = numOr(lv?.up)
  const down = numOr(lv?.down)
  const close = numOr(lv?.close) // the weekly close the bands were built from

  const item = q?.data?.items?.[0]
  const liveSpot =
    numOr(item?.last) ??
    numOr(item?.['last-price']) ??
    numOr(item?.mark) ??
    numOr(item?.['mark-price']) ??
    numOr(item?.close)
  const midpoint = up != null && down != null ? (up + down) / 2 : null
  const spotRaw = liveSpot ?? close ?? midpoint
  // A zero or blank quote is not a spot. Reject it and fall back to the midpoint
  // rather than dividing the percentage by it.
  const spot = spotRaw != null && spotRaw > 0 ? spotRaw : midpoint
  const spotIsLive = liveSpot != null && liveSpot > 0

  const ready = up != null && down != null && spot != null && spot > 0
  const distUp = ready ? up! - spot! : 0
  const distDown = ready ? spot! - down! : 0
  const nearerUp = distUp <= distDown
  // Signed gap to the nearer band: > 0 not yet reached, < 0 price is through it.
  const near = nearerUp ? distUp : distDown
  const crossed = near < 0

  return (
    <AnalysisCard style={{ minWidth: 0 }}>
      <Row>
        <CardTitle>Estimated Move</CardTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CardNote>weekly</CardNote>
          <MoreLink href="/app/em" />
        </div>
      </Row>
      <PillSelect value={tk} options={TICKERS} onChange={setTk} />
      {lvLoading || lvError || !ready ? (
        <CardState loading={lvLoading} error={lvError} empty={`No published EM for ${tk}.`} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8,
              minWidth: 0,
            }}
          >
            <Stat label="EM Up" value={up!.toLocaleString()} color={V2.pos} size={FS.stat} />
            <Stat
              label={spotIsLive ? 'Spot' : close != null && close > 0 ? 'Close' : 'Mid'}
              value={spot!.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              size={FS.stat}
            />
            <Stat label="EM Down" value={down!.toLocaleString()} color={V2.red} size={FS.stat} />
          </div>
          <div style={divider} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label>
              Distance to nearer band ({nearerUp ? 'Up' : 'Down'})
              {crossed ? ' · crossed' : ''}
            </Label>
            <Row>
              <Value color={crossed ? V2.red : V2.pos} size={FS.stat}>
                {crossed ? '-' : ''}
                {Math.abs(near).toLocaleString(undefined, { maximumFractionDigits: 1 })} pts
              </Value>
              <Value color={V2.muted} size={FS.body}>
                {((Math.abs(near) / spot!) * 100).toFixed(2)}%
              </Value>
            </Row>
          </div>
        </>
      )}
      {/* Stamped from the LEVELS fetch, not the 15s quote — the bands are what
          the card is about, and a stamp that ticked every 15 seconds would
          claim the EM was refreshed when only the price was. */}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
