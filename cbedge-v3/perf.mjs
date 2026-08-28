#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// MOVED → scripts/perf-check.mjs   (`npm run perf`)
//
// This file used to hold the GEX Candles redraw guard. It measured one card, on
// whatever board happened to be saved, against a server someone had to start by
// hand — and, because it lived here instead of in scripts/ and was in no npm
// script, it ran only when a human remembered it existed. Between the day it
// was written and the day it was replaced, that was almost never.
//
// scripts/perf-check.mjs is the same idea done properly: every card on the
// board, every canvas v3 owns, its own servers, and part of `npm run check`.
//
// Kept as a forwarder so muscle memory (`node perf.mjs`) still lands somewhere
// useful. Delete it once nobody types that.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
console.log('perf.mjs has moved to scripts/perf-check.mjs (npm run perf) — running it\n')
const r = spawnSync(process.execPath, [join(here, 'scripts', 'perf-check.mjs')], { stdio: 'inherit' })
process.exit(r.status ?? 1)
