import { useMemo } from 'react'
import { C } from './theme'
import { netGEXOf, type ChainRow, type CalcMode } from './calc'

// Net-GEX bar chart: one bar per strike, positive (dealer long gamma) blue and
// up, negative (short gamma) gold and down, with a dashed spot line, a CB marker
// at the largest short-gamma strike, and a $B y-axis. Windowed around spot.
export default function GexChart({
  chain, spot, mode, flip, cb,
}: {
  chain: ChainRow[]
  spot: number
  mode: CalcMode
  flip: number | null
  cb: number | null
}) {
  const bars = useMemo(() => {
    if (!chain.length || !(spot > 0)) return []
    const lo = spot - 130, hi = spot + 130
    return chain
      .filter((r) => r.strike >= lo && r.strike <= hi)
      .sort((a, b) => a.strike - b.strike)
      .map((r) => ({ strike: r.strike, v: netGEXOf(r, mode, spot) }))
  }, [chain, spot, mode])

  const W = 900, H = 460
  const padL = 8, padR = 8, padT = 20, padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const maxAbs = Math.max(1, ...bars.map((b) => Math.abs(b.v)))
  const zeroY = padT + plotH / 2
  const bw = bars.length ? Math.min(26, (plotW / bars.length) * 0.72) : 0
  const xOf = (i: number) => padL + (bars.length <= 1 ? plotW / 2 : (plotW * i) / (bars.length - 1))
  const hOf = (v: number) => (Math.abs(v) / maxAbs) * (plotH / 2)

  const minStrike = bars.length ? bars[0].strike : 0
  const maxStrike = bars.length ? bars[bars.length - 1].strike : 0
  const xForStrike = (s: number) =>
    maxStrike === minStrike ? padL + plotW / 2 : padL + (plotW * (s - minStrike)) / (maxStrike - minStrike)

  // y-axis gridlines in $B
  const stepB = maxAbs > 6e10 ? 20 : maxAbs > 3e10 ? 10 : 5
  const grid: number[] = []
  for (let g = -Math.floor(maxAbs / 1e9 / stepB) * stepB; g <= Math.floor(maxAbs / 1e9 / stepB) * stepB; g += stepB) grid.push(g)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* gridlines */}
      {grid.map((g) => {
        const y = zeroY - (g * 1e9 / maxAbs) * (plotH / 2)
        return (
          <g key={g}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
            <text x={W - padR} y={y - 3} fill="#5a6b85" fontSize={10} textAnchor="end" fontFamily="var(--font-mono)">
              {g >= 0 ? '+' : ''}{g.toFixed(2)}B
            </text>
          </g>
        )
      })}
      {/* zero axis */}
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.22)" strokeWidth={1.2} />

      {/* bars */}
      {bars.map((b, i) => {
        const x = xOf(i) - bw / 2
        const h = hOf(b.v)
        const up = b.v >= 0
        const y = up ? zeroY - h : zeroY
        const fill = up ? C.posBar : C.negBar
        return <rect key={b.strike} x={x} y={y} width={bw} height={Math.max(1, h)} rx={1.5} fill={fill} opacity={0.92} />
      })}

      {/* spot line */}
      {spot > 0 && (
        <g>
          <line x1={xForStrike(spot)} x2={xForStrike(spot)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.55)" strokeWidth={1} strokeDasharray="4 4" />
          <text x={xForStrike(spot) + 4} y={padT + 10} fill="rgba(255,255,255,0.8)" fontSize={11} fontFamily="var(--font-mono)">
            SPX {spot.toFixed(2)}
          </text>
        </g>
      )}

      {/* flip line */}
      {flip != null && bars.length > 0 && (
        <line x1={xForStrike(flip)} x2={xForStrike(flip)} y1={padT} y2={H - padB} stroke={C.orange} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      )}

      {/* CB marker */}
      {cb != null && bars.length > 0 && (
        <g>
          <rect x={xForStrike(cb) - 26} y={H - padB - 2} width={52} height={16} rx={3} fill="rgba(251,133,1,0.15)" stroke={C.orange} strokeWidth={1} />
          <text x={xForStrike(cb)} y={H - padB + 9} fill={C.orange} fontSize={10} fontWeight={700} textAnchor="middle" fontFamily="var(--font-mono)">
            CB {Math.round(cb).toLocaleString()}
          </text>
        </g>
      )}

      {/* x-axis strike labels (every ~5th) */}
      {bars.map((b, i) =>
        i % Math.max(1, Math.round(bars.length / 6)) === 0 ? (
          <text key={`x${b.strike}`} x={xOf(i)} y={H - 6} fill="#5a6b85" fontSize={10} textAnchor="middle" fontFamily="var(--font-mono)">
            {b.strike}
          </text>
        ) : null,
      )}
    </svg>
  )
}
