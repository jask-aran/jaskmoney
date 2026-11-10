import { updateAvailable, versionLabel } from "./updates"
import { showVersion, type paletteList } from "./keys"
import { ModelPicker } from "../ui/settings/ModelPicker"
import { ThemePicker } from "../ui/settings/ThemePicker"
import { Welcome } from "../ui/welcome/Welcome"
import { Show, type Accessor } from "solid-js"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { CommandPalette } from "../ui/primitives/CommandPalette"
import { TabBar } from "../ui/primitives/TabBar"
import { UP_LOGO_WIDTH, UpLogo } from "../ui/primitives/UpLogo"
import { CatPicker } from "../ui/primitives/CatPicker"
import { AiQueryView, AiUseDialog } from "../ui/settings/AiUseDialogs"
import { EditorOverlay, DryRunOverlay, AiDialog, UpAccountsDialog } from "../ui/settings/SettingsTab"
import { ExecutorDialog } from "../ui/settings/ExecutorDialog"
import { tone } from "../theme"
import { selectionLabel } from "../domain/accountTree"
import { JumpOverlay, MerchantNoteBox, SavedFilterPicker, SearchHelp, TagChooser, TagPicker } from "../ui/primitives/Dialogs"

export function AppBar(props: { syncLabel: () => string }) {
  const accountLabel = () => {
    if (data.state.accounts.length === 0) return "No accounts"
    return ui.state.activeTab === "manager" ? selectionLabel(data.state.accounts, data.state.accountSelection) : ""
  }
  return (
    <TabBar
      active={ui.state.activeTab}
      items={[
        { text: data.state.demo ? "DEMO" : "" },
        { text: accountLabel() },
        { id: "bar.version", text: versionLabel(), fg: updateAvailable() ? tone.good : undefined, onHover: () => void showVersion(ui) },
        { id: "bar.sync", text: data.state.demo ? "" : props.syncLabel() },
      ]}
      reserveRight={ui.state.activeTab === "overview" ? UP_LOGO_WIDTH : 0}
    />
  )
}

export function Overlays(props: { paletteCommands: Accessor<ReturnType<typeof paletteList>> }) {
  return (
    <>
      <Show when={ui.state.activeTab === "overview"}>
        <UpLogo />
      </Show>
      <JumpOverlay active={(ui.state.jump != null)} tab={ui.state.activeTab} />
      <CatPicker />
      <TagChooser />
      <MerchantNoteBox />
      <SearchHelp />
      <AiUseDialog />
      <AiQueryView />
      <AiDialog />
      <ExecutorDialog />
      <UpAccountsDialog />
      <TagPicker />
      <EditorOverlay />
      <SavedFilterPicker />
      <ThemePicker />
      <ModelPicker />
      <DryRunOverlay />
      <Welcome />
      <Show when={ui.state.palette}>
        {(palette: () => NonNullable<typeof ui.state.palette>) => (
          <CommandPalette commands={props.paletteCommands()} cursor={palette().cursor} query={palette().query} lastId={ui.state.lastCommandId} />
        )}
      </Show>
    </>
  )
}
