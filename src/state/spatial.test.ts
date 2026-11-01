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

test("straight ahead wins over nearer but off to the side", () => {
  expect(nearestRegion(from("ov.chart"), others("ov.chart"), "down")).toBe("ov.chart2")
  expect(nearestRegion(from("ov.chart"), others("ov.chart"), "right")).toBe("ov.accounts")
  expect(nearestRegion(from("ov.chart2"), others("ov.chart2"), "right")).toBe("ov.categories")
})

test("up from the panes reaches the Date Range, then the bar item above it", () => {
  expect(nearestRegion(from("ov.chart"), others("ov.chart"), "up")).toBe("ov.range")
  expect(nearestRegion(from("ov.accounts"), others("ov.accounts"), "up")).toBe("ov.range")
  expect(nearestRegion(from("ov.range"), others("ov.range"), "up")).toBe("bar.overview")
  expect(nearestRegion(from("bar.overview"), others("bar.overview"), "right")).toBe("bar.web")
})

test("nothing that way: the focus stays (no wrap)", () => {
  expect(nearestRegion(from("bar.web"), others("bar.web"), "up")).toBeNull()
  expect(nearestRegion(from("ov.categories"), others("ov.categories"), "right")).toBeNull()
  expect(nearestRegion(from("ov.chart2"), others("ov.chart2"), "down")).toBeNull()
})

test("a region that overlaps the source along the arrow is not 'in that direction'", () => {
  expect(nearestRegion(r(0, 0, 10, 10), [{ id: "a", rect: r(5, 5, 10, 10) }], "down")).toBeNull()
})
