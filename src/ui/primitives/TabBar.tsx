import { regionRef } from "../regions"
import { onPointer } from "../../app/pointer"
import { openBarItem } from "../../app/keys"
import { data } from "../../state/dataStore"
import { For } from "solid-js"
import { TABS, ui, type ScopeId, type SectionId, type TabId } from "../../state/uiStore"
import { theme, ink, tone } from "../../theme"
import { chipLook } from "./chip"
import { S } from "./S"

/** Matches Go headerBarStyle + activeTabStyle / inactiveTabStyle; the
 * current tab is an active chip (chipLook). */
export function TabBar(props: { active: TabId; items?: { id?: SectionId; text: string }[]; reserveRight?: number }) {
  const items = () => (props.items ?? [{ text: "All Accounts" }]).filter((item) => item.text)
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
            const look = () => chipLook({ active: props.active === tab.id, cursor: ui.state.focusedSection === `bar.${tab.id}` })
            return (
              <box flexDirection="row" gap={0} backgroundColor={theme.mantle}>
                {i() > 0 ? (
                  <text fg={ink.rule} bg={theme.mantle}>
                    │
                  </text>
                ) : null}
                {/* Bold by S, not a <b> swapped for plain text: the label stays one node. */}
                <text ref={regionRef(`bar.${tab.id}`, "bar")} onMouseDown={onPointer(pageScope, () => ui.switchTab(tab.id))} fg={look().fg} bg={look().bg ?? theme.mantle}>
                  <S fg={look().fg} bg={look().bg ?? theme.mantle} bold={look().bold}>{` ${tab.label} `}</S>
                </text>
              </box>
            )
          }}
        </For>
      </box>
      {/* One text per item so each can take focus and clicks. Only the last
          shrinks, wrapping by word out of sight, so a narrow bar drops whole
          words at its end as the single label it replaced did. */}
      <box flexDirection="row" flexShrink={1} overflow="hidden" backgroundColor={theme.mantle}>
        <For each={items()}>
          {(item, i) => {
            const last = () => i() === items().length - 1
            const cursor = () => item.id != null && ui.state.focusedSection === item.id
            const look = () => chipLook({ active: false, cursor: cursor() })
            return <>
              {i() > 0 ? <text flexShrink={0} fg={ink.note} bg={theme.mantle}>{" · "}</text> : null}
              <text flexShrink={last() ? 1 : 0} ref={item.id ? regionRef(item.id, "bar") : undefined}
                onMouseDown={item.id ? onPointer(pageScope, () => openBarItem(ui, data, item.id ?? "")) : undefined}
                fg={cursor() ? look().fg : ink.note} bg={look().bg ?? theme.mantle}>
                {look().bold ? <b>{item.text}</b> : item.text}
              </text>
            </>
          }}
        </For>
      </box>
    </box>
  )
}

/** Only page scopes and the bar accept clicks through the shared chrome. */
function pageScope(scope: ScopeId): boolean {
  return ["bar", "overview", "overview.range", "manager.accounts", "manager.txns", "manager.merchants", "budgets", "budgets.categories", "settings", "settings.taxonomy", "settings.rules", "settings.filters", "settings.appearance", "settings.database", "settings.up", "settings.ai"].includes(scope)
}
