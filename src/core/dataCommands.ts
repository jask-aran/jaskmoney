import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { clearAccountTransactions, clearAllData, removeAccountWithTransactions, setAccountSyncEnabled } from "../db/client"
import { buildImportPreview, commitImportPreview } from "../db/profileImport"
import type { ImportPreview, ImportProfile } from "../domain/types"
import { validateImportProfile } from "../state/settingsConfig"
import type { CoreRuntime } from "./runtime"

export class DataCommands {
  constructor(
    private readonly ctx: CoreRuntime,
    private readonly commands: () => Pick<DataCommands["importsCommands"], "previewImport">,
  ) {}

  csvFiles = (directory: string): string[] => {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
        .map((entry) => join(directory, entry.name)).sort((a, b) => a.localeCompare(b))
    } catch (error) { throw new Error(`cannot read import folder: ${error instanceof Error ? error.message : String(error)}`) }
  }

  commitPreview = (preview: ImportPreview, skipDuplicates: boolean): string => {
    if (!this.ctx.db) throw new Error("db not open")
    const rebuilt = this.commands().previewImport({ path: preview.path, profile: preview.profile })
    const result = this.ctx.mutate((db) => commitImportPreview(db, rebuilt, skipDuplicates))
    const applied = preview.rulesEnabled && result.transactionIds.length ? this.ctx.settings.applyRules(result.transactionIds) : null
    return `Imported ${result.inserted} rows from ${result.accountName}${result.skippedDupes ? ` (${result.skippedDupes} duplicates ${skipDuplicates ? "skipped" : "forced"})` : ""}${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`
  }
  importsCommands = {
    importDirectory: (_: object) => resolve(process.env.JASKMONEY_IMPORT_DIR ?? process.cwd()),
    csvFiles: (p: { directory: string }) => this.csvFiles(p.directory),
    previewImport: (p: { path: string; profile: ImportProfile }): ImportPreview => {
      if (!this.ctx.db) throw new Error("db not open")
      return buildImportPreview(this.ctx.db, readFileSync, p.path, validateImportProfile(p.profile))
    },
    commitPreview: (p: { preview: ImportPreview; skipDuplicates: boolean }) => this.commitPreview(p.preview, p.skipDuplicates)
  }
  accountsCommands = {
    /** Returns the number of transactions removed when switching sync off. */
    setAccountSync: (p: { accountId: number; enabled: boolean }) => this.ctx.mutate((db) => setAccountSyncEnabled(db, p.accountId, p.enabled))
  }
  clearCommands = {
    clearDatabaseData: (_: object) => { this.ctx.ensureNoSync("clearDatabaseData"); return this.ctx.mutate((db) => clearAllData(db)) },
    clearAccountData: (p: { accountId: number }) => { this.ctx.ensureNoSync("clearAccountData"); return this.ctx.mutate((db) => clearAccountTransactions(db, p.accountId)) },
    removeAccountData: (p: { accountId: number }) => { this.ctx.ensureNoSync("removeAccountData"); return this.ctx.mutate((db) => removeAccountWithTransactions(db, p.accountId)) },
    factoryResetDatabase: (_: object) => this.ctx.factoryResetDatabase()
  }
}
