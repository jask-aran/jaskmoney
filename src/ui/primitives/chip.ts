import { ink, tone } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"

export function chipLook(state: { active: boolean; cursor: boolean }): { fg: string; bg: string | undefined; bold: boolean } {
  const look = rowAppearance(state.active, false, state.cursor)
  return {
    fg: look.fg ?? (state.active ? tone.key : state.cursor ? ink.figure : ink.label),
    bg: look.bg ?? undefined,
    bold: state.active || state.cursor,
  }
}
