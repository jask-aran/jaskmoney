import { wrapText } from "./textLayout"
import type { SentPart } from "../app/sentPreview"
import { BLOCKS, QUERIES, type QueryId } from "../ai/catalog"
import type { HelpLine, HelpTone } from "./searchHelp"

/**
 * A query (ai/catalog) as lines for Settings › AI models: readable first,
 * then its exact request (app/sentPreview) as an outline (keys, nested
 * values indented, long text wrapped, a list that fits on one line). A
 * family of like questions (kind1 … kind51) shows its first and how many
 * more, so a smart search's 100 category questions read as one. The
 * request's wording is as sent.
 */

/** A string that is a JSON object, parsed; else null. */
function jsonText(text: string): Record<string, unknown> | null {
  if (!text.trimStart().startsWith("{")) return null
  try { const v: unknown = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null } catch { return null }
}

const family = (id: string) => id.replace(/\d+$/, "")

/** Question ids grouped: the first of each family of 3 or more kept, with how many it stands for. */
function condense(questions: Record<string, unknown>): Array<[string, unknown] | { more: number; first: string; last: string }> {
  const ids = Object.keys(questions)
  const sizes = new Map<string, string[]>()
  for (const id of ids) sizes.set(family(id), [...(sizes.get(family(id)) ?? []), id])
  const out: Array<[string, unknown] | { more: number; first: string; last: string }> = []
  for (const id of ids) {
    const members = sizes.get(family(id))!
    if (members.length < 3 || /\D$/.test(id)) { out.push([id, questions[id]]); continue }
    if (members[0] !== id) continue
    out.push([id, questions[id]], { more: members.length - 1, first: members[1]!, last: members.at(-1)! })
  }
  return out
}

function outline(key: string, value: unknown, indent: number, width: number, out: HelpLine[]): void {
  const pad = " ".repeat(indent)
  const label = key ? `${key}: ` : ""
  if (value === null || typeof value !== "object") {
    const text = typeof value === "string" ? value : JSON.stringify(value)
    const parsed = typeof value === "string" ? jsonText(value) : null
    if (parsed) {
      out.push([{ text: `${pad}${key}:`, tone: "key" }, { text: " (sent as JSON text)", tone: "muted" }])
      for (const [k, v] of Object.entries(parsed)) outline(k, v, indent + 2, width, out)
      return
    }
    if (typeof value === "string" && (value.includes("\n") || pad.length + label.length + text.length > width)) {
      out.push([{ text: `${pad}${key}:`, tone: "key" }])
      for (const line of wrapText(text, Math.max(20, width - indent - 2))) out.push([{ text: `${pad}  ${line}`, tone: "text" }])
      return
    }
    out.push([{ text: `${pad}${label}`, tone: "key" }, { text, tone: "text" }])
    return
  }
  // A list, or a list's item, that fits on a line is its JSON there (the
  // rule brief's 50 categories, a category's examples).
  const compact = JSON.stringify(value)
  if ((key.startsWith("[") || Array.isArray(value)) && pad.length + label.length + compact.length <= width) {
    out.push([{ text: `${pad}${label}`, tone: "key" }, { text: compact, tone: "text" }])
    return
  }
  if (key) out.push([{ text: `${pad}${key}:`, tone: "key" }])
  const inner = key ? indent + 2 : indent
  if (Array.isArray(value)) {
    value.forEach((item, i) => outline(`[${i}]`, item, inner, width, out))
    return
  }
  const entries = key === "questions" ? condense(value as Record<string, unknown>) : Object.entries(value as Record<string, unknown>)
  for (const entry of entries) {
    if (Array.isArray(entry)) outline(entry[0], entry[1], inner, width, out)
    else for (const line of wrapText(`… ${entry.more} more like it (${entry.first} to ${entry.last}), each the same with its own subject`, Math.max(20, width - inner))) out.push([{ text: `${" ".repeat(inner)}${line}`, tone: "muted" }])
  }
}

/** The exact request, as an outline under its address. */
function requestLines(part: SentPart, width: number): HelpLine[] {
  const out: HelpLine[] = [[{ text: part.to, tone: "key" }]]
  outline("", part.body, 2, width, out)
  return out
}

/** `text` beside a label column, wrapped under itself. */
function labelled(label: string, text: string, width: number, column = 10, tone: HelpTone = "text"): HelpLine[] {
  return wrapText(text, Math.max(20, width - column)).map((line, i) => [{ text: (i ? "" : label).padEnd(column), tone: "muted" as const }, { text: line, tone }])
}

/**
 * A query, readable first: what it asks, what comes back and what the app
 * does with it, when it's sent, the code; then each context block with
 * where its field goes, what it says and where it comes from; then the
 * exact request (when built) with what it was built for.
 */
export function queryLines(id: QueryId, model: string, part: SentPart | null, width: number, error: string | null = null): HelpLine[] {
  const q = QUERIES[id]
  const out: HelpLine[] = [
    ...labelled("Asks", q.asks, width, 10, "head"),
    ...labelled("Answer", q.answer, width),
    ...labelled("Sent", q.when, width),
    ...labelled("Model", part ? `${model} · ${part.to}` : model, width),
    ...labelled("Code", q.code, width, 10, "key"),
    [],
    [{ text: "Context", tone: "head" }],
    ...wrapText("Each block is gathered by one function, the same wherever it's used.", width).map((line): HelpLine => [{ text: line, tone: "muted" }]),
  ]
  for (const use of q.context) {
    const block = BLOCKS[use.block]
    const where = use.via === "tools" ? "in the tools' results" : use.fields.length ? `→ ${use.fields.join(", ")}` : "decides, not sent"
    // The code beside the name, or under it when it doesn't fit.
    const head = `  ${block.name}  ${where}`
    if (head.length + 2 + block.code.length <= width) out.push([{ text: `  ${block.name}`, tone: "head" }, { text: `  ${where}`, tone: "key" }, { text: `  ${block.code}`, tone: "muted" }])
    else {
      out.push([{ text: `  ${block.name}`, tone: "head" }, { text: `  ${where}`, tone: "key" }])
      for (const line of wrapText(block.code, width - 4)) out.push([{ text: `    ${line}`, tone: "muted" }])
    }
    for (const line of wrapText(block.says, width - 4)) out.push([{ text: `    ${line}`, tone: "text" }])
    for (const line of wrapText(`from ${block.from}`, width - 4)) out.push([{ text: `    ${line}`, tone: "muted" }])
  }
  out.push([])
  out.push([{ text: "Exact request", tone: "head" }])
  const about = part ? `Built for ${part.sample}; nothing was sent.` : error ?? "Building it…"
  for (const line of wrapText(about, width)) out.push([{ text: line, tone: "muted" }])
  return part ? [...out, ...requestLines(part, width)] : out
}
