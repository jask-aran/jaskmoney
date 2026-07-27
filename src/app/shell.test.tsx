import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { App } from "./App"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"

describe("shell render M0", () => {
  test("renders header tabs status footer", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    ui.switchTab("dashboard")

    const t = await testRender(() => <App />, { width: 140, height: 44 })
    await t.renderOnce()
    await t.flush()
    const frame = t.captureCharFrame()

    expect(frame).toContain("Jaskmoney")
    expect(frame).toContain("Dashboard")
    expect(frame).toContain("Manager")
    expect(frame).toContain("Settings")
    expect(frame).toContain("Date Range")
    expect(frame).toContain("Overview")
    expect(frame).toMatch(/status|shell|bootstrap|Tab:|jump|v /i)

    // jump
    t.mockInput.pressKey("v")
    await t.renderOnce()
    const jump = t.captureCharFrame()
    expect(jump.toLowerCase()).toContain("jump")

    t.mockInput.pressKey("d")
    await t.renderOnce()
    expect(ui.state.focusedSection).toBe("dash.date")

    // tab to manager
    t.mockInput.pressKey("2")
    await t.renderOnce()
    const mgr = t.captureCharFrame()
    expect(mgr).toContain("Accounts")
    expect(mgr).toContain("Transactions")
    expect(ui.state.activeTab).toBe("manager")

    t.renderer.destroy()
  })

  test("only the current transaction row carries the bold attribute", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    data.setState({
      transactions: [
        {
          id: 1,
          dateRaw: "03/02/2026",
          dateISO: "2026-02-03",
          amount: -20,
          description: "CURSOR FIRST",
          categoryId: 10,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "ANZ CREDIT",
          tagNames: [],
          tagColors: [],
          tagIds: [],
        },
        {
          id: 2,
          dateRaw: "02/02/2026",
          dateISO: "2026-02-02",
          amount: -10,
          description: "CURSOR SECOND",
          categoryId: 10,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "ANZ CREDIT",
          tagNames: [],
          tagColors: [],
          tagIds: [],
        },
      ],
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true },
      ],
      accountScope: { 1: true },
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
      sortColumn: "date",
      sortAscending: false,
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      managerCursor: 0,
      managerTop: 0,
      filterMode: false,
    })
    await t.renderOnce()
    await t.flush()

    const isBold = (needle: string) => {
      const line = t
        .captureSpans()
        .lines.find((row) => row.spans.some((span) => span.text.includes(needle)))
      expect(line).toBeDefined()
      return line!.spans.some(
        (span) => (span.attributes & TextAttributes.BOLD) !== 0,
      )
    }
    expect(isBold("CURSOR FIRST")).toBe(true)
    expect(isBold("CURSOR SECOND")).toBe(false)

    t.mockInput.pressKey("j")
    await t.renderOnce()
    await t.flush()
    expect(isBold("CURSOR FIRST")).toBe(false)
    expect(isBold("CURSOR SECOND")).toBe(true)

    t.renderer.destroy()
  })
})
