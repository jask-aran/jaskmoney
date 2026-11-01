import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ui, type SectionId } from "../../state/uiStore"
import { TabBar } from "./TabBar"

// The pre-change TabBar from HEAD. Compare rendered cells, including clipping.
import { For } from "solid-js"
import { TABS, type TabId } from "../../state/uiStore"
import { theme, ink, tone } from "../../theme"
import { chipLook } from "./chip"

/** Matches Go headerBarStyle + activeTabStyle / inactiveTabStyle; the
 * current tab is an active chip (chipLook). */
function BeforeTabBar(props: { active: TabId; accountLabel?: string; reserveRight?: number }) {
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

for (const width of [140, 100]) {
  for (const tab of TABS) {
    for (const text of ["", "No accounts", "All Accounts", "ANZ CREDIT · 2 web clients · synced 5m ago"]) {
      test(`unfocused bar matches before: ${width}, ${tab.id}, ${text}`, async () => {
        ui.setState({ focusedSection: "none" })
        const reserveRight = tab.id === "overview" ? 12 : 0
        const items: { id?: SectionId; text: string }[] = text.split(" · ").map((part, i) => ({ text: part, ...(i === 1 ? { id: "bar.web" } : i === 2 ? { id: "bar.sync" } : {}) }))
        const before = await testRender(() => <BeforeTabBar active={tab.id} accountLabel={text} reserveRight={reserveRight} />, { width, height: 2 })
        const after = await testRender(() => <TabBar active={tab.id} items={items} reserveRight={reserveRight} />, { width, height: 2 })
        const cells = (t: typeof before) => t.captureSpans().lines[0]!.spans.flatMap((span) => [...span.text].map((char) => [char, span.fg.toInts(), span.bg.toInts(), span.attributes]))
        try {
          await before.renderOnce()
          await after.renderOnce()
          expect(after.captureCharFrame()).toBe(before.captureCharFrame())
          expect(cells(after)).toEqual(cells(before))
          ui.setState({ focusedSection: `bar.${tab.id}` })
          await after.renderOnce()
          ui.setState({ focusedSection: "none" })
          await after.renderOnce()
          expect(cells(after)).toEqual(cells(before))
        } finally { after.renderer.destroy(); before.renderer.destroy() }
      })
    }
  }
}
