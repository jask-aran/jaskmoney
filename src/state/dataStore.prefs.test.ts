import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureAccount } from "../db/client"
import { data } from "./dataStore"
import { DEFAULT_IMPORT_PROFILES, loadSettingsConfig, saveSettingsConfig } from "./settingsConfig"
import { restoreUiPrefs } from "./uiPrefs"

test("config writers preserve other fields, prefs merge, and unchanged prefs do not write", () => {
  const previousPath = process.env.JASKMONEY_CONFIG
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-prefs-")), "settings.json")
  process.env.JASKMONEY_CONFIG = path
  try {
    data.init(":memory:")
    const prefs = { accountSelection: "savers", chartViews: [1, 2], weekStart: "sunday" } as const
    data.saveUiPrefs({ ...prefs, chartViews: [...prefs.chartViews] })
    data.saveSavedFilter({ id: "food", name: "Food", expr: "desc:food" })
    data.setIcons(false)
    const profile = { ...DEFAULT_IMPORT_PROFILES[0]!, id: "other" }
    data.saveImportProfile(profile)
    expect(loadSettingsConfig()).toMatchObject({
      icons: false, savedFilters: [{ id: "food", name: "Food", expr: "desc:food" }], ui: prefs,
    })
    expect(loadSettingsConfig().importProfiles).toContainEqual(profile)
    data.saveUiPrefs({ weekStart: "monday" })
    expect(loadSettingsConfig()).toMatchObject({ icons: false, ui: { ...prefs, weekStart: "monday" } })
    expect(loadSettingsConfig().savedFilters).toHaveLength(1)
    expect(loadSettingsConfig().importProfiles).toContainEqual(profile)
    data.deleteSavedFilter("food")
    data.deleteImportProfile("other")
    expect(loadSettingsConfig()).toMatchObject({ icons: false, savedFilters: [], ui: { ...prefs, weekStart: "monday" } })
    expect(loadSettingsConfig().importProfiles).toHaveLength(1)
    data.saveUiPrefs({ timeframe: { family: "period", lookback: "1M", period: "month", custom: null } })
    const contents = "\n" + readFileSync(path, "utf8")
    writeFileSync(path, contents)
    data.saveUiPrefs({ weekStart: "monday", timeframe: { custom: null, period: "month", lookback: "1M", family: "period" } })
    expect(readFileSync(path, "utf8")).toBe(contents)

    // Two spending accounts: with one, it is all spending.
    const { id } = ensureAccount(data.getDb()!, "Local", "debit")
    ensureAccount(data.getDb()!, "Other", "debit")
    data.refresh()
    data.setAccountSelection(id)
    expect(data.state.accountSelection).toBe(id)
    expect(restoreUiPrefs({ accountSelection: id }, data.state.accounts, new Date(), data.state.budgetCycle).accountSelection).toBe(id)
    data.setAccountSelection(999999)
    expect(data.state.accountSelection).toBe("all")

    data.init(":memory:")
    expect(data.state.weekStart).toBe("monday")
    expect(data.state.uiPrefs.accountSelection).toBe("savers")
    saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [] })
    data.init(":memory:")
    expect(data.state.uiPrefs).toEqual({})
  } finally {
    process.env.JASKMONEY_CONFIG = previousPath
    data.init(":memory:")
  }
})

test("renaming an import profile replaces it", () => {
  data.init(":memory:")
  const before = data.state.importProfiles.map((p) => p.id)
  const profile = { id: "bank", name: "Bank", account: "A", accountType: "debit" as const, importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }
  data.saveImportProfile(profile)
  data.saveImportProfile({ ...profile, id: "bank-2" }, "bank")
  expect(data.state.importProfiles.map((p) => p.id).sort()).toEqual([...before, "bank-2"].sort())
  data.deleteImportProfile("bank-2")
})
