import { expect, test } from "bun:test"
import { fetchTickers, parseSpark } from "./tickers"

const answer = { spark: { result: [
  { symbol: "BHP.AX", response: [{ meta: { regularMarketPrice: 57.56, regularMarketChangePercent: 0.07 } }] },
  { symbol: "^AXJO", response: [{ meta: { regularMarketPrice: 8908.1, regularMarketChangePercent: 0.18 } }] },
  { symbol: "BAD", response: [{ meta: { regularMarketPrice: null } }] },
] } }

test("Yahoo's answer becomes tickers, named and in the list's order; ones without a price left out", () => {
  const names = new Map([["^AXJO", { name: "ASX200", group: "Indices" as const }], ["BHP.AX", { name: "BHP", group: "ASX" as const }], ["BAD", { name: "BAD", group: "US" as const }]])
  expect(parseSpark(answer, names)).toEqual([{ name: "ASX200", group: "Indices", price: 8908.1, change: 0.18 }, { name: "BHP", group: "ASX", price: 57.56, change: 0.07 }])
  expect(parseSpark({ nonsense: true }, names)).toEqual([])
})

test("no answer, a bad one, or nothing priced: null, so the tape keeps its made-up tickers", async () => {
  expect(await fetchTickers((async () => { throw new Error("offline") }) as unknown as typeof fetch)).toBeNull()
  expect(await fetchTickers((async () => new Response("no", { status: 429 })) as unknown as typeof fetch)).toBeNull()
  expect(await fetchTickers((async () => Response.json({ spark: { result: [] } })) as unknown as typeof fetch)).toBeNull()
  const ok = await fetchTickers((async () => Response.json(answer)) as unknown as typeof fetch)
  expect(ok?.map((t) => t.name)).toEqual(["ASX200", "BHP"])
})
