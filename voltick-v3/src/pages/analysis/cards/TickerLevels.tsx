// Part P — Ticker Levels. Spot · Call Wall · Put Wall · CORE for ONE symbol,
// picked from a searchable menu over the whole scanner universe.
//
// TWO READ PATHS, because neither alone is sufficient:
//
//   /proxy/walls?date=…   { tickers: [{ symbol, spot, call_wall, put_wall, cb }] }
//       Sampled from scanner_snapshots onto a 15m slot grid starting 09:29 ET.
//       The ONLY endpoint that returns `cb`, so CORE comes from here or nowhere
//       — /proxy/scanner's SELECT omits the column even though the table has it.
//
//   /proxy/scanner?any=1  Each symbol's most recent row regardless of date,
//       swept every 2–5m. Fresher spot/walls than the slot grid, but no `cb`,
//       and rows carried over from a previous session are flagged `stale`.
//
// So scanner wins for spot/call/put and walls supplies CORE. Both are fetched
// once for the WHOLE universe, not per selection — switching the symbol is a
// local lookup, instant and costing no extra request.
//
// TODAY ONLY. Nothing here may come from a previous session: `stale` scanner
// rows are dropped rather than shown, and there is no prior-session walls
// fallback. Before the recorders have written today the card says so instead of
// printing yesterday's numbers under a live-looking timestamp.
//
// NO FUTURES. scanner_snapshots covers cash indices and equities only, so
// ESU/NQU were derived rows — SPX plus the ES−SPX basis, and spot-only for NQ.
// They are gone: futures traders read the index levels off the ES chart, and a
// basis-shifted row was one more number to keep honest for no extra signal.

import { useEffect, useState } from 'react'
import {
  FS,
  AnalysisCard,
  CardNote,
  CardState,
  CardTitle,
  Label,
  Row,
  Stat,
  UpdatedStamp,
  Value,
  divider,
  etDateISO,
  numOr,
  signColor,
  useLiveData,
} from '../kit'
import { TickerPicker, cleanSymbol, loadList, saveList } from '../TickerPicker'
import { useScannerTickers } from '@/data/useScannerTickers'
import { V2 } from '@/design/theme'

interface WallsTickerRow {
  symbol: string
  spot: number | null
  call_wall: number | null
  put_wall: number | null
  cb: number | null
}
interface WallsResp {
  ok?: boolean
  date?: string
  tickers?: WallsTickerRow[]
  error?: string
}

interface ScannerRow {
  symbol: string
  date?: string
  stale?: boolean
  expiry?: string | null
  spot: number | null
  call_wall: number | null
  put_wall: number | null
}
interface ScannerResp {
  ok?: boolean
  rows?: ScannerRow[]
  error?: string
}

const DEFAULTS: readonly string[] = ['SPX', 'SPY', 'QQQ']
const STORE_KEY = 'analytics.tickerLevels.extra'

/**
 * "Aug 6 · 0DTE" for the expiry the levels were computed on.
 *
 * The scanner always takes expirations[0] — the nearest — so this reads 0DTE
 * intraday and rolls to the next contract after the close. Which expiry produced
 * a wall is not cosmetic: a call wall from tomorrow's chain is a different level
 * from today's.
 */
function expiryLabel(exp: string | null, todayISO: string): string {
  if (!exp) return 'exp —'
  const d = new Date(`${exp}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return `exp ${exp}`
  const pretty = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d)
  const dte = Math.round((d.getTime() - new Date(`${todayISO}T00:00:00Z`).getTime()) / 86_400_000)
  return dte >= 0 ? `${pretty} · ${dte}DTE` : pretty
}

interface LevelRow {
  symbol: string
  spot: number | null
  core: number | null
  call: number | null
  put: number | null
  expiry: string | null
  note: string | null
}

export function TickerLevelsCard() {
  const today = etDateISO()
  const [tk, setTk] = useState<string>('SPX')
  const [extra, setExtra] = useState<string[]>([])

  // Restored in an effect rather than a useState initializer so the first client
  // render matches what the server rendered.
  useEffect(() => {
    setExtra(loadList(STORE_KEY))
  }, [])
  const persist = (next: string[]) => {
    setExtra(next)
    saveList(STORE_KEY, next)
  }

  const {
    data: walls,
    loading: wLoading,
    error: wError,
    lastUpdated,
  } = useLiveData<WallsResp>(`/proxy/walls?date=${today}`, 120_000)
  const { data: scan, loading: sLoading, error: sError } = useLiveData<ScannerResp>(
    '/proxy/scanner?any=1&limit=200',
    120_000,
  )
  const { tickers: scannerTickers } = useScannerTickers()

  // Today's slot grid or nothing. It does not start until 09:29 ET, so CORE is
  // simply absent pre-open, overnight and at weekends — that is the honest
  // reading. Falling back a session put a stale number where a live one goes.
  const wallRows = walls?.tickers ?? []
  const corePending = !!walls && wallRows.length === 0

  // scanner first (fresher spot/walls), then walls overlays CORE on top.
  const bySymbol = (() => {
    const m = new Map<
      string,
      { spot: number | null; call: number | null; put: number | null; core: number | null; expiry: string | null }
    >()
    for (const r of scan?.rows ?? []) {
      // `stale` is the recorder's own flag for a row carried over from an
      // earlier date. Skipped, not displayed — so an empty map means today's
      // sweep genuinely has not landed yet.
      if (r.stale) continue
      m.set(String(r.symbol).toUpperCase(), {
        spot: numOr(r.spot),
        call: numOr(r.call_wall),
        put: numOr(r.put_wall),
        core: null,
        expiry: r.expiry || null,
      })
    }
    // /proxy/walls' day summary carries no expiry column, but it samples the
    // very same scanner_snapshots rows — so the scanner's expiry describes CORE
    // too.
    for (const t of wallRows) {
      const k = String(t.symbol).toUpperCase()
      const e = m.get(k)
      if (e) e.core = numOr(t.cb)
      else
        m.set(k, {
          spot: numOr(t.spot),
          call: numOr(t.call_wall),
          put: numOr(t.put_wall),
          core: numOr(t.cb),
          expiry: null,
        })
    }
    return m
  })()

  // Every symbol a recorder knows about, stale rows INCLUDED — that is the
  // difference between "we don't scan that name" and "today's sweep hasn't
  // reached it yet", and the note below says which.
  const knownSymbols = new Set([
    ...(scan?.rows ?? []).map((r) => String(r.symbol).toUpperCase()),
    ...wallRows.map((t) => String(t.symbol).toUpperCase()),
  ])

  const e = bySymbol.get(tk)
  const row: LevelRow = {
    symbol: tk,
    spot: e?.spot ?? null,
    core: e?.core ?? null,
    call: e?.call ?? null,
    put: e?.put ?? null,
    expiry: e?.expiry ?? null,
    note: e
      ? null
      : knownSymbols.has(tk)
        ? "waiting on today's scanner sweep"
        : 'not in the scanner universe',
  }

  // The menu: the three anchors, whatever the trader added, the whole scanner
  // universe, and the CURRENT selection — so a symbol restored from an older
  // save never renders as a trigger with no matching row.
  const tickers = Array.from(new Set([...DEFAULTS, ...extra, ...scannerTickers, tk.toUpperCase()]))

  const addTicker = (raw: string) => {
    const sym = cleanSymbol(raw)
    if (!sym) return
    if (!tickers.includes(sym)) persist([...extra, sym])
    setTk(sym) // typing a ticker means you want to look at it
  }
  const removeTicker = (sym: string) => {
    persist(extra.filter((s) => s !== sym))
    if (tk === sym) setTk('SPX')
  }

  // Ready once the selected symbol resolved at least a spot — the walls can be
  // null and the card is still worth showing. bySymbol only ever holds today's
  // rows, so an empty map with both fetches settled is the pre-recorder state,
  // not a failure.
  const loaded = bySymbol.size > 0 || row.spot != null
  const loading = (wLoading || sLoading) && !loaded
  const error = loaded ? null : (wError ?? sError)

  // Signed gap to the nearer wall: > 0 not yet reached, < 0 price is through it.
  const distCall = row.spot != null && row.call != null ? row.call - row.spot : null
  const distPut = row.spot != null && row.put != null ? row.spot - row.put : null
  const nearerCall = distCall != null && (distPut == null || distCall <= distPut)
  const near = nearerCall ? distCall : distPut
  const crossed = near != null && near < 0
  const distCore = row.spot != null && row.core != null ? row.core - row.spot : null

  const fmtLvl = (n: number | null) =>
    n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })

  // Core is blank until today's 09:29 ET walls slot has run — say WHICH, so a
  // dash reads as "not recorded yet" rather than "this symbol has no core".
  const coreWaiting = row.core == null && corePending
  const notes = [row.note, coreWaiting ? 'core pending — first walls run 9:29 AM ET' : null].filter(
    Boolean,
  ) as string[]

  return (
    <AnalysisCard style={{ minWidth: 0 }}>
      <Row>
        <CardTitle>Ticker Levels</CardTitle>
        <CardNote
          opacity={0.7}
          title={
            row.expiry
              ? `Levels computed on the ${row.expiry} chain`
              : 'No expiry recorded for this symbol'
          }
        >
          {expiryLabel(row.expiry, today)}
        </CardNote>
      </Row>

      <TickerPicker
        value={tk}
        options={tickers}
        custom={extra}
        onSelect={setTk}
        onAdd={addTicker}
        onRemove={removeTicker}
      />

      {loading || error ? (
        <CardState loading={loading} error={error} empty="Waiting on today's first recorder run." />
      ) : (
        <>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, minWidth: 0 }}
          >
            <Stat label="Spot" value={fmtLvl(row.spot)} size={FS.stat} />
            <Stat
              label="Call Wall"
              value={fmtLvl(row.call)}
              color={row.call == null ? V2.muted : V2.orange}
              size={FS.stat}
            />
            <Stat
              label="Put Wall"
              value={fmtLvl(row.put)}
              color={row.put == null ? V2.muted : V2.pos}
              size={FS.stat}
            />
          </div>

          <div style={divider} />

          <Row>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Label>Core</Label>
              <Value color={row.core == null ? V2.muted : V2.cyan} size={FS.lead}>
                {fmtLvl(row.core)}
              </Value>
            </div>
            <Value color={distCore == null ? V2.muted : signColor(distCore)} size={FS.body}>
              {distCore == null
                ? '—'
                : `${distCore >= 0 ? '+' : ''}${distCore.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
            </Value>
          </Row>

          <div style={divider} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Label>
              Distance to nearer wall ({nearerCall ? 'Call' : 'Put'})
              {crossed ? ' · through' : ''}
            </Label>
            <Row>
              <Value color={near == null ? V2.muted : crossed ? V2.red : V2.pos} size={FS.stat}>
                {near == null
                  ? '—'
                  : `${crossed ? '-' : ''}${Math.abs(near).toLocaleString(undefined, { maximumFractionDigits: 1 })} pts`}
              </Value>
              <Value color={V2.muted} size={FS.body}>
                {near == null || row.spot == null
                  ? '—'
                  : `${((Math.abs(near) / row.spot) * 100).toFixed(2)}%`}
              </Value>
            </Row>
          </div>

          {notes.length ? (
            <span
              style={{
                fontSize: FS.small,
                color: coreWaiting ? V2.orange : V2.muted,
                opacity: coreWaiting ? 0.75 : 0.5,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {notes.join(' · ')}
            </span>
          ) : null}
        </>
      )}
      <UpdatedStamp at={lastUpdated} />
    </AnalysisCard>
  )
}
