import { expect, test } from "bun:test"
import { modelPickerItems, type ModelEntry } from "./modelPicker"

const entry = (id: string, input = 1, output = 2, context = 128_000): ModelEntry => ({ id, name: id, input, output, context })
const entries = [entry("zeta/one"), entry("acme/fast", 0, 0, 32_000), entry("acme/smart"), entry("meta/default")]
const labels = (items: ReturnType<typeof modelPickerItems>) => items.map((i) => (i.kind === "heading" ? `# ${i.label}` : i.label))

test("recommended (and in use) first, then each maker's models", () => {
  const items = modelPickerItems(entries, { current: "acme/smart", recommended: "meta/default", query: "", maker: "OpenRouter" })
  expect(labels(items)).toEqual(["# Recommended", "meta/default", "acme/smart", "# acme", "acme/fast", "# zeta", "zeta/one"])
  const marks = items.flatMap((i) => (i.kind === "item" ? [i.detail] : []))
  expect(marks[0]).toContain("recommended")
  expect(marks[1]).toContain("in use")
})

test("a query keeps the matches, best first; none, nothing", () => {
  expect(labels(modelPickerItems(entries, { current: "meta/default", recommended: "meta/default", query: "acme", maker: "OpenRouter" }))).toEqual(["# Matches", "acme/fast", "acme/smart"])
  expect(modelPickerItems(entries, { current: "meta/default", recommended: "meta/default", query: "qqq", maker: "OpenRouter" })).toEqual([])
})
