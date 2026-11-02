import { expect, onTestFinished, test } from "bun:test"
import { mkdirSync, mkdtempSync, symlinkSync, truncateSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createCore } from "./core"
import { testEnv } from "../testing/scoped"
import type { ImportProfile } from "../domain/types"

const profile: ImportProfile = {
  id: "test", name: "Test", account: "Test account", accountType: "debit", importPrefix: "test", hasHeader: false,
  delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], amountStrip: "$", dateFormat: "DMY",
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "import-security-"))
  const home = join(directory, "private")
  mkdirSync(home)
  testEnv("JASKMONEY_HOME", home)
  const core = createCore()
  onTestFinished(() => { core.close(); core.dispose() })
  core.open(":memory:")
  const path = join(directory, "test.CSV")
  writeFileSync(path, "01/02/2026,-5,Test coffee\n")
  return { core, directory, home, path }
}

test("preview checks real paths, suffix, regular files, size, and the data directory", () => {
  const { core, directory, home, path } = fixture()
  expect(core.commands.previewImport({ path, profile }).rows).toHaveLength(1)
  const secret = join(directory, "credentials.json")
  writeFileSync(secret, "invented secret")
  const link = join(directory, "link.csv")
  symlinkSync(secret, link)
  const privateCsv = join(home, "secret.csv")
  writeFileSync(privateCsv, "invented secret")
  const privateLink = join(directory, "private.csv")
  symlinkSync(privateCsv, privateLink)
  const folder = join(directory, "folder.csv")
  mkdirSync(folder)
  const large = join(directory, "large.csv")
  writeFileSync(large, "")
  truncateSync(large, 20 * 1024 * 1024 + 1)
  for (const rejected of [secret, link, privateCsv, privateLink, folder, large, join(directory, "missing.csv")]) {
    expect(() => core.commands.previewImport({ path: rejected, profile })).toThrow("Only .csv files can be imported")
  }
  const alias = join(directory, "home-alias")
  symlinkSync(home, alias)
  testEnv("JASKMONEY_HOME", alias)
  expect(() => core.commands.previewImport({ path: privateCsv, profile })).toThrow("Only .csv files can be imported")
})

test("commit rebuilds rows, metadata, errors and duplicates from the checked CSV", () => {
  const { core, path } = fixture()
  const preview = core.commands.previewImport({ path, profile })
  preview.rows[0]!.amount = -999
  preview.rows[0]!.description = "forged"
  preview.rows[0]!.duplicate = true
  preview.filename = "forged.csv"
  preview.errors = [{ sourceLine: 1, field: "date", message: "forged" }]
  preview.rulesEnabled = false
  expect(core.commands.commitPreview({ preview, skipDuplicates: true })).toContain("Imported 1 rows")
  expect(core.state.transactions[0]).toMatchObject({ amount: -5, description: "Test coffee" })
  preview.errors = []
  preview.rows[0]!.duplicate = false
  expect(core.commands.commitPreview({ preview, skipDuplicates: true })).toContain("Imported 0 rows")
  expect(core.commands.commitPreview({ preview, skipDuplicates: false })).toContain("Imported 1 rows")
  expect(core.db!.query("SELECT filename FROM imports ORDER BY id LIMIT 1").get()).toEqual({ filename: "test.CSV" })
  writeFileSync(path, "02/02/2026,-7,Changed on disk\n")
  expect(core.commands.commitPreview({ preview, skipDuplicates: true })).toContain("Imported 1 rows")
  expect(core.state.transactions.some(row => row.description === "Changed on disk" && row.amount === -7)).toBe(true)
  writeFileSync(path, "bad-date,-5,Changed\n")
  expect(() => core.commands.commitPreview({ preview, skipDuplicates: true })).toThrow("parse errors")
  expect(core.state.transactions).toHaveLength(3)
  expect(() => core.commands.commitPreview({ preview: { ...preview, profile: { ...profile, dateColumn: -1 } }, skipDuplicates: true })).toThrow("non-negative integers")
  const secret = path.replace(/CSV$/, "json")
  writeFileSync(secret, "invented secret")
  expect(() => core.commands.commitPreview({ preview: { ...preview, path: secret }, skipDuplicates: true })).toThrow("Only .csv files can be imported")
})
