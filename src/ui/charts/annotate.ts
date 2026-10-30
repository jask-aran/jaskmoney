/**
 * Text labels inside a chart, beside the point they describe. Works on the
 * rows any chart renderer returns: a label goes only where its cells (and a
 * one-cell margin) hold nothing but blanks, gridlines or rules, trying right
 * of the point, then left, then the rows above and below (above first for
 * bar tops), then two rows out. A label that fits nowhere is dropped, so
 * callers keep the figure elsewhere (the legend), unless it's `required`:
 * then it takes its first spot inside the chart anyway. Labels are placed
 * in the order given, so the first ones win the space.
 *
 * Where the text fits nowhere at its point, a `short` form tries there
 * next; then a line's `name` tries each point `along` it, nearest first, so
 * a line ending in a crowded corner is still named further back. Text is
 * measured in cells: an emoji takes two.
 */
import type { Run } from "./lineChart"
import { cellsToRuns } from "./runs"

export interface ChartLabel {
  /** The cell the label describes (row top first). */
  row: number
  col: number
  text: string
  /** A shorter text for its point where `text` fits nowhere ("$5.5k" for
   * "General $5.5k"). */
  short?: string
  /** What the line is called, for points `along` it: no value, as the
   * label is away from the point the value belongs to. */
  name?: string
  /** Other cells on the label's line (lineAnchors), nearest first. */
  along?: Array<{ row: number; col: number }>
  /** More points `text` may go by, tried right after its own (the right
   * edge of a wide bar, whose label can't sit over it). */
  alsoAt?: Array<{ row: number; col: number }>
  ink: string
  /** Try the row above first (bar tops). */
  above?: boolean
  /** Shown even where nothing is free (the period's own line). */
  required?: boolean
}

/** Cells a label may cover: blank, gridlines and rules. */
const FREE = new Set([" ", "│", "┈"])

const graphemes = new Intl.Segmenter()
/** A label's cells: an emoji's second cell is empty text, so the row keeps
 * its width. */
const labelCells = (text: string) =>
  [...graphemes.segment(text)].flatMap(({ segment }) => [segment, ...Array<string>(Math.max(0, Bun.stringWidth(segment) - 1)).fill("")])

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
  // Where `n` cells could go for a point, best first.
  const spots = (row: number, col: number, n: number, above = false): Array<[number, number]> => {
    const centred: Array<[number, number]> = [[row - 1, col - Math.floor((n - 1) / 2)], [row + 1, col - Math.floor((n - 1) / 2)]]
    const beside: Array<[number, number]> = [[row, col + 2], [row, col - 1 - n]]
    return [
      ...(above ? [...centred, ...beside] : [...beside, ...centred]),
      [row - 1, col + 1],
      [row - 1, col - n],
      [row + 1, col + 1],
      [row + 1, col - n],
      [row - 2, col - n],
      [row - 2, col + 1],
      [row + 2, col - n],
      [row + 2, col + 1],
    ]
  }
  const inside = (n: number) => ([r, c]: [number, number]) => r >= 0 && r < grid.length && c >= 0 && c + n <= width
  for (const label of labels) {
    const tries = [
      { text: label.text, at: [label, ...(label.alsoAt ?? [])] },
      ...(label.short ? [{ text: label.short, at: [label, ...(label.alsoAt ?? [])] }] : []),
      ...(label.name && label.along?.length ? [{ text: label.name, at: label.along }] : []),
    ]
    let placed: { cells: string[]; spot: [number, number] } | undefined
    for (const t of tries) {
      const cells = labelCells(t.text)
      for (const p of t.at) {
        const spot = spots(p.row, p.col, cells.length, label.above).find(([r, c]) => free(r, c, c + cells.length))
        if (spot) { placed = { cells, spot }; break }
      }
      if (placed) break
    }
    if (!placed && label.required) {
      const cells = labelCells(label.short ?? label.text)
      const spot = spots(label.row, label.col, cells.length, label.above).find(inside(cells.length))
      if (spot) placed = { cells, spot }
    }
    if (!placed) continue
    const [r, c] = placed.spot
    placed.cells.forEach((text, k) => (grid[r]![c + k] = { text, ink: label.ink }))
  }
  return grid.map(cellsToRuns)
}

/** Single cells written over a chart's rows (a day's point above a line). */
export function stamp(rows: Run[][], points: Array<{ row: number; col: number; text: string; ink: string }>): Run[][] {
  if (!points.length || !rows.length) return rows
  const grid = rows.map((runs) => runs.flatMap((run) => [...run.text].map((text) => ({ text, ink: run.ink }))))
  for (const p of points) if (grid[p.row]?.[p.col]) grid[p.row]![p.col] = { text: p.text, ink: p.ink }
  return grid.map(cellsToRuns)
}

/** Cells along a line, one per column, from index `from` back to its
 * start: the places a label naming the line may go (ChartLabel.along). */
export function lineAnchors(values: Array<number | null>, from: number, at: (index: number, value: number) => { row: number; col: number }): Array<{ row: number; col: number }> {
  const out: Array<{ row: number; col: number }> = []
  let lastCol = Infinity
  for (let i = from; i >= 0; i--) {
    const v = values[i]
    if (v == null) continue
    const p = at(i, v)
    if (p.col < lastCol) { out.push(p); lastCol = p.col }
  }
  return out
}
