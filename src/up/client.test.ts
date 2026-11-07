import { describe, expect, test } from "bun:test"
import { createUpClient, UpApiError } from "./client"
import type { UpAccount, UpPage, UpTransaction } from "./types"

const token = "secret-test-pat"
const account: UpAccount = { type: "accounts", id: "a", attributes: { displayName: "Daily", accountType: "TRANSACTIONAL", ownershipType: "INDIVIDUAL", balance: { currencyCode: "AUD", value: "1.00", valueInBaseUnits: 100 }, createdAt: "2026-01-01T00:00:00+11:00" } }
function page(data: UpAccount[], next: string | null = null) { return Response.json({ data, links: { prev: null, next } } satisfies UpPage<UpAccount>) }

function transaction(): UpTransaction {
  return { type: "transactions", id: "t", attributes: {
    status: "SETTLED", description: "Merchant", rawText: null, message: null, amount: account.attributes.balance,
    foreignAmount: null, createdAt: account.attributes.createdAt, settledAt: null, transactionType: null,
    isCategorizable: true, roundUp: null, cashback: null, cardPurchaseMethod: null,
  }, relationships: {
    account: { data: { type: "accounts", id: "a" } }, transferAccount: { data: null }, category: { data: null },
    parentCategory: { data: null }, tags: { data: [] },
  } }
}

describe("Up client", () => {
  test("account IDs cannot traverse the URL path", async () => {
    const paths: string[] = []
    const client = createUpClient({ token, fetch: async input => {
      paths.push(new URL(String(input)).pathname)
      return page([])
    } })
    for (const id of [".", ".."]) await expect(client.listAccountTransactions(id)).rejects.toThrow("Invalid Up account ID")
    expect(paths).toEqual([])
    await client.listAccountTransactions("a/../b")
    expect(paths).toEqual(["/api/v1/accounts/a%2F..%2Fb/transactions"])
  })

  test("token is absent from transport, sleep, URL, parse, and validation errors and returned data", async () => {
    const clients = [
      createUpClient({ token, fetch: async () => { throw new Error(`Network ${token}`) } }),
      createUpClient({ token, fetch: async () => new Response("", { status: 429 }), sleep: async () => { throw new Error(`Timer ${token}`) } }),
      createUpClient({ token, fetch: async () => page([], `http://[${token}`) }),
      createUpClient({ token, fetch: async () => new Response(token) }),
      createUpClient({ token, fetch: async () => Response.json({ data: [token] }) }),
    ]
    for (const client of clients) {
      try { await client.listAccounts(); throw new Error("Expected failure") } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect(String(error)).not.toContain(token)
      }
    }
    const client = createUpClient({ token, fetch: async () => page([{ ...account, attributes: { ...account.attributes, displayName: token } }]) })
    expect(JSON.stringify(await client.listAccounts())).not.toContain(token)
  })

  test("JSON-escaped token echoes and injected UpApiError messages are redacted", async () => {
    const escaped = Array.from(token, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")
    const body = { data: [{ ...account, attributes: { ...account.attributes, displayName: token }, [token]: token }], links: { prev: null, next: null } }
    const success = createUpClient({ token, fetch: async () => new Response(JSON.stringify(body).replaceAll(token, escaped)) })
    expect(JSON.stringify(await success.listAccounts())).not.toContain(token)
    const failure = createUpClient({ token, fetch: async () => { throw new UpApiError(503, `Transport ${token}`) } })
    try { await failure.ping(); throw new Error("Expected failure") } catch (error) {
      expect(error).toBeInstanceOf(UpApiError)
      if (!(error instanceof UpApiError)) throw error
      expect(error.status).toBe(503)
      expect(error.message).not.toContain(token)
    }
    const apiError = createUpClient({ token, fetch: async () => new Response(JSON.stringify({ errors: [{ title: token, detail: token }] }).replaceAll(token, escaped), { status: 500 }) })
    try { await apiError.ping(); throw new Error("Expected failure") } catch (error) {
      expect(error).toBeInstanceOf(UpApiError)
      expect(String(error)).not.toContain(token)
    }
  })

  test("relative page links stay on the base origin; protocol-relative and downgrade links cannot escape", async () => {
    for (const next of ["?page[after]=a", "/api/v1/accounts?page[after]=a", "//api.up.com.au/api/v1/accounts?page[after]=a",
      "//evil.example/accounts", "http://api.up.com.au/api/v1/accounts", "https://api.up.com.au:444/accounts"]) {
      let calls = 0
      const client = createUpClient({ token, fetch: async input => {
        expect(new URL(String(input)).origin).toBe("https://api.up.com.au")
        return ++calls === 1 ? page([account], next) : page([])
      } })
      if (["//evil.example/accounts", "http://api.up.com.au/api/v1/accounts", "https://api.up.com.au:444/accounts"].includes(next)) {
        await expect(client.listAccounts()).rejects.toThrow("foreign origin")
        expect(calls).toBe(1)
      } else {
        expect(await client.listAccounts()).toEqual([account])
        expect(calls).toBe(2)
      }
    }
  })

  test("transaction defaults apply only to missing new fields; nested objects follow the spec", async () => {
    const amount = account.attributes.balance
    const attributes = { ...transaction().attributes, roundUp: { amount, boostPortion: amount },
      cashback: { description: "Reward", amount }, cardPurchaseMethod: { method: "CONTACTLESS", cardNumberSuffix: "0123" } }
    const parse = (attrs: unknown) => createUpClient({ token, fetch: async () => Response.json({ data: [{ ...transaction(), attributes: attrs }], links: { prev: null, next: null } }) }).listTransactions()
    expect((await parse(attributes))[0]?.attributes).toEqual(attributes)
    expect((await parse({ ...attributes, roundUp: { amount, boostPortion: null }, cardPurchaseMethod: { method: "OCR", cardNumberSuffix: null } }))[0]?.attributes.cardPurchaseMethod?.cardNumberSuffix).toBeNull()
    const missing = Object.fromEntries(Object.entries(attributes).filter(([key]) => !["isCategorizable", "roundUp", "cashback", "cardPurchaseMethod"].includes(key)))
    expect((await parse(missing))[0]?.attributes).toMatchObject({ isCategorizable: true, roundUp: null, cashback: null, cardPurchaseMethod: null })
    for (const patch of [
      { isCategorizable: null }, { isCategorizable: 1 }, { roundUp: [] }, { roundUp: { amount } },
      { roundUp: { amount, boostPortion: {} } }, { roundUp: { amount: { ...amount, valueInBaseUnits: 1.5 }, boostPortion: null } },
      { cashback: { amount } }, { cashback: { description: "Reward", amount: null } },
      { cardPurchaseMethod: { method: "UNKNOWN", cardNumberSuffix: null } }, { cardPurchaseMethod: { method: "OCR" } },
      { cardPurchaseMethod: { method: "OCR", cardNumberSuffix: 1234 } },
      { amount: null }, { foreignAmount: undefined }, { transactionType: undefined }, { rawText: undefined }, { status: "unknown" },
    ]) await expect(parse({ ...attributes, ...patch })).rejects.toThrow("Invalid Up API page")
  })

  test("category PATCH encodes IDs, sends JSON, retries unchanged, and accepts empty 204", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [], delays: number[] = []
    const client = createUpClient({ token, sleep: async ms => { delays.push(ms) }, fetch: async (input, init) => {
      calls.push({ url: String(input), init })
      return calls.length === 1 ? new Response(null, { status: 429, headers: { "Retry-After": "2" } }) : new Response(null, { status: 204 })
    } })
    for (const id of [".", ".."]) await expect(client.setTransactionCategory(id, null)).rejects.toThrow("Invalid Up transaction ID")
    expect(calls).toEqual([])
    expect(await client.setTransactionCategory("a/../b ?#%", "food")).toBeUndefined()
    expect(await client.setTransactionCategory("a", null)).toBeUndefined()
    expect(delays).toEqual([2000])
    for (const call of calls) {
      expect(call.init?.method).toBe("PATCH")
      expect(call.init?.redirect).toBe("manual")
      const headers = new Headers(call.init?.headers)
      expect(headers.get("Authorization")).toBe(`Bearer ${token}`)
      expect(headers.get("Content-Type")).toBe("application/json")
    }
    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/transactions/a%2F..%2Fb%20%3F%23%25/relationships/category")
    expect(calls[0]).toEqual(calls[1])
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ data: { type: "categories", id: "food" } }))
    expect(calls[2]?.init?.body).toBe('{"data":null}')
    const unexpected = createUpClient({ token, fetch: async () => Response.json({}) })
    await expect(unexpected.setTransactionCategory("a", null)).rejects.toThrow("expected 204")
  })
})
