#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-docs.mjs — every surface has a reference, and every reference is real.
//
// The ↓MD button on a card header, on a gallery tile and in the toolbar is a
// plain <a href> at a static asset (see src/design/primitives/DocLink.tsx). That
// is the right shape for the bundle and the wrong shape for a typo: nothing in
// the build resolves the path, so a slug that names a file which is not there
// ships green and 404s on a customer's click.
//
// Two directions, and both matter:
//
//   1. every slug in src/docs/docsIndex.ts has a file in public/docs
//   2. every catalog card and every route in src/App.tsx is either IN the index
//      or listed below as deliberately undocumented
//
// (2) is the one that keeps this honest over time. Without it the index quietly
// stops covering the app: a card lands, nobody adds a line, and the only signal
// is a card with no button — which looks exactly like a card whose doc is still
// being written.
//
//   node scripts/check-docs.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = join(ROOT, 'public', 'docs')
const INDEX = join(ROOT, 'src', 'docs', 'docsIndex.ts')
const CATALOG = join(ROOT, 'src', 'board', 'catalog.tsx')
const APP = join(ROOT, 'src', 'App.tsx')

/**
 * Surfaces that are deliberately not documented, and why. A line here is a
 * DECISION, visible in a diff — which is the whole difference between "we chose
 * not to" and "we forgot".
 */
const EXEMPT_ROUTES = new Set([
  '/cards/:cardId', // resolves to the CARD's doc — see routeDoc()
  '*', // NotFound
])

const problems = []

const read = (p) => readFileSync(p, 'utf8')

// ── 1. Slugs in the index → files on disk ────────────────────────────────────
const indexSrc = read(INDEX)
const slugs = new Set([...indexSrc.matchAll(/'((?:card|page)-[a-z0-9-]+)'/g)].map((m) => m[1]))

if (!slugs.size) problems.push('docsIndex.ts named no slugs at all — has its shape changed?')

for (const slug of [...slugs].sort()) {
  const file = join(DOCS_DIR, `${slug}.md`)
  if (!existsSync(file)) {
    problems.push(`public/docs/${slug}.md is missing — docsIndex.ts points the ↓MD button at it`)
    continue
  }
  // A stub is worse than nothing: the button promises a reference and hands
  // back a heading. 2KB is about a screen of prose.
  const bytes = statSync(file).size
  if (bytes < 2048) problems.push(`public/docs/${slug}.md is only ${bytes}B — that is a stub, not a reference`)
}

// ── 2. Files on disk → slugs in the index ────────────────────────────────────
if (existsSync(DOCS_DIR)) {
  for (const name of readdirSync(DOCS_DIR)) {
    if (!name.endsWith('.md')) continue
    const slug = name.slice(0, -3)
    if (slug === 'index') continue
    if (!slugs.has(slug)) problems.push(`public/docs/${name} is shipped but nothing links to it — add it to docsIndex.ts or delete it`)
  }
}

// ── 3. Every catalog card is covered ─────────────────────────────────────────
const catalogSrc = read(CATALOG)
// The slice between `CARD_CATALOG … = [` and the `]` that closes it, so a card
// written on one line (`{ id: 'quick-links', icon: …`) is found as readily as
// one spread over twenty — that shape is why an anchored /^\s*id:/ was wrong,
// and it silently skipped a real card rather than failing.
const catalogBody = catalogSrc.slice(catalogSrc.indexOf('CARD_CATALOG'), catalogSrc.indexOf('\n]', catalogSrc.indexOf('CARD_CATALOG')))
const cardIds = [...catalogBody.matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1])
for (const id of cardIds) {
  if (!indexSrc.includes(`'${id}': 'card-`)) {
    problems.push(`card '${id}' is in the catalog with no line in CARD_DOCS — it draws no ↓MD button`)
  }
}

// ── 4. Every route is covered ────────────────────────────────────────────────
const appSrc = read(APP)
const routes = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])
for (const path of routes) {
  if (EXEMPT_ROUTES.has(path)) continue
  if (!indexSrc.includes(`'${path}':`)) {
    problems.push(`route '${path}' is registered in App.tsx with no line in ROUTE_DOCS — the toolbar draws no ↓MD there`)
  }
}

console.log('\ncheck-docs — a reference behind every card and every page\n')

if (!problems.length) {
  console.log(`  ✓ ${slugs.size} document(s), ${cardIds.length} card(s), ${routes.length} route(s) — all accounted for\n`)
  process.exit(0)
}

for (const p of problems) console.log(`  ✗ ${p}`)
console.log(`\n  ${problems.length} problem(s).\n`)
process.exit(1)
