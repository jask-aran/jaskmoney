import type { McpClient } from "@earendil-works/pi-mcp"
import { connectExecutor, textOf, type Connect } from "./executor"

interface MailApp { id: string; slug: string; name: string; requirement: string }
export interface MailAccount { label: string; email: string | null; ready: boolean }

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Executor gave no list")
  return value
}

function detail(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined
  const fields = object(value)
  if (fields[key] !== undefined) return fields[key]
  for (const container of ["pending", "interaction", "execution", "value", "error"]) {
    const found = detail(fields[container], key)
    if (found !== undefined) return found
  }
  return undefined
}

export class ExecutorPaused extends Error {
  readonly status: string | undefined
  readonly requestId: unknown
  readonly pending: unknown
  readonly interaction: unknown

  constructor(readonly raw: unknown) {
    const status = object(raw).status
    const message = detail(raw, "message")
    super(typeof message === "string" ? message : `Executor's call is ${typeof status === "string" ? status : "paused"}`)
    this.name = "ExecutorPaused"
    this.status = typeof status === "string" ? status : undefined
    this.requestId = detail(raw, "requestId")
    this.pending = detail(raw, "pending")
    this.interaction = detail(raw, "interaction")
  }
}

function failure(value: unknown): Error {
  const message = object(value).message
  return new Error(typeof message === "string" ? message : typeof value === "string" ? value : JSON.stringify(value) ?? "Executor's call failed")
}

async function callApp(client: Pick<McpClient, "callTool">, path: string, input: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool("call", { calls: { path, input } })
  const text = textOf(result)
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch {
    throw new Error(result.isError && text ? text : "Executor gave an invalid call response")
  }
  const response = object(parsed)
  if (response.status !== undefined && response.status !== "completed") throw new ExecutorPaused(parsed)
  const execution = object(response.execution)
  if (execution.ok === false) throw failure(execution.error)
  const call = object(execution.value)
  if (call.ok === false) throw failure(call.error)
  if (result.isError) throw failure(response.error)
  if (execution.ok !== true || call.ok !== true) throw new Error("Executor gave an invalid call response")
  return call.value
}

function mailApp(value: unknown): MailApp {
  const app = object(value)
  const accounts = object(object(app.requirements).accounts)
  const keys = Object.keys(accounts)
  const requirement = keys.find((key) => object(accounts[key]).scope === "user") ?? keys[0]
  if (typeof app.id !== "string" || typeof app.slug !== "string" || typeof app.name !== "string" || !requirement) {
    throw new Error("Executor gave an app without its mail requirement")
  }
  return { id: app.id, slug: app.slug, name: app.name, requirement }
}

export async function findMailApp(connect: Connect<"callTool"> = connectExecutor): Promise<MailApp | null> {
  const client = await connect()
  try {
    const apps = list(await callApp(client, "tools.executor.appManagement.list", {}))
      .filter((app) => Object.keys(object(object(object(app).requirements).accounts)).length > 0)
    const app = apps.find((app) => object(object(app).copiedFrom).name === "@executor.sh/gmail")
      ?? apps.find((app) => object(object(app).copiedFrom).name === "@executor.sh/google")
    return app === undefined ? null : mailApp(app)
  } finally { await client.close().catch(() => {}) }
}

async function installGmail(connect: Connect<"callTool"> = connectExecutor): Promise<MailApp> {
  const client = await connect()
  try {
    const entries = list(await callApp(client, "tools.executor.organization.catalog", { query: { search: "gmail", limit: "5" } }))
    const entry = entries.find((entry) => object(entry).id === "gmail")
    if (!entry) throw new Error("Executor's catalog has no Gmail app")
    return mailApp(await callApp(client, "tools.executor.apps.install", { body: { entry: "gmail", name: "Gmail" } }))
  } finally { await client.close().catch(() => {}) }
}

export async function mailAccount(app: MailApp, connect: Connect<"callTool"> = connectExecutor): Promise<MailAccount | null> {
  const client = await connect()
  try {
    const accounts = list(await callApp(client, "tools.executor.appAccounts.userList", { path: { app: app.id } }))
    const entry = accounts.find((entry) => object(entry).requirement === app.requirement)
    if (entry === undefined) return null
    const fields = object(entry)
    const label = object(fields.account).label
    if (typeof label !== "string") throw new Error("Executor gave an account without a label")
    const email = object(object(fields.health).info).email
    return { label, email: typeof email === "string" ? email : null, ready: object(fields.signIn).state === "saved" }
  } finally { await client.close().catch(() => {}) }
}

export async function gmailConnectLink(app: MailApp, connect: Connect<"callTool"> = connectExecutor): Promise<{ url: string }> {
  const client = await connect()
  try {
    const result = object(await callApp(client, "tools.executor.appAccounts.userConnect", { path: { app: app.id, requirement: app.requirement }, body: {} }))
    if (typeof result.url !== "string" || !result.url) throw new Error("Executor gave no Gmail sign-in address")
    return { url: result.url }
  } finally { await client.close().catch(() => {}) }
}

export async function waitForMailAccount(app: MailApp, { signal, everyMs = 2000, connect = connectExecutor }: {
  signal: AbortSignal; everyMs?: number; connect?: Connect<"callTool">
}): Promise<MailAccount> {
  if (signal.aborted) throw new Error("cancelled")
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel = () => {}
  try {
    return await new Promise<MailAccount>((resolve, reject) => {
      cancel = () => reject(new Error("cancelled"))
      signal.addEventListener("abort", cancel, { once: true })
      const poll = async () => {
        try {
          const account = await mailAccount(app, connect)
          if (signal.aborted) return
          if (account?.ready) resolve(account)
          else timer = setTimeout(poll, everyMs)
        } catch (error) { if (!signal.aborted) reject(error) }
      }
      void poll()
    })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
  }
}

export async function ensureMailApp(connect: Connect<"callTool"> = connectExecutor): Promise<{ app: MailApp; installed: boolean }> {
  const app = await findMailApp(connect)
  return app ? { app, installed: false } : { app: await installGmail(connect), installed: true }
}
