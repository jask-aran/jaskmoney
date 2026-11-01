import type { Run } from "./lineChart"

/**
 * A chart drawing itself in: what's shown of a plot row `p` of the way
 * (0–1) through. Lines (braille) trace left to right behind an edge; bars
 * (block elements) rise from the bottom row. A label in the plot (a
 * stretch of words: a peak's name, a total) appears once the edge has
 * passed its end, a beat after its point: labels come in the order their
 * points do. On a chart with bars (`bars`) it waits, too, for the bars to
 * reach its row. The frame (gridlines, rules, axes: box drawing) is there
 * from the start, so the chart's shape is never in doubt. Pure: the same
 * model, a mask over it.
 */
export function revealRuns(runs: Run[], row: number, rows: number, p: number, frame?: ReadonlyMap<number, Run>, bars = false): Run[] {
  if (p >= 1) return runs
  const cells: Array<{ ch: string; ink: Run["ink"] }> = []
  for (const run of runs) for (const ch of run.text) cells.push({ ch, ink: run.ink })
  const width = cells.length
  const edge = p * width
  // Rows from the bottom that bars have reached.
  const risen = row >= rows - Math.ceil(p * rows)
  const kind = (ch: string): "space" | "line" | "bar" | "frame" | "word" => {
    if (ch === " ") return "space"
    const code = ch.codePointAt(0)!
    if (code >= 0x2800 && code <= 0x28ff) return "line"
    if (code >= 0x2580 && code <= 0x259f) return "bar"
    if (code >= 0x2500 && code <= 0x257f) return "frame"
    return "word"
  }
  // Each label's last column: words joined by single spaces.
  const labelEnd = new Array<number>(width).fill(-1)
  for (let i = 0; i < width; i++) {
    if (kind(cells[i]!.ch) !== "word") continue
    let end = i
    while (end + 1 < width && (kind(cells[end + 1]!.ch) === "word" || (cells[end + 1]!.ch === " " && end + 2 < width && kind(cells[end + 2]!.ch) === "word"))) end++
    for (let j = i; j <= end; j++) labelEnd[j] = end
    i = end
  }
  const out: Run[] = []
  const put = (ch: string, ink: Run["ink"]) => {
    const last = out.at(-1)
    if (last && last.ink === ink) last.text += ch
    else out.push({ text: ch, ink })
  }
  cells.forEach(({ ch, ink }, col) => {
    let shown: boolean
    if (labelEnd[col]! >= 0) shown = edge >= labelEnd[col]! + LABEL_LAG && (!bars || risen)
    else {
      const k = kind(ch)
      shown = k === "space" || k === "frame" || (k === "line" ? col < edge : risen)
    }
    // Hidden: what's beneath it, the column's gridline if it has one.
    const under = frame?.get(col)
    if (shown) put(ch, ink)
    else if (under) put(under.text, under.ink)
    else put(" ", ink)
  })
  return out
}

/** How far (columns) past a label's end the edge goes before it shows: a
 * beat after its point. */
const LABEL_LAG = 1.5

/** Each column's gridline (its character and ink) anywhere in the plot,
 * for revealRuns to show where a line or bar hasn't reached yet. */
export function gridColumns(rows: Run[][]): Map<number, Run> {
  const found = new Map<number, Run>()
  for (const runs of rows) {
    let col = 0
    for (const run of runs) for (const ch of run.text) {
      if (!found.has(col) && (ch === "│" || ch === "┊" || ch === "┆" || ch === "╎")) found.set(col, { text: ch, ink: run.ink })
      col++
    }
  }
  return found
}

/** Whether a plot has bars (block elements) anywhere: its labels wait for them to rise. */
export function hasBars(rows: Run[][]): boolean {
  return rows.some((runs) => runs.some((run) => /[▀-▟]/.test(run.text)))
}

/** Ease out: quick to start, settling at the end. */
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3
