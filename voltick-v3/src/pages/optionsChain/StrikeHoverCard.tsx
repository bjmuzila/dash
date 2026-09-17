// ─────────────────────────────────────────────────────────────────────────────
// STRIKE CARD — per-side volume, OI and net premium for one strike + expiration,
// plus the day-over-day net-GEX change where the movers feed has a baseline.
//
// Named "hover" in v2 and opened by a CLICK there too; the name is kept so the
// parity spec and the code use one word. Closes on outside pointer-down (
// deferred a tick so the opening click does not immediately close it) and on
// Escape.
//
// The DoD block is honest about its own coverage: /proxy/strike-dod returns ONE
// row per ticker, at the strike that moved most versus yesterday, so every other
// strike legitimately has no baseline and says so rather than printing a zero.
//
// Spec: docs/parity/options-chain.md — Part M.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { alpha, CHAIN, GEX_NEG, GEX_POS, SHADOW, T } from '@/design/theme'
import type { GreekCell } from './chainMath'
import { fmtExpHeader, fmtHoverInt, fmtHoverSigned, fmtHoverUsd } from './format'

const CALL_COLOR = GEX_POS
const PUT_COLOR = GEX_NEG

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, lineHeight: 1.6 }}>
      <span style={{ color: CHAIN.key }}>{k}</span>
      <span style={{ color: strong ? T.text : CHAIN.val, fontWeight: strong ? 800 : 600 }}>{v}</span>
    </div>
  )
}

function SideBlock({
  label,
  color,
  vol,
  oi,
  prem,
}: {
  label: string
  color: string
  vol: number
  oi: number
  prem: number
}) {
  return (
    <div
      style={{
        background: alpha(color, 0.06),
        border: `1px solid ${alpha(color, 0.28)}`,
        borderRadius: 8,
        padding: '7px 9px',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color, marginBottom: 5 }}>{label}</div>
      <Row k="Volume" v={fmtHoverInt(vol)} />
      <Row k="OI" v={fmtHoverInt(oi)} />
      <Row k="Net Prem" v={fmtHoverUsd(prem)} strong />
    </div>
  )
}

export function StrikeHoverCard({
  ticker,
  strike,
  expiration,
  cell,
  dod,
  x,
  y,
  onClose,
}: {
  ticker: string
  strike: number
  expiration: string
  cell: GreekCell
  dod: { netYest: number; netNow: number | null; delta: number } | null
  x: number
  y: number
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Deferred so the opening click does not immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(Math.max(8, x + 16), vw - 262)
  const top = Math.min(Math.max(8, y + 16), vh - 240)
  const netPrem = cell.callPrem - cell.putPrem

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={cardRef}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        width: 246,
        background: T.panel,
        border: `1px solid ${alpha(T.cyan, 0.3)}`,
        borderRadius: 12,
        padding: 13,
        boxShadow: `0 12px 40px ${alpha(SHADOW, 0.6)}`,
        fontFamily: 'var(--font-mono)',
        color: T.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 15, fontWeight: 800 }}>
          {ticker} {strike.toLocaleString()}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: T.muted }}>
          {fmtExpHeader(expiration)}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: T.muted,
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            padding: 0,
            marginLeft: 2,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <SideBlock label="CALLS" color={CALL_COLOR} vol={cell.callVol} oi={cell.callOI} prem={cell.callPrem} />
        <SideBlock label="PUTS" color={PUT_COLOR} vol={cell.putVol} oi={cell.putOI} prem={cell.putPrem} />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 9,
          paddingTop: 7,
          borderTop: `1px solid ${alpha(T.text, 0.08)}`,
          fontSize: 12,
        }}
      >
        <span style={{ color: T.muted }}>Net Prem (C−P)</span>
        <span style={{ fontWeight: 800, color: netPrem >= 0 ? CALL_COLOR : PUT_COLOR }}>{fmtHoverUsd(netPrem)}</span>
      </div>

      {/* Day-over-Day net-GEX change (the scanner's DoD Movers source). */}
      <div style={{ marginTop: 8, paddingTop: 7, borderTop: `1px solid ${alpha(T.text, 0.08)}` }}>
        {dod ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: T.muted }}>Δ GEX vs Yest</span>
              <span style={{ fontWeight: 800, color: dod.delta >= 0 ? CALL_COLOR : PUT_COLOR }}>
                {fmtHoverSigned(dod.delta)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3 }}>
              <span style={{ color: T.muted }}>Yest → Now</span>
              <span style={{ color: CHAIN.val, fontWeight: 600 }}>
                {fmtHoverSigned(dod.netYest)} → {dod.netNow == null ? '—' : fmtHoverSigned(dod.netNow)}
              </span>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
            <span style={{ color: T.muted }}>Δ GEX vs Yest</span>
            <span style={{ color: T.muted, opacity: 0.7 }}>— (top-mover strike only)</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
