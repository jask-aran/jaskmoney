import { theme } from "../theme"

export interface RowAppearance {
  /** Row background; null = the table canvas. */
  bg: string | null
  /** Text colour for every cell, overriding column colours; null = keep them. */
  fg: string | null
  /** Go cursorStrong: the cursor row is bold. */
  bold: boolean
}

/**
 * Go rowStateBackgroundAndCursor, adapted to the darker OpenTUI canvas
 * (approved deviations, 2026-10-26):
 * - Range highlight uses base, not mantle. Go drew mantle on the terminal's
 *   base background; on the crust canvas mantle was indistinguishable.
 * - Cursor rows on the bright accent/blue/sapphire backgrounds use crust text.
 *   Go kept column colours there, which left light text on a light bar.
 * Cursor, selection and range stay independent inputs.
 */
export function rowAppearance(selected: boolean, highlighted: boolean, isCursor: boolean): RowAppearance {
  if (isCursor && selected && highlighted) return { bg: theme.accent, fg: theme.crust, bold: true }
  if (isCursor && selected) return { bg: theme.blue, fg: theme.crust, bold: true }
  if (isCursor && highlighted) return { bg: theme.sapphire, fg: theme.crust, bold: true }
  if (isCursor) return { bg: theme.surface2, fg: null, bold: true }
  if (selected && highlighted) return { bg: theme.surface1, fg: null, bold: false }
  if (selected) return { bg: theme.surface0, fg: null, bold: false }
  if (highlighted) return { bg: theme.base, fg: null, bold: false }
  return { bg: null, fg: null, bold: false }
}
