import { expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { defaultDbPath } from "../db/client"
import { defaultSettingsConfigPath } from "../state/settingsConfig"
import { unwrap } from "solid-js/store"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { transaction } from "./fixtures"
import { testEnv } from "./scoped"

test("preload isolates settings and resets stores; reset removes nested session state", async () => {
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
  await data.saveUiPrefs({ filterUsage: { old: "2026-01-01T00:00:00Z" }, weekStart: "sunday" })
  data.commitFilter("desc:Coffee")
  data.setState({ uncategorisedOnly: true, sortColumn: "amount", sortAscending: true, transactions: [transaction()] })
  ui.setState({ txnView: "merchants", merchantSort: "count", merchantReverse: true, selectedIds: { 1: true }, tagPicker: { cursor: 0, query: "", patch: { 1: "add" }, applying: false }, detail: { boughtTop: 0, notes: null, id: 1 }, range: { anchorId: 1, cursorId: 2 } })
  data.reset()
  ui.reset()
  expect(data.getDb()).toBeNull()
  expect(data.state).toEqual(initialData)
  expect(ui.state).toEqual(initialUi)
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
  delete process.env.JASKMONEY_CONFIG
  expect(defaultSettingsConfigPath()).toBe(join(directory, ".jaskmoney", "settings.json"))
  const db = process.env.JASKMONEY_DB
  delete process.env.JASKMONEY_DB
  expect(defaultDbPath()).toBe(join(directory, ".jaskmoney", "transactions.db"))
  process.env.JASKMONEY_DB = db
})
