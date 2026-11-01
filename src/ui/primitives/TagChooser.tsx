import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { tagChoices, tagChooserItems } from "../../state/tagChooser"
import { ListPicker } from "./ListPicker"

/** T: the tag to find transactions for: yours, groups found in the
 * history (trips, subscriptions), or a new name typed. */
export function TagChooser() {
  return <Show when={(ui.state.tagChooser != null)}><OpenTagChooser /></Show>
}

/** The open chooser: its rows are worked out only while it shows (they
 * walk the whole history). */
function OpenTagChooser() {
  const items = createMemo(() => tagChooserItems(tagChoices(data.state.tags, data.tagGroups(), (ui.state.tagChooser?.query ?? "")), data.state.transactions, data.state.categories))
  return (
      <ListPicker
        title="Find transactions for a tag"
        subtitle="tag review"
        items={items()}
        cursor={(ui.state.tagChooser?.cursor ?? 0)}
        query={(ui.state.tagChooser?.query ?? "")}
        width={84}
        hints="↑↓ ^j/k move · type to filter or name a new tag · enter find · esc cancel"
      />
  )
}
