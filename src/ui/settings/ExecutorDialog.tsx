import { Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { executorActions, executorLines } from "../../state/executorDialog"
import { EMAIL_USES } from "../../state/integrationUses"
import { ui, type UiState } from "../../state/uiStore"
import { theme, ink } from "../../theme"
import { CardColumn, CardSides, actionLine, blank, labelled, noteLines, usesLines, wrapped, type CardLine } from "../primitives/cardLines"
import { Modal } from "../primitives/Modal"

export function ExecutorDialog() {
  const dims = useTerminalDimensions()
  const width = () => Math.max(40, Math.min(dims().width - 4, 120))
  const beside = () => width() >= 100
  const left = () => (beside() ? Math.floor((width() - 4) * 0.5) : width() - 4)
  const right = () => (beside() ? width() - 4 - left() - 3 : 0)
  return (
    <Show when={ui.state.executor}>
      {(d: () => NonNullable<UiState["executor"]>) => {
        const actions = () => executorActions(d().status)
        const lines = (): CardLine[] => [
          ...executorLines(d().status).flatMap((line) => labelled(line.label, line.value, left(), line.label === "Account" ? ink.figure : ink.note)),
          blank,
          ...(d().waiting
            ? [...wrapped("Your browser should open Executor's sign-in; finish there (or make an account). If it didn't open:", left(), ink.note), ...wrapped(d().waiting!, left(), ink.figure)]
            : d().busy ? wrapped(d().busy!, left(), ink.note)
            : actions().map((action, i) => actionLine({ at: i === Math.min(d().cursor, actions().length - 1), label: action.label, bg: theme.rowCursor }))),
          ...(d().note ? [blank, ...noteLines(d().note!, left())] : []),
        ]
        return (
          <Modal title="Executor" subtitle="your accounts, Gmail first" width={width()}
            hints={d().waiting ? "esc cancel" : "j/k move · enter do · esc close"}>
            <CardSides beside={beside()} leftWidth={left()} rightWidth={right()} panel={beside() ? usesLines(EMAIL_USES, right() - 3) : []} bg={theme.mantle}>
              <CardColumn lines={lines()} width={left()} bg={theme.mantle} />
            </CardSides>
          </Modal>
        )
      }}
    </Show>
  )
}
