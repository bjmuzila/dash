import { useEffect, useState } from 'react'
import { C } from '../theme'

// Scanner — Top-10 GEX-change cards from /proxy/strike-growth/scanner (the same
// call ScannerHomePanel makes: building walls only, biggest N-min size first).
type GexRow = {
  symbol: string
  expiry?: string
  strike?: number
  latest_chg: number
  pct_open?: number | null
  otm_dist?: number | null
}
type Win = 5 | 15 | 30 | 60

function fmt$(v: number): string {
  const s = v >= 0 ? '+' : '-'
  const a = Math.abs(v)
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}

export default function ScannerPanel() {
  const [win, setWin] = useState<Win>(5)
  const [rows, setRows] = useState<GexRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const u = new URL('/proxy/strike-growth/scanner', window.location.origin)
        u.searchParams.set('window', String(win))
        u.searchParams.set('sort', 'score')
        u.searchParams.set('limit', '25')
        u.searchParams.set('dir', 'build')
        u.searchParams.set('minOtm', '0.05')
        const res = await fetch(u.toString(), { cache: 'no-store' })
        const text = await res.text()
        let j: { ok?: boolean; rows?: GexRow[]; error?: string }
        try { j = JSON.parse(text) } catch { throw new Error(`server ${res.status} (recorder may not have run)`) }
        if (!j.ok) throw new Error(j.error || 'load failed')
        if (live) { setRows(j.rows || []); setErr(null) }
      } catch (e) { if (live) setErr(String((e as Error)?.message || e)) }
    }
    load()
    const id = setInterval(load, 60000)
    return () => { live = false; clearInterval(id) }
  }, [win])

  const top = (rows ?? []).slice().sort((a, b) => Math.abs(b.latest_chg || 0) - Math.abs(a.latest_chg || 0)).slice(0, 10)

  return (
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        {([5, 15, 30, 60] as Win[]).map((w) => (
          <button key={w} onClick={() => setWin(w)} style={{ padding: '5px 11px', fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${win === w ? 'rgba(33,158,188,0.5)' : C.border}`, background: win === w ? 'rgba(33,158,188,0.14)' : 'rgba(255,255,255,0.02)', color: win === w ? C.cyan : '#8a97ad' }}>{w}m</button>
        ))}
        <span style={{ fontSize: 11, color: '#5a6b85', marginLeft: 4 }}>Top 10 · biggest {win}m Δ · building walls</span>
        <a href="/scanner" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.green, textDecoration: 'none' }}>Full scanner →</a>
      </div>

      {err && <div style={{ color: C.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {rows && !top.length && !err && <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>No qualifying moves yet.</div>}
      {!rows && !err && <div style={{ padding: 20, color: '#5a6b85', fontSize: 12 }}>Loading scanner…</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {top.map((r, i) => {
          const up = r.latest_chg >= 0
          const col = up ? C.green : C.red
          const otm = (r.otm_dist ?? 0) * 100
          return (
            <div key={`${r.symbol}-${r.expiry}-${r.strike}-${i}`} style={{ background: 'radial-gradient(circle at 50% 0%, rgba(126,211,252,0.08) 0%, transparent 60%), rgba(13,17,25,0.45)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{r.symbol}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#9fb0c3' }}>{r.strike ?? ''}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 800, color: col }}>{fmt$(r.latest_chg)}</div>
              <div style={{ fontSize: 10.5, color: '#7f92a8', marginTop: 4 }}>
                {r.pct_open != null ? `${r.pct_open >= 0 ? '+' : ''}${r.pct_open.toFixed(0)}% vs open` : ''}
                {otm ? ` · ${otm.toFixed(1)}% OTM` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
