import { For } from "solid-js"
import { TABS, type TabId } from "../../state/uiStore"
import { theme, ink, tone } from "../../theme"
import { chipLook } from "./chip"

/** Matches Go headerBarStyle + activeTabStyle / inactiveTabStyle; the
 * current tab is an active chip (chipLook). */
export function TabBar(props: { active: TabId; accountLabel?: string; reserveRight?: number }) {
  return (
    <box
      width="100%"
      height={1}
      flexDirection="row"
      backgroundColor={theme.mantle}
      paddingLeft={2}
      paddingRight={2 + (props.reserveRight ?? 0)}
      justifyContent="space-between"
    >
      <box flexDirection="row" gap={0} backgroundColor={theme.mantle}>
        <text fg={tone.key} bg={theme.mantle}>
          <b>Jaskmoney</b>
        </text>
        <text fg={ink.rule} bg={theme.mantle}>
          {"  "}
        </text>
        <For each={TABS}>
          {(tab, i) => {
            const look = () => chipLook({ active: props.active === tab.id, cursor: false })
            return (
              <box flexDirection="row" gap={0} backgroundColor={theme.mantle}>
                {i() > 0 ? (
                  <text fg={ink.rule} bg={theme.mantle}>
                    │
                  </text>
                ) : null}
                <text fg={look().fg} bg={look().bg ?? theme.mantle}>
                  {look().bold ? <b>{` ${tab.label} `}</b> : ` ${tab.label} `}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={ink.note} bg={theme.mantle}>
        {props.accountLabel ?? "All Accounts"}
      </text>
    </box>
  )
}
