import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui, type UiState } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { USE_INFO, aiContext, useActions, useModel } from "../../state/aiDialog"
import { sentLines } from "../../state/sentView"
import type { HelpTone } from "../../state/searchHelp"
import { theme } from "../../theme"
import { Modal } from "../primitives/Modal"
import { ListRow } from "../primitives/ListRow"
import { S } from "../primitives/S"
import { fit } from "../text"

const WIDTH = 78
const TONE: Record<HelpTone, string> = { head: theme.text, key: theme.accent, text: theme.subtext0, muted: theme.overlay1 }

/** A use's dialog: the model doing it, what it does, what it can use; then
 * choosing the model, connecting one it needs, and what's sent. */
export function AiUseDialog() {
  return (
    <Show when={ui.state.aiUse}>
      {(d: () => NonNullable<UiState["aiUse"]>) => {
        const ctx = () => aiContext(data)
        const info = () => USE_INFO[d().use]
        const model = () => useModel(d().use, ctx())
        const actions = () => useActions(d().use, ctx())
        // The label in a column; the value wraps beside it.
        const line = (label: string, value: string, fg: string = theme.text) => (
          <box flexDirection="row">
            <text width={10} flexShrink={0} fg={theme.overlay1}>{label}</text>
            <text flexGrow={1} flexShrink={1} wrapMode="word" fg={fg}>{value}</text>
          </box>
        )
        return (
          <Modal title={info().name} subtitle="AI use" width={WIDTH} hints="j/k move · enter do · esc close">
            {line("Model", model().text, model().ready ? theme.teal : theme.warning)}
            {line("Does", info().does)}
            {line("Can use", info().available)}
            <text> </text>
            <For each={actions()}>{(action, i) => {
              const here = () => i() === Math.min(d().cursor, actions().length - 1)
              return <ListRow cursor={here()} bg={theme.mantle} spans={[{ text: fit(action.label, WIDTH - 6), fg: here() ? theme.text : theme.subtext0 }]} />
            }}</For>
            <Show when={d().note}>
              {(n: () => NonNullable<NonNullable<UiState["aiUse"]>["note"]>) => (
                <>
                  <text> </text>
                  <text fg={n().ok === false ? theme.error : theme.success} wrapMode="word">{n().text}</text>
                </>
              )}
            </Show>
          </Modal>
        )
      }}
    </Show>
  )
}

/** Exactly what a use sends: each request, when it's sent and where, and
 * its body as an outline; scrolls. Built without sending anything. */
export function AiSentViewer() {
  const dims = useTerminalDimensions()
  const width = createMemo(() => Math.max(40, Math.min(110, dims().width - 4)))
  const lines = createMemo(() => {
    const view = ui.state.aiSent
    return view?.parts ? sentLines(view.parts, width() - 4) : []
  })
  // The border and hint lines, and a line of air above and below.
  const visible = createMemo(() => Math.max(5, dims().height - 8))
  createEffect(() => {
    const view = ui.state.aiSent
    if (view && (view.visible !== visible() || view.lines !== lines().length)) ui.setState("aiSent", { visible: visible(), lines: lines().length })
  })
  const top = () => Math.max(0, Math.min(ui.state.aiSent?.top ?? 0, lines().length - visible()))
  const hints = () => lines().length > visible() ? `j/k scroll · ${top() + 1}–${Math.min(lines().length, top() + visible())} of ${lines().length} · esc back` : "esc back"
  return (
    <Show when={ui.state.aiSent}>
      {(view: () => NonNullable<UiState["aiSent"]>) => (
        <Modal title={`What ${USE_INFO[view().use].name} sends`} subtitle="built for your newest row; nothing was sent" width={width()} hints={hints()}>
          <Show when={view().parts} fallback={<text fg={view().error ? theme.error : theme.overlay1}>{view().error ?? "Building it…"}</text>}>
            <For each={lines().slice(top(), top() + visible())}>
              {(line) => (
                <text wrapMode="none">
                  {line.length ? <For each={line}>{(part) => <S fg={TONE[part.tone]} bold={part.tone === "head"}>{part.text}</S>}</For> : " "}
                </text>
              )}
            </For>
          </Show>
        </Modal>
      )}
    </Show>
  )
}
