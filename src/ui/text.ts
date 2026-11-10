import { MONTHS } from "../domain/days"

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function truncate(s: string, n: number): string {
  if (n <= 0) return ""
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

export function fit(s: string, n: number): string {
  const t = truncate(s, n)
  return t + " ".repeat(Math.max(0, n - Bun.stringWidth(t)))
}

export { count } from "../domain/words"

export function shortMoney(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? "-" : ""
  if (a >= 10000) return `${sign}$${Math.round(a / 1000)}k`
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return `${sign}$${Math.round(a)}`
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]}`
}
