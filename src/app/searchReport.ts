import type { JevProvider } from "../ai/jev"
import { ASK_DEFAULT_DAYS, ASK_LIMIT } from "../domain/ask"
import type { AskResult } from "../client/store"

export interface Written { ms: number; clairic: "used" | "off" | { failed: string }; by?: string }

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

export function jevService(provider: JevProvider | null): string {
  return provider ? `Jev (${provider === "typesafe" ? "TypeSafe" : "OpenRouter"})` : "Jev"
}

export function writtenText(w: Written): string {
  const clairic = w.clairic === "used" ? " + Clairic" : w.clairic === "off" ? "" : `, Clairic failed (${w.clairic.failed}): check words and dates`
  return `written by ${w.by ?? "Jev"}${clairic} in ${seconds(w.ms)}`
}

function judgedText(r: AskResult): string {
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

export function searchReport(parts: { written?: Written; judged?: AskResult | null; rows?: number }): string {
  const result = parts.judged ? judgedText(parts.judged) : parts.rows != null ? `${parts.rows} row${parts.rows === 1 ? "" : "s"}` : ""
  return [parts.written ? writtenText(parts.written) : "", result].filter(Boolean).join(" · ")
}
