import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { loadSettingsConfig, saveSettingsConfig } from "../state/settingsConfig"
import { OPEN_RANGES } from "../domain/timeframe"
import { CHART_LABEL_MODES } from "../ui/charts/motion"
import { BACKDROPS } from "../ui/welcome/backdrop"

test("Appearance preferences save/load known values and discard unknown values", () => {
  const path = process.env.JASKMONEY_CONFIG!
  for (const chartLabels of CHART_LABEL_MODES) {
    for (const backdrop of BACKDROPS) {
      const prefs = { chartLabels, backdrop: backdrop.id }
      saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: prefs }, path)
      expect(loadSettingsConfig(path).ui).toEqual(prefs)
    }
  }
  for (const openRange of OPEN_RANGES) {
    saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: { openRange } }, path)
    expect(loadSettingsConfig(path).ui).toEqual({ openRange })
  }
  for (const value of ["unknown", "", "in order", "coin rain", null, false, 12, {}, []]) {
    writeFileSync(path, JSON.stringify({ version: 2, ui: { chartLabels: value, openRange: value, backdrop: value } }))
    expect(loadSettingsConfig(path).ui).toEqual({})
    // @ts-expect-error Exercise malformed runtime input at the settings write boundary.
    saveSettingsConfig({ version: 2, savedFilters: [], importProfiles: [], ui: { chartLabels: value, openRange: value, backdrop: value } }, path)
    expect(readFileSync(path, "utf8")).not.toContain('"chartLabels"')
    expect(readFileSync(path, "utf8")).not.toContain('"backdrop"')
    expect(readFileSync(path, "utf8")).not.toContain('"openRange"')
  }
})
