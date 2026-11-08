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

// What other files take from Settings.
export { UpAccountsDialog, AiDialog, EditorOverlay, DryRunOverlay } from "./SettingsDialogs"

/** The box a section's pane sits in: what the column scrolls into view. */
const paneId = (section: SectionId) => `settings-pane-${section === "set.tags" ? "set.categories" : section === "set.filters" ? "set.rules" : section}`

/** A column of panes, registered in `columns` while it's mounted: what
 * scrolls to the focused pane. */
function settingsColumn(columns: ScrollBoxRenderable[], focused: () => SectionId) {
  return (column: { width?: number; children: JSX.Element }) => (
    <scrollbox ref={(box: ScrollBoxRenderable) => {
      columns.push(box)
      onCleanup(() => columns.splice(columns.indexOf(box), 1))
      // A first layout or a resize moves the panes: follow focus again. On
      // the content's "resize" event, which comes after its onSizeChange (the
      // scrollbox's own: it updates the scroll range), so that isn't replaced.
      // After the frame's layout, not in it: the content is resized before
      // its panes are placed, and a pane read then is where it was (a pane
      // focused low in the column stayed off screen on opening).
      const follow = () => queueMicrotask(() => { if (!box.isDestroyed) box.scrollChildIntoView(paneId(focused())) })
      // The viewport too: a shorter screen can leave the content's height
      // as it was (Taxonomy at its own height) while the view shrinks.
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

// Each pane registers where it is (h/l go to the one beside) and
// activates on a click anywhere in it (a row's own click also moves the cursor).
const Pane = (pane: { section: SectionId; settings: SettingsSection; width?: number; children: JSX.Element }) =>
  <box id={paneId(pane.section)} ref={regionRef(pane.section, "settings")} width={pane.width ?? "100%"} flexShrink={0} onMouseDown={onSettings(() => ui.activateSettings(pane.settings))}>{pane.children}</box>
/** Two panes side by side, one height. */
const Pair = (pair: { children: JSX.Element }) => <box flexDirection="row" gap={1} width="100%" flexShrink={0}>{pair.children}</box>

export function SettingsTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  // Panes keep their own height; a column taller than the screen scrolls,
  // following the focused pane.
  const columns: ScrollBoxRenderable[] = []
  createEffect(() => {
    const id = paneId(props.focused)
    for (const column of columns) column.scrollChildIntoView(id)
  })
  // In the lists drawn whole (Rules, Saved Filters, Appearance, Database), the cursor row too.
  createEffect(() => {
    if (!ui.state.settingsActive) return
    const id = ui.state.settingsSection === "rules" ? `settings-rule-${ui.state.ruleCursor}` : ui.state.settingsSection === "filters" ? `settings-filter-${ui.state.filterCursor}`
      : ui.state.settingsSection === "appearance" ? `settings-appearance-${ui.state.appearanceCursor}`
      : ui.state.settingsSection === "database" ? `settings-database-${ui.state.databaseCursor}` : null
    if (id) for (const column of columns) column.scrollChildIntoView(id)
  })
  const Column = settingsColumn(columns, () => props.focused)
  // Wide: Taxonomy over Rules & Filters on the left (full width of the
  // column); on the right Up Bank, AI models, Appearance
  // beside Database & Import (each
  // pair one height), stacked when the column is too narrow for pairs.
  // Narrower: one column in the same order (SETTINGS_SECTIONS).
  const left = () => Math.floor(dims().width * 0.5)
  const right = () => dims().width - 1 - left()
  const full = () => dims().width
  // The tab's body: the screen less the tab bar, its gap, the status and the footer.
  const body = () => dims().height - 4
  const taxonomyFocused = () => props.focused === "set.categories" || props.focused === "set.tags"
  const taxonomy = (width: number, room: number) => <Pane section="set.categories" settings="taxonomy"><TaxonomyPane focused={taxonomyFocused()} height={taxonomyHeight(width, room)} width={width} /></Pane>
  const rules = (width: number) => <Pane section="set.rules" settings="rules"><RulesPane focused={props.focused === "set.rules" || props.focused === "set.filters"} width={width} /></Pane>
  const up = (width: number, height?: number) => <Pane section="set.up" settings="up" width={width}><UpPane focused={props.focused === "set.up"} width={width} height={height} /></Pane>
  const ai = (width: number) => <Pane section="set.ai" settings="ai"><AiPane focused={props.focused === "set.ai"} width={width} /></Pane>
  const appearance = (width: number, height?: number) => <Pane section="set.appearance" settings="appearance" width={width}><AppearancePane focused={props.focused === "set.appearance"} width={width} height={height} /></Pane>
  const database = (width: number, height?: number) => <Pane section="set.database" settings="database" width={width}><DatabasePane focused={props.focused === "set.database"} width={width} height={height} /></Pane>
  // Pairs need room for Up Bank's rows and Database's values beside their partners.
  const pairs = () => right() >= 100
  // The setup's backdrop behind the panes (Backdrop); the panes over it.
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
    {/* Last, so a confirmation armed from a dialog shows over it. */}
  </box>
}
