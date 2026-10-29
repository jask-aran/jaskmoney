import { For, Show } from "solid-js"
import { executorActions, executorLines } from "../../state/executorDialog"
import { ui, type UiState } from "../../state/uiStore"
import { theme } from "../../theme"
import { ListRow } from "../primitives/ListRow"
import { Modal } from "../primitives/Modal"

const EXECUTOR_DIALOG_WIDTH = 92

/** Settings › AI models › Sources › Executor: the sign-in to Executor Cloud,
 * what it reaches, and the step to take (app/executorSource). */
export function ExecutorDialog() {
  return (
    <Show when={ui.state.executor}>
      {(d: () => NonNullable<UiState["executor"]>) => {
        const actions = () => executorActions(d().status)
        return (
          <Modal title="Executor" subtitle="your accounts, Gmail first" width={EXECUTOR_DIALOG_WIDTH}
            hints={d().waiting ? "esc cancel" : "j/k move · enter do · esc close"}>
            <For each={executorLines(d().status)}>{(line) => (
              <box flexDirection="row">
                <text width={12} flexShrink={0} fg={theme.overlay1}>{line.label}</text>
                <text flexGrow={1} flexShrink={1} wrapMode="word" fg={line.label === "Account" ? theme.text : theme.subtext0}>{line.value}</text>
              </box>
            )}</For>
            <text> </text>
            <Show when={d().waiting} fallback={
              <Show when={d().busy} fallback={
                <For each={actions()}>{(action, i) => {
                  const here = () => i() === Math.min(d().cursor, actions().length - 1)
                  return <ListRow cursor={here()} bg={theme.mantle} spans={[{ text: action.label, fg: here() ? theme.text : theme.subtext0 }]} />
                }}</For>
              }>
                <text fg={theme.overlay1}>{d().busy}</text>
              </Show>
            }>
              <text fg={theme.text} wrapMode="word">Your browser should open Executor's sign-in; finish there (or make an account). If it didn't open:</text>
              <text fg={theme.overlay1} wrapMode="char">{d().waiting}</text>
            </Show>
            <Show when={d().note}>
              {(n: () => NonNullable<NonNullable<UiState["executor"]>["note"]>) => (
                <>
                  <text> </text>
                  <text fg={n().ok === true ? theme.success : n().ok === false ? theme.error : theme.overlay1} wrapMode="word">{n().text}</text>
                </>
              )}
            </Show>
          </Modal>
        )
      }}
    </Show>
  )
}
