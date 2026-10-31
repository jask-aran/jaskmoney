import type { JevProvider } from "../ai/jev"
import { ASK_DEFAULT_DAYS, ASK_LIMIT } from "../domain/ask"
import type { AskResult } from "../client/store"

/**
 * The status line after a search, the same parts every time: who wrote the
 * filter (a smart search: Jev, by which service, with Clairic or why not)
 * and how long it took; then what Jev judged (rows, time, matches, near
 * misses, the window) or, for a plain filter, how many rows.
 */

/** How a smart search's filter was written. */
export interface Written { ms: number; clairic: "used" | "off" | { failed: string }; by?: string }

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/** "Jev (TypeSafe)" or "Jev (OpenRouter)": the service answering Jev. */
export function jevService(provider: JevProvider | null): string {
  return provider ? `Jev (${provider === "typesafe" ? "TypeSafe" : "OpenRouter"})` : "Jev"
}

export function writtenText(w: Written): string {
  const clairic = w.clairic === "used" ? " + Clairic" : w.clairic === "off" ? "" : `, Clairic failed (${w.clairic.failed}): check words and dates`
  return `written by ${w.by ?? "Jev"}${clairic} in ${seconds(w.ms)}`
}

/** What Jev judged: "Jev judged 313 rows in 3.4s: 48 match, 77 near (n) ·
 * last 90 days (date: for more)". Rows already judged aren't sent again. */
export function judgedText(r: AskResult): string {
  const parts = r.terms.map((t) => {
    const sent = t.asked === t.rows ? `${t.rows} rows` : t.asked ? `${t.asked} new of ${t.rows} rows` : `${t.rows} rows (known)`
    const named = r.terms.length > 1 ? ` "${t.words}"` : ""
    let text = `Jev judged${named} ${sent}${t.asked ? ` in ${seconds(r.ms)}` : ""}: ${t.matched} match${t.near ? `, ${t.near} near (n)` : ""}`
    if (t.skipped && !r.dated) text += ` · last ${ASK_DEFAULT_DAYS} days (date: for more)`
    else if (t.skipped) text += ` · newest ${ASK_LIMIT} of ${t.rows + t.skipped}`
    return text
  })
  if (r.failures.length) parts.push(`${r.failures.length} request${r.failures.length > 1 ? "s" : ""} failed: ${r.failures[0]}`)
  return parts.join(" · ")
}

/** The whole line: the writing (smart searches only), then the result. */
export function searchReport(parts: { written?: Written; judged?: AskResult | null; rows?: number }): string {
  const result = parts.judged ? judgedText(parts.judged) : parts.rows != null ? `${parts.rows} row${parts.rows === 1 ? "" : "s"}` : ""
  return [parts.written ? writtenText(parts.written) : "", result].filter(Boolean).join(" · ")
}
