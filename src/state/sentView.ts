import type { SentPart } from "../app/sentPreview"
import type { HelpLine } from "./searchHelp"

/**
 * What a use sends (app/sentPreview), as lines for the viewer: per request
 * its title, when it's sent, where to, then the body as an outline (keys,
 * nested values indented, long text wrapped, multi-line text as
 * paragraphs). A family of like questions (kind1 … kind51) shows its first
 * and how many more, so a smart search's 100 category questions read as
 * one. Nothing else is changed: the wording is as sent.
 */

/** `text` in lines of at most `width`, broken between words (a longer word is cut). */
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (let word of paragraph.split(" ")) {
      while (word.length > width) {
        if (line) { out.push(line); line = "" }
        out.push(word.slice(0, width))
        word = word.slice(width)
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}

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
      for (const line of wrap(text, Math.max(20, width - indent - 2))) out.push([{ text: `${pad}  ${line}`, tone: "text" }])
      return
    }
    out.push([{ text: `${pad}${label}`, tone: "key" }, { text, tone: "text" }])
    return
  }
  // A list's item that fits on a line is its JSON there (the brief's 50 categories).
  const compact = JSON.stringify(value)
  if (key.startsWith("[") && pad.length + label.length + compact.length <= width) {
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
    else for (const line of wrap(`… ${entry.more} more like it (${entry.first} to ${entry.last}), each the same with its own subject`, Math.max(20, width - inner))) out.push([{ text: `${" ".repeat(inner)}${line}`, tone: "muted" }])
  }
}

export function sentLines(parts: SentPart[], width: number): HelpLine[] {
  const out: HelpLine[] = []
  parts.forEach((part, i) => {
    if (i) out.push([])
    out.push([{ text: part.title, tone: "head" }])
    for (const line of wrap(`Sent ${part.when}.`, width)) out.push([{ text: line, tone: "muted" }])
    out.push([{ text: part.to, tone: "key" }])
    outline("", part.body, 2, width, out)
  })
  return out
}
