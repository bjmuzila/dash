// ─────────────────────────────────────────────────────────────────────────────
// GEX Candles — redraw-guard check.
//
// The rAF loop in src/board/gexCandles/chart.ts only repaints when the VIEW
// MOVED. This asserts both halves of that: quiet when nothing happens, and
// still painting when the user pans or zooms. A guard that suppresses
// everything passes the first half and ruins the card.
//
// Two traps this script exists to avoid, both of which produced a confident
// wrong answer while it was being written:
//   1. document.querySelector('canvas') is lightweight-charts' OWN canvas.
//      The bubble overlay is the one with inline pointerEvents:none. Hook the
//      wrong one and the guard "works" while doing nothing.
//   2. The overlay must be checked for INK before anything is measured. An
//      empty overlay is quiet under every condition, so a run that starts
//      before the history fetch lands reports zero redraws everywhere and
//      looks like a catastrophic regression.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright'

const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const violations = []
const errs = []
p.on('pageerror', (e) => errs.push(String(e)))
p.on('console', (m) => {
  const t = m.text()
  if (/Violation/i.test(t)) violations.push(t)
  else if (m.type() === 'error') errs.push(t)
})
p.on('response', (r) => { if (r.status() === 404) errs.push(`404 ${r.url()}`) })

await p.goto('http://localhost:4310/v3/', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.setItem('cb-v3-board-layout', JSON.stringify([{ id: 'gex-candles', x: 0, y: 0, w: 12, h: 14 }]))
  localStorage.setItem('cb-v3-page-symbol', 'SPX')
})
await p.reload({ waitUntil: 'networkidle' })

// Wait for the overlay to actually have bubbles on it, rather than for a clock.
const ready = await p
  .waitForFunction(() => {
    const o = [...document.querySelectorAll('canvas')].find((c) => c.style.pointerEvents === 'none')
    if (!o) return false
    const d = o.getContext('2d').getImageData(0, 0, o.width, o.height).data
    let lit = 0
    for (let i = 3; i < d.length; i += 4) if (d[i]) { lit++; if (lit > 500) return true }
    return false
  }, null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
if (!ready) { console.log('ABORT — the bubble overlay never drew; nothing to measure'); await b.close(); process.exit(1) }

await p.evaluate(() => {
  const o = [...document.querySelectorAll('canvas')].find((c) => c.style.pointerEvents === 'none')
  const ctx = o.getContext('2d')
  const orig = ctx.clearRect.bind(ctx)
  window.__paint = 0
  window.__frames = 0
  ctx.clearRect = (...a) => { window.__paint++; return orig(...a) }
  const tick = () => { window.__frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
})

const box = await p.locator('canvas').first().boundingBox()
const run = async (label, during) => {
  await p.evaluate(() => { window.__paint = 0; window.__frames = 0 })
  await during()
  const r = await p.evaluate(() => ({ paint: window.__paint, frames: window.__frames }))
  console.log(`${label.padEnd(26)} ${String(r.paint).padStart(4)} redraws / ${String(r.frames).padStart(4)} frames`)
  return r.paint
}

// Not zero: the live spot moves the forming bar, which nudges autoscale, which
// genuinely moves the price mapping the rail is pinned to. The guard's job is
// to cut the per-FRAME repaint down to the handful of frames where something
// actually changed — measured against the frame count, not against zero.
const idleFrames = 120
const idle = await run('idle, no input', () => p.waitForTimeout(2000))
const panned = await run('panning', async () => {
  await p.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2)
  await p.mouse.down()
  for (let i = 0; i < 30; i++) { await p.mouse.move(box.x + box.width * 0.6 - i * 8, box.y + box.height / 2); await p.waitForTimeout(25) }
  await p.mouse.up()
  await p.waitForTimeout(200)
})
const zoomed = await run('zooming (wheel)', async () => {
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
  for (let i = 0; i < 15; i++) { await p.mouse.wheel(0, i % 2 ? 120 : -120); await p.waitForTimeout(50) }
  await p.waitForTimeout(200)
})

const longTasks = await p.evaluate(() => new Promise((resolve) => {
  const seen = []
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) seen.push(Math.round(e.duration)) })
  try { po.observe({ entryTypes: ['longtask'] }) } catch { resolve('unsupported'); return }
  setTimeout(() => { po.disconnect(); resolve(seen) }, 4000)
}))

console.log('')
const ok = (n, v) => console.log(`${n.padEnd(24)}: ${v ? 'PASS' : 'FAIL'}`)
ok('idle is quiet', idle <= idleFrames * 0.15)
ok('pan still redraws', panned > 10)
ok('zoom still redraws', zoomed > 5)
console.log('idle long tasks (>50ms) :', JSON.stringify(longTasks))
console.log('violations              :', violations.length ? violations.join('\n  ') : 'none')
console.log('errors / 404s           :', errs.length ? errs.join('\n  ') : 'none')
await b.close()
