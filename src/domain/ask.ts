import type { ClefQuestion, WorkersAiClient } from "../ai/workersAi"
import { addDays } from "./days"
import { formatMoney } from "./dashboard"
import type { Transaction } from "./types"

/**
 * `ask:"coffee"`: Clef judges, row by row, whether a transaction matches the
 * words by what the money was for, not only by its description. Rows go 20 to
 * a call, so a few hundred take a second or two.
 */

/** Rows per Clef call, and calls in flight. */
export const ASK_BATCH = 20
const ASK_CONCURRENCY = 8
/** At most this many rows are judged per term, the most recent first. */
export const ASK_LIMIT = 500
/** With no `date:` term, only rows from the last this-many days are judged. */
export const ASK_DEFAULT_DAYS = 90

/** A verdict at or above this is a match. */
const MATCH_AT = 0.5

/** One row as Clef reads it. */
export function askLine(t: Transaction): string {
  return [
    t.description,
    `${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))}`,
    ...(t.transactionType ? [t.transactionType] : []),
    ...(t.message ? [`message "${t.message}"`] : []),
    `category ${t.categoryName || "Uncategorised"}`,
    t.dateISO,
  ].join("; ")
}

/** Which rows to send: the most recent ASK_LIMIT, from the last
 * ASK_DEFAULT_DAYS unless the filter limits dates itself. Also how many
 * were left out, to say so. */
export function askCandidates(rows: Transaction[], today: string, datedFilter: boolean): { rows: Transaction[]; skipped: number } {
  const since = datedFilter ? null : addDays(today, -(ASK_DEFAULT_DAYS - 1))
  const inWindow = since ? rows.filter((t) => t.dateISO >= since) : rows
  const recent = [...inWindow].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id).slice(0, ASK_LIMIT)
  return { rows: recent, skipped: rows.length - recent.length }
}

/**
 * Ask Clef whether each row matches `words`. `onJudged` gets each batch's
 * verdicts as it lands; a failed batch goes to `onError` and the rest carry on.
 */
export async function judgeRows(
  ai: Pick<WorkersAiClient, "clef">,
  words: string,
  rows: Transaction[],
  options: { onJudged?: (verdicts: Map<number, boolean>) => void; onError?: (error: unknown) => void; active?: () => boolean } = {},
): Promise<void> {
  const batches: Transaction[][] = []
  for (let i = 0; i < rows.length; i += ASK_BATCH) batches.push(rows.slice(i, i + ASK_BATCH))
  let next = 0
  async function worker() {
    for (;;) {
      if (options.active?.() === false) return
      const batch = batches[next++]
      if (!batch) return
      const questions: Record<string, ClefQuestion> = Object.fromEntries(batch.map((_, i) => [`t${i + 1}`, {
        type: "noul",
        instructions: `Does T${i + 1} match the search "${words}"? Judge what the money was for, not only the words.`,
      }]))
      const state = batch.map((t, i) => `T${i + 1}: ${askLine(t)}`).join("\n")
      try {
        const answers = await ai.clef(questions, state, "clef-flash")
        const verdicts = new Map<number, boolean>()
        batch.forEach((t, i) => {
          const a = answers[`t${i + 1}`]
          if (a?.type === "noul") verdicts.set(t.id, a.noul >= MATCH_AT)
        })
        options.onJudged?.(verdicts)
      } catch (error) {
        options.onError?.(error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ASK_CONCURRENCY, batches.length) }, worker))
}
