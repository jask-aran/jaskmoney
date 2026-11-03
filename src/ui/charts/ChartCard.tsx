import { Show, type JSX } from "solid-js"
import { ink, tone } from "../../theme"
import { viewMark } from "../icons"
import type { Span } from "../primitives/spans"
import { SectionCard } from "../primitives/SectionCard"
import { ChartBody, type ChartModel } from "./ChartBody"
import { INKS } from "../overview/periodCharts"
import type { ChartLabelMode } from "./motion"

/** A chart pane's views, in h/l order: each one's name, its title (what the
 * chart shows, the pane's title) and the group it belongs to (spacing in
 * the picker only). */
export type ChartViews = ReadonlyArray<{ view: string; title: string; group: string }>

/** The views in h/l order as icons (dots when icons are off), the current
 * one bright; a space between groups. */
export function viewPicker(views: ChartViews, current: number): Span[] {
  return views.flatMap((v, i) => [
    ...(i > 0 ? [{ text: views[i - 1]!.group !== v.group ? "  " : " ", fg: ink.note }] : []),
    { text: viewMark(v.view, i === current), fg: i === current ? tone.key : ink.faint, bold: i === current },
  ])
}

/**
 * A chart pane, as the Overview's and the Budgets tab's both are: titled
 * by what its view shows, then whose (`scope`) when the pane covers less
 * than the tab does (a budget); the views as icons in the top border, the
 * chart's legend in the bottom one. Without a `model` (a view that isn't
 * a chart: the calendar), `fallback` and its `legend` show.
 */
export function ChartCard(props: {
  scope?: string
  views: ChartViews
  current: number
  model: ChartModel | null
  legend?: Span[]
  fallback?: JSX.Element
  width: number
  height: number
  focused?: boolean
  baseline?: boolean
  /** Draw the chart in over `revealMs` each time `revealKey` changes (ChartBody). */
  revealKey?: string
  revealMs?: number
  /** The draw-in's curve (CHART_CURVES). */
  curve?: string
  /** When its labels appear as it draws in (motion). */
  labels?: ChartLabelMode
}) {
  const view = () => props.views[props.current] ?? props.views[0]!
  return (
    <SectionCard
      title={view().title}
      titleSuffix={props.scope ? `· ${props.scope}` : undefined}
      titleSuffixColor={ink.label}
      titleRight={viewPicker(props.views, props.current)}
      bottomSpans={props.model?.legend ?? props.legend}
      width={props.width}
      height={props.height}
      focused={props.focused}
    >
      <Show when={props.model} fallback={props.fallback}>
        {(m: () => ChartModel) => <ChartBody model={m()} inks={INKS} baseline={props.baseline} revealKey={props.revealKey} revealMs={props.revealMs} curve={props.curve} labels={props.labels} />}
      </Show>
    </SectionCard>
  )
}
