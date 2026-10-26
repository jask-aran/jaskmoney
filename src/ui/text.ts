/** Terminal-cell text helpers shared by tables and lists. */

import { MONTHS } from "../domain/days"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** Truncate to `n` terminal cells with an ellipsis. Measures display width,
 * not UTF-16 length: Up account names carry emoji such as "🏖️" (3 units, 2 cells). */
export function truncate(s: string, n: number): string {
  if (Bun.stringWidth(s) <= n) return s
  let out = ""
  let width = 0
  for (const { segment } of graphemes.segment(s)) {
    const w = Bun.stringWidth(segment)
    if (width + w > n - 1) break
    out += segment
    width += w
  }
  return out + "…"
}

/** Truncate, then pad with spaces to exactly `n` cells. */
export function fit(s: string, n: number): string {
  const t = truncate(s, n)
  return t + " ".repeat(Math.max(0, n - Bun.stringWidth(t)))
}

/** "1 transaction", "3 transactions". */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}

/** Compact money for axes and tight columns: $950, $4.5k, $5k, $12k. */
export function shortMoney(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return `${sign}$${Math.round(a)}`
}

/** "2026-08-26" → "26 Aug". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]}`
}
