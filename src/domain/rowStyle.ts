import { theme, whenThemeChanges } from "../theme"

interface RowAppearance {
  bg: string | null
  fg: string | null
  bold: boolean
}

export function rowAppearance(selected: boolean, highlighted: boolean, isCursor: boolean): RowAppearance {
  return LOOKS[(isCursor ? 4 : 0) + (selected ? 2 : 0) + (highlighted ? 1 : 0)]!
}

const LOOKS: RowAppearance[] = []
whenThemeChanges(() => LOOKS.splice(0, LOOKS.length,
  { bg: null, fg: null, bold: false },
  { bg: theme.rowRange, fg: null, bold: false },
  { bg: theme.rowSelected, fg: null, bold: false },
  { bg: theme.rowSelectedRange, fg: null, bold: false },
  { bg: theme.rowCursor, fg: null, bold: true },
  { bg: theme.rowCursorRange, fg: theme.rowCursorText, bold: true },
  { bg: theme.rowCursorSelected, fg: theme.rowCursorText, bold: true },
  { bg: theme.rowCursorSelectedRange, fg: theme.rowCursorText, bold: true },
))
