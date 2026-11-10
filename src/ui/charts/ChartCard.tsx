import { Show, type JSX } from "solid-js"
import { ink, tone } from "../../theme"
import { viewMark } from "../icons"
import type { Span } from "../primitives/spans"
import { SectionCard } from "../primitives/SectionCard"
import { ChartBody, type ChartModel } from "./ChartBody"
import { INKS } from "../overview/periodCharts"
import type { ChartLabelMode } from "./motion"

export type ChartViews = ReadonlyArray<{ view: string; title: string; group: string }>

export function viewPicker(views: ChartViews, current: number): Span[] {
  return views.flatMap((v, i) => [
    ...(i > 0 ? [{ text: views[i - 1]!.group !== v.group ? "  " : " ", fg: ink.note }] : []),
    { text: viewMark(v.view, i === current), fg: i === current ? tone.key : ink.faint, bold: i === current },
  ])
}

export interface ChartCardProps {
  model: ChartModel | null
  width: number
  height: number
  focused?: boolean
  baseline?: boolean
  revealKey?: string
  revealMs?: number
  curve?: string
  labels?: ChartLabelMode
}

export function ChartCard(props: ChartCardProps & {
  scope?: string
  views: ChartViews
  current: number
  legend?: Span[]
  fallback?: JSX.Element
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
