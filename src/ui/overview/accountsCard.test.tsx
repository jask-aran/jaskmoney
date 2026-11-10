import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, transaction } from "../../testing/fixtures"

afterEach(() => setAppClock(null))

async function accounts(height: number, savers: boolean) {
  setAppClock(new Date(2026, 9, 20, 12))
  const t = await renderApp({ width: 160, height })
  await t.renderOnce()
  data.setState({
    accounts: [account({ balance: 1149.56 }), ...(savers ? [account({ id: 2, name: "Holiday", externalKind: "SAVER", balance: 3400 }), account({ id: 3, name: "Emergency", externalKind: "SAVER", balance: 5000 })] : [])],
    transactions: [
      transaction({ id: 1, dateISO: "2026-10-10", amount: -40 }),
      transaction({ id: 2, dateISO: "2026-10-20", amount: -84.44, status: "HELD" }),
      transaction({ id: 3, dateISO: "2026-10-20", amount: -12.5, status: "HELD" }),
    ],
    suggestions: {}, budgets: [], accountSelection: "all", ready: true, icons: false, uiPrefs: {},
  })
  ui.switchTab("overview")
  ui.setState({ focusedSection: "none", chartViews: [0, 4, 7, 8], customEdit: null })
  await t.renderOnce()
  await t.flush()
  const frame = t.captureCharFrame().split("\n")
  const from = frame.find((l) => l.includes("╭─ Accounts"))!.indexOf("╭─ Accounts")
  const lines = frame.map((l) => l.slice(from))
  const top = lines.findIndex((l) => l.includes("Accounts"))
  const bottom = lines.findIndex((l, i) => i > top && l.startsWith("╰"))
  const rows = lines.slice(top + 1, bottom).map((l) => l.slice(2, -2).trimEnd())
  return { rows }
}

test("Accounts: a ledger, available first, the balance with what's pending, then each saver with its 30 days' change, their total and the net position", async () => {
  const { rows } = await accounts(45, true)
  expect(rows[0]).toMatch(/Available\s+\$1,149\.56$/)
  expect(rows[1]).toMatch(/Balance\s+\$97 pending · 2\s+\$1,246\.50$/)
  expect(rows[2]).toBe("")
  expect(rows[3]).toMatch(/Savers\s+30 days$/)
  expect(rows[4]).toMatch(/Holiday\s+\$0\s+\$3,400$/)
  expect(rows[6]).toMatch(/Total\s+\$0\s+\$8,400$/)
  expect(rows[7]).toBe("")
  expect(rows.at(-1)).toMatch(/Net position\s+[+-]?\$[\d,]+\s+\$9,549\.56$/)
  const column = (r: string) => r.search(/\S+\s+\S+$/) + r.match(/(\S+)\s+\S+$/)![1]!.length
  expect(new Set([rows[4]!, rows[6]!, rows.at(-1)!].map(column)).size).toBe(1)
})
