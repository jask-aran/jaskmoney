/**
 * Text labels inside a chart, beside the point they describe. Works on the
 * rows any chart renderer returns: a label goes only where its cells (and a
 * one-cell margin) hold nothing but blanks, gridlines or rules, trying right
 * of the point, then left, then the rows above and below, then two rows
 * out. Where its text fits nowhere at its point, its `short` forms try
 * there, longest first; then a line's `name` tries each point `along` it,
 * nearest first, so a line ending in a crowded corner is still named
 * further back. A bar's label stays with its bar: touching it, over it or
 * beside its top, in its shortest form if need be, before further up;
 * never drifting over a neighbour.
 *
 * Labels keep clear of those already placed (a row and two columns): the
 * first form and spot clear of them wins, else the first that fits at all.
 * A label that fits nowhere is dropped, so callers keep the figure
 * elsewhere (the legend), unless it's `required`: then it takes its first
 * spot inside the chart anyway. Labels are placed in the order given, so
 * the first ones win the space. Text is measured in cells: an emoji takes
 * two.
 */
import type { Run } from "./lineChart"
import { cellGrid, textCells } from "./runs"

export interface ChartLabel {
  /** The cell the label describes (row top first). */
  row: number
  col: number
  text: string
  /** Shorter texts for its point where `text` fits nowhere, longest
   * first ("$5.5k" for "General $5.5k"). */
  short?: string | string[]
  /** What the line is called, for points `along` it: no value, as the
   * label is away from the point the value belongs to. */
  name?: string
  /** Other cells on the label's line (lineAnchors), nearest first. */
  along?: Array<{ row: number; col: number }>
  ink: string
  /** The bar the label belongs to (`row` its top): the label goes over
   * it, its middle within the bar's columns, or just right of its top. */
  bar?: { col: number; width: number }
  /** Shown even where nothing is free (the period's own line). */
  required?: boolean
}

const shorts = (label: ChartLabel) => (label.short === undefined ? [] : Array.isArray(label.short) ? label.short : [label.short])

/** Cells a label may cover: blank, gridlines and rules. */
const FREE = new Set([" ", "│", "┈"])

/** A label's cells: an emoji's second cell is empty text, so the row keeps
 * its width. */
const labelCells = textCells

export function annotate(rows: Run[][], labels: ChartLabel[]): Run[][] {
  if (!labels.length || !rows.length) return rows
  const grid = cellGrid(rows)
  const width = grid.row(0).length
  const free = (r: number, from: number, to: number) => {
    if (r < 0 || r >= grid.height || from < 0 || to > width) return false
    // One cell of margin either side, where there is one.
    const cells = grid.row(r)
    for (let c = Math.max(0, from - 1); c < Math.min(width, to + 1); c++) if (!FREE.has(cells[c]!.text)) return false
    return true
  }
  // Where `n` cells could go for a point, best first.
  const spots = (row: number, col: number, n: number): Array<[number, number]> => {
    const centred: Array<[number, number]> = [[row - 1, col - Math.floor((n - 1) / 2)], [row + 1, col - Math.floor((n - 1) / 2)]]
    // Right of the point, or of a line two cells wide there (a spike), then left.
    const beside: Array<[number, number]> = [[row, col + 2], [row, col + 3], [row, col - 1 - n]]
    return [
      ...beside,
      ...centred,
      [row - 1, col + 1],
      [row - 1, col - n],
      [row + 1, col + 1],
      [row + 1, col - n],
      [row - 2, col - n],
      [row - 2, col + 1],
      [row + 2, col - n],
      [row + 2, col + 1],
      // Further out to the side: past a line a few cells wide (a spike).
      ...[4, 5, 6].flatMap((d): Array<[number, number]> => [[row, col + d], [row - 1, col + d], [row + 1, col + d], [row, col - n - d + 2]]),
    ]
  }
  // Where `n` cells could go for a bar whose top is `row`, nearest first:
  // touching it (the row over it, centred and then shifted while the
  // label's middle stays over the bar, or right of its top past a blank
  // column), then two rows up or right of the row under its top, then
  // three up.
  const barTiers = (row: number, bar: { col: number; width: number }, n: number): Array<Array<[number, number]>> => {
    const centred = bar.col + Math.floor((bar.width - n) / 2)
    const lo = bar.col - Math.floor((n - 1) / 2), hi = bar.col + bar.width - 1 - Math.floor((n - 1) / 2)
    const starts = [centred, ...Array.from({ length: 2 * Math.max(0, hi - lo) }, (_, k) => centred + (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2))].filter((c) => c >= lo && c <= hi)
    const over = (d: number) => starts.map((c): [number, number] => [row - d, c])
    const beside = (d: number): Array<[number, number]> => [[row + d, bar.col + bar.width + 1]]
    return [[...over(1), ...beside(0)], [...over(2), ...beside(1)], over(3)]
  }
  // Cells near a placed label: another label there reads as its neighbour.
  const near = new Uint8Array(grid.height * width)
  const clear = ([r, c]: [number, number], n: number) => {
    for (let rr = Math.max(0, r - 1); rr <= Math.min(grid.height - 1, r + 1); rr++)
      for (let cc = Math.max(0, c - 2); cc < Math.min(width, c + n + 2); cc++) if (near[rr * width + cc]) return false
    return true
  }
  const inside = (n: number) => ([r, c]: [number, number]) => r >= 0 && r < grid.height && c >= 0 && c + n <= width
  for (const label of labels) {
    const forms = [label.text, ...shorts(label)].map(labelCells)
    const bar = label.bar
    // Every form at every spot, best first: a bar's label touching its bar
    // in any form, longest first, before any further off; another's
    // longest form anywhere first, then a line's name back along it.
    // Made as they're tried: the search usually stops early, and a line's
    // name has a dozen or two spots at each of its points.
    function* candidates(): Generator<{ cells: string[]; spot: [number, number] }> {
      if (bar) {
        const tiers = forms.map((cells) => barTiers(label.row, bar, cells.length))
        for (let tier = 0; tier < tiers[0]!.length; tier++) for (let f = 0; f < forms.length; f++) for (const spot of tiers[f]![tier]!) yield { cells: forms[f]!, spot }
        return
      }
      const groups = [...forms.map((cells) => ({ cells, at: [label] as Array<{ row: number; col: number }> })), ...(label.name && label.along?.length ? [{ cells: labelCells(label.name), at: label.along }] : [])]
      for (const { cells, at } of groups) for (const p of at) for (const spot of spots(p.row, p.col, cells.length)) yield { cells, spot }
    }
    // The first clear of the labels placed; failing that, the first that
    // fits at all.
    let placed: { cells: string[]; spot: [number, number] } | undefined
    let firstOpen: typeof placed
    for (const candidate of candidates()) {
      const [r, c] = candidate.spot
      if (!free(r, c, c + candidate.cells.length)) continue
      firstOpen ??= candidate
      if (clear(candidate.spot, candidate.cells.length)) { placed = candidate; break }
    }
    placed ??= firstOpen
    if (!placed && label.required) {
      const cells = forms.at(-1)!
      const spot = (bar ? barTiers(label.row, bar, cells.length).flat() : spots(label.row, label.col, cells.length)).find(inside(cells.length))
      if (spot) placed = { cells, spot }
    }
    if (!placed) continue
    const [r, c] = placed.spot
    placed.cells.forEach((text, k) => {
      grid.set(r, c + k, { text, ink: label.ink })
      near[r * width + c + k] = 1
    })
  }
  return grid.runs()
}

/** Single cells written over a chart's rows (a day's point above a line). */
export function stamp(rows: Run[][], points: Array<{ row: number; col: number; text: string; ink: string }>): Run[][] {
  if (!points.length || !rows.length) return rows
  const grid = cellGrid(rows)
  for (const p of points) if (rows[p.row] && grid.row(p.row)[p.col]) grid.set(p.row, p.col, { text: p.text, ink: p.ink })
  return grid.runs()
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
