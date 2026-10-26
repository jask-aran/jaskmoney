import { theme } from "../../theme"

/**
 * How a chip or tab looks: `active` is the applied choice (pink, bold, on a
 * soft pill, as the tab bar's current tab), `cursor` the one a focused row of
 * chips would apply next (a brighter pill). The states are independent and
 * neither changes the chip's width.
 */
export function chipLook(state: { active: boolean; cursor: boolean }): { fg: string; bg: string | undefined; bold: boolean } {
  return {
    fg: state.active ? theme.accent : state.cursor ? theme.text : theme.overlay1,
    bg: state.cursor ? theme.surface1 : state.active ? theme.surface0 : undefined,
    bold: state.active || state.cursor,
  }
}
