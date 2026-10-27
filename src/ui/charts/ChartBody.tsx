import { RGBA, StyledText, type TextChunk, type TextRenderable } from "@opentui/core"
import { Index, Show, createEffect } from "solid-js"
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

/** A chart row as styled text: the axis label (muted), then each run in
 * its ink's colour (no colour: the text's default). */
function rowText(axis: string, runs: Run[], inks: Record<string, string>): StyledText {
  return new StyledText([
    { __isChunk: true, text: axis, fg: rgba(theme.overlay1) },
    ...runs.map((run): TextChunk => ({ __isChunk: true, text: run.text, ...(run.ink ? { fg: rgba(inks[run.ink] ?? theme.text) } : {}) })),
  ])
}

const colours = new Map<string, RGBA>()
/** A colour parsed once. */
function rgba(hex: string): RGBA {
  let colour = colours.get(hex)
  if (!colour) colours.set(hex, colour = RGBA.fromHex(hex))
  return colour
}

/** A y-axis, the plot rows, the x-axis line (with `baseline`), then the x
 * labels. `inks` maps each run's ink to a colour. */
export function ChartBody(props: { model: ChartModel; inks: Record<string, string>; baseline?: boolean }) {
  const axis = () => axisWidth(props.model.ticks)
  return (
    <>
      {/* One styled line per row (StyledText chunks), not a span per run:
          a year's chart is hundreds of runs, each span a node with effects.
          Index keeps the row elements as models change. */}
      <Index each={props.model.rows}>
        {(runs, i) => (
          // Set on the node: Solid's `content` prop would stringify a StyledText.
          <text wrapMode="none" ref={(node: TextRenderable) => createEffect(() => {
            node.content = rowText(
              (props.model.ticks.get(i) ?? "").padStart(axis() - 2) + (props.model.ticks.has(i) ? " ┤" : " │"),
              runs(),
              props.inks,
            )
          })} />
        )}
      </Index>
      <Show when={props.baseline && props.model.rows.length}>
        <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(axis() - 1) + xAxisLine(props.model.rows)}</text>
      </Show>
      <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(axis()) + props.model.labels}</text>
    </>
  )
}
