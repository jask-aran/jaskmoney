/**
 * Settings: the TUI's panes on components v2. Wide, the categories and
 * tags take the left side and the settings the right, each scrolling on
 * its own; narrower, one column in the TUI's order (Taxonomy, Up Bank, AI
 * models, Rules and filters, Database). A phone (no sidebar) starts with
 * the connection and Up sync, and opens each list in a sheet.
 */
import { Show } from "solid-js"
import "./settings.css"
import { Page, PageHeader } from "../kit"
import { compact } from "../store"
import { Taxonomy } from "./settings/Taxonomy"
import { AiModels, Database, RulesFilters, Status, UpBank } from "./settings/Panes"
import { useDisarm } from "./settings/confirm"

export function Settings() {
  useDisarm()
  return (
    <>
      <PageHeader title="Settings" />
      <Page class="st-page">
        <Show when={compact()}><Status /></Show>
        <Taxonomy />
        <div class="st-side">
          <UpBank sync={!compact()} />
          <AiModels />
          <RulesFilters />
          <Database />
        </div>
      </Page>
    </>
  )
}
