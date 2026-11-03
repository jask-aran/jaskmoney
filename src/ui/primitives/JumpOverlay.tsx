import { For, Show } from "solid-js"
import { jumpTargets, ui, type TabId } from "../../state/uiStore"
import { theme, ink, tone } from "../../theme"
import { Modal } from "./Modal"
import { S } from "./S"

/** Jump mode: the tab's targets, each behind its key as a badge (Go app). */
export function JumpOverlay(props: { active: boolean; tab: TabId }) {
  return (
    <Show when={props.active}>
      <Modal title="Jump" width={40} hints="press a key to focus · esc cancel">
        <For each={jumpTargets({ activeTab: props.tab, overviewCharts: ui.state.overviewCharts, budgetCyclePanes: ui.state.budgetCyclePanes })}>
          {(t) => (
            <text wrapMode="none">
              <S fg={theme.rowCursorText} bg={tone.key} bold>{`[${t.key}]`}</S>
              <S fg={ink.figure}>{` ${t.label}`}</S>
            </text>
          )}
        </For>
      </Modal>
    </Show>
  )
}
