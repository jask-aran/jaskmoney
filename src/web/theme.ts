/**
 * The TUI's colours (src/theme.ts) as CSS variables, so the web app and the
 * TUI share one palette and one set of roles: text in `--ink-*` by what it
 * is, accents in `--tone-*`, raw palette colours for data only.
 */
import { categoryColor, fade, ink, theme, tone } from "../theme"

export function applyTheme(root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string) => root.style.setProperty(name, value)
  for (const [name, value] of Object.entries(theme)) set(`--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value)
  for (const [name, value] of Object.entries(ink)) set(`--ink-${name}`, value)
  for (const [name, value] of Object.entries(tone)) set(`--tone-${name}`, value)
}

/** A category's colour, and faded (a suggestion: provisional until accepted). */
export const catColor = (color: string | null | undefined) => categoryColor(color)
export const provisional = (color: string | null | undefined) => fade(categoryColor(color), 0.35)

export { ink, tone, theme }
