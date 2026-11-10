import type { Db } from "../db/client"
import { addTagLink, decodeStoredTags, removeTagLink } from "../db/tagLinks"
import type { createUpClient } from "./client"

const isIgnore = (name: string) => name.toUpperCase() === "IGNORE"

// The caller owns the write transaction. Resolve all tag identities before
// reconciling links, since linking a local tag makes it provider-owned globally.
export function syncTagLinks(db: Db): { tagsCreated: number; linksAdded: number; linksRemoved: number } {
  const rows = db.query<{ id: number; ext_tags: string }, []>(`SELECT t.id, t.ext_tags FROM transactions t
    JOIN accounts a ON a.id = t.account_id WHERE t.source = 'up' AND a.sync_enabled = 1`).all()
    .map(row => ({ id: row.id, tags: decodeStoredTags(row.ext_tags) }))
  let tagsCreated = 0, linksAdded = 0, linksRemoved = 0
  for (const id of new Set(rows.flatMap(row => row.tags))) {
    if (isIgnore(id)) continue
    const existing = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE ext_id = ?").get(id)
    if (existing) continue
    const local = db.query<{ id: number }, [string]>("SELECT id FROM tags WHERE ext_id IS NULL AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1").get(id)
    if (local) db.query("UPDATE tags SET ext_id = ? WHERE id = ?").run(id, local.id)
    else {
      db.query(`INSERT INTO tags (name, ext_id, sort_order)
        VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tags))`).run(id, id)
      tagsCreated++
    }
  }
  const providerTags = db.query<{ id: number; name: string; ext_id: string }, []>("SELECT id, name, ext_id FROM tags WHERE ext_id IS NOT NULL").all()
    .filter(tag => !isIgnore(tag.name) && !isIgnore(tag.ext_id))
  const providerByExt = new Map(providerTags.map(tag => [tag.ext_id, tag.id]))
  const providerIds = new Set(providerTags.map(tag => tag.id))
  const stored = new Map<number, Set<number>>()
  for (const link of db.query<{ transaction_id: number; tag_id: number }, []>(
    "SELECT transaction_id, tag_id FROM transaction_tags").all()) {
    let ids = stored.get(link.transaction_id)
    if (!ids) stored.set(link.transaction_id, ids = new Set())
    ids.add(link.tag_id)
  }
  const pending = new Map<number, Map<number, "add" | "remove">>()
  for (const change of db.query<{ transaction_id: number; tag_id: number; action: "add" | "remove" }, []>(
    "SELECT transaction_id, tag_id, action FROM tag_pushes").all()) {
    let changes = pending.get(change.transaction_id)
    if (!changes) pending.set(change.transaction_id, changes = new Map())
    changes.set(change.tag_id, change.action)
  }
  for (const row of rows) {
    const current = stored.get(row.id) ?? new Set<number>()
    // Local and IGNORE links survive unless a queued change overrides them.
    const wanted = new Set([...current].filter(id => !providerIds.has(id)))
    for (const extId of row.tags) {
      const id = providerByExt.get(extId)
      if (id !== undefined) wanted.add(id)
    }
    for (const [id, action] of pending.get(row.id) ?? []) {
      if (action === "add") wanted.add(id)
      else wanted.delete(id)
    }
    for (const id of wanted) if (!current.has(id)) linksAdded += addTagLink(db, row.id, id)
    for (const id of current) if (!wanted.has(id)) linksRemoved += removeTagLink(db, row.id, id)
  }
  return { tagsCreated, linksAdded, linksRemoved }
}

/** Send an already local, queued change. Errors reach the store for refusal
 * or retry handling. Confirmation never overwrites a newer local intent. */
export async function sendQueuedTagChange(
  db: Db,
  client: Pick<ReturnType<typeof createUpClient>, "addTransactionTags" | "removeTransactionTags">,
  transactionId: number,
  tagId: number,
  action: "add" | "remove",
  logId: number | null,
): Promise<boolean> {
  // A reserved request can become stale before a worker starts it.
  const pending = db.query(`SELECT 1 FROM tag_pushes WHERE transaction_id = ? AND tag_id = ? AND action = ?
    AND ? IS (SELECT MAX(id) FROM tag_log WHERE transaction_id = ? AND tag_id = ?)`)
    .get(transactionId, tagId, action, logId, transactionId, tagId)
  if (!pending) return false
  const row = db.query<{ external_id: string }, [number]>("SELECT external_id FROM transactions WHERE id = ?").get(transactionId)
  const tag = db.query<{ providerId: string }, [number]>("SELECT COALESCE(ext_id, name) AS providerId FROM tags WHERE id = ?").get(tagId)
  if (!row || !tag) return false
  if (action === "add") await client.addTransactionTags(row.external_id, [tag.providerId])
  else await client.removeTransactionTags(row.external_id, [tag.providerId])
  db.transaction(() => {
    const current = db.query<{ ext_tags: string }, [number]>("SELECT ext_tags FROM transactions WHERE id = ?").get(transactionId)
    if (!current) return
    const tags = new Set(decodeStoredTags(current.ext_tags))
    if (action === "add") tags.add(tag.providerId)
    else tags.delete(tag.providerId)
    db.query("UPDATE tags SET ext_id = ? WHERE id = ? AND ext_id IS NULL").run(tag.providerId, tagId)
    db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(JSON.stringify([...tags]), transactionId)
    db.query(`DELETE FROM tag_pushes WHERE transaction_id = ? AND tag_id = ? AND action = ?
      AND ? IS (SELECT MAX(id) FROM tag_log WHERE transaction_id = ? AND tag_id = ?)`)
      .run(transactionId, tagId, action, logId, transactionId, tagId)
  })()
  return true
}
