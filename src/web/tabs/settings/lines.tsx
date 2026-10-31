/**
 * Settings' two pieces, kept plain so the shared settings pieces (a group
 * and its lines) can replace them one for one: a Group is a section label
 * and its lines, no box; a Line is one row of a lead mark, a label (it
 * truncates last), muted meta, a quiet value and a control in its own
 * column. A line that does something on a press is a button.
 */
import { Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"

export function Group(props: { title: string; lead?: JSX.Element; count?: JSX.Element; aside?: JSX.Element; note?: JSX.Element; class?: string; children: JSX.Element }) {
  return (
    <section class={`st-group ${props.class ?? ""}`}>
      <header class="st-group-head">
        {props.lead}
        <h2>{props.title}</h2>
        <Show when={props.count != null}><span class="st-count">{props.count}</span></Show>
        <Show when={props.aside}><span class="st-aside">{props.aside}</span></Show>
      </header>
      {props.children}
      <Show when={props.note}><p class="st-group-note">{props.note}</p></Show>
    </section>
  )
}

export function Line(props: {
  label: JSX.Element
  lead?: JSX.Element
  meta?: JSX.Element
  value?: JSX.Element
  control?: JSX.Element
  title?: string
  /** Drawn under the line above it (a category in its group). */
  indent?: boolean
  /** A group's own line, or a heading-like line. */
  strong?: boolean
  /** What's switched off. */
  muted?: boolean
  /** The label names a field (Token, Sync), not a thing. */
  field?: boolean
  /** The meta and value go under the label: always, or on a phone. */
  stack?: boolean
  wrap?: boolean
  arm?: string
  onClick?: () => void
}) {
  return (
    <Dynamic component={props.onClick ? "button" : "div"} type={props.onClick ? "button" : undefined} class="st-line"
      classList={{ indent: !!props.indent, strong: !!props.strong, muted: !!props.muted, field: !!props.field, stack: !!props.stack, wrap: !!props.wrap, press: !!props.onClick }}
      title={props.title} data-arm={props.arm} onClick={props.onClick}>
      <Show when={props.lead}><span class="st-lead">{props.lead}</span></Show>
      <span class="st-label">{props.label}</span>
      <Show when={props.meta}><span class="st-meta">{props.meta}</span></Show>
      <Show when={props.value}><span class="st-value">{props.value}</span></Show>
      <Show when={props.control}><span class="st-control">{props.control}</span></Show>
    </Dynamic>
  )
}

/** On or off. */
export function Switch(props: { on: boolean; label: string; arm?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={props.on} aria-label={props.label} title={props.label} data-arm={props.arm}
      class="st-switch" classList={{ on: props.on, danger: !!props.danger }} disabled={props.disabled} onClick={props.onClick} />
  )
}
