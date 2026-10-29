import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { COUNT_ORDER_EMAILS, executorSignedIn, executorStatus, runExecutor, signOutExecutor } from "./executor"
import { cancelExecutorSignIn, openExecutorDialog, runExecutorAction, sources } from "../app/executorSource"
import { executorActions, executorRow } from "../state/executorDialog"
import { ui } from "../state/uiStore"
import { jaskmoneyHome } from "../storage/home"

/** A saved sign-in in this test's home (testSetup gives each test its own). */
function signedIn() {
  mkdirSync(jaskmoneyHome(), { recursive: true })
  writeFileSync(join(jaskmoneyHome(), "executor.json"), JSON.stringify({ serverUrl: "https://mcp.executor.sh/mcp", tokens: { access_token: "a", token_type: "Bearer" }, redirectUrl: "http://127.0.0.1:47823/executor/callback" }))
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError })

test("status: not signed in without a saved sign-in; signed in, Executor's tools; a failure says why", async () => {
  expect(await executorStatus(async () => { throw new Error("never asked") })).toEqual({ signedIn: false, tools: [], error: null })
  signedIn()
  expect(executorSignedIn()).toBe(true)
  const client = { listTools: async () => [{ name: "execute" }, { name: "search" }] as never, close: async () => {} }
  expect(await executorStatus(async () => client)).toEqual({ signedIn: true, tools: ["execute", "search"], error: null })
  expect(await executorStatus(async () => { throw new Error("401 Unauthorized") })).toEqual({ signedIn: true, tools: [], error: "401 Unauthorized" })
  signOutExecutor()
  expect(executorSignedIn()).toBe(false)
})

test("a program runs through Executor's execute tool: JSON comes back parsed, an error is an error", async () => {
  const calls: unknown[] = []
  const client = (result: ReturnType<typeof text>) => async () => ({ callTool: async (name: string, args?: Record<string, unknown>) => { calls.push([name, args]); return result }, close: async () => {} })
  expect(await runExecutor(COUNT_ORDER_EMAILS, client(text('{"count":3,"more":true}')))).toEqual({ count: 3, more: true })
  expect(calls[0]).toEqual(["execute", { code: COUNT_ORDER_EMAILS }])
  expect(COUNT_ORDER_EMAILS).toContain("tools.gmail.api.users.gmailUsersMessagesList")
  await expect(runExecutor("x", client(text("No Gmail account connected", true)))).rejects.toThrow("No Gmail account connected")
})

test("the dialog: sign in in the browser (or make an account), then test Gmail through Executor", async () => {
  let status = { signedIn: false, tools: [] as string[], error: null as string | null }
  const opened: string[] = []
  let finish = () => {}
  Object.assign(sources, {
    open: (url: string) => opened.push(url),
    status: async () => status,
    signIn: (open: (url: string) => void) => new Promise<void>((resolve) => { open("https://executor.sh/oauth/authorize?x=1"); finish = () => { status = { signedIn: true, tools: ["execute", "search", "describe", "skills"], error: null }; resolve() } }),
    run: async () => ({ count: 7, more: false }),
  })
  await openExecutorDialog(ui)
  expect(executorActions(ui.state.executor!.status).map((a) => a.id)).toEqual(["signIn", "site"])
  expect(executorRow(ui.state.executorStatus, false)).toEqual({ connected: false, how: "not signed in · enter to connect" })
  const signing = runExecutorAction(ui)
  await new Promise((r) => setTimeout(r, 5))
  expect(opened).toEqual(["https://executor.sh/oauth/authorize?x=1"])
  expect(ui.state.executor!.waiting).toBe("https://executor.sh/oauth/authorize?x=1")
  finish()
  await signing
  expect(ui.state.executor).toMatchObject({ waiting: null, note: { text: "Signed in to Executor", ok: true } })
  expect(executorRow(ui.state.executorStatus, true)).toEqual({ connected: true, how: "signed in · 4 tools" })
  expect(executorActions(ui.state.executor!.status).map((a) => a.id)).toEqual(["test", "site", "signOut"])
  await runExecutorAction(ui)
  expect(ui.state.executor!.note).toEqual({ text: "7 order emails from Amazon and eBay in the last 90 days", ok: true })
  ui.setState({ executor: null, executorStatus: null })
})

test("esc during the browser sign-in cancels it", async () => {
  Object.assign(sources, {
    status: async () => ({ signedIn: false, tools: [], error: null }),
    signIn: (open: (url: string) => void, signal: AbortSignal) => new Promise<void>((_, reject) => { open("https://executor.sh/x"); signal.addEventListener("abort", () => reject(new Error("cancelled"))) }),
  })
  await openExecutorDialog(ui)
  const signing = runExecutorAction(ui)
  await new Promise((r) => setTimeout(r, 5))
  cancelExecutorSignIn()
  await signing
  expect(ui.state.executor).toMatchObject({ waiting: null, note: { text: "Sign-in cancelled", ok: null } })
  ui.setState({ executor: null, executorStatus: null })
})
