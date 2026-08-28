#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Performance budgets, enforced.
//
// Runs as part of `npm run build`. Exits non-zero if anything is over budget,
// so an over-weight bundle cannot be deployed by accident. Budgets live in
// budgets.json; changing one is a visible diff, not a silent drift.
//
// Also checks that the paint tokens duplicated in index.html still match
// tokens.css. That duplication is deliberate (it is what makes the first paint
// correct before CSS loads) but duplication without a check always drifts.
//
// ── The ratchet ──────────────────────────────────────────────────────────────
// A ceiling only enforces something while it stays CLOSE to reality. Every
// budget here started that way, and every one of them drifts the other
// direction on its own: a chunk gets split, a dependency gets lighter, a card
// moves behind lazy() — and the number that was "no headroom" in July is 40%
// headroom by September. At that point it is decoration, and the next
// regression sails under it. Nothing fails, so nobody notices.
//
// So this measures headroom too. Slack past `ratchet.slack` is reported on
// every run, and `npm run budgets:ratchet` rewrites budgets.json back down to
// what the bundle actually weighs. It reports rather than fails by default
// (ratchet.enforce flips that): a build that breaks on the news that it got
// smaller is a build people learn to ignore.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
const BUDGETS_FILE = join(ROOT, 'budgets.json')
const budgets = JSON.parse(readFileSync(BUDGETS_FILE, 'utf8'))

const RATCHET = { slack: 0.15, enforce: false, ...(budgets.ratchet ?? {}) }
const WRITE_RATCHET = process.argv.includes('--ratchet')

/**
 * The kinds that carry a byte budget, in the order budgets.json declares them.
 * The order matters: --ratchet rewrites that file key by key from this list, and
 * a reordered file turns a two-number diff into a whole-file diff.
 */
const KINDS = ['entry', 'react', 'route', 'css', 'html']

const failures = []
const slackNotes = []
const rows = []
/** kind -> the largest asset of that kind, in brotli bytes. */
const peak = new Map()
const notePeak = (kind, size) => peak.set(kind, Math.max(peak.get(kind) ?? 0, size))

const br = (buf) =>
  brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length

const kb = (n) => `${(n / 1024).toFixed(1)}kb`

// ── 1. Token drift ───────────────────────────────────────────────────────────

function tokenDrift() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  const css = readFileSync(join(ROOT, 'src/design/tokens.css'), 'utf8')
  const pairs = [
    ['--cb-bg', '--color-bg'],
    ['--cb-fg', '--color-fg'],
  ]
  for (const [htmlVar, cssVar] of pairs) {
    const h = new RegExp(`${htmlVar}\\s*:\\s*([^;]+);`).exec(html)?.[1]?.trim()
    const c = new RegExp(`${cssVar}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim()
    if (!h || !c) {
      failures.push(`token check: could not find ${htmlVar} in index.html or ${cssVar} in tokens.css`)
      continue
    }
    if (h.toLowerCase() !== c.toLowerCase()) {
      failures.push(
        `PAINT TOKEN DRIFT: index.html ${htmlVar}=${h} but tokens.css ${cssVar}=${c}. ` +
          `The first paint would flash the wrong colour. Make them match.`,
      )
    }
  }
}

// ── 2. Bundle sizes ──────────────────────────────────────────────────────────

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function classify(name) {
  if (name.startsWith('index-') || name === 'index.html') return 'entry'
  if (name.startsWith('react-')) return 'react'
  return 'route'
}

function bundles() {
  if (!existsSync(DIST)) {
    failures.push('dist/ not found — run `vite build` first')
    return
  }

  const files = walk(DIST).filter((f) => !f.endsWith('.map'))
  let initial = 0

  for (const file of files) {
    const name = file.slice(DIST.length + 1).replace(/^assets[\\/]/, '')
    const ext = extname(file)
    const size = br(readFileSync(file))

    let budget
    let kind
    if (ext === '.html') {
      kind = 'html'
      budget = budgets.html
      initial += size
    } else if (ext === '.css') {
      kind = 'css'
      budget = budgets.css
      initial += size
    } else if (ext === '.js') {
      kind = classify(name)
      budget = budgets[kind]
      if (kind !== 'route') initial += size
    } else {
      continue
    }

    const over = size > budget
    notePeak(kind, size)
    rows.push({ name, kind, size, budget, over })
    if (over) {
      failures.push(`${name} is ${kb(size)} brotli, over the ${kind} budget of ${kb(budget)}`)
    }
  }

  notePeak('totalInitial', initial)
  rows.push({
    name: 'INITIAL LOAD (html + css + entry + react)',
    kind: 'total',
    size: initial,
    budget: budgets.totalInitial,
    over: initial > budgets.totalInitial,
  })
  if (initial > budgets.totalInitial) {
    failures.push(
      `initial load is ${kb(initial)} brotli, over the budget of ${kb(budgets.totalInitial)}`,
    )
  }
}

// ── 3. Slack: budgets that have drifted so far above reality they enforce
//        nothing any more. The ceiling half of this file catches a bundle
//        getting bigger; this half catches the number getting meaningless.
// ─────────────────────────────────────────────────────────────────────────────

/** What each budget SHOULD be, given what is actually in dist/ right now. */
function tightened(kind) {
  const max = peak.get(kind)
  if (!max) return null
  // Room for one ordinary change, and nothing like room for a regression.
  return Math.ceil((max * (1 + RATCHET.slack)) / 100) * 100
}

function slack() {
  if (!peak.size) return
  for (const kind of [...KINDS, 'totalInitial']) {
    const max = peak.get(kind)
    const budget = budgets[kind]
    if (!max || !budget) continue
    const headroom = (budget - max) / budget
    if (headroom <= RATCHET.slack) continue
    slackNotes.push(
      `${kind}: budget ${kb(budget)}, largest actual ${kb(max)} — ` +
        `${(headroom * 100).toFixed(0)}% headroom, so this budget is not enforcing anything. ` +
        `Tighten it to ${kb(tightened(kind))} (\`npm run budgets:ratchet\`).`,
    )
  }
}

/**
 * Rewrite budgets.json with every number pulled down to current reality.
 *
 * Written key by key rather than with a spread, so the file keeps its shape and
 * its comments and the diff is only the numbers — the diff being readable is
 * the entire reason these live in a file instead of in this script.
 */
function writeRatchet() {
  const next = { $comment: budgets.$comment }
  const changes = []
  for (const kind of [...KINDS, 'totalInitial']) {
    const now = budgets[kind]
    const want = tightened(kind)
    // A kind with nothing in dist/ keeps its number: a build that happened not
    // to emit a route chunk must not silently ratchet the route budget to zero.
    next[kind] = want ?? now
    if (want && want !== now) changes.push(`  ${kind.padEnd(14)} ${kb(now)} → ${kb(want)}`)
  }
  if (budgets.ratchet) next.ratchet = budgets.ratchet
  if (budgets.perf) next.perf = budgets.perf

  if (!changes.length) {
    console.log('  budgets already match reality — nothing to ratchet\n')
    return
  }
  writeFileSync(BUDGETS_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log('  ratcheted budgets.json:\n')
  for (const c of changes) console.log(c)
  console.log('\n  Review the diff before committing.\n')
}

// ── run ──────────────────────────────────────────────────────────────────────

tokenDrift()
bundles()
slack()

const pad = (s, n) => String(s).padEnd(n)
const pct = (r) => (r.budget ? `${Math.round(((r.budget - r.size) / r.budget) * 100)}%` : '')
console.log('')
console.log(`  ${pad('asset', 46)}${pad('kind', 9)}${pad('brotli', 10)}${pad('budget', 10)}headroom`)
console.log(`  ${'-'.repeat(46 + 9 + 10 + 10 + 8)}`)
for (const r of rows) {
  const mark = r.over ? '✗' : '·'
  console.log(
    `${mark} ${pad(r.name, 46)}${pad(r.kind, 9)}${pad(kb(r.size), 10)}${pad(kb(r.budget), 10)}${pct(r)}`,
  )
}
console.log('')

if (WRITE_RATCHET) {
  // Deliberately AFTER the table and BEFORE the pass/fail exit: you see what
  // the bundle weighs, then what the file was changed to, and an over-budget
  // build still fails rather than being ratcheted UP into passing.
  if (failures.length) {
    console.error('  refusing to ratchet an over-budget build — fix the size first\n')
    for (const f of failures) console.error(`  • ${f}`)
    console.error('')
    process.exit(1)
  }
  writeRatchet()
  process.exit(0)
}

if (slackNotes.length) {
  console.warn('  SLACK — these budgets have drifted above reality:\n')
  for (const s of slackNotes) console.warn(`  • ${s}`)
  console.warn('')
  // Promoted to failures only HERE, never inside slack() — otherwise
  // `--ratchet` would refuse to run on exactly the builds it exists to fix.
  if (RATCHET.enforce) failures.push(...slackNotes)
}

if (failures.length) {
  console.error('BUDGET CHECK FAILED\n')
  for (const f of failures) console.error(`  • ${f}`)
  console.error('')
  console.error('  Fix the size, or raise the number in budgets.json deliberately.')
  console.error('')
  process.exit(1)
}

console.log('  budgets ok\n')
