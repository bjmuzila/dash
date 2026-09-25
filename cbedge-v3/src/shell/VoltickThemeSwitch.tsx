import { useUiTheme } from '@/design/uiTheme'

// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK THEME SWITCH — owner only, in the SHELL toolbar on every page.
//
// Flips the whole UI between the CB Edge and Voltick palettes: one attribute on
// <html>, values in tokens.css, a reload so canvas charts repaint. Pages that
// have no Voltick-specific drawing simply pick up the palette (or nothing) —
// the switch is here regardless. See design/uiTheme.ts. Moved out of
// BoardPage's ToolbarSlot so it is no longer home-board-only.
// ─────────────────────────────────────────────────────────────────────────────

/** Owner-only toolbar switch: CB Edge ⇄ Voltick palette. */
export function VoltickThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useUiTheme()
  const on = theme === 'voltick'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Voltick theme"
      onClick={toggle}
      title={on ? 'Voltick theme is on (owner only). Click to go back to CB Edge.' : 'Switch the UI to the Voltick theme (owner only).'}
      className={[
        // Phone toolbar: the pill alone, no word — the bar is 390px wide.
        compact
          ? 'flex shrink-0 items-center rounded-sm border px-1.5 py-1 transition-colors'
          : 'flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-medium transition-colors',
        on ? 'border-accent bg-raised text-fg' : 'border-line bg-surface text-muted hover:bg-raised hover:text-fg',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={['relative inline-block h-3 w-6 rounded-full border transition-colors', on ? 'border-accent bg-accent' : 'border-line bg-surface2'].join(' ')}
      >
        <span
          className={['absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-fg transition-all', on ? 'left-3.5' : 'left-0.5'].join(' ')}
        />
      </span>
      {!compact && 'Voltick'}
    </button>
  )
}
