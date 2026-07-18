import { C } from './theme'

// Compact GEX toolbar — the controls that drive the bar chart. A lean port of
// GexToolbar.tsx: view switch, GEX mode, data basis, expiry, overlay toggles.
export type GexView = 'gex' | 'escandles'
export type GexMode = 'net' | 'call-put'
export type DataMode = 'oi-vol' | 'vol-only'

function Seg<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, border: '1px solid rgba(33,158,188,0.18)', borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '7px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            whiteSpace: 'nowrap', cursor: 'pointer', border: 'none', fontFamily: 'inherit',
            background: value === o.id ? 'rgba(33,158,188,0.16)' : 'transparent',
            color: value === o.id ? C.cyan : '#5a7a98',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, cursor: 'pointer',
        fontSize: 11, fontWeight: 700, fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '0.04em',
        border: `1px solid ${on ? 'rgba(33,158,188,0.5)' : C.border}`,
        background: on ? 'rgba(33,158,188,0.12)' : 'rgba(255,255,255,0.02)',
        color: on ? C.cyan : '#8a97ad',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: on ? C.cyan : '#3a4759' }} />
      {label}
    </button>
  )
}

export default function GexToolbar(props: {
  view: GexView; onView: (v: GexView) => void
  mode: GexMode; onMode: (v: GexMode) => void
  dataMode: DataMode; onDataMode: (v: DataMode) => void
  expirations: string[]; expiry: string; onExpiry: (v: string) => void
  showOI: boolean; showDex: boolean; showFlip: boolean
  onToggleOI: () => void; onToggleDex: () => void; onToggleFlip: () => void
  showGhost5: boolean; showGhost15: boolean; showGhost30: boolean
  onToggleGhost5: () => void; onToggleGhost15: () => void; onToggleGhost30: () => void
  onRefresh: () => void
  status: string
}) {
  const p = props
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px', flexWrap: 'wrap', flexShrink: 0 }}>
      <Seg options={[{ id: 'gex', label: 'GEX' }, { id: 'escandles', label: 'ES Candles' }]} value={p.view} onChange={p.onView} />
      <Seg options={[{ id: 'net', label: 'Net GEX' }, { id: 'call-put', label: 'Call–Put' }]} value={p.mode} onChange={p.onMode} />
      <Seg options={[{ id: 'oi-vol', label: 'OI+Vol' }, { id: 'vol-only', label: 'Vol Only' }]} value={p.dataMode} onChange={p.onDataMode} />
      <select
        value={p.expiry}
        onChange={(e) => p.onExpiry(e.target.value)}
        style={{ padding: '7px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', color: '#fff', border: `1px solid ${C.border}`, fontSize: 11, fontFamily: 'inherit', fontWeight: 700 }}
      >
        {p.expirations.length === 0 && <option value="">Expiry…</option>}
        {p.expirations.map((e) => <option key={e} value={e}>{e}</option>)}
      </select>
      <Toggle label="OI" on={p.showOI} onClick={p.onToggleOI} />
      <Toggle label="DEX" on={p.showDex} onClick={p.onToggleDex} />
      <Toggle label="Flip" on={p.showFlip} onClick={p.onToggleFlip} />
      <Toggle label="Ghost 5m" on={p.showGhost5} onClick={p.onToggleGhost5} />
      <Toggle label="15m" on={p.showGhost15} onClick={p.onToggleGhost15} />
      <Toggle label="30m" on={p.showGhost30} onClick={p.onToggleGhost30} />
      <button onClick={p.onRefresh} style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', color: C.cyan, background: 'rgba(33,158,188,0.10)', border: '1px solid rgba(33,158,188,0.35)' }}>↻ Now</button>
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', color: p.status === 'LIVE' ? C.green : C.orange }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: p.status === 'LIVE' ? C.green : C.orange, boxShadow: `0 0 8px ${p.status === 'LIVE' ? C.green : C.orange}` }} />
        {p.status}
      </span>
    </div>
  )
}
