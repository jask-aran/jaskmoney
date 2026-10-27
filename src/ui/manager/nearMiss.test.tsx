import { afterEach, expect, test } from "bun:test"
import type { JevClient } from "../../ai/jev"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"
import { RGBA } from "@opentui/core"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined })

test("near misses follow the matches, marked ≈ with their probability and dimmed; matches keep their colours", async () => {
  rendered = await renderApp({ width: 140, height: 30 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const add = (id: number, description: string) =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', date('now', '-1 day'), -5, ?, 100, 'csv')").run(id, description)
  add(1, "Alba Coffee")
  add(2, "Tea House")
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0 })
  const jev: Pick<JevClient, "judge"> = { async judge(questions) {
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "noul" as const, noul: JSON.stringify(q).includes("Coffee") ? 0.9 : 0.5 }]))
  } }
  data.commitFilter("ask:coffee")
  await data.askAbout(jev)
  await rendered.renderOnce(); await rendered.flush()
  const lines = rendered.captureSpans().lines
  const row = (text: string) => lines.find((l) => l.spans.some((s) => s.text.includes(text)))!
  const span = (text: string, inRow: string) => row(inRow).spans.find((s) => s.text.includes(text))!
  const frame = rendered.captureCharFrame()
  // The match first (cursor on it), the near miss after, marked ≈ in the gutter.
  expect(frame.indexOf("Alba Coffee")).toBeLessThan(frame.indexOf("Tea House"))
  expect(row("Tea House").spans.map((s) => s.text).join("")).toMatch(/^│ ?≈/)
  // Probabilities: the match's in green, the near miss's (≈) in amber.
  expect(span("≈50%", "Tea House").fg.toInts()).toEqual(RGBA.fromHex(theme.warning).toInts())
  // The near miss's description is dimmed; the filter bar says Jev reads each row.
  expect(span("Tea House", "Tea House").fg.toInts()).toEqual(RGBA.fromHex(theme.overlay1).toInts())
  expect(frame).toContain("◆ Jev reads each row")
  expect(frame).toContain("1 match, then 1 near (≈)")
})
