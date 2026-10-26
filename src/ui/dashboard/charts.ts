/** Block bar charts for the dashboard. Line charts live in lineChart.ts. */
import type { Run } from "./lineChart"

const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/**
 * Vertical bars, one per value, each in a slot of `floor(width / n)` columns
 * (the bar is the slot less a one-column gap when the slot is wider than 1),
 * scaled so `max` fills `height` rows. Rows are returned top first as runs
 * tagged with each bar's ink; `slots` gives each bar's first column and
 * width. Zero stays blank; any positive value shows at least one eighth.
 */
export function columnBars(
  bars: Array<{ value: number; ink: string }>,
  width: number,
  height: number,
  max: number,
): { rows: Run[][]; slots: Array<{ col: number; width: number }> } {
  const n = bars.length
  if (n === 0 || width <= 0 || height <= 0) return { rows: [], slots: [] }
  const slot = Math.max(1, Math.floor(width / n))
  const barWidth = slot > 1 ? slot - 1 : slot
  const slots = bars.map((_, i) => ({ col: i * slot, width: barWidth })).filter((s) => s.col + s.width <= width)
  const levels = bars.map(({ value }) => (value <= 0 || max <= 0 ? 0 : Math.max(1, Math.min(height * 8, Math.round((value / max) * height * 8)))))
  const rows: Run[][] = []
  for (let r = height - 1; r >= 0; r--) {
    const cells = new Array<{ text: string; ink: string | null }>(width).fill({ text: " ", ink: null })
    slots.forEach((s, i) => {
      const glyph = EIGHTHS[Math.max(0, Math.min(8, levels[i]! - r * 8))] || " "
      for (let c = s.col; c < s.col + s.width; c++) cells[c] = { text: glyph, ink: glyph === " " ? null : bars[i]!.ink }
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
