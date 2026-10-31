/**
 * Jev's questions and answers, and packing questions into requests: no
 * model SDK here, so the domain (and a browser bundle) can use them.
 * ai/jev makes the client that answers them.
 */
import type { JevClient } from "./jev"

/** What sets Jev up, for "not set up" messages. */
export const JEV_SETUP = "a TypeSafe key, or OpenRouter: Settings › AI models"

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

/** Request size to aim for, in estimated tokens (Jev takes 64k a request). */
export const REQUEST_BUDGET = 40_000
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
