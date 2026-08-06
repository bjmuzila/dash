/**
 * budget-vite theme — the CB Edge dark palette, copied rather than imported.
 *
 * WHY COPIED: this app is standalone by design (see vite.config.js). Aliasing
 * into components/shared/homeTheme.ts would couple every budget deploy to the
 * trading app's component tree. These values mirror homeTheme.ts + the deeper
 * surface tokens app/owner/budget/page.tsx defines locally, so the ported
 * budget UI lands looking identical.
 *
 * If you change a colour in homeTheme.ts and want it here, change it here too.
 */

export const T = {
  // Base palette — mirrors components/shared/homeTheme.ts
  cyan: '#219EBC',
  purple: '#126783',
  orange: '#FB8501',
  green: '#8ECAE6',
  red: '#EF4444',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.60)',
  border: 'rgba(255,255,255,0.10)',

  // Elevated dark surface set — mirrors the budget page's local tokens so the
  // ported UI needs no restyling.
  ink: '#020308',        // page background — near-black
  panel: '#0B101B',      // solid card fill — lifted off the ink
  hairline: 'rgba(255,255,255,0.16)',
  edgeLight: 'inset 0 1px 0 rgba(255,255,255,0.12)',

  accent: '#7dd3fc',     // the budget page's selection/link blue
} as const;

export const CARD_SHADOW =
  `${T.edgeLight}, 0 2px 4px rgba(0,0,0,0.6), 0 24px 60px -16px rgba(0,0,0,0.75)`;

export const SHELL_GLOW =
  'radial-gradient(1100px 520px at 12% -10%, rgba(33,158,188,0.13) 0%, transparent 60%), ' +
  'radial-gradient(900px 460px at 88% 6%, rgba(125,211,252,0.09) 0%, transparent 55%)';

export const FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

/** Card surface. Solid, not translucent — matches the budget page. */
export const card = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  background: T.panel,
  border: `1px solid ${T.hairline}`,
  borderRadius: 16,
  boxShadow: CARD_SHADOW,
  padding: 16,
  ...extra,
});

/** The small all-caps label used above every value on the budget page. */
export const labelCap = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: T.muted,
  ...extra,
});

export const button = (variant: 'primary' | 'ghost' = 'primary'): React.CSSProperties => ({
  appearance: 'none',
  border: variant === 'primary' ? `1px solid ${T.cyan}` : `1px solid ${T.hairline}`,
  background: variant === 'primary' ? 'rgba(33,158,188,0.18)' : 'transparent',
  color: T.text,
  borderRadius: 12,
  // 46px min-height: below ~44px a target is genuinely hard to hit on a phone.
  minHeight: 46,
  padding: '12px 18px',
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  fontFamily: FONT,
});

export const input = (): React.CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${T.hairline}`,
  borderRadius: 12,
  color: T.text,
  minHeight: 46,
  padding: '12px 14px',
  // 16px exactly: iOS Safari zooms the whole page when a focused input's font
  // is smaller than that. Do not lower it.
  fontSize: 16,
  fontFamily: FONT,
  outline: 'none',
});
