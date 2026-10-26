import type { UpAccount, UpPage, UpTransaction } from "./types"

export class UpApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "UpApiError"
  }
}

export function readUpToken(env: Record<string, string | undefined> = process.env): string {
  const token = env.JASKMONEY_UP_TOKEN?.trim()
  if (!token) throw new Error("Set JASKMONEY_UP_TOKEN to an Up Personal Access Token (create one at https://api.up.com.au)")
  return token
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function money(value: unknown): boolean {
  return object(value) && typeof value.currencyCode === "string" && typeof value.value === "string" && Number.isInteger(value.valueInBaseUnits)
}
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string" }
function relationship(value: unknown, type: string, nullable = true): boolean {
  return object(value) && ((nullable && value.data === null) ||
    (object(value.data) && value.data.type === type && typeof value.data.id === "string"))
}
function isAccount(value: unknown): value is UpAccount {
  if (!object(value) || value.type !== "accounts" || typeof value.id !== "string" || !object(value.attributes)) return false
  const a = value.attributes
  return typeof a.displayName === "string" && (a.accountType === "SAVER" || a.accountType === "TRANSACTIONAL" || a.accountType === "HOME_LOAN") &&
    (a.ownershipType === "INDIVIDUAL" || a.ownershipType === "JOINT") && money(a.balance) && typeof a.createdAt === "string"
}
function isTransaction(value: unknown): value is UpTransaction {
  if (!object(value) || value.type !== "transactions" || typeof value.id !== "string" || !object(value.attributes) || !object(value.relationships)) return false
  const a = value.attributes, r = value.relationships
  return (a.status === "HELD" || a.status === "SETTLED") && typeof a.description === "string" &&
    nullableString(a.rawText) && nullableString(a.message) && money(a.amount) &&
    (a.foreignAmount === null || money(a.foreignAmount)) && typeof a.createdAt === "string" &&
    nullableString(a.settledAt) && nullableString(a.transactionType) && relationship(r.account, "accounts", false) &&
    relationship(r.transferAccount, "accounts") && relationship(r.category, "categories") && relationship(r.parentCategory, "categories") &&
    object(r.tags) && Array.isArray(r.tags.data) && r.tags.data.every(t => object(t) && t.type === "tags" && typeof t.id === "string")
}

export function createUpClient({ token, fetch = globalThis.fetch, baseUrl = "https://api.up.com.au/api/v1", sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) }: {
  token: string
  fetch?: Fetch
  baseUrl?: string
  sleep?: (ms: number) => Promise<void>
}) {
  const redact = (message: string) => token ? message.split(token).join("[redacted]") : message
  function redactValue(value: unknown): unknown {
    if (typeof value === "string") return redact(value)
    if (Array.isArray(value)) return value.map(redactValue)
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactValue(item)]))
    return value
  }
  let origin: string
  try { origin = new URL(baseUrl).origin } catch { throw new Error("Invalid Up API base URL") }
  async function request(url: URL): Promise<unknown> {
    try {
      if (url.origin !== origin) throw new Error("Up pagination URL has a foreign origin")
      for (let retry = 0; ; retry++) {
        // Refuse redirects so fetch cannot forward credentials to another origin.
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" })
        if (response.status === 429 && retry < 3) {
          const header = response.headers.get("Retry-After")
          const seconds = header === null ? NaN : Number(header)
          await sleep(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * 2 ** retry)
          continue
        }
        const text = await response.text()
        let body: unknown
        try { body = redactValue(JSON.parse(text)) } catch { body = null }
        if (!response.ok) {
          let message = `Up API request failed (${response.status})`
          if (object(body) && Array.isArray(body.errors) && object(body.errors[0])) {
            const error = body.errors[0]
            const details = [error.title, error.detail].filter((s): s is string => typeof s === "string" && s.length > 0)
            if (details.length) message += `: ${details.join(": ")}`
          }
          if (response.status === 401) message = "Up token is invalid or expired; create one at https://api.up.com.au"
          throw new UpApiError(response.status, redact(message))
        }
        if (body === null) throw new Error("Invalid Up API JSON response")
        return body
      }
    } catch (error) {
      if (error instanceof UpApiError) throw new UpApiError(error.status, redact(error.message))
      throw new Error(redact(error instanceof Error ? error.message : String(error)))
    }
  }
  async function list<T>(path: string, valid: (value: unknown) => value is T, since?: string): Promise<T[]> {
    try {
      let url: URL | null = new URL(`${baseUrl.replace(/\/$/, "")}/${path}`)
      url.searchParams.set("page[size]", "100")
      if (since !== undefined) url.searchParams.set("filter[since]", since)
      const items: T[] = []
      while (url) {
        const body = await request(url)
        if (!object(body) || !Array.isArray(body.data) || !body.data.every(valid) || !object(body.links) ||
          !nullableString(body.links.prev) || !nullableString(body.links.next)) throw new Error("Invalid Up API page")
        const page: UpPage<T> = { data: body.data, links: { prev: body.links.prev, next: body.links.next } }
        items.push(...page.data)
        url = page.links.next === null ? null : new URL(page.links.next, url)
      }
      return items
    } catch (error) {
      if (error instanceof UpApiError) throw new UpApiError(error.status, redact(error.message))
      throw new Error(redact(error instanceof Error ? error.message : String(error)))
    }
  }
  return {
    async ping(): Promise<void> { await request(new URL(`${baseUrl.replace(/\/$/, "")}/util/ping`)) },
    listAccounts: () => list("accounts", isAccount),
    listTransactions: ({ since }: { since?: string } = {}) => list("transactions", isTransaction, since),
    async listAccountTransactions(accountId: string, { since }: { since?: string } = {}) {
      // URL parsing normalises even percent-encoded dot-only path segments.
      if (accountId === "." || accountId === "..") throw new Error("Invalid Up account ID")
      return list(`accounts/${encodeURIComponent(accountId)}/transactions`, isTransaction, since)
    },
  }
}
