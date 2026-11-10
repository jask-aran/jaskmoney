import { fade, ink, theme, tone, whenThemeChanges } from "../../theme"

export const INKS: Record<string, string> = {}
whenThemeChanges(() => Object.assign(INKS, {
  spend: theme.mauve,
  partial: fade(theme.mauve, 0.45),
  prev: theme.overlay0,
  ref: theme.surface2,
  in: tone.good,
  transfers: theme.sapphire,
  out: tone.bad,
  limit: theme.chartBudget,
  balance: theme.lavender,
  projection: fade(theme.lavender, 0.5),
  total: ink.figure,
  week: theme.surface1,
  month: theme.blue,
  year: theme.pink,
  today: theme.chartToday,
  note: ink.note,
}))
