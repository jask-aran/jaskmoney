import { ErrorBoundary, Show, createEffect, createMemo, createSignal, on } from "solid-js"
import type { JSX } from "@opentui/solid"
import { TABS, TAB_DEFAULT_FOCUS, ui, type SectionId, type TabId } from "../state/uiStore"
import { ink, tone } from "../theme"

const [warmed, setWarmed] = createSignal<ReadonlySet<TabId>>(new Set())

export function warmTabs(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const next = () => {
    const tab = TABS.map((t) => t.id).find((id) => id !== ui.state.activeTab && !warmed().has(id))
    if (!tab) return
    setWarmed(new Set([...warmed(), tab]))
    timer = setTimeout(next, 60)
  }
  timer = setTimeout(next, 250)
  return () => clearTimeout(timer)
}

export function KeptTab(props: { id: TabId; children: (focused: () => SectionId) => JSX.Element }) {
  const active = () => ui.state.activeTab === props.id
  const [visited, setVisited] = createSignal(active())
  createEffect(() => { if (active() || warmed().has(props.id)) setVisited(true) })
  const focused = createMemo<SectionId>((was) => (active() ? ui.state.focusedSection : was), active() ? ui.state.focusedSection : TAB_DEFAULT_FOCUS[props.id])
  return (
    <Show when={visited()}>
      <box visible={active()} flexGrow={1} width="100%" flexDirection="column">
        <ErrorBoundary fallback={(error: unknown, reset: () => void) => <TabError error={error} reset={reset} />}>
          {props.children(focused)}
        </ErrorBoundary>
      </box>
    </Show>
  )
}

function TabError(props: { error: unknown; reset: () => void }) {
  createEffect(on(() => ui.state.activeTab, () => props.reset(), { defer: true }))
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <box border borderStyle="rounded" borderColor={tone.bad} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={tone.bad}>
        <b>This tab failed to render</b>
      </text>
      <text fg={ink.figure}>{message()}</text>
      <text fg={ink.note}>Switch tabs to retry · ctrl+c quits</text>
    </box>
  )
}
