import { Match, Switch, onMount } from "solid-js"
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
      const summary = data.bootstrapAnzIfEmpty()
      const clock = dataClock(data.state.transactions)
      const tf = applyChip(
        { ...ui.state.timeframe, family: "period", period: "month" },
        LOOKBACKS.length,
        clock,
      )
      ui.setTimeframe(tf)
      ui.setDashChipCursor(activeChipIndex(tf))

      if (summary) {
        ui.setStatus(summary)
      } else if (data.state.transactions.length > 0) {
        ui.setStatus(`${data.state.transactions.length} transactions loaded.`)
      } else {
        ui.setStatus("OpenTUI · no data (place ANZ.csv at repo root)")
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
    if (
      key.name === "i" &&
      !key.ctrl &&
      !ui.state.jumpMode &&
      !ui.state.filterMode &&
      !ui.state.catPickerOpen &&
      !ui.state.tagPickerOpen
    ) {
      try {
        const path = data.findDefaultAnzPath()
        if (!path) {
          ui.setStatus("ANZ.csv not found", true)
          return
        }
        ui.setStatus(data.ingestFile(path))
      } catch (e) {
        ui.setStatus(`Ingest failed: ${e instanceof Error ? e.message : String(e)}`, true)
      }
      return
    }
    handleKey(ui, key, data)
  })

  const accountLabel = () => {
    const accts = data.state.accounts
    if (accts.length === 0) return "No accounts"
    const on = accts.filter((a) => data.state.accountScope[a.id] !== false)
    if (on.length === accts.length) return "All Accounts"
    if (on.length === 0) return "No accounts selected"
    return on.map((a) => a.name).join(", ")
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.base}>
      <TabBar active={ui.state.activeTab} accountLabel={accountLabel()} />
      <box height={1} width="100%" backgroundColor={theme.base} />
      <box flexGrow={1} width="100%" flexDirection="column" backgroundColor={theme.base}>
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
      </box>
      <StatusBar text={ui.state.status} isErr={ui.state.statusErr} />
      <Footer hints={footerHints(ui.activeScope())} />
      <JumpOverlay active={ui.state.jumpMode} tab={ui.state.activeTab} />
      <CatPicker />
      <TagPicker />
    </box>
  )
}
