import { FILTER_LANGUAGE } from "../domain/filterLanguage"

/**
 * F1 in the search bar: the filter language (domain/filterLanguage, the same
 * description the rule writer's model gets) laid out for people: each
 * section's terms in a column, meanings wrapped beside them, notes under.
 * Lines of coloured parts, each at most SEARCH_HELP_WIDTH wide; the dialog
 * scrolls them when the screen is short.
 */
export type HelpTone = "head" | "key" | "text" | "muted"
export type HelpLine = Array<{ text: string; tone: HelpTone }>

export const SEARCH_HELP_WIDTH = 76

/** `text` in lines of at most `width`, broken between words. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word }
    else line = line ? `${line} ${word}` : word
  }
  return line ? [...lines, line] : lines
}

export function searchHelpLines(width = SEARCH_HELP_WIDTH): HelpLine[] {
  const out: HelpLine[] = []
  FILTER_LANGUAGE.forEach((section, i) => {
    if (i) out.push([])
    out.push([{ text: section.title, tone: "head" }, ...(section.lead ? [{ text: `   ${section.lead}`, tone: "muted" as const }] : [])])
    // The term column: as wide as the section's widest term, and a gap.
    const column = Math.max(...section.items.map((item) => item.term.length)) + 2
    for (const item of section.items) {
      wrap(item.means, width - column).forEach((part, n) => out.push([
        { text: (n ? "" : item.term).padEnd(column), tone: "key" },
        { text: part, tone: "text" },
      ]))
    }
    for (const note of section.notes ?? []) for (const part of wrap(note.means, width)) out.push([{ text: part, tone: "muted" }])
  })
  return out
}

export const SEARCH_HELP: HelpLine[] = searchHelpLines()
