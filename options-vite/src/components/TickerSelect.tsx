import { useEffect, useRef, useState } from 'react'
import { C, hairline, hairlineSoft } from '../theme'
import { TICKER_LISTS, type TickerList } from '../data/tickers'
import { useTicker } from '../TickerContext'

const LIST_KEYS = Object.keys(TICKER_LISTS) as TickerList[]

// Main ticker dropdown. Inside it, top-left, is a second small dropdown that
// switches which list you're picking from (Favorites / Watchlist).
export default function TickerSelect() {
  const { ticker, name, list, setTicker, setList } = useTicker()
  const [open, setOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [q, setQ] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setListOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setListOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = TICKER_LISTS[list].items.filter((t) => {
    const s = q.trim().toUpperCase()
    if (!s) return true
    return t.symbol.includes(s) || t.name.toUpperCase().includes(s)
  })

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '10px 14px',
          background: 'rgba(10,13,20,0.9)',
          border: `1px solid ${open ? C.cyan : C.border}`,
          borderRadius: 8,
          color: C.text,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: C.cyan,
          }}
        >
          {ticker}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 10, color: C.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 40,
            top: 'calc(100% + 6px)',
            left: 0,
            width: '100%',
            background: 'rgba(8,11,17,0.98)',
            border: `1px solid ${hairline}`,
            borderRadius: 8,
            boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
            overflow: 'visible',
          }}
        >
          {/* top-left sub-dropdown: which list */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: `1px solid ${hairlineSoft}` }}>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setListOpen((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: 'rgba(33,158,188,0.12)',
                  border: `1px solid ${C.cyan}`,
                  borderRadius: 6,
                  color: C.cyan,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {TICKER_LISTS[list].label}
                <span style={{ fontSize: 8 }}>▼</span>
              </button>
              {listOpen && (
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 50,
                    top: 'calc(100% + 4px)',
                    left: 0,
                    minWidth: 150,
                    background: 'rgba(8,11,17,0.99)',
                    border: `1px solid ${hairline}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  {LIST_KEYS.map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setList(k)
                        setListOpen(false)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '8px 12px',
                        background: k === list ? 'rgba(33,158,188,0.14)' : 'none',
                        border: 'none',
                        borderBottom: `1px solid ${hairlineSoft}`,
                        color: k === list ? C.cyan : C.text,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      {TICKER_LISTS[k].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1,
                minWidth: 0,
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                color: C.text,
                fontSize: 12,
                outline: 'none',
              }}
            />
          </div>

          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {items.length === 0 && (
              <div style={{ padding: '14px', fontSize: 12, color: C.muted }}>No matches in {TICKER_LISTS[list].label}.</div>
            )}
            {items.map((t) => (
              <button
                key={t.symbol}
                onClick={() => {
                  setTicker(t.symbol)
                  setOpen(false)
                  setListOpen(false)
                  setQ('')
                }}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  width: '100%',
                  padding: '9px 14px',
                  background: t.symbol === ticker ? 'rgba(33,158,188,0.12)' : 'none',
                  border: 'none',
                  borderBottom: `1px solid ${hairlineSoft}`,
                  color: C.text,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    color: t.symbol === ticker ? C.cyan : C.text,
                    minWidth: 54,
                  }}
                >
                  {t.symbol}
                </span>
                <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
