import { afterEach, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined
afterEach(() => { rendered?.renderer.destroy(); rendered = undefined; data.clearFilter() })

test("beside the bar's dot: the full form a forgiven search reads as, what saving would refuse, why it doesn't parse", async () => {
  rendered = await renderApp({ width: 140, height: 30 })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Restaurants & Cafes', '#fff', 90), ('Rates & Insurance', '#fff', 91), ('Car Insurance', '#fff', 92)").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Kfc Southbank', 100, 'csv')").run()
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  const spanOf = async (search: string, text: string) => {
    data.setFilterLive(search)
    await rendered!.renderOnce(); await rendered!.flush()
    const spans = rendered!.captureSpans().lines.flatMap((l) => l.spans)
    const span = spans.find((s) => s.text.includes(text))
    expect({ search, found: !!span }).toEqual({ search, found: true })
    return { fg: span!.fg.toInts(), dot: /^●\s*(ok|check|parse)/.exec(spans.find((s) => s.text.trim().startsWith("●"))!.text.trim())![1] }
  }
  expect(await spanOf("cat:restaurants or kfc", '→ cat:"Restaurants & Cafes" OR kfc')).toEqual({ fg: RGBA.fromHex(theme.overlay1).toInts(), dot: "ok" })
  expect(await spanOf("cat:insurance", "could be Rates & Insurance or Car Insurance: finding either")).toEqual({ fg: RGBA.fromHex(theme.warning).toInts(), dot: "check" })
  expect(await spanOf('desc:"open', "searching it as one phrase")).toEqual({ fg: RGBA.fromHex(theme.error).toInts(), dot: "parse" })
})
