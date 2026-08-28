#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Bundle the LIVE bubble modules and the captured fixtures into two files the
// lab page can load straight off the filesystem.
//
//   node tools/bubble-lab/build.mjs          once, then reopen the page
//   node tools/bubble-lab/build.mjs --watch  rebuilds on every save
//
// Two outputs, both git-ignored:
//   lab.bundle.js   the real bubbles.ts + settings.ts, as window.BubbleLab
//   fixtures.js     every fixtures/*.json, as window.__BUBBLE_FIXTURES
//
// Fixtures are INLINED rather than fetched because `fetch('./fixtures/x.json')`
// is blocked under file://, and a tool that needs a dev server running is a
// tool that gets used once. Open lab.html by double-clicking it.
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

function writeFixtures() {
  let files = []
  try {
    files = readdirSync(join(HERE, 'fixtures')).filter((f) => f.endsWith('.json'))
  } catch {
    files = []
  }
  const all = files.map((f) => JSON.parse(readFileSync(join(HERE, 'fixtures', f), 'utf8')))
  all.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  writeFileSync(join(HERE, 'fixtures.js'), `window.__BUBBLE_FIXTURES = ${JSON.stringify(all)};\n`)
  const kb = Math.round(JSON.stringify(all).length / 1024)
  console.log(`fixtures.js  ${all.length} session${all.length === 1 ? '' : 's'} (${kb} KB)` +
    (all.length ? `: ${all.map((a) => a.name).join(', ')}` : ' — run capture.mjs first'))
}

const opts = {
  entryPoints: [join(HERE, 'entry.ts')],
  outfile: join(HERE, 'lab.bundle.js'),
  bundle: true,
  format: 'iife',
  globalName: 'BubbleLab',
  target: 'es2020',
  // Not minified on purpose: when a number in the sheet looks wrong the next
  // step is reading the code that drew it, in the browser, with a breakpoint.
  minify: false,
  sourcemap: 'inline',
  logLevel: 'info',
}

if (watch) {
  writeFixtures()
  const ctx = await esbuild.context(opts)
  await ctx.watch()
  console.log('watching src/board/gexCandles — edit bubbles.ts / settings.ts and refresh lab.html')
} else {
  await esbuild.build(opts)
  writeFixtures()
  console.log('built. open tools/bubble-lab/lab.html')
}
