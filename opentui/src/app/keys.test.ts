import { describe, expect, test, beforeEach } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { handleKey, footerHints } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"

function key(partial: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: partial.name,
    ctrl: partial.ctrl ?? false,
    meta: partial.meta ?? false,
    shift: partial.shift ?? false,
    option: partial.option ?? false,
    sequence: partial.sequence ?? partial.name,
    number: partial.number ?? false,
    raw: partial.raw ?? partial.name,
    eventType: "press",
    source: "raw",
    preventDefault() {},
    stopPropagation() {},
    get defaultPrevented() {
      return false
    },
    get propagationStopped() {
      return false
    },
  } as KeyEvent
}

describe("key router", () => {
  beforeEach(() => {
    data.clearFilter()
    ui.switchTab("dashboard")
    ui.setState({
      jumpMode: false,
      focusedSection: "none",
      managerCursor: 0,
      managerTop: 0,
      status: "reset",
    })
  })

  test("number keys switch tabs", () => {
    handleKey(ui, key({ name: "2" }), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key({ name: "3" }), data)
    expect(ui.state.activeTab).toBe("settings")
    handleKey(ui, key({ name: "1" }), data)
    expect(ui.state.activeTab).toBe("dashboard")
  })

  test("tab cycles", () => {
    handleKey(ui, key({ name: "tab" }), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key({ name: "tab", shift: true }), data)
    expect(ui.state.activeTab).toBe("dashboard")
  })

  test("jump mode open, target, cancel", () => {
    handleKey(ui, key({ name: "v" }), data)
    expect(ui.state.jumpMode).toBe(true)
    handleKey(ui, key({ name: "d" }), data)
    expect(ui.state.jumpMode).toBe(false)
    expect(ui.state.focusedSection).toBe("dash.date")

    handleKey(ui, key({ name: "v" }), data)
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.jumpMode).toBe(false)
  })

  test("manager cursor moves with j/k", () => {
    data.setState({
      transactions: [1, 2, 3].map((id) => ({
        id,
        dateRaw: String(id),
        dateISO: `2026-02-0${id}`,
        amount: -id,
        description: "x",
        categoryId: 1,
        categoryName: "U",
        categoryColor: "#7f849c",
        notes: "",
        importId: null,
        accountId: 1,
        accountName: "A",
        tagNames: [],
          tagColors: [],
          tagIds: [],
      })),
      accounts: [{ id: 1, name: "A", type: "credit" as const, sortOrder: 1, isActive: true }],
      accountScope: { 1: true },
      ready: true,
    })

    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0 })
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.managerCursor).toBe(2)
    handleKey(ui, key({ name: "k" }), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key({ name: "g" }), data)
    expect(ui.state.managerCursor).toBe(0)
  })

  test("dashboard date chip apply sets timeframe", () => {
    ui.switchTab("dashboard")
    ui.setState({ focusedSection: "dash.date", dashChipCursor: 0 })
    data.setState({
      transactions: [
        {
          id: 1,
          dateRaw: "x",
          dateISO: "2026-02-10",
          amount: -1,
          description: "x",
          categoryId: null,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "A",
          tagNames: [],
          tagColors: [],
          tagIds: [],
        },
      ],
      ready: true,
    })
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.timeframe.family).toBe("lookback")
    expect(ui.state.timeframe.lookback).toBe("1M")
  })

  test("footer hints change with scope", () => {
    expect(footerHints("jump").some((h) => h.desc === "cancel")).toBe(true)
    expect(footerHints("manager.txns").some((h) => h.key === "j/k")).toBe(true)
    expect(footerHints("dashboard.date").some((h) => h.desc === "apply")).toBe(true)
  })
})
