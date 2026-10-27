import { theme } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"

/**
 * How a chip or tab looks, on the row washes (rowAppearance): `active` is
 * the applied choice (pink and bold on the selected wash, as the tab bar's
 * current tab), `cursor` the one a focused row of chips would apply next
 * (the cursor wash; on the applied chip, the bright cursor bar). The states
 * are independent and neither changes the chip's width.
 */
export function chipLook(state: { active: boolean; cursor: boolean }): { fg: string; bg: string | undefined; bold: boolean } {
  const look = rowAppearance(state.active, false, state.cursor)
  return {
    fg: look.fg ?? (state.active ? theme.accent : state.cursor ? theme.text : theme.overlay1),
    bg: look.bg ?? undefined,
    bold: state.active || state.cursor,
  }
}
