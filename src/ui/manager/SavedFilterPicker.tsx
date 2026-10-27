import { Show } from "solid-js"
import { data } from "../../state/dataStore"
import { savedFilterItems, savedFilterOptions } from "../../state/savedFilters"
import { ui } from "../../state/uiStore"
import { ListPicker } from "../primitives/ListPicker"

/** ctrl+l in Transactions: the saved filters, most recently used first,
 * each with its expression. */
export function SavedFilterPicker() {
  return (
    <Show when={ui.state.filterPicker}>
      {(picker: () => NonNullable<typeof ui.state.filterPicker>) => (
        <ListPicker
          title="Saved filters"
          items={savedFilterItems(savedFilterOptions(data.state.savedFilters, data.state.uiPrefs.filterUsage, picker().query))}
          cursor={picker().cursor}
          query={picker().query}
          width={72}
          hints="↑↓ ^j/k move · enter apply · esc close · type filter"
        />
      )}
    </Show>
  )
}
