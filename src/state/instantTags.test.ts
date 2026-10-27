import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test"
import { data } from "./dataStore"
import { syncTagLinks } from "../up/tags"
import { testEnv } from "../testing/scoped"

/**
 * Backlog 3, instant tags (acceptance, frozen): a tag change on an Up row
 * shows here at once, like a category; what Up hasn't confirmed waits in
 * `tag_pushes` (transaction_id, tag_id, action 'add' | 'remove'), which a
 * sync honours (Up's tags win except for waiting changes) and
 * retryPendingTags() sends after it. Up refusing puts the row back.
 */

type Answer = "ok" | "refuse" | "offline" | Promise<void>
let fetchMock: Mock<typeof fetch>
let answers: Answer[] = []
let sent: { method: string; url: string }[] = []

function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  data.init(":memory:")
  const db = data.getDb()!
  const tag = data.createSettingsTag({ name: "COFFEE", color: "#89b4fa", scope: null })
  const ignore = data.state.tags.find((t) => t.name === "IGNORE")!.id
  const up = Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id, ext_tags)
    VALUES ('2026-01-01', '2026-01-01', -4, 'Cafe', 'up', 'remote-1', '[]')`).run().lastInsertRowid)
  const csv = Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source)
    VALUES ('2026-01-01', '2026-01-01', -4, 'Cafe', 'csv')`).run().lastInsertRowid)
  // Up knows the tag already, so a sync reconciles its links.
  db.query("UPDATE tags SET ext_id = 'COFFEE' WHERE id = ?").run(tag)
  data.refresh()
  return { db, tag, ignore, up, csv }
}

const tagsOf = (id: number) => data.state.transactions.find((t) => t.id === id)!.tagIds
const queue = () => data.getDb()!.query("SELECT transaction_id AS id, tag_id AS tag, action FROM tag_pushes ORDER BY transaction_id, tag_id").all()
const extTags = (id: number) => JSON.parse((data.getDb()!.query("SELECT ext_tags FROM transactions WHERE id = ?").get(id) as { ext_tags: string }).ext_tags) as string[]

beforeEach(() => {
  answers = []
  sent = []
  fetchMock = spyOn(globalThis, "fetch")
  fetchMock.mockImplementation(Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ method: init?.method ?? "GET", url: String(input) })
    const answer = answers.shift() ?? "ok"
    if (answer === "offline") throw new TypeError("fetch failed")
    if (answer === "refuse") return new Response(JSON.stringify({ errors: [{ status: "422", title: "Invalid", detail: "refused" }] }), { status: 422 })
    if (answer !== "ok") await answer
    return new Response(null, { status: 204 })
  }, { preconnect: globalThis.fetch.preconnect }) as typeof fetch)
})
afterEach(() => { fetchMock.mockRestore(); data.getDb()?.close() })

test("a tag added to an Up row shows at once, waits in the queue, and leaves it once Up confirms", async () => {
  const { tag, up } = setup()
  let confirm = () => {}
  answers = [new Promise<void>((resolve) => { confirm = resolve })]
  const applying = data.applyTagPatch([up], { [tag]: "add" })
  // Before Up answers.
  expect(tagsOf(up)).toEqual([tag])
  expect(queue()).toEqual([{ id: up, tag, action: "add" }])
  confirm()
  await applying
  expect(tagsOf(up)).toEqual([tag])
  expect(queue()).toEqual([])
  expect(extTags(up)).toEqual(["COFFEE"])
  expect(sent).toHaveLength(1)
})

test("a sync before Up has the change keeps it: waiting adds stay on, waiting removes stay off", async () => {
  const { db, tag, up } = setup()
  answers = ["offline"]
  await data.applyTagPatch([up], { [tag]: "add" })
  expect(tagsOf(up)).toEqual([tag])
  expect(queue()).toEqual([{ id: up, tag, action: "add" }])
  db.transaction(() => syncTagLinks(db))()
  data.refresh()
  expect(tagsOf(up)).toEqual([tag])

  // Up has the tag; removing it while Up is offline keeps it off through a sync.
  answers = []
  await data.retryPendingTags()
  expect(extTags(up)).toEqual(["COFFEE"])
  answers = ["offline"]
  await data.applyTagPatch([up], { [tag]: "remove" })
  expect(tagsOf(up)).toEqual([])
  expect(queue()).toEqual([{ id: up, tag, action: "remove" }])
  db.transaction(() => syncTagLinks(db))()
  data.refresh()
  expect(tagsOf(up)).toEqual([])
})

test("the latest change to a row's tag is the one that waits", async () => {
  const { tag, up } = setup()
  answers = ["offline", "offline"]
  await data.applyTagPatch([up], { [tag]: "add" })
  await data.applyTagPatch([up], { [tag]: "remove" })
  expect(tagsOf(up)).toEqual([])
  expect(queue()).toEqual([{ id: up, tag, action: "remove" }])
})

test("retryPendingTags sends what waits; Up refusing a change puts the row back and drops it", async () => {
  const { tag, up } = setup()
  answers = ["offline"]
  await data.applyTagPatch([up], { [tag]: "add" })
  answers = ["offline"]
  expect(await data.retryPendingTags()).toEqual({ pushed: 0, rejected: 0, waiting: 1 })
  expect(queue()).toHaveLength(1)
  answers = ["refuse"]
  expect(await data.retryPendingTags()).toEqual({ pushed: 0, rejected: 1, waiting: 0 })
  expect(queue()).toEqual([])
  expect(tagsOf(up)).toEqual([])

  answers = ["refuse"]
  const summary = await data.applyTagPatch([up], { [tag]: "add" })
  expect(tagsOf(up)).toEqual([])
  expect(queue()).toEqual([])
  expect(summary).toContain("refused")
})

test("rules that add a tag to an Up row queue it like a pick; local rows and IGNORE never queue", async () => {
  const { tag, ignore, up, csv } = setup()
  data.saveSavedFilter({ id: "cafe", name: "Cafe", expr: "desc:Cafe" })
  data.createSettingsRule({ name: "Cafe coffee", savedFilterId: "cafe", setCategoryId: null, addTagIds: [tag, ignore], enabled: true })
  data.applyRules([up, csv])
  expect(tagsOf(up).sort()).toEqual([tag, ignore].sort())
  expect(tagsOf(csv).sort()).toEqual([tag, ignore].sort())
  expect(queue()).toEqual([{ id: up, tag, action: "add" }])
  expect(sent).toHaveLength(0)
  expect(await data.retryPendingTags()).toEqual({ pushed: 1, rejected: 0, waiting: 0 })
  expect(queue()).toEqual([])
  expect(extTags(up)).toEqual(["COFFEE"])
})

test("Up's six-tag limit: an add past it changes nothing and queues nothing", async () => {
  const { db, tag, up } = setup()
  db.query("UPDATE transactions SET ext_tags = ? WHERE id = ?").run(JSON.stringify(["A", "B", "C", "D", "E", "F"]), up)
  data.refresh()
  const summary = await data.applyTagPatch([up], { [tag]: "add" })
  expect(tagsOf(up)).not.toContain(tag)
  expect(queue()).toEqual([])
  expect(sent).toHaveLength(0)
  expect(summary).toContain("6 tags")
})
