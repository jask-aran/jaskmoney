/**
 * Settings: the TUI's panes in a browser. Wide, Taxonomy has the left
 * column (its lists scroll in place) and the rest stack on the right:
 * Up Bank, AI models, Rules & Filters, Database; narrower, one column in
 * that order, Taxonomy showing one list at a time.
 */
import "./settings.css"
import { Taxonomy } from "./settings/Taxonomy"
import { AiModels, Database, RulesFilters, UpBank } from "./settings/Panes"
import { useDisarm } from "./settings/confirm"

export function Settings() {
  useDisarm()
  return (
    <div class="pane st-page">
      <Taxonomy />
      <div class="st-side">
        <UpBank />
        <AiModels />
        <RulesFilters />
        <Database />
      </div>
    </div>
  )
}
