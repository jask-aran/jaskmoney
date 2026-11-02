import { afterEach, expect, test } from "bun:test"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; data.clearFilter() })

test("the filter bar's dot says whether a search reads cleanly, needs a check, or doesn't parse", async () => {
  rendered = await renderApp({ width: 140, height: 30 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Restaurants & Cafes', '#fff', 90), ('Rates & Insurance', '#fff', 91), ('Car Insurance', '#fff', 92)").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Kfc Southbank', 100, 'csv')").run()
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  const dot = async (search: string) => {
    data.setFilterLive(search)
    await rendered!.renderOnce(); await rendered!.flush()
    const mark = rendered!.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.trim().startsWith("●"))!
    return /^●\s*(ok|check|parse)/.exec(mark.text.trim())![1]
  }
  // Forgiven and read in full; ambiguous, which saving would refuse; unparsed.
  expect(await dot("cat:restaurants or kfc")).toBe("ok")
  expect(await dot("cat:insurance")).toBe("check")
  expect(await dot('desc:"open')).toBe("parse")
})
