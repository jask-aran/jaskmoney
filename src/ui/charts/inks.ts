import { fade, ink, theme, tone, whenThemeChanges } from "../../theme"

/** The views' data colours (series, marks, gridlines). */
export const INKS: Record<string, string> = {}
whenThemeChanges(() => Object.assign(INKS, {
  // Spending: the calendar's purple, lighter where a day or week isn't over.
  spend: theme.mauve,
  partial: fade(theme.mauve, 0.45),
  prev: theme.overlay0,
  ref: theme.surface2,
  in: tone.good,
  // Money in from outside your accounts (another bank): not income.
  transfers: theme.sapphire,
  out: tone.bad,
  limit: theme.chartBudget,
  balance: theme.lavender,
  // Where Available is headed: the balance line, faded.
  projection: fade(theme.lavender, 0.5),
  // Savers' total; each saver's own line takes a colour from saverInks.
  total: ink.figure,
  // Gridlines, as in the Go app.
  week: theme.surface1,
  month: theme.blue,
  year: theme.pink,
  today: theme.chartToday,
  // In-chart notes (highs, lows, totals): grey, so the coloured label is
  // always the latest value.
  note: ink.note,
}))
