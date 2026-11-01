import { expect, test } from "bun:test"
import { footerHints } from "../app/keys"
import { DEFAULT_CATEGORIES } from "../db/schema"
import { DEMOS, acceptedAt, askAt, chartViewAt, demoWorld, filterAt, tourTopics, tryFrom, tryHints, tryKey, tryRows, waiting, type TryKey } from "./tour"

const categories = DEFAULT_CATEGORIES.map((c, i) => ({ id: i + 1, name: c.name, color: c.color ?? "#cccccc", sortOrder: i, parentId: null, income: false, notSpending: false }) as never)
const world = demoWorld(categories)
const t = tourTopics(world)
const at = (id: string) => DEMOS.findIndex((d) => d.id === id)
const k = (name: string, sequence = name.length === 1 ? name : "", shift = false): TryKey => ({ name, sequence, ctrl: false, meta: false, shift })

test("trying freezes each demo exactly where its script had got to", () => {
  for (const ms of [0, 1500, 3100, 7000, 12500]) {
    expect(tryFrom(at("filter"), ms, world).filter.value).toBe(filterAt(ms, t))
    const w = waiting(world)
    expect(tryFrom(at("suggest"), ms, world).accepted).toEqual(w.rows.slice(0, acceptedAt(ms, w.rows.length)).map((r) => r.id))
    expect(tryFrom(at("chart"), ms, world).view).toBe(chartViewAt(ms))
  }
  // Smart search answered: as it stands. Stopped mid-question: on to its answer.
  const answered = 600 + 40 * 85 + 3000
  expect(askAt(answered, t).filter).not.toBeNull()
  expect(tryFrom(at("ask"), answered, world).filter.value).toBe(askAt(answered, t).filter!)
  expect(tryFrom(at("ask"), 1000, world).filter.value).toBe(`cat:"${t.category}" date:${t.lastMonth}`)
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
  expect(tryKey(chart, c, k("h"), world)!.view).toBe(4)
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
