import { For, Show } from "solid-js"
import { JUMP_TARGETS, type TabId } from "../../state/uiStore"
import { theme } from "../../theme"

export function JumpOverlay(props: { active: boolean; tab: TabId }) {
  return (
    <Show when={props.active}>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
      >
        <box
          border
          borderStyle="rounded"
          borderColor={theme.accent}
          backgroundColor={theme.mantle}
          padding={1}
          minWidth={36}
          flexDirection="column"
          gap={0}
        >
          <text fg={theme.accent}>
            <b>Jump</b>
          </text>
          <text fg={theme.overlay1}>press letter · esc cancel</text>
          <For each={JUMP_TARGETS[props.tab]}>
            {(t) => (
              <box flexDirection="row" gap={2}>
                <text fg={theme.accent}>
                  <b>{t.key}</b>
                </text>
                <text fg={theme.text}>{t.label}</text>
              </box>
            )}
          </For>
        </box>
      </box>
    </Show>
  )
}
