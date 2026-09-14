// ─────────────────────────────────────────────────────────────────────────────
// EARNINGS-CHIP COMPANY LOGO
//
// Transcribed from v2's components/shared/ChipLogo.tsx (Part Q12 of
// docs/parity/economic-calendar.md). v3 had no equivalent — the only logo URLs
// in this app were raw strings inside board/econCalendar/econTemplate.ts.
//
// Resolution order, and all three stages matter:
//
//   1. /logos/<SYM>.png?v=LOGO_REV — mirrored, same-origin, immutably cached.
//      Preferred because stage 2 costs TWO round trips per chip: a PG lookup, a
//      HEAD to GitHub and up to two Wikidata calls before it answers.
//   2. /proxy/ticker-logo?raw=1 — the live resolver, for symbols not mirrored
//      yet. `raw=1` is LOAD-BEARING: it makes the proxy STREAM the bytes rather
//      than 302 to a third-party host. A redirected image taints a capture
//      canvas and toBlob then throws, which used to kill the whole earnings
//      board PNG over one 16px image.
//   3. The PARENT ticker's mirrored PNG, for share classes only — LEN.B borrows
//      Lennar's. Upstream files one icon per company under the ordinary class,
//      so a B share misses stages 1 and 2 every time. See classParent.
//   4. A ticker-text chip. Nothing resolved.
//
// The ?v query is not decoration. v2's next.config.js serves /logos/:path* with
// `Cache-Control: immutable, max-age=1y` and applies it to the PATH, with no
// idea whether the file exists — so a 404 for an unmirrored ticker was cached
// as immutable and the browser refused to ask again for a YEAR. Adding the PNG
// later changed nothing. Each mirror generation being a distinct URL is what
// fixes the browsers already holding a bad entry.
//
// ⚠ BUMP LOGO_REV IN STEP WITH v2's components/shared/ChipLogo.tsx whenever
// files are added to public/logos. Two apps read one mirror.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { CAL, T, alpha } from '@/design/theme'

/** Mirror revision. Must match v2's LOGO_REV. 2026-09-13: +4,303 mirrored logos
 *  (full davidepalazzo/ticker-logos set, 5,118 total in public/logos). */
export const LOGO_REV = 4

function localLogoUrl(sym: string): string {
  return `/logos/${encodeURIComponent(sym.toUpperCase())}.png?v=${LOGO_REV}`
}

function proxyLogoUrl(sym: string, name?: string): string {
  return `/proxy/ticker-logo?raw=1&sym=${encodeURIComponent(sym.toUpperCase())}&name=${encodeURIComponent(name || '')}`
}

/**
 * THE PARENT TICKER OF A SHARE CLASS, or null when there isn't one.
 *
 * `LEN.B` is Lennar. `HEI.A` is HEICO. The upstream icon set files exactly one
 * PNG per COMPANY and names it after the ordinary class — of 5,107 icons exactly
 * one carries a dot — so every B share on the board falls through the mirror and
 * the live resolver both, and prints as a text square next to its own parent's
 * logo two cells over. That is the failure this exists to stop.
 *
 * A hand-cropped `PBR.A.png` in the mirror still wins: this is tried only after
 * the exact symbol has already missed, in the mirror AND at the resolver. See
 * MANUAL in scripts/fetch-ticker-logos.mjs, which protects those files.
 *
 * Deliberately narrow — one letter after a dot or a dash, nothing else. A loose
 * rule here does not degrade, it MISLABELS: strip more and `BRK.B` stops being
 * Berkshire's B share and starts being whatever `BRK` happens to be.
 */
function classParent(sym: string): string | null {
  const up = sym.toUpperCase()
  const m = /^([A-Z]{1,5})[.-][A-Z]$/.exec(up)
  // `noUncheckedIndexedAccess` is on, so a matched group is still `| undefined`
  // to the compiler. Bind it before testing rather than returning `m[1]`.
  const root = m?.[1]
  return root && root !== up ? root : null
}

export function ChipLogo({
  sym,
  company,
  size = 30,
  radius = 7,
  lazy = true,
}: {
  sym: string
  company?: string
  size?: number
  radius?: number
  /**
   * Off for anything that gets photographed. The capture clones the DOM as it
   * stands, so a chip below the fold the browser has not fetched yet captures
   * empty — on the week board that was most of Wednesday and Thursday.
   */
  lazy?: boolean
}) {
  const [stage, setStage] = useState<'local' | 'proxy' | 'parent' | 'text'>('local')

  // Computed once per render rather than inside the error handler: whether a
  // fourth stage exists at all decides where stage 2 hands off to.
  const parent = classParent(sym)

  function nextStage(s: typeof stage): typeof stage {
    if (s === 'local') return 'proxy'
    if (s === 'proxy') return parent ? 'parent' : 'text'
    return 'text'
  }

  if (stage === 'text') {
    return (
      <span
        className="flex shrink-0 items-center justify-center text-center font-extrabold leading-none"
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: alpha(CAL.accent, 0.1),
          border: `1px solid ${alpha(T.text, 0.1)}`,
          // Not on the type scale by construction — it is derived from the chip
          // size, which is a prop. check-theme's rule 4 matches a bare NUMBER
          // literal after `fontSize:`, not an expression.
          fontSize: `${Math.max(9, Math.round(size / 3))}px`,
          color: CAL.accent,
        }}
      >
        {sym.slice(0, 4)}
      </span>
    )
  }

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden bg-transparent"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        // Remount on stage change so the browser actually re-requests.
        key={stage}
        src={
          stage === 'local'
            ? localLogoUrl(sym)
            : stage === 'parent'
              ? localLogoUrl(parent as string)
              : proxyLogoUrl(sym, company)
        }
        alt={sym}
        width={size}
        height={size}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        style={{ width: size, height: size, objectFit: 'contain' }}
        onError={() => setStage(nextStage)}
      />
    </span>
  )
}
