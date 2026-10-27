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

/** Save the latest intent. The caller changes the link in the same transaction. */
export function queueTagPush(db: Db, transactionId: number, tagId: number, action: "add" | "remove"): void {
  db.query(`INSERT INTO tag_pushes (transaction_id, tag_id, action) VALUES (?, ?, ?)
    ON CONFLICT (transaction_id, tag_id) DO UPDATE SET action = excluded.action`).run(transactionId, tagId, action)
}

/** Count Up's tags with all waiting changes applied, then the proposed add. */
export function canAddUpTag(db: Db, transactionId: number, tagId: number): boolean {
  const row = db.query<{ ext_tags: string }, [number]>("SELECT ext_tags FROM transactions WHERE id = ?").get(transactionId)
  const tag = db.query<{ providerId: string }, [number]>("SELECT COALESCE(ext_id, name) AS providerId FROM tags WHERE id = ?").get(tagId)
  if (!row || !tag) return false
  const tags = new Set(decodeStoredTags(row.ext_tags))
  const waiting = db.query<{ providerId: string; action: "add" | "remove" }, [number]>(`SELECT COALESCE(t.ext_id, t.name) AS providerId, p.action
    FROM tag_pushes p JOIN tags t ON t.id = p.tag_id WHERE p.transaction_id = ?`).all(transactionId)
  for (const p of waiting) {
    if (p.action === "add") tags.add(p.providerId)
    else tags.delete(p.providerId)
  }
  tags.add(tag.providerId)
  return tags.size <= 6
}

/** The Up tag ids stored on a transaction (a JSON array of strings); throws
 * on anything else. Sync lets that fail; transaction detail shows none. */
export function decodeStoredTags(json: string): string[] {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value) || !value.every((id): id is string => typeof id === "string")) throw new Error("Invalid stored Up tags")
  return value
}
