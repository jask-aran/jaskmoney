import type { UiStore } from "../state/uiStore"
import { nearestRegion, type Direction } from "../state/spatial"
import { regionRects } from "../ui/regions"

export function travel(ui: UiStore, dir: Direction): void {
  const regions = regionRects(ui.state.activeTab)
  const focus = ui.state.focusedSection
  const from = regions.find((region) => region.id === focus)
  const next = focus === "none"
    ? regions.filter((region) => !region.id.startsWith("bar.")).sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)[0]?.id
    : from && nearestRegion(from.rect, regions.filter((region) => region.id !== focus), dir)
  if (next) ui.setState({ focusedSection: next })
}
