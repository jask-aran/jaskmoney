import { credentialEnv } from "./credentials"

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

async function fetchWithTimeout(fetch: Fetch, input: string | URL | Request, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    await response.clone().arrayBuffer()
    return response
  } finally {
    clearTimeout(timer)
  }
}

export class WorkersAiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "WorkersAiError"
  }
}

interface WorkersAiCredentials {
  token: string
  accountId: string
}

export function readWorkersAiCredentials(env: Record<string, string | undefined> = credentialEnv()): WorkersAiCredentials {
  const token = env.JASKMONEY_CF_TOKEN?.trim()
  const accountId = env.JASKMONEY_CF_ACCOUNT_ID?.trim()
  if (!token || !accountId) throw new Error("Set JASKMONEY_CF_TOKEN and JASKMONEY_CF_ACCOUNT_ID for Cloudflare Workers AI")
  return { token, accountId }
}

export function hasWorkersAi(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return !!env.JASKMONEY_CF_TOKEN?.trim() && !!env.JASKMONEY_CF_ACCOUNT_ID?.trim()
}

export function searchUsesClairic(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return hasWorkersAi(env) && env.JASKMONEY_SEARCH_CLAIRIC?.trim() !== "off"
}

export type ClairicField = { type: "text" | "number" | "date"; instructions?: string; decimals?: number }

export interface ClairicAnswer {
  value: string | number | null
  confidence: number | null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clairicAnswer(value: unknown): ClairicAnswer | null {
  if (!object(value)) return null
  const v = value.value
  if (v !== null && typeof v !== "string" && typeof v !== "number") return null
  return { value: v, confidence: typeof value.confidence === "number" ? value.confidence : null }
}

function plainError(message: string): string {
  if (/daily free allocation/i.test(message)) return "free daily limit used up"
  return message.replace(/^(?:\s*AiError:\s*)+/i, "").trim() || message
}

export const workersAiUrl = (accountId: string, model = "clairic") => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/${model}`

async function cloudflareAccounts(token: string, fetch: Fetch = globalThis.fetch): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
  const body = (await response.json().catch(() => null)) as { success?: boolean; result?: Array<{ id?: unknown; name?: unknown }>; errors?: Array<{ message?: string }> } | null
  if (!response.ok || !body?.success) throw new Error(body?.errors?.[0]?.message ?? `Cloudflare answered ${response.status}`)
  return (body.result ?? []).flatMap((a) => (typeof a.id === "string" ? [{ id: a.id, name: typeof a.name === "string" ? a.name : a.id }] : []))
}

export const cloudflare = { accounts: cloudflareAccounts }

export function createWorkersAiClient({ token, accountId, fetch = globalThis.fetch, timeoutMs = 15_000 }: WorkersAiCredentials & { fetch?: Fetch; timeoutMs?: number }) {
  const redact = (message: string) => message.split(token).join("[redacted]").split(accountId).join("[account]")

  async function run(model: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = workersAiUrl(accountId, model)
    let response: Response
    try {
      response = await fetchWithTimeout(fetch, url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, ...body }),
      }, timeoutMs)
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError"
      throw new WorkersAiError(0, aborted ? `Workers AI timed out after ${timeoutMs / 1000}s` : redact(`Workers AI request failed: ${error instanceof Error ? error.message : String(error)}`))
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok || !object(payload) || payload.success !== true) {
      const errors = object(payload) && Array.isArray(payload.errors) ? payload.errors : []
      const first = errors.find(object)
      const message = first && typeof first.message === "string" ? plainError(first.message) : `HTTP ${response.status}`
      throw new WorkersAiError(response.status, redact(`Workers AI ${model}: ${message}`))
    }
    if (!object(payload.result) || !object(payload.result.answers)) throw new WorkersAiError(response.status, `Workers AI ${model}: unexpected response`)
    return payload.result.answers
  }

  async function answers<T>(model: string, body: Record<string, unknown>, ids: string[], parse: (value: unknown) => T | null): Promise<Record<string, T>> {
    const raw = await run(model, body)
    const out: Record<string, T> = {}
    for (const id of ids) {
      const answer = parse(raw[id])
      if (!answer) throw new WorkersAiError(200, `Workers AI ${model}: no usable answer for ${id}`)
      out[id] = answer
    }
    return out
  }

  return {
    clairic(fields: Record<string, ClairicField>, state: string, referenceDate: string) {
      return answers("clairic", { state, fields, reference_date: referenceDate }, Object.keys(fields), clairicAnswer)
    },
  }
}

export type WorkersAiClient = ReturnType<typeof createWorkersAiClient>
