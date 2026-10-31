import { afterEach, expect, test } from "bun:test"
import { createCore } from "../core/core"
import { createClientStore } from "../client/store"
import { wsLink } from "../client/wsLink"
import { serveCore, serverToken } from "./serve"
import { testEnv } from "../testing/scoped"
import { mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const stops: Array<() => void> = []
afterEach(() => { for (const stop of stops.splice(0)) stop() })

/** A core on a scratch database with three local rows, served on a free port. */
function served() {
  const core = createCore()
  core.open(":memory:")
  const add = core.db!.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source) VALUES ('x', ?, -5, ?, 'csv')`)
  add.run("2026-10-01", "Corner Store")
  add.run("2026-10-02", "Bakery")
  add.run("2026-10-03", "Petrol")
  core.refresh()
  const server = serveCore(core, { port: 0 })
  stops.push(() => { server.stop(); core.close() })
  return { core, server, base: new URL(server.page) }
}

async function until(ready: () => boolean) {
  for (let i = 0; i < 200 && !ready(); i++) await Bun.sleep(5)
  expect(ready()).toBe(true)
}

test("/api takes only its token, a loopback host name and its own page's origin", async () => {
  const { base } = served()
  const token = base.searchParams.get("token")!
  const api = (query: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${base.port}/api${query}`, { headers })
  expect((await api("")).status).toBe(401)
  expect((await api("?token=wrong")).status).toBe(401)
  // A plain request with the token is only refused for not being a WebSocket.
  expect((await api(`?token=${token}`)).status).toBe(426)
  // DNS rebinding: a page on evil.example resolved to 127.0.0.1 names its own host.
  expect((await api(`?token=${token}`, { host: `evil.example:${base.port}`, origin: `http://evil.example:${base.port}` })).status).toBe(421)
  expect((await api(`?token=${token}`, { origin: "http://evil.example" })).status).toBe(403)
  // The page itself needs no token (it reads the token from its address).
  expect((await fetch(`http://127.0.0.1:${base.port}/`)).status).toBe(200)
})

test("two clients share the core: a write reaches both, sending only the row it changed", async () => {
  const { server } = served()
  const one = createClientStore(wsLink(server.api))
  const two = createClientStore(wsLink(server.api))
  await until(() => one.state.ready && two.state.ready)
  expect(two.state.transactions.map((t) => t.description)).toEqual(["Petrol", "Bakery", "Corner Store"])

  // Listen to the wire as a third client does.
  const messages: string[] = []
  const raw = new WebSocket(server.api)
  raw.addEventListener("message", (event) => messages.push(String(event.data)))
  await until(() => messages.length > 0)
  messages.length = 0

  const bakery = one.state.transactions.find((t) => t.description === "Bakery")!
  const category = one.state.categories.find((c) => !c.isDefault && c.parentId != null)!
  expect(await one.categorizeTransactions([bakery.id], category.id)).toStartWith(`Categorized 1 → ${category.name}`)
  // The writer's mirror shows it when the call resolves; the other client soon after.
  expect(one.state.transactions.find((t) => t.id === bakery.id)!.categoryId).toBe(category.id)
  await until(() => two.state.transactions.find((t) => t.id === bakery.id)?.categoryId === category.id)
  expect(two.state.transactions.map((t) => t.description)).toEqual(["Petrol", "Bakery", "Corner Store"])
  expect(two.undoLabel()).toBe(`categorised 1 → ${category.name}`)

  await until(() => messages.some((m) => m.includes('"rows"')))
  const rows = messages.map((m) => JSON.parse(m)).filter((m) => m.rows).map((m) => m.rows)
  expect(rows.flatMap((r) => r.set.map((t: { id: number }) => t.id))).toEqual([bakery.id])
  expect(rows.some((r) => r.order)).toBe(false)
  raw.close()

  // Undo from the other client.
  expect(await two.undo()).toStartWith(`Undid: categorised 1 → ${category.name}`)
  await until(() => one.state.transactions.find((t) => t.id === bakery.id)?.categoryId === bakery.categoryId)
})

test("a removed row leaves the other client's mirror; an unknown command is refused", async () => {
  const { core, server } = served()
  const client = createClientStore(wsLink(server.api))
  await until(() => client.state.ready)
  core.db!.query("DELETE FROM transactions WHERE description = 'Bakery'").run()
  core.refresh()
  await until(() => client.state.transactions.length === 2)
  expect(client.state.transactions.map((t) => t.description)).toEqual(["Petrol", "Corner Store"])
  const link = wsLink(server.api)
  await expect(link.call("nope" as never, {} as never)).rejects.toThrow("no such command: nope")
  link.close()
})

test("the token is kept (owner-only) so an address keeps working; JASKMONEY_SERVER_TOKEN wins", () => {
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-token-")), "server.json")
  const first = serverToken(path)
  expect(first).toMatch(/^[0-9a-f]{32}$/)
  expect(serverToken(path)).toBe(first)
  expect(statSync(path).mode & 0o777).toBe(0o600)
  testEnv("JASKMONEY_SERVER_TOKEN", "from-the-environment")
  expect(serverToken(path)).toBe("from-the-environment")
})

test("a public name in JASKMONEY_PUBLIC_HOST is answered (a tunnel's), its own origin too; others still aren't", async () => {
  testEnv("JASKMONEY_PUBLIC_HOST", "money.example")
  const { base } = served()
  const token = base.searchParams.get("token")!
  const api = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${base.port}/api?token=${token}`, { headers })
  expect((await api({ host: "money.example", origin: "https://money.example" })).status).toBe(426)
  expect((await api({ host: "money.example", origin: "https://evil.example" })).status).toBe(403)
  expect((await api({ host: "evil.example" })).status).toBe(421)
})
