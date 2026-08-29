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

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const HERE = dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

const FIXTURES = join(HERE, 'fixtures')

/**
 * Adopt any fixture that landed BESIDE the tool instead of inside fixtures/.
 *
 * The browser capture drops its file in Downloads and the next step is "move it
 * into tools/bubble-lab/fixtures/" — a folder that does not exist until
 * something creates it, so the natural thing is to drop the file next to the
 * scripts and get "0 sessions" with nothing on screen explaining why. Rather
 * than document the folder harder, take the file wherever it lands.
 */
function adoptLooseFixtures() {
  mkdirSync(FIXTURES, { recursive: true })
  let loose = []
  try {
    loose = readdirSync(HERE).filter((f) => f.endsWith('.json') && f !== 'package.json')
  } catch {
    return
  }
  for (const f of loose) {
    renameSync(join(HERE, f), join(FIXTURES, f))
    console.log(`adopted ${f} -> fixtures/${f}`)
  }
}

function writeFixtures() {
  adoptLooseFixtures()
  let files = []
  try {
    files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'))
  } catch {
    files = []
  }
  const all = files.map((f) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')))
  all.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  writeFileSync(join(HERE, 'fixtures.js'), `window.__BUBBLE_FIXTURES = ${JSON.stringify(all)};\n`)
  const kb = Math.round(JSON.stringify(all).length / 1024)
  console.log(`fixtures.js  ${all.length} session${all.length === 1 ? '' : 's'} (${kb} KB)` +
    (all.length
      ? `: ${all.map((a) => a.name).join(', ')}`
      : ' — capture one (see README) and drop the .json anywhere in tools/bubble-lab/'))
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
