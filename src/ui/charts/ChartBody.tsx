import { Index, Show } from "solid-js"
import { gridColumns, hasBars, revealRuns } from "./reveal"
import { useReveal } from "./motion"
import type { ChartLabelMode } from "./motion"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { ink } from "../../theme"
import type { Run } from "./lineChart"
import { textCells } from "./runs"
import type { Span } from "../primitives/spans"

const AXIS_LABEL = 5

export function axisWidth(ticks: Map<number, string>): number {
  return Math.max(AXIS_LABEL, ...[...ticks.values()].map((t) => t.length)) + 2
}

export const CHART_RIGHT_PAD = 1

export const AXIS_GUESS = AXIS_LABEL + 2

export interface ChartModel {
  rows: Run[][]
  ticks: Map<number, string>
  labels: string
  today?: { start: number; length: number }
  labelInks?: Array<{ start: number; length: number; ink: string }>
  legend: Span[]
  inks?: Record<string, string>
}

function xAxisLine(rows: Run[][]): string {
  const gridlines = new Set<number>()
  for (const runs of rows) {
    let col = 0
    for (const run of runs) for (const ch of textCells(run.text)) { if (ch === "│") gridlines.add(col); col++ }
  }
  const width = rows[0]?.reduce((n, run) => n + textCells(run.text).length, 0) ?? 0
  return "└" + Array.from({ length: width }, (_, c) => (gridlines.has(c) ? "┴" : "─")).join("")
}

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

export function ChartBody(props: { model: ChartModel; inks: Record<string, string>; baseline?: boolean; revealKey?: string; revealMs?: number; curve?: string; labels?: ChartLabelMode }) {
  const axis = () => axisWidth(props.model.ticks)
  const shown = useReveal(() => props.revealKey, () => props.revealMs ?? 0, () => props.curve)
  const frame = perRows(gridColumns)
  const bars = perRows(hasBars)
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

function perRows<T>(fn: (rows: Run[][]) => T): (rows: Run[][]) => T {
  let was: Run[][] | undefined
  let value: T
  return (rows) => {
    if (rows !== was) { was = rows; value = fn(rows) }
    return value
  }
}
