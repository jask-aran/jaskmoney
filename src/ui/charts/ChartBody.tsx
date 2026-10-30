import { Index, Show } from "solid-js"
import { StyledLine } from "../primitives/StyledLine"
import { ink } from "../../theme"
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
    for (const run of runs) for (const ch of run.text) { if (ch === "│") gridlines.add(col); col++ }
  }
  const width = rows[0]?.reduce((n, run) => n + [...run.text].length, 0) ?? 0
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
            { text: (props.model.ticks.get(i) ?? "").padStart(axis() - 2) + (props.model.ticks.has(i) ? " ┤" : " │"), fg: ink.label },
            ...runs().map((run) => ({ text: run.text, fg: run.ink ? props.model.inks?.[run.ink] ?? props.inks[run.ink] ?? ink.figure : undefined })),
          ]} />
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
