import { expect, test } from "bun:test"
import { hatchModel, hatchSpans } from "./hatch"
import type { ChartModel } from "./ChartBody"

const model = (rows: string[], ink = "spend"): ChartModel => ({
  rows: rows.map((text) => [{ text, ink }]),
  ticks: new Map(),
  labels: "",
  legend: [{ text: "█ Weeks", fg: "#fff" }],
})
const text = (m: ChartModel) => m.rows.map((runs) => runs.map((r) => r.text).join(""))

test("full blocks hatch; a column's top rounds to a whole cell; a bar under a cell keeps its eighth", () => {
  // Columns: a tall bar topped ▆ (rounds up), one topped ▂ (rounds down),
  // and a bar shorter than a cell (▁, kept).
  const m = hatchModel(model([
    "▆▂ ",
    "██ ",
    "██▁",
  ]))
  expect(text(m)).toEqual(["╱  ", "╱╱ ", "╱╱▁"])
  expect(m.legend[0]!.text).toBe("╱ Weeks")
})

test("a part-filled cell over another ink's block isn't a bar's top", () => {
  const m = hatchModel({ ...model(["▆"]), rows: [[{ text: "▆", ink: "spend" }], [{ text: "█", ink: "income" }]] })
  expect(text(m)).toEqual(["▆", "╱"])
})

test("a model without bars comes back as it was", () => {
  const m = model(["⠁⠂", "  "])
  expect(hatchModel(m)).toBe(m)
})

test("hatchSpans hatches only full blocks", () => {
  expect(hatchSpans([{ text: "███──│", fg: "a" }, { text: "$5 left", fg: "b" }]).map((s) => s.text)).toEqual(["╱╱╱──│", "$5 left"])
})
