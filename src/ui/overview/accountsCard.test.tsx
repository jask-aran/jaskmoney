import { afterEach, expect, test } from "bun:test"
import { setAppClock } from "../../domain/days"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { account, transaction } from "../../testing/fixtures"

afterEach(() => setAppClock(null))

/** The Accounts card's rows (inside its border), and the frame's spans. */
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

test("Accounts: available first, the balance with what's pending, then each saver, their subtotal and the net position", async () => {
  const { rows } = await accounts(45, true)
  const text = rows.join("\n")
  // Balance less pending is available: $1,246.50 − $96.94, 2 held.
  expect(rows[0]).toMatch(/Available.*\$1,149\.56/)
  expect(rows[1]).toMatch(/Balance.*\$1,246\.50.*2 txn/)
  expect(text).toMatch(/Total.*\$8,400/)
  expect(rows.at(-1)).toMatch(/Net position.*\$9,549\.56/)
})

test("Accounts: short of rows, savers fold to their subtotal; with no savers, no savers or net position", async () => {
  expect((await accounts(30, true)).rows.slice(4).map((r) => r.split(/\s{2,}/))).toEqual([["Savers", "$8,400", "$0"], ["Net position", "$9,549.56"]])
  const none = (await accounts(45, false)).rows
  expect(none).toHaveLength(4)
  expect(none.join("\n")).not.toMatch(/Savers|Net position/)
})
