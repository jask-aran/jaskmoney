import type { Renderable } from "@opentui/core"
import { onCleanup } from "solid-js"
import type { SectionId, TabId } from "../state/uiStore"
import type { Rect } from "../state/spatial"

const regions = new Map<SectionId, { tab: TabId | "bar"; node: Renderable }>()

export function regionRef(id: SectionId, tab: TabId | "bar") {
  return (node: Renderable) => {
    regions.set(id, { tab, node })
    onCleanup(() => { if (regions.get(id)?.node === node) regions.delete(id) })
  }
}

export function regionRects(tab: TabId): { id: SectionId; rect: Rect }[] {
  return [...regions].flatMap(([id, entry]) => {
    if (entry.tab !== tab && entry.tab !== "bar") return []
    const node = entry.node
    for (let parent: Renderable | null = node; parent; parent = parent.parent) {
      if (!parent.visible || parent.isDestroyed) return []
    }
    if (node.width <= 0 || node.height <= 0) return []
    return [{ id, rect: { x: node.x, y: node.y, width: node.width, height: node.height } }]
  })
}
