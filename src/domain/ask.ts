import { newestFirst } from "./chronology"
import type { JevClient } from "../ai/jev"
import { judgeEach } from "../ai/judge"
import { addDays } from "./days"
import { matchQuestion, matchState } from "./questions"
import type { Transaction } from "./types"

export const ASK_LIMIT = 2000
export const ASK_DEFAULT_DAYS = 90

export function askCandidates(rows: Transaction[], today: string, datedFilter: boolean): { rows: Transaction[]; skipped: number } {
  const since = datedFilter ? null : addDays(today, -(ASK_DEFAULT_DAYS - 1))
  const inWindow = since ? rows.filter((t) => t.dateISO >= since) : rows
  const recent = [...inWindow].sort(newestFirst).slice(0, ASK_LIMIT)
  return { rows: recent, skipped: rows.length - recent.length }
}

export async function judgeRows(
  jev: Pick<JevClient, "judge">,
  words: string,
  rows: Transaction[],
  options: { onJudged?: (scores: Map<number, number>) => void; onError?: (error: unknown) => void; active?: () => boolean } = {},
): Promise<void> {
  await judgeEach(jev, rows, matchQuestion, matchState(words), {
    active: options.active,
    onAnswers: (answers) => {
      const scores = new Map<number, number>()
      for (const [t, a] of answers) if (a.type === "noul") scores.set(t.id, a.noul)
      options.onJudged?.(scores)
    },
    onError: (error) => options.onError?.(error),
  })
}
