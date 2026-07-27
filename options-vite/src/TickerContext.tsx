import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_TICKER, findTicker, type TickerList } from './data/tickers'

type TickerCtx = {
  ticker: string
  name: string
  list: TickerList
  setTicker: (symbol: string) => void
  setList: (list: TickerList) => void
}

const Ctx = createContext<TickerCtx | null>(null)

export function TickerProvider({ children }: { children: ReactNode }) {
  const [ticker, setTicker] = useState(DEFAULT_TICKER)
  const [list, setList] = useState<TickerList>('favorites')

  const value = useMemo<TickerCtx>(
    () => ({ ticker, name: findTicker(ticker)?.name ?? ticker, list, setTicker, setList }),
    [ticker, list],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// Every card on every page reads the selected ticker from here.
export function useTicker(): TickerCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTicker must be used inside <TickerProvider>')
  return ctx
}
