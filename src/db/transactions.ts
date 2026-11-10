import { newestFirst } from "../domain/chronology"
import { decodeStoredTags } from "./tagLinks"
import type { CategorySource } from "./schema"
import type { BoughtItem, ImportRecord, Transaction } from "../domain/types"
import type { Db } from "./client"

export function loadTransactions(db: Db, ids?: readonly number[]): Transaction[] {
  const only = ids ? ` AND t.id IN (${ids.map(() => "?").join(",")})` : ""
  const params = ids ? [...ids] : []
  const rows = db
    .query(
      `SELECT
         t.id,
         t.date_raw AS dateRaw,
         t.date_iso AS dateISO,
         t.amount,
         t.description,
         t.category_id AS categoryId,
         COALESCE(c.name, 'Uncategorised') AS categoryName,
         COALESCE(pc.name, '') AS categoryGroup,
         COALESCE(c.color, '#7f849c') AS categoryColor,
         t.notes,
         t.import_id AS importId,
         t.account_id AS accountId,
         COALESCE(a.name, '') AS accountName,
         t.source,
         t.status,
         t.transaction_type AS transactionType,
         NULLIF(TRIM(t.message), '') AS message,
         NULLIF(TRIM(t.raw_text), '') AS rawText,
         NULLIF(TRIM(t.foreign_amount), '') AS foreignAmount,
         NULLIF(TRIM(t.card_method), '') AS cardMethod,
         t.external_created_at AS createdAt,
         t.transfer_account_id AS transferAccountId,
         -- Internal: money moved to or from another tracked account. A transfer
         -- to an untracked account (e.g. a desynced joint account) is spending.
         (t.transfer_account_id IS NOT NULL AND COALESCE(ta.sync_enabled, 0) = 1) AS internal,
         COALESCE(c.not_spending, 0) AS notSpendingCategory,
         (COALESCE(c.income, 0) = 1 OR COALESCE(pc.income, 0) = 1) AS income,
         pl.items AS boughtJson
       FROM transactions t
       LEFT JOIN purchase_lookups pl ON pl.transaction_id = t.id AND pl.status = 'found'
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories pc ON pc.id = c.parent_id
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
       WHERE (a.id IS NULL OR a.sync_enabled = 1)${only}
       ORDER BY t.date_iso DESC, t.id DESC`,
    )
    .all(...params) as Array<Omit<Transaction, "tagNames" | "tagColors" | "tagIds" | "createdMs" | "bought"> & { createdAt: string | null; boughtJson: string | null }>

  const { tagNameMap, tagColorMap, tagIdMap } = loadTransactionTags(db, only, params)

  return rows.map(({ createdAt, boughtJson, ...r }) => ({
    ...r,
    ...(boughtJson ? { bought: parseItems(boughtJson) } : {}),
    createdMs: createdAt ? Date.parse(createdAt) || null : null,
    internal: !!r.internal,
    excluded: !!r.internal || !!(r as { notSpendingCategory?: number }).notSpendingCategory,
    income: !!r.income,
    tagNames: tagNameMap.get(r.id) ?? [],
    tagColors: tagColorMap.get(r.id) ?? [],
    tagIds: tagIdMap.get(r.id) ?? [],
  })).sort(newestFirst)
}

function readItems(json: string): { items: BoughtItem[]; legacy: boolean } {
  try {
    const v: unknown = JSON.parse(json)
    if (!Array.isArray(v)) return { items: [], legacy: false }
    const legacy = v.some((x) => typeof x === "string")
    const items = v.flatMap((x): BoughtItem[] => typeof x === "string" ? [{ name: x, quantity: 1, price: null }]
      : x && typeof x === "object" && typeof (x as BoughtItem).name === "string" ? [{ name: (x as BoughtItem).name, quantity: Number((x as BoughtItem).quantity) || 1, price: typeof (x as BoughtItem).price === "number" ? (x as BoughtItem).price : null }] : [])
    return { items, legacy }
  } catch { return { items: [], legacy: false } }
}
const parseItems = (json: string): BoughtItem[] => readItems(json).items

export interface PurchaseLookup {
  transactionId: number
  status: "found" | "waiting" | "none"
  source: string | null
  order: string | null
  items: BoughtItem[]
  legacy?: boolean
  emailKey: string | null
  refundOf: number | null
  checks: number
  checkedAt: string
}

export function loadPurchaseLookups(db: Db): Map<number, PurchaseLookup> {
  const rows = db.query<{ transactionId: number; status: PurchaseLookup["status"]; source: string | null; order: string | null; items: string | null; emailKey: string | null; refundOf: number | null; checks: number; checkedAt: string }, []>(
    `SELECT transaction_id AS transactionId, status, source, order_ref AS "order", items, email_key AS emailKey, refund_of AS refundOf, checks, checked_at AS checkedAt FROM purchase_lookups`).all()
  return new Map(rows.map((r) => {
    const read = r.items ? readItems(r.items) : { items: [], legacy: false }
    return [r.transactionId, { ...r, items: read.items, ...(read.legacy ? { legacy: true } : {}) }]
  }))
}

export function savePurchaseLookups(db: Db, lookups: PurchaseLookup[]): void {
  const save = db.query(`INSERT INTO purchase_lookups (transaction_id, status, source, order_ref, items, email_key, refund_of, checks, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_id) DO UPDATE SET status = excluded.status, source = excluded.source,
    order_ref = excluded.order_ref, items = excluded.items, email_key = excluded.email_key, refund_of = excluded.refund_of,
    checks = excluded.checks, checked_at = excluded.checked_at`)
  db.transaction(() => {
    for (const l of lookups) save.run(l.transactionId, l.status, l.source, l.order, l.items.length ? JSON.stringify(l.items) : null, l.emailKey, l.refundOf, l.checks, l.checkedAt)
  })()
}

export function loadImports(db: Db, limit = 12): ImportRecord[] {
  return db.query(`SELECT id, filename, row_count AS rowCount, imported_at AS importedAt FROM imports ORDER BY imported_at DESC, id DESC LIMIT ?`).all(limit) as ImportRecord[]
}

export function clearAllData(db: Db): void {
  db.transaction(() => {
    db.exec(`DELETE FROM transactions; DELETE FROM imports;`)
  })()
}

export function setTransactionCategory(
  db: Db,
  txnId: number,
  categoryId: number,
  source: CategorySource | null,
  provider?: { extCategory: string | null; extParentCategory: string | null },
): void {
  if (provider) {
    db.query(`UPDATE transactions SET category_id = ?, category_source = ?, ext_category = ?, ext_parent_category = ? WHERE id = ?`)
      .run(categoryId, source, provider.extCategory, provider.extParentCategory, txnId)
  } else {
    db.query(`UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?`).run(categoryId, source, txnId)
  }
}

export interface TransactionDetail {
  id: number
  source: string
  externalId: string | null
  status: string | null
  createdAt: string | null
  settledAt: string | null
  rawText: string | null
  message: string | null
  notes: string
  transferAccountName: string | null
  extCategory: string | null
  extParentCategory: string | null
  extTags: string[]
  extCategorizable: boolean | null
  transactionType: string | null
  cardMethod: string | null
  cardSuffix: string | null
  foreignAmount: string | null
  roundUp: number | null
  cashback: number | null
  importFilename: string | null
}

export function setTransactionNotes(db: Db, id: number, notes: string): void {
  db.query(`UPDATE transactions SET notes = ? WHERE id = ?`).run(notes, id)
}

export function loadTransactionDetail(db: Db, id: number): TransactionDetail | null {
  const row = db.query(`
    SELECT t.id, t.source, t.external_id AS externalId, t.status, t.external_created_at AS createdAt,
           t.settled_at AS settledAt, t.raw_text AS rawText, t.message, t.notes,
           ta.name AS transferAccountName, t.ext_category AS extCategory,
           t.ext_parent_category AS extParentCategory, t.ext_tags AS extTags,
           t.ext_categorizable AS extCategorizable, t.transaction_type AS transactionType,
           t.card_method AS cardMethod, t.card_suffix AS cardSuffix, t.foreign_amount AS foreignAmount,
           t.round_up AS roundUp, t.cashback, i.filename AS importFilename
    FROM transactions t
    LEFT JOIN accounts ta ON ta.id = t.transfer_account_id
    LEFT JOIN imports i ON i.id = t.import_id
    WHERE t.id = ?`).get(id) as (Omit<TransactionDetail, "extTags" | "extCategorizable"> & { extTags: string; extCategorizable: number | null }) | null
  if (!row) return null
  let extTags: string[] = []
  try { extTags = decodeStoredTags(row.extTags || "[]") } catch {}
  return { ...row, extTags, extCategorizable: row.extCategorizable == null ? null : row.extCategorizable === 1 }
}

function loadTransactionTags(db: Db, only: string, params: number[]) {
  const tagRows = db
    .query(
      `SELECT tt.transaction_id AS txnId, tg.id AS tagId, tg.name AS name, tg.color AS color
       FROM transaction_tags tt
       JOIN tags tg ON tg.id = tt.tag_id${only.replace("t.id", "tt.transaction_id").replace(" AND", " WHERE")}
       ORDER BY tg.sort_order, LOWER(tg.name), tg.id`,
    )
    .all(...params) as Array<{ txnId: number; tagId: number; name: string; color: string }>

  const tagNameMap = new Map<number, string[]>()
  const tagColorMap = new Map<number, string[]>()
  const tagIdMap = new Map<number, number[]>()
  for (const tr of tagRows) {
    const names = tagNameMap.get(tr.txnId) ?? []
    const colors = tagColorMap.get(tr.txnId) ?? []
    const ids = tagIdMap.get(tr.txnId) ?? []
    names.push(tr.name)
    colors.push(tr.color || "#94e2d5")
    ids.push(tr.tagId)
    tagNameMap.set(tr.txnId, names)
    tagColorMap.set(tr.txnId, colors)
    tagIdMap.set(tr.txnId, ids)
  }
  return { tagNameMap, tagColorMap, tagIdMap }
}
