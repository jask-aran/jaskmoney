import { logTags, type Db, type TagHow } from "./client"

/** Stage one local change and its provider intent atomically. */
export function stageTagChange(db: Db, change: {
  transactionId: number; tagId: number; action: "add" | "remove"; how: TagHow; at: string
}): { kind: "unchanged" } | { kind: "changed"; queued: boolean } | { kind: "refused"; reason: string } {
  return db.transaction((): ReturnType<typeof stageTagChange> => {
    const { transactionId, tagId, action, how, at } = change
    const tag = db.query<{ name: string; extId: string | null }, [number]>("SELECT name, ext_id AS extId FROM tags WHERE id = ?").get(tagId)
    const row = db.query<{ source: string; externalId: string | null }, [number]>(
      "SELECT source, external_id AS externalId FROM transactions WHERE id = ?").get(transactionId)
    if (!row) return { kind: "unchanged" }
    const linked = !!db.query("SELECT 1 FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?").get(transactionId, tagId)
    const add = action === "add"
    if (linked === add) return { kind: "unchanged" }
    const queued = row.source === "up" && row.externalId != null && !!tag && tag.name.toUpperCase() !== "IGNORE" && tag.extId?.toUpperCase() !== "IGNORE"
    if (queued && add && !canAddUpTag(db, transactionId, tagId)) return { kind: "refused", reason: "Up allows at most 6 tags" }
    if (add) addTagLink(db, transactionId, tagId)
    else removeTagLink(db, transactionId, tagId)
    logTags(db, [transactionId], tagId, add, how, at)
    if (queued) queueTagPush(db, transactionId, tagId, action)
    return { kind: "changed", queued }
  })()
}

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
function queueTagPush(db: Db, transactionId: number, tagId: number, action: "add" | "remove"): void {
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
