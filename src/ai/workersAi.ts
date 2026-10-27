/**
 * Cloudflare Workers AI's Clairic: extracts typed values from text (here:
 * amounts, dates and words from a search), never prose. Requests go only to
 * api.cloudflare.com. Typed judgments come from Jev (`./jev`).
 */

import { credentialEnv } from "./credentials"

export class WorkersAiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "WorkersAiError"
  }
}

export interface WorkersAiCredentials {
  token: string
  accountId: string
}

export function readWorkersAiCredentials(env: Record<string, string | undefined> = credentialEnv()): WorkersAiCredentials {
  const token = env.JASKMONEY_CF_TOKEN?.trim()
  const accountId = env.JASKMONEY_CF_ACCOUNT_ID?.trim()
  if (!token || !accountId) throw new Error("Set JASKMONEY_CF_TOKEN and JASKMONEY_CF_ACCOUNT_ID for Cloudflare Workers AI")
  return { token, accountId }
}

/** Whether Workers AI is set up, without throwing. */
export function hasWorkersAi(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return !!env.JASKMONEY_CF_TOKEN?.trim() && !!env.JASKMONEY_CF_ACCOUNT_ID?.trim()
}

export type ClairicField = { type: "text" | "number" | "date"; instructions?: string; decimals?: number }

/** A Clairic value: null when the text doesn't determine it. `guess` is
 * deliberately not kept: it echoes examples from the instructions. */
export interface ClairicAnswer {
  value: string | number | null
  confidence: number | null
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clairicAnswer(value: unknown): ClairicAnswer | null {
  if (!object(value)) return null
  const v = value.value
  if (v !== null && typeof v !== "string" && typeof v !== "number") return null
  return { value: v, confidence: typeof value.confidence === "number" ? value.confidence : null }
}

/** Cloudflare's error text, readable: its "AiError: AiError: …" prefixes go,
 * and the free plan's daily cap says what it means. */
export function plainError(message: string): string {
  if (/daily free allocation/i.test(message)) return "Cloudflare's free daily allowance is used up (it resets each day)"
  return message.replace(/^(?:\s*AiError:\s*)+/i, "").trim() || message
}

export function createWorkersAiClient({ token, accountId, fetch = globalThis.fetch, timeoutMs = 15_000 }: WorkersAiCredentials & { fetch?: Fetch; timeoutMs?: number }) {
  const redact = (message: string) => message.split(token).join("[redacted]").split(accountId).join("[account]")

  async function run(model: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/${model}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, ...body }),
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError"
      throw new WorkersAiError(0, aborted ? `Workers AI timed out after ${timeoutMs / 1000}s` : redact(`Workers AI request failed: ${error instanceof Error ? error.message : String(error)}`))
    } finally {
      clearTimeout(timer)
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

  /** Each answer, by question id; a malformed answer is an error. */
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
    /** Clairic's values for `fields` in `state`; `referenceDate` anchors dates written without a year. */
    clairic(fields: Record<string, ClairicField>, state: string, referenceDate: string) {
      return answers("clairic", { state, fields, reference_date: referenceDate }, Object.keys(fields), clairicAnswer)
    },
  }
}

export type WorkersAiClient = ReturnType<typeof createWorkersAiClient>
