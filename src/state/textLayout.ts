import { characters } from "../domain/textField"

/** How many columns a terminal gives `text`: an emoji or a wide character
 * takes two, a combining mark none. */
const columns = (text: string) => Bun.stringWidth(text)

/** `text` in lines of at most `width` columns, broken between words (a
 * longer word is cut, between characters). Counted in columns, not code
 * units: "🏖️ Holiday" is 10 columns, though 11 code units by .length;
 * "東京" is 4 columns, though 2 code units. */
export function wrapText(text: string, width: number): string[] {
  width = Math.max(1, Math.floor(width))
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (let word of paragraph.split(" ")) {
      while (columns(word) > width) {
        if (line) { out.push(line); line = "" }
        // As many whole characters as fit (at least one).
        let cut = ""
        for (const ch of characters(word)) {
          if (cut && columns(cut + ch) > width) break
          cut += ch
        }
        out.push(cut)
        word = word.slice(cut.length)
      }
      if (!line) line = word
      else if (columns(line) + 1 + columns(word) <= width) line += ` ${word}`
      else { out.push(line); line = word }
    }
    out.push(line)
  }
  return out
}
