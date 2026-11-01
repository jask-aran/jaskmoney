/**
 * Bars hatched rather than solid (Settings › Appearance › Bar fills): each
 * full block becomes ╱ in the same ink. A column's part-filled top cell
 * rounds to a whole one (half or more hatched, less left blank), except on
 * a bar shorter than a cell, which keeps its eighth so it still shows.
 */
import type { ChartModel } from "./ChartBody"
import type { Span } from "../primitives/spans"
import { cellsToRuns } from "./runs"

export const HATCH = "╱"
const FULL = "█"
const HIGH = new Set(["▄", "▅", "▆", "▇"])
const LOW = new Set(["▁", "▂", "▃"])

/** `text` with its full blocks hatched. */
export const hatchText = (text: string): string => (text.includes(FULL) ? text.replaceAll(FULL, HATCH) : text)

/** Spans with their full blocks hatched (the Budgets tab's bars). */
export const hatchSpans = (spans: Span[]): Span[] => spans.map((span) => (span.text.includes(FULL) ? { ...span, text: hatchText(span.text) } : span))

/** A chart's plot with its column bars hatched (the same model when it has none). */
export function hatchModel(model: ChartModel): ChartModel {
  if (!model.rows.some((runs) => runs.some((run) => run.text.includes(FULL)))) return model
  const grid = model.rows.map((runs) => runs.flatMap((run) => [...run.text].map((text) => ({ text, ink: run.ink }))))
  const rows = grid.map((cells, r) => cellsToRuns(cells.map((cell, c) => {
    if (cell.text === FULL) return { ...cell, text: HATCH }
    const partial = HIGH.has(cell.text) || LOW.has(cell.text)
    if (!partial) return cell
    // A part-filled cell over a full one of the same bar is its top.
    const below = grid[r + 1]?.[c]
    const onBar = below?.text === FULL && below.ink === cell.ink
    if (!onBar) return cell
    return HIGH.has(cell.text) ? { ...cell, text: HATCH } : { text: " ", ink: null }
  })))
  return { ...model, rows, legend: hatchSpans(model.legend) }
}
