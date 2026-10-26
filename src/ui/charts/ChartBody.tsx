import { For } from "solid-js"
import { S } from "../primitives/S"
import { theme } from "../../theme"
import type { Run } from "./lineChart"

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
  /** Summary line under the axis. */
  summary: Array<{ text: string; fg: string }>
}

/** A y-axis, the plot rows, the x labels, then the summary line. `inks`
 * maps each run's ink to a colour. */
export function ChartBody(props: { model: ChartModel; inks: Record<string, string> }) {
  const axis = () => axisWidth(props.model.ticks)
  return (
    <>
      <For each={props.model.rows}>
        {(runs, i) => (
          <text wrapMode="none">
            <S fg={theme.overlay1}>{(props.model.ticks.get(i()) ?? "").padStart(axis() - 2) + (props.model.ticks.has(i()) ? " ┤" : " │")}</S>
            <For each={runs}>{(run) => <S fg={run.ink ? props.inks[run.ink] ?? theme.text : undefined}>{run.text}</S>}</For>
          </text>
        )}
      </For>
      <text wrapMode="none" fg={theme.overlay1}>{" ".repeat(axis()) + props.model.labels}</text>
      <text wrapMode="none">
        <For each={props.model.summary}>{(part) => <S fg={part.fg}>{part.text}</S>}</For>
      </text>
    </>
  )
}
