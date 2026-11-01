import { expect, onTestFinished, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { transaction } from "../testing/fixtures"
import { suggestNew } from "./suggest"

test.each(["Category suggestions are already running", "suggestion failed"])("background rows remain untried after: %s", async (message) => {
  data.setState({ transactions: [transaction()] })
  const call = spyOn(data.core.commands, "suggestCategories")
    .mockRejectedValueOnce(new Error(message))
    .mockResolvedValue("Suggested 0: 0 from history, 0 from Jev")
  onTestFinished(() => call.mockRestore())
  expect(await suggestNew(data)).toBe(0)
  expect(data.untriedWaiting()).toEqual([1])
  expect(await suggestNew(data)).toBe(0)
  expect(data.untriedWaiting()).toEqual([])
  expect(await suggestNew(data)).toBe(0)
  expect(call).toHaveBeenCalledTimes(2)
})

test("a successful suggestion call marks rows only after it resolves", async () => {
  data.setState({ transactions: [transaction()] })
  let resolve!: (value: string) => void
  const answer = new Promise<string>((yes) => { resolve = yes })
  const call = spyOn(data.core.commands, "suggestCategories").mockReturnValue(answer)
  onTestFinished(() => call.mockRestore())
  const running = suggestNew(data)
  expect(data.untriedWaiting()).toEqual([1])
  resolve("Suggested 0: 0 from history, 0 from Jev")
  expect(await running).toBe(0)
  expect(data.untriedWaiting()).toEqual([])
})

test("a late successful suggestion call cannot mark another session's reused ids", async () => {
  data.setState({ transactions: [transaction()] })
  let resolve!: (value: string) => void
  const answer = new Promise<string>((yes) => { resolve = yes })
  const call = spyOn(data.core.commands, "suggestCategories").mockReturnValue(answer)
  onTestFinished(() => call.mockRestore())
  const running = suggestNew(data)
  data.setState({ session: data.state.session + 1 })
  resolve("Suggested 0: 0 from history, 0 from Jev")
  expect(await running).toBe(0)
  expect(data.untriedWaiting()).toEqual([1])
})
