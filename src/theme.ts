import { createSignal } from "solid-js"
import { DEFAULT_THEME, THEMES, type BasePalette, type ThemeDef } from "./themes"

/**
 * The palette, in Catppuccin's slots (themes.ts holds each theme's).
 * Text and accents take their colours through `ink` and `tone` below
 * (Go's aliases: accent=brand=pink is tone.key, focus=lavender tone.focus,
 * success, error, warning tone.good, bad, caution). `theme`, `ink` and
 * `tone` are changed in place when the theme changes (applyTheme), and the
 * app redraws from them: read them when drawing, never copy them into a
 * module constant (whenThemeChanges re-derives one that must be).
 */
export interface Palette {
  rosewater: string; flamingo: string; pink: string; mauve: string; red: string; maroon: string; peach: string
  yellow: string; green: string; teal: string; sky: string; sapphire: string; blue: string; lavender: string
  text: string; subtext1: string; subtext0: string; overlay2: string; overlay1: string; overlay0: string
  surface2: string; surface1: string; surface0: string; base: string; mantle: string; crust: string
  /** The OpenTUI canvas: every pane's background (crust on a dark theme). */
  canvas: string
  /** Chart rules: today's rule and the budget's pace line, never alike. */
  chartToday: string
  chartBudget: string
  // Row states, every list (domain/rowStyle): the Transactions table's
  // washes. Cursor, selection and range are independent; a cursor on a
  // selected or ranged row is a bright bar with dark text.
  /** The cursor row (bold). */
  rowCursor: string
  /** A selected row. */
  rowSelected: string
  /** A row in the range being marked. */
  rowRange: string
  /** Selected and in the range. */
  rowSelectedRange: string
  /** The cursor on a selected row. */
  rowCursorSelected: string
  /** The cursor on a row in the range. */
  rowCursorRange: string
  /** The cursor on a selected row in the range. */
  rowCursorSelectedRange: string
  /** Text on the bright cursor bars. */
  rowCursorText: string
  /** ink.strong, ink.figure and ink.heading (see ink). */
  strong: string
  figure: string
  heading: string
}

/** `a` taken `share` (0–1) of the way to `b` (#rrggbb). */
export function mix(a: string, b: string, share: number): string {
  if (share >= 1) return b
  if (share <= 0) return a
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [from, to] = [rgb(a), rgb(b)]
  return `#${from.map((c, i) => Math.round(c + (to[i]! - c) * share).toString(16).padStart(2, "0")).join("")}`
}

/** A theme's full palette: its own colours, the rest derived from them. */
export function paletteOf(def: Pick<ThemeDef, "colors">): Palette {
  const c: BasePalette = def.colors
  const canvas = c.canvas ?? c.crust
  return {
    canvas,
    chartToday: c.green,
    chartBudget: mix(c.yellow, canvas, 0.35),
    rowCursor: c.surface2,
    rowSelected: c.surface0,
    rowRange: c.base,
    rowSelectedRange: c.surface1,
    rowCursorSelected: c.blue,
    rowCursorRange: c.sapphire,
    rowCursorSelectedRange: c.pink,
    rowCursorText: c.crust,
    strong: "#ffffff",
    figure: mix(c.text, "#ffffff", 0.4),
    heading: mix(c.pink, canvas, 0.2),
    ...c,
  }
}

const themeById = (id: string | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!

export const theme: Palette = paletteOf(themeById(DEFAULT_THEME))

/**
 * Text, by role. Every word on screen takes its colour from what it is,
 * never from how loud it should look in one place:
 *
 * - strong: the figure a card is about (Available, Net position), bold;
 *   one or two per card. White, so the eye lands there first.
 * - figure: values and the names of things: amounts, descriptions,
 *   merchants, what you typed. A neutral near-white, clearly brighter than
 *   the labels beside it.
 * - heading: a subheading inside a card (Savers under Accounts, a group in
 *   a picker), bold: the card title's pink, softened.
 * - label: what a value is (row labels, field names, column headings),
 *   and figures that explain another one
 *   (Balance under Available, a child category's amount, a row's date, its
 *   account).
 * - note: comparisons, counts, units, hints, help prose, empty states.
 * - faint: placeholders, and what can't be used now (a disabled command,
 *   an unset field, a view that isn't shown).
 * - rule: separators and lines, not words.
 *
 * Colour that isn't a role is data (a category's or tag's own colour, a
 * chart's series) or one of the tones below. The table's cursor bars set
 * their own text colour (rowCursorText).
 */
const inkOf = (p: Palette) => ({
  strong: p.strong,
  figure: p.figure,
  heading: p.heading,
  label: p.subtext0,
  note: p.overlay1,
  faint: p.overlay0,
  rule: p.surface2,
})
export const ink: ReturnType<typeof inkOf> = inkOf(theme)

/**
 * Accents, one meaning each.
 *
 * - good / bad: green and red. Money in and money out on a row; up and down
 *   in a balance; spending less or more than it's compared with, or than
 *   its budget; connected or failing; red also marks an action that
 *   deletes. Nothing else is green or red.
 * - caution: yellow. Wants your attention: uncategorised rows, ahead of a
 *   budget's pace, an overdue payment, a price rise.
 * - ai: teal. Suggestions and what the models did.
 * - key: pink. Keys you can press, the current tab, chip or view, the brand.
 * - focus: lavender. The focused pane's border and title.
 * - scope: peach. What the view is narrowed to: the date range, a search
 *   in effect.
 */
const toneOf = (p: Palette) => ({
  good: p.green,
  bad: p.red,
  caution: p.yellow,
  ai: p.teal,
  key: p.pink,
  focus: p.lavender,
  scope: p.peach,
})
export const tone: ReturnType<typeof toneOf> = toneOf(theme)

/** Uncategorised / muted category label (Go overlay1). */
export let uncategorisedColor = theme.overlay1

/** The theme shown (its id), and a count that changes with it: App's view
 * tree remounts on it, so everything redraws in the new colours. */
export let themeId = DEFAULT_THEME
const [themeVersion, setThemeVersion] = createSignal(0)
export { themeVersion }

const listeners: Array<() => void> = []
/** Run `derive` now and whenever the theme changes: for a module constant
 * made from theme colours (a lookup table read on every row). */
export function whenThemeChanges(derive: () => void): void {
  derive()
  listeners.push(derive)
}

/** Show theme `id` (themes.ts; an unknown one is the default). */
export function applyTheme(id: string | undefined): void {
  const def = themeById(id)
  if (def.id === themeId) return
  themeId = def.id
  Object.assign(theme, paletteOf(def))
  Object.assign(ink, inkOf(theme))
  Object.assign(tone, toneOf(theme))
  uncategorisedColor = theme.overlay1
  for (const derive of listeners) derive()
  setThemeVersion((v) => v + 1)
}

/** The colour stored for the Uncategorised category. */
const UNCATEGORISED_STORED = "#7f849c"

/** Whether a category colour means "no category": none, or Uncategorised's. */
export function isUncategorisedColor(color: string | null | undefined): boolean {
  return !color || color === UNCATEGORISED_STORED
}

/** `color` taken `share` of the way to the canvas (#rrggbb only; others as they are). */
export function fade(color: string, share: number): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? mix(color, theme.canvas, share) : color
}

/** A category's display colour: its own, or the muted uncategorised colour. */
export function categoryColor(color: string | null | undefined): string {
  return isUncategorisedColor(color) ? uncategorisedColor : color!
}
