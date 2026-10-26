import { categoryIcon } from "../domain/categoryIcons"
import { data } from "../state/dataStore"

/** The marker shown before a category name: its Nerd Font icon when icons
 * are on and one is known, otherwise a dot (hollow for uncategorised). */
export function categoryMark(categoryId: number | null | undefined, muted = false): string {
  if (data.state.icons) {
    const icon = categoryIcon(data.state.categories.find((c) => c.id === categoryId), data.state.categories)
    if (icon) return icon
  }
  return muted ? "○" : "●"
}
