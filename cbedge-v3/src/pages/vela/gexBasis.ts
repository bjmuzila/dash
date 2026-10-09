// ─────────────────────────────────────────────────────────────────────────────
// THE GEX SWITCH: one choice of GEX book for every indicator on the Vela page.
//
// 2026-10-07, Brandon: "for all indicators, i dont want personalized oi + vol
// or vol. i want to have an overall button for that, so they are all on the
// same page no matter what. also need to add oi only to it."
//
// Until then each study carried its own GEX input (CB Walls and the Rail on one
// default, the Path on another, the Profile and Heatmap on a third), so the
// Path's beads, the Rail's tags and the legend card's levels could name three
// different Volts at once. Now there is ONE setting, and every reader of GEX
// takes it from here:
//
//   OI only    open interest GEX — the gamma already on the book
//   OI + Vol   open interest plus today's volume (the recorder's historical default)
//   Vol only   today's volume alone — where flow is building (the default here,
//              the book the Voltick Path and the Rail were already on)
//
// Readers: Voltick Walls, Voltick Path and Path Ribbon (the walls each read come
// from walls_log under that basis), GEX Rail, GEX Profile, GEX Heatmap, Key
// Levels, the legend card's LEVELS row and Level Alerts (levels/levelAlerts.ts),
// and CB Script's cbedge.core / call_wall / put_wall. The Surge stays what it
// is by definition — the CORE of the VOLUME book — whatever is picked here.
// Vol / GEX Flow is not a reader: it draws the books side by side. Net GEX and
// Net GEX Flow are (2026-10-07): the ticker's net GEX on this book, and its change.
//
// Remembered per browser under `cb-v3-vela-gex-basis`, and followed live by
// every other open tab. The button is gexBasisMenu.ts (the top bar on the
// desktop, ⋮ on a phone).
//
// THIS FILE IMPORTS NOTHING FROM VELA, so a reader outside the Vela chunk (the
// home board's GEX Candles card shares vtPath/ and wallsData.ts) can take it.
// ─────────────────────────────────────────────────────────────────────────────

/** The GEX book a level is ranked on — the same keys the recorder and /api/walls-range use. */
export type GexBasis = 'oi' | 'oivol' | 'vol'

const STORE_KEY = 'cb-v3-vela-gex-basis'
export const GEX_BASIS_DEFAULT: GexBasis = 'vol'

/** In display order. */
export const GEX_BASES: ReadonlyArray<{ key: GexBasis; label: string; short: string; hint: string }> = [
  { key: 'oi', label: 'OI only', short: 'OI', hint: 'Open interest GEX: the gamma already on the book' },
  { key: 'oivol', label: 'OI + Vol', short: 'OI+Vol', hint: 'Open interest plus today’s volume' },
  { key: 'vol', label: 'Vol only', short: 'Vol', hint: 'Today’s volume alone: where flow is building' },
]

export const isGexBasis = (v: unknown): v is GexBasis => v === 'oi' || v === 'oivol' || v === 'vol'

function readStored(): GexBasis {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return isGexBasis(v) ? v : GEX_BASIS_DEFAULT
  } catch {
    return GEX_BASIS_DEFAULT
  }
}

let basis: GexBasis = readStored()
const subs = new Set<() => void>()

function notify(): void {
  for (const fn of [...subs]) {
    try {
      fn()
    } catch {
      /* one reader failing never stops the others */
    }
  }
}

/** The book every indicator reads now. */
export function gexBasis(): GexBasis {
  return basis
}

/** Its name, as the switch writes it (`OI only`, `OI + Vol`, `Vol only`). */
export function gexBasisLabel(b: GexBasis = basis): string {
  return GEX_BASES.find((x) => x.key === b)?.label ?? b
}

/** Its short name, for the top-bar button (`OI`, `OI+Vol`, `Vol`). */
export function gexBasisShort(b: GexBasis = basis): string {
  return GEX_BASES.find((x) => x.key === b)?.short ?? b
}

/** Pick the book for every indicator, remember it, and tell every reader. */
export function setGexBasis(next: GexBasis): void {
  if (!isGexBasis(next) || next === basis) return
  basis = next
  try {
    localStorage.setItem(STORE_KEY, next)
  } catch {
    /* private mode: it still applies for this visit */
  }
  notify()
}

/** Called whenever the book (or the Coil switch) changes, here or in another tab. Returns the unsubscribe. */
export function onGexBasis(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

// Another tab picked a book: follow it, so two windows never disagree.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return
    const next = isGexBasis(e.newValue) ? e.newValue : GEX_BASIS_DEFAULT
    if (next === basis) return
    basis = next
    notify()
  })
}

// ── THE COIL SWITCH (2026-10-09, Brandon: "coil - half of volts weight (can be
// turned on or off in settings)") ─────────────────────────────────────────────
// One page-wide choice beside the GEX book, in the same menu: Coils named or not
// on every Vela surface (Rail tags, Path beads, Key Levels, the legend card,
// Level Alerts, the session strip). It rides the GEX switch's notify, so every
// reader that follows the book repaints when it flips. Remembered per browser
// under `cb-v3-vela-vt-coil`, followed live by other tabs. Default on.

const COIL_KEY = 'cb-v3-vela-vt-coil'

function readCoil(): boolean {
  try {
    return localStorage.getItem(COIL_KEY) !== '0'
  } catch {
    return true
  }
}

let coilOn = readCoil()

/** Are Coils named (the GEX menu's Coil switch)? */
export function vtCoilOn(): boolean {
  return coilOn
}

/** Flip the Coil switch for every indicator, remember it, and tell every reader. */
export function setVtCoil(on: boolean): void {
  if (on === coilOn) return
  coilOn = on
  try {
    localStorage.setItem(COIL_KEY, on ? '1' : '0')
  } catch {
    /* private mode: it still applies for this visit */
  }
  notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== COIL_KEY) return
    const next = e.newValue !== '0'
    if (next === coilOn) return
    coilOn = next
    notify()
  })
}

// ── Reading a book ───────────────────────────────────────────────────────────

/**
 * A per-minute LADDER cell's value on a book. The ladder's `net` is OI + vol and
 * `netVol` is vol, so OI alone is the difference (as the Rail and Heatmap have
 * always read it).
 */
export function ladderValue(net: number, netVol: number, b: GexBasis = basis): number {
  return b === 'vol' ? netVol : b === 'oi' ? net - netVol : net
}

/** A live CHAIN row's value on a book: `netGEX` is OI GEX, `netVolGEX` is volume GEX. */
export function chainValue(netGEX: number, netVolGEX: number, b: GexBasis = basis): number {
  const oi = Number.isFinite(netGEX) ? netGEX : 0
  const vol = Number.isFinite(netVolGEX) ? netVolGEX : 0
  return b === 'vol' ? vol : b === 'oi' ? oi : oi + vol
}

/**
 * The gamma flip on a book: where net GEX changes sign from one strike to the
 * next, interpolated, the crossing nearest spot (the server's flipFromGexRows).
 */
export function flipOf(rows: ReadonlyArray<{ strike: number; net: number }>, spot: number | null | undefined): number | null {
  const s = rows.filter((r) => r.strike > 0 && Number.isFinite(r.net)).slice().sort((a, b) => a.strike - b.strike)
  const xs: number[] = []
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i]!.net
    const b = s[i + 1]!.net
    if (a === 0) xs.push(s[i]!.strike)
    else if ((a > 0 && b < 0) || (a < 0 && b > 0)) {
      const k0 = s[i]!.strike
      const k1 = s[i + 1]!.strike
      xs.push(Math.round((k0 + ((k1 - k0) * Math.abs(a)) / (Math.abs(a) + Math.abs(b))) * 10) / 10)
    }
  }
  if (!xs.length) return null
  if (!(spot != null && spot > 0)) return xs[0]!
  return xs.reduce((best, x) => (Math.abs(x - spot) < Math.abs(best - spot) ? x : best))
}
