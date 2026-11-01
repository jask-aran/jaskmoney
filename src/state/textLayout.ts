/** `text` in lines of at most `width`, broken between words (a longer word is cut). */
export function wrapText(text: string, width: number): string[] {
  width = Math.max(1, Math.floor(width))
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

