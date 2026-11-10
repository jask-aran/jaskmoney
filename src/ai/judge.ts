import type { JevClient } from "./jev"

export const JEV_SETUP = "a TypeSafe key, or OpenRouter: Settings › AI models"

type Instructions = string | Record<string, unknown>

export type JevQuestion =
  | { type: "noul"; instructions: Instructions; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: Instructions; criteria: Record<string, string> }

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }

export type JevState = string | Record<string, unknown>

export const REQUEST_BUDGET = 40_000
const REQUESTS_IN_FLIGHT = 4

const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3)

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
