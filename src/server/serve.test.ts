import { afterEach, expect, test } from "bun:test"
import { createCore } from "../core/core"
import { createClientStore } from "../client/store"
import { wsLink } from "../client/wsLink"
import { serveCore } from "./serve"

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

test("/api takes only a loopback host name and its own page's origin", async () => {
  const { base } = served()
  const api = (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${base.port}/api`, { headers })
  // A plain request is only refused for not being a WebSocket.
  expect((await api()).status).toBe(426)
  expect((await api({ origin: `http://127.0.0.1:${base.port}` })).status).toBe(426)
  // DNS rebinding: a page on evil.example resolved to 127.0.0.1 names its own host.
  expect((await api({ host: `evil.example:${base.port}`, origin: `http://evil.example:${base.port}` })).status).toBe(421)
  // Another site's page in the browser, reaching for localhost.
  expect((await api({ origin: "http://evil.example" })).status).toBe(403)
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

