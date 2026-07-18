import { useEffect, useRef, useState } from 'react'
import { C } from './theme'

// Universal toolbar for home3 — mirrors components/shared/GlobalToolbar.tsx:
// a floating blue→teal gradient pill with a cursor-follow cyan highlight, round
// icon buttons, a hamburger→NavMenu dropdown, a drag-reorder icon nav strip,
// live quote pills, an ET clock, and a right-side actions cluster.
const cyanA = (a: number) => `rgba(33,158,188,${a})`
const blueA = (a: number) => `rgba(59,130,246,${a})`

// Same routes as GlobalToolbar's NAV_ITEMS — absolute paths resolve to the
// cbedge.net pages when home3 is served same-origin.
type NavItem = { href: string; label: string; emoji: string }
const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Home', emoji: '🏠' },
  { href: '/mult-greek', label: 'Multi Greek', emoji: '🧮' },
  { href: '/traders-dashboard', label: 'Traders Dash', emoji: '📊' },
  { href: '/options-chain', label: 'Options Chain', emoji: '⛓️' },
  { href: '/em', label: 'Est. Moves', emoji: '↔️' },
  { href: '/analytics', label: 'Analytics', emoji: '📈' },
  { href: '/flow', label: 'Flow', emoji: '🌊' },
  { href: '/es-candles', label: 'ES Candles', emoji: '🕯️' },
  { href: '/scanner', label: 'Scanner', emoji: '🔍' },
  { href: '/ict', label: 'ICT', emoji: '🎯' },
  { href: '/test', label: 'Test Lab', emoji: '⚗️' },
  { href: '/whats-new', label: "What's New", emoji: '✨' },
  { href: '/trading', label: 'Journal', emoji: '📓' },
]
const NAV_ORDER_KEY = 'cb-home3-toolbar-nav-order-v1'
const NAV_ITEM_W = 44
const NAV_GAP = 6
const NAV_RESERVED_PX = 760

function useClockET() {
  const [t, setT] = useState('--:--:--')
  useEffect(() => {
    const tick = () => setT(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }))
    tick(); const id = setInterval(tick, 1000); return () => clearInterval(id)
  }, [])
  return t
}

function useNavCapacity() {
  const [cap, setCap] = useState(0)
  useEffect(() => {
    const apply = () => setCap(Math.max(0, Math.floor((window.innerWidth - NAV_RESERVED_PX + NAV_GAP) / (NAV_ITEM_W + NAV_GAP))))
    apply(); window.addEventListener('resize', apply); return () => window.removeEventListener('resize', apply)
  }, [])
  return cap
}

function MenuIcon() {
  return <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
}

function RoundBtn({ children, active, title, onClick, pulse }: { children: React.ReactNode; active?: boolean; title: string; onClick?: () => void; pulse?: boolean }) {
  const [hover, setHover] = useState(false)
  const on = active || hover
  return (
    <button
      title={title} aria-label={title} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 38, height: 38, flexShrink: 0, borderRadius: '50%', cursor: 'pointer',
        border: `1px solid ${on ? cyanA(0.5) : 'transparent'}`,
        background: on ? cyanA(0.12) : 'rgba(255,255,255,0.04)',
        color: on ? C.cyan : '#e8edf5',
        boxShadow: hover ? `0 4px 12px -2px ${cyanA(0.45)}` : 'none',
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'background .14s, border-color .14s, color .14s, box-shadow .14s, transform .14s',
      }}
    >
      {children}
      {pulse && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: 999, background: C.orange, boxShadow: `0 0 8px ${C.orange}` }} />}
    </button>
  )
}

function QuotePill({ sym, price, chg, pct, digits = 2 }: { sym: string; price: number; chg: number; pct: number; digits?: number }) {
  const has = price > 0
  const pos = chg >= 0
  const col = !has ? '#5a6b85' : pos ? C.green : C.red
  return (
    <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}`, whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#cdd8e6', letterSpacing: '0.04em' }}>{sym}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: '#fff' }}>{has ? price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—'}</span>
      {has && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, color: col }}>{pos ? '+' : ''}{pct.toFixed(2)}%</span>}
    </div>
  )
}

function NavStrip() {
  const [order, setOrder] = useState<string[]>(() => NAV_ITEMS.map((i) => i.href))
  const [dragId, setDragId] = useState<string | null>(null)
  const capacity = useNavCapacity()
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_ORDER_KEY)
      const saved: unknown = raw ? JSON.parse(raw) : null
      if (!Array.isArray(saved)) return
      const known = new Set(NAV_ITEMS.map((i) => i.href))
      const kept = saved.filter((h): h is string => typeof h === 'string' && known.has(h))
      const missing = NAV_ITEMS.map((i) => i.href).filter((h) => !kept.includes(h))
      const next = [...kept, ...missing]
      if (next.join() !== NAV_ITEMS.map((i) => i.href).join()) setOrder(next)
    } catch { /* keep default */ }
  }, [])
  const persist = (next: string[]) => { setOrder(next); try { localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next)) } catch { /* ignore */ } }
  const drop = (target: string) => {
    const src = dragId; setDragId(null)
    if (!src || src === target) return
    const from = order.indexOf(src), to = order.indexOf(target)
    if (from < 0 || to < 0) return
    const next = [...order]; next.splice(from, 1); next.splice(to, 0, src); persist(next)
  }
  const items = order.map((h) => NAV_ITEMS.find((i) => i.href === h)).filter((i): i is NavItem => !!i).slice(0, capacity)
  if (!items.length) return null
  return (
    <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: NAV_GAP, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
      {items.map((it) => (
        <a
          key={it.href} href={it.href} title={it.label}
          draggable
          onDragStart={(e) => { setDragId(it.href); e.dataTransfer.effectAllowed = 'move' }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
          onDrop={(e) => { e.preventDefault(); drop(it.href) }}
          onDragEnd={() => setDragId(null)}
          style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: NAV_ITEM_W, textDecoration: 'none', flexShrink: 0, opacity: dragId === it.href ? 0.4 : 1, cursor: 'pointer' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: `1px solid ${cyanA(0.3)}`, background: 'rgba(255,255,255,0.04)', fontSize: 15, lineHeight: 1 }}>{it.emoji}</span>
          <span style={{ fontSize: 8, fontWeight: 600, color: '#e8edf5', opacity: 0.8, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: NAV_ITEM_W }}>{it.label}</span>
        </a>
      ))}
    </div>
  )
}

export type ToolbarQuotes = {
  esFut: number; esPrev: number
  spx: number; spxChg: number; spxPct: number
  vix: number; vixPrev: number
  status: string
}

export default function Toolbar({ quotes, onRefresh }: { quotes: ToolbarQuotes; onRefresh?: () => void }) {
  const clock = useClockET()
  const pillRef = useRef<HTMLDivElement | null>(null)
  const [glow, setGlow] = useState<{ x: number; y: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const h = (e: MouseEvent) => { if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [menuOpen])

  const esChg = quotes.esFut > 0 && quotes.esPrev > 0 ? quotes.esFut - quotes.esPrev : 0
  const esPct = quotes.esFut > 0 && quotes.esPrev > 0 ? (esChg / quotes.esPrev) * 100 : 0
  const vixChg = quotes.vix > 0 && quotes.vixPrev > 0 ? quotes.vix - quotes.vixPrev : 0
  const vixPct = quotes.vix > 0 && quotes.vixPrev > 0 ? (vixChg / quotes.vixPrev) * 100 : 0

  const doRefresh = () => { setSpinning(true); onRefresh?.(); setTimeout(() => setSpinning(false), 700) }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0, padding: '8px 14px', zIndex: 50, position: 'relative' }}>
      <style>{`@keyframes tb-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: '100%', borderRadius: 999, padding: 1.5, background: `linear-gradient(110deg, ${cyanA(0.55)}, ${blueA(0.4)} 35%, ${cyanA(0.15)} 60%, ${cyanA(0.55)})`, boxShadow: `0 14px 34px -14px rgba(0,0,0,0.8), 0 0 18px -6px ${cyanA(0.4)}` }}>
        <div
          ref={pillRef}
          onMouseMove={(e) => { const r = pillRef.current?.getBoundingClientRect(); if (r) setGlow({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
          onMouseLeave={() => setGlow(null)}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.2vw, 16px)', height: 56, padding: '0 16px', borderRadius: 998, minWidth: 0, background: 'rgba(10,13,20,0.96)', backdropFilter: 'blur(16px)', boxSizing: 'border-box' }}
        >
          <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 998, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
            <span style={{ position: 'absolute', inset: 0, opacity: glow ? 1 : 0, transition: 'opacity .25s', background: glow ? `radial-gradient(170px circle at ${glow.x}px ${glow.y}px, ${cyanA(0.2)}, transparent 70%)` : 'none' }} />
          </span>

          {/* Hamburger → NavMenu dropdown */}
          <div ref={menuWrapRef} style={{ position: 'relative', zIndex: 2, display: 'flex' }}>
            <RoundBtn title="Menu" active={menuOpen} onClick={() => setMenuOpen((v) => !v)}><MenuIcon /></RoundBtn>
            {menuOpen && (
              <div style={{ position: 'absolute', top: 46, left: 0, minWidth: 210, padding: 6, borderRadius: 14, zIndex: 60, background: `radial-gradient(circle at 50% 0%, ${cyanA(0.07)} 0%, transparent 55%), rgba(10,13,20,0.98)`, border: `1px solid ${cyanA(0.2)}`, boxShadow: '0 20px 44px -14px rgba(0,0,0,0.75)' }}>
                <div style={{ height: 2, borderRadius: 2, margin: '2px 6px 6px', background: `linear-gradient(90deg, transparent, ${cyanA(0.9)}, transparent)` }} />
                {NAV_ITEMS.map((it) => (
                  <a key={it.href} href={it.href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, textDecoration: 'none', color: '#e8edf5', fontSize: 13, fontWeight: 600 }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = cyanA(0.1) }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    <span style={{ fontSize: 15 }}>{it.emoji}</span>{it.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Logo */}
          <a href="/home" style={{ position: 'relative', zIndex: 1, display: 'flex', flexShrink: 0 }}>
            <img src="/cb-edge-logo.png" alt="CB Edge" style={{ height: 40, width: 'auto', display: 'block' }} />
          </a>

          {/* Icon nav strip (drag-reorder, capacity-based) */}
          <NavStrip />

          <div style={{ flex: 1, minWidth: 8 }} />

          {/* Live quote pills */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0, overflow: 'hidden' }}>
            <QuotePill sym="ESU" price={quotes.esFut} chg={esChg} pct={esPct} />
            <QuotePill sym="SPX" price={quotes.spx} chg={quotes.spxChg} pct={quotes.spxPct} />
            <QuotePill sym="VIX" price={quotes.vix} chg={vixChg} pct={vixPct} />
          </div>

          <span style={{ width: 1, height: 24, background: C.border, flexShrink: 0, zIndex: 1 }} />

          {/* ET clock */}
          <span style={{ position: 'relative', zIndex: 1, flexShrink: 0, fontSize: 18, fontWeight: 800, color: '#e8edf5', fontVariantNumeric: 'tabular-nums', letterSpacing: '.05em', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
            {clock}<span style={{ fontSize: 11, opacity: 0.55, marginLeft: 5 }}>ET</span>
          </span>

          {/* Actions cluster */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <RoundBtn title="Refresh" onClick={doRefresh}>
              <span style={{ display: 'inline-flex', animation: spinning ? 'tb-spin .7s linear' : 'none' }}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              </span>
            </RoundBtn>
            <RoundBtn title="Alerts" pulse>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            </RoundBtn>
            <RoundBtn title="Settings">
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </RoundBtn>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: quotes.status === 'LIVE' ? C.green : C.orange }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: quotes.status === 'LIVE' ? C.green : C.orange, boxShadow: `0 0 8px ${quotes.status === 'LIVE' ? C.green : C.orange}` }} />
              {quotes.status}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
