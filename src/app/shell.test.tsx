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
    const dateRangeTitle = t
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("Date Range"))!
    expect(dateRangeTitle.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)

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

  test("manager filter keeps its input in the pane and canonical form in the title", async () => {
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
          amount: -10,
          description: "FILTER TARGET",
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
    data.setFilterLive("amt:-10")
    ui.switchTab("manager")
    ui.openFilter("amt:-10")
    ui.setState({ managerCursor: 0, managerTop: 0 })
    await t.renderOnce()
    await t.flush()

    const frame = t.captureCharFrame()
    expect(frame).toContain("Transactions [amt:=-10] *")
    expect(frame).toContain("/ amt:-10▌  ● ok")
    expect(frame).not.toContain("→ [")
    expect(frame).not.toContain("Transactions (1/1)")

    const spans = t.captureSpans().lines.flatMap((line) => line.spans)
    const title = spans
      .find((span) => span.text.includes("Transactions"))!
    expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    const canonical = spans.find((span) => span.text.includes("[amt:=-10]"))!
    expect(canonical.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    expect(canonical.fg.toInts()).toEqual([137, 180, 250, 255])

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

  test("manager columns share row geometry and fill the transaction viewport", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    data.setState({
      transactions: Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        dateRaw: "03/02/2026",
        dateISO: `2026-02-${String(30 - i).padStart(2, "0")}`,
        amount: -123.45,
        description: `DESCRIPTION ROW ${String(i).padStart(2, "0")}`,
        categoryId: i === 1 ? 11 : 10,
        categoryName: i === 1 ? "Transfers" : "Uncategorised",
        categoryColor: i === 1 ? "#b4befe" : "#7f849c",
        notes: "",
        importId: null,
        accountId: 1,
        accountName: "ANZ CREDIT",
        tagNames: [],
        tagColors: [],
        tagIds: [],
      })),
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
      selectedIds: {},
      rangeSelecting: false,
    })
    await t.renderOnce()
    await t.flush()

    expect(ui.state.managerVisible).toBe(20)
    const lines = t.captureCharFrame().split("\n")
    const header = lines.find(
      (line) => line.includes("Amount") && line.includes("Description"),
    )!
    const first = lines.find((line) => line.includes("DESCRIPTION ROW 00"))!
    expect(header.indexOf("Date")).toBe(first.indexOf("30-02-26"))
    expect(header.indexOf("Amount")).toBe(first.indexOf("-$123.45"))
    expect(header.indexOf("Description")).toBe(first.indexOf("DESCRIPTION ROW 00"))
    expect(first).toContain("DESCRIPTION ROW 00".padEnd(40))
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 19"))).toBe(true)
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 20"))).toBe(false)

    const bottom = lines.find((line) => line.includes("showing 1-20 of 30"))!
    expect(bottom.trimStart()).toStartWith("╰── showing 1-20 of 30")
    expect(bottom.trimEnd()).toEndWith("╯")

    const normalRow = t
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .find((span) => span.text.includes("DESCRIPTION ROW 01"))!
    expect(normalRow.bg.toInts()).toEqual([17, 17, 27, 255])

    const spans = t.captureSpans().lines.flatMap((line) => line.spans)
    const uncategorised = spans.find((span) => span.text.includes("Uncategorised"))!
    const transfers = spans.find((span) => span.text.includes("Transfers"))!
    expect(uncategorised.attributes & TextAttributes.DIM).toBe(TextAttributes.DIM)
    expect(transfers.attributes & TextAttributes.DIM).toBe(0)
    expect(transfers.fg.toInts()).toEqual([180, 190, 254, 255])
    expect(t.captureCharFrame()).toContain("○ Uncategorised")
    expect(t.captureCharFrame()).toContain("● Transfers")

    t.renderer.destroy()
  })

  test("settings taxonomy stays split until the narrow stacked fallback", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    for (const width of [140, 96, 70]) {
      ui.switchTab("settings")
      ui.setState({ settingsActive: false, settingsEditor: null, settingsConfirm: null })
      const t = await testRender(() => <App />, { width, height: 36 })
      await t.renderOnce()
      await t.flush()
      t.mockInput.pressKey("v")
      t.mockInput.pressKey("c")
      await t.renderOnce()
      await t.flush()
      const frame = t.captureCharFrame()
      expect(frame).toContain("Taxonomy")
      expect(frame).toContain("Categories (")
      if (width >= 80) expect(frame).toContain("Tags (")
      expect(frame).toContain("Database & Import")
      const title = t.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Taxonomy"))!
      expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
      t.renderer.destroy()
    }
  })

  test("settings import opens a focused CSV picker", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 110, height: 34 })
    await t.renderOnce()
    await t.flush()
    ui.switchTab("settings")
    ui.activateSettings("database")
    t.mockInput.pressKey("i")
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Import CSV")
    expect(frame).toContain("select")
    const title = t.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Import CSV"))!
    expect(title.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    t.renderer.destroy()
  })

  test("clear-data confirmation names its destructive key", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 110, height: 34 })
    await t.renderOnce()
    await t.flush()
    ui.switchTab("settings")
    ui.activateSettings("database")
    t.mockInput.pressKey("c")
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Clear all transaction and import data?")
    expect(frame).toContain("Press del to confirm")
    expect(frame).toContain("del confirm")
    t.renderer.destroy()
  })
})
