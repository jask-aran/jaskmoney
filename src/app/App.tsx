import { ErrorBoundary, Match, Switch, createEffect, on, onMount } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { footerHints, handleKey } from "./keys"
import { TabBar } from "../ui/primitives/TabBar"
import { StatusBar } from "../ui/primitives/StatusBar"
import { Footer } from "../ui/primitives/Footer"
import { JumpOverlay } from "../ui/primitives/JumpOverlay"
import { CatPicker } from "../ui/primitives/CatPicker"
import { TagPicker } from "../ui/primitives/TagPicker"
import { DashboardTab } from "../ui/dashboard/DashboardTab"
import { ManagerTab } from "../ui/manager/ManagerTab"
import { SettingsTab } from "../ui/settings/SettingsTab"
import { theme } from "../theme"
import { selectionLabel } from "../domain/accountTree"
import {
  LOOKBACKS,
  activeChipIndex,
  applyChip,
  dataClock,
} from "../domain/timeframe"

export function App() {
  const renderer = useRenderer()

  onMount(() => {
    try {
      const path = process.env.JASKMONEY_DB
      data.init(path)
      if (process.env.JASKMONEY_NO_BOOTSTRAP === "1") {
        ui.setStatus("OpenTUI shell · bootstrap off")
        return
      }
      const clock = dataClock(data.state.transactions)
      const tf = applyChip(
        { ...ui.state.timeframe, family: "period", period: "month" },
        LOOKBACKS.length,
        clock,
      )
      ui.setTimeframe(tf)
      ui.setDashChipCursor(activeChipIndex(tf))

      if (data.state.transactions.length > 0) {
        ui.setStatus(`${data.state.transactions.length} transactions loaded.`)
      } else {
        ui.setStatus("No transactions yet · Settings → Database & Import → i to import")
      }
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    }
  })

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    handleKey(ui, key, data)
  })

  // The Manager's account selection; the other tabs are not account-scoped.
  const accountLabel = () => {
    if (data.state.accounts.length === 0) return "No accounts"
    return ui.state.activeTab === "manager" ? selectionLabel(data.state.accounts, data.state.accountSelection) : ""
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <TabBar active={ui.state.activeTab} accountLabel={accountLabel()} />
      <box height={1} width="100%" backgroundColor={theme.canvas} />
      <box flexGrow={1} width="100%" flexDirection="column" backgroundColor={theme.canvas}>
        {/* A rendering error stays inside the tab: the rest of the app (tab
            switching, quit) keeps working. Switching tabs retries. */}
        <ErrorBoundary fallback={(error: unknown, reset: () => void) => <TabError error={error} reset={reset} />}>
        <Switch>
          <Match when={ui.state.activeTab === "dashboard"}>
            <DashboardTab focused={ui.state.focusedSection} />
          </Match>
          <Match when={ui.state.activeTab === "manager"}>
            <ManagerTab focused={ui.state.focusedSection} />
          </Match>
          <Match when={ui.state.activeTab === "settings"}>
            <SettingsTab focused={ui.state.focusedSection} />
          </Match>
        </Switch>
        </ErrorBoundary>
      </box>
      {/* Jump mode borrows the status line while active; the stored status
          returns unchanged when it closes. */}
      <StatusBar
        text={ui.state.jumpMode ? "Jump mode · press target letter" : ui.state.status}
        isErr={!ui.state.jumpMode && ui.state.statusErr}
      />
      <Footer hints={footerHints(ui.activeScope())} />
      <JumpOverlay active={ui.state.jumpMode} tab={ui.state.activeTab} />
      <CatPicker />
      <TagPicker />
    </box>
  )
}

function TabError(props: { error: unknown; reset: () => void }) {
  // Retry when the user switches tab.
  createEffect(on(() => ui.state.activeTab, () => props.reset(), { defer: true }))
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <box border borderStyle="rounded" borderColor={theme.error} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={theme.error}>
        <b>This tab failed to render</b>
      </text>
      <text fg={theme.text}>{message()}</text>
      <text fg={theme.overlay1}>Switch tabs to retry · ctrl+c quits</text>
    </box>
  )
}
