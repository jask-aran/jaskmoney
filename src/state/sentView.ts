import { wrapText } from "./textLayout"
import type { SentPart } from "../app/sentPreview"
import { BLOCKS, QUERIES, type QueryId } from "../ai/catalog"
import type { HelpLine, HelpTone } from "./searchHelp"

function jsonText(text: string): Record<string, unknown> | null {
  if (!text.trimStart().startsWith("{")) return null
  try { const v: unknown = JSON.parse(text); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null } catch { return null }
}

const family = (id: string) => id.replace(/\d+$/, "")

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

function requestLines(part: SentPart, width: number): HelpLine[] {
  const out: HelpLine[] = [[{ text: part.to, tone: "key" }]]
  outline("", part.body, 2, width, out)
  return out
}

function labelled(label: string, text: string, width: number, column = 10, tone: HelpTone = "text"): HelpLine[] {
  return wrapText(text, Math.max(20, width - column)).map((line, i) => [{ text: (i ? "" : label).padEnd(column), tone: "muted" as const }, { text: line, tone }])
}

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
