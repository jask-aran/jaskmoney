import type { MouseEvent } from "@opentui/core"
import { ui, type ScopeId } from "../state/uiStore"

export function onPointer(scope: ScopeId | ((s: ScopeId) => boolean), action: (event: MouseEvent) => void) {
  return (event: MouseEvent) => {
    const active = ui.activeScope()
    if (typeof scope === "function" ? !scope(active) : active !== scope) return
    action(event)
    event.stopPropagation()
  }
}
