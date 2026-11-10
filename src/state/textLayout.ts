import { characters } from "../domain/textField"

const columns = (text: string) => Bun.stringWidth(text)

export function wrapText(text: string, width: number): string[] {
  width = Math.max(1, Math.floor(width))
  const out: string[] = []
  for (const paragraph of text.split("\n")) {
    let line = ""
    for (let word of paragraph.split(" ")) {
      while (columns(word) > width) {
        if (line) { out.push(line); line = "" }
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
