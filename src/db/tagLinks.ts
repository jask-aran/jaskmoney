import type { Db } from "./client"

/** Link a tag to a transaction; 1 if it was new. The caller owns the
 * transaction (if any). */
export function addTagLink(db: Db, transactionId: number, tagId: number): number {
  return db.query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(transactionId, tagId).changes
}

/** Unlink a tag from a transaction; 1 if it was linked. */
export function removeTagLink(db: Db, transactionId: number, tagId: number): number {
  return db.query("DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?").run(transactionId, tagId).changes
}

/** The Up tag ids stored on a transaction (a JSON array of strings); throws
 * on anything else. Sync lets that fail; transaction detail shows none. */
export function decodeStoredTags(json: string): string[] {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value) || !value.every((id): id is string => typeof id === "string")) throw new Error("Invalid stored Up tags")
  return value
}
