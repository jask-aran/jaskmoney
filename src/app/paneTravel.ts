import type { UiStore } from "../state/uiStore"
import { nearestRegion, type Direction } from "../state/spatial"
import { regionRects } from "../ui/regions"

/** Input matrix (dialogs take priority in activeScope before dispatch):
 * none + any arrow: first page region in reading order.
 * pane/bar + arrow: nearest region in that direction; no target: keep focus.
 * Categories up/down: move its cursor inside the list, travel at an edge.
 * Range left/right: move its chip cursor inside the strip, travel at an edge.
 * Bar enter: run the item; esc: restore TAB_DEFAULT_FOCUS.
 * Travel changes only focus. Tab activation retains switchTab's reset policy.
 * chipLook derives bar colours from current-tab and cursor independently.
 */
export function travel(ui: UiStore, dir: Direction): void {
  const regions = regionRects(ui.state.activeTab)
  const focus = ui.state.focusedSection
  const from = regions.find((region) => region.id === focus)
  const next = focus === "none"
    ? regions.filter((region) => !region.id.startsWith("bar.")).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0]?.id
    : from && nearestRegion(from.rect, regions.filter((region) => region.id !== focus), dir)
  if (next) ui.setState({ focusedSection: next })
}
