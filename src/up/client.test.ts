import { describe, expect, test } from "bun:test"
import { createUpClient, readUpToken, UpApiError } from "./client"
import type { UpAccount, UpPage } from "./types"

const token = "secret-test-pat"
const account: UpAccount = { type: "accounts", id: "a", attributes: { displayName: "Daily", accountType: "TRANSACTIONAL", ownershipType: "INDIVIDUAL", balance: { currencyCode: "AUD", value: "1.00", valueInBaseUnits: 100 }, createdAt: "2026-01-01T00:00:00+11:00" } }
function page(data: UpAccount[], next: string | null = null) { return Response.json({ data, links: { prev: null, next } } satisfies UpPage<UpAccount>) }

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

  test("account transactions encode the path segment, page with since, retry, redact, and guard the origin", async () => {
    const calls: URL[] = [], delays: number[] = []
    const client = createUpClient({ token, sleep: async ms => { delays.push(ms) }, fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url)
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`)
      expect(init?.redirect).toBe("manual")
      if (calls.length === 1) return new Response("", { status: 429, headers: { "Retry-After": "2" } })
      return calls.length === 2 ? page([], "?page[after]=next") : page([])
    } })
    expect(await client.listAccountTransactions("a/b ?#%", { since: "2026-02-01T00:00:00+11:00" })).toEqual([])
    expect(calls.map(url => url.pathname)).toEqual(Array(3).fill("/api/v1/accounts/a%2Fb%20%3F%23%25/transactions"))
    expect(calls[0]?.searchParams.get("page[size]")).toBe("100")
    expect(calls[0]?.searchParams.get("filter[since]")).toBe("2026-02-01T00:00:00+11:00")
    expect(calls[2]?.searchParams.get("page[after]")).toBe("next")
    expect(delays).toEqual([2000])
    let guardedCalls = 0
    const guarded = createUpClient({ token, fetch: async input => {
      guardedCalls++
      expect(new URL(String(input)).searchParams.has("filter[since]")).toBe(false)
      return page([], `https://evil.example/${token}`)
    } })
    await expect(guarded.listAccountTransactions("a")).rejects.toThrow("foreign origin")
    expect(guardedCalls).toBe(1)
    const failing = createUpClient({ token, fetch: async () => { throw new Error(`Network ${token}`) } })
    await expect(failing.listAccountTransactions("a")).rejects.toThrow("Network [redacted]")
  })

  test("auth, page size, since, ping, and newest-first pagination", async () => {
    const calls: URL[] = []
    const client = createUpClient({ token, baseUrl: "https://test.example/v1", fetch: async (input, init) => {
      const url = new URL(String(input)); calls.push(url)
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${token}`)
      expect(init?.redirect).toBe("manual")
      if (url.pathname.endsWith("/ping")) return Response.json({ meta: { id: "customer" } })
      if (url.pathname.endsWith("/transactions")) return page([])
      return calls.length === 1 ? page([account], "https://test.example/v1/accounts?page[after]=a") : page([{ ...account, id: "b" }])
    } })
    expect((await client.listAccounts()).map(a => a.id)).toEqual(["a", "b"])
    expect(calls[0]?.searchParams.get("page[size]")).toBe("100")
    expect(calls[1]?.searchParams.get("page[after]")).toBe("a")
    await client.listTransactions({ since: "2026-02-01T00:00:00+11:00" })
    expect(calls[2]?.searchParams.get("filter[since]")).toBe("2026-02-01T00:00:00+11:00")
    expect(calls[2]?.searchParams.get("page[size]")).toBe("100")
    await client.ping()
    expect(calls[3]?.pathname).toBe("/v1/util/ping")
  })

  test("foreign-origin pagination is refused before fetch", async () => {
    let calls = 0
    const client = createUpClient({ token, fetch: async () => { calls++; return page([], `https://evil.example/${token}`) } })
    await expect(client.listAccounts()).rejects.toThrow("foreign origin")
    expect(calls).toBe(1)
  })

  test("401 gives PAT instructions; API errors keep status, title, detail", async () => {
    for (const status of [401, 403, 500, 302]) {
      const client = createUpClient({ token, fetch: async () => Response.json({ errors: [{ title: `Denied ${token}`, detail: `Detail ${token}` }] }, { status }) })
      try { await client.ping(); throw new Error("Expected failure") } catch (error) {
        expect(error).toBeInstanceOf(UpApiError)
        if (!(error instanceof UpApiError)) throw error
        expect(error.status).toBe(status)
        expect(error.message).not.toContain(token)
        if (status === 401) {
          expect(error.message).toContain("invalid or expired")
          expect(error.message).toContain("https://api.up.com.au")
        } else { expect(error.message).toContain("Denied"); expect(error.message).toContain("Detail") }
      }
    }
  })

  test("429 honours Retry-After and retries at most three times", async () => {
    for (const retryAfter of ["7", null]) {
      let calls = 0
      const delays: number[] = []
      const client = createUpClient({ token, sleep: async ms => { delays.push(ms) }, fetch: async () => {
        calls++
        return new Response("", { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} })
      } })
      await expect(client.listAccounts()).rejects.toThrow("429")
      expect(calls).toBe(4)
      expect(delays).toEqual(retryAfter ? [7000, 7000, 7000] : [1000, 2000, 4000])
    }
    let calls = 0
    const client = createUpClient({ token, sleep: async () => {}, fetch: async () => ++calls === 1 ? new Response("", { status: 429 }) : page([]) })
    expect(await client.listAccounts()).toEqual([])
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

  test("readUpToken trims and rejects missing or blank PAT", () => {
    expect(readUpToken({ JASKMONEY_UP_TOKEN: "  abc\n" })).toBe("abc")
    for (const env of [{}, { JASKMONEY_UP_TOKEN: "  " }]) expect(() => readUpToken(env)).toThrow("Set JASKMONEY_UP_TOKEN to an Up Personal Access Token (create one at https://api.up.com.au)")
  })
})
