import { ACCEPT_ALL_AT } from "../domain/questions"
import type { CategorySuggestion } from "../domain/types"

/**
 * Scoring the decision models against the demo's hidden truth (eval/run):
 * what share of the hidden rows got a suggestion, how often it was right,
 * by where it came from (history or Jev) and by whether history could know
 * the merchant at all, how right the picks accept-all (Y) would take are,
 * and the commonest confusions. Pure: a report from the rows, their truth
 * and the suggestions.
 */
export interface Hidden { id: number; truth: string; description: string; heldOut: boolean }

export interface Tally { rows: number; suggested: number; right: number; top3: number; sure: number; sureRight: number }

export interface SuggestionReport {
  all: Tally
  bySource: Record<string, Tally>
  heldOut: Tally
  known: Tally
  /** Accuracy by the suggestion's confidence: under 50%, 50–80%, 80% and over. */
  calibration: Array<{ band: string; rows: number; right: number }>
  /** The commonest wrong picks: truth → pick, how many. */
  confusions: Array<{ truth: string; pick: string; rows: number }>
}

const empty = (): Tally => ({ rows: 0, suggested: 0, right: 0, top3: 0, sure: 0, sureRight: 0 })

export function scoreSuggestions(hidden: Hidden[], suggestions: Record<number, CategorySuggestion>, categoryName: (id: number) => string): SuggestionReport {
  const report: SuggestionReport = { all: empty(), bySource: {}, heldOut: empty(), known: empty(), calibration: [], confusions: [] }
  const bands = [{ band: "under 50%", lo: 0, hi: 0.5 }, { band: "50–80%", lo: 0.5, hi: ACCEPT_ALL_AT }, { band: "80%+", lo: ACCEPT_ALL_AT, hi: Infinity }].map((b) => ({ ...b, rows: 0, right: 0 }))
  const confusions = new Map<string, number>()
  for (const row of hidden) {
    const s = suggestions[row.id]
    const tallies = [report.all, row.heldOut ? report.heldOut : report.known]
    if (s) tallies.push(report.bySource[s.source] ??= empty())
    for (const t of tallies) t.rows++
    if (!s) continue
    const pick = categoryName(s.categoryId)
    const right = pick === row.truth
    const top3 = (s.ranked ?? [{ categoryId: s.categoryId, confidence: s.confidence }]).slice(0, 3).some((r) => categoryName(r.categoryId) === row.truth)
    const sure = s.confidence >= ACCEPT_ALL_AT
    for (const t of tallies) {
      t.suggested++
      if (right) t.right++
      if (top3) t.top3++
      if (sure) { t.sure++; if (right) t.sureRight++ }
    }
    const band = bands.find((b) => s.confidence >= b.lo && s.confidence < b.hi)!
    band.rows++
    if (right) band.right++
    if (!right) confusions.set(`${row.truth}\u0000${pick}`, (confusions.get(`${row.truth}\u0000${pick}`) ?? 0) + 1)
  }
  report.calibration = bands.map(({ band, rows, right }) => ({ band, rows, right }))
  report.confusions = [...confusions].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, rows]) => {
    const [truth, pick] = key.split("\u0000") as [string, string]
    return { truth, pick, rows }
  })
  return report
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–")

/** The report as text: a table, the calibration, the confusions; with the previous run's deltas. */
export function suggestionText(report: SuggestionReport, previous?: SuggestionReport): string[] {
  const delta = (now: number, was: number | undefined) => (was == null ? "" : ` (${now - was >= 0 ? "+" : ""}${(now - was).toFixed(1)})`)
  const rate = (t: Tally, n: number) => (t.suggested ? (100 * n) / t.suggested : 0)
  const line = (name: string, t: Tally, was?: Tally) =>
    `${name.padEnd(18)} ${String(t.rows).padStart(5)} ${pct(t.suggested, t.rows).padStart(7)} ${pct(t.right, t.suggested).padStart(7)}${delta(rate(t, t.right), was && rate(was, was.right))}`.padEnd(58)
    + ` ${pct(t.top3, t.suggested).padStart(7)}   ${String(t.sure).padStart(4)} at 80%+, ${pct(t.sureRight, t.sure)} right${delta(t.sure ? (100 * t.sureRight) / t.sure : 0, was && was.sure ? (100 * was.sureRight) / was.sure : undefined)}`
  const out = [
    `${"".padEnd(18)} ${"rows".padStart(5)} ${"given".padStart(7)} ${"right".padStart(7)}`.padEnd(58) + ` ${"top 3".padStart(7)}   accept-all (Y)`,
    line("all hidden rows", report.all, previous?.all),
    line("  merchant unseen", report.heldOut, previous?.heldOut),
    line("  merchant known", report.known, previous?.known),
    ...Object.entries(report.bySource).map(([source, t]) => line(`  from ${source}`, t, previous?.bySource[source])),
    "",
    `confidence: ${report.calibration.map((b) => `${b.band} ${pct(b.right, b.rows)} of ${b.rows}`).join(" · ")}`,
  ]
  if (report.confusions.length) out.push("", "commonest misses (truth → pick):", ...report.confusions.map((c) => `  ${String(c.rows).padStart(3)}  ${c.truth} → ${c.pick}`))
  return out
}
