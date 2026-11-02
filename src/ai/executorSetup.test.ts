import { afterEach, expect, test } from "bun:test"
import type { McpClient } from "@earendil-works/pi-mcp"
import { callApp, ensureMailApp, ExecutorPaused, findMailApp, gmailConnectLink, installGmail, type MailAccount, type MailApp, mailAccount, waitForMailAccount } from "./executorSetup"

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

test("find picks the mail app and its user account requirement", async () => {
  const empty = { ...gmail, requirements: { accounts: {} } }
  const missing = { ...gmail, requirements: {} }
  const cases: Array<[unknown[], MailApp | null]> = [
    [[google, gmail], app],
    [[{ ...google, requirements: { accounts: { shared: { scope: "app" }, google: { scope: "user" }, second: { scope: "user" } } } }], { ...app, id: "app_google", slug: "google", name: "Google", requirement: "google" }],
    [[{ ...gmail, requirements: { accounts: { first: {}, second: { scope: "app" } } } }], { ...app, requirement: "first" }],
    [[{ ...gmail, copiedFrom: null }], null],
    [[empty, missing, google], { ...app, id: "app_google", slug: "google", name: "Google", requirement: "google" }],
    [[empty, missing], null],
  ]
  for (const [apps, expected] of cases) {
    const f = fake(() => completed(apps))
    expect(await findMailApp(f.connect)).toEqual(expected)
    expect(f.calls).toEqual([{ path: paths.list, input: {} }])
  }
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
})

test("ensure reuses an installed mail app", async () => {
  const f = fake(() => completed([gmail]))
  expect(await ensureMailApp(f.connect)).toEqual({ app, installed: false })
  expect(f.calls).toHaveLength(1)
})

test("install rejects a missing Gmail catalog entry", async () => {
  const f = fake(() => completed([{ id: "other" }]))
  await expect(installGmail(f.connect)).rejects.toThrow()
  expect(f.calls).toHaveLength(1)
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

test("connect returns the browser approval URL, and rejects without one", async () => {
  const f = fake(() => completed({ status: "pending", url: "https://example.invalid/approve", redirectUri: "unused" }))
  expect(await gmailConnectLink(app, f.connect)).toEqual({ url: "https://example.invalid/approve" })
  expect(f.calls).toEqual([{ path: paths.connect, input: { path: { app: app.id, requirement: app.requirement }, body: {} } }])
  const g = fake(() => completed({ status: "cancelled" }))
  await expect(gmailConnectLink(app, g.connect)).rejects.toThrow()
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

test("missing status accepts a valid execution rather than pausing", async () => {
  const f = fake(() => ({ execution: completed([gmail]).execution }))
  expect(await findMailApp(f.connect)).toEqual(app)
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

test("callApp returns only the inner value and leaves its caller's client open", async () => {
  const f = fake(() => completed({ result: 42 }))
  const client = await f.connect()
  try {
    expect(await callApp(client, paths.list, {})).toEqual({ result: 42 })
    expect(f.counts.closed).toBe(0)
  } finally { await client.close() }
})

test("wait polls until the account is ready, closing every connection", async () => {
  let polls = 0
  const f = fake(() => completed(++polls === 1 ? [] : [account(polls === 3 ? "saved" : "reconnect")]))
  expect(await waitForMailAccount(app, { signal: new AbortController().signal, everyMs: 1, connect: f.connect }))
    .toEqual({ label: "Test Gmail", email: "test@example.invalid", ready: true })
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
