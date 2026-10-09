// ─────────────────────────────────────────────────────────────────────────────
// VOLTICK'S LEVEL MARKS, DRAWN: ★ Volt · ◆ Coil · ↘ Reversal · ↯ Surge · ⚡ Flip.
//
// The same four marks Voltick uses (voltick-v3/src/voltboard/derive.ts
// MARK_GLYPH), drawn as 12×12 shapes instead of typed characters. Typed, Windows
// turned them into colour emoji: wider than the font's own glyphs, the wrong
// colour (the flip's ⚡ ignores its U+FE0E there), and wide enough to push the
// legend card's eye off the card (Brandon's screenshot, 2026-10-04). Drawn, they
// look and measure the same on every machine.
//
// Each mark takes its reserved colour from tokens.css through `.cb-mk[data-mk]`
// in vela.css; the shapes fill with currentColor, so a caller can override it.
//
// Used by the legend card (legend/legendCard.ts), the session strip on the
// phone (setups/SessionStrip.tsx) and the Level Alerts panel. Series TITLES
// (the CB Walls and GEX studies' "★ Volt", "⚡︎ Flip" in the data window) stay
// text: a title is a string, it has nowhere to put a shape.
// ─────────────────────────────────────────────────────────────────────────────

export type MarkKey = 'volt' | 'coil' | 'reversal' | 'surge' | 'flip'

const SHAPES: Record<MarkKey, string> = {
  // a five-point star, centred a touch low so it sits on the text's baseline
  volt: '<path fill="currentColor" d="M6 .85 7.32 4.53l3.91.12-3.09 2.4 1.09 3.75L6 8.6l-3.23 2.2 1.09-3.75-3.09-2.4 3.91-.12Z"/>',
  coil: '<path fill="currentColor" d="M6 .9 11.1 6 6 11.1.9 6Z"/>',
  reversal:
    '<path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" d="M2.4 2.4 9.3 9.3M9.5 4.1v5.4H4.1"/>',
  // ↯ a zig-zag bolt ending in an arrowhead, stroked so it never reads as the Flip's filled ⚡
  surge:
    '<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M7.6 1 4.2 5.6h3.6L5 10.6M3.2 8.4 5 10.6l2.4-1.5"/>',
  flip: '<path fill="currentColor" d="M7.4.5 1.9 7h3.5l-1 4.5L10.1 5H6.5Z"/>',
}

/** The mark as an SVG string (constant markup: safe for innerHTML). */
export function markSvg(key: MarkKey): string {
  return `<svg class="cb-mk" data-mk="${key}" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${SHAPES[key]}</svg>`
}

/** The mark as an element, wrapped in a span so it lines up as inline content. */
export function markEl(doc: Document, key: MarkKey): HTMLElement {
  const box = doc.createElement('span')
  box.className = 'cb-mk-box'
  box.innerHTML = markSvg(key)
  return box
}

export const isMarkKey = (k: string): k is MarkKey => k === 'volt' || k === 'coil' || k === 'reversal' || k === 'surge' || k === 'flip'
