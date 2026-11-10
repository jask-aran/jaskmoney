import { expect, test } from "bun:test"
import { Glob } from "bun"

const sources = [...new Glob("src/**/*.{ts,tsx}").scanSync(".")]
  .filter((f) => !/\.test\.tsx?$/.test(f) && f !== "src/theme.ts" && !f.startsWith("src/testing/"))
const read = (f: string) => Bun.file(f).text()

const DATA_COLOURS = new Set([
  "src/ui/overview/periodCharts.ts",
  "src/ui/charts/inks.ts",
  "src/ui/charts/saverInks.ts",
  "src/ui/overview/CalendarView.tsx",
  "src/ui/manager/managerModel.ts",
  "src/ui/manager/TransactionTable.tsx",
  "src/app/keys/pickers.ts",
  "src/state/tagPicker.ts",
  "src/state/tagChooser.ts",
])

test("no text takes a palette grey directly: ink says which", async () => {
  const greys = /theme\.(text|subtext[01]|overlay[012])\b/
  const offenders: string[] = []
  for (const f of sources.filter((f) => f !== "src/ui/charts/inks.ts")) {
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
