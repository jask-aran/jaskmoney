/** Block bar charts. Line charts live in lineChart.ts. */
import type { Run } from "./lineChart"
import { cellsToRuns } from "./runs"

const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/**
 * Where each of `n` bars goes across `width` columns: in groups of `group`
 * bars that stand together (a week's money in and out), the groups spread
 * evenly from the first column to the last. Every bar is as wide as the
 * narrowest group allows, after a one-column gap when every group has a
 * column to spare (the last group keeps its gap too), so bars never differ
 * in width: the columns left over widen the gaps (or, shoulder to
 * shoulder, open the odd one).
 */
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

/**
 * Vertical bars, one per value, in the slots barSlots gives them (the
 * pane's width shared out; `group` bars stand together), scaled so `max`
 * fills `height` rows. Rows are returned top first as runs tagged with
 * each bar's ink; `slots` gives each bar's first column and width. Zero
 * stays blank; any positive value shows at least one eighth. `rules` draw
 * dotted horizontal rules at their values through blank cells (across
 * columns `from` to `to`, all by default); `markers` draw vertical rules
 * through blank cells of their columns (over the dotted ones). Rules are
 * a layer under the bars: a bar over a rule's column hides it there.
 * `at` places the bars instead of barSlots (bars placed by their dates).
 */
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
  // The row (counted from the bottom) holding each rule's value.
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

/** Row (top first) a rule at `value` is drawn on by columnBars. */
export function ruleRow(value: number, max: number, height: number): number {
  return height - 1 - Math.min(height - 1, Math.floor((value / max) * height))
}

/** Row (top first) holding the top of a bar of `value` in a chart built by
 * columnBars with the same `max` and `height`; -1 for an empty bar. */
export function barTopRow(value: number, max: number, height: number): number {
  if (value <= 0 || max <= 0) return -1
  const level = Math.max(1, Math.min(height * 8, Math.round((value / max) * height * 8)))
  return height - Math.ceil(level / 8)
}
