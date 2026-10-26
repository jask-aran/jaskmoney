import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadSettingsConfig, nextSavedFilterId, saveSettingsConfig, validateSavedFilter } from "./settingsConfig"

describe("settings config", () => {
  test("strictly validates saved filters and persists a versioned document atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "jaskmoney-settings-"))
    const path = join(dir, "settings.json")
    const filter = validateSavedFilter({ id: "Groceries", name: "Groceries", expr: "desc:woolworths" })
    saveSettingsConfig({ version: 2, savedFilters: [filter], importProfiles: [] }, path)
    expect(loadSettingsConfig(path).savedFilters).toEqual([{ id: "groceries", name: "Groceries", expr: "desc:woolworths" }])
    expect(readFileSync(path, "utf8")).toContain('"version": 2')
    expect(nextSavedFilterId([{ id: "filter-1", name: "A", expr: "desc:a" }])).toBe("filter-2")
    expect(() => validateSavedFilter({ id: "bad id", name: "Bad", expr: "desc:x" })).toThrow("filter ID")
    expect(() => validateSavedFilter({ id: "bad", name: "Bad", expr: "(desc:x OR cat:y" })).toThrow()
  })

  test("upgrades v1 profiles with the legacy ANZ date order", () => {
    const dir = mkdtempSync(join(tmpdir(), "jaskmoney-settings-"))
    const path = join(dir, "settings.json")
    writeFileSync(path, JSON.stringify({ version: 1, savedFilters: [], importProfiles: [{ id: "anz", name: "ANZ", account: "ANZ", accountType: "credit", importPrefix: "anz", hasHeader: false, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], amountStrip: "$" }] }))
    expect(loadSettingsConfig(path).importProfiles[0]?.dateFormat).toBe("DMY")
  })

  test("restores the editable ANZ profile when profiles are absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "jaskmoney-settings-"))
    const path = join(dir, "settings.json")
    writeFileSync(path, JSON.stringify({ version: 2, savedFilters: [], importProfiles: [] }))
    expect(loadSettingsConfig(path).importProfiles).toContainEqual(expect.objectContaining({ id: "anz", account: "ANZ CREDIT", dateFormat: "DMY", descriptionJoin: true }))
  })
})
