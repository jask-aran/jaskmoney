import type { Db } from "../db/client"
import { addTagLink, decodeStoredTags, removeTagLink } from "../db/tagLinks"
import type { createUpClient } from "./client"
import { pushTransactions } from "./push"

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
  for (const row of rows) {
    const wanted = new Set(row.tags)
    for (const tag of providerTags) {
      if (wanted.has(tag.ext_id)) linksAdded += addTagLink(db, row.id, tag.id)
      else linksRemoved += removeTagLink(db, row.id, tag.id)
    }
  }
  return { tagsCreated, linksAdded, linksRemoved }
}

export async function pushTagChange(
  db: Db,
  client: Pick<ReturnType<typeof createUpClient>, "addTransactionTags" | "removeTransactionTags">,
  transactionIds: number[],
  tagId: number,
  add: boolean,
): Promise<{ changed: number; pushed: number; failures: string[] }> {
  const tag = db.query<{ name: string; ext_id: string | null }, [number]>("SELECT name, ext_id FROM tags WHERE id = ?").get(tagId)
  if (!tag) throw new Error("tag not found")
  const providerId = tag.ext_id ?? tag.name
  const localOnly = isIgnore(tag.name) || isIgnore(providerId)
  const change = add ? addTagLink : removeTagLink
  let local = 0
  const result = await pushTransactions(transactionIds, id => {
    const row = db.query<{ source: string; external_id: string | null; ext_tags: string }, [number]>(
      "SELECT source, external_id, ext_tags FROM transactions WHERE id = ?").get(id)
    if (!row) return null
    if (localOnly || row.source !== "up" || row.external_id === null) {
      local += change(db, id, tagId)
      return null
    }
    const externalId = row.external_id
    return async () => {
      const tags = new Set(decodeStoredTags(row.ext_tags))
      if (add && !tags.has(providerId) && tags.size >= 6) throw new Error("Up allows at most 6 tags")
      if (add) await client.addTransactionTags(externalId, [providerId])
      else await client.removeTransactionTags(externalId, [providerId])
      if (add) tags.add(providerId)
      else tags.delete(providerId)
      return db.transaction(() => {
        const count = change(db, id, tagId)
        db.query("UPDATE tags SET ext_id = ? WHERE id = ? AND ext_id IS NULL").run(tag.name, tagId)
        db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(JSON.stringify([...tags]), id)
        return count
      })()
    }
  })
  return { ...result, changed: result.changed + local }
}
