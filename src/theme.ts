/**
 * Catppuccin Mocha — parity with Go `theme.go` / `render.go`.
 * Semantic aliases match Go: accent=brand=pink, focus=lavender.
 */
export const theme = {
  // Palette
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",

  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",

  // Legacy leaves the terminal background exposed; use its darker equivalent
  // for the OpenTUI canvas rather than filling every empty cell with base.
  canvas: "#11111b",

  // Semantic (Go aliases)
  /** Active tab text, help keys, brand title default */
  accent: "#f5c2e7", // pink
  brand: "#f5c2e7",
  /** Focused section border + title */
  focus: "#b4befe", // lavender

  // Custom neutral overrides — Catppuccin Mocha's light colours all skew
  // blue/purple, so these provide a warm-neutral hierarchy for table text.
  /** White-ish for descriptions (most prominent). */
  brightText: "#e6e6e6",
  /** Neutral light grey for dates (de-emphasised). */
  mutedText: "#c0c0c0",
  /** Neutral mid-grey for accounts (between mutedText and uncategorised). */
  dimText: "#9e9e9e",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#94e2d5",

  // Chart rules: today's rule a vivid green, the budget pace line a muted
  // yellow, so the two never read alike.
  chartToday: "#66d690",
  chartBudget: "#a8996b",

  // Row states, every list (domain/rowStyle): the Transactions table's
  // washes. Cursor, selection and range are independent; a cursor on a
  // selected or ranged row is a bright bar with dark text.
  /** The cursor row (bold). */
  rowCursor: "#585b70", // surface2
  /** A selected row. */
  rowSelected: "#313244", // surface0
  /** A row in the range being marked. */
  rowRange: "#1e1e2e", // base
  /** Selected and in the range. */
  rowSelectedRange: "#45475a", // surface1
  /** The cursor on a selected row. */
  rowCursorSelected: "#89b4fa", // blue
  /** The cursor on a row in the range. */
  rowCursorRange: "#74c7ec", // sapphire
  /** The cursor on a selected row in the range. */
  rowCursorSelectedRange: "#f5c2e7", // pink
  /** Text on the bright cursor bars. */
  rowCursorText: "#11111b", // crust
} as const

/**
 * Text, by role. Every word on screen takes its colour from what it is,
 * never from how loud it should look in one place:
 *
 * - figure: values and the names of things: amounts, descriptions,
 *   merchants, what you typed. Bold makes a figure the one a card or row is
 *   about (Available, Net position); one per card.
 * - label: what a value is (row labels, field names, column headings,
 *   headings inside a card, bold), and figures that explain another one
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
export const ink = {
  figure: theme.text,
  label: theme.subtext0,
  note: theme.overlay1,
  faint: theme.overlay0,
  rule: theme.surface2,
} as const

/**
 * Accents, one meaning each.
 *
 * - good / bad: green and red. Money in and money out on a row; up and down
 *   in a balance; spending less or more than it's compared with, or than
 *   its budget; connected or failing. Nothing else is green or red.
 * - caution: yellow. Wants your attention: uncategorised rows, ahead of a
 *   budget's pace, an overdue payment, a price rise.
 * - ai: teal. Suggestions and what the models did.
 * - key: pink. Keys you can press, the current tab, chip or view, the brand.
 * - focus: lavender. The focused pane's border and title.
 * - scope: peach. What the view is narrowed to: the date range, a search
 *   in effect.
 */
export const tone = {
  good: theme.green,
  bad: theme.red,
  caution: theme.yellow,
  ai: theme.teal,
  key: theme.pink,
  focus: theme.lavender,
  scope: theme.peach,
} as const

/** Uncategorised / muted category label (Go overlay1). */
export const uncategorisedColor = theme.overlay1

/** The colour stored for the Uncategorised category. */
const UNCATEGORISED_STORED = "#7f849c"

/** Whether a category colour means "no category": none, or Uncategorised's. */
export function isUncategorisedColor(color: string | null | undefined): boolean {
  return !color || color === UNCATEGORISED_STORED
}

/** `color` taken `share` of the way to the canvas (#rrggbb only; others as they are). */
export function fade(color: string, share: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color
  const [from, to] = [rgb(color), rgb(theme.canvas)]
  return `#${from.map((c, i) => Math.round(c + (to[i]! - c) * share).toString(16).padStart(2, "0")).join("")}`
}

/** A category's display colour: its own, or the muted uncategorised colour. */
export function categoryColor(color: string | null | undefined): string {
  return isUncategorisedColor(color) ? uncategorisedColor : color!
}
