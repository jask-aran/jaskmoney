/**
 * Cloudflare Workers AI decision models. Clef answers typed questions about
 * a state with probabilities (here: which category, which period); Clairic
 * extracts typed values from text (here: amounts, dates and words from a
 * search). Neither writes prose. Requests go only to api.cloudflare.com.
 */

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

export function readWorkersAiCredentials(env: Record<string, string | undefined> = process.env): WorkersAiCredentials {
  const token = env.JASKMONEY_CF_TOKEN?.trim()
  const accountId = env.JASKMONEY_CF_ACCOUNT_ID?.trim()
  if (!token || !accountId) throw new Error("Set JASKMONEY_CF_TOKEN and JASKMONEY_CF_ACCOUNT_ID for Cloudflare Workers AI")
  return { token, accountId }
}

/** Whether Workers AI is set up, without throwing. */
export function hasWorkersAi(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.JASKMONEY_CF_TOKEN?.trim() && !!env.JASKMONEY_CF_ACCOUNT_ID?.trim()
}

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }

export type ClefAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }

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

function clefAnswer(value: unknown): ClefAnswer | null {
  if (!object(value)) return null
  if (value.type === "noul" && typeof value.noul === "number") return { type: "noul", noul: value.noul }
  if (value.type === "choice" && typeof value.choice === "string" && object(value.probabilities) && typeof value.confidence === "number" &&
    Object.values(value.probabilities).every((p) => typeof p === "number")) {
    return { type: "choice", choice: value.choice, probabilities: value.probabilities as Record<string, number>, confidence: value.confidence }
  }
  return null
}

function clairicAnswer(value: unknown): ClairicAnswer | null {
  if (!object(value)) return null
  const v = value.value
  if (v !== null && typeof v !== "string" && typeof v !== "number") return null
  return { value: v, confidence: typeof value.confidence === "number" ? value.confidence : null }
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
      const message = first && typeof first.message === "string" ? first.message : `HTTP ${response.status}`
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
    /** Clef's answers to `questions` about `state`. Clef-flash is faster, Clef more precise. */
    clef(questions: Record<string, ClefQuestion>, state: string, model: "clef" | "clef-flash" = "clef") {
      return answers(model, { state, questions }, Object.keys(questions), clefAnswer)
    },
    /** Clairic's values for `fields` in `state`; `referenceDate` anchors dates written without a year. */
    clairic(fields: Record<string, ClairicField>, state: string, referenceDate: string) {
      return answers("clairic", { state, fields, reference_date: referenceDate }, Object.keys(fields), clairicAnswer)
    },
  }
}

export type WorkersAiClient = ReturnType<typeof createWorkersAiClient>
