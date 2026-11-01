import { afterEach, expect, test } from "bun:test"
import { applyTheme, ink, paletteOf, theme, themeId, tone } from "./theme"
import { DEFAULT_THEME, THEMES } from "./themes"
import { INKS } from "./ui/charts/inks"
import { rowAppearance } from "./domain/rowStyle"

afterEach(() => applyTheme(DEFAULT_THEME))

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

test("Jaskmoney is the default and keeps the colours the app had before themes", () => {
  expect(themeId).toBe("jaskmoney")
  expect(theme.canvas).toBe("#11111b")
  expect(theme.rowCursor).toBe("#585b70")
  expect(ink).toEqual({ strong: "#ffffff", figure: "#e6e6e6", heading: "#c79fbe", label: "#a6adc8", note: "#7f849c", faint: "#6c7086", rule: "#585b70" })
  expect(tone).toEqual({ good: "#a6e3a1", bad: "#f38ba8", caution: "#f9e2af", ai: "#94e2d5", key: "#f5c2e7", focus: "#b4befe", scope: "#fab387" })
  expect(theme.chartBudget).toBe("#a8996b")
})

test("applyTheme changes theme, ink, tone and the tables made from them in place; back again restores them", () => {
  const before = { theme: { ...theme }, ink: { ...ink }, tone: { ...tone }, inks: { ...INKS }, cursor: rowAppearance(false, false, true) }
  applyTheme("nord")
  expect(theme.canvas).toBe("#21252d")
  expect(tone.good).toBe("#a3be8c")
  expect(ink.note).toBe("#8f99ab")
  expect(INKS.spend).toBe("#b48ead")
  expect(rowAppearance(false, false, true).bg).toBe("#4c566a")
  applyTheme(DEFAULT_THEME)
  expect({ theme: { ...theme }, ink: { ...ink }, tone: { ...tone }, inks: { ...INKS }, cursor: rowAppearance(false, false, true) }).toEqual(before)
})

test("an unknown theme is the default", () => {
  applyTheme("nord")
  applyTheme("no-such-theme")
  expect(themeId).toBe(DEFAULT_THEME)
})

test("every theme fills every slot, and its text reads against its canvas", () => {
  for (const def of THEMES) {
    const p = paletteOf(def)
    for (const [slot, value] of Object.entries(p)) expect({ theme: def.id, slot, value }).toEqual({ theme: def.id, slot, value: expect.stringMatching(/^#[0-9a-f]{6}$/i) })
    const ratio = (fg: string) => Math.round(contrast(fg, p.canvas) * 10) / 10
    // Words: figures and labels clearly; notes still readable.
    expect({ theme: def.id, figure: ratio(p.figure) >= 7, label: ratio(p.subtext0) >= 4.5, note: ratio(p.overlay1) >= 3 }).toEqual({ theme: def.id, figure: true, label: true, note: true })
    // Accents (money in and out, keys, warnings) stand out from the canvas.
    for (const accent of ["green", "red", "pink", "yellow", "lavender", "teal", "peach"] as const) expect({ theme: def.id, accent, ok: ratio(p[accent]) >= 4.5 }).toEqual({ theme: def.id, accent, ok: true })
    // Money in and out never alike.
    expect(p.green).not.toBe(p.red)
  }
})
