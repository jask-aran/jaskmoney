import type { Run } from "./lineChart"
import { cellGrid, textCells } from "./runs"

export interface ChartLabel {
  row: number
  col: number
  text: string
  short?: string | string[]
  name?: string
  along?: Array<{ row: number; col: number }>
  ink: string
  bar?: { col: number; width: number }
  required?: boolean
}

const shorts = (label: ChartLabel) => (label.short === undefined ? [] : Array.isArray(label.short) ? label.short : [label.short])

const FREE = new Set([" ", "│", "┈"])

const labelCells = textCells

const spots = (row: number, col: number, n: number): Array<[number, number]> => {
  const centred: Array<[number, number]> = [[row - 1, col - Math.floor((n - 1) / 2)], [row + 1, col - Math.floor((n - 1) / 2)]]
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
    ...[4, 5, 6].flatMap((d): Array<[number, number]> => [[row, col + d], [row - 1, col + d], [row + 1, col + d], [row, col - n - d + 2]]),
  ]
}

const barTiers = (row: number, bar: { col: number; width: number }, n: number): Array<Array<[number, number]>> => {
  const centred = bar.col + Math.floor((bar.width - n) / 2)
  const lo = bar.col - Math.floor((n - 1) / 2), hi = bar.col + bar.width - 1 - Math.floor((n - 1) / 2)
  const starts = [centred, ...Array.from({ length: 2 * Math.max(0, hi - lo) }, (_, k) => centred + (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2))].filter((c) => c >= lo && c <= hi)
  const over = (d: number) => starts.map((c): [number, number] => [row - d, c])
  const beside = (d: number): Array<[number, number]> => [[row + d, bar.col + bar.width + 1]]
  return [[...over(1), ...beside(0)], [...over(2), ...beside(1)], over(3)]
}

export function annotate(rows: Run[][], labels: ChartLabel[]): Run[][] {
  if (!labels.length || !rows.length) return rows
  const grid = cellGrid(rows)
  const width = grid.row(0).length
  const free = (r: number, from: number, to: number) => {
    if (r < 0 || r >= grid.height || from < 0 || to > width) return false
    const cells = grid.row(r)
    for (let c = Math.max(0, from - 1); c < Math.min(width, to + 1); c++) if (!FREE.has(cells[c]!.text)) return false
    return true
  }
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
    function* candidates(): Generator<{ cells: string[]; spot: [number, number] }> {
      if (bar) {
        const tiers = forms.map((cells) => barTiers(label.row, bar, cells.length))
        for (let tier = 0; tier < tiers[0]!.length; tier++) for (let f = 0; f < forms.length; f++) for (const spot of tiers[f]![tier]!) yield { cells: forms[f]!, spot }
        return
      }
      const groups = [...forms.map((cells) => ({ cells, at: [label] as Array<{ row: number; col: number }> })), ...(label.name && label.along?.length ? [{ cells: labelCells(label.name), at: label.along }] : [])]
      for (const { cells, at } of groups) for (const p of at) for (const spot of spots(p.row, p.col, cells.length)) yield { cells, spot }
    }
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

export function stamp(rows: Run[][], points: Array<{ row: number; col: number; text: string; ink: string }>): Run[][] {
  if (!points.length || !rows.length) return rows
  const grid = cellGrid(rows)
  for (const p of points) if (rows[p.row] && grid.row(p.row)[p.col]) grid.set(p.row, p.col, { text: p.text, ink: p.ink })
  return grid.runs()
}

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
