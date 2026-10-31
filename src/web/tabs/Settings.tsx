/**
 * Settings: the TUI's panes on components v2. Wide, the categories and
 * tags take the left side and the settings the right, each scrolling on
 * its own; narrower, one column in the TUI's order (Taxonomy, Up Bank, AI
 * models, Rules and filters, Database), a phone showing one list at a time.
 */
import "./settings.css"
import { Page, PageHeader } from "../kit"
import { Taxonomy } from "./settings/Taxonomy"
import { AiModels, Database, RulesFilters, UpBank } from "./settings/Panes"
import { useDisarm } from "./settings/confirm"

export function Settings() {
  useDisarm()
  return (
    <>
      <PageHeader title="Settings" />
      <Page class="st-page">
        <Taxonomy />
        <div class="st-side">
          <UpBank />
          <AiModels />
          <RulesFilters />
          <Database />
        </div>
      </Page>
    </>
  )
}
