import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore, type CallContext } from "../core/core"
import type { CoreProgress } from "../core/protocol"
import { appToday } from "../domain/days"
import type { TagCandidate, TagTarget } from "../domain/tagSuggest"
import { account, transaction } from "../testing/fixtures"
import { localLink } from "./localLink"
import { createClientStore } from "./store"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const core = createCore()
  const data = createClientStore(localLink(core))
  data.setState({ accounts: [account()], transactions: [transaction({ dateISO: appToday() })], jev: "typesafe" })
  onTestFinished(() => { data.clearFilter(); data.closeTagReview(); core.close() })
  return { core, data }
}

const target: TagTarget = { tagId: null, name: "COFFEE", categoryIds: [], about: null }
const candidate: TagCandidate = { transactionId: 1, confidence: 0.9, source: "jev" }

test("superseded ask errors and progress cannot change the current run", async () => {
  const { core, data } = setup()
  const first = deferred<string[]>()
  const second = deferred<string[]>()
  let oldContext: CallContext<CoreProgress["judgeAsk"]> | undefined
  const call = spyOn(core.commands, "judgeAsk")
    .mockImplementationOnce((_, cx) => { oldContext = cx; return first.promise })
    .mockReturnValueOnce(second.promise)
  onTestFinished(() => call.mockRestore())
  data.commitFilter("ask:coffee")
  const old = data.askAbout()
  const current = data.askAbout()
  expect(oldContext?.signal.aborted).toBe(true)
  oldContext?.progress([[1, 0.9]])
  first.reject(new Error("old ask failed"))
  expect(await old).toBeNull()
  expect(data.askScore(1)).toBeUndefined()
  expect(data.state.asking).toEqual({ words: "coffee", judged: 0, total: 1 })
  second.resolve([])
  expect(await current).not.toBeNull()
  expect(data.state.asking).toBeNull()
})

test("current ask and tag errors reject and clear their busy state", async () => {
  const { core, data } = setup()
  const ask = spyOn(core.commands, "judgeAsk").mockRejectedValue(new Error("current ask failed"))
  const tag = spyOn(core.commands, "tagCandidates").mockRejectedValue(new Error("current tag failed"))
  onTestFinished(() => { ask.mockRestore(); tag.mockRestore() })
  data.commitFilter("ask:coffee")
  await expect(data.askAbout()).rejects.toThrow("current ask failed")
  expect(data.state.asking).toBeNull()
  await expect(data.openTagReview(target)).rejects.toThrow("current tag failed")
  expect(data.state.tagReview?.asking).toBe(false)
})

test("superseded tag errors and progress leave the current review busy", async () => {
  const { core, data } = setup()
  const first = deferred<{ failures: string[]; jev: boolean }>()
  const second = deferred<{ failures: string[]; jev: boolean }>()
  let oldContext: CallContext<CoreProgress["tagCandidates"]> | undefined
  const call = spyOn(core.commands, "tagCandidates")
    .mockImplementationOnce((_, cx) => { oldContext = cx; return first.promise })
    .mockReturnValueOnce(second.promise)
  onTestFinished(() => call.mockRestore())
  const old = data.openTagReview(target)
  const current = data.openTagReview({ ...target, name: "TEA" })
  expect(oldContext?.signal.aborted).toBe(true)
  oldContext?.progress([candidate])
  first.reject(new Error("old review failed"))
  expect(await old).toBe("")
  expect(data.state.tagReview).toMatchObject({ name: "TEA", candidates: {}, asking: true })
  second.resolve({ failures: [], jev: true })
  expect(await current).not.toBe("")
  expect(data.state.tagReview?.asking).toBe(false)
})

test("closing an ask or review swallows its late rejection", async () => {
  const { core, data } = setup()
  const asking = deferred<string[]>()
  const tagging = deferred<{ failures: string[]; jev: boolean }>()
  const ask = spyOn(core.commands, "judgeAsk").mockReturnValue(asking.promise)
  const tag = spyOn(core.commands, "tagCandidates").mockReturnValue(tagging.promise)
  onTestFinished(() => { ask.mockRestore(); tag.mockRestore() })
  data.commitFilter("ask:coffee")
  const oldAsk = data.askAbout()
  data.clearFilter()
  const oldTag = data.openTagReview(target)
  data.closeTagReview()
  asking.reject(new Error("ask cancelled"))
  tagging.reject(new Error("review cancelled"))
  expect(await oldAsk).toBeNull()
  expect(await oldTag).toBe("")
  expect(data.state.asking).toBeNull()
  expect(data.state.tagReview).toBeNull()
})

test("dismissal undo restores only the same opening, even when the tag name is reused", async () => {
  const { core, data } = setup()
  core.open(":memory:")
  core.db!.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, source) VALUES (1, 'x', '2026-10-01', -5, 'Coffee', 'csv')").run()
  const call = spyOn(core.commands, "tagCandidates").mockImplementation(async (_, cx) => {
    cx.progress([candidate])
    return { failures: [], jev: true }
  })
  onTestFinished(() => call.mockRestore())
  await data.openTagReview(target)
  await data.dismissTagCandidates([1])
  expect(data.state.tagReview?.candidates[1]).toBeUndefined()
  await data.undo()
  expect(data.state.tagReview?.candidates[1]).toEqual(candidate)
  await data.dismissTagCandidates([1])
  data.closeTagReview()
  call.mockImplementation(async () => ({ failures: [], jev: true }))
  await data.openTagReview(target)
  await data.undo()
  expect(data.state.tagReview?.candidates[1]).toBeUndefined()
})

test("a session change clears busy state and leaves confidence sorting only in the uncategorised view", async () => {
  const { core, data } = setup()
  const asking = deferred<string[]>()
  const tagging = deferred<{ failures: string[]; jev: boolean }>()
  const ask = spyOn(core.commands, "judgeAsk").mockReturnValue(asking.promise)
  const tag = spyOn(core.commands, "tagCandidates").mockReturnValue(tagging.promise)
  onTestFinished(() => { ask.mockRestore(); tag.mockRestore() })
  data.commitFilter("ask:coffee")
  const oldAsk = data.askAbout()
  const oldTag = data.openTagReview(target)
  data.toggleSortDirection()
  core.set({ session: core.state.session + 1 })
  expect(data.state.asking).toBeNull()
  expect(data.state.tagReview).toBeNull()
  expect(data.state.sortColumn).toBe("date")
  expect(data.state.sortAscending).toBe(false)
  asking.resolve([])
  tagging.resolve({ failures: [], jev: true })
  expect(await oldAsk).toBeNull()
  expect(await oldTag).toBe("")
  data.setUncategorisedOnly(true)
  core.set({ session: core.state.session + 1 })
  expect(data.state.uncategorisedOnly).toBe(true)
  expect(data.state.sortColumn).toBe("confidence")
  data.setUncategorisedOnly(false)
  data.cycleSortColumn()
  core.set({ session: core.state.session + 1 })
  expect(data.state.sortColumn).toBe("amount")
})
