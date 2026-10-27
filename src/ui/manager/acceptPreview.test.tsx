import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { saveSuggestions } from "../../db/client"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; data.setUncategorisedOnly(false) })

test("accept-all's preview names the rows going to each category (money in marked), muted under the category", async () => {
  rendered = await renderApp({ width: 140, height: 34 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#ffffff')").run()
  const add = (id: number, description: string, amount: number) =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', '2026-10-01', ?, ?, 100, 'csv')").run(id, amount, description)
  add(1, "Coles", -10); add(2, "Coles", -12); add(3, "Coles refund", 4); add(4, "Unsure", -5)
  saveSuggestions(db, [
    ...[1, 2, 3].map((id) => ({ transactionId: id, categoryId: 100, confidence: 0.9, source: "jev" as const })),
    { transactionId: 4, categoryId: 100, confidence: 0.5, source: "jev" as const },
  ])
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  data.setUncategorisedOnly(true)
  ui.setState({ focusedSection: "mgr.transactions", acceptPreview: [1, 2, 3] })
  await rendered.renderOnce(); await rendered.flush()
  const frame = rendered.captureCharFrame()
  expect(frame).toContain("Accept suggestions · 3 at 80% or more")
  expect(frame).toMatch(/Test food\s+3/)
  expect(frame).toContain("Coles ×2, Coles refund (in)")
  // The 50% row stays out of the preview (it shows in the table behind).
  expect(frame.split("\n").find((l) => l.includes("Coles ×2"))).not.toContain("Unsure")
  const span = rendered.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.includes("Coles ×2"))!
  expect(span.fg.toInts()).toEqual(RGBA.fromHex(theme.overlay1).toInts())
})
