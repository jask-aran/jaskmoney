import { basename } from "node:path"
import type { Db } from "../db/client"
import { ensureAccount, uncategorisedCategoryId } from "../db/client"
import { parseAnzCsv } from "./anz"
import type { IngestResult } from "./types"

function duplicateKey(
  dateISO: string,
  amount: number,
  description: string,
  accountId: number,
): string {
  return `${dateISO}|${amount.toFixed(2)}|${description.toLowerCase()}|${accountId}`
}

function loadDupeSet(db: Db, accountId: number): Set<string> {
  const rows = db
    .query(
      `SELECT date_iso, amount, description FROM transactions WHERE account_id = ?`,
    )
    .all(accountId) as Array<{ date_iso: string; amount: number; description: string }>
  const set = new Set<string>()
  for (const r of rows) {
    set.add(duplicateKey(r.date_iso, r.amount, r.description, accountId))
  }
  return set
}

/**
 * Naive ANZ ingest: parse → skip dupes → insert under ANZ CREDIT → import row.
 * No rules, no preview UI.
 */
export function ingestAnzCsv(
  db: Db,
  csvText: string,
  filename: string,
  opts: { skipDupes?: boolean } = {},
): IngestResult {
  const skipDupes = opts.skipDupes ?? true
  const parsed = parseAnzCsv(csvText)
  if (parsed.errors.length > 0 && parsed.rows.length === 0) {
    throw new Error(
      `ANZ parse failed (${parsed.errors.length} errors): ${parsed.errors[0]?.message}`,
    )
  }

  const account = ensureAccount(db, "ANZ CREDIT", "credit")
  const uncatId = uncategorisedCategoryId(db)
  const existing = skipDupes ? loadDupeSet(db, account.id) : new Set<string>()
  const seen = new Set<string>()

  let inserted = 0
  let skippedDupes = 0

  const insertTxn = db.query(
    `INSERT INTO transactions
      (date_raw, date_iso, amount, description, category_id, notes, import_id, account_id)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
  )
  const insertImport = db.query(
    `INSERT INTO imports (filename, row_count) VALUES (?, ?)`,
  )

  const run = db.transaction(() => {
    // Pre-count what we'll insert for import row_count
    const toInsert: typeof parsed.rows = []
    for (const r of parsed.rows) {
      const key = duplicateKey(r.dateISO, r.amount, r.description, account.id)
      if (skipDupes && (existing.has(key) || seen.has(key))) {
        skippedDupes++
        continue
      }
      seen.add(key)
      toInsert.push(r)
    }

    const imp = insertImport.run(basename(filename), toInsert.length)
    const importId = Number(imp.lastInsertRowid)

    for (const r of toInsert) {
      insertTxn.run(
        r.dateRaw,
        r.dateISO,
        r.amount,
        r.description,
        uncatId,
        importId,
        account.id,
      )
      inserted++
    }

    return importId
  })

  const importId = run()

  return {
    inserted,
    skippedDupes,
    accountId: account.id,
    accountName: account.name,
    importId,
  }
}
