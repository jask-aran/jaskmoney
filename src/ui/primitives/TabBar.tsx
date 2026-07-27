import { For } from "solid-js"
import { TABS, type TabId } from "../../state/uiStore"
import { theme } from "../../theme"

/** Matches Go headerBarStyle + activeTabStyle / inactiveTabStyle. */
export function TabBar(props: { active: TabId; accountLabel?: string }) {
  return (
    <box
      width="100%"
      height={1}
      flexDirection="row"
      backgroundColor={theme.mantle}
      paddingLeft={2}
      paddingRight={2}
      justifyContent="space-between"
    >
      <box flexDirection="row" gap={0} backgroundColor={theme.mantle}>
        <text fg={theme.brand} bg={theme.mantle}>
          <b>Jaskmoney</b>
        </text>
        <text fg={theme.overlay0} bg={theme.mantle}>
          {"  "}
        </text>
        <For each={TABS}>
          {(tab, i) => {
            const on = () => props.active === tab.id
            return (
              <box flexDirection="row" gap={0} backgroundColor={theme.mantle}>
                {i() > 0 ? (
                  <text fg={theme.overlay0} bg={theme.mantle}>
                    │
                  </text>
                ) : null}
                <text
                  fg={on() ? theme.accent : theme.overlay1}
                  bg={on() ? theme.surface0 : theme.mantle}
                >
                  {on() ? (
                    <b>{` ${tab.label} `}</b>
                  ) : (
                    ` ${tab.label} `
                  )}
                </text>
              </box>
            )
          }}
        </For>
      </box>
      <text fg={theme.overlay1} bg={theme.mantle}>
        {props.accountLabel ?? "All Accounts"}
      </text>
    </box>
  )
}
