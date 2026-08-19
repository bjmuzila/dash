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
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')
const budgets = JSON.parse(readFileSync(join(ROOT, 'budgets.json'), 'utf8'))

const failures = []
const rows = []

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
    rows.push({ name, kind, size, budget, over })
    if (over) {
      failures.push(`${name} is ${kb(size)} brotli, over the ${kind} budget of ${kb(budget)}`)
    }
  }

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

// ── run ──────────────────────────────────────────────────────────────────────

tokenDrift()
bundles()

const pad = (s, n) => String(s).padEnd(n)
console.log('')
console.log(`  ${pad('asset', 46)}${pad('kind', 9)}${pad('brotli', 10)}budget`)
console.log(`  ${'-'.repeat(46 + 9 + 10 + 8)}`)
for (const r of rows) {
  const mark = r.over ? '✗' : '·'
  console.log(`${mark} ${pad(r.name, 46)}${pad(r.kind, 9)}${pad(kb(r.size), 10)}${kb(r.budget)}`)
}
console.log('')

if (failures.length) {
  console.error('BUDGET CHECK FAILED\n')
  for (const f of failures) console.error(`  • ${f}`)
  console.error('')
  console.error('  Fix the size, or raise the number in budgets.json deliberately.')
  console.error('')
  process.exit(1)
}

console.log('  budgets ok\n')
