/** Block bar and filled level charts. Line charts live in lineChart.ts. */
import type { Run } from "./lineChart"

const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/**
 * Vertical bars, one per value, each in a slot of `floor(width / n)` columns
 * (the bar is the slot less a one-column gap when the slot is wider than 1),
 * scaled so `max` fills `height` rows. Rows are returned top first as runs
 * tagged with each bar's ink; `slots` gives each bar's first column and
 * width. Zero stays blank; any positive value shows at least one eighth.
 * `ref` draws a dotted horizontal rule at its value through blank cells;
 * `markers` draw vertical rules through blank cells of their columns (over
 * the ref rule).
 */
export function columnBars(
  bars: Array<{ value: number; ink: string }>,
  width: number,
  height: number,
  max: number,
  ref?: { value: number; ink: string },
  markers: Array<{ col: number; ink: string }> = [],
): { rows: Run[][]; slots: Array<{ col: number; width: number }> } {
  const n = bars.length
  if (n === 0 || width <= 0 || height <= 0) return { rows: [], slots: [] }
  const slot = Math.max(1, Math.floor(width / n))
  const barWidth = slot > 1 ? slot - 1 : slot
  const slots = bars.map((_, i) => ({ col: i * slot, width: barWidth })).filter((s) => s.col + s.width <= width)
  const levels = bars.map(({ value }) => (value <= 0 || max <= 0 ? 0 : Math.max(1, Math.min(height * 8, Math.round((value / max) * height * 8)))))
  // Row (counted from the bottom) holding the reference value.
  const refRow = ref && max > 0 && ref.value > 0 ? Math.min(height - 1, Math.floor((ref.value / max) * height)) : -1
  const rows: Run[][] = []
  for (let r = height - 1; r >= 0; r--) {
    const blank = r === refRow ? { text: "┈", ink: ref!.ink } : { text: " ", ink: null }
    const cells = new Array<{ text: string; ink: string | null }>(width).fill(blank)
    for (const m of markers) if (m.col >= 0 && m.col < width) cells[m.col] = { text: "│", ink: m.ink }
    slots.forEach((s, i) => {
      const glyph = EIGHTHS[Math.max(0, Math.min(8, levels[i]! - r * 8))] || " "
      for (let c = s.col; c < s.col + s.width; c++) if (glyph !== " ") cells[c] = { text: glyph, ink: bars[i]!.ink }
    })
    const runs: Run[] = []
    for (const cell of cells) {
      const last = runs[runs.length - 1]
      if (last && last.ink === cell.ink) last.text += cell.text
      else runs.push({ ...cell })
    }
    rows.push(runs)
  }
  return { rows, slots }
}

/**
 * Filled area chart of a level series (e.g. net position) between `min` and
 * `max`, `height` rows, eighth-block resolution, rows top first as runs. Each
 * column shows the value at the end of its slice of the series, so the last
 * column is the latest value. Filled cells are inked "area" (callers shade
 * them by row); empty cells in `markers` columns get a "grid" rule.
 */
export function areaChart(
  values: number[],
  width: number,
  height: number,
  min: number,
  max: number,
  markers: number[] = [],
): Run[][] {
  if (values.length === 0 || width <= 0 || height <= 0) return []
  const span = max - min || 1
  const levels: number[] = []
  for (let c = 0; c < width; c++) {
    const v = values[Math.min(values.length - 1, Math.max(0, Math.ceil(((c + 1) * values.length) / width) - 1))]!
    levels.push(Math.max(1, Math.min(height * 8, Math.round(((v - min) / span) * height * 8))))
  }
  const grid = new Set(markers)
  const rows: Run[][] = []
  for (let r = height - 1; r >= 0; r--) {
    const runs: Run[] = []
    for (let c = 0; c < width; c++) {
      const level = levels[c]!
      const eighths = Math.max(0, Math.min(8, level - r * 8))
      const [text, ink] = eighths > 0 ? [EIGHTHS[eighths]!, "area"] : grid.has(c) ? ["│", "grid"] : [" ", null]
      const last = runs[runs.length - 1]
      if (last && last.ink === ink) last.text += text
      else runs.push({ text, ink })
    }
    rows.push(runs)
  }
  return rows
}
