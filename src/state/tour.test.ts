import { expect, test } from "bun:test"
import { footerHints } from "../app/keys"
import { CHART_VIEWS } from "./uiStore"
import { DEFAULT_CATEGORIES } from "../db/schema"
import { DEMOS, askAt, chartViewAt, demoFilter, demoWorld, filterAt, suggestAt, tourTopics, triable, tryFrom, tryHints, tryKey, tryRows, waiting, type TryKey } from "./tour"

const categories = DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, name: c.name, color: c.color ?? "#cccccc", sortOrder: i, parentId: null, income: false, notSpending: false }) as never)
const world = demoWorld(categories)
const t = tourTopics(world)
const at = (id: string) => DEMOS.findIndex((d) => d.id === id)
const k = (name: string, sequence = name.length === 1 ? name : "", shift = false): TryKey => ({ name, sequence, ctrl: false, meta: false, shift })

test("trying freezes each demo exactly where its script had got to; Smart search can't be tried", () => {
  for (const ms of [0, 1500, 3100, 5300, 7000, 12500]) {
    expect(tryFrom(at("filter"), ms, world).filter.value).toBe(filterAt(ms, t))
    expect(tryFrom(at("suggest"), ms, world)).toEqual(suggestAt(ms, world).state)
    expect(tryFrom(at("chart"), ms, world).view).toBe(chartViewAt(ms))
  }
  expect(triable(at("ask"))).toBe(false)
  expect([at("filter"), at("suggest"), at("chart")].every(triable)).toBe(true)
})

test("the suggestions script: Y takes every sure one, then the order's detail opens and closes, then quick keys", () => {
  const w = waiting(world)
  expect(w.rows.length).toBeGreaterThanOrEqual(20)
  const sure = w.rows.filter((r) => w.suggestions[r.id]!.confidence >= 0.8).map((r) => r.id)
  expect(suggestAt(1200, world).state.accepted).toEqual(sure)
  expect(suggestAt(1150, world).pressed).toBe("Y")
  // The vitamins order is under 80%: still waiting, its detail opened by enter.
  const vitamins = w.rows.find((r) => r.bought?.some((b) => b.name.startsWith("Vitamin")))!
  expect(sure).not.toContain(vitamins.id)
  expect(suggestAt(4000, world).state.detail).toBe(vitamins.id)
  expect(suggestAt(2950, world).pressed).toBe("enter")
  expect(suggestAt(5200, world).state.detail).toBeNull()
  const end = suggestAt(9000, world).state
  expect(end.accepted.length).toBeGreaterThan(sure.length + 4)
  expect(end.dismissed.length).toBe(2)
})

test("the demo filters as the store does: a bare word finds a category", () => {
  const transfers = demoFilter(world, "transfer").rows
  expect(transfers.length).toBeGreaterThan(0)
  expect(transfers.some((r) => r.categoryName === "Transfers" && !/transfer/i.test(r.description))).toBe(true)
  // Smart search's answer is a filter that keeps rows too.
  const asked = askAt(3000, t)
  expect(asked.question).not.toBeNull()
  expect(demoFilter(world, asked.raw).rows.length).toBeGreaterThan(0)
})

test("trying: the filter is yours to edit, through the real filter engine", () => {
  let s = tryFrom(at("filter"), 0, world)
  for (const ch of "amt:<-100") s = tryKey(at("filter"), s, k(ch), world)!
  const rows = tryRows(at("filter"), s, world)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((r) => r.amount < -100)).toBe(true)
  s = tryKey(at("filter"), s, k("down"), world)!
  expect(s.cursor).toBe(1)
  // Typing starts the rows from the top again.
  expect(tryKey(at("filter"), s, k("0"), world)!.cursor).toBe(0)
})

test("trying suggestions: y accepts, x dismisses, Y accepts the sure ones; the chart's views with h/l", () => {
  const demo = at("suggest")
  let s = tryFrom(demo, 0, world)
  const w = waiting(world)
  s = tryKey(demo, s, k("y"), world)!
  expect(s.accepted).toEqual([w.rows[0]!.id])
  s = tryKey(demo, s, k("x"), world)!
  expect(s.dismissed).toEqual([w.rows[1]!.id])
  s = tryKey(demo, s, k("y", "Y", true), world)!
  const sure = w.rows.filter((r) => r.id !== w.rows[1]!.id && w.suggestions[r.id]!.confidence >= 0.8).map((r) => r.id)
  expect(new Set(s.accepted)).toEqual(new Set(sure))
  expect(tryRows(demo, s, world).some((r) => r.id === w.rows[1]!.id)).toBe(true)
  const chart = at("chart")
  const c = tryFrom(chart, 0, world)
  expect(tryKey(chart, c, k("l"), world)!.view).toBe(1)
  expect(tryKey(chart, c, k("h"), world)!.view).toBe(CHART_VIEWS.length - 1)
})

// The tour's keys are its own (the app's change your data), so they're
// checked against the app's: change a key there and this fails until the
// tour follows.
test("the tour's keys are the app's keys", () => {
  const appKeys = (hints: Array<{ key: string; desc: string }>) => new Map(hints.map((h) => [h.key, h.desc]))
  const uncategorised = appKeys(footerHints("manager.txns", { uncategorisedOnly: true } as never))
  for (const h of tryHints(at("suggest")).filter((h) => h.key !== "j/k")) expect(uncategorised.get(h.key)).toBe(h.desc)
  // The Overview's charts switch view with h/l there too.
  expect(appKeys(footerHints("overview", { chartViews: [0, 3] } as never)).get("h/l")).toBe("chart")
  expect(tryHints(at("chart")).map((h) => h.key)).toEqual(["h/l"])
})
