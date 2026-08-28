import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// THE PAGE SYMBOL — one ticker for the whole board.
//
// The toolbar search sets it and every card that CAN follow a ticker follows it.
// That is the reason no card carries its own ticker box any more: four cards
// each with a dropdown is four places to change the same thing and four ways to
// end up looking at three symbols at once and not notice.
//
// ── What can and cannot follow ───────────────────────────────────────────────
// The WebSocket streams exactly ONE underlying (SPX). Cards reading `gex` /
// `spot` therefore have a second, REST path — see board/chainGex.ts — and use
// the socket only when the page symbol IS SPX, where it is live and free.
//
// Flow Tape is the exception with no second path at all: the `flow` frame is
// SPX prints and there is no per-ticker source for them. It says so on its face
// rather than quietly showing SPX under an AMZN heading.
//
// Multi Greek is the other exception, deliberately: four independently typeable
// slots is the entire point of that card, and one page ticker applied to all
// four would leave it comparing a symbol with itself.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'cb-v3-page-symbol'
const DEFAULT_SYMBOL = 'SPX'

/** What the toolbar will accept. Letters, optionally dotted (BRK.B). */
export const PAGE_TICKER_RE = /^[A-Z][A-Z.]{0,5}$/

/** The one symbol the socket actually streams. */
export const SOCKET_SYMBOL = 'SPX'

export function isSocketSymbol(symbol: string): boolean {
  return symbol.toUpperCase() === SOCKET_SYMBOL
}

interface PageSymbolValue {
  symbol: string
  setSymbol: (next: string) => void
}

const Ctx = createContext<PageSymbolValue>({ symbol: DEFAULT_SYMBOL, setSymbol: () => {} })

function readStored(): string {
  try {
    const v = localStorage.getItem(KEY)
    return v && PAGE_TICKER_RE.test(v) ? v : DEFAULT_SYMBOL
  } catch {
    return DEFAULT_SYMBOL
  }
}

export function PageSymbolProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbolState] = useState<string>(() => readStored())

  const setSymbol = useCallback((next: string) => {
    const s = next.trim().toUpperCase()
    if (!PAGE_TICKER_RE.test(s)) return
    setSymbolState(s)
    try {
      localStorage.setItem(KEY, s)
    } catch {
      /* best-effort — the in-memory symbol still drives this session */
    }
  }, [])

  const value = useMemo(() => ({ symbol, setSymbol }), [symbol, setSymbol])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePageSymbol(): PageSymbolValue {
  return useContext(Ctx)
}
