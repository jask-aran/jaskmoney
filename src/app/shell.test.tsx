import { afterEach, describe, expect, test } from "bun:test"
import { testRender as openTestRender } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { App } from "./App"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"


// A test that fails before its own destroy() would leave the App mounted on
// the shared stores, and the next file's store writes then drive its effects
// into a loop. Destroy every renderer after each test regardless.
let live: Array<{ renderer: { destroy(): void } }> = []
const testRender: typeof openTestRender = async (...args) => {
  const instance = await openTestRender(...args)
  live.push(instance)
  return instance
}
afterEach(() => {
  for (const instance of live) try { instance.renderer.destroy() } catch { /* already destroyed */ }
  live = []
})

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
    expect(frame).toContain("Now")
    expect(frame).toContain("Savers")
    expect(frame).toContain("This Cycle")
    expect(frame).not.toContain("Date Range")
    expect(frame).toMatch(/status|shell|bootstrap|Tab:|jump|v /i)

    // The Spending tab holds everything over the Date Range.
    t.mockInput.pressKey("2")
    await t.renderOnce()
    const spending = t.captureCharFrame()
    expect(spending).toContain("Date Range")
    expect(spending).toContain("Spending Tracker")
    expect(spending).toContain("Balances")
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
    expect(ui.state.focusedSection).toBe("spend.date")

    // tab to manager
    t.mockInput.pressKey("3")
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
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
        },
      ],
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true, source: "csv" as const, externalKind: null, balance: null, syncEnabled: true },
      ],
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
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
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
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
        },
      ],
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true, source: "csv" as const, externalKind: null, balance: null, syncEnabled: true },
      ],
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
      // Only the table's spans: the sidebar shares the screen line.
      const start = line!.spans.findIndex((span) => span.text.includes(needle))
      return line!.spans.slice(start - 3, start + 1).some(
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

  test("emoji account names keep table columns aligned", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()
    const row = (id: number, accountId: number, accountName: string) => ({
      id, dateRaw: "x", dateISO: "2026-10-01", amount: -1, description: `ROW ${id}`,
      categoryId: 10, categoryName: "Uncategorised", categoryColor: "#7f849c", notes: "",
      importId: null, accountId, accountName, tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status: "SETTLED" as const, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      // "🏖️" is three UTF-16 units but two terminal cells.
      transactions: [row(1, 1, "Spending"), row(2, 2, "🏖️ Holiday"), row(3, 3, "🚨 Emergency fund")],
      accounts: [1, 2, 3].map((id) => ({ id, name: `a${id}`, type: "debit" as const, sortOrder: id, isActive: true, source: "up" as const, externalKind: "TRANSACTIONAL", balance: 0, syncEnabled: true })), filterQuery: "", filterExpr: null, filterErr: "",
      sortColumn: "date", sortAscending: false, ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, filterMode: false })
    await t.renderOnce()
    await t.flush()
    // Table rows only (they carry the category marker); the sidebar's top
    // outflows list repeats the descriptions.
    const lines = t.captureCharFrame().split("\n").filter((line) => /ROW [123]/.test(line) && line.includes("○"))
    expect(lines).toHaveLength(3)
    const column = (line: string, needle: string) => Bun.stringWidth(line.slice(0, line.indexOf(needle)))
    // The category column starts at the same cell on every row.
    expect(new Set(lines.map((line) => column(line, "○"))).size).toBe(1)
    expect(lines.some((line) => line.includes("🚨 Emergenc…"))).toBe(true)
    t.renderer.destroy()
  })

  test("row states paint independent range, selection and cursor appearances", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    const row = (id: number, description: string, status: "HELD" | "SETTLED" | null) => ({
      id, dateRaw: "x", dateISO: `2026-02-0${4 - id}`, amount: -id, description,
      categoryId: 10, categoryName: "Uncategorised", categoryColor: "#7f849c", notes: "",
      importId: null, accountId: 1, accountName: "UP SPENDING", tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      transactions: [row(1, "RANGE ONLY", "SETTLED"), row(2, "RANGE SELECTED", "SETTLED"), row(3, "RANGE CURSOR", "HELD")],
      accounts: [{ id: 1, name: "UP SPENDING", type: "debit", sortOrder: 1, isActive: true, source: "up" as const, externalKind: "TRANSACTIONAL", balance: 10, syncEnabled: true }], filterQuery: "", filterExpr: null, filterErr: "",
      sortColumn: "date", sortAscending: false, ready: true,
    })
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions", managerCursor: 2, managerTop: 0, filterMode: false,
      selectedIds: { 2: true }, rangeSelecting: true, rangeAnchorId: 1, rangeCursorId: 3,
    })
    await t.renderOnce()
    await t.flush()

    const span = (needle: string) =>
      t.captureSpans().lines.flatMap((line) => line.spans).find((s) => s.text.includes(needle))!
    // Range: base (visible on the crust canvas); range + selection: surface1.
    expect(span("RANGE ONLY").bg.toInts()).toEqual([30, 30, 46, 255])
    expect(span("RANGE SELECTED").bg.toInts()).toEqual([69, 71, 90, 255])
    // Cursor inside the range: sapphire bar with crust text, bold; held rows are italic.
    const cursor = span("RANGE CURSOR")
    expect(cursor.bg.toInts()).toEqual([116, 199, 236, 255])
    expect(cursor.fg.toInts()).toEqual([17, 17, 27, 255])
    expect(cursor.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    expect(cursor.attributes & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
    expect(span("RANGE ONLY").attributes & TextAttributes.ITALIC).toBe(0)

    ui.setState({ selectedIds: {}, rangeSelecting: false, rangeAnchorId: 0, rangeCursorId: 0 })
    await t.renderOnce()
    await t.flush()
    // Plain cursor keeps column colours on surface2.
    expect(span("RANGE CURSOR").bg.toInts()).toEqual([88, 91, 112, 255])
    expect(span("RANGE CURSOR").fg.toInts()).toEqual([230, 230, 230, 255])
    expect(span("RANGE ONLY").bg.toInts()).toEqual([17, 17, 27, 255])

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
        tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
      })),
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true, source: "csv" as const, externalKind: null, balance: null, syncEnabled: true },
      ],
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

    // 30 rows − app chrome (4) − card borders (2) − table header (1).
    expect(ui.state.managerVisible).toBe(23)
    const lines = t.captureCharFrame().split("\n")
    const header = lines.find(
      (line) => line.includes("Amount") && line.includes("Description"),
    )!
    const first = lines.find((line) => line.includes("DESCRIPTION ROW 00"))!
    expect(header.indexOf("Date")).toBe(first.indexOf("30-02-26"))
    expect(header.indexOf("Amount")).toBe(first.indexOf("-$123.45"))
    expect(header.indexOf("Description")).toBe(first.indexOf("DESCRIPTION ROW 00"))
    expect(first).toContain("DESCRIPTION ROW 00".padEnd(40))
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 22"))).toBe(true)
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 23"))).toBe(false)

    const bottom = lines.find((line) => line.includes("showing 1-23 of 30"))!
    expect(bottom).toContain("╰── showing 1-23 of 30")
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

describe("render errors", () => {
  test("a tab that throws shows an error card, and switching tabs recovers", async () => {
    process.env.JASKMONEY_DB = ":memory:"
    process.env.JASKMONEY_NO_BOOTSTRAP = "1"
    const t = await testRender(() => <App />, { width: 120, height: 30 })
    await t.renderOnce()
    const original = data.scopedTransactions
    try {
      ;(data as { scopedTransactions: () => unknown }).scopedTransactions = () => { throw new Error("boom") }
      ui.switchTab("dashboard"); await t.renderOnce()
      ui.switchTab("manager"); await t.renderOnce()
      expect(t.captureCharFrame()).toContain("This tab failed to render")
      expect(t.captureCharFrame()).toContain("Dashboard")
    } finally {
      ;(data as { scopedTransactions: typeof original }).scopedTransactions = original
    }
    ui.switchTab("dashboard"); await t.renderOnce()
    ui.switchTab("manager"); await t.renderOnce()
    expect(t.captureCharFrame()).toContain("Transactions")
  })
})
