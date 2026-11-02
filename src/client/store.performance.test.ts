import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore } from "../core/core"
import { appToday } from "../domain/days"
import { account, category, transaction } from "../testing/fixtures"
import { localLink } from "./localLink"
import { createClientStore } from "./store"

function setup() {
  const core = createCore()
  const data = createClientStore(localLink(core))
  data.setState({ accounts: [account()], transactions: [transaction({ dateISO: appToday() })], jev: "typesafe", ready: true })
  onTestFinished(() => { data.clearFilter(); core.close() })
  return { core, data }
}

test("rule offers ignore unrelated patches and debounce all calculation inputs for 150 ms", async () => {
  const { data } = setup()
  await Bun.sleep(180)
  const timers = spyOn(globalThis, "setTimeout")
  onTestFinished(() => timers.mockRestore())
  const before = data.allRuleOffers()
  data.setState({ version: data.state.version + 1, upSyncing: true })
  expect(data.allRuleOffers()).toBe(before)
  expect(timers.mock.calls.filter(([, ms]) => ms === 150)).toHaveLength(0)

  const patches = [
    { transactions: [...data.transactions()] },
    { categoryChoices: [{ description: "x", categoryId: 1, times: 3, declined: false }] },
    { categories: [category()] },
    { rules: [...data.state.rules] },
    { tags: [...data.state.tags] },
    { savedFilters: [...data.state.savedFilters] },
    { aiRuleOffers: [...data.state.aiRuleOffers] },
  ]
  for (const patch of patches) {
    const previous = data.allRuleOffers()
    data.setState(patch)
    expect(data.allRuleOffers()).not.toBe(previous)
  }
  expect(timers.mock.calls.filter(([, ms]) => ms === 150)).toHaveLength(patches.length)
  expect(data.ruleOfferCount()).toBe(0)
  // Supply a categorised example, then make another write before the timer.
  data.setState({ transactions: [transaction({ categoryId: 1, categoryName: "Category 1" })] })
  await Bun.sleep(90)
  data.setState({ categoryChoices: [...data.state.categoryChoices] })
  await Bun.sleep(90)
  expect(data.ruleOfferCount()).toBe(0)
  await Bun.sleep(90)
  expect(data.ruleOfferCount()).toBe(1)
})

test("ask verdicts evict the least recently used phrase, including recency from filter reuse", async () => {
  const { core, data } = setup()
  const judge = spyOn(core.commands, "judgeAsk").mockImplementation(async (_, cx) => {
    cx.progress([[1, 0.95]])
    return []
  })
  onTestFinished(() => judge.mockRestore())
  for (let i = 0; i < 8; i++) {
    data.commitFilter(`ask:phrase${i}`)
    await data.askAbout()
  }
  data.commitFilter("ask:phrase0")
  expect(data.askScore(1)).toBe(0.95)
  data.commitFilter("ask:phrase8")
  await data.askAbout()
  data.commitFilter("ask:phrase0")
  expect(data.askScore(1)).toBe(0.95)
  await data.askAbout()
  expect(judge).toHaveBeenCalledTimes(9)
  data.commitFilter("ask:phrase1")
  expect(data.askScore(1)).toBeUndefined()
  await data.askAbout()
  expect(judge).toHaveBeenCalledTimes(10)
})

test("all active ask phrases stay cached; leaving an oversized filter restores the bound", async () => {
  const { core, data } = setup()
  const judge = spyOn(core.commands, "judgeAsk").mockImplementation(async (_, cx) => {
    cx.progress([[1, 0.95]])
    return []
  })
  onTestFinished(() => judge.mockRestore())
  data.commitFilter(Array.from({ length: 10 }, (_, i) => `ask:active${i}`).join(" "))
  await data.askAbout()
  expect(judge).toHaveBeenCalledTimes(10)
  await data.askAbout()
  expect(judge).toHaveBeenCalledTimes(10)
  data.commitFilter("ask:active9")
  expect(data.askScore(1)).toBe(0.95)
  data.commitFilter("ask:active0")
  expect(data.askScore(1)).toBeUndefined()
})
