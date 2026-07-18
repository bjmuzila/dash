import { useEffect, useMemo, useState } from 'react'
import { C, panelStyle } from './theme'
import { useGexFeed } from './useGexFeed'
import {
  netGEXTotal, callWallOf, putWallOf, findGEXFlip, netGEXOf,
  fmtMoneyB, formatStrikeValue, type CalcMode,
} from './calc'
import TopNav from './TopNav'
import GexToolbar, { type GexView, type GexMode, type DataMode } from './GexToolbar'
import LevelsStrip, { type Tile } from './LevelsStrip'
import GexChart from './GexChart'
import Heatmap from './Heatmap'
import SignalsFeed from './SignalsFeed'
import TabCard from './TabCard'

// Optionally enrich the levels strip (CB / Max Pain / EM) from the published
// /api/levels?ticker=SPX endpoint. Field names vary, so we read defensively.
function pick(obj: Record<string, unknown> | null, keys: string[]): number | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && isFinite(v)) return v
    if (typeof v === 'string' && v && isFinite(Number(v))) return Number(v)
  }
  return null
}

export default function Dashboard() {
  const [expiry, setExpiry] = useState('')
  const feed = useGexFeed(expiry)
  const [view, setView] = useState<GexView>('gex')
  const [mode, setMode] = useState<GexMode>('net')
  const [dataMode, setDataMode] = useState<DataMode>('oi-vol')
  const [showOI, setShowOI] = useState(false)
  const [showDex, setShowDex] = useState(false)
  const [showFlip, setShowFlip] = useState(true)
  const [intensity, setIntensity] = useState(1.75)
  const [levels, setLevels] = useState<Record<string, unknown> | null>(null)

  // Keep the local expiry in sync with the first one the feed reports.
  useEffect(() => {
    if (!expiry && feed.expiry) setExpiry(feed.expiry)
  }, [feed.expiry, expiry])

  useEffect(() => {
    let live = true
    fetch('/api/levels?ticker=SPX', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j) setLevels(j.levels ?? j) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  const cm: CalcMode = dataMode === 'vol-only' ? 'vol' : 'net'
  const spot = feed.spot > 0 ? feed.spot : feed.spotDisplay
  const chain = feed.gexRows

  const netGex = useMemo(() => netGEXTotal(chain, cm, spot), [chain, cm, spot])
  const callWall = useMemo(() => callWallOf(chain, spot, cm) ?? feed.callWall, [chain, spot, cm, feed.callWall])
  const putWall = useMemo(() => putWallOf(chain, spot, cm) ?? feed.putWall, [chain, spot, cm, feed.putWall])
  const flip = useMemo(() => findGEXFlip(chain, spot), [chain, spot])
  const posGexPct = useMemo(() => {
    let pos = 0, tot = 0
    for (const r of chain) { const v = netGEXOf(r, cm, spot); if (v > 0) pos += v; tot += Math.abs(v) }
    return tot > 0 ? (pos / tot) * 100 : null
  }, [chain, cm, spot])

  const cb = pick(levels, ['cb', 'CB', 'centralBank', 'mvc', 'mvcStrike']) ?? putWall
  const maxPain = pick(levels, ['maxPain', 'max_pain', 'maxpain'])
  const emUp = pick(levels, ['emUp', 'em_up', 'plus1', 'upperEM', 'em1up', 'emPlus'])
  const emDown = pick(levels, ['emDown', 'em_down', 'minus1', 'lowerEM', 'em1down', 'emMinus'])
  const bull = pick(levels, ['bull', 'bullPct', 'bull_bear', 'bullBear'])

  const tiles: Tile[] = [
    { label: 'Net GEX', value: fmtMoneyB(netGex), color: netGex >= 0 ? C.green : C.red },
    { label: 'Call Wall', value: callWall != null ? formatStrikeValue(callWall) : '—', color: C.green },
    { label: 'Put Wall', value: putWall != null ? formatStrikeValue(putWall) : '—', color: C.red },
    { label: 'Flip', value: flip != null ? formatStrikeValue(flip) : '—', color: C.orange },
    { label: 'CB', value: cb != null ? formatStrikeValue(cb) : '—', color: C.purple },
    { label: 'Max Pain', value: maxPain != null ? formatStrikeValue(maxPain) : '—', color: C.cyan },
    { label: '+1σ (EM)', value: emUp != null ? formatStrikeValue(emUp) : '—', color: C.green },
    { label: '−1σ (EM)', value: emDown != null ? formatStrikeValue(emDown) : '—', color: C.red },
    { label: '+GEX %', value: posGexPct != null ? `${posGexPct.toFixed(0)}%` : '—', color: posGexPct == null ? C.cyan : posGexPct >= 50 ? C.green : C.red },
    { label: 'Bull/Bear', value: bull != null ? `${Math.round(bull)} / ${100 - Math.round(bull)}` : '—', color: bull == null ? C.cyan : bull >= 50 ? C.green : C.red },
  ]

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: C.bg, color: '#fff' }}>
      <TopNav esFut={feed.esFut} esPrev={feed.esFutPrevClose} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', padding: 24, gap: 28, minHeight: 0, overflow: 'hidden' }}>
        {/* Left column */}
        <div style={{ width: '55%', display: 'flex', flexDirection: 'column', minWidth: 0, gap: 24, minHeight: 0 }}>
          <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', flex: '1.6 1 0', minHeight: 0, overflow: 'hidden' }}>
            <GexToolbar
              view={view} onView={setView}
              mode={mode} onMode={setMode}
              dataMode={dataMode} onDataMode={setDataMode}
              expirations={feed.expirations} expiry={expiry} onExpiry={setExpiry}
              showOI={showOI} showDex={showDex} showFlip={showFlip}
              onToggleOI={() => setShowOI((v) => !v)} onToggleDex={() => setShowDex((v) => !v)} onToggleFlip={() => setShowFlip((v) => !v)}
              onRefresh={() => setExpiry((e) => e)}
              status={feed.status}
            />
            <LevelsStrip tiles={tiles} />
            <div style={{ flex: 1, minHeight: 0, position: 'relative', padding: '0 8px 8px' }}>
              {view === 'escandles' ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6b85', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  ES Candles view — reuses the standalone /es-candles page in the live app (lightweight-charts). Port that route to enable here.
                </div>
              ) : feed.chartReady && chain.length > 0 ? (
                <GexChart chain={chain} spot={spot} mode={cm} flip={showFlip ? flip : null} cb={cb} />
              ) : (
                <Loader status={feed.status} />
              )}
            </div>
          </div>

          <div style={{ ...panelStyle, flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <TabCard />
          </div>
        </div>

        {/* Right column */}
        <div style={{ width: '45%', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ flexShrink: 0, paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
            <SignalsFeed />
          </div>
          <div style={{ ...panelStyle, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
            <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontWeight: 700, fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <span style={{ color: C.cyan }}>▦</span> Live GEX Heatmap
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Intensity</span>
                <input type="range" min={0.5} max={5} step={0.01} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} style={{ width: 90, accentColor: C.cyan }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C.cyan, fontWeight: 700 }}>{intensity.toFixed(2)}X</span>
              </span>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <Heatmap chain={chain} spot={spot} intensity={intensity} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Loader({ status }: { status: string }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#05080d' }}>
      <style>{`@keyframes gexspin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid rgba(33,158,188,0.15)', borderTopColor: C.cyan, animation: 'gexspin 0.8s linear infinite' }} />
      <div style={{ color: C.cyan, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {status === 'CONNECTING' || status === 'RECONNECTING' ? 'Connecting to /ws/gex…' : 'Loading SPX chain…'}
      </div>
      <div style={{ color: '#5a6b85', fontSize: 11, letterSpacing: '0.06em' }}>Start your Next backend so the feed can warm OI &amp; greeks</div>
    </div>
  )
}
