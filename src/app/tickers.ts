/**
 * Real market prices for the welcome page's ticker tape (welcome/backdrop):
 * Yahoo Finance's public spark endpoint, no key, prices delayed as Yahoo
 * gives them. Asked only while the tape shows; anything wrong (offline, a
 * changed endpoint, a slow answer) and the tape keeps its made-up tickers.
 * Nothing of yours is sent: only the symbols below.
 */
export interface Ticker { name: string; price: number; change: number }

/** What the tape shows, as Yahoo names them, and what to call them. */
const SYMBOLS: Array<[string, string]> = [
  ["^AXJO", "ASX200"], ["CBA.AX", "CBA"], ["BHP.AX", "BHP"], ["CSL.AX", "CSL"], ["NAB.AX", "NAB"], ["WBC.AX", "WBC"], ["ANZ.AX", "ANZ"],
  ["WES.AX", "WES"], ["WOW.AX", "WOW"], ["COL.AX", "COL"], ["QAN.AX", "QAN"], ["TLS.AX", "TLS"], ["XRO.AX", "XRO"], ["WTC.AX", "WTC"],
  ["MQG.AX", "MQG"], ["FMG.AX", "FMG"], ["RIO.AX", "RIO"], ["JBH.AX", "JBH"], ["REA.AX", "REA"], ["TCL.AX", "TCL"],
  ["^GSPC", "S&P500"], ["^IXIC", "NASDAQ"], ["AAPL", "AAPL"], ["NVDA", "NVDA"], ["MSFT", "MSFT"], ["AMZN", "AMZN"], ["GOOGL", "GOOGL"], ["TSLA", "TSLA"],
  ["AUDUSD=X", "AUD/USD"], ["AUDEUR=X", "AUD/EUR"], ["AUDJPY=X", "AUD/JPY"], ["BTC-AUD", "BTC"], ["ETH-AUD", "ETH"],
  ["GC=F", "GOLD"], ["SI=F", "SILVER"], ["CL=F", "OIL"],
]
/** Yahoo's spark answers up to 20 symbols a request. */
const BATCH = 20
const TIMEOUT_MS = 4000

/** Every symbol's latest price and change today, or null when Yahoo can't be reached. */
export async function fetchTickers(fetcher: typeof fetch = fetch): Promise<Ticker[] | null> {
  const names = new Map(SYMBOLS)
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
export function parseSpark(body: unknown, names: ReadonlyMap<string, string>): Ticker[] {
  const results = (body as { spark?: { result?: Array<{ symbol?: string; response?: Array<{ meta?: { regularMarketPrice?: unknown; regularMarketChangePercent?: unknown } }> }> } })?.spark?.result ?? []
  const bySymbol = new Map<string, Ticker>()
  for (const r of results) {
    const meta = r.response?.[0]?.meta
    const price = meta?.regularMarketPrice, change = meta?.regularMarketChangePercent
    if (!r.symbol || typeof price !== "number" || !Number.isFinite(price)) continue
    bySymbol.set(r.symbol, { name: names.get(r.symbol) ?? r.symbol, price, change: typeof change === "number" && Number.isFinite(change) ? change : 0 })
  }
  return [...names.keys()].flatMap((s) => (bySymbol.has(s) ? [bySymbol.get(s)!] : []))
}
