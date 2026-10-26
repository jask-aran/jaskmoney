/** Terminal-cell text helpers shared by tables and lists. */

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
