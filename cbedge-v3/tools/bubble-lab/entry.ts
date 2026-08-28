// The lab's bundle entry.
//
// It re-exports the LIVE modules — not copies. That is the entire point of this
// tool: a mock renderer diverges from the app the moment either one is touched,
// and every "looks right in the mockup, wrong on the site" round trip this
// layer has cost came from exactly that gap. Anything you see in the contact
// sheet came out of the same `buildBubbleModel` / `drawBubbles` the card calls.
//
// BUBBLE_AUTO and BUBBLE_STYLE are exported so the page can MUTATE them live.
// They are `as const` in TypeScript, which is a compile-time promise and not a
// runtime one — the emitted objects are plain and writable, and the auto
// helpers read their fields on every call, so a slider that writes
// `BUBBLE_AUTO.topFrac` changes the next frame. When the numbers look right,
// "Copy constants" prints them in the shape settings.ts wants them pasted.

export { buildBubbleModel, drawBubbles } from '../../src/board/gexCandles/bubbles'
export type { BubbleSnapshot, BubbleGeometry, BubblePalette } from '../../src/board/gexCandles/bubbles'
export { BUBBLE_AUTO, BUBBLE_STYLE, DEFAULT_SETTINGS } from '../../src/board/gexCandles/settings'
export { valueOf } from '../../src/board/gexCandles/gexHistory'
export type { GexColumn } from '../../src/board/gexCandles/gexHistory'
