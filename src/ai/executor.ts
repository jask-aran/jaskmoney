import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { jaskmoneyHome } from "../storage/home"

/**
 * Executor (executor.sh, MIT): a gateway that holds integrations, their
 * credentials and per-tool policies; the app reaches Gmail through it and
 * never sees a Google token. jaskmoney runs its own: data in
 * ~/.jaskmoney/executor (EXECUTOR_DATA_DIR, only you can read it), a daemon
 * on 127.0.0.1:EXECUTOR_PORT that the app starts when it needs it and stops
 * when it quits, never an installed service. Other Executor installs (and
 * the agents using them) don't see it: their default is ~/.executor on 4788.
 * A program running as you that reads this folder could still reach it, as
 * it could credentials.json; that is the operating system's boundary.
 *
 * Gmail goes in read-only: Google's API description with a sign-in template
 * asking for gmail.readonly alone (Executor's own default asks for the whole
 * mailbox), so nothing through it can send, change or delete mail. Signing in
 * needs a Google OAuth client of your own, registered in Executor's web UI
 * so its secret never passes through this app, with GOOGLE_REDIRECT as an
 * authorised redirect URI.
 *
 * The CLI runs from ~/.jaskmoney: it is a compiled Bun binary and reads any
 * bunfig.toml in its working directory (this repo's preloads break it).
 * Analytics are off (EXECUTOR_DISABLE_ANALYTICS; the daemon keeps the
 * environment it was started with).
 */
export const EXECUTOR_PORT = 4799
export const EXECUTOR_URL = `http://localhost:${EXECUTOR_PORT}`
export const GOOGLE_REDIRECT = `${EXECUTOR_URL}/api/oauth/callback`
export const executorDataDir = () => join(jaskmoneyHome(), "executor")
export const GMAIL_INTEGRATION = "gmail"
const GMAIL_TEMPLATE = "google"
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"]

/** Runs the CLI with `args`: its exit code and output (stdout, then stderr). */
export type Run = (args: string[]) => Promise<{ code: number; out: string }>

/** The executor binary this app depends on, else one on the PATH. */
function executorBinary(): string {
  try { return createRequire(import.meta.url).resolve("executor/bin/executor") } catch { return "executor" }
}

export function executorRunner(timeoutMs = 60_000): Run {
  return (args) => new Promise((resolve) => {
    const home = jaskmoneyHome()
    mkdirSync(executorDataDir(), { recursive: true, mode: 0o700 })
    let out = ""
    let err = ""
    const child = spawn(executorBinary(), args, { cwd: home, env: executorEnv(), stdio: ["ignore", "pipe", "pipe"] })
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 127, out: e.message }) })
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out: out + (err ? `\n${err}` : "") }) })
  })
}

/** `url` on jaskmoney's Executor, opened in the browser already signed in
 * (as `executor open` does: its bearer token as `_token`, read from the
 * private data folder; never shown). */
export function signedInUrl(url: string = `${EXECUTOR_URL}/`): string {
  try {
    const { token } = JSON.parse(readFileSync(join(executorDataDir(), "server-control", "auth.json"), "utf8")) as { token?: string }
    if (!token || !url.startsWith(EXECUTOR_URL)) return url
    return `${url}${url.includes("?") ? "&" : "?"}_token=${encodeURIComponent(token)}`
  } catch { return url }
}

export const executorEnv = () => ({ ...process.env, EXECUTOR_DATA_DIR: executorDataDir(), EXECUTOR_DISABLE_ANALYTICS: "1" })

let started = false

/** Start jaskmoney's daemon if it isn't running (calls would otherwise start
 * one on Executor's default port). */
export async function ensureDaemon(run: Run): Promise<string | null> {
  const status = await run(["daemon", "status"])
  // jaskmoney's daemon is its own, so whoever started it (an earlier run
  // that didn't get to quit cleanly), this run stops it on the way out.
  if (status.code === 0 && status.out.includes(`:${EXECUTOR_PORT}`) && !/not running/i.test(status.out)) { started = true; return null }
  const result = await run(["daemon", "run", "--port", String(EXECUTOR_PORT), "--hostname", "127.0.0.1"])
  if (result.code !== 0) return readCall(result.code, result.out).kind === "error" ? `Executor didn't start: ${result.out.trim().split("\n").at(-1)}` : null
  started = true
  return null
}

/** On quit: stop the daemon if this run used it (synchronous, for the exit path). */
export function stopDaemonSync(): void {
  if (!started) return
  started = false
  try { spawnSync(executorBinary(), ["daemon", "stop"], { cwd: jaskmoneyHome(), env: executorEnv(), stdio: "ignore", timeout: 10_000 }) } catch { /* quitting anyway */ }
}

/** What a tool call came back with: its data, a pause for approval (or
 * input), or an error. */
export type CallResult =
  | { kind: "done"; data: unknown }
  | { kind: "paused"; title: string; executionId: string; approveUrl: string | null }
  | { kind: "error"; message: string }

/** Read the CLI's answer: JSON `{ ok, data | error }`, or the text of a paused execution. */
export function readCall(code: number, out: string): CallResult {
  const paused = /Execution paused: (.+)/.exec(out)
  const id = /executionId: (exec_[\w-]+)/.exec(out)
  if (paused && id) return { kind: "paused", title: paused[1]!.trim(), executionId: id[1]!, approveUrl: /Approve in browser:\s*\n\s*(\S+)/.exec(out)?.[1] ?? null }
  const start = out.indexOf("{")
  if (start >= 0) {
    try {
      const json = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1)) as { ok?: boolean; data?: unknown; error?: { message?: string } }
      if (json.ok === true) return { kind: "done", data: json.data }
      if (json.ok === false) return { kind: "error", message: json.error?.message ?? "Executor refused" }
      return { kind: "done", data: json }
    } catch { /* not JSON: the text says why */ }
  }
  const line = out.split("\n").map((l) => l.trim()).find(Boolean)
  return { kind: "error", message: code === 127 ? `Executor isn't installed (${line ?? "not found"})` : line ?? `Executor exited ${code}` }
}

export async function call(run: Run, path: string[], input: unknown = {}): Promise<CallResult> {
  const { code, out } = await run(["call", ...path, JSON.stringify(input)])
  return readCall(code, out)
}

/**
 * A call the user asked for in this app (enter on its action): Executor
 * pauses setup calls for approval, and pressing enter was that approval, so
 * a pause is accepted once. Anything else pausing comes back as it is.
 */
export async function callApproved(run: Run, path: string[], input: unknown = {}): Promise<CallResult> {
  const result = await call(run, path, input)
  if (result.kind !== "paused") return result
  const { code, out } = await run(["resume", "--execution-id", result.executionId, "--base-url", EXECUTOR_URL, "--action", "accept", "--content", "{}"])
  return readCall(code, out)
}

/** Where the Gmail setup stands: each step, in order. */
export interface GmailSetup {
  version: string | null
  /** Gmail's API is in Executor's catalog. */
  gmail: boolean
  /** A Google OAuth client registered in Executor (slug, owner). */
  client: { slug: string; owner: "org" | "user" } | null
  /** The signed-in Gmail account, if any, and its last health check. */
  account: { name: string; identity: string | null; health: string } | null
  error: string | null
}

type Connection = { owner: "org" | "user"; name: string; integration: string; identityLabel?: string | null; lastHealth?: { status: string; identity?: string | null } | null }

export async function gmailSetup(run: Run): Promise<GmailSetup> {
  const setup: GmailSetup = { version: null, gmail: false, client: null, account: null, error: null }
  const version = await run(["--version"])
  if (version.code !== 0) {
    const failed = readCall(version.code, version.out)
    setup.error = failed.kind === "error" ? failed.message : `Executor exited ${version.code}`
    return setup
  }
  setup.version = /v?(\d+\.\d+\.\d+\S*)/.exec(version.out)?.[1] ?? null
  const daemon = await ensureDaemon(run)
  if (daemon) { setup.error = daemon; return setup }
  const [integrations, clients, connections] = await Promise.all([
    call(run, ["executor", "coreTools", "integrations", "list"], {}),
    call(run, ["executor", "coreTools", "oauth", "clients", "list"], {}),
    call(run, ["executor", "coreTools", "connections", "list"], { integration: GMAIL_INTEGRATION }),
  ])
  const failed = [integrations, clients, connections].find((r): r is Extract<CallResult, { kind: "error" }> => r.kind === "error")
  if (failed) { setup.error = failed.message; return setup }
  const items = (integrations.kind === "done" ? (integrations.data as { items?: { id: string }[]; integrations?: { id?: string; slug?: string }[] }) : {})
  const list = [...(items.items ?? []), ...(items.integrations ?? [])] as Array<{ id?: string; slug?: string }>
  setup.gmail = list.some((i) => (i.id ?? i.slug) === GMAIL_INTEGRATION)
  const google = clients.kind === "done" ? ((clients.data as { clients?: Array<{ slug: string; owner: "org" | "user"; tokenUrl: string }> }).clients ?? []).find((c) => c.tokenUrl === GOOGLE_TOKEN) : undefined
  setup.client = google ? { slug: google.slug, owner: google.owner } : null
  const account = connections.kind === "done" ? ((connections.data as { connections?: Connection[] }).connections ?? []).find((c) => c.integration === GMAIL_INTEGRATION) : undefined
  setup.account = account ? { name: account.name, identity: account.identityLabel ?? account.lastHealth?.identity ?? null, health: account.lastHealth?.status ?? "unknown" } : null
  return setup
}

/** The next thing to do for Gmail: the step the setup is missing. */
export type GmailStep = "install" | "add" | "client" | "signIn" | "ready"

export function nextGmailStep(setup: GmailSetup): GmailStep {
  if (!setup.version) return "install"
  if (!setup.gmail) return "add"
  if (!setup.client) return "client"
  if (!setup.account || setup.account.health === "expired") return "signIn"
  return "ready"
}

/** Put Gmail's API in Executor's catalog, signing in read-only. */
export async function addGmail(run: Run): Promise<CallResult> {
  return callApproved(run, ["executor", "openapi", "addSpec"], {
    spec: { kind: "url", url: "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest" },
    slug: GMAIL_INTEGRATION,
    name: "Gmail (read-only)",
    authenticationTemplate: [{ slug: GMAIL_TEMPLATE, kind: "oauth2", label: "Google sign-in (read-only)", authorizationUrl: GOOGLE_AUTH, tokenUrl: GOOGLE_TOKEN, scopes: GMAIL_SCOPES }],
  })
}

/** The web UI's form for registering your Google OAuth client (its secret is typed there). */
export async function googleClientForm(run: Run): Promise<CallResult> {
  return call(run, ["executor", "coreTools", "oauth", "clients", "createHandoff"], {
    integration: GMAIL_INTEGRATION, owner: "user", grant: "authorization_code", authorizationUrl: GOOGLE_AUTH, tokenUrl: GOOGLE_TOKEN, label: "Google (jaskmoney)",
  })
}

/** Start the Google sign-in: the authorization URL to open in the browser. */
export async function startGmailSignIn(run: Run, client: { slug: string; owner: "org" | "user" }): Promise<{ url: string } | { error: string }> {
  const result = await callApproved(run, ["executor", "coreTools", "oauth", "start"], {
    client: client.slug, clientOwner: client.owner, owner: "user", name: GMAIL_INTEGRATION, integration: GMAIL_INTEGRATION, template: GMAIL_TEMPLATE, redirectUri: GOOGLE_REDIRECT,
  })
  if (result.kind === "error") return { error: result.message }
  if (result.kind === "paused") return { error: `Executor is waiting on: ${result.title}` }
  const data = result.data as { status?: string; authorizationUrl?: string }
  if (data.status === "connected") return { url: "" }
  return data.authorizationUrl ? { url: data.authorizationUrl } : { error: "Executor gave no sign-in address" }
}

/** Gmail's tool for `operation` (e.g. "users.messages.list"), as a call path. */
async function gmailTool(run: Run, operation: string): Promise<string[] | null> {
  const { code, out } = await run(["tools", "search", `gmail ${operation.replace(/\./g, " ")}`])
  const found = readCall(code, out)
  if (found.kind !== "done") return null
  const items = ((found.data as { items?: Array<{ path: string; integration: string }> }).items ?? []).filter((t) => t.integration === GMAIL_INTEGRATION)
  const tool = items.find((t) => t.path.endsWith(operation)) ?? null
  return tool ? tool.path.split(".") : null
}

/** How many messages a Gmail search finds (the dialog's test: your order emails). */
export async function countGmail(run: Run, query: string): Promise<{ count: number; more: boolean } | { error: string }> {
  const path = await gmailTool(run, "users.messages.list")
  if (!path) return { error: "Gmail's tools aren't there yet (sign in first)" }
  const result = await call(run, path, { userId: "me", q: query, maxResults: 50 })
  if (result.kind === "error") return { error: result.message }
  if (result.kind === "paused") return { error: `Executor wants approval to read Gmail (${result.title}): set its policy to allow in Executor` }
  const data = result.data as { messages?: unknown[]; nextPageToken?: string; body?: { messages?: unknown[]; nextPageToken?: string } }
  const body = data.body ?? data
  return { count: body.messages?.length ?? 0, more: !!body.nextPageToken }
}

/** The order emails the test looks for: Amazon's and eBay's, the last 90 days. */
export const ORDER_EMAILS = "from:(amazon.com.au OR ebay.com OR ebay.com.au) newer_than:90d"
