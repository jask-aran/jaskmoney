import { expect, test } from "bun:test"
import { modelDetail, modelPickerItems, type ModelEntry } from "./modelPicker"

const entry = (id: string, input = 1, output = 2, context = 128_000): ModelEntry => ({ id, name: id, input, output, context })
const entries = [entry("zeta/one"), entry("acme/fast", 0, 0, 32_000), entry("acme/smart"), entry("meta/default")]
const labels = (items: ReturnType<typeof modelPickerItems>) => items.map((i) => (i.kind === "heading" ? `# ${i.label}` : i.label))

test("recommended (and in use) first, then each maker's models", () => {
  const items = modelPickerItems(entries, { current: "acme/smart", recommended: "meta/default", query: "", maker: "OpenRouter" })
  expect(labels(items)).toEqual(["# Recommended", "meta/default", "acme/smart", "# acme", "acme/fast", "# zeta", "zeta/one"])
  const marks = items.flatMap((i) => (i.kind === "item" ? [i.detail] : []))
  expect(marks[0]).toStartWith("recommended · ")
  expect(marks[1]).toStartWith("in use · ")
})

test("a query keeps the matches, best first; none, nothing", () => {
  expect(labels(modelPickerItems(entries, { current: "meta/default", recommended: "meta/default", query: "acme", maker: "OpenRouter" }))).toEqual(["# Matches", "acme/fast", "acme/smart"])
  expect(modelPickerItems(entries, { current: "meta/default", recommended: "meta/default", query: "qqq", maker: "OpenRouter" })).toEqual([])
})

test("a model's price per million in and out, and its context", () => {
  expect(modelDetail(entry("x", 0.1, 0.2, 1_048_576))).toBe("$0.10 / $0.20 per M · 1049k")
  expect(modelDetail(entry("x", 3, 15, 200_000))).toBe("$3 / $15 per M · 200k")
  expect(modelDetail(entry("x", 0, 0, 2_000_000))).toBe("free · 2000k")
})
