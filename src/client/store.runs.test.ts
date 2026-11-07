import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore, type CallContext } from "../core/core"
import type { CoreProgress } from "../core/protocol"
import { appToday } from "../domain/days"
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
