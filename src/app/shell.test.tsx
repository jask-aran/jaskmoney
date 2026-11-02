import { describe, expect, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { ink, theme } from "../theme"
import { rowAppearance } from "../domain/rowStyle"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { account, transaction } from "../testing/fixtures"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The CSV credit account and its rows the manager tests render.
const anzAccount = () => account({ name: "ANZ CREDIT", type: "credit", source: "csv", externalKind: null, balance: null })
const anzRow = (overrides: Parameters<typeof transaction>[0]) =>
  transaction({ categoryId: 10, accountName: "ANZ CREDIT", source: "csv", status: null, ...overrides })

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
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, filterBar: null })
    await t.renderOnce()
    await t.flush()
    // Table rows only (they carry the category marker).
    const lines = t.captureCharFrame().split("\n").filter((line) => /ROW [123]/.test(line) && line.includes("○"))
    expect(lines).toHaveLength(3)
    const column = (line: string, needle: string) => Bun.stringWidth(line.slice(0, line.indexOf(needle)))
    // The category column starts at the same cell on every row.
    expect(new Set(lines.map((line) => column(line, "○"))).size).toBe(1)
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
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 2, managerTop: 0, filterBar: null, selectedIds: { 2: true }, range: { anchorId: 1, cursorId: 3 } })
    await t.renderOnce()
    await t.flush()

    const span = (needle: string) =>
      t.captureSpans().lines.flatMap((line) => line.spans).find((s) => s.text.includes(needle))!
    const hex = (color: string | null) => RGBA.fromHex(color ?? theme.canvas).toInts()
    // Each state paints what rowAppearance gives it.
    expect(span("RANGE ONLY").bg.toInts()).toEqual(hex(rowAppearance(false, true, false).bg))
    expect(span("RANGE SELECTED").bg.toInts()).toEqual(hex(rowAppearance(true, true, false).bg))
    // Cursor inside the range: its own bar and text, bold; held rows are italic.
    const cursor = span("RANGE CURSOR")
    const look = rowAppearance(false, true, true)
    expect(cursor.bg.toInts()).toEqual(hex(look.bg))
    expect(cursor.fg.toInts()).toEqual(hex(look.fg))
    expect(cursor.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    expect(cursor.attributes & TextAttributes.ITALIC).toBe(TextAttributes.ITALIC)
    expect(span("RANGE ONLY").attributes & TextAttributes.ITALIC).toBe(0)

    ui.setState({ selectedIds: {}, range: null })
    await t.renderOnce()
    await t.flush()
    // Plain cursor keeps column colours.
    expect(span("RANGE CURSOR").bg.toInts()).toEqual(hex(rowAppearance(false, false, true).bg))
    expect(span("RANGE CURSOR").fg.toInts()).toEqual(RGBA.fromHex(ink.figure).toInts())
    expect(span("RANGE ONLY").bg.toInts()).toEqual(hex(null))

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
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, filterBar: null, selectedIds: {}, range: null })
    await t.renderOnce()
    await t.flush()

    // The viewport is filled: exactly managerVisible rows are drawn.
    const visible = ui.state.managerVisible
    expect(visible).toBeGreaterThan(0)
    const lines = t.captureCharFrame().split("\n")
    const header = lines.find((line) => line.includes("Amount") && line.includes("Description"))!
    const first = lines.find((line) => line.includes("DESCRIPTION ROW 00"))!
    // Header and rows share column geometry.
    expect(header.indexOf("Amount")).toBe(first.indexOf("-$123.45"))
    expect(header.indexOf("Description")).toBe(first.indexOf("DESCRIPTION ROW 00"))
    expect(header.indexOf("Category")).toBe(first.indexOf("○"))
    const row = (i: number) => `DESCRIPTION ROW ${String(i).padStart(2, "0")}`
    expect(lines.some((line) => line.includes(row(visible - 1)))).toBe(true)
    expect(lines.some((line) => line.includes(row(visible)))).toBe(false)

    t.renderer.destroy()
  })

  test("settings taxonomy stays split until the narrow stacked fallback", async () => {
    for (const width of [140, 96, 70]) {
      ui.switchTab("settings")
      ui.setState({ settingsActive: false, settingsEditor: null, armed: null })
      const t = await renderApp({ width, height: 36 })
      await t.renderOnce()
      await t.flush()
      t.mockInput.pressKey("v")
      t.mockInput.pressKey("c")
      await t.renderOnce()
      await t.flush()
      const frame = t.captureCharFrame()
      expect(frame).toContain("Taxonomy")
      expect(frame).toMatch(/Categories \d+/)
      if (width >= 80) expect(frame).toMatch(/Tags \d+/)
      // Below the wide layout the panes keep their height and the column
      // scrolls: a lower pane comes into view when it is focused.
      ui.setState({ settingsActive: false, focusedSection: "set.database" })
      await t.renderOnce()
      await t.flush()
      expect(t.captureCharFrame()).toContain("Database & Import")
      t.renderer.destroy()
    }
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
    ui.setState({ detail: null })
    const t = await renderApp({ width: 140, height: 55 })
    await t.renderOnce()
    const profile = { ...(ui.state.importWizard?.profileDraft ?? { id: "", name: "", account: "", accountType: "debit" as const, importPrefix: "", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }), id: "abZcd", name: "Caret test", account: "Caret test", accountType: "debit" as const, hasHeader: false, dateFormat: "YMD" as const }
    const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-caret-import-")), "caret.csv")
    writeFileSync(path, "2026-01-01,-1,LOCAL CARET\n")
    await data.commitPreview({
      path, filename: "caret.csv", profile, accountId: 0, accountName: profile.account,
      rows: [{ sourceLine: 1, dateRaw: "2026-01-01", dateISO: "2026-01-01", amount: -1, description: "LOCAL CARET", duplicate: false, categoryName: "", tagNames: [] }],
      errors: [], newCount: 1, duplicateCount: 0, rulesEnabled: false,
    }, true)
    const id = data.state.transactions[0]!.id
    data.updateTransactionNotes(id, "abZcd")
    const contexts = [
      { accent: true, open: () => { ui.switchTab("manager"); ui.openFilter("abZcd") } },
      { accent: false, open: () => { ui.switchTab("manager"); ui.setState({ detail: { boughtTop: 0, notes: null, id: id } }); t.mockInput.pressKey("n") } },
      { accent: true, open: () => { ui.switchTab("settings"); ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "abZcd" }) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.beginImport("", []); ui.setState("importWizard", { stage: "path", path: "abZcd", pathCaret: 5 }) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.openProfileEditor(profile, null) } },
      { accent: false, open: () => { ui.switchTab("settings"); ui.setState({ factoryReset: { draft: "abZcd", caret: 5, busy: false } }) } },
    ]
    // Seed: end bar. Left: reverse character. End: normal text and end bar.
    for (const context of contexts) {
      ui.setState({ detail: null })
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
      expect(restored.fg.toInts()).toEqual(RGBA.fromHex(ink.figure).toInts())
      expect(restored.attributes).toBe(0)
      ui.closeFilter(false)
    }
    ui.setState({ detail: null })
    ui.switchTab("overview")
    data.clearFilter()
    t.renderer.destroy()
  })

})
