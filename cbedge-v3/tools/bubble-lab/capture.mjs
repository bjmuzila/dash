#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Freeze one real session into a fixture the lab can redraw forever.
//
//   node tools/bubble-lab/capture.mjs --name fri-pin --symbol SPX
//
// Hits the same three routes the card does, in the same order (the expiry is
// not knowable without the first call), and writes
// tools/bubble-lab/fixtures/<name>.json.
//
// ── Why fixtures at all ──────────────────────────────────────────────────────
// Every tuning round on this layer so far has been: look at ONE live chart,
// change a constant, deploy, look again tomorrow. One sample per twenty
// minutes, and the sample is whatever the market happened to do that day — so a
// change that fixes a pinned Friday quietly wrecks a trend day and nobody finds
// out for a week. A fixture is a session that cannot change under you. Capture
// the days that have broken this layer, and every future change is judged
// against all of them at once, in a second.
//
// Days worth having, roughly one of each:
//   • a hard pin      — one wall, price parked on it all afternoon
//   • a flat board    — six strikes within a few percent, nothing dominant
//   • a trend day     — price travels 50+ points, the ladder migrates with it
//   • a lopsided one  — the whole top of the board on one side of spot
//   • a half day      — a short session, so the time-of-day scale is stressed
//   • an overnight    — captured before the open, when the book is frozen
//
// AUTH: these routes sit behind the app's session cookie. If a capture comes
// back empty, copy the Cookie header out of devtools on a logged-in tab and
// pass it: --cookie "sb-access-token=…; sb-refresh-token=…"
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]
  if (!k?.startsWith('--')) continue
  args.set(k.slice(2), process.argv[i + 1] ?? '')
}

const base = (args.get('base') ?? 'https://cbedge.net').replace(/\/+$/, '')
const symbol = (args.get('symbol') ?? 'SPX').toUpperCase()
const name = args.get('name') ?? `${symbol.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`
const minutes = Number(args.get('minutes') ?? 2880)
const days = Number(args.get('days') ?? 5)
const interval = Number(args.get('interval') ?? 1)
const cookie = args.get('cookie') ?? ''
const note = args.get('note') ?? ''

// Mirrors symbols.ts — the GEX ladder is keyed by `$SPX` while the candle route
// wants `SPX`, and the chain route wants the `$` stripped again.
const GEX_SYMBOL = { SPX: '$SPX', NDX: 'NDX', SPY: 'SPY', QQQ: 'QQQ', VIX: 'VIX' }
const gexSymbol = GEX_SYMBOL[symbol] ?? symbol
const chainTicker = gexSymbol.replace(/^\$/, '')

async function get(path) {
  const url = `${base}${path}`
  const res = await fetch(url, { headers: cookie ? { cookie } : {} })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${path} did not return JSON (HTTP ${res.status}). First 200 chars:\n${text.slice(0, 200)}`)
  }
  return json
}

const run = async () => {
  process.stdout.write(`expiries … `)
  const expJson = await get(`/api/expirations?ticker=${encodeURIComponent(chainTicker)}`)
  const expiries = (expJson?.data?.items ?? []).map((i) => i['expiration-date'] ?? '').filter(Boolean)
  const expiry = args.get('expiry') || expiries[0]
  if (!expiry) throw new Error('no expirations came back — check --cookie and --base')
  process.stdout.write(`${expiry}\n`)

  process.stdout.write(`gex history (${minutes}m) … `)
  const gexJson = await get(
    `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${minutes}` +
      `&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(gexSymbol)}&top=30`,
  )
  // Same shape check parseGexHistory does: every failure of this route is an
  // HTTP 200 with no `columns` key, so the array is the only real signal.
  const rawCols = Array.isArray(gexJson?.columns) ? gexJson.columns : []
  const columns = rawCols
    .map((c) => ({
      slotTs: Number(c?.slotTs) || 0,
      spot: Number(c?.spot) || 0,
      cells: (Array.isArray(c?.cells) ? c.cells : [])
        .map((x) => ({ strike: Number(x?.strike) || 0, net: Number(x?.net) || 0, netVol: Number(x?.netVol) || 0 }))
        .filter((x) => x.strike),
    }))
    .filter((c) => c.slotTs && c.cells.length)
    .sort((a, b) => a.slotTs - b.slotTs)
  process.stdout.write(`${columns.length} columns\n`)
  if (!columns.length) throw new Error(`no columns — ${gexJson?.error ?? 'route returned an empty ladder'}`)

  process.stdout.write(`candles … `)
  const barJson = await get(
    `/api/snapshots/etf-candles?symbol=${encodeURIComponent(symbol)}&days=${days}&interval=${interval}`,
  )
  const bars = (barJson?.rows ?? [])
    .map((r) => ({
      t: Number(r?.timestamp) || 0,
      o: Number(r?.open) || 0,
      h: Number(r?.high) || 0,
      l: Number(r?.low) || 0,
      c: Number(r?.close) || 0,
    }))
    .filter((b) => b.t)
    .sort((a, b) => a.t - b.t)
  process.stdout.write(`${bars.length} bars\n`)

  // Trim the candles to the ladder's own window. The candle route serves days
  // and the ladder serves hours, and a fixture that draws four days of bars
  // behind one session of gamma is a picture of nothing.
  const t0 = columns[0].slotTs
  const t1 = columns[columns.length - 1].slotTs
  const pad = 30 * 60_000
  const windowed = bars.filter((b) => b.t >= t0 - pad && b.t <= t1 + pad)

  mkdirSync(FIXTURES, { recursive: true })
  const out = {
    name,
    note,
    symbol,
    expiry,
    capturedAt: new Date().toISOString(),
    from: t0,
    to: t1,
    columns,
    bars: windowed.length ? windowed : bars,
  }
  const file = join(FIXTURES, `${name}.json`)
  writeFileSync(file, JSON.stringify(out))
  const kb = Math.round(JSON.stringify(out).length / 1024)
  console.log(`\nwrote ${file}  (${kb} KB, ${columns.length} columns, ${out.bars.length} bars)`)
  console.log(`now run:  node tools/bubble-lab/build.mjs   then open tools/bubble-lab/lab.html`)
}

run().catch((e) => {
  console.error(`\ncapture failed: ${e.message}`)
  process.exit(1)
})
