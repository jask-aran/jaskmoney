import { afterEach, expect, spyOn, test } from "bun:test"
import type { McpClient } from "@earendil-works/pi-mcp"
import { callApp, ensureMailApp, ExecutorPaused, findMailApp, gmailConnectLink, installGmail, mailAccount, waitForMailAccount } from "./executorSetup"

const paths = {
  list: "tools.executor.appManagement.list",
  catalog: "tools.executor.organization.catalog",
  install: "tools.executor.apps.install",
  accounts: "tools.executor.appAccounts.userList",
  connect: "tools.executor.appAccounts.userConnect",
}
const app = { id: "app_mail", slug: "gmail", name: "Gmail", requirement: "gmail" }
const gmail = { id: app.id, slug: app.slug, name: app.name, copiedFrom: { name: "@executor.sh/gmail" }, requirements: { accounts: { gmail: { scope: "user" } } } }
const google = { ...gmail, id: "app_google", slug: "google", name: "Google", copiedFrom: { name: "@executor.sh/google" }, requirements: { accounts: { google: { scope: "user" } } } }
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

test("find prefers Gmail over an earlier Google bundle", async () => {
  const f = fake(() => completed([google, gmail]))
  expect(await findMailApp(f.connect)).toEqual(app)
  expect(f.calls).toEqual([{ path: paths.list, input: {} }])
})

test("find falls back to Google and picks the first user requirement", async () => {
  const f = fake(() => completed([{ ...google, requirements: { accounts: {
    shared: { scope: "app" }, google: { scope: "user" }, second: { scope: "user" },
  } } }]))
  expect(await findMailApp(f.connect)).toEqual({ id: "app_google", slug: "google", name: "Google", requirement: "google" })
})

test("find falls back to the first requirement when scope is absent or app", async () => {
  const f = fake(() => completed([{ ...gmail, requirements: { accounts: { first: {}, second: { scope: "app" } } } }]))
  expect(await findMailApp(f.connect)).toEqual({ ...app, requirement: "first" })
})

test("unrelated apps do not count as installed mail", async () => {
  const f = fake(() => completed([{ ...gmail, copiedFrom: null }]))
  expect(await findMailApp(f.connect)).toBeNull()
})

test("find skips mail apps with missing or empty account requirements", async () => {
  const empty = { ...gmail, requirements: { accounts: {} } }
  const missing = { ...gmail, requirements: {} }
  const f = fake(() => completed([empty, missing, google]))
  expect(await findMailApp(f.connect)).toEqual({ id: "app_google", slug: "google", name: "Google", requirement: "google" })
  const g = fake(() => completed([empty, missing, gmail]))
  expect(await findMailApp(g.connect)).toEqual(app)
  const h = fake(() => completed([empty, missing]))
  expect(await findMailApp(h.connect)).toBeNull()
})

test("ensure installs Gmail from the catalog when no mail app is installed", async () => {
  const f = fake((path) => {
    if (path === paths.list) return completed([])
    if (path === paths.catalog) return completed([{ id: "other" }, { id: "gmail", package: "@executor.sh/gmail", name: "Gmail" }])
    if (path === paths.install) return completed(gmail)
    throw new Error(`Unexpected path: ${path}`)
  })
  expect(await ensureMailApp(f.connect)).toEqual({ app, installed: true })
  expect(f.calls).toEqual([
    { path: paths.list, input: {} },
    { path: paths.catalog, input: { query: { search: "gmail", limit: "5" } } },
    { path: paths.install, input: { body: { entry: "gmail", name: "Gmail" } } },
  ])
  expect(f.counts).toEqual({ opened: 2, closed: 2 })
})

test("ensure reuses an installed mail app", async () => {
  const f = fake(() => completed([gmail]))
  expect(await ensureMailApp(f.connect)).toEqual({ app, installed: false })
  expect(f.calls).toHaveLength(1)
})

test("install rejects a missing Gmail catalog entry and closes", async () => {
  const f = fake(() => completed([{ id: "other" }]))
  await expect(installGmail(f.connect)).rejects.toThrow("Executor's catalog has no Gmail app")
  expect(f.calls).toHaveLength(1)
})

test("mailAccount matches the requirement and reports the saved account", async () => {
  const f = fake(() => completed([{ ...account("saved"), requirement: "other" }, account("saved")]))
  expect(await mailAccount(app, f.connect)).toEqual({ label: "Test Gmail", email: "test@example.invalid", ready: true })
  expect(f.calls).toEqual([{ path: paths.accounts, input: { path: { app: app.id } } }])
})

test.each(["reconnect", "unavailable"])("mailAccount is not ready for %s and tolerates missing health", async (state) => {
  const f = fake(() => completed([{ requirement: "gmail", account: { label: "Test Gmail" }, signIn: { state } }]))
  expect(await mailAccount(app, f.connect)).toEqual({ label: "Test Gmail", email: null, ready: false })
})

test("mailAccount tolerates null health info", async () => {
  const f = fake(() => completed([{ ...account("saved"), health: { info: null } }]))
  expect(await mailAccount(app, f.connect)).toEqual({ label: "Test Gmail", email: null, ready: true })
})

test("mailAccount returns null when the requirement has no account", async () => {
  const f = fake(() => completed([{ ...account("saved"), requirement: "other" }]))
  expect(await mailAccount(app, f.connect)).toBeNull()
})

test("connect returns the browser approval URL", async () => {
  const f = fake(() => completed({ status: "pending", url: "https://example.invalid/approve", redirectUri: "unused" }))
  expect(await gmailConnectLink(app, f.connect)).toEqual({ url: "https://example.invalid/approve" })
  expect(f.calls).toEqual([{ path: paths.connect, input: { path: { app: app.id, requirement: app.requirement }, body: {} } }])
})

test("connect rejects a missing URL and closes", async () => {
  const f = fake(() => completed({ status: "cancelled" }))
  await expect(gmailConnectLink(app, f.connect)).rejects.toThrow("Executor gave no Gmail sign-in address")
})

test.each([
  { status: "completed", execution: { ok: false, error: { message: "Permission denied" } } },
  { status: "completed", execution: { ok: true, value: { ok: false, error: { message: "Permission denied" } } } },
  { status: "completed", execution: { ok: true, value: { ok: false, error: "Permission denied" } } },
])("call failures preserve Executor's message and close", async (response) => {
  const f = fake(() => response)
  await expect(findMailApp(f.connect)).rejects.toThrow("Permission denied")
})

test.each([false, true])("object errors without a message preserve their JSON (inner: %s)", async (inner) => {
  const error = { code: "access_denied", details: { reason: "No account linked" } }
  const failed = { ok: false, error }
  const f = fake(() => ({ status: "completed", execution: inner ? { ok: true, value: failed } : failed }))
  await expect(findMailApp(f.connect)).rejects.toThrow(JSON.stringify(error))
})

test("missing status accepts a valid execution rather than pausing", async () => {
  const f = fake(() => ({ execution: completed([gmail]).execution }))
  expect(await findMailApp(f.connect)).toEqual(app)
})

test("missing status still surfaces execution errors", async () => {
  const f = fake(() => ({ execution: { ok: false, error: { message: "Permission denied" } } }))
  await expect(findMailApp(f.connect)).rejects.toThrow("Permission denied")
})

test("missing execution is an invalid response, not a pause", async () => {
  const f = fake(() => ({}))
  await expect(findMailApp(f.connect)).rejects.toThrow("Executor gave an invalid call response")
})

test("a pause keeps nested request details and the raw response", async () => {
  const response = { status: "awaiting_approval", pending: { interaction: { requestId: "req_1", message: "Approve this request" } }, execution: { ok: false, error: "not completed" } }
  const f = fake(() => response)
  try {
    await findMailApp(f.connect)
    throw new Error("Expected a pause")
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutorPaused)
    if (!(error instanceof ExecutorPaused)) throw error
    expect(error.status).toBe("awaiting_approval")
    expect(error.requestId).toBe("req_1")
    expect(error.message).toBe("Approve this request")
    expect(error.pending).toEqual(response.pending)
    expect(error.interaction).toEqual(response.pending.interaction)
    expect(error.raw).toEqual(response)
  }
})

test("a pause with no optional details still throws ExecutorPaused", async () => {
  const f = fake(() => ({ status: "input_required" }))
  await expect(findMailApp(f.connect)).rejects.toBeInstanceOf(ExecutorPaused)
})

test("callApp returns only the inner value and leaves its caller's client open", async () => {
  const f = fake(() => completed({ result: 42 }))
  const client = await f.connect()
  try {
    expect(await callApp(client, paths.list, {})).toEqual({ result: 42 })
    expect(f.counts.closed).toBe(0)
  } finally { await client.close() }
})

test("a transport failure still closes the client", async () => {
  const f = fake(() => { throw new Error("Transport failed") })
  await expect(findMailApp(f.connect)).rejects.toThrow("Transport failed")
})

test("wait resolves after three polls and closes every connection", async () => {
  let polls = 0
  const f = fake(() => completed(++polls === 1 ? [] : [account(polls === 3 ? "saved" : "reconnect")]))
  expect(await waitForMailAccount(app, { signal: new AbortController().signal, everyMs: 1, connect: f.connect }))
    .toEqual({ label: "Test Gmail", email: "test@example.invalid", ready: true })
  expect(polls).toBe(3)
  expect(f.counts).toEqual({ opened: 3, closed: 3 })
})

test("wait rejects on abort during the polling delay and stops polling", async () => {
  const controller = new AbortController()
  const f = fake(() => {
    setTimeout(() => controller.abort(), 1)
    return completed([])
  })
  await expect(waitForMailAccount(app, { signal: controller.signal, everyMs: 20, connect: f.connect })).rejects.toThrow("cancelled")
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(f.calls).toHaveLength(1)
})

test("abort clears a long polling timer immediately", async () => {
  const controller = new AbortController()
  const timers = spyOn(globalThis, "setTimeout")
  const clears = spyOn(globalThis, "clearTimeout")
  try {
    const f = fake(() => {
      setTimeout(() => controller.abort(), 1)
      return completed([])
    })
    await expect(waitForMailAccount(app, { signal: controller.signal, everyMs: 60_000, connect: f.connect })).rejects.toThrow("cancelled")
    const scheduled = timers.mock.calls.findIndex((call) => call[1] === 60_000)
    expect(scheduled).toBeGreaterThanOrEqual(0)
    expect(clears).toHaveBeenCalledWith(timers.mock.results[scheduled]?.value)
  } finally {
    timers.mockRestore()
    clears.mockRestore()
  }
})

test("the polling delay starts after the previous call finishes", async () => {
  let polls = 0
  let finishedAt = 0
  let delay = 0
  const f = fake(async () => {
    if (++polls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      finishedAt = Date.now()
      return completed([])
    }
    delay = Date.now() - finishedAt
    return completed([account("saved")])
  })
  await waitForMailAccount(app, { signal: new AbortController().signal, everyMs: 20, connect: f.connect })
  expect(delay).toBeGreaterThanOrEqual(19)
  expect(polls).toBe(2)
})

test("wait rejects before connecting if already aborted", async () => {
  const controller = new AbortController()
  controller.abort()
  const f = fake(() => completed([]))
  await expect(waitForMailAccount(app, { signal: controller.signal, connect: f.connect })).rejects.toThrow("cancelled")
  expect(f.counts.opened).toBe(0)
})

test("wait cancels an in-flight poll and closes it when the call returns", async () => {
  const controller = new AbortController()
  let finish: (value: unknown) => void = () => {}
  const f = fake(() => new Promise((resolve) => { finish = resolve; controller.abort() }))
  await expect(waitForMailAccount(app, { signal: controller.signal, everyMs: 1, connect: f.connect })).rejects.toThrow("cancelled")
  finish(completed([account("saved")]))
  await new Promise((resolve) => setTimeout(resolve, 5))
  expect(f.calls).toHaveLength(1)
})

test("wait surfaces call failures and closes", async () => {
  const f = fake(() => ({ status: "completed", execution: { ok: false, error: "Account lookup failed" } }))
  await expect(waitForMailAccount(app, { signal: new AbortController().signal, everyMs: 1, connect: f.connect })).rejects.toThrow("Account lookup failed")
})
