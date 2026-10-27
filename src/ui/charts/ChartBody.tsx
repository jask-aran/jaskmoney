import { Index, Show } from "solid-js"
import { StyledLine } from "../primitives/StyledLine"
import { theme } from "../../theme"
import type { Run } from "./lineChart"
import type { Span } from "../primitives/spans"

/** The y-axis width for `ticks`: the longest label, a space and the tick. */
export function axisWidth(ticks: Map<number, string>): number {
  return Math.max(0, ...[...ticks.values()].map((t) => t.length)) + 2
}

/** A first guess at the axis width, before the ticks are known. */
export const AXIS_GUESS = 6

export interface ChartModel {
  rows: Run[][]
  /** Axis label per row (top first). */
  ticks: Map<number, string>
  /** X-axis label line, aligned with the plot. */
  labels: string
  /** Where in `labels` today's date sits, drawn in today's ink. */
  today?: { start: number; length: number }
  /** The legend: series marks in their colours with names and figures,
   * shown in the pane's bottom border. */
  legend: Span[]
}

/** The x-axis line under the plot: a corner under the y-axis, then a rule
 * with a tick wherever a gridline comes down to it. */
export function xAxisLine(rows: Run[][]): string {
  const gridlines = new Set<number>()
  for (const runs of rows) {
    let col = 0
    for (const run of runs) for (const ch of run.text) { if (ch === "│") gridlines.add(col); col++ }
  }
  const width = rows[0]?.reduce((n, run) => n + [...run.text].length, 0) ?? 0
  return "└" + Array.from({ length: width }, (_, c) => (gridlines.has(c) ? "┴" : "─")).join("")
}

/** The x labels as spans: muted, with today's date in its rule's colour. */
function axisLabels(text: string, today: { start: number; length: number } | undefined, todayFg: string): Span[] {
  if (!today) return [{ text, fg: theme.overlay1 }]
  const end = today.start + today.length
  return [
    { text: text.slice(0, today.start), fg: theme.overlay1 },
    { text: text.slice(today.start, end), fg: todayFg },
    { text: text.slice(end), fg: theme.overlay1 },
  ]
}

/** A y-axis, the plot rows, the x-axis line (with `baseline`), then the x
 * labels. `inks` maps each run's ink to a colour. */
export function ChartBody(props: { model: ChartModel; inks: Record<string, string>; baseline?: boolean }) {
  const axis = () => axisWidth(props.model.ticks)
  return (
    <>
      {/* One styled line per row (StyledLine), not a span per run: a year's
          chart is hundreds of runs. Index keeps the rows as models change. */}
      <Index each={props.model.rows}>
        {(runs, i) => (
          <StyledLine spans={[
            { text: (props.model.ticks.get(i) ?? "").padStart(axis() - 2) + (props.model.ticks.has(i) ? " ┤" : " │"), fg: theme.overlay1 },
            ...runs().map((run) => ({ text: run.text, fg: run.ink ? props.inks[run.ink] ?? theme.text : undefined })),
          ]} />
        )}
      </Index>
      <Show when={props.baseline && props.model.rows.length}>
        <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(axis() - 1) + xAxisLine(props.model.rows)}</text>
      </Show>
      <StyledLine spans={axisLabels(" ".repeat(axis()) + props.model.labels, props.model.today && { ...props.model.today, start: props.model.today.start + axis() }, props.inks.today ?? theme.text)} />
    </>
  )
}
