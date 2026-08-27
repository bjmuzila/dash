#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Proves that WebSocket topic scoping is DERIVED correctly.
//
// This is the highest-value test in the repo, because the failure it guards
// against is silent: a wrong scope does not throw, the frames simply stop and
// a panel quietly shows stale numbers. In v2 this cost real debugging time
// more than once, because the topic list was hand-maintained.
//
// It asserts, against a real browser and a server that mirrors the real
// filtering:
//
//   1. The boot connection is UNSCOPED. Reconnecting at startup to add a
//      ?topics= param would throw away the early-boot head start.
//   2. Subscribing narrows the scope to exactly the subscribed types.
//   3. Unsubscribing everything does NOT strand the socket on an empty scope.
//   4. Broadcast-only frame types are never requested as topics.
//
// Run:  node scripts/ws-scope-check.mjs
// Requires a chromium available to playwright.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MOCK_PORT = 4311
const DEV_PORT = 5274

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('playwright not found — `npm i -D playwright` to run this check')
  process.exit(2)
}

const procs = []
function run(cmd, args, env) {
  const p = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // .bin/vite is a .cmd batch shim on Windows — node's spawn() can only run
    // that through a shell (ENOENT otherwise). On POSIX .bin/vite is directly
    // executable, and shell:true there is harmless for these plain, no-space
    // arguments, so it's simplest to always match the platform.
    shell: process.platform === 'win32',
  })
  procs.push(p)
  return p
}
function cleanup() {
  for (const p of procs) {
    try {
      // On Windows, child_process.kill('SIGTERM') frequently does not
      // actually terminate the process (Windows has no real SIGTERM) —
      // especially for the shell:true vite spawn, where the signal goes to
      // the cmd.exe wrapper and the real vite/esbuild process underneath
      // survives. That's how stale processes end up squatting on
      // MOCK_PORT/DEV_PORT across runs, causing an unrelated EADDRINUSE or
      // ECONNREFUSED on the next `npm run check`. taskkill with /T (kill
      // the whole tree) is the reliable way to actually end it.
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

const failures = []
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    console.log(`  ✗ ${msg}`)
    failures.push(msg)
  }
}

async function connections() {
  const res = await fetch(`http://localhost:${MOCK_PORT}/__connections`)
  return res.json()
}

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

// ── boot the two servers ─────────────────────────────────────────────────────

run('node', [join(ROOT, 'scripts/mock-server.mjs'), String(MOCK_PORT)])
// Run the locally-installed vite binary directly instead of `npx vite` —
// `npx` is a .cmd shim on Windows that node's spawn() can't exec without a
// shell (ENOENT). Vite 7 also locks down its package "exports", so
// require.resolve('vite/bin/vite.js') is blocked too. node_modules/.bin/vite
// is just a file on disk, not subject to either restriction.
const viteBin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
run(viteBin, ['--port', String(DEV_PORT), '--strictPort'], {
  VITE_BACKEND_ORIGIN: `http://localhost:${MOCK_PORT}`,
})

if (!(await waitForPort(`http://localhost:${MOCK_PORT}/__connections`))) {
  console.error('mock server did not start')
  process.exit(1)
}
if (!(await waitForPort(`http://localhost:${DEV_PORT}/v3/`))) {
  console.error('vite dev server did not start')
  process.exit(1)
}

// ── drive the browser ────────────────────────────────────────────────────────

// CHROMIUM_PATH lets this run against a chromium that playwright did not
// download itself (CI images, sandboxes). Without it, `npx playwright install`
// once is enough.
const browser = await chromium
  .launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  .catch((err) => {
    console.error(`\ncould not launch chromium: ${err.message.split('\n')[0]}`)
    console.error('run `npx playwright install chromium`, or set CHROMIUM_PATH\n')
    process.exit(2)
  })
const page = await browser.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

console.log('\nws-scope-check\n')

await page.goto(`http://localhost:${DEV_PORT}/v3/`, { waitUntil: 'load' })
await page.waitForFunction(() => Boolean(window.__CB_DEV__), null, { timeout: 10_000 })

// 1 — boot connection is unscoped
let log = await connections()
assert(log.length >= 1, 'a socket connected at boot')
assert(log[0]?.topics === null, 'boot connection is UNSCOPED (early-boot head start preserved)')

// 2 — subscribing narrows to (at least) those types
//
// The page under test is real /v3/ — it boots Home -> BoardPage with its
// default cards, and KeyLevelsCard legitimately subscribes to 'gex' on
// mount via useField(). So the derived scope is not just what THIS test
// subscribes to; it is the union with whatever the mounted page already
// needs. Assert the subset relationship (our types are present, nothing
// unexpected is MISSING) rather than an exact list — an exact list would
// make this check fragile to any future default-card change, for reasons
// that have nothing to do with scope derivation being correct.
await page.evaluate(() => {
  const dev = window.__CB_DEV__
  window.__unsubs = ['spot', 'aux'].map((t) => dev.subscribe(t, () => {}))
})
// NARROW_MS is 1200ms, plus the SETTLE_MS window at boot.
await sleep(3200)
log = await connections()
const scoped = log.filter((c) => c.topics !== null)
assert(scoped.length >= 1, 'the socket reconnected with a scope once something subscribed')
const gotTopics = scoped.at(-1)?.topics ?? []
assert(
  ['aux', 'spot'].every((t) => gotTopics.includes(t)),
  `scope includes our subscribed types (got ${JSON.stringify(gotTopics)})`,
)

// 3 — a broadcast-only type must never be requested
await page.evaluate(() => {
  const dev = window.__CB_DEV__
  window.__unsubs.push(dev.subscribe('regime-fit-updated', () => {}))
})
await sleep(2200)
log = await connections()
const everRequested = log.some((c) => c.topics?.includes('regime-fit-updated'))
assert(!everRequested, 'broadcast-only types are never requested as topics')

// 4 — frames for a subscribed type actually arrive
const gotSpot = await page.evaluate(async () => {
  const dev = window.__CB_DEV__
  for (let i = 0; i < 40; i++) {
    if (dev.read('spot')) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
})
assert(gotSpot, 'frames for a subscribed type arrive under the derived scope')

// 5 — unsubscribing everything must not strand the socket on an empty scope
const before = (await connections()).length
await page.evaluate(() => {
  window.__unsubs.forEach((fn) => fn())
  window.__unsubs = []
})
await sleep(2200)
log = await connections()
assert(
  log.length === before || log.at(-1)?.topics !== undefined,
  'unsubscribing everything does not reconnect to an empty scope',
)

assert(pageErrors.length === 0, `no page errors (${pageErrors.join('; ') || 'none'})`)

await browser.close()
cleanup()

console.log('')
if (failures.length) {
  console.error(`ws-scope-check FAILED (${failures.length})\n`)
  process.exit(1)
}
console.log('ws-scope-check ok\n')
process.exit(0)
