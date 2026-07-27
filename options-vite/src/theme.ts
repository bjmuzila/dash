// Palette ported from home3-vite/src/dashboard/theme.ts so this app matches the
// rest of CB Edge. Do not hardcode colors in components — pull from here.
import type { CSSProperties } from 'react'

export const C = {
  bg: '#05060A',
  panel: 'rgba(13,17,25,0.85)',
  cyan: '#219EBC',
  purple: '#126783',
  orange: '#FB8501',
  green: '#8ECAE6',
  red: '#EF4444',
  posBar: '#29B6F6',
  negBar: '#F5A623',
  text: '#fff',
  muted: '#9fb0c3',
  border: 'rgba(255,255,255,0.10)',
}

export const hairline = 'rgba(255,255,255,0.14)'
export const hairlineSoft = 'rgba(255,255,255,0.08)'

export const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  width: '100%',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  overflow: 'hidden',
}

// Cyan uppercase section label on a hairline underline.
export const cardHead: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 10,
  flexShrink: 0,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: C.cyan,
  padding: '10px 14px',
  borderBottom: `1px solid ${hairline}`,
}
