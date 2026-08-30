#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-casing.mjs — two modules in one folder whose names differ only in case.
//
// This exists because of one specific, expensive shape: `sectorWheel.ts` beside
// `SectorWheel.tsx`. On a case-INSENSITIVE filesystem (Windows, and macOS by
// default) the resolver turns `import('./SectorWheel')` into `SectorWheel.ts`,
// the filesystem serves `sectorWheel.ts`, and tsc fails with TS1149 plus
// "Property 'default' is missing" on the lazy() import.
//
// The reason it needs a script rather than a memory: it builds CLEAN on a
// case-sensitive filesystem. The Docker deploy is Linux, so the deploy would
// never catch it — only the laptop would, and only after the code was written.
// That is the wrong order.
//
// It looks at basenames without their extension, per directory, so
// `wheelMath.ts` + `SectorWheelCard.tsx` is fine and `foo.ts` + `Foo.tsx` is
// not. Extensions are stripped on purpose: it is the MODULE SPECIFIER that
// collides, and a specifier carries no extension.
//
//   node scripts/check-casing.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])

const collisions = []

function walk(dir) {
  const entries = readdirSync(dir)
  const byLowerStem = new Map()
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      walk(p)
      continue
    }
    const ext = extname(name)
    if (!EXTS.has(ext)) continue
    const key = basename(name, ext).toLowerCase()
    const list = byLowerStem.get(key) ?? []
    list.push(name)
    byLowerStem.set(key, list)
  }
  for (const [, names] of byLowerStem) {
    if (names.length > 1) {
      collisions.push({ dir: relative(ROOT, dir).replace(/\\/g, '/'), names: names.sort() })
    }
  }
}

walk(SRC)

console.log('\ncheck-casing — module names that differ only in case\n')

if (!collisions.length) {
  console.log('  ✓ clean\n')
  process.exit(0)
}

for (const c of collisions) {
  console.log(`  ✗ ${c.dir}/`)
  for (const n of c.names) console.log(`      ${n}`)
  console.log('      → these are ONE module to Windows. Rename one, or git rm whichever is dead:')
  for (const n of c.names) console.log(`          git rm ${c.dir}/${n}`)
}
console.log(
  `\n  ${collisions.length} collision(s). This builds fine on Linux and fails on the laptop,\n` +
    `  which is why it is a check and not a convention.\n`,
)
process.exit(1)
