import { For, Show } from "solid-js"
import { nextGmailStep } from "../../ai/executor"
import { GOOGLE_CLIENT_STEPS, gmailActions, gmailLines } from "../../state/gmailDialog"
import { ui, type UiState } from "../../state/uiStore"
import { theme } from "../../theme"
import { ListRow } from "../primitives/ListRow"
import { Modal } from "../primitives/Modal"

const GMAIL_DIALOG_WIDTH = 92

/** Settings › AI models › Sources › Gmail: how far the setup through
 * jaskmoney's own Executor has got, how to make the Google app when that's
 * next, and the step to take (app/gmailSource). */
export function GmailDialog() {
  return (
    <Show when={ui.state.gmail}>
      {(d: () => NonNullable<UiState["gmail"]>) => {
        const actions = () => gmailActions(d().setup)
        const step = () => (d().setup ? nextGmailStep(d().setup!) : null)
        return (
          <Modal title="Gmail" subtitle="through jaskmoney's own Executor" width={GMAIL_DIALOG_WIDTH}
            hints={d().waiting ? "esc stop waiting" : "j/k move · enter do · esc close"}>
            <For each={gmailLines(d().setup)}>{(line) => (
              <box flexDirection="row">
                <text width={12} flexShrink={0} fg={theme.overlay1}>{line.label}</text>
                <text flexGrow={1} flexShrink={1} wrapMode="word" fg={line.label === "Account" ? theme.text : theme.subtext0}>{line.value}</text>
              </box>
            )}</For>
            <Show when={step() === "client" && !d().waiting}>
              <text> </text>
              <For each={GOOGLE_CLIENT_STEPS}>{(line) => <text fg={theme.overlay1} wrapMode="word">{line}</text>}</For>
            </Show>
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
              <text fg={theme.text} wrapMode="word">Your browser should open Google's sign-in; finish there. Waiting for Executor to have the account…</text>
              <text fg={theme.overlay1} wrapMode="char">{d().waiting}</text>
            </Show>
            <Show when={d().note}>
              {(n: () => NonNullable<NonNullable<UiState["gmail"]>["note"]>) => (
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
