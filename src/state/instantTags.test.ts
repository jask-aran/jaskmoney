import { afterEach, beforeEach, expect, spyOn, test, type Mock } from "bun:test"
import { data } from "./dataStore"
import { syncTagLinks } from "../up/tags"
import { testEnv } from "../testing/scoped"

type Answer = "ok" | "refuse" | "offline" | Promise<void>
let fetchMock: Mock<typeof fetch>
let answers: Answer[] = []
let sent: { method: string; url: string }[] = []

async function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  data.init(":memory:")
  const db = data.getDb()!
  const tag = await data.createSettingsTag({ name: "COFFEE", color: "#89b4fa", categoryIds: [], about: null })
  const ignore = data.state.tags.find((t) => t.name === "IGNORE")!.id
  const up = Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id, ext_tags)
    VALUES ('2026-01-01', '2026-01-01', -4, 'Cafe', 'up', 'remote-1', '[]')`).run().lastInsertRowid)
  const csv = Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source)
    VALUES ('2026-01-01', '2026-01-01', -4, 'Cafe', 'csv')`).run().lastInsertRowid)
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

test("a sync before Up has the change keeps it: waiting adds stay on, waiting removes stay off", async () => {
  const { db, tag, up } = await setup()
  answers = ["offline"]
  await data.applyTagPatch([up], { [tag]: "add" })
  expect(tagsOf(up)).toEqual([tag])
  expect(queue()).toEqual([{ id: up, tag, action: "add" }])
  db.transaction(() => syncTagLinks(db))()
  data.refresh()
  expect(tagsOf(up)).toEqual([tag])

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

test("retryPendingTags sends what waits; Up refusing a change puts the row back and drops it", async () => {
  const { tag, up } = await setup()
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
  const { tag, ignore, up, csv } = await setup()
  await data.saveSavedFilter({ id: "cafe", name: "Cafe", expr: "desc:Cafe" })
  await data.createSettingsRule({ name: "Cafe coffee", savedFilterId: "cafe", setCategoryId: null, addTagIds: [tag, ignore], enabled: true })
  await data.applyRules([up, csv])
  expect(tagsOf(up).sort()).toEqual([tag, ignore].sort())
  expect(tagsOf(csv).sort()).toEqual([tag, ignore].sort())
  expect(queue()).toEqual([{ id: up, tag, action: "add" }])
  expect(sent).toHaveLength(0)
  expect(await data.retryPendingTags()).toEqual({ pushed: 1, rejected: 0, waiting: 0 })
  expect(queue()).toEqual([])
  expect(extTags(up)).toEqual(["COFFEE"])
})
