export type ProxyFeedType = "Quote" | "Trade" | "Summary" | "Greeks" | "TradeETH" | "TimeAndSale";

export type ProxyFeedItem = Record<string, unknown> & {
  eventType: string;
  eventSymbol: string;
};

export function normalizeProxyFeedData(data: unknown[]): ProxyFeedItem[] {
  if (!Array.isArray(data) || !data.length) return [];
  if (typeof data[0] === "object" && data[0] !== null && !Array.isArray(data[0])) {
    return data as ProxyFeedItem[];
  }

  const eventType = data[0] as string;
  const rows = data[1] as unknown[];
  if (typeof eventType !== "string" || !Array.isArray(rows)) return [];

  const fieldsByType: Record<string, string[]> = {
    Quote: ["bidPrice", "askPrice", "bidSize", "askSize"],
    Trade: ["price", "dayVolume", "size"],
    Summary: ["dayId", "dayOpenPrice", "dayHighPrice", "dayLowPrice", "dayClosePrice", "prevDayId", "prevDayClosePrice", "openInterest"],
    Greeks: ["volatility", "delta", "gamma", "theta", "rho", "vega"],
    TimeAndSale: ["time", "sequence", "exchangeCode", "price", "size", "bidPrice", "askPrice", "saleConditions", "flags", "aggressorSide"],
    TradeETH: ["price", "dayVolume", "size"],
  };

  const fields = fieldsByType[eventType];
  if (!fields) return [];

  const hasType = rows[0] === eventType;
  const step = fields.length + (hasType ? 2 : 1);
  const out: ProxyFeedItem[] = [];

  for (let i = 0; i <= rows.length - step; i += step) {
    const base = i + (hasType ? 2 : 1);
    const item: Record<string, unknown> = {
      eventType: hasType ? rows[i] : eventType,
      eventSymbol: hasType ? rows[i + 1] : rows[i],
    };
    fields.forEach((field, index) => {
      item[field] = rows[base + index];
    });
    out.push(item as ProxyFeedItem);
  }

  return out;
}

export async function ensureProxyLiveSubscription(
  pageId: string,
  symbols: string[],
  feedTypesBySymbol: Record<string, string[]>,
  threshold = 1,
  timeout = 8000,
) {
  if (!symbols.length) return;

  await fetch("/api/proxy/subscription-ready", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId,
      symbols,
      timeout,
      threshold,
    }),
  }).catch(() => null);

  await fetch("/api/proxy/dxlink-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbols,
      feedTypesBySymbol,
    }),
  }).catch(() => null);
}
