import { expect, onTestFinished, test } from "bun:test"
import { createCore } from "./core"
import { saveSuggestions } from "../db/client"
import type { CoreState } from "./protocol"

function fixture() {
  const core = createCore()
  core.open(":memory:")
  onTestFinished(() => { core.close(); core.dispose() })
  core.db!.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description)
    VALUES (1, 'x', '2026-01-01', -5, 'Test shop'), (2, 'x', '2026-01-02', -8, 'Other shop')`).run()
  core.refresh()
  const patches: Partial<CoreState>[] = []
  onTestFinished(core.subscribe(patch => patches.push(patch)))
  patches.length = 0
  return { core, patches }
}
const cx = { progress: () => {}, signal: new AbortController().signal }

test("accept reloads stored suggestions without sending unchanged rows, then undo restores them", async () => {
  const { core, patches } = fixture()
  const categoryId = core.state.categories.find(c => c.name === "Groceries")!.id
  // The pre-accept refresh still reads suggestions saved after the last refresh.
  saveSuggestions(core.db!, [{ transactionId: 1, categoryId, confidence: 0.9, source: "history" }])
  expect(await core.commands.acceptSuggestions({ ids: [1] }, cx)).toBe("Accepted 1 suggestion")
  expect(patches.filter(p => p.transactions)).toHaveLength(1)
  expect(core.state.transactions.find(t => t.id === 1)!.categoryId).toBe(categoryId)
  expect(core.state.suggestions[1]).toBeUndefined()
  expect(patches.some(p => p.suggestions?.[1])).toBe(true)
  patches.length = 0
  await core.commands.undo({})
  expect(core.state.transactions.find(t => t.id === 1)!.categoryId).not.toBe(categoryId)
  expect(core.state.suggestions[1]?.categoryId).toBe(categoryId)
})

test("saving a merchant note publishes the note and preserves the transaction snapshot", async () => {
  const { core, patches } = fixture()
  const rows = core.state.transactions
  await core.commands.setMerchantNote({ description: "Test shop", note: "Always groceries" }, cx)
  expect(core.state.merchantNotes["test shop"]).toBe("Always groceries")
  expect(core.state.transactions).toBe(rows)
  expect(patches.some(p => p.merchantNotes)).toBe(true)
  expect(patches.filter(p => p.transactions)).toEqual([])
})
