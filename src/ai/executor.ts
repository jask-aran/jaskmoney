import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { McpClient, StreamableHttpTransport, type CallToolResult } from "@earendil-works/pi-mcp"
import { adaptOAuthProvider, authorizeMcp, McpOAuthProvider, OAuthCallbackServer, type McpOAuthState } from "@earendil-works/pi-mcp/oauth"
import { jaskmoneyHome } from "../storage/home"
import { writeJsonAtomic } from "../storage/json"

/**
 * Executor Cloud (executor.sh): your accounts (Gmail first) connected once
 * at executor.sh, reached here over MCP. Signing in is MCP OAuth in the
 * browser: Executor's page signs you in, or has you make an account if you
 * have none; the app registers itself there as a client (dynamic
 * registration) and keeps the tokens in ~/.jaskmoney/executor.json (mode
 * 600, never shown). Executor holds the Google sign-in: the app never sees
 * a Google token. As Conduit does (its connectors.js), programs run through
 * Executor's `execute` tool, e.g. `tools.gmail.api.users.gmailUsersMessagesList`.
 * Local Executor servers are for later (this file's history has one).
 */
export const EXECUTOR_MCP = "https://mcp.executor.sh/mcp"
export const EXECUTOR_SITE = "https://executor.sh"
const RESOURCE_METADATA = "https://mcp.executor.sh/.well-known/oauth-protected-resource/mcp?elicitation_mode=model"
const SCOPE = "mcp offline_access"
/** The sign-in comes back to the app here (registered with Executor once). */
const CALLBACK = { host: "127.0.0.1", port: 47823, path: "/executor/callback" }
const TIMEOUT_MS = 15_000

interface Saved extends McpOAuthState { redirectUrl?: string }

const savedPath = () => join(jaskmoneyHome(), "executor.json")

function load(): Saved | undefined {
  try { return JSON.parse(readFileSync(savedPath(), "utf8")) as Saved } catch { return undefined }
}

function save(state: Saved): void { writeJsonAtomic(savedPath(), state) }

/** Signed in: tokens are saved (they may still need refreshing). */
export const executorSignedIn = () => !!load()?.tokens

/** Forget the sign-in here (Executor keeps your accounts; revoke the app at executor.sh). */
export function signOutExecutor(): void { rmSync(savedPath(), { force: true }) }

function provider(redirectUrl: string, store: { load: () => Saved | undefined; save: (s: Saved) => void }, onRedirect: (url: URL) => void = () => {}) {
  return new McpOAuthProvider({ serverUrl: EXECUTOR_MCP, redirectUrl, store: { load: store.load, save: (s) => store.save({ ...s, redirectUrl }) }, onRedirect,
    clientMetadata: { client_name: "jaskmoney", scope: SCOPE } })
}

/**
 * Sign in in the browser: `open` gets Executor's sign-in address; resolves
 * when it comes back to the app's callback, with the tokens saved. `signal`
 * cancels (the browser page then just fails to return).
 */
export async function signInExecutor(open: (url: string) => void, signal?: AbortSignal): Promise<void> {
  const server = await OAuthCallbackServer.listen({ ...CALLBACK, timeoutMs: 5 * 60_000 })
  try {
    const previous = load()
    // A client registered for another redirect address would be refused: register again.
    let data: Saved = { serverUrl: EXECUTOR_MCP, ...(previous?.clientInformation && previous.redirectUrl === server.redirectUrl ? { clientInformation: previous.clientInformation } : {}) }
    const store = { load: () => data, save: (next: Saved) => { data = next } }
    let url: string | undefined
    const oauth = provider(server.redirectUrl, store, (u) => { url = String(u) })
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    await authorizeMcp(oauth, { serverUrl: EXECUTOR_MCP, scope: SCOPE, resourceMetadataUrl: new URL(RESOURCE_METADATA), skipRefresh: true, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!url) throw new Error("Executor gave no sign-in address")
    const state = await oauth.state()
    open(url)
    const callback = await new Promise<{ code: string; iss?: string }>((resolve, reject) => {
      server.waitForCallback(state).then(resolve, reject)
      signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
    })
    await authorizeMcp(oauth, { serverUrl: EXECUTOR_MCP, authorizationCode: callback.code, iss: callback.iss, resourceMetadataUrl: new URL(RESOURCE_METADATA), signal: AbortSignal.timeout(TIMEOUT_MS) })
    save({ ...data, redirectUrl: server.redirectUrl })
  } finally {
    await server.close().catch(() => {})
  }
}

/** A connection to Executor with the saved sign-in (tokens refresh as needed). */
export async function connectExecutor(): Promise<McpClient> {
  const saved = load()
  if (!saved?.tokens || !saved.redirectUrl) throw new Error("Not signed in to Executor")
  const oauth = provider(saved.redirectUrl, { load, save })
  const client = new McpClient({ name: "jaskmoney", version: "1.0.0", requestTimeoutMs: TIMEOUT_MS })
  await client.connect(new StreamableHttpTransport({ url: EXECUTOR_MCP, authProvider: adaptOAuthProvider(oauth) }))
  return client
}

/** What Executor reaches for you: its tools, by name. */
export interface ExecutorStatus { signedIn: boolean; tools: string[]; error: string | null }

type Connect<K extends keyof McpClient> = () => Promise<Pick<McpClient, K | "close">>

export async function executorStatus(connect: Connect<"listTools"> = connectExecutor): Promise<ExecutorStatus> {
  if (!executorSignedIn()) return { signedIn: false, tools: [], error: null }
  try {
    const client = await connect()
    try { return { signedIn: true, tools: (await client.listTools()).map((t) => t.name), error: null } } finally { await client.close().catch(() => {}) }
  } catch (error) {
    return { signedIn: true, tools: [], error: error instanceof Error ? error.message : String(error) }
  }
}

const textOf = (result: CallToolResult) => (result.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")

/** Run a program through Executor's `execute` tool: its result, parsed when it's JSON. */
export async function runExecutor(code: string, connect: Connect<"callTool"> = connectExecutor): Promise<unknown> {
  const client = await connect()
  try {
    const result = await client.callTool("execute", { code }, { timeoutMs: 90_000 })
    const text = textOf(result)
    if (result.isError) throw new Error(text.slice(0, 300) || "Executor's program failed")
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return text }
    // { status, execution: { ok, value | error } }: the program's own value.
    const run = parsed as { status?: string; execution?: { ok?: boolean; value?: unknown; error?: unknown } }
    if (run?.execution) {
      if (run.execution.ok === false) throw new Error(String((run.execution.error as { message?: string })?.message ?? run.execution.error ?? "Executor's program failed").slice(0, 300))
      if (run.status && run.status !== "completed") throw new Error(`Executor's program is ${run.status} (it may want an approval at executor.sh)`)
      return run.execution.value
    }
    return parsed
  } finally { await client.close().catch(() => {}) }
}

/** Your Gmail accounts linked in Executor, from its search: the Gmail
 * app's first (tools.gmail.api), then a Google bundle's (tools.google.api.gmail). */
export interface GmailAccount { accountId: string; label: string; tools: string }

export async function gmailAccounts(connect: Connect<"callTool"> = connectExecutor): Promise<GmailAccount[]> {
  const client = await connect()
  try {
    const result = await client.callTool("search", { query: "gmail messages list" })
    const found = JSON.parse(textOf(result)) as { namespaces?: Array<{ path: string; accounts?: string }> }
    const out: GmailAccount[] = []
    for (const [app, tools] of [["tools.gmail", "tools.gmail.api.users"], ["tools.google", "tools.google.api.gmail.users"]] as const) {
      const accounts = found.namespaces?.find((n) => n.path === app)?.accounts ?? ""
      for (const m of accounts.matchAll(/(acc_[\w-]+)(?: \(([^)]*)\))?/g)) out.push({ accountId: m[1]!, label: m[2] ?? m[1]!, tools })
    }
    return out
  } finally { await client.close().catch(() => {}) }
}

/** The order emails the test looks for: Amazon's and eBay's, the last 90 days. */
export const ORDER_EMAILS = "from:(amazon.com.au OR ebay.com OR ebay.com.au) newer_than:90d"

/** The test: how many order emails Gmail finds (through Executor; read-only). */
export const COUNT_ORDER_EMAILS = `const list = await tools.gmail.api.users.gmailUsersMessagesList({ input: { path: { userId: "me" }, query: { q: ${JSON.stringify(ORDER_EMAILS)}, maxResults: 50 } } });
return { count: (list.messages ?? []).length, more: !!list.nextPageToken };`
