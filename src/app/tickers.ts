/**
 * Real market prices for the welcome page's ticker tape (welcome/backdrop):
 * Yahoo Finance's public spark endpoint, no key, prices delayed as Yahoo
 * gives them. Asked only while the tape shows; anything wrong (offline, a
 * changed endpoint, a slow answer) and the tape keeps its made-up tickers.
 * Nothing of yours is sent: only the symbols below.
 */
export interface Ticker { name: string; price: number; change: number; group: TickerGroup }

/** What a tape carries: one kind each, as Yahoo types them (instrumentType:
 * EQUITY, INDEX, CURRENCY, CRYPTOCURRENCY, FUTURE), equities split by
 * market. */
type TickerGroup = "Indices" | "ASX" | "US" | "FX" | "Crypto" | "Commodities"

/** What the tapes show, as Yahoo names them, what to call them, and their kind. */
const SYMBOLS: Array<[string, string, TickerGroup]> = [
  ...([["^AXJO", "ASX200"], ["^GSPC", "S&P500"], ["^IXIC", "NASDAQ"], ["^DJI", "DOW"], ["^N225", "NIKKEI"], ["^FTSE", "FTSE"], ["^HSI", "HANGSENG"], ["^GDAXI", "DAX"]] as const).map(([s, n]): [string, string, TickerGroup] => [s, n, "Indices"]),
  ...(["CBA", "BHP", "CSL", "NAB", "WBC", "ANZ", "WES", "WOW", "COL", "QAN", "TLS", "XRO", "WTC", "MQG", "FMG", "RIO", "JBH", "REA", "TCL", "GMG"] as const).map((n): [string, string, TickerGroup] => [`${n}.AX`, n, "ASX"]),
  ...(["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "TSLA", "META", "NFLX"] as const).map((n): [string, string, TickerGroup] => [n, n, "US"]),
  ...(["AUDUSD", "AUDEUR", "AUDGBP", "AUDJPY", "AUDNZD", "AUDCNY", "AUDSGD", "EURUSD", "GBPUSD", "USDJPY"] as const).map((p): [string, string, TickerGroup] => [`${p}=X`, `${p.slice(0, 3)}/${p.slice(3)}`, "FX"]),
  ...(["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE"] as const).map((c): [string, string, TickerGroup] => [`${c}-AUD`, c, "Crypto"]),
  ...([["GC=F", "GOLD"], ["SI=F", "SILVER"], ["CL=F", "OIL"], ["NG=F", "GAS"], ["HG=F", "COPPER"], ["ZW=F", "WHEAT"], ["KC=F", "COFFEE"], ["CC=F", "COCOA"]] as const).map(([s, n]): [string, string, TickerGroup] => [s, n, "Commodities"]),
]
/** Yahoo's spark answers up to 20 symbols a request. */
const BATCH = 20
const TIMEOUT_MS = 4000

/** Every symbol's latest price and change today, or null when Yahoo can't be reached. */
export async function fetchTickers(fetcher: typeof fetch = fetch): Promise<Ticker[] | null> {
  const names = new Map(SYMBOLS.map(([s, n, g]) => [s, { name: n, group: g }]))
  const batches = Array.from({ length: Math.ceil(SYMBOLS.length / BATCH) }, (_, i) => SYMBOLS.slice(i * BATCH, (i + 1) * BATCH).map(([s]) => s))
  try {
    const answers = await Promise.all(batches.map(async (symbols) => {
      const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(",")}&range=1d&interval=1d`
      const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0" } })
      if (!response.ok) throw new Error(`Yahoo answered ${response.status}`)
      return ((await response.json()) as { spark?: { result?: unknown[] } })?.spark?.result ?? []
    }))
    // One list from every batch, each symbol once, in SYMBOLS' order.
    const tickers = parseSpark({ spark: { result: answers.flat() } }, names)
    return tickers.length ? tickers : null
  } catch {
    return null
  }
}

/** Yahoo's spark answer → tickers, in SYMBOLS' order; ones without a price left out. */
function parseSpark(body: unknown, names: ReadonlyMap<string, { name: string; group: TickerGroup }>): Ticker[] {
  const results = (body as { spark?: { result?: Array<{ symbol?: string; response?: Array<{ meta?: { regularMarketPrice?: unknown; regularMarketChangePercent?: unknown } }> }> } })?.spark?.result ?? []
  const bySymbol = new Map<string, Ticker>()
  for (const r of results) {
    const meta = r.response?.[0]?.meta
    const price = meta?.regularMarketPrice, change = meta?.regularMarketChangePercent
    if (!r.symbol || typeof price !== "number" || !Number.isFinite(price)) continue
    const known = names.get(r.symbol)
    if (!known) continue
    bySymbol.set(r.symbol, { ...known, price, change: typeof change === "number" && Number.isFinite(change) ? change : 0 })
  }
  return [...names.keys()].flatMap((s) => (bySymbol.has(s) ? [bySymbol.get(s)!] : []))
}
