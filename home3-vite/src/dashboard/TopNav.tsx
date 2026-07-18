import { useEffect, useState } from 'react'
import { C } from './theme'

// Top toolbar — logo + primary nav + live ES/NQ readouts + ET clock.
// ES/NQ values come from the live feed (esFut). NQ isn't in the GEX feed, so it
// shows from the feed if present, otherwise a dash.
const NAV = ['Home', 'Traders D…', 'Analytics', 'Multi Greek', 'Options C…', 'Est. Moves', 'Flow', 'ES Candles', 'Scanner', 'ICT', 'Test Lab', 'Owner', "What's New", 'Journal', 'Order Flow', 'Lookup']

function useClockET() {
  const [t, setT] = useState('')
  useEffect(() => {
    const tick = () =>
      setT(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

function Ticker({ sym, price, chg, pct }: { sym: string; price: number; chg: number; pct: number }) {
  const pos = chg >= 0
  const col = pos ? C.green : C.red
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, fontFamily: 'var(--font-mono)' }}>
      <span style={{ color: '#fff', fontWeight: 800, letterSpacing: '0.06em' }}>{sym}</span>
      <span style={{ color: '#fff', fontWeight: 700 }}>{price > 0 ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span>
      <span style={{ color: col, fontWeight: 700, fontSize: 12 }}>
        {price > 0 ? `${pos ? '+' : ''}${chg.toFixed(2)} (${pos ? '+' : ''}${pct.toFixed(2)}%)` : ''}
      </span>
    </span>
  )
}

export default function TopNav({ esFut, esPrev }: { esFut: number; esPrev: number }) {
  const clock = useClockET()
  const esChg = esFut > 0 && esPrev > 0 ? esFut - esPrev : 0
  const esPct = esFut > 0 && esPrev > 0 ? (esChg / esPrev) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, background: 'rgba(10,13,20,0.9)', flexShrink: 0 }}>
      <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 30, width: 'auto', flexShrink: 0 }} />
      <nav style={{ display: 'flex', gap: 14, overflow: 'hidden', flex: 1, minWidth: 0 }}>
        {NAV.map((n, i) => (
          <span key={n} style={{ fontSize: 11, fontWeight: 600, color: i === 0 ? C.cyan : '#9fb0c3', whiteSpace: 'nowrap', letterSpacing: '0.02em' }}>{n}</span>
        ))}
      </nav>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
        <Ticker sym="ESU" price={esFut} chg={esChg} pct={esPct} />
        <Ticker sym="NQU" price={0} chg={0} pct={0} />
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 15, color: '#fff', letterSpacing: '0.04em' }}>{clock} ET</span>
      </div>
    </div>
  )
}
