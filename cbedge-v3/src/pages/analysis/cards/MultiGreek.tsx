// Part I — Multi Greek. Per-strike greek exposure from /api/chains, computed
// with the OI+Vol formula the Ticker Lookup card's left pane also uses, so the
// two panels on this page can never print different numbers for the same
// ticker. Peak strike = the largest |value|, per greek.

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
  fmtBig,
  signColor,
  useLiveData,
} from '../kit'
import { computePeakGreeks, type GreekKey } from '../greeks'
import { V2, V2W } from '@/design/theme'

const TICKERS = ['SPX', 'QQQ', 'SPY'] as const
type Ticker = (typeof TICKERS)[number]

const ORDER: GreekKey[] = ['GEX', 'DEX', 'CHEX', 'VEX']

export function MultiGreekCard() {
  const [tk, setTk] = useState<Ticker>('SPX')
  const { data, loading, error, lastUpdated } = useLiveData<unknown>(
    `/api/chains?ticker=${tk}&range=all`,
    60_000,
  )

  const peaks = data ? computePeakGreeks(data) : null
  const hasAny = peaks ? ORDER.some((k) => peaks[k] != null) : false

  return (
    <AnalysisCard>
      <Row>
        <CardTitle>Multi Greek</CardTitle>
        <CardNote>peak strike</CardNote>
      </Row>
      <PillSelect value={tk} options={TICKERS} onChange={setTk} />
      {loading || error || !hasAny ? (
        <CardState loading={loading} error={error} empty={`No live chain for ${tk}.`} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {ORDER.map((k) => {
            const pk = peaks![k]
            // The STRIKE is coloured by the sign of its VALUE — the number says
            // where, the colour says which way it leans.
            const c = pk ? signColor(pk.value) : V2.muted
            return (
              <div
                key={k}
                style={{
                  border: `1px solid ${V2W.border}`,
                  borderRadius: 10,
                  padding: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <Label>{k} · peak strike</Label>
                <Value color={c} size={FS.peak}>
                  {pk ? pk.strike.toLocaleString() : '—'}
                </Value>
                <span
                  style={{
                    fontSize: FS.label,
                    color: c,
                    opacity: 0.7,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {pk ? fmtBig(pk.value) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
