// ─────────────────────────────────────────────────────────────────────────────
// Capture a fixture WITHOUT a cookie, a terminal, or the VPS.
//
// Paste this whole file into the devtools console on a logged-in cbedge.net tab
// and press enter. It downloads one JSON file. Drop that file into
// cbedge-v3/tools/bubble-lab/fixtures/ and run `npm run lab`.
//
// Why this exists alongside capture.mjs: the page is already authenticated, so
// same-origin fetch carries the session automatically. No cookie to copy, no
// header to escape, nothing to get wrong. capture.mjs is the scriptable version
// for when you want six of these in a loop; this is the one to use.
//
// Change NAME and NOTE before you run it. SYMBOL and MINUTES rarely need to.
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const NAME = 'fri-pin'                  // the filename, and the sheet's row label
  const NOTE = 'hard pin, price parked on it all afternoon'
  const SYMBOL = 'SPX'
  const MINUTES = 2880                    // 48h, so the fixture holds a full session

  const GEX_SYMBOL = { SPX: '$SPX', NDX: 'NDX', SPY: 'SPY', QQQ: 'QQQ', VIX: 'VIX' }
  const gexSymbol = GEX_SYMBOL[SYMBOL] ?? SYMBOL
  const chainTicker = gexSymbol.replace(/^\$/, '')

  const get = async (path) => {
    const res = await fetch(path, { credentials: 'include' })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${path} did not return JSON (HTTP ${res.status}) — are you logged in on this tab?`)
    }
  }

  console.log('expiries…')
  const expJson = await get(`/api/expirations?ticker=${encodeURIComponent(chainTicker)}`)
  const expiry = (expJson?.data?.items ?? []).map((i) => i['expiration-date'] ?? '').filter(Boolean)[0]
  if (!expiry) throw new Error('no expirations came back')

  console.log('gex history…', expiry)
  const gexJson = await get(
    `/api/snapshots/option-strike-gex-history?mode=heatmap&minutes=${MINUTES}` +
      `&expiry=${encodeURIComponent(expiry)}&symbol=${encodeURIComponent(gexSymbol)}&top=30`,
  )
  // Every failure of this route is an HTTP 200 with no `columns` key, so the
  // array is the only real signal — same check parseGexHistory does.
  const columns = (Array.isArray(gexJson?.columns) ? gexJson.columns : [])
    .map((c) => ({
      slotTs: Number(c?.slotTs) || 0,
      spot: Number(c?.spot) || 0,
      cells: (Array.isArray(c?.cells) ? c.cells : [])
        .map((x) => ({ strike: Number(x?.strike) || 0, net: Number(x?.net) || 0, netVol: Number(x?.netVol) || 0 }))
        .filter((x) => x.strike),
    }))
    .filter((c) => c.slotTs && c.cells.length)
    .sort((a, b) => a.slotTs - b.slotTs)
  if (!columns.length) throw new Error(`no columns — ${gexJson?.error ?? 'empty ladder'}`)

  console.log('candles…', columns.length, 'columns')
  const barJson = await get(`/api/snapshots/etf-candles?symbol=${encodeURIComponent(SYMBOL)}&days=5&interval=1`)
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

  // Trim the candles to the ladder's window — the candle route serves days and
  // the ladder serves hours, and four days of bars behind one session of gamma
  // is a picture of nothing.
  const from = columns[0].slotTs
  const to = columns[columns.length - 1].slotTs
  const pad = 30 * 60_000
  const windowed = bars.filter((b) => b.t >= from - pad && b.t <= to + pad)

  const fixture = {
    name: NAME,
    note: NOTE,
    symbol: SYMBOL,
    expiry,
    capturedAt: new Date().toISOString(),
    from,
    to,
    columns,
    bars: windowed.length ? windowed : bars,
  }

  const blob = new Blob([JSON.stringify(fixture)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${NAME}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  console.log(
    `%c${NAME}.json downloaded — ${columns.length} columns, ${fixture.bars.length} bars.\n` +
      `Move it into cbedge-v3/tools/bubble-lab/fixtures/ and run: npm run lab`,
    'color:#29b6f6;font-weight:700',
  )
})()
