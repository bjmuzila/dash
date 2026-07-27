// Static ticker lists for the Options page selector. Swap for the real
// favorites/watchlist API when data gets wired up.
export type TickerList = "favorites" | "watchlist";

export type Ticker = { symbol: string; name: string };

export const TICKER_LISTS: Record<TickerList, { label: string; items: Ticker[] }> = {
  favorites: {
    label: "Favorites",
    items: [
      { symbol: "SPX", name: "S&P 500 Index" },
      { symbol: "SPY", name: "SPDR S&P 500 ETF" },
      { symbol: "QQQ", name: "Invesco QQQ Trust" },
      { symbol: "ES", name: "E-mini S&P 500 Future" },
      { symbol: "NQ", name: "E-mini Nasdaq 100 Future" },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "TSLA", name: "Tesla Inc" },
    ],
  },
  watchlist: {
    label: "Watchlist",
    items: [
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "AMZN", name: "Amazon.com Inc" },
      { symbol: "META", name: "Meta Platforms" },
      { symbol: "AMD", name: "Advanced Micro Devices" },
      { symbol: "GOOGL", name: "Alphabet Inc" },
      { symbol: "IWM", name: "iShares Russell 2000 ETF" },
      { symbol: "VIX", name: "CBOE Volatility Index" },
    ],
  },
};

export const DEFAULT_TICKER = "SPX";

export function findTicker(symbol: string): Ticker | undefined {
  for (const key of Object.keys(TICKER_LISTS) as TickerList[]) {
    const hit = TICKER_LISTS[key].items.find((t) => t.symbol === symbol);
    if (hit) return hit;
  }
  return undefined;
}
