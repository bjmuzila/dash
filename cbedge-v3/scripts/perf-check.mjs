#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// The redraw guard — per card, on a board with EVERY card on it.
//
// This is the generalized descendant of the one-off perf.mjs that only ever
// measured GEX Candles, only against a board someone had already arranged by
// hand, and only when a human remembered to type `node perf.mjs`. It is now
// part of `npm run check`, because a guard nobody runs is a guard that is not
// there — the same reason budgets live in a script and not in a habit.
//
// WHAT IT MEASURES
// Repaints per animation frame, on every canvas v3 owns (the ones tagged
// `data-cb-layer`), attributed to a board card through `data-card-id`. Multiple
// draw calls inside one frame count as ONE repaint, which is the number that
// actually matters — how many primitive ops a renderer makes per pass is its
// own business and varies wildly between them.
//
// THREE ASSERTIONS, and all three are load-bearing:
//
//   1. An ON-SCREEN card is quiet while nothing is happening.
//      Not zero: the live spot moves the forming bar, which autoscales the
//      pane, which genuinely moves the price mapping the bubble layer is
//      pinned to. The budget is a fraction of the frame count.
//
//   2. An OFF-SCREEN card does not paint AT ALL.
//      This is the ChartFrame visibility gate. A board is one main thread and
//      one animation frame shared by every card on it, and cards below the
//      fold are, between them, most of that budget if nothing stops them.
//
//   3. A card being PANNED and ZOOMED still repaints.
//      Without this the other two are trivially satisfied by a renderer that
//      draws nothing, which is a far worse bug than the one being guarded
//      against and looks identical in every other measurement.
//
// TWO TRAPS, inherited from perf.mjs, both of which produced a confident wrong
// answer while it was being written:
//
//   1. HOOK THE RIGHT CANVAS. lightweight-charts owns canvases of its own and
//      repaints them on every tick. Folding those into the number buries the
//      guard. perf.mjs found the right one by probing for
//      `style.pointerEvents === 'none'`; the layers now tag themselves with
//      `data-cb-layer` instead, so this cannot silently measure nothing.
//   2. CHECK FOR INK BEFORE MEASURING. A card that never drew is quiet under
//      every condition, so a run that starts before the history fetch lands
//      reports zero everywhere and reads as a spectacular pass. Every card is
//      scrolled through and confirmed to have painted at least once before any
//      budget is applied; one that never paints is reported as NOT MEASURED,
//      never as a pass.
//
// Run:  npm run perf     (or: node scripts/perf-check.mjs)
// Needs dist/ — `npm run check` builds first. Requires a chromium available to
// playwright, same as scripts/ws-scope-check.mjs.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
// Its own port, not ws-scope-check's: `npm run check` runs them back to back
// and a lingering server from the previous step must not be mistaken for this
// one's.
const PORT = 4312

const budgets = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'))
const PERF = {
  idleRepaintsPerFrame: 0.15,
  offscreenRepaints: 0,
  interactionRepaints: 10,
  ...(budgets.perf ?? {}),
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\ndist/ not found — run `npm run build:fast` first (npm run check does)\n')
  process.exit(1)
}

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('playwright not found — `npm i -D playwright` to run this check')
  process.exit(2)
}

// ── process plumbing, same shape as ws-scope-check ───────────────────────────

const procs = []
function run(cmd, args) {
  const p = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })
  procs.push(p)
  return p
}
function cleanup() {
  for (const p of procs) {
    try {
      // Windows has no real SIGTERM, and for a shell:true spawn the signal
      // reaches cmd.exe while the process underneath survives to squat on the
      // port until the next run fails with EADDRINUSE. taskkill /T ends the
      // tree. (Same note as ws-scope-check.mjs — same reason.)
      if (process.platform === 'win32' && p.pid) {
        spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        p.kill('SIGTERM')
      }
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

async function waitForPort(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url)
      return true
    } catch {
      await sleep(250)
    }
  }
  return false
}

const failures = []
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    failures.push(msg)
  }
}

// ── the page-side instrumentation ────────────────────────────────────────────
//
// Installed with addInitScript so the prototype patch is in place before the
// bundle runs — a card that creates its canvas during boot must not escape it.
const INSTRUMENT = `
;(() => {
  const counts = new WeakMap()
  const seen = []
  let frame = 0
  const tick = () => { frame++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)

  // One repaint per canvas per animation frame. A renderer that makes forty
  // fillRect calls per pass and one that makes two both count as 1 — the
  // question this answers is "did this layer repaint this frame", not "how
  // chatty is its drawing code".
  const note = (canvas) => {
    if (!canvas || canvas.dataset.cbLayer === undefined) return
    let rec = counts.get(canvas)
    if (!rec) { rec = { window: 0, ever: 0, lastFrame: -1 }; counts.set(canvas, rec); seen.push(canvas) }
    if (rec.lastFrame === frame) return
    rec.lastFrame = frame
    rec.window++
    rec.ever++
  }

  const proto = CanvasRenderingContext2D.prototype
  // Every repaint in this app starts with one of these: setTransform (the dpr
  // transform re-applied after sizing) or clearRect (the overlay wipe).
  for (const name of ['setTransform', 'clearRect']) {
    const orig = proto[name]
    if (typeof orig !== 'function') continue
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function (...args) { note(this.canvas); return orig.apply(this, args) },
    })
  }

  let frame0 = 0
  window.__cbPerf = {
    reset() { frame0 = frame; for (const c of seen) counts.get(c).window = 0 },
    read() {
      return {
        frames: frame - frame0,
        layers: seen.map((c) => {
          const tile = c.closest('[data-card-id]')
          const chartFrame = c.closest('[data-visible]')
          return {
            card: tile ? tile.getAttribute('data-card-id') : 'unattached',
            layer: c.dataset.cbLayer,
            repaints: counts.get(c).window,
            everPainted: counts.get(c).ever > 0,
            visible: chartFrame ? chartFrame.getAttribute('data-visible') === '1' : null,
          }
        }),
      }
    },
  }
})()
`

// ── boot ─────────────────────────────────────────────────────────────────────

run('node', [join(ROOT, 'scripts/mock-server.mjs'), String(PORT)])
if (!(await waitForPort(`http://localhost:${PORT}/v3/`))) {
  console.error('mock server did not start')
  process.exit(1)
}

const browser = await chromium
  .launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  .catch((err) => {
    console.error(`\ncould not launch chromium: ${err.message.split('\n')[0]}`)
    console.error('run `npx playwright install chromium`, or set CHROMIUM_PATH\n')
    process.exit(2)
  })

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const pageErrors = []
const violations = []
const notFound = []
page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)))
page.on('console', (m) => {
  const t = m.text()
  if (/Violation/i.test(t)) violations.push(t)
  else if (m.type() === 'error') pageErrors.push(t)
})
page.on('response', (r) => {
  if (r.status() === 404) notFound.push(r.url())
})
await page.addInitScript(INSTRUMENT)

console.log('\nperf-check\n')

// Start from a known board, not from whatever a previous run left behind.
await page.goto(`http://localhost:${PORT}/v3/`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => localStorage.removeItem('cb-v3-board-layout'))

// ── every card on the board ──────────────────────────────────────────────────
//
// Added through the real "+ Add card" menu rather than by writing a layout into
// localStorage. It costs a few clicks and buys the thing that matters: a card
// added to the catalog is measured from the day it is added, with no list in
// this file to keep in sync and no way to forget.
await page.reload({ waitUntil: 'networkidle' })
const addButton = page.getByRole('button', { name: '+ Add card' })
for (let guard = 0; guard < 40; guard++) {
  if (await addButton.isDisabled()) break
  await addButton.click()
  const first = page.locator('div.absolute.right-0.top-full button').first()
  if ((await first.count()) === 0) break
  await first.click()
  await page.waitForTimeout(120)
}
// The menu closes on an outside pointerdown; leaving it open would sit over the
// first card and swallow the pan gesture further down.
await page.mouse.click(700, 20)
await page.waitForTimeout(200)

const cardIds = await page.$$eval('[data-card-id]', (els) =>
  els.map((e) => e.getAttribute('data-card-id')),
)
console.log(`  board: ${cardIds.length} cards — ${cardIds.join(', ')}\n`)
assert(cardIds.length > 0, 'the board has cards on it')

// ── let every card paint at least once ───────────────────────────────────────
//
// THE "empty overlay passes everything" TRAP. Scroll the whole board so each
// card comes into view and draws, then come back to the top. Anything that
// never painted is excluded from the budgets below and reported as such,
// instead of quietly counting as a pass.
const scroller = page.locator('div.min-h-0.flex-1.overflow-y-auto').first()
await page.waitForTimeout(3000) // first fetches and the connect snapshot
const maxScroll = Math.max(0, await scroller.evaluate((el) => el.scrollHeight - el.clientHeight))
for (let y = 0; y <= maxScroll; y += 400) {
  await scroller.evaluate((el, top) => el.scrollTo({ top }), y)
  await page.waitForTimeout(350)
}
await scroller.evaluate((el) => el.scrollTo({ top: 0 }))
await page.waitForTimeout(1200)

const painted = new Set(
  (await page.evaluate(() => window.__cbPerf.read())).layers
    .filter((l) => l.everPainted)
    .map((l) => `${l.card}/${l.layer}`),
)

// ── 1 & 2: idle, on screen and off ───────────────────────────────────────────

await page.evaluate(() => window.__cbPerf.reset())
await page.waitForTimeout(2500)
const idle = await page.evaluate(() => window.__cbPerf.read())

const budget = Math.max(1, Math.round(idle.frames * PERF.idleRepaintsPerFrame))
console.log(`  idle window: ${idle.frames} frames, on-screen budget ${budget} repaints/layer\n`)
console.log(`  ${'layer'.padEnd(34)}${'state'.padEnd(12)}repaints`)
console.log(`  ${'-'.repeat(34 + 12 + 8)}`)

let measured = 0
for (const l of idle.layers) {
  const key = `${l.card}/${l.layer}`
  const state = !painted.has(key) ? 'never drew' : l.visible ? 'on screen' : 'off screen'
  console.log(`  ${key.padEnd(34)}${state.padEnd(12)}${l.repaints}`)
  if (!painted.has(key)) continue
  measured++
  if (l.visible) {
    assert(l.repaints <= budget, `${key} is quiet while idle (${l.repaints} ≤ ${budget})`)
  } else {
    assert(
      l.repaints <= PERF.offscreenRepaints,
      `${key} does not paint off screen (${l.repaints} ≤ ${PERF.offscreenRepaints})`,
    )
  }
}
console.log('')
assert(measured > 0, 'at least one canvas layer actually painted and was measured')

// ── 3: the guard is not just "draw nothing" ──────────────────────────────────
//
// GEX Candles specifically: it is the card with a per-frame loop and a view
// signature, so it is the one where "quiet" could mean "broken". Its tile is
// scrolled into view and panned and zoomed like a user would.
const candles = page.locator('[data-card-id="gex-candles"]')
if ((await candles.count()) > 0) {
  await candles.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  const box = await candles.locator('canvas').first().boundingBox()
  if (box) {
    const cx = box.x + box.width * 0.6
    const cy = box.y + box.height / 2

    await page.evaluate(() => window.__cbPerf.reset())
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    for (let i = 0; i < 30; i++) {
      await page.mouse.move(cx - i * 8, cy)
      await page.waitForTimeout(25)
    }
    await page.mouse.up()
    await page.waitForTimeout(250)
    const panned = sumFor(await page.evaluate(() => window.__cbPerf.read()), 'gex-candles')

    await page.evaluate(() => window.__cbPerf.reset())
    await page.mouse.move(box.x + box.width / 2, cy)
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, i % 2 ? 120 : -120)
      await page.waitForTimeout(50)
    }
    await page.waitForTimeout(250)
    const zoomed = sumFor(await page.evaluate(() => window.__cbPerf.read()), 'gex-candles')

    console.log(`  panning: ${panned} repaints · zooming: ${zoomed} repaints\n`)
    assert(panned > PERF.interactionRepaints, `panning still redraws (${panned})`)
    assert(zoomed > PERF.interactionRepaints / 2, `zooming still redraws (${zoomed})`)
  }
} else {
  console.log('  gex-candles is not on the board — interaction check skipped\n')
}

function sumFor(reading, card) {
  return reading.layers.filter((l) => l.card === card).reduce((n, l) => n + l.repaints, 0)
}

// ── main-thread health ───────────────────────────────────────────────────────

await scroller.evaluate((el) => el.scrollTo({ top: 0 }))
const longTasks = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const seen = []
      const po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) seen.push(Math.round(e.duration))
      })
      try {
        po.observe({ entryTypes: ['longtask'] })
      } catch {
        resolve('unsupported')
        return
      }
      setTimeout(() => {
        po.disconnect()
        resolve(seen)
      }, 4000)
    }),
)

console.log(`  idle long tasks (>50ms): ${JSON.stringify(longTasks)}`)
console.log(`  console violations     : ${violations.length ? violations.join('\n    ') : 'none'}`)
// 404s are NOT a failure here. scripts/mock-server.mjs answers a subset of the
// real API on purpose and logs the rest; a card whose endpoint has no mock is
// expected to come up empty, and failing on that would make adding a card to
// the catalog break this check for an unrelated reason.
console.log(`  unmocked endpoints     : ${notFound.length}`)
console.log('')
assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ') || 'none'})`)

await browser.close()
cleanup()

console.log('')
if (failures.length) {
  console.error(`perf-check FAILED (${failures.length})\n`)
  process.exit(1)
}
console.log('perf-check ok\n')
process.exit(0)
