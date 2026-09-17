import { useEffect, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Is this a phone?
//
// v3 had no answer to that question at all, which is why every card was built
// for a pointer. This is the one place that decides, so a card asks `useIsPhone()`
// rather than inventing its own width check — three cards with three different
// breakpoints is how a layout ends up half-converted.
//
// The test is v2's (`components/mobile/mobileNav.ts`), deliberately: the two
// builds must agree about what a phone is or a device can be a phone to one app
// and a desktop to the other on the same screen.
//
//   width alone            misclassifies a narrow desktop window
//   pointer:coarse alone   misclassifies a touchscreen laptop
//   width AND (coarse OR no-hover)   gets iPhone/Android right and leaves a
//                                    resized browser alone
//
// Two MediaQueryList objects rather than one `(A) and ((B) or (C))` string:
// boolean `or` inside a media query is Media Queries 4 and not old enough to
// rely on here, and it fails CLOSED — an unparseable query never matches, so
// the phone layout would simply never appear and nothing would say why.
// ─────────────────────────────────────────────────────────────────────────────

export const PHONE_MAX_WIDTH = 820

const NARROW = `(max-width: ${PHONE_MAX_WIDTH}px)`
const COARSE = '(pointer: coarse)'
const NO_HOVER = '(hover: none)'

export function isPhoneViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (!window.matchMedia(NARROW).matches) return false
  return window.matchMedia(COARSE).matches || window.matchMedia(NO_HOVER).matches
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(isPhoneViewport)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const lists = [NARROW, COARSE, NO_HOVER].map((q) => window.matchMedia(q))
    const sync = () => setPhone(isPhoneViewport())
    // Re-read on every one of them: a rotation changes the width match, and a
    // phone plugged into a mouse changes the pointer match without the width
    // moving at all.
    for (const l of lists) l.addEventListener('change', sync)
    sync()
    return () => {
      for (const l of lists) l.removeEventListener('change', sync)
    }
  }, [])

  return phone
}
