import { theme } from "../theme"

/**
 * Go rowStateBackgroundAndCursor.
 * Default returns null — no background (keeps colours vibrant).
 * Callers must still force-clear sticky paint via row `key` remount.
 */
export function rowBackground(
  selected: boolean,
  highlighted: boolean,
  isCursor: boolean,
): string | null {
  if (isCursor && selected && highlighted) return theme.accent
  if (isCursor && selected) return theme.blue
  if (isCursor && highlighted) return theme.sapphire
  if (isCursor) return theme.surface2
  if (selected && highlighted) return theme.surface1
  if (selected) return theme.surface0
  if (highlighted) return theme.mantle
  return null
}
