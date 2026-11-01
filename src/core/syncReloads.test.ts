import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore } from "./core"
import type { CoreState } from "./protocol"
import { testEnv } from "../testing/scoped"
import type { UpAccount, UpPage, UpTransaction } from "../up/types"

/**
 * How often a client is sent every row: each time costs it a re-derive of
 * everything that reads them (the whole history on a first sync).
 */

const money = (cents: number) => ({ currencyCode: "AUD", value: (cents / 100).toFixed(2), valueInBaseUnits: cents })
const upAccount = (displayName = "Daily", cents = 100): UpAccount => ({ type: "accounts", id: "daily", attributes: { displayName, accountType: "TRANSACTIONAL", ownershipType: "INDIVIDUAL", balance: money(cents), createdAt: "2026-01-01T00:00:00+11:00" } })
const row = (id: string): UpTransaction => ({ type: "transactions", id, attributes: { status: "SETTLED", rawText: "RAW", description: "Shop", message: null, amount: money(-500), foreignAmount: null, createdAt: "2026-02-01T10:00:00+11:00", settledAt: "2026-02-01T12:00:00+11:00", transactionType: null, isCategorizable: true, roundUp: null, cashback: null, cardPurchaseMethod: null }, relationships: {
  account: { data: { type: "accounts", id: "daily" } }, transferAccount: { data: null },
  category: { data: null }, parentCategory: { data: null }, tags: { data: [] },
} })
const page = <T>(data: T[]) => Response.json({ data, links: { prev: null, next: null } } satisfies UpPage<T>)

function syncingCore(up = { account: upAccount() }) {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/categories")) return page([])
    if (url.pathname.endsWith("/accounts")) return page([up.account])
    return page([row("t1"), row("t2"), row("t3"), row("t4")])
  }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => fetchMock.mockRestore())
  const core = createCore()
  core.open(":memory:")
  onTestFinished(() => { core.close(); core.dispose() })
  const patches: Partial<CoreState>[] = []
  const stop = core.subscribe((patch) => patches.push(patch))
  onTestFinished(stop)
  patches.length = 0
  return { core, patches, up }
}

test("a first sync sends the rows once when no rule changes any and nothing waits for Up", async () => {
  const { core, patches } = syncingCore()
  core.commands.saveSavedFilter({ filter: { id: "never", name: "Never", expr: "desc:nothing-like-this" } })
  core.commands.createRule({ input: { name: "Never", savedFilterId: "never", setCategoryId: core.state.categories[0]!.id, addTagIds: [], enabled: true } })
  patches.length = 0
  expect(await core.commands.syncUp({})).toStartWith("Up sync: 4 new")
  expect(patches.filter((p) => p.transactions).map((p) => p.transactions!.length)).toEqual([4])
  expect(core.state.upSyncing).toBe(false)
})

test("a history suggestion round sends the suggestions, not the rows", async () => {
  const { core, patches } = syncingCore()
  await core.commands.syncUp({})
  const food = core.state.categories.find((c) => !c.isDefault && c.parentId != null)!.id
  core.db!.query("UPDATE transactions SET category_id = ?, category_source = 'user' WHERE external_id <> 't4'").run(food)
  core.refresh()
  patches.length = 0
  await core.commands.suggestCategories({}, { progress: () => {}, signal: new AbortController().signal })
  const t2 = core.state.transactions.find((t) => t.description === "Shop" && t.categoryId !== food)!
  expect(core.state.suggestions[t2.id]?.categoryId).toBe(food)
  expect(patches.some((p) => p.suggestions)).toBe(true)
  expect(patches.filter((p) => p.transactions)).toEqual([])
})

test("a sync that changes no row sends none; one that renames their account sends them", async () => {
  const { core, patches, up } = syncingCore()
  await core.commands.syncUp({})
  patches.length = 0
  // The balance moved: the accounts go, the rows don't.
  up.account = upAccount("Daily", 250)
  expect(await core.commands.syncUp({})).toStartWith("Up sync: 0 new, 0 updated")
  expect(patches.some((p) => p.accounts)).toBe(true)
  expect(patches.filter((p) => p.transactions)).toEqual([])
  up.account = upAccount("Everyday", 250)
  await core.commands.syncUp({})
  expect(patches.filter((p) => p.transactions).map((p) => p.transactions!.map((t) => t.accountName))).toEqual([["Everyday", "Everyday", "Everyday", "Everyday"]])
})
