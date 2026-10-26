import { basename } from "node:path"
import type { Db } from "../db/client"
import { ensureAccount, uncategorisedCategoryId } from "../db/client"
import type { ImportPreview, ImportPreviewError, ImportPreviewRow, ImportProfile, IngestResult } from "./types"

interface CsvRecord { fields: string[]; line: number }

/** RFC4180-style records, including escaped quotes and quoted newlines. */
export function parseCsvRecords(text: string, delimiter: string): { records: CsvRecord[]; errors: ImportPreviewError[] } {
  const records: CsvRecord[] = []
  const errors: ImportPreviewError[] = []
  let fields: string[] = [], value = "", quoted = false, start = true, line = 1, rowLine = 1
  const pushField = () => { fields.push(value); value = "" }
  const pushRecord = () => { pushField(); if (fields.some((f) => f.trim() !== "")) records.push({ fields, line: rowLine }); fields = []; start = true }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { value += '"'; i++ } else quoted = false
      } else { value += ch; if (ch === "\n") line++ }
      continue
    }
    if (ch === '"' && start) { quoted = true; start = false; continue }
    if (ch === delimiter) { pushField(); start = true; continue }
    if (ch === "\r") continue
    if (ch === "\n") { pushRecord(); line++; rowLine = line; continue }
    value += ch; start = false
  }
  if (quoted) errors.push({ sourceLine: rowLine, field: "csv", message: "unterminated quoted field" })
  if (value !== "" || fields.length) pushRecord()
  return { records, errors }
}

function isoDate(raw: string, format: ImportProfile["dateFormat"]): string | null {
  const values = raw.trim().match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})$/)
  if (!values) return null
  const a = Number(values[1]), b = Number(values[2]), c = Number(values[3])
  const [year, month, day] = format === "YMD" ? [a, b, c] : format === "MDY" ? [c, a, b] : [c, b, a]
  const date = new Date(year, month - 1, day)
  if (year < 1000 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function parseAmount(raw: string, strip: string): number | null {
  let value = raw.trim()
  for (const ch of strip) value = value.split(ch).join("")
  value = value.replaceAll(",", "").trim()
  if (/^\(.+\)$/.test(value)) value = `-${value.slice(1, -1)}`
  const parsed = Number(value)
  return value !== "" && Number.isFinite(parsed) ? parsed : null
}

function duplicateKey(row: Pick<ImportPreviewRow, "dateISO" | "amount" | "description">, accountId: number) {
  return `${row.dateISO}|${row.amount.toFixed(2)}|${row.description.toLowerCase()}|${accountId}`
}

function existingKeys(db: Db, accountId: number): Set<string> {
  const result = new Set<string>()
  const rows = db.query(`SELECT date_iso AS dateISO, amount, description FROM transactions WHERE account_id = ?`).all(accountId) as Array<{ dateISO: string; amount: number; description: string }>
  for (const row of rows) result.add(duplicateKey(row, accountId))
  return result
}

export function buildImportPreview(db: Db, text: string, path: string, profile: ImportProfile): ImportPreview {
  const account = db.query(`SELECT id, name, type FROM accounts WHERE name = ?`).get(profile.account) as { id: number; name: string; type: string } | null
  if (account && account.type !== profile.accountType) throw new Error(`account ${account.name} is ${account.type}, profile expects ${profile.accountType}`)
  const parsed = parseCsvRecords(text, profile.delimiter)
  const errors = [...parsed.errors]
  const rows: ImportPreviewRow[] = []
  const accountId = account?.id ?? 0
  const existing = account ? existingKeys(db, account.id) : new Set<string>()
  const records = profile.hasHeader ? parsed.records.slice(1) : parsed.records
  const maxColumn = Math.max(profile.dateColumn, profile.amountColumn, ...profile.descriptionColumns)
  for (const record of records) {
    if (record.fields.length <= maxColumn) { errors.push({ sourceLine: record.line, field: "columns", message: `requires column ${maxColumn + 1}, found ${record.fields.length}` }); continue }
    const dateRaw = record.fields[profile.dateColumn]!.trim()
    const amountRaw = record.fields[profile.amountColumn]!.trim()
    if (!dateRaw || !amountRaw) continue
    const dateISO = isoDate(dateRaw, profile.dateFormat)
    if (!dateISO) { errors.push({ sourceLine: record.line, field: "date", message: `invalid ${profile.dateFormat} date ${JSON.stringify(dateRaw)}` }); continue }
    const amount = parseAmount(amountRaw, profile.amountStrip)
    if (amount == null) { errors.push({ sourceLine: record.line, field: "amount", message: `invalid amount ${JSON.stringify(amountRaw)}` }); continue }
    const descriptionFields = profile.descriptionJoin
      ? record.fields.slice(profile.descriptionColumns[0]!)
      : profile.descriptionColumns.map((i) => record.fields[i]!)
    const description = descriptionFields.map((value) => value.trim()).filter(Boolean).join(",")
    const row: ImportPreviewRow = { sourceLine: record.line, dateRaw, dateISO, amount, description, duplicate: false, categoryName: "Uncategorised", tagNames: [] }
    row.duplicate = existing.has(duplicateKey(row, accountId))
    rows.push(row)
  }
  const duplicateCount = rows.filter((row) => row.duplicate).length
  return { path, filename: basename(path), profile, accountId, accountName: account?.name ?? profile.account, rows, errors, newCount: rows.length - duplicateCount, duplicateCount, rulesEnabled: true }
}

export function commitImportPreview(db: Db, preview: ImportPreview, skipDuplicates: boolean): IngestResult {
  if (preview.errors.length) throw new Error(`preview has ${preview.errors.length} parse errors`)
  const account = ensureAccount(db, preview.profile.account, preview.profile.accountType)
  if (account.type !== preview.profile.accountType) throw new Error(`account ${account.name} is ${account.type}, profile expects ${preview.profile.accountType}`)
  const uncategorised = uncategorisedCategoryId(db)
  const selected = preview.rows.filter((row) => !skipDuplicates || !row.duplicate)
  const insertImport = db.query(`INSERT INTO imports (filename, row_count) VALUES (?, ?)`)
  const insertTxn = db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, notes, import_id, account_id) VALUES (?, ?, ?, ?, ?, '', ?, ?)`)
  const transactionIds: number[] = []
  const importId = Number(db.transaction(() => {
    const imp = insertImport.run(preview.filename, selected.length)
    const id = Number(imp.lastInsertRowid)
    for (const row of selected) transactionIds.push(Number(insertTxn.run(row.dateRaw, row.dateISO, row.amount, row.description, uncategorised, id, account.id).lastInsertRowid))
    return id
  })())
  return { inserted: selected.length, skippedDupes: preview.rows.length - selected.length, accountId: account.id, accountName: account.name, importId, transactionIds }
}

export function matchingProfiles(profiles: ImportProfile[], filename: string): ImportProfile[] {
  const lower = filename.toLowerCase()
  const matches = profiles.filter((p) => p.importPrefix && lower.startsWith(p.importPrefix.toLowerCase()))
  const longest = Math.max(0, ...matches.map((p) => p.importPrefix.length))
  return matches.filter((p) => p.importPrefix.length === longest).sort((a, b) => a.name.localeCompare(b.name))
}
