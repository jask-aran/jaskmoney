import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { CHART_VIEWS, ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, category, transaction } from "../../testing/fixtures"

afterEach(() => setAppClock(null))

const at = (view: string) => CHART_VIEWS.findIndex((v) => v.view === view)

test("Trends and Merchants follow the Date Range: a solid bar a month in each group's colour; merchants most first, against Before", async () => {
  setAppClock(new Date(2026, 10, 20, 12))
  const t = await renderApp({ width: 200, height: 60 })
  const home = category({ id: 1, name: "Home", color: "#89b4fa" }), fun = category({ id: 2, name: "Fun", color: "#f38ba8" })
  let id = 0
  const spend = (dateISO: string, amount: number, c: typeof home, description: string) =>
    transaction({ id: ++id, accountId: 1, dateISO, amount: -amount, categoryId: c.id, categoryName: c.name, categoryColor: c.color, description })
  data.setState({
    accounts: [account({ id: 1, name: "Spending" })], categories: [home, fun], accountSelection: "all", ready: true, icons: false, budgets: [], suggestions: {}, uiPrefs: {},
    transactions: [
      spend("2026-06-05", 900, home, "LANDLORD"), spend("2026-07-05", 900, home, "LANDLORD"), spend("2026-08-05", 900, home, "LANDLORD"),
      spend("2026-08-12", 300, fun, "CINEMA"), spend("2026-09-05", 900, home, "LANDLORD"), spend("2026-10-05", 900, home, "LANDLORD"), spend("2026-10-09", 60, fun, "CINEMA"),
    ],
  })
  ui.switchTab("overview")
  ui.setState({ focusedSection: "none", customEdit: null, chartViews: [at("Trends"), at("Merchants"), at("Calendar"), at("Cumulative")],
    timeframe: { ...ui.state.timeframe, family: "lookback", lookback: "3M" } })
  await t.renderOnce(); await t.flush(); await t.renderOnce()
  const frame = t.captureCharFrame()
  const spans = t.captureSpans().lines.flatMap((line) => line.spans)
  // 3M back from 20 Nov: August (from the 20th) to November, a row each.
  for (const month of ["Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"]) expect(frame).toContain(month)
  const bars = spans.filter((s) => /^█+$/.test(s.text.trim()) && s.text.includes("█"))
  expect(bars.some((s) => s.fg.toInts().join() === RGBA.fromHex(home.color).toInts().join())).toBe(true)
  expect(bars.some((s) => s.fg.toInts().join() === RGBA.fromHex(fun.color).toInts().join())).toBe(true)
  expect(frame).toMatch(/■ Home\s+■ Fun/)
  // Merchants: the landlord first; the cinema against its August, before the range's comparison window.
  const lines = frame.split("\n")
  const landlord = lines.findIndex((l) => l.includes("LANDLORD")), cinema = lines.findIndex((l) => l.includes("CINEMA") && l.includes("×"))
  expect(landlord).toBeGreaterThan(-1)
  expect(cinema).toBeGreaterThan(landlord)
  expect(frame).toContain("2 merchants")
})
