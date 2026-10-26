import { describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { account, transaction } from "../testing/fixtures"

// The CSV credit account and its rows the manager tests render.
const anzAccount = () => account({ name: "ANZ CREDIT", type: "credit", source: "csv", externalKind: null, balance: null })
const anzRow = (overrides: Parameters<typeof transaction>[0]) =>
  transaction({ categoryId: 10, accountName: "ANZ CREDIT", source: "csv", status: null, ...overrides })

describe("shell render M0", () => {
  test("renders header tabs status footer", async () => {
    ui.switchTab("overview")

    const t = await renderApp({ width: 140, height: 44 })
    // After mount, which loads the settings config.
    data.setState({ icons: false })
    await t.renderOnce()
    await t.flush()
    const frame = t.captureCharFrame()

    expect(frame).toContain("Jaskmoney")
    expect(frame).toContain("Overview")
    expect(frame).toContain("Transactions")
    expect(frame).toContain("Settings")
    // Point-in-time figures, then everything over the Date Range.
    expect(frame).toContain("Now")
    expect(frame).toContain("Savers")
    expect(frame).toContain("Date Range")
    // Chart panes name their view; the picker in the border marks the
    // current one (dots with icons off), groups two spaces apart.
    expect(frame).toContain("Spending · Cumulative")
    expect(frame).toContain(" ● ○ ○  ○  ○ ○ ○  ○ ")
    expect(frame).toContain(" ○ ○ ○  ○  ● ○ ○  ○ ")
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
    expect(ui.state.focusedSection).toBe("ov.range")

    // Applying another chip moves the bold highlight to it.
    const boldChip = () =>
      t.captureSpans().lines.flatMap((line) => line.spans)
        .filter((span) => /^ (\d[MY]|Cycle|Month|QTR|Half|FY|Year) $/.test(span.text) && span.attributes & TextAttributes.BOLD)
        .map((span) => span.text.trim())
    ui.setState({ dashChipCursor: 7 })
    t.mockInput.pressEnter()
    await t.renderOnce()
    expect(boldChip()).toEqual(["QTR"])

    // tab to Transactions
    t.mockInput.pressKey("2")
    await t.renderOnce()
    const mgr = t.captureCharFrame()
    expect(mgr).toContain("Accounts")
    expect(mgr).toContain("Transactions")
    expect(ui.state.activeTab).toBe("manager")

    t.renderer.destroy()
  })

  test("manager filter keeps its input in the pane and canonical form in the title", async () => {
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    data.setState({
      transactions: [anzRow({ dateISO: "2026-02-03", amount: -10, description: "FILTER TARGET" })],
      accounts: [anzAccount()],
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
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    data.setState({
      transactions: [
        anzRow({ id: 1, dateISO: "2026-02-03", amount: -20, description: "CURSOR FIRST" }),
        anzRow({ id: 2, dateISO: "2026-02-02", amount: -10, description: "CURSOR SECOND" }),
      ],
      accounts: [anzAccount()],
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
      // Only the description and the spans just before it.
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
    // A stack for all spending, then one per bank with its net position;
    // both savers are one row with their combined balance.
    expect(frame).toContain("All accounts · Net position")
    expect(frame).toContain("Up (API) · Net position")
    expect(frame).toContain("$10,052.37")
    expect(frame).toContain("$8,948.01")
    expect(frame).not.toContain("Holiday")
    // The last match: the header's status names the selection too.
    const span = (text: string) => t.captureSpans().lines.flatMap((line) => line.spans).findLast((s) => s.text === text)!
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

  test("emoji account names keep table columns aligned", async () => {
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    // Dot markers (icons need a Nerd Font and are a separate setting).
    data.setState({ icons: false })
    await t.flush()
    const row = (id: number, accountId: number, accountName: string) => transaction({
      id, accountId, accountName, dateISO: "2026-10-01", amount: -1, description: `ROW ${id}`, categoryId: 10,
    })
    data.setState({
      // "🏖️" is three UTF-16 units but two terminal cells.
      transactions: [row(1, 1, "Spending"), row(2, 2, "🏖️ Holiday"), row(3, 3, "🚨 Emergency fund")],
      accounts: [1, 2, 3].map((id) => account({ id, name: `a${id}`, balance: 0 })), filterQuery: "", filterExpr: null, filterErr: "",
      sortColumn: "date", sortAscending: false, ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, filterMode: false })
    await t.renderOnce()
    await t.flush()
    // Table rows only (they carry the category marker).
    const lines = t.captureCharFrame().split("\n").filter((line) => /ROW [123]/.test(line) && line.includes("○"))
    expect(lines).toHaveLength(3)
    const column = (line: string, needle: string) => Bun.stringWidth(line.slice(0, line.indexOf(needle)))
    // The category column starts at the same cell on every row.
    expect(new Set(lines.map((line) => column(line, "○"))).size).toBe(1)
    expect(lines.some((line) => line.includes("🚨 Emergenc…"))).toBe(true)
    t.renderer.destroy()
  })

  test("row states paint independent range, selection and cursor appearances", async () => {
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    await t.flush()

    const row = (id: number, description: string, status: "HELD" | "SETTLED" | null) => transaction({
      id, description, status, dateISO: `2026-02-0${4 - id}`, amount: -id, categoryId: 10, accountName: "UP SPENDING",
    })
    data.setState({
      transactions: [row(1, "RANGE ONLY", "SETTLED"), row(2, "RANGE SELECTED", "SETTLED"), row(3, "RANGE CURSOR", "HELD")],
      accounts: [account({ name: "UP SPENDING", balance: 10 })], filterQuery: "", filterExpr: null, filterErr: "",
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
    const t = await renderApp({ width: 140, height: 30 })
    await t.renderOnce()
    // Dot markers (icons need a Nerd Font and are a separate setting).
    data.setState({ icons: false })
    await t.flush()

    data.setState({
      transactions: Array.from({ length: 30 }, (_, i) => anzRow({
        id: i + 1,
        dateISO: `2026-02-${String(30 - i).padStart(2, "0")}`,
        amount: -123.45,
        description: `DESCRIPTION ROW ${String(i).padStart(2, "0")}`,
        categoryId: i === 1 ? 11 : 10,
        categoryName: i === 1 ? "Transfers" : "Uncategorised",
        categoryColor: i === 1 ? "#b4befe" : "#7f849c",
      })),
      accounts: [anzAccount()],
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

    // 30 rows − app chrome (4) − accounts strip (4) − card borders (2) −
    // table header (1).
    expect(ui.state.managerVisible).toBe(19)
    const lines = t.captureCharFrame().split("\n")
    const header = lines.find(
      (line) => line.includes("Amount") && line.includes("Description"),
    )!
    const first = lines.find((line) => line.includes("DESCRIPTION ROW 00"))!
    expect(header.indexOf("Date")).toBe(first.indexOf("30-02-26"))
    expect(header.indexOf("Amount")).toBe(first.indexOf("-$123.45"))
    expect(header.indexOf("Description")).toBe(first.indexOf("DESCRIPTION ROW 00"))
    // The description column is as wide as the longest description.
    expect(first).toContain("DESCRIPTION ROW 00 ○")
    expect(header.indexOf("Category")).toBe(first.indexOf("○"))
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 18"))).toBe(true)
    expect(lines.some((line) => line.includes("DESCRIPTION ROW 19"))).toBe(false)

    const bottom = lines.find((line) => line.includes("showing 1-19 of 30"))!
    expect(bottom).toContain("╰─ showing 1-19 of 30")
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
    for (const width of [140, 96, 70]) {
      ui.switchTab("settings")
      ui.setState({ settingsActive: false, settingsEditor: null, settingsConfirm: null })
      const t = await renderApp({ width, height: 36 })
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
    const t = await renderApp({ width: 110, height: 34 })
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
    const t = await renderApp({ width: 110, height: 34 })
    await t.renderOnce()
    await t.flush()
    ui.switchTab("settings")
    ui.activateSettings("database")
    t.mockInput.pressKey("c")
    await t.renderOnce()
    const frame = t.captureCharFrame()
    expect(frame).toContain("Clear all transaction and import data?")
    expect(frame).toContain("del confirm")
    t.renderer.destroy()
  })
})

describe("render errors", () => {
  test("a tab that throws shows an error card, and switching tabs recovers", async () => {
    const t = await renderApp({ width: 120, height: 30 })
    await t.renderOnce()
    const original = data.scopedTransactions
    try {
      ;(data as { scopedTransactions: () => unknown }).scopedTransactions = () => { throw new Error("boom") }
      ui.switchTab("overview"); await t.renderOnce()
      ui.switchTab("manager"); await t.renderOnce()
      expect(t.captureCharFrame()).toContain("This tab failed to render")
      expect(t.captureCharFrame()).toContain("Overview")
    } finally {
      ;(data as { scopedTransactions: typeof original }).scopedTransactions = original
    }
    ui.switchTab("overview"); await t.renderOnce()
    ui.switchTab("manager"); await t.renderOnce()
    expect(t.captureCharFrame()).toContain("Transactions")
  })

  test("all six text contexts paint the caret character and restore the end bar", async () => {
    ui.switchTab("manager")
    ui.setState({ detailId: null, detailNotesEditing: false })
    const t = await renderApp({ width: 140, height: 55 })
    await t.renderOnce()
    const profile = { ...ui.state.importProfileDraft, id: "abZcd", account: "Caret test", accountType: "debit" as const }
    data.commitPreview({
      path: "caret.csv", filename: "caret.csv", profile, accountId: 0, accountName: profile.account,
      rows: [{ sourceLine: 1, dateRaw: "2026-01-01", dateISO: "2026-01-01", amount: -1, description: "LOCAL CARET", duplicate: false, categoryName: "", tagNames: [] }],
      errors: [], newCount: 1, duplicateCount: 0, rulesEnabled: false,
    }, true)
    const id = data.state.transactions[0]!.id
    data.updateTransactionNotes(id, "abZcd")
    const contexts = [
      { accent: true, open: () => { ui.switchTab("manager"); ui.openFilter("abZcd") } },
      { accent: false, open: () => { ui.switchTab("manager"); ui.setState({ detailId: id }); t.mockInput.pressKey("n") } },
      { accent: true, open: () => { ui.switchTab("settings"); ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "abZcd" }) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.setState({ importStage: "path", importPath: "abZcd", importPathCaret: 5 }) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.openProfileEditor(profile, null) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.setState({ factoryResetOpen: true, factoryResetDraft: "abZcd", factoryResetCaret: 5 }) } },
    ]
    // Seed: end bar. Left: reverse character. End: normal text and end bar.
    for (const context of contexts) {
      ui.setState({ detailId: null, detailNotesEditing: false })
      context.open()
      await t.renderOnce()
      await t.flush()
      expect(t.captureCharFrame()).toContain("abZcd▌")
      t.mockInput.pressArrow("left")
      t.mockInput.pressArrow("left")
      t.mockInput.pressArrow("left")
      await t.renderOnce()
      await t.flush()
      const caret = t.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text === "Z")!
      expect(caret).toBeDefined()
      expect(caret.fg.toInts()).toEqual([17, 17, 27, 255])
      expect(caret.bg.toInts()).toEqual(context.accent ? [245, 194, 231, 255] : [180, 190, 254, 255])
      expect(caret.attributes).toBe(0)
      expect(t.captureCharFrame()).not.toContain("abZcd▌")
      t.mockInput.pressKey("e", { ctrl: true })
      await t.renderOnce()
      await t.flush()
      expect(t.captureCharFrame()).toContain("abZcd▌")
      const restored = t.captureSpans().lines.find((line) => line.spans.some((span) => span.text.includes("▌")))!.spans.find((span) => span.text.includes("abZcd"))!
      expect(restored.fg.toInts()).toEqual([205, 214, 244, 255])
      expect(restored.attributes).toBe(0)
      ui.closeFilter(false)
    }
    ui.setState({ detailId: null, detailNotesEditing: false })
    ui.switchTab("overview")
    data.clearFilter()
    t.renderer.destroy()
  })

})
