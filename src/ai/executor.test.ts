import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { callApproved, EXECUTOR_URL, executorEnv, gmailSetup, nextGmailStep, readCall, signedInUrl, type Run } from "./executor"
import { openGmailDialog, runGmailAction, sources, stopWaiting } from "../app/gmailSource"
import { gmailActions, gmailRow } from "../state/gmailDialog"
import { ui } from "../state/uiStore"

/** A fake Executor: answers by the call's path; records every call. */
function fakeExecutor(state: { gmail: boolean; client: boolean; account: boolean; paused?: boolean }) {
  const calls: string[][] = []
  const ok = (data: unknown) => ({ code: 0, out: JSON.stringify({ ok: true, data }) })
  const run: Run = async (args) => {
    calls.push(args)
    const path = args.join(" ")
    if (path === "--version") return { code: 0, out: "executor v1.6.11" }
    if (path === "daemon status") return { code: 0, out: `Daemon running at ${EXECUTOR_URL} (pid 1).` }
    if (path.startsWith("call executor coreTools integrations list")) return ok({ items: [{ id: "executor" }, ...(state.gmail ? [{ id: "gmail" }] : [])] })
    if (path.startsWith("call executor coreTools oauth clients list")) return ok({ clients: state.client ? [{ slug: "google-app", owner: "user", tokenUrl: "https://oauth2.googleapis.com/token" }] : [] })
    if (path.startsWith("call executor coreTools connections list")) return ok({ connections: state.account ? [{ owner: "user", name: "gmail", integration: "gmail", identityLabel: "me@example.com", lastHealth: { status: "healthy" } }] : [] })
    if (path.startsWith("call executor openapi addSpec")) { return { code: 0, out: "Execution paused: Add an OpenAPI integration\n\nexecutionId: exec_1\n\nApprove in browser:\n  http://localhost:4799/resume/exec_1\n" } }
    if (path.startsWith("resume --execution-id exec_1")) { state.gmail = true; return ok({ slug: "gmail", toolCount: 30 }) }
    if (path.startsWith("call executor coreTools oauth clients createHandoff")) return ok({ url: `${EXECUTOR_URL}/integrations/gmail?addAccount=1`, instructions: "…" })
    if (path.startsWith("call executor coreTools oauth start")) return ok({ status: "redirect", authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "s" })
    if (path.startsWith("tools search")) return ok({ items: [{ path: "gmail.users.messages.list", integration: "gmail" }] })
    if (path.startsWith("call gmail users messages list")) return ok({ messages: [{ id: "a" }, { id: "b" }, { id: "c" }], nextPageToken: "n" })
    return { code: 1, out: `unexpected: ${path}` }
  }
  return { run, calls }
}

const home = mkdtempSync(join(tmpdir(), "jaskmoney-executor-"))
const before = process.env.JASKMONEY_HOME
process.env.JASKMONEY_HOME = home
afterEach(() => { ui.setState({ gmail: null, gmailSetup: null }) })

test("jaskmoney's Executor is its own: a private data folder under the app's home, analytics off", () => {
  expect(executorEnv()).toMatchObject({ EXECUTOR_DATA_DIR: join(home, "executor"), EXECUTOR_DISABLE_ANALYTICS: "1" })
  expect(EXECUTOR_URL).toBe("http://localhost:4799")
})

test("readCall: data, a paused execution, an error, a missing binary", () => {
  expect(readCall(0, '{"ok":true,"data":{"a":1}}')).toEqual({ kind: "done", data: { a: 1 } })
  expect(readCall(0, "Execution paused: Add an OpenAPI integration\n…\nexecutionId: exec_9\n\nApprove in browser:\n  http://x/resume/exec_9\n")).toEqual({ kind: "paused", title: "Add an OpenAPI integration", executionId: "exec_9", approveUrl: "http://x/resume/exec_9" })
  expect(readCall(0, '{"ok":false,"error":{"code":"x","message":"nope"}}')).toEqual({ kind: "error", message: "nope" })
  expect(readCall(127, "spawn executor ENOENT")).toMatchObject({ kind: "error", message: expect.stringContaining("isn't installed") })
})

test("a call the user asked for is approved once, on jaskmoney's daemon", async () => {
  const fake = fakeExecutor({ gmail: false, client: false, account: false })
  expect(await callApproved(fake.run, ["executor", "openapi", "addSpec"], {})).toEqual({ kind: "done", data: { slug: "gmail", toolCount: 30 } })
  expect(fake.calls.at(-1)).toEqual(["resume", "--execution-id", "exec_1", "--base-url", EXECUTOR_URL, "--action", "accept", "--content", "{}"])
})

test("the setup in steps: add, your Google app, sign in, ready", async () => {
  const state = { gmail: false, client: false, account: false }
  const fake = fakeExecutor(state)
  const step = async () => nextGmailStep(await gmailSetup(fake.run))
  expect(await step()).toBe("add")
  state.gmail = true
  expect(await step()).toBe("client")
  state.client = true
  expect(await step()).toBe("signIn")
  state.account = true
  expect(await step()).toBe("ready")
  expect(gmailRow(await gmailSetup(fake.run))).toEqual({ connected: true, how: "signed in · me@example.com" })
  expect(nextGmailStep({ version: null, gmail: false, client: null, account: null, error: "Executor isn't installed" })).toBe("install")
})

test("the web UI opens signed in with the private token; other addresses don't get it", () => {
  mkdirSync(join(home, "executor", "server-control"), { recursive: true })
  writeFileSync(join(home, "executor", "server-control", "auth.json"), JSON.stringify({ token: "t0k" }))
  expect(signedInUrl()).toBe(`${EXECUTOR_URL}/?_token=t0k`)
  expect(signedInUrl(`${EXECUTOR_URL}/integrations/gmail?addAccount=1`)).toBe(`${EXECUTOR_URL}/integrations/gmail?addAccount=1&_token=t0k`)
  expect(signedInUrl("https://accounts.google.com/x")).toBe("https://accounts.google.com/x")
})

test("the dialog: add Gmail, open Executor's form for the Google app, sign in in the browser and wait, then test", async () => {
  const state = { gmail: false, client: false, account: false }
  const fake = fakeExecutor(state)
  const opened: string[] = []
  Object.assign(sources, { run: fake.run, open: (url: string) => opened.push(url), pollMs: 5 })
  await openGmailDialog(ui)
  expect(gmailActions(ui.state.gmail!.setup).map((a) => a.id)).toEqual(["add", "open"])
  await runGmailAction(ui)
  expect(ui.state.gmail!.note).toMatchObject({ ok: true, text: expect.stringContaining("read-only") })
  expect(gmailActions(ui.state.gmail!.setup)[0]!.id).toBe("client")
  await runGmailAction(ui)
  expect(opened.at(-1)).toStartWith(`${EXECUTOR_URL}/integrations/gmail?addAccount=1`)
  state.client = true
  ui.setState("gmail", { cursor: 1 }) // Check again
  await runGmailAction(ui)
  expect(gmailActions(ui.state.gmail!.setup)[0]!.id).toBe("signIn")
  ui.setState("gmail", { cursor: 0 })
  const signingIn = runGmailAction(ui)
  await new Promise((r) => setTimeout(r, 20))
  expect(opened.at(-1)).toStartWith("https://accounts.google.com/")
  expect(ui.state.gmail!.waiting).toStartWith("https://accounts.google.com/")
  state.account = true
  await signingIn
  expect(ui.state.gmail).toMatchObject({ waiting: null, note: { ok: true, text: "Signed in as me@example.com" } })
  expect(ui.state.gmailSetup?.account?.identity).toBe("me@example.com")
  await runGmailAction(ui) // Test
  expect(ui.state.gmail!.note).toMatchObject({ ok: true, text: "3+ order emails from Amazon and eBay in the last 90 days" })
})

test("esc while waiting stops waiting; the browser can still finish", async () => {
  const fake = fakeExecutor({ gmail: true, client: true, account: false })
  Object.assign(sources, { run: fake.run, open: () => {}, pollMs: 5 })
  await openGmailDialog(ui)
  const signingIn = runGmailAction(ui)
  await new Promise((r) => setTimeout(r, 20))
  stopWaiting(ui)
  await signingIn
  expect(ui.state.gmail).toMatchObject({ waiting: null, note: { text: expect.stringContaining("Check again") } })
  if (before === undefined) delete process.env.JASKMONEY_HOME
  else process.env.JASKMONEY_HOME = before
})
