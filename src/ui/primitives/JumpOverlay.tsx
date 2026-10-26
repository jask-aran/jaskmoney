import { For, Show } from "solid-js"
import { JUMP_TARGETS, type TabId } from "../../state/uiStore"
import { theme } from "../../theme"
import { Modal } from "./Modal"
import { S } from "./S"

/** Jump mode: the tab's targets, each behind its key as a badge (Go app). */
export function JumpOverlay(props: { active: boolean; tab: TabId }) {
  return (
    <Show when={props.active}>
      <Modal title="Jump" width={40} hints="press a key to focus · esc cancel">
        <For each={JUMP_TARGETS[props.tab]}>
          {(t) => (
            <text wrapMode="none">
              <S fg={theme.base} bg={theme.accent} bold>{`[${t.key}]`}</S>
              <S fg={theme.text}>{` ${t.label}`}</S>
            </text>
          )}
        </For>
      </Modal>
    </Show>
  )
}
