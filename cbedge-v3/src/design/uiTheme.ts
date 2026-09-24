import { useCallback, useState } from 'react'
import { clearTokenCache } from '@/design/theme'

// ─────────────────────────────────────────────────────────────────────────────
// UI THEME — CB Edge (default) or Voltick. OWNER-ONLY.
//
// The whole switch is ONE attribute on <html>: `data-ui-theme="voltick"`.
// tokens.css redefines the --color-* / --font-* / --radius-* custom properties
// under that selector, so every utility (bg-surface, text-fg, border-line…)
// and every `var(--color-…)` string from theme.ts follows with no per-page
// work. Remove the attribute and the board is CB Edge again.
//
// Persisted per browser. Applied in main.tsx BEFORE the first render so a
// reload does not flash the CB palette first. Canvas charts resolve their
// palette at mount (see tokenRgb() in theme.ts), so flipping the switch
// reloads the page — that is what makes every chart repaint in the new
// colours instead of carrying the old ones until something remounts it.
//
// CHROME, NOT A GATE: the toggle is drawn only for the owner (BoardPage), and
// <UiThemeGuard/> in Shell.tsx drops a stored Voltick preference for any
// signed-in account that is not the owner. Nothing here is sensitive.
// ─────────────────────────────────────────────────────────────────────────────

export type UiTheme = 'cbedge' | 'voltick'

const KEY = 'cb-v3-ui-theme'
const ATTR = 'data-ui-theme'

export function readUiTheme(): UiTheme {
  try {
    return localStorage.getItem(KEY) === 'voltick' ? 'voltick' : 'cbedge'
  } catch {
    return 'cbedge'
  }
}

export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (theme === 'voltick') el.setAttribute(ATTR, 'voltick')
  else el.removeAttribute(ATTR)
  clearTokenCache()
}

export function setUiTheme(theme: UiTheme, opts: { reload?: boolean } = {}): void {
  try {
    if (theme === 'voltick') localStorage.setItem(KEY, 'voltick')
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: the attribute still flips for this tab */
  }
  applyUiTheme(theme)
  if (opts.reload) window.location.reload()
}

/** Called once from main.tsx, before render. */
export function bootUiTheme(): void {
  applyUiTheme(readUiTheme())
}

export function useUiTheme(): { theme: UiTheme; toggle: () => void } {
  const [theme] = useState<UiTheme>(readUiTheme)
  const toggle = useCallback(() => {
    setUiTheme(theme === 'voltick' ? 'cbedge' : 'voltick', { reload: true })
  }, [theme])
  return { theme, toggle }
}
