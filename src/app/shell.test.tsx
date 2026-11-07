import { describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { account } from "../testing/fixtures"

describe("shell render M0", () => {
  test("the accounts pane stacks each bank and highlights the selection only while focused", async () => {
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    data.setState({
      accounts: [
        account({ id: 1, name: "Spending", balance: 1104.36 }),
        account({ id: 2, name: "🏖️ Holiday", externalKind: "SAVER", balance: 3400 }),
        account({ id: 3, name: "General", externalKind: "SAVER", balance: 5548.01 }),
        account({ id: 4, name: "Bills", source: "csv", externalKind: null, balance: 10 }),
      ],
      transactions: [], accountSelection: 1, ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions" })
    await t.renderOnce()
    await t.flush()
    const frame = t.captureCharFrame()
    // A net position for all accounts and one per bank; both savers are one
    // row with their combined balance.
    expect(frame).toContain("$10,052.37")
    expect(frame).toContain("$8,948.01")
    expect(frame).not.toContain("Holiday")
    // The last match: the header's status names the selection too. A name
    // shares its run with the account's mark when they're one colour.
    const span = (text: string) => t.captureSpans().lines.flatMap((line) => line.spans).findLast((s) => s.text === text || s.text.endsWith(` ${text}`))!
    expect(span("Spending").attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    expect(span("Bills").attributes & TextAttributes.BOLD).toBe(0)
    // Unfocused, the selected row sits on the canvas like the others.
    expect(span("Spending").bg.toInts()).toEqual(span("Bills").bg.toInts())

    ui.setState({ focusedSection: "mgr.accounts" })
    await t.renderOnce()
    await t.flush()
    expect(span("Spending").bg.toInts()).not.toEqual(span("Bills").bg.toInts())
    expect(span("$1,104.36").bg.toInts()).toEqual(span("Spending").bg.toInts())
    t.renderer.destroy()
  })

})
