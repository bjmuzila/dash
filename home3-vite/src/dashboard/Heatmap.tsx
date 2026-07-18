import { useMemo } from 'react'
import { C } from './theme'
import { netGEXOf, callPosOf, putPosOf, type ChainRow } from './calc'
import type { DualTickerGex } from './useDualTickerGex'

// Live GEX heatmap — ported from HomeClient's heatmap: intensity-scaled cell
// backgrounds, rank badges (#1–#5 by |net GEX|), ATM row highlight, and the
// SPY/QQQ 0DTE net-GEX columns joined by moneyness offset (useDualTickerGex).

function metricBg(value: number, maxValue: number, intensity: number, topValues: number[]): string {
  const n = value || 0
  const m = maxValue || 0
  if (m === 0 || !n) return 'transparent'
  const pos = n >= 0
  const rank = topValues.indexOf(Math.abs(n)) + 1
  if (rank === 1) return pos ? 'rgba(41,182,246,0.90)' : 'rgba(255,71,87,0.90)'
  if (rank === 2) return pos ? 'rgba(41,182,246,0.45)' : 'rgba(255,71,87,0.45)'
  if (rank === 3) return pos ? 'rgba(41,182,246,0.25)' : 'rgba(255,71,87,0.25)'
  const ratio = Math.min(Math.abs(n) / m, 1)
  const eased = Math.pow(ratio * Math.max(intensity || 0.1, 1), 1.4)
  const alpha = Math.min(0.18, 0.02 + eased * 0.16)
  return pos ? `rgba(41,182,246,${alpha.toFixed(2)})` : `rgba(255,71,87,${alpha.toFixed(2)})`
}

function dexOf(r: ChainRow, spot: number): number {
  const cp = callPosOf(r, 'net'), pp = putPosOf(r, 'net')
  return ((r.callDelta ?? 0) * cp - (r.putDelta ?? 0) * pp) * spot * 100
}

function fmtM(v: number): string {
  if (!v) return '+$0M'
  const s = v >= 0 ? '+' : '-'
  return `${s}$${Math.round(Math.abs(v) / 1e6).toLocaleString('en-US')}M`
}

const RANK_COLORS = ['#FB8501', '#FB8501', '#94a3b8', '#94a3b8', '#94a3b8']

export default function Heatmap({ chain, spot, intensity, sideGex }: { chain: ChainRow[]; spot: number; intensity: number; sideGex?: DualTickerGex }) {
  const { rows, atmStrike, step } = useMemo(() => {
    const window = chain.filter((r) => r.strike >= spot - 110 && r.strike <= spot + 110)
    const atm = window.reduce(
      (best, r) => (Math.abs(r.strike - spot) < Math.abs(best - spot) ? r.strike : best),
      window[0]?.strike ?? spot,
    )
    // Strike spacing near the money (SPX is 5-wide) → convert Δstrike to offset.
    const strikes = [...new Set(window.map((r) => r.strike))].sort((a, b) => a - b)
    let st = 5
    for (let i = 1; i < strikes.length; i++) { const d = strikes[i] - strikes[i - 1]; if (d > 0) { st = d; break } }
    const built = window
      .sort((a, b) => b.strike - a.strike)
      .map((r) => ({
        strike: r.strike,
        net: netGEXOf(r, 'net', spot),
        vol: netGEXOf(r, 'vol', spot),
        dex: dexOf(r, spot),
        atm: r.strike === atm,
        offset: Math.round((r.strike - atm) / (st || 5)),
      }))
    return { rows: built, atmStrike: atm, step: st }
  }, [chain, spot])
  void atmStrike; void step

  // Per-column max + top-5 magnitudes for intensity + rank.
  const cols = useMemo(() => {
    const pick = (key: 'net' | 'vol' | 'dex') => {
      const abs = rows.map((r) => Math.abs(r[key])).sort((a, b) => b - a)
      return { max: abs[0] ?? 0, top: abs.slice(0, 5) }
    }
    return { net: pick('net'), vol: pick('vol'), dex: pick('dex') }
  }, [rows])

  const rankByNet = useMemo(() => {
    const top = rows.map((r) => Math.abs(r.net)).sort((a, b) => b - a).slice(0, 5)
    const m = new Map<number, number>()
    rows.forEach((r) => {
      const idx = top.indexOf(Math.abs(r.net))
      if (idx >= 0 && !m.has(idx + 1)) m.set(r.strike, idx + 1)
    })
    return m
  }, [rows])

  const sideMax = useMemo(() => {
    const maxOf = (t?: { map: Record<number, { netGEX: number }> }) =>
      t ? Math.max(0, ...Object.values(t.map).map((o) => Math.abs(o.netGEX))) : 0
    return { SPY: maxOf(sideGex?.SPY), QQQ: maxOf(sideGex?.QQQ) }
  }, [sideGex])

  const th: React.CSSProperties = { position: 'sticky', top: 0, background: 'rgba(10,13,20,0.98)', color: '#7f92a8', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', zIndex: 1 }
  const td: React.CSSProperties = { padding: '5px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'nowrap' }

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>Strike</th>
            <th style={th}>Net GEX</th>
            <th style={th}>Vol Only GEX</th>
            <th style={th}>DEX</th>
            <th style={th}>SPY 0DTE Net GEX</th>
            <th style={th}>QQQ 0DTE Net GEX</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rank = rankByNet.get(r.strike)
            return (
              <tr key={r.strike} style={{ borderTop: r.atm ? `1px solid ${C.cyan}66` : '1px solid rgba(255,255,255,0.03)', background: r.atm ? 'rgba(33,158,188,0.08)' : 'transparent' }}>
                <td style={{ ...td, textAlign: 'left', color: '#cdd8e6', fontWeight: 700 }}>
                  {rank && (
                    <span style={{ display: 'inline-block', minWidth: 20, marginRight: 8, padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 800, color: '#04121a', background: RANK_COLORS[rank - 1] }}>#{rank}</span>
                  )}
                  {r.strike.toLocaleString('en-US')}
                  {r.atm && <span style={{ marginLeft: 8, fontSize: 9, color: C.cyan, fontWeight: 800 }}>ATM</span>}
                </td>
                <td style={{ ...td, color: '#e8eef7', background: metricBg(r.net, cols.net.max, intensity, cols.net.top) }}>{fmtM(r.net)}</td>
                <td style={{ ...td, color: '#e8eef7', background: metricBg(r.vol, cols.vol.max, intensity, cols.vol.top) }}>{fmtM(r.vol)}</td>
                <td style={{ ...td, color: '#e8eef7', background: metricBg(r.dex, cols.dex.max, intensity, cols.dex.top) }}>{fmtM(r.dex)}</td>
                <SideCell v={sideGex?.SPY?.map[r.offset]?.netGEX} max={sideMax.SPY} intensity={intensity} td={td} />
                <SideCell v={sideGex?.QQQ?.map[r.offset]?.netGEX} max={sideMax.QQQ} intensity={intensity} td={td} />
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#5a6b85', padding: 40 }}>Waiting for live GEX rows from /ws/gex…</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function SideCell({ v, max, intensity, td }: { v?: number; max: number; intensity: number; td: React.CSSProperties }) {
  if (v == null || !isFinite(v)) return <td style={{ ...td, color: '#5a6b85' }}>—</td>
  return <td style={{ ...td, color: '#e8eef7', background: metricBg(v, max, intensity, []) }}>{fmtM(v)}</td>
}
