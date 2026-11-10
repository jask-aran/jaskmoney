import { createSignal } from "solid-js"
import { DEFAULT_THEME, THEMES, type BasePalette, type ThemeDef } from "./themes"

export interface Palette {
  rosewater: string; flamingo: string; pink: string; mauve: string; red: string; maroon: string; peach: string
  yellow: string; green: string; teal: string; sky: string; sapphire: string; blue: string; lavender: string
  text: string; subtext1: string; subtext0: string; overlay2: string; overlay1: string; overlay0: string
  surface2: string; surface1: string; surface0: string; base: string; mantle: string; crust: string
  canvas: string
  chartToday: string
  chartBudget: string
  rowCursor: string
  rowSelected: string
  rowRange: string
  rowSelectedRange: string
  rowCursorSelected: string
  rowCursorRange: string
  rowCursorSelectedRange: string
  rowCursorText: string
  strong: string
  figure: string
  heading: string
}

export function mix(a: string, b: string, share: number): string {
  if (share >= 1) return b
  if (share <= 0) return a
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [from, to] = [rgb(a), rgb(b)]
  return `#${from.map((c, i) => Math.round(c + (to[i]! - c) * share).toString(16).padStart(2, "0")).join("")}`
}

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
    heading: c.subtext1,
    ...c,
  }
}

const themeById = (id: string | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!

export const theme: Palette = paletteOf(themeById(DEFAULT_THEME))

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

let uncategorisedColor = theme.overlay1

export let themeId = DEFAULT_THEME
const [themeVersion, setThemeVersion] = createSignal(0)
export { themeVersion }

const listeners: Array<() => void> = []
export function whenThemeChanges(derive: () => void): void {
  derive()
  listeners.push(derive)
}

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

const UNCATEGORISED_STORED = "#7f849c"

export function isUncategorisedColor(color: string | null | undefined): boolean {
  return !color || color === UNCATEGORISED_STORED
}

export function fade(color: string, share: number): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? mix(color, theme.canvas, share) : color
}

export function categoryColor(color: string | null | undefined): string {
  return isUncategorisedColor(color) ? uncategorisedColor : color!
}
