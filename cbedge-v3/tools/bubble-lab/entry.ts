// The lab's bundle entry.
//
// It re-exports the LIVE modules — not copies. That is the entire point of this
// tool: a mock renderer diverges from the app the moment either one is touched,
// and every "looks right in the mockup, wrong on the site" round trip this
// layer has cost came from exactly that gap. Anything you see in the contact
// sheet came out of the same `buildBubbleModel` / `drawBubbles` the card calls.
//
// BUBBLES is exported so the page can MUTATE it live. It is `as const` in
// TypeScript, which is a compile-time promise and not a runtime one — the
// emitted object is plain and writable, and every read happens per call, so a
// slider that writes `BUBBLES.topFrac` changes the next frame. When the numbers
// look right, "Copy constants" prints them in the shape settings.ts wants.
//
// This is the ONLY place they are adjustable. The card has no bubble settings —
// see the note on BUBBLES in settings.ts for why six sliders became none.

export { buildBubbleModel, drawBubbles } from '../../src/board/gexCandles/bubbles'
export type { BubbleSnapshot, BubbleGeometry, BubblePalette } from '../../src/board/gexCandles/bubbles'
export { BUBBLES, DEFAULT_SETTINGS } from '../../src/board/gexCandles/settings'
export { valueOf } from '../../src/board/gexCandles/gexHistory'
export type { GexColumn } from '../../src/board/gexCandles/gexHistory'
