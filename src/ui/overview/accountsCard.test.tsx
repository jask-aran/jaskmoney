import { afterEach, expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { setAppClock } from "../../domain/days"
import { ink } from "../../theme"
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
  ui.setState({ focusedSection: "none", chartViews: [0, 4], customEdit: null })
  await t.renderOnce()
  await t.flush()
  const lines = t.captureCharFrame().split("\n").map((l) => l.slice(160 - 48))
  const top = lines.findIndex((l) => l.includes("Accounts"))
  const bottom = lines.findIndex((l, i) => i > top && l.startsWith("╰"))
  const rows = lines.slice(top + 1, bottom).map((l) => l.slice(2, -2).trimEnd())
  const span = (text: string) => t.captureSpans().lines.flatMap((l) => l.spans).find((s) => s.text.includes(text))!
  return { rows, span }
}

test("Accounts: available first, the balance with what's pending, then each saver, their subtotal and the net position", async () => {
  const { rows, span } = await accounts(45, true)
  expect(rows.map((r) => r.split(/\s{2,}/))).toEqual([
    ["Available", "$1,149.56"],
    // Balance less pending is available: $1,246.50 − $96.94.
    ["Balance", "$1,246.50 $97 · 2 txn"],
    ["Runway", expect.any(String), expect.any(String)],
    ["30 day change", expect.any(String)],
    ["Savers", "30 days"],
    ["", "Holiday", "$3,400", "$0"],
    ["", "Emergency", "$5,000", "$0"],
    ["", "Total", "$8,400", "$0"],
    ["Net position", "$9,549.56"],
  ])
  // Available and net position stand out; the balance doesn't.
  expect(span("Available").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  expect(span("Net position").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  expect(span("Balance").attributes & TextAttributes.BOLD).toBe(0)
  // White for the figures the card is about, the softened title pink for
  // the Savers subheading, label grey for the balance under Available.
  const ints = (hex: string) => RGBA.fromHex(hex).toInts()
  expect(span("$1,149.56").fg.toInts()).toEqual(ints(ink.strong))
  expect(span("$9,549.56").fg.toInts()).toEqual(ints(ink.strong))
  expect(span("Savers").fg.toInts()).toEqual(ints(ink.heading))
  expect(span("$1,246.50").fg.toInts()).toEqual(ints(ink.label))
  // Each saver's balance in grey, their total in white.
  expect(span("$3,400").fg.toInts()).toEqual(ints(ink.label))
  expect(span("$8,400").fg.toInts()).toEqual(ints(ink.figure))
  // The headline rows' labels are as bright as figures.
  expect(span("Available").fg.toInts()).toEqual(ints(ink.figure))
  expect(span("Net position").fg.toInts()).toEqual(ints(ink.figure))
})

test("Accounts: short of rows, savers fold to their subtotal; with no savers, no savers or net position", async () => {
  expect((await accounts(30, true)).rows.slice(4).map((r) => r.split(/\s{2,}/))).toEqual([["Savers", "$8,400", "$0"], ["Net position", "$9,549.56"]])
  const none = (await accounts(45, false)).rows
  expect(none).toHaveLength(4)
  expect(none.join("\n")).not.toMatch(/Savers|Net position/)
})
