import type { Db } from "../db/client"
import type { createUpClient } from "./client"

const isIgnore = (name: string) => name.toUpperCase() === "IGNORE"

function parseTags(json: string): string[] {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value) || !value.every((id): id is string => typeof id === "string")) throw new Error("Invalid stored Up tags")
  return [...new Set(value)]
}

// The caller owns the write transaction. Resolve all tag identities before
// reconciling links, since linking a local tag makes it provider-owned globally.
export function syncTagLinks(db: Db): { tagsCreated: number; linksAdded: number; linksRemoved: number } {
  const rows = db.query<{ id: number; ext_tags: string }, []>(`SELECT t.id, t.ext_tags FROM transactions t
    JOIN accounts a ON a.id = t.account_id WHERE t.source = 'up' AND a.sync_enabled = 1`).all()
    .map(row => ({ id: row.id, tags: parseTags(row.ext_tags) }))
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
  const insert = db.query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)")
  const remove = db.query("DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?")
  for (const row of rows) {
    const wanted = new Set(row.tags)
    for (const tag of providerTags) {
      if (wanted.has(tag.ext_id)) linksAdded += insert.run(row.id, tag.id).changes
      else linksRemoved += remove.run(row.id, tag.id).changes
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
  const change = add
    ? db.query("INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)")
    : db.query("DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?")
  let changed = 0, pushed = 0
  const failures: string[] = []
  for (const id of new Set(transactionIds)) {
    const row = db.query<{ source: string; external_id: string | null; ext_tags: string }, [number]>(
      "SELECT source, external_id, ext_tags FROM transactions WHERE id = ?").get(id)
    if (!row) continue
    if (localOnly || row.source !== "up" || row.external_id === null) {
      changed += change.run(id, tagId).changes
      continue
    }
    try {
      const tags = new Set(parseTags(row.ext_tags))
      if (add && !tags.has(providerId) && tags.size >= 6) throw new Error("Up allows at most 6 tags")
      if (add) await client.addTransactionTags(row.external_id, [providerId])
      else await client.removeTransactionTags(row.external_id, [providerId])
      if (add) tags.add(providerId)
      else tags.delete(providerId)
      changed += db.transaction(() => {
        const count = change.run(id, tagId).changes
        db.query("UPDATE tags SET ext_id = ? WHERE id = ? AND ext_id IS NULL").run(tag.name, tagId)
        db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(JSON.stringify([...tags]), id)
        return count
      })()
      pushed++
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { changed, pushed, failures }
}
