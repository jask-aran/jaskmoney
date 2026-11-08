import type { SetStoreFunction } from "solid-js/store"
import type { UiState } from "./uiStore"
import type { TabId, SectionId } from "./uiStore"
import { budgetsHome, TAB_DEFAULT_FOCUS, TABS } from "./uiTables"
import { ALL_CLOSED } from "./uiDialogs"

export function createFocusActions(state: UiState, setState: SetStoreFunction<UiState>, setStatus: (text: string, isErr?: boolean) => number) {
  function switchTab(tab: TabId) {
    setState({
      ...ALL_CLOSED,
      activeTab: tab,
      drillReturn: null,
      focusedSection: tab === "budgets" ? budgetsHome(state) : TAB_DEFAULT_FOCUS[tab],
      ...(tab === "budgets" && state.budgetsEmpty ? { budgetCategoryCursor: 0 } : {}),
      range: null,
      settingsActive: false,
      armed: null,
    })
  }

  function cycleTab(delta: number) {
    const ids = TABS.map((t) => t.id)
    const i = ids.indexOf(state.activeTab)
    switchTab(ids[(i + delta + ids.length) % ids.length]!)
  }

  function enterJump() {
    if (state.jump) {
      cancelJump()
      return
    }
    setState({
      jump: { previousFocus: state.focusedSection },
      filterBar: null,
      catPicker: null,
      tagPicker: null,
    })
  }

  function cancelJump() {
    setState({
      jump: null,
      focusedSection: (state.jump?.previousFocus ?? "none"),
    })
  }

  function applyJump(section: SectionId) {
    setState({
      jump: null,
      focusedSection: section,
    })
  }

  function clearFocus() {
    setState({ focusedSection: "none" })
    setStatus("Focus cleared")
  }
  return { switchTab, cycleTab, enterJump, cancelJump, applyJump, clearFocus }
}
