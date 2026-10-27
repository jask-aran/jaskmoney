/**
 * TypeSafe's Jev, a System One model: typed judgments about a state your code
 * supplies. A Noul is the probability a statement is true; a Choice is a
 * distribution over options. Requests go only to api.typesafe.ai.
 *
 * Jev reads one item per question best (the item inline in the question, not
 * looked up by id in a shared list), and answers every question in a request
 * in parallel, so a request of hundreds of questions takes about as long as
 * one: `judgeEach` packs items into as few requests as fit. (Clef, measured
 * on the same tasks, preferred the opposite: rows listed in the state.)
 */

/** Pinned: the questions and thresholds here were tuned against this
 * version (it was `jev-latest` on 2026-10-27). */
export const JEV_MODEL = "jev-1.14.0"

export class JevError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "JevError"
  }
}

export function readJevToken(env: Record<string, string | undefined> = process.env): string {
  const token = env.JASKMONEY_JEV_TOKEN?.trim()
  if (!token) throw new Error("Set JASKMONEY_JEV_TOKEN (a TypeSafe API key) for Jev")
  return token
}

/** Whether Jev is set up, without throwing. */
export function hasJev(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.JASKMONEY_JEV_TOKEN?.trim()
}

/** A question's text, or the question with the data it is about in named
 * fields (`{ question, transaction }`), which the question refers to by
 * path in backticks. */
type Instructions = string | Record<string, unknown>

export type JevQuestion =
  | { type: "noul"; instructions: Instructions; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: Instructions; criteria: Record<string, string> }

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }

export type JevState = string | Record<string, unknown>

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jevAnswer(value: unknown): JevAnswer | null {
  if (!object(value)) return null
  if (value.type === "noul" && typeof value.noul === "number") return { type: "noul", noul: value.noul }
  if (value.type === "choice" && typeof value.choice === "string" && object(value.probabilities) && typeof value.confidence === "number" &&
    Object.values(value.probabilities).every((p) => typeof p === "number")) {
    return { type: "choice", choice: value.choice, probabilities: value.probabilities as Record<string, number>, confidence: value.confidence }
  }
  return null
}

/** Retries after a rate limit or a server error, waiting as asked. */
const RETRIES = 3

export function createJevClient({ token, fetch = globalThis.fetch, timeoutMs = 30_000 }: { token: string; fetch?: Fetch; timeoutMs?: number }) {
  const redact = (message: string) => message.split(token).join("[redacted]")

  async function post(body: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let response: Response
      try {
        response = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        })
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError"
        throw new JevError(0, aborted ? `Jev timed out after ${timeoutMs / 1000}s` : redact(`Jev request failed: ${error instanceof Error ? error.message : String(error)}`))
      } finally {
        clearTimeout(timer)
      }
      if ((response.status === 429 || response.status >= 500) && attempt < RETRIES) {
        const wait = Number(response.headers.get("retry-after"))
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(wait) && wait > 0 ? wait * 1000 : 250 * 2 ** attempt))
        continue
      }
      return response
    }
  }

  return {
    /** Jev's answer to each question about `state`; a missing or malformed answer is an error. */
    async judge(questions: Record<string, JevQuestion>, state: JevState): Promise<Record<string, JevAnswer>> {
      const response = await post(JSON.stringify({ model: JEV_MODEL, state, questions }))
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok || !object(payload) || !object(payload.answers)) {
        const detail = object(payload) ? payload.detail ?? payload.error ?? payload.message : null
        const message = typeof detail === "string" ? detail : Array.isArray(detail) && object(detail[0]) && typeof detail[0].msg === "string" ? detail[0].msg : `HTTP ${response.status}`
        throw new JevError(response.status, redact(`Jev: ${message}`))
      }
      const out: Record<string, JevAnswer> = {}
      for (const id of Object.keys(questions)) {
        const answer = jevAnswer(payload.answers[id])
        if (!answer) throw new JevError(200, `Jev: no usable answer for ${id}`)
        out[id] = answer
      }
      return out
    },
  }
}

export type JevClient = ReturnType<typeof createJevClient>

/** A Jev client for the token in the environment now. */
export const jevClient = (): JevClient => createJevClient({ token: readJevToken() })

/** Request size to aim for, in estimated tokens (Jev takes 64k a request). */
const REQUEST_BUDGET = 40_000
const REQUESTS_IN_FLIGHT = 4

/** A rough token count: JSON characters / 3, erring large. */
const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3)

/**
 * Ask one question per item, packing items into as few requests as fit the
 * budget, a few requests in flight. `onAnswers` gets each request's answers
 * by item as it lands; a failed request goes to `onError` with its items and
 * the rest carry on. Stops sending once `active` says so.
 */
export async function judgeEach<T>(
  jev: Pick<JevClient, "judge">,
  items: T[],
  question: (item: T) => JevQuestion,
  state: JevState,
  options: { budget?: number; onAnswers?: (answers: Map<T, JevAnswer>) => void; onError?: (error: unknown, items: T[]) => void; active?: () => boolean } = {},
): Promise<void> {
  const budget = options.budget ?? REQUEST_BUDGET
  const base = estimateTokens(state)
  const batches: { items: T[]; questions: Record<string, JevQuestion> }[] = []
  let current: (typeof batches)[number] | null = null
  let used = 0
  for (const item of items) {
    const q = question(item)
    const size = estimateTokens(q)
    if (!current || (used + size > budget && current.items.length)) {
      current = { items: [], questions: {} }
      batches.push(current)
      used = base
    }
    current.questions[`q${current.items.length}`] = q
    current.items.push(item)
    used += size
  }
  let next = 0
  async function worker() {
    for (;;) {
      if (options.active?.() === false) return
      const batch = batches[next++]
      if (!batch) return
      try {
        const answers = await jev.judge(batch.questions, state)
        options.onAnswers?.(new Map(batch.items.map((item, i) => [item, answers[`q${i}`]!])))
      } catch (error) {
        options.onError?.(error, batch.items)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(REQUESTS_IN_FLIGHT, batches.length) }, worker))
}
