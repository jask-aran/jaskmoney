/**
 * Text labels inside a chart, beside the point they describe. Works on the
 * rows any chart renderer returns: a label goes only where its cells (and a
 * one-cell margin) hold nothing but blanks, gridlines or rules, trying right
 * of the point, then left, then the rows above and below (above first for
 * bar tops), then two rows out. A label that fits nowhere is dropped, so
 * callers keep the figure elsewhere (the legend), unless it's `required`:
 * then it takes its first spot inside the chart anyway. Labels are placed
 * in the order given, so the first ones win the space. A label with a
 * `short` form tries every spot with its text, then every spot with that.
 */
import type { Run } from "./lineChart"
import { cellsToRuns } from "./runs"

export interface ChartLabel {
  /** The cell the label describes (row top first). */
  row: number
  col: number
  text: string
  /** A shorter text for where `text` fits nowhere ("$5.5k" for
   * "General $5.5k"). */
  short?: string
  ink: string
  /** Try the row above first (bar tops). */
  above?: boolean
  /** Shown even where nothing is free (the period's own line). */
  required?: boolean
}

/** Cells a label may cover: blank, gridlines and rules. */
const FREE = new Set([" ", "│", "┈"])

export function annotate(rows: Run[][], labels: ChartLabel[]): Run[][] {
  if (!labels.length || !rows.length) return rows
  const grid = rows.map((runs) => runs.flatMap((run) => [...run.text].map((text) => ({ text, ink: run.ink }))))
  const width = grid[0]!.length
  const free = (r: number, from: number, to: number) => {
    if (r < 0 || r >= grid.length || from < 0 || to > width) return false
    // One cell of margin either side, where there is one.
    for (let c = Math.max(0, from - 1); c < Math.min(width, to + 1); c++) if (!FREE.has(grid[r]![c]!.text)) return false
    return true
  }
  const spotFor = (label: ChartLabel, text: string) => {
    const n = [...text].length
    const { row, col } = label
    const centred: Array<[number, number]> = [[row - 1, col - Math.floor((n - 1) / 2)], [row + 1, col - Math.floor((n - 1) / 2)]]
    const beside: Array<[number, number]> = [[row, col + 2], [row, col - 1 - n]]
    const spots: Array<[number, number]> = [
      ...(label.above ? [...centred, ...beside] : [...beside, ...centred]),
      [row - 1, col + 1],
      [row - 1, col - n],
      [row + 1, col + 1],
      [row + 1, col - n],
      [row - 2, col - n],
      [row - 2, col + 1],
      [row + 2, col - n],
      [row + 2, col + 1],
    ]
    const inside = ([r, c]: [number, number]) => r >= 0 && r < grid.length && c >= 0 && c + n <= width
    return { found: spots.find(([r, c]) => free(r, c, c + n)), inside: spots.find(inside) }
  }
  for (const label of labels) {
    const long = spotFor(label, label.text)
    const short = label.short && !long.found ? spotFor(label, label.short) : undefined
    const [text, spot] = long.found ? [label.text, long.found]
      : short?.found ? [label.short!, short.found]
      : label.required ? [label.short ?? label.text, (short ?? long).inside] : [label.text, undefined]
    if (!spot) continue
    const [r, c] = spot
    ;[...text].forEach((ch, k) => (grid[r]![c + k] = { text: ch, ink: label.ink }))
  }
  return grid.map(cellsToRuns)
}
