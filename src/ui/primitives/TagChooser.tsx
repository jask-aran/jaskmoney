import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { tagChoices, tagChooserItems } from "../../state/tagChooser"
import { ListPicker } from "./ListPicker"

/** T: the tag to find transactions for: yours, groups found in the
 * history (trips, subscriptions), or a new name typed. */
export function TagChooser() {
  const items = createMemo(() => tagChooserItems(tagChoices(data.state.tags, data.tagGroups(), ui.state.tagChooserQuery), data.state.transactions))
  return (
    <Show when={ui.state.tagChooserOpen}>
      <ListPicker
        title="Find transactions for a tag"
        subtitle="tag review"
        items={items()}
        cursor={ui.state.tagChooserCursor}
        query={ui.state.tagChooserQuery}
        width={84}
        hints="↑↓ ^j/k move · type to filter or name a new tag · enter find · esc cancel"
      />
    </Show>
  )
}
