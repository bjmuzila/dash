import { NavLink } from 'react-router-dom'
import { HOME_THEME as HT } from '@/components/shared/homeTheme'

// One in-SPA nav row linking every mounted route. react-router NavLink keeps
// navigation under /app (no full reload, warm socket preserved). Colors are
// sourced from HOME_THEME — nothing hardcoded.
const LINKS: { label: string; to: string }[] = [
  { label: 'Home', to: '/home' },
  { label: 'Traders Dashboard', to: '/traders-dashboard' },
  { label: 'Multi Greek', to: '/mult-greek' },
  { label: 'Options Chain', to: '/options-chain' },
  { label: 'Greeks', to: '/greeks' },
  { label: 'Estimated Moves', to: '/em' },
  { label: 'Flow', to: '/flow' },
  { label: 'ES Candles', to: '/es-candles' },
  { label: 'Scanner', to: '/scanner' },
  { label: 'ICT', to: '/ict' },
  { label: 'Test Lab', to: '/test' },
  { label: 'Confidence', to: '/confidence-score' },
  { label: 'Fails', to: '/fails' },
  { label: 'Premarket', to: '/premarket' },
  { label: 'Economic Calendar', to: '/economic-calendar' },
  { label: 'Analytics', to: '/analytics' },
  { label: 'Journal', to: '/trading' },
]

export default function Nav() {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: 46,
        flexShrink: 0,
        padding: '0 12px',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        background: HT.panel,
        borderBottom: `1px solid ${HT.border}`,
        fontFamily: "var(--font-inter), 'Inter', system-ui, sans-serif",
      }}
    >
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          style={({ isActive }) => ({
            flexShrink: 0,
            padding: '7px 13px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.01em',
            textDecoration: 'none',
            color: isActive ? HT.bg : HT.text,
            background: isActive ? HT.cyan : 'transparent',
            border: `1px solid ${isActive ? HT.cyan : 'transparent'}`,
            transition: 'background .15s, color .15s',
          })}
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}
