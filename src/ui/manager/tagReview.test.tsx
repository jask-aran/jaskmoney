import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import type { JevClient } from "../../ai/jev"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; data.closeTagReview() })

test("a tag review shows each candidate's proposed tag in the Tags column, its confidence coloured like a suggestion's", async () => {
  rendered = await renderApp({ width: 140, height: 30 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Hilltop Coffee', 100, 'csv'), (2, 'x', '2026-10-02', -9, 'Cafe Maybe', 100, 'csv')").run()
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0 })
  const jev: Pick<JevClient, "judge"> = { async judge(qs) {
    return Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, { type: "noul" as const, noul: JSON.stringify(q).includes("Hilltop") ? 0.9 : 0.6 }]))
  } }
  await data.openTagReview({ tagId: null, name: "coffee", scope: null }, jev)
  await rendered.renderOnce(); await rendered.flush()
  const frame = rendered.captureCharFrame()
  expect(frame).toContain("Transactions · tagging COFFEE")
  expect(frame).toContain("2 to review for COFFEE, 1 ≥80%")
  const spans = rendered.captureSpans().lines.flatMap((l) => l.spans)
  const pct = (text: string) => spans.find((s) => s.text.trim() === text)!.fg.toInts()
  // Sure enough for Y: green; between: amber. The tag itself in the new tag's colour.
  expect(pct("90%")).toEqual(RGBA.fromHex(theme.success).toInts())
  expect(pct("60%")).toEqual(RGBA.fromHex(theme.warning).toInts())
  expect(spans.find((s) => s.text === "+COFFEE")!.fg.toInts()).toEqual(RGBA.fromHex(theme.teal).toInts())
})
