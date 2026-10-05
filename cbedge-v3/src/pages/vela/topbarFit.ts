// ─────────────────────────────────────────────────────────────────────────────
// THE TOP BAR, FITTED TO THE WINDOW (desktop). Brandon, 2026-10-05, on a
// Chromebook: "if its a smaller monitor - there is no way to scroll right on the
// menu toolbar". Vela lays the bar out in one row and never wraps or scrolls it,
// so below about 1,250 px the right end (the session, the bell, Workspace, the
// camera) went off the edge, out of reach. Vela's own phone layout only starts
// below 640 px.
//
// Now the bar gives things up in this order until it fits, one step at a time,
// re-measured whenever the window or the bar's content changes:
//
//   1  the session's countdown             ● Pre-market  (no "opens in 2:09:34")
//   2  the words on Indicators, Replay and Workspace (their icons stay, and the
//      name shows on hover)
//   3  the starred timeframe chips but the current one (▾ still lists them all)
//   4  the ticker chip's price (its change stays) and the session chip
//   5  undo / redo (Ctrl+Z / Ctrl+Y still work)
//   6  and if it still does not fit, the bar scrolls sideways
//
// The steps are `data-cb-fit` on Vela's bar, read by vela.css. Loaded on the
// desktop only (Vela.tsx), as a chunk of its own once the chart is up.
// ─────────────────────────────────────────────────────────────────────────────

import type { VelaWorkspace } from '@luxalgo/vela/workspace'

const STEPS = 6

export function bindTopbarFit(ws: VelaWorkspace): () => void {
  const bar = ws.root.querySelector<HTMLElement>(':scope > .vela-widget-topbar')
  if (!bar) return () => {}

  // the buttons that lose their words at step 2 keep their name on hover
  const named = () => {
    for (const b of bar.querySelectorAll<HTMLElement>(
      '.vela-widget-action-pin > .vela-widget-action-left:not(.cb-sym-chip), .vela-widget-actions-left > .vela-widget-action-left, .vela-topbar-right .vela-widget-action-pin > .vela-widget-action:not(.cb-clk)',
    )) {
      const t = b.textContent?.trim()
      if (t && !b.title) b.title = t
    }
  }

  let frame = 0
  const fit = () => {
    frame = 0
    named()
    for (let step = 0; step <= STEPS; step++) {
      bar.dataset.cbFit = String(step)
      // the last step scrolls, so it always "fits"
      if (step === STEPS || bar.scrollWidth <= bar.clientWidth + 1) return
    }
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(fit)
  }

  const ro = new ResizeObserver(schedule)
  ro.observe(bar)
  // Vela re-renders its buttons (a symbol, a timeframe star, a layout); our chips
  // re-dress theirs. The session chip rewrites its countdown every second, which
  // barely moves its width (tabular figures): that alone is re-measured at most
  // every 10 s, so a new phase ("Pre-market" → "RTH") is still caught.
  let clockAt = 0
  const mo = new MutationObserver((recs) => {
    const inClock = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('.cb-clk') != null
    if (recs.some((r) => !inClock(r.target))) schedule()
    else if (Date.now() - clockAt > 10_000) {
      clockAt = Date.now()
      schedule()
    }
  })
  mo.observe(bar, { childList: true, subtree: true })
  fit()

  return () => {
    if (frame) cancelAnimationFrame(frame)
    ro.disconnect()
    mo.disconnect()
    delete bar.dataset.cbFit
  }
}
