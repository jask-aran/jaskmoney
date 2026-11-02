import { expect, test } from "bun:test"
import { nearestRegion, type Rect } from "./spatial"

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })

// The Overview at 160 columns: the bar's items, the Date Range, two charts
// on the left, Accounts and Categories on the right.
const map = [
  { id: "bar.overview", rect: r(12, 0, 10, 1) },
  { id: "bar.web", rect: r(130, 0, 12, 1) },
  { id: "ov.range", rect: r(0, 2, 132, 3) },
  { id: "ov.chart", rect: r(0, 5, 100, 21) },
  { id: "ov.chart2", rect: r(0, 26, 100, 20) },
  { id: "ov.accounts", rect: r(100, 5, 60, 10) },
  { id: "ov.categories", rect: r(100, 27, 60, 19) },
]
const from = (id: string) => map.find((m) => m.id === id)!.rect
const others = (id: string) => map.filter((m) => m.id !== id)

test("straight ahead wins over nearer but off to the side; up climbs to the range then the bar; nothing that way stays (no wrap)", () => {
  const cases: Array<[string, "up" | "down" | "left" | "right", string | null]> = [
    ["ov.chart", "down", "ov.chart2"], ["ov.chart", "right", "ov.accounts"], ["ov.chart2", "right", "ov.categories"],
    ["ov.chart", "up", "ov.range"], ["ov.accounts", "up", "ov.range"], ["ov.range", "up", "bar.overview"], ["bar.overview", "right", "bar.web"],
    ["bar.web", "up", null], ["ov.categories", "right", null], ["ov.chart2", "down", null],
  ]
  for (const [id, dir, want] of cases) expect([id, dir, nearestRegion(from(id), others(id), dir)]).toEqual([id, dir, want])
})

test("a region that overlaps the source along the arrow is not 'in that direction'", () => {
  expect(nearestRegion(r(0, 0, 10, 10), [{ id: "a", rect: r(5, 5, 10, 10) }], "down")).toBeNull()
})
