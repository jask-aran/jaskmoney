import { expect, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, Type } from "@earendil-works/pi-ai"
import { agentTool, runAgent } from "./harness"

function fauxLlm() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, llm: { models, model: faux.getModel() } }
}

const count = agentTool({
  name: "count", description: "Count rows a filter finds",
  parameters: Type.Object({ expr: Type.String() }),
  run: ({ expr }) => ({ expr, rows: expr === "desc:Coles" ? 4 : 0 }),
})
const finish = { description: "The rules", parameters: Type.Object({ rules: Type.Array(Type.String()) }) }

test("tools run until finish; its arguments are the result; bad arguments go back as errors", async () => {
  const { faux, llm } = fauxLlm()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("count", { expr: "desc:Coles" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("count", { wrong: 1 })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("finish", { rules: ["desc:Coles"] })], { stopReason: "toolUse" }),
  ])
  const run = await runAgent(llm, { system: "s", prompt: "p", tools: [count], finish })
  expect(run.result).toEqual({ rules: ["desc:Coles"] })
  expect(run.turns).toBe(3)
  expect(run.calls.map((c) => c.name)).toEqual(["count", "count", "finish"])
})
