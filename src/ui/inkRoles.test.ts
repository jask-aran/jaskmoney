import { expect, test } from "bun:test"
import { Glob } from "bun"

/**
 * Text colours come from theme.ts's roles (ink) and accents (tone), so
 * what a colour means is decided in one place (2026-10-30). The palette's
 * greys are never used directly; its accents only as data colours.
 */

const sources = [...new Glob("src/**/*.{ts,tsx}").scanSync(".")]
  .filter((f) => !/\.test\.tsx?$/.test(f) && f !== "src/theme.ts" && !f.startsWith("src/testing/"))
const read = (f: string) => Bun.file(f).text()

/** Where a raw accent is a data colour: chart series, the calendar's heat,
 * the colour a new tag or category gets, a tag with none of its own. */
const DATA_COLOURS = new Set([
  "src/ui/overview/periodCharts.ts",
  "src/ui/charts/saverInks.ts",
  "src/ui/manager/ManagerTab.tsx",
  "src/ui/overview/OverviewTab.tsx",
  "src/ui/manager/TransactionTable.tsx",
  "src/app/keys.ts",
  "src/state/tagPicker.ts",
  "src/state/tagChooser.ts",
])

test("no text takes a palette grey directly: ink says which", async () => {
  const greys = /theme\.(text|subtext[01]|overlay[012])\b/
  const offenders: string[] = []
  // Chart series (last period's line, a partial bar) are data colours.
  for (const f of sources.filter((f) => f !== "src/ui/overview/periodCharts.ts")) {
    (await read(f)).split("\n").forEach((line, i) => { if (greys.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`) })
  }
  expect(offenders).toEqual([])
})

test("accents come from tone, except data colours", async () => {
  const accents = /theme\.(rosewater|flamingo|pink|mauve|red|maroon|peach|yellow|green|teal|sky|sapphire|blue|lavender)\b/
  const offenders: string[] = []
  for (const f of sources.filter((f) => !DATA_COLOURS.has(f))) {
    (await read(f)).split("\n").forEach((line, i) => { if (accents.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`) })
  }
  expect(offenders).toEqual([])
})
