import { expect, onTestFinished, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { transaction } from "../testing/fixtures"
import { runBackgroundRefresh } from "./backgroundRefresh"
import { purchaseSources } from "./purchases"
import { runSync } from "./sync"

const SUMMARY = "Up sync: 0 new, 0 updated, 0 pending removed"

function setup() {
  const saved = { ...purchaseSources }
  onTestFinished(() => Object.assign(purchaseSources, saved))
  // Empty rows take the no-due path; any mail request would be a test failure.
  purchaseSources.signedIn = () => true
  purchaseSources.accounts = async () => { throw new Error("unexpected Gmail call") }
  purchaseSources.run = async () => { throw new Error("unexpected mail call") }
  const record = spyOn(data, "recordPurchases").mockResolvedValue(0)
  const sync = spyOn(data, "syncUp").mockResolvedValue(SUMMARY)
  onTestFinished(() => { record.mockRestore(); sync.mockRestore() })
  return { record, sync }
}

test("background refresh awaits purchase recording before suggesting and returns both counts", async () => {
  const { record } = setup()
  data.setState({ transactions: [transaction()] })
  let resolve!: (value: number) => void
  const purchases = new Promise<number>((yes) => { resolve = yes })
  record.mockReturnValue(purchases)
  const suggest = spyOn(data.core.commands, "suggestCategories").mockImplementation(async () => {
    data.setState("suggestions", { 1: { transactionId: 1, categoryId: 1, confidence: 0.9, source: "history" } })
    return "Suggested 1: 1 from history, 0 from Jev"
  })
  onTestFinished(() => suggest.mockRestore())
  const running = runBackgroundRefresh(data)
  expect(record).toHaveBeenCalledWith([], undefined, data.state.session)
  expect(suggest).not.toHaveBeenCalled()
  resolve(2)
  expect(await running).toEqual({
    purchases: { looked: 0, found: 0, resuggested: 2, error: null }, suggested: 1, error: null,
  })
  expect(suggest).toHaveBeenCalledTimes(1)
})

test("a quiet purchase error still permits new suggestions", async () => {
  const { record } = setup()
  data.setState({ transactions: [transaction()] })
  record.mockRejectedValue(new Error("purchase save failed"))
  const suggest = spyOn(data.core.commands, "suggestCategories").mockResolvedValue("Suggested 0")
  onTestFinished(() => suggest.mockRestore())
  expect(await runBackgroundRefresh(data)).toEqual({
    purchases: { looked: 0, found: 0, resuggested: 0, error: "purchase save failed" }, suggested: 0, error: null,
  })
  expect(suggest).toHaveBeenCalledTimes(1)
})

test.each([false, true])("both sync branches refresh once and preserve suggestion status with upToken=%s", async (upToken) => {
  const { record, sync } = setup()
  const calls: string[] = []
  data.setState({ upToken, transactions: [transaction()] })
  sync.mockImplementation(async () => { calls.push("sync"); return SUMMARY })
  record.mockImplementation(async () => { calls.push("purchases"); return 0 })
  const suggest = spyOn(data.core.commands, "suggestCategories").mockImplementation(async () => {
    calls.push("suggest")
    data.setState("suggestions", { 1: { transactionId: 1, categoryId: 1, confidence: 0.9, source: "history" } })
    return "Suggested 1"
  })
  onTestFinished(() => suggest.mockRestore())
  await runSync(ui, data, { manual: false })
  expect(calls).toEqual(upToken ? ["sync", "purchases", "suggest"] : ["purchases", "suggest"])
  if (upToken) expect(ui.state.status).toContain(SUMMARY)
  expect(ui.state.status).toContain("suggestion")
  expect(ui.state.statusErr).toBe(false)
})

test("manual sync looks up purchases only after the Up sync answers", async () => {
  const { sync, record } = setup()
  data.setState({ upToken: true })
  let resolve!: (value: string) => void
  const pending = new Promise<string>((yes) => { resolve = yes })
  sync.mockReturnValue(pending)
  const running = runSync(ui, data, { manual: true })
  expect(record).not.toHaveBeenCalled()
  resolve(SUMMARY)
  await running
  expect(record).toHaveBeenCalledTimes(1)
})

test("sync refuses in demo, without a token and while running; a quiet refresh keeps the status unless it has news", async () => {
  const { sync, record } = setup()
  data.setState({ demo: true, upToken: true })
  await runSync(ui, data, { manual: true })
  data.setState({ demo: false, upToken: false })
  await runSync(ui, data, { manual: true })
  data.setState({ upToken: true, upSyncing: true })
  await runSync(ui, data, { manual: true })
  expect(sync).not.toHaveBeenCalled()
  expect(record).not.toHaveBeenCalled()
  data.setState({ upSyncing: false })
  ui.setStatus("keep this status")
  await runSync(ui, data, { manual: false })
  expect(ui.state.status).toBe("keep this status")
  sync.mockResolvedValueOnce("Up sync: 1 new, 0 updated, 0 pending removed")
  await runSync(ui, data, { manual: false })
  expect(ui.state.status).toBe("Up sync: 1 new, 0 updated, 0 pending removed")
  sync.mockRejectedValueOnce(new Error("Up sync failed"))
  await runSync(ui, data, { manual: false })
  expect(ui.state.status).toBe("Up sync failed")
  expect(ui.state.statusErr).toBe(true)
})
