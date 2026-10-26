import type { UpAccount, UpTransaction } from "./types"

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
  const valid = (a.status === "HELD" || a.status === "SETTLED") && typeof a.description === "string" &&
    nullableString(a.rawText) && nullableString(a.message) && money(a.amount) &&
    (a.foreignAmount === null || money(a.foreignAmount)) && typeof a.createdAt === "string" &&
    nullableString(a.settledAt) && nullableString(a.transactionType) &&
    (a.isCategorizable === undefined || typeof a.isCategorizable === "boolean") &&
    (a.roundUp === undefined || a.roundUp === null || (object(a.roundUp) && money(a.roundUp.amount) && (a.roundUp.boostPortion === null || money(a.roundUp.boostPortion)))) &&
    (a.cashback === undefined || a.cashback === null || (object(a.cashback) && typeof a.cashback.description === "string" && money(a.cashback.amount))) &&
    (a.cardPurchaseMethod === undefined || a.cardPurchaseMethod === null || (object(a.cardPurchaseMethod) &&
      typeof a.cardPurchaseMethod.method === "string" && ["BAR_CODE", "OCR", "CARD_PIN", "CARD_DETAILS", "CARD_ON_FILE", "ECOMMERCE", "MAGNETIC_STRIPE", "CONTACTLESS"].includes(a.cardPurchaseMethod.method) &&
      nullableString(a.cardPurchaseMethod.cardNumberSuffix))) && relationship(r.account, "accounts", false) &&
    relationship(r.transferAccount, "accounts") && relationship(r.category, "categories") && relationship(r.parentCategory, "categories") &&
    object(r.tags) && Array.isArray(r.tags.data) && r.tags.data.every(t => object(t) && t.type === "tags" && typeof t.id === "string")
  if (valid) {
    // Older payloads omit these fields; normalise before claiming UpTransaction.
    a.isCategorizable ??= true
    a.roundUp ??= null
    a.cashback ??= null
    a.cardPurchaseMethod ??= null
  }
  return valid
}

type CategoryResource = {
  type: "categories"
  id: string
  attributes: { name: string }
  relationships: { parent: { data: { type: "categories"; id: string } | null }; children: { data: Array<{ type: "categories"; id: string }> } }
}
function isCategory(value: unknown): value is CategoryResource {
  return object(value) && value.type === "categories" && typeof value.id === "string" &&
    object(value.attributes) && typeof value.attributes.name === "string" && object(value.relationships) &&
    relationship(value.relationships.parent, "categories") && object(value.relationships.children) &&
    Array.isArray(value.relationships.children.data) && value.relationships.children.data.every(c => object(c) && c.type === "categories" && typeof c.id === "string")
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
  async function request(url: URL, options: { method?: "PATCH" | "POST" | "DELETE"; body?: string } = {}): Promise<unknown> {
    try {
      if (url.origin !== origin) throw new Error("Up pagination URL has a foreign origin")
      for (let retry = 0; ; retry++) {
        // Refuse redirects so fetch cannot forward credentials to another origin.
        const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body === undefined ? {} : { "Content-Type": "application/json" }) }, redirect: "manual" })
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
        if (options.method !== undefined) {
          if (response.status !== 204) throw new Error(`Unexpected Up API response status (${response.status}); expected 204`)
          return
        }
        if (body === null) throw new Error("Invalid Up API JSON response")
        return body
      }
    } catch (error) {
      if (error instanceof UpApiError) throw new UpApiError(error.status, redact(error.message))
      throw new Error(redact(error instanceof Error ? error.message : String(error)))
    }
  }
  async function list<T>(path: string, valid: (value: unknown) => value is T, since?: string, paginated = true): Promise<T[]> {
    try {
      let url: URL | null = new URL(`${baseUrl.replace(/\/$/, "")}/${path}`)
      if (paginated) url.searchParams.set("page[size]", "100")
      if (since !== undefined) url.searchParams.set("filter[since]", since)
      const items: T[] = []
      while (url) {
        const body = await request(url)
        if (!object(body) || !Array.isArray(body.data) || !body.data.every(valid)) throw new Error("Invalid Up API page")
        let next: string | null = null
        if (paginated || body.links !== undefined) {
          if (!object(body.links) || (paginated && !nullableString(body.links.prev)) ||
            !nullableString(body.links.next)) throw new Error("Invalid Up API page")
          next = body.links.next
        }
        items.push(...body.data)
        url = next === null ? null : new URL(next, url)
      }
      return items
    } catch (error) {
      if (error instanceof UpApiError) throw new UpApiError(error.status, redact(error.message))
      throw new Error(redact(error instanceof Error ? error.message : String(error)))
    }
  }
  async function changeTransactionTags(transactionId: string, tags: string[], method: "POST" | "DELETE"): Promise<void> {
    if (transactionId === "." || transactionId === "..") throw new Error("Invalid Up transaction ID")
    await request(new URL(`${baseUrl.replace(/\/$/, "")}/transactions/${encodeURIComponent(transactionId)}/relationships/tags`), {
      method, body: JSON.stringify({ data: tags.map(id => ({ type: "tags", id })) }),
    })
  }
  return {
    addTransactionTags: (transactionId: string, tags: string[]) => changeTransactionTags(transactionId, tags, "POST"),
    removeTransactionTags: (transactionId: string, tags: string[]) => changeTransactionTags(transactionId, tags, "DELETE"),
    async ping(): Promise<void> { await request(new URL(`${baseUrl.replace(/\/$/, "")}/util/ping`)) },
    async setTransactionCategory(transactionId: string, categoryId: string | null): Promise<void> {
      if (transactionId === "." || transactionId === "..") throw new Error("Invalid Up transaction ID")
      await request(new URL(`${baseUrl.replace(/\/$/, "")}/transactions/${encodeURIComponent(transactionId)}/relationships/category`), {
        method: "PATCH", body: JSON.stringify({ data: categoryId === null ? null : { type: "categories", id: categoryId } }),
      })
    },
    async listCategories(): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
      return (await list("categories", isCategory, undefined, false)).map(c => ({ id: c.id, name: c.attributes.name, parentId: c.relationships.parent.data?.id ?? null }))
    },
    listAccounts: () => list("accounts", isAccount),
    listTransactions: ({ since }: { since?: string } = {}) => list("transactions", isTransaction, since),
    async listAccountTransactions(accountId: string, { since }: { since?: string } = {}) {
      // URL parsing normalises even percent-encoded dot-only path segments.
      if (accountId === "." || accountId === "..") throw new Error("Invalid Up account ID")
      return list(`accounts/${encodeURIComponent(accountId)}/transactions`, isTransaction, since)
    },
  }
}
