import { DATABASE_ROWS } from "../../state/databaseRows"
import { SettingsBackdrop } from "./Backdrop"
import { Show, createEffect, onCleanup, type JSX } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { SectionId, SettingsSection } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { theme } from "../../theme"
import { regionRef } from "../regions"
import { taxonomyHeight, TaxonomyPane } from "./TaxonomyPane"
import { onSettings, rulesHeight, RulesPane, APPEARANCE_WIDTH, AppearancePane, DatabasePane, UpPane, AiPane } from "./SettingsPanes"
import { ImportHistoryDialog, ImportOverlay, FactoryResetOverlay } from "./SettingsDialogs"

export { UpAccountsDialog, AiDialog, EditorOverlay, DryRunOverlay } from "./SettingsDialogs"

const paneId = (section: SectionId) => `settings-pane-${section === "set.tags" ? "set.categories" : section === "set.filters" ? "set.rules" : section}`

function settingsColumn(columns: ScrollBoxRenderable[], focused: () => SectionId) {
  return (column: { width?: number; children: JSX.Element }) => (
    <scrollbox ref={(box: ScrollBoxRenderable) => {
      columns.push(box)
      onCleanup(() => columns.splice(columns.indexOf(box), 1))
      const follow = () => queueMicrotask(() => { if (!box.isDestroyed) box.scrollChildIntoView(paneId(focused())) })
      box.content.on("resize", follow)
      box.viewport.on("resize", follow)
      onCleanup(() => { box.content.off("resize", follow); box.viewport.off("resize", follow) })
    }}
      width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} minWidth={0} height="100%"
      scrollY scrollX={false} focusable={false} verticalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column" }}>
      {column.children}
    </scrollbox>
  )
}

const Pane = (pane: { section: SectionId; settings: SettingsSection; width?: number; children: JSX.Element }) =>
  <box id={paneId(pane.section)} ref={regionRef(pane.section, "settings")} width={pane.width ?? "100%"} flexShrink={0} onMouseDown={onSettings(() => ui.activateSettings(pane.settings))}>{pane.children}</box>
const Pair = (pair: { children: JSX.Element }) => <box flexDirection="row" gap={1} width="100%" flexShrink={0}>{pair.children}</box>

export function SettingsTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const columns: ScrollBoxRenderable[] = []
  createEffect(() => {
    const id = paneId(props.focused)
    for (const column of columns) column.scrollChildIntoView(id)
  })
  createEffect(() => {
    if (!ui.state.settingsActive) return
    const id = ui.state.settingsSection === "rules" ? `settings-rule-${ui.state.ruleCursor}` : ui.state.settingsSection === "filters" ? `settings-filter-${ui.state.filterCursor}`
      : ui.state.settingsSection === "appearance" ? `settings-appearance-${ui.state.appearanceCursor}`
      : ui.state.settingsSection === "database" ? `settings-database-${ui.state.databaseCursor}` : null
    if (id) for (const column of columns) column.scrollChildIntoView(id)
  })
  const Column = settingsColumn(columns, () => props.focused)
  const left = () => Math.floor(dims().width * 0.5)
  const right = () => dims().width - 1 - left()
  const full = () => dims().width
  const body = () => dims().height - 4
  const taxonomyFocused = () => props.focused === "set.categories" || props.focused === "set.tags"
  const taxonomy = (width: number, room: number) => <Pane section="set.categories" settings="taxonomy"><TaxonomyPane focused={taxonomyFocused()} height={taxonomyHeight(width, room)} width={width} /></Pane>
  const rules = (width: number) => <Pane section="set.rules" settings="rules"><RulesPane focused={props.focused === "set.rules" || props.focused === "set.filters"} width={width} /></Pane>
  const up = (width: number, height?: number) => <Pane section="set.up" settings="up" width={width}><UpPane focused={props.focused === "set.up"} width={width} height={height} /></Pane>
  const ai = (width: number) => <Pane section="set.ai" settings="ai"><AiPane focused={props.focused === "set.ai"} width={width} /></Pane>
  const appearance = (width: number, height?: number) => <Pane section="set.appearance" settings="appearance" width={width}><AppearancePane focused={props.focused === "set.appearance"} width={width} height={height} /></Pane>
  const database = (width: number, height?: number) => <Pane section="set.database" settings="database" width={width}><DatabasePane focused={props.focused === "set.database"} width={width} height={height} /></Pane>
  const pairs = () => right() >= 100
  return <box width="100%" height="100%" backgroundColor={theme.canvas}>
    <SettingsBackdrop />
    <box zIndex={1} width="100%" height="100%" flexDirection="row" gap={1}>
    <Show when={dims().width >= 112} fallback={
      <Column>
        {taxonomy(full(), dims().height - 6)}{rules(full())}{up(full())}{ai(full())}{appearance(full())}{database(full())}
      </Column>
    }>
      <Column width={left()}>{taxonomy(left(), body() - rulesHeight())}{rules(left())}</Column>
      <Column>
        {up(right())}
        {ai(right())}
        <Show when={pairs()} fallback={<>{appearance(right())}{database(right())}</>}>
          <Pair>{appearance(APPEARANCE_WIDTH, DATABASE_ROWS.length + 5)}{database(right() - 1 - APPEARANCE_WIDTH, DATABASE_ROWS.length + 5)}</Pair>
        </Show>
      </Column>
    </Show>
    </box>
    <ImportOverlay />
    <ImportHistoryDialog />
    <FactoryResetOverlay />
  </box>
}
