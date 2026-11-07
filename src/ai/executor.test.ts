import { expect, test } from "bun:test"
import { COUNT_ORDER_EMAILS, runExecutor } from "./executor"

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError })

test("a program runs through Executor's execute tool: JSON comes back parsed, an error is an error", async () => {
  const calls: unknown[] = []
  const client = (result: ReturnType<typeof text>) => async () => ({ callTool: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return result }, close: async () => {} })
  expect(await runExecutor(COUNT_ORDER_EMAILS, client(text('{"count":3,"more":true}')))).toEqual({ count: 3, more: true })
  expect(calls[0]).toEqual(["execute", { code: COUNT_ORDER_EMAILS }])
  await expect(runExecutor("x", client(text("No Gmail account connected", true)))).rejects.toThrow("No Gmail account connected")
})
