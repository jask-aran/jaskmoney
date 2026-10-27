import { expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { defaultDbPath } from "../db/client"
import { defaultSettingsConfigPath } from "../state/settingsConfig"
import { unwrap } from "solid-js/store"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { isPrintable } from "../domain/textField"
import { transaction } from "./fixtures"
import { key } from "./keys"
import { testEnv } from "./scoped"

const probe = "JASKMONEY_TEST_KIT_PROBE"

test("testEnv keeps the latest value for the rest of the test", () => {
  expect(process.env[probe]).toBeUndefined()
  testEnv(probe, "first")
  testEnv(probe, "second")
  expect(process.env[probe]).toBe("second")
})

test("testEnv restores the value from before the test's first change", () => {
  expect(process.env[probe]).toBeUndefined()
})

test("key: characters and space type text as a terminal sends them; named keys type nothing", () => {
  expect(key("space").sequence).toBe(" ")
  expect(isPrintable(key("space"))).toBe(true)
  expect(isPrintable(key("j"))).toBe(true)
  for (const name of ["return", "escape", "left", "tab", "backspace"]) expect(isPrintable(key(name))).toBe(false)
  expect(isPrintable(key("u", { ctrl: true }))).toBe(false)
  expect(key("g", { shift: true, sequence: "G" }).sequence).toBe("G")
})

test("transaction fixtures never share arrays", () => {
  const a = transaction()
  a.tagNames.push("IGNORE")
  expect(transaction().tagNames).toEqual([])
  expect(transaction({ dateISO: "2026-01-02" }).dateRaw).toBe("2026-01-02")
})

test("preload isolates settings and resets stores; reset removes nested session state", () => {
  expect(existsSync(process.env.JASKMONEY_CONFIG!)).toBe(false)
  expect(existsSync(join(dirname(defaultSettingsConfigPath()), "credentials.json"))).toBe(false)
  writeFileSync(join(dirname(defaultSettingsConfigPath()), "credentials.json"), '{"token":"test-only"}')
  expect(data.getDb()).toBeNull()
  expect(data.state.ready).toBe(false)
  expect(data.state.uncategorisedOnly).toBe(false)
  expect(ui.state.txnView).toBe("rows")
  expect(ui.state.merchantSort).toBe("total")
  const initialUi = structuredClone(unwrap(ui.state))
  const initialData = structuredClone(unwrap(data.state))
  data.init(":memory:")
  data.saveUiPrefs({ filterUsage: { old: "2026-01-01T00:00:00Z" }, weekStart: "sunday" })
  data.commitFilter("desc:Coffee")
  data.setState({ uncategorisedOnly: true, sortColumn: "amount", sortAscending: true, transactions: [transaction()] })
  ui.setState({
    txnView: "merchants", merchantSort: "count", merchantReverse: true,
    selectedIds: { 1: true }, tagPickerPatch: { 1: "add" },
    detailId: 1, rangeSelecting: true, rangeAnchorId: 1, rangeCursorId: 2,
  })
  data.reset()
  ui.reset()
  expect(data.getDb()).toBeNull()
  expect(data.state).toEqual(initialData)
  expect(ui.state).toEqual(initialUi)
  // New defaults must not retain mutable objects from the previous reset.
  ui.setState("selectedIds", 2, true)
  data.setState("uiPrefs", "weekStart", "sunday")
  data.reset()
  ui.reset()
  expect(data.state).toEqual(initialData)
  expect(ui.state).toEqual(initialUi)
})

test("preload isolates credential siblings and fallback paths and blanks all credentials", () => {
  for (const name of ["JASKMONEY_JEV_TOKEN", "JASKMONEY_CF_TOKEN", "JASKMONEY_CF_ACCOUNT_ID", "JASKMONEY_UP_TOKEN"]) {
    expect(process.env[name]).toBe("")
    testEnv(name, "test-only")
  }
  const directory = dirname(defaultSettingsConfigPath())
  expect(directory).toBe(process.env.HOME!)
  expect(existsSync(join(directory, "credentials.json"))).toBe(false)
  writeFileSync(join(directory, "credentials.json"), '{"token":"test-only"}')
  // Leave a sibling file behind; the next test must receive a new directory.
  // Without overrides, everything is in ~/.jaskmoney (inside the test HOME).
  delete process.env.JASKMONEY_CONFIG
  expect(defaultSettingsConfigPath()).toBe(join(directory, ".jaskmoney", "settings.json"))
  const db = process.env.JASKMONEY_DB
  delete process.env.JASKMONEY_DB
  expect(defaultDbPath()).toBe(join(directory, ".jaskmoney", "transactions.db"))
  process.env.JASKMONEY_DB = db
})
