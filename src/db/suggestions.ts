import type { CategorySuggestion } from "../domain/types"
import type { Db } from "./client"

export function loadSuggestions(db: Db): CategorySuggestion[] {
  return db.query<Omit<CategorySuggestion, "ranked" | "knewBought"> & { ranked: string | null; knewBought: number }, []>(`SELECT s.transaction_id AS transactionId,
    s.category_id AS categoryId, s.confidence, s.source, s.ranked, s.knew_bought AS knewBought
    FROM category_suggestions s
    JOIN transactions t ON t.id = s.transaction_id
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE s.dismissed = 0 AND (t.category_id IS NULL OR c.is_default = 1)`).all().map(({ ranked, ...s }) => {
      const list = parseRanked(ranked)
      const { knewBought, ...rest } = s
      const suggestion: CategorySuggestion = knewBought ? { ...rest, knewBought: true } : rest
      return list ? { ...suggestion, ranked: list } : suggestion
    })
}

/** A stored ranking, or undefined when absent or unreadable. */
function parseRanked(raw: string | null): CategorySuggestion["ranked"] {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return undefined
    const list = value.filter((e): e is [number, number] => Array.isArray(e) && typeof e[0] === "number" && typeof e[1] === "number")
    return list.length ? list.map(([categoryId, confidence]) => ({ categoryId, confidence })) : undefined
  } catch {
    return undefined
  }
}

export function saveSuggestions(db: Db, list: CategorySuggestion[]): void {
  const save = db.query(`INSERT INTO category_suggestions (transaction_id, category_id, confidence, source, ranked, knew_bought)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(transaction_id) DO UPDATE SET
    category_id = excluded.category_id, confidence = excluded.confidence,
    source = excluded.source, ranked = excluded.ranked, knew_bought = excluded.knew_bought, created_at = datetime('now')`)
  db.transaction(() => {
    for (const s of list) save.run(s.transactionId, s.categoryId, s.confidence, s.source, s.ranked?.length ? JSON.stringify(s.ranked.map((r) => [r.categoryId, r.confidence])) : null, s.knewBought ? 1 : 0)
  })()
}

export type RuleDecline = { expr: string } & ({ categoryId: number; tagId: null } | { categoryId: null; tagId: number })

export function declineRule(db: Db, expr: string, categoryId: number | null, tagId: number | null = null): void {
  if ((categoryId == null) === (tagId == null)) throw new Error("exactly one category or tag is required")
  if (tagId != null) db.query("INSERT OR IGNORE INTO rule_tag_declines (expr, tag_id) VALUES (?, ?)").run(expr, tagId)
  else db.query("INSERT OR IGNORE INTO rule_declines (expr, category_id) VALUES (?, ?)").run(expr, categoryId)
}

/** Undo declineRule: the model may offer it again. */
export function undeclineRule(db: Db, expr: string, categoryId: number | null, tagId: number | null = null): void {
  if (tagId != null) db.query("DELETE FROM rule_tag_declines WHERE expr = ? AND tag_id = ?").run(expr, tagId)
  else db.query("DELETE FROM rule_declines WHERE expr = ? AND category_id = ?").run(expr, categoryId)
}

export function loadRuleDeclines(db: Db): RuleDecline[] {
  return db.query<RuleDecline, []>(`SELECT expr, category_id AS categoryId, NULL AS tagId FROM rule_declines
    UNION ALL SELECT expr, NULL AS categoryId, tag_id AS tagId FROM rule_tag_declines`).all()
}

/** A categorisation you made: `times` rows of `description` into the category. */
export function recordCategoryChoices(db: Db, choices: { description: string; categoryId: number; times: number }[]): void {
  const add = db.query(`INSERT INTO category_choices (description, category_id, times) VALUES (?, ?, ?)
    ON CONFLICT (description, category_id) DO UPDATE SET times = times + excluded.times`)
  db.transaction(() => { for (const c of choices) add.run(c.description.trim().toLowerCase(), c.categoryId, c.times) })()
}

export function unrecordCategoryChoices(db: Db, choices: { description: string; categoryId: number; times: number }[]): void {
  const subtract = db.query("UPDATE category_choices SET times = MAX(0, times - ?) WHERE description = ? AND category_id = ?")
  db.transaction(() => { for (const c of choices) subtract.run(c.times, c.description.trim().toLowerCase(), c.categoryId) })()
}

export interface CategoryChoice { description: string; categoryId: number; times: number; declined: boolean }

export function loadCategoryChoices(db: Db): CategoryChoice[] {
  return db.query<{ description: string; categoryId: number; times: number; declined: number }, []>(
    "SELECT description, category_id AS categoryId, times, declined FROM category_choices").all()
    .map((c) => ({ ...c, declined: c.declined === 1 }))
}

export function declineCategoryChoice(db: Db, description: string, categoryId: number, declined = true): void {
  db.query("UPDATE category_choices SET declined = ? WHERE description = ? AND category_id = ?").run(declined ? 1 : 0, description.trim().toLowerCase(), categoryId)
}

/** Jev's merchant-breadth answers, by lowercased name. */
export function loadMerchantBreadth(db: Db): Map<string, number> {
  return new Map(db.query<{ merchant: string; probability: number }, []>("SELECT merchant, probability FROM merchant_breadth").all().map((r) => [r.merchant, r.probability]))
}

export function saveMerchantBreadth(db: Db, answers: Map<string, number>): void {
  const save = db.query("INSERT INTO merchant_breadth (merchant, probability) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET probability = excluded.probability, asked_at = datetime('now')")
  db.transaction(() => { for (const [merchant, p] of answers) save.run(merchant, p) })()
}

/** The user's merchant notes, by lowercased name. */
export function loadMerchantNotes(db: Db): Map<string, string> {
  return new Map(db.query<{ merchant: string; note: string }, []>("SELECT merchant, note FROM merchant_notes").all().map((r) => [r.merchant, r.note]))
}

/** Save (or, empty, remove) a merchant's note. Its breadth was judged
 * without it: forgotten, so the next run asks again. */
export function saveMerchantNote(db: Db, merchant: string, note: string): void {
  const key = merchant.trim().toLowerCase()
  db.transaction(() => {
    if (note.trim()) db.query("INSERT INTO merchant_notes (merchant, note) VALUES (?, ?) ON CONFLICT(merchant) DO UPDATE SET note = excluded.note, updated_at = datetime('now')").run(key, note.trim())
    else db.query("DELETE FROM merchant_notes WHERE merchant = ?").run(key)
    db.query("DELETE FROM merchant_breadth WHERE merchant = ?").run(key)
  })()
}

/** Rows whose suggestion was dismissed: not suggested for again. */
export function loadDismissedSuggestionIds(db: Db): Set<number> {
  return new Set(db.query<{ id: number }, []>("SELECT transaction_id AS id FROM category_suggestions WHERE dismissed = 1").all().map((r) => r.id))
}

/** Dismiss suggestions: kept, marked, so they are not made again. */
export function dismissSuggestionRows(db: Db, transactionIds: number[]): void {
  const dismiss = db.query("UPDATE category_suggestions SET dismissed = 1 WHERE transaction_id = ?")
  db.transaction(() => { for (const id of transactionIds) dismiss.run(id) })()
}

export function undismissSuggestionRows(db: Db, transactionIds: number[]): void {
  const restore = db.query("UPDATE category_suggestions SET dismissed = 0 WHERE transaction_id = ?")
  db.transaction(() => { for (const id of transactionIds) restore.run(id) })()
}

/** Rows dismissed for a tag (by its upper-case name). */
export function loadTagDismissals(db: Db, tagName: string): Set<number> {
  return new Set(db.query<{ id: number }, [string]>("SELECT transaction_id AS id FROM tag_dismissals WHERE tag_name = ?").all(tagName.toUpperCase()).map((r) => r.id))
}

export function saveTagDismissals(db: Db, tagName: string, transactionIds: number[]): void {
  const save = db.query("INSERT OR IGNORE INTO tag_dismissals (tag_name, transaction_id) VALUES (?, ?)")
  db.transaction(() => { for (const id of transactionIds) save.run(tagName.toUpperCase(), id) })()
}

export function deleteTagDismissals(db: Db, tagName: string, transactionIds: number[]): void {
  const remove = db.query("DELETE FROM tag_dismissals WHERE tag_name = ? AND transaction_id = ?")
  db.transaction(() => { for (const id of transactionIds) remove.run(tagName.toUpperCase(), id) })()
}

export function deleteSuggestions(db: Db, transactionIds: number[]): void {
  const remove = db.query(`DELETE FROM category_suggestions WHERE transaction_id = ?`)
  db.transaction(() => {
    for (const id of transactionIds) remove.run(id)
  })()
}
