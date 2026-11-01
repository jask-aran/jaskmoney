import { Index, Show } from "solid-js"
import { gridColumns, hasBars, revealRuns } from "./reveal"
import { useReveal } from "./motion"
import type { ChartLabelMode } from "./motion"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { ink } from "../../theme"
import type { Run } from "./lineChart"
import { textCells } from "./runs"
import type { Span } from "../primitives/spans"

/** Columns every y-axis keeps for its labels: room for the money labels
 * charts usually have ("$0", "$500", "$10k", "-$1.5k"), so the axis, and
 * the gridlines after it, stay put from view to view and range to range.
 * Only a longer label widens it. */
const AXIS_LABEL = 6

/** The y-axis width for `ticks`: the longest label (at least AXIS_LABEL),
 * a space and the tick. */
export function axisWidth(ticks: Map<number, string>): number {
  return Math.max(AXIS_LABEL, ...[...ticks.values()].map((t) => t.length)) + 2
}

/** The axis width before the ticks are known: usually the right one. */
export const AXIS_GUESS = AXIS_LABEL + 2

export interface ChartModel {
  rows: Run[][]
  /** Axis label per row (top first). */
  ticks: Map<number, string>
  /** X-axis label line, aligned with the plot. */
  labels: string
  /** Where in `labels` today's date sits, drawn in today's ink. */
  today?: { start: number; length: number }
  /** Other stretches of `labels` in an ink of their own (a month's net). */
  labelInks?: Array<{ start: number; length: number; ink: string }>
  /** The legend: series marks in their colours with names and figures,
   * shown in the pane's bottom border. */
  legend: Span[]
  /** Colours for inks only this chart has (a saver's line), over the
   * shared ones. */
  inks?: Record<string, string>
}

/** The x-axis line under the plot: a corner under the y-axis, then a rule
 * with a tick wherever a gridline comes down to it. */
export function xAxisLine(rows: Run[][]): string {
  const gridlines = new Set<number>()
  for (const runs of rows) {
    let col = 0
    for (const run of runs) for (const ch of textCells(run.text)) { if (ch === "│") gridlines.add(col); col++ }
  }
  const width = rows[0]?.reduce((n, run) => n + textCells(run.text).length, 0) ?? 0
  return "└" + Array.from({ length: width }, (_, c) => (gridlines.has(c) ? "┴" : "─")).join("")
}

/** The x labels as spans: label grey, with stretches in their own colours
 * (today's date in its rule's). */
function axisLabels(text: string, coloured: Array<{ start: number; length: number; fg: string }>): Span[] {
  const fgs = new Array<string>(text.length).fill(ink.label)
  for (const c of coloured) for (let i = c.start; i < Math.min(text.length, c.start + c.length); i++) fgs[i] = c.fg
  const spans: Span[] = []
  for (let i = 0; i < text.length; i++) {
    const last = spans.at(-1)
    if (last && last.fg === fgs[i]) last.text += text[i]
    else spans.push({ text: text[i]!, fg: fgs[i]! })
  }
  return spans
}

/** A y-axis, the plot rows, the x-axis line (with `baseline`), then the x
 * labels. `inks` maps each run's ink to a colour. With `revealMs`, each
 * new `revealKey` draws the chart in over that long (reveal says how);
 * new data under the same key just shows (motion says when to ask). */
export function ChartBody(props: { model: ChartModel; inks: Record<string, string>; baseline?: boolean; revealKey?: string; revealMs?: number; labels?: ChartLabelMode }) {
  const axis = () => axisWidth(props.model.ticks)
  const shown = useReveal(() => props.revealKey, () => props.revealMs ?? 0)
  // The gridlines a reveal leaves standing, and whether it has bars: found
  // once per model, and only for a draw-in (each looks at every cell).
  const frame = perRows(gridColumns)
  const bars = perRows(hasBars)
  // A row's axis and runs, coloured. The props are read once a row, not
  // once a run: each read is a tracked lookup, and a draw-in redoes every
  // row on each tick.
  const rowSpans = (runs: Run[], i: number): StyledSpan[] => {
    const model = props.model, inks = props.inks, p = shown()
    const own = model.inks
    return [
      { text: (model.ticks.get(i) ?? "").padStart(axis() - 2) + (model.ticks.has(i) ? " ┤" : " │"), fg: ink.label },
      ...(p < 1 ? revealRuns(runs, i, model.rows.length, p, frame(model.rows), bars(model.rows), props.labels) : runs).map((run) => ({ text: run.text, fg: run.ink ? own?.[run.ink] ?? inks[run.ink] ?? ink.figure : undefined })),
    ]
  }
  return (
    <>
      {/* One styled line per row (StyledLine), not a span per run: a year's
          chart is hundreds of runs. Index keeps the rows as models change. */}
      <Index each={props.model.rows}>
        {(runs, i) => (
          <StyledLine spans={rowSpans(runs(), i)} />
        )}
      </Index>
      <Show when={props.baseline && props.model.rows.length}>
        <text wrapMode="none" fg={ink.rule}>{" ".repeat(axis() - 1) + xAxisLine(props.model.rows)}</text>
      </Show>
      <StyledLine spans={axisLabels(" ".repeat(axis()) + props.model.labels, [
        ...(props.model.labelInks ?? []).map((l) => ({ start: l.start + axis(), length: l.length, fg: props.model.inks?.[l.ink] ?? props.inks[l.ink] ?? ink.label })),
        ...(props.model.today ? [{ start: props.model.today.start + axis(), length: props.model.today.length, fg: props.inks.today ?? ink.figure }] : []),
      ])} />
    </>
  )
}

/** `fn` of a chart's rows, worked out again only for new rows. */
function perRows<T>(fn: (rows: Run[][]) => T): (rows: Run[][]) => T {
  let was: Run[][] | undefined
  let value: T
  return (rows) => {
    if (rows !== was) { was = rows; value = fn(rows) }
    return value
  }
}
