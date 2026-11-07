import { afterEach, expect, test } from "bun:test"
import type { McpClient } from "@earendil-works/pi-mcp"
import { ExecutorPaused, findMailApp, type MailAccount, mailAccount } from "./executorSetup"

const paths = {
  list: "tools.executor.appManagement.list",
  accounts: "tools.executor.appAccounts.userList",
}
const app = { id: "app_mail", slug: "gmail", name: "Gmail", requirement: "gmail" }
const account = (state: string) => ({ requirement: "gmail", account: { id: "acc_mail", label: "Test Gmail" }, signIn: { state, reconnectAt: null }, health: { info: { email: "test@example.invalid" } } })
const completed = (value: unknown) => ({ status: "completed", execution: { ok: true, value: { path: "unused", ok: true, value } }, toolCalls: [], unavailableApps: [] })

const clients: Array<{ opened: number; closed: number }> = []
function fake(route: (path: string, input: unknown) => unknown) {
  const counts = { opened: 0, closed: 0 }
  clients.push(counts)
  const calls: Array<{ path: string; input: unknown }> = []
  const connect = async () => {
    counts.opened++
    return {
      callTool: async (...[name, args]: Parameters<McpClient["callTool"]>) => {
        expect(name).toBe("call")
        const call = args?.calls
        if (!call || typeof call !== "object" || !("path" in call) || !("input" in call) || typeof call.path !== "string") throw new Error("Bad call arguments")
        calls.push({ path: call.path, input: call.input })
        const response = await route(call.path, call.input)
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }
      },
      close: async () => { counts.closed++ },
    }
  }
  return { connect, calls, counts }
}

afterEach(() => {
  for (const counts of clients) expect(counts.closed).toBe(counts.opened)
  clients.length = 0
})

test("mailAccount reads the account for the app's requirement and whether it is ready", async () => {
  const cases: Array<[unknown[], MailAccount | null]> = [
    [[{ ...account("saved"), requirement: "other" }, account("saved")], { label: "Test Gmail", email: "test@example.invalid", ready: true }],
    [[{ requirement: "gmail", account: { label: "Test Gmail" }, signIn: { state: "reconnect" } }], { label: "Test Gmail", email: null, ready: false }],
    [[{ requirement: "gmail", account: { label: "Test Gmail" }, signIn: { state: "unavailable" } }], { label: "Test Gmail", email: null, ready: false }],
    [[{ ...account("saved"), health: { info: null } }], { label: "Test Gmail", email: null, ready: true }],
    [[{ ...account("saved"), requirement: "other" }], null],
  ]
  for (const [accounts, expected] of cases) {
    const f = fake(() => completed(accounts))
    expect(await mailAccount(app, f.connect)).toEqual(expected)
    expect(f.calls).toEqual([{ path: paths.accounts, input: { path: { app: app.id } } }])
  }
})

test("call failures preserve Executor's error and close the client", async () => {
  const error = { code: "access_denied", details: { reason: "No account linked" } }
  const cases: Array<[() => unknown, string]> = [
    [() => ({ status: "completed", execution: { ok: false, error: { message: "Permission denied" } } }), "Permission denied"],
    [() => ({ status: "completed", execution: { ok: true, value: { ok: false, error: { message: "Permission denied" } } } }), "Permission denied"],
    [() => ({ status: "completed", execution: { ok: true, value: { ok: false, error: "Permission denied" } } }), "Permission denied"],
    [() => ({ execution: { ok: false, error: { message: "Permission denied" } } }), "Permission denied"],
    [() => ({ status: "completed", execution: { ok: false, error } }), JSON.stringify(error)],
    [() => ({ status: "completed", execution: { ok: true, value: { ok: false, error } } }), JSON.stringify(error)],
    [() => ({}), "invalid"],
    [() => { throw new Error("Transport failed") }, "Transport failed"],
  ]
  for (const [route, message] of cases) {
    const f = fake(route)
    await expect(findMailApp(f.connect)).rejects.toThrow(message)
  }
})

test("a pause throws ExecutorPaused with the request details and the raw response", async () => {
  const response = { status: "awaiting_approval", pending: { interaction: { requestId: "req_1", message: "Approve this request" } }, execution: { ok: false, error: "not completed" } }
  const f = fake(() => response)
  const error = await findMailApp(f.connect).then(() => null, (e: unknown) => e)
  if (!(error instanceof ExecutorPaused)) throw new Error("Expected a pause")
  expect(error.status).toBe("awaiting_approval")
  expect(error.requestId).toBe("req_1")
  expect(error.message).toBe("Approve this request")
  expect(error.interaction).toEqual(response.pending.interaction)
  expect(error.raw).toEqual(response)
  const g = fake(() => ({ status: "input_required" }))
  await expect(findMailApp(g.connect)).rejects.toBeInstanceOf(ExecutorPaused)
})
