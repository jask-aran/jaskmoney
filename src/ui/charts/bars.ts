import type { Run } from "./lineChart"
import { cellsToRuns } from "./runs"

const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

export function barSlots(n: number, width: number, group = 1): Array<{ col: number; width: number }> {
  if (n <= 0 || width <= 0) return []
  const groups = Math.ceil(n / group)
  const narrowest = Math.floor(width / groups)
  const gap = narrowest > group ? 1 : 0
  const bar = Math.max(1, Math.floor((narrowest - gap) / group))
  const span = group * bar
  const room = Math.max(0, width - gap - span)
  return Array.from({ length: groups }, (_, k) => (groups > 1 ? Math.round((k * room) / (groups - 1)) : 0)).flatMap((col, k) =>
    Array.from({ length: Math.min(group, n - k * group) }, (_, m) => ({ col: col + m * bar, width: bar })),
  ).filter((s) => s.col + s.width <= width)
}

interface BarRule { value: number; ink: string; from?: number; to?: number }

export function columnBars(
  bars: Array<{ value: number; ink: string }>,
  width: number,
  height: number,
  max: number,
  rules?: BarRule | BarRule[],
  markers: Array<{ col: number; ink: string }> = [],
  group = 1,
  at?: Array<{ col: number; width: number }>,
): { rows: Run[][]; slots: Array<{ col: number; width: number }> } {
  const n = bars.length
  if (n === 0 || width <= 0 || height <= 0) return { rows: [], slots: [] }
  const slots = at ?? barSlots(n, width, group)
  const levels = bars.map(({ value }) => (value <= 0 || max <= 0 ? 0 : Math.max(1, Math.min(height * 8, Math.round((value / max) * height * 8)))))
  const lines = (rules === undefined ? [] : Array.isArray(rules) ? rules : [rules])
    .filter((l) => max > 0 && l.value > 0)
    .map((l) => ({ ...l, row: Math.min(height - 1, Math.floor((l.value / max) * height)) }))
  const rows: Run[][] = []
  for (let r = height - 1; r >= 0; r--) {
    const cells = new Array<{ text: string; ink: string | null }>(width).fill({ text: " ", ink: null })
    for (const l of lines) if (l.row === r) for (let c = Math.max(0, l.from ?? 0); c < Math.min(width, l.to ?? width); c++) cells[c] = { text: "┈", ink: l.ink }
    for (const m of markers) if (m.col >= 0 && m.col < width) cells[m.col] = { text: "│", ink: m.ink }
    slots.forEach((s, i) => {
      const glyph = EIGHTHS[Math.max(0, Math.min(8, levels[i]! - r * 8))] || " "
      for (let c = s.col; c < s.col + s.width; c++) if (glyph !== " ") cells[c] = { text: glyph, ink: bars[i]!.ink }
    })
    rows.push(cellsToRuns(cells))
  }
  return { rows, slots }
}

export function ruleRow(value: number, max: number, height: number): number {
  return height - 1 - Math.min(height - 1, Math.floor((value / max) * height))
}

export function barTopRow(value: number, max: number, height: number): number {
  if (value <= 0 || max <= 0) return -1
  const level = Math.max(1, Math.min(height * 8, Math.round((value / max) * height * 8)))
  return height - Math.ceil(level / 8)
}
