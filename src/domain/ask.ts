import { judgeEach, type JevClient } from "../ai/jev"
import { addDays } from "./days"
import { MATCH_AT, matchQuestion, matchState } from "./questions"
import type { Transaction } from "./types"

/**
 * `ask:"coffee"`: Jev judges, row by row, whether a transaction matches the
 * words by what the money was for, not only by its description. Each row is
 * its own question and a request carries hundreds, so the default window
 * takes about a second.
 */

/** At most this many rows are judged per term, the most recent first. */
export const ASK_LIMIT = 2000
/** With no `date:` term, only rows from the last this-many days are judged. */
export const ASK_DEFAULT_DAYS = 90

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
 * Ask Jev whether each row matches `words`. `onJudged` gets each request's
 * verdicts as it lands; a failed request goes to `onError` and the rest
 * carry on.
 */
export async function judgeRows(
  jev: Pick<JevClient, "judge">,
  words: string,
  rows: Transaction[],
  options: { onJudged?: (verdicts: Map<number, boolean>) => void; onError?: (error: unknown) => void; active?: () => boolean } = {},
): Promise<void> {
  await judgeEach(jev, rows, matchQuestion, matchState(words), {
    active: options.active,
    onAnswers: (answers) => {
      const verdicts = new Map<number, boolean>()
      for (const [t, a] of answers) if (a.type === "noul") verdicts.set(t.id, a.noul >= MATCH_AT)
      options.onJudged?.(verdicts)
    },
    onError: (error) => options.onError?.(error),
  })
}
