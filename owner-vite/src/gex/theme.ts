// Dashboard palette — ported from components/shared/homeTheme.ts + HomeClient C{}.
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
  border: 'rgba(255,255,255,0.10)',
}

// Ledger style: panels are no longer bento cards — transparent, borderless,
// separated by whitespace + hairline section rules instead of boxes.
export const panelStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  borderRadius: 0,
}

export const hairline = 'rgba(255,255,255,0.14)'
export const hairlineSoft = 'rgba(255,255,255,0.08)'

// Ledger section header — cyan uppercase label on a hairline underline.
export const ledgerHead: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
  flexShrink: 0, fontSize: 13, fontWeight: 800, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#219EBC',
  padding: '0 2px 8px', margin: '0 0 12px',
  borderBottom: `1px solid ${hairline}`,
}
