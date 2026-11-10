import { wrapText } from "./textLayout"
import { JQL, JQL_EXAMPLE, JQL_SUMMARY, keeps, type Row } from "../domain/filterLanguage"

export type HelpTone = "head" | "key" | "text" | "muted"
export type HelpLine = Array<{ text: string; tone: HelpTone }>

export const SEARCH_HELP_WIDTH = 76

function searchHelpLines(full: boolean, width = SEARCH_HELP_WIDTH): HelpLine[] {
  const keep = keeps(false)
  const out: HelpLine[] = [
    ...wrapText(JQL_SUMMARY, width).map((line): HelpLine => [{ text: line, tone: "text" }]),
    [],
    [{ text: `  ${JQL_EXAMPLE.write}`, tone: "key" }],
    [{ text: `  ${JQL_EXAMPLE.means}`, tone: "muted" }],
  ]
  const shown = (r: Row) => keep(r) && (full || !!r.brief)
  const terms = JQL.filter((section) => full || section.brief).flatMap((section) => section.blocks).flatMap((b) => (b.kind === "rows" || b.kind === "gotchas" ? b.rows.filter(shown) : []))
  const column = Math.min(Math.max(...terms.map((r) => r.write.length)) + 4, 26)
  for (const section of JQL) {
    if (!full && !section.brief) continue
    out.push([], [{ text: section.title.toUpperCase(), tone: "head" }, ...(section.aside ? [{ text: `   ${section.aside}`, tone: "muted" as const }] : [])])
    for (const block of section.blocks) {
      if (block.kind === "text") { if (keep(block)) out.push(...wrapText(block.text, width - 2).map((line): HelpLine => [{ text: `  ${line}`, tone: "text" }])); continue }
      if (block.kind === "code") { out.push(...block.lines.map((line): HelpLine => [{ text: `  ${line}`, tone: "key" }])); continue }
      for (const row of block.rows.filter(shown)) {
        const fix = block.kind === "gotchas" && "fix" in row ? `→ ${row.fix}` : ""
        const lead = `  ${row.write}`
        const parts = wrapText(row.means, width - column)
        if (fix && parts.at(-1)!.length + 2 + fix.length <= width - column) parts[parts.length - 1] += `  ${fix}`
        else if (fix) parts.push(fix)
        if (lead.length >= column) out.push([{ text: lead, tone: "key" }])
        parts.forEach((part, n) => {
          const left = n === 0 && lead.length < column ? lead.padEnd(column) : " ".repeat(column)
          const arrow = fix ? part.indexOf("→ ") : -1
          out.push(arrow < 0 ? [{ text: left, tone: "key" }, { text: part, tone: "text" }]
            : [{ text: left, tone: "key" }, { text: part.slice(0, arrow), tone: "text" }, { text: part.slice(arrow), tone: "key" }])
        })
      }
    }
  }
  return out
}

export const SEARCH_HELP: HelpLine[] = searchHelpLines(false)
export const SEARCH_HELP_FULL: HelpLine[] = searchHelpLines(true)
