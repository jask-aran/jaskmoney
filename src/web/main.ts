/**
 * The web app: a proof that a client other than the TUI runs on the same
 * core. It is the TUI's own reactive layer (client/store) over a WebSocket
 * (client/wsLink) instead of an in-process link, drawn with the DOM: the
 * same filter language, account selection and categorising, live as the
 * TUI (or any other client) changes the data.
 */
import { createEffect, createRoot } from "solid-js"
import { createClientStore } from "../client/store"
import { wsLink } from "../client/wsLink"
import { formatMoney } from "../domain/dashboard"
import { selectionLabel } from "../domain/accountTree"
import { assignableCategories } from "../domain/categoryOptions"
import type { Category } from "../domain/types"

/** Rows drawn at most: a proof, not a virtualised table. */
const SHOWN = 300

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = $("status"), note = $("note"), message = $("message"), rows = $<HTMLTableSectionElement>("rows"), more = $("more")
const accounts = $<HTMLSelectElement>("accounts"), filter = $<HTMLInputElement>("filter")
const undoButton = $<HTMLButtonElement>("undo"), syncButton = $<HTMLButtonElement>("sync")

const token = new URLSearchParams(location.search).get("token")
const api = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api${token ? `?token=${encodeURIComponent(token)}` : ""}`
let disconnected = ""
const data = createClientStore(wsLink(api, { onClose: (reason) => { disconnected = reason; status.textContent = `disconnected: ${reason}`; status.className = "off" } }))

const say = (text: string) => { message.textContent = text }
const fail = (error: unknown) => say(error instanceof Error ? error.message : String(error))

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

createRoot(() => {
  createEffect(() => {
    if (disconnected) return
    const s = data.state
    if (!s.ready) { status.textContent = "connected · no database open"; return }
    const synced = s.dbInfo?.upLastSyncedAt ? `synced ${new Date(s.dbInfo.upLastSyncedAt).toLocaleString("en-AU")}` : "never synced"
    status.textContent = [s.demo ? "demo data" : s.dbPath, `${s.transactions.length.toLocaleString("en-AU")} transactions`, s.upSyncing ? "syncing…" : synced].join(" · ")
    status.className = ""
  })

  createEffect(() => {
    const selection = String(data.state.accountSelection)
    accounts.replaceChildren(
      el("option", { value: "all", textContent: "All accounts" }),
      el("option", { value: "savers", textContent: "All savers" }),
      ...data.state.accounts.map((a) => el("option", { value: String(a.id), textContent: a.name })),
    )
    accounts.value = selection
    accounts.title = selectionLabel(data.state.accounts, data.state.accountSelection)
  })

  createEffect(() => {
    if (document.activeElement !== filter) filter.value = data.state.filterQuery
    const n = data.state.filterNote
    note.textContent = data.state.filterErr || (n ? n.text : "")
    note.className = data.state.filterErr ? "error" : ""
  })

  createEffect(() => {
    const label = data.undoLabel()
    undoButton.disabled = !label
    undoButton.title = label ? `Undo ${label}` : "Nothing to undo"
    syncButton.disabled = data.state.upSyncing || data.state.demo
  })

  createEffect(() => {
    const all = data.scopedTransactions()
    const categories = data.state.categories
    // What the TUI's picker offers (groups aren't categories), under their groups.
    const groups = Map.groupBy(assignableCategories(categories, ""), (c) => categories.find((g) => g.id === c.parentId)?.name ?? "")
    rows.replaceChildren(...all.slice(0, SHOWN).map((t) => {
      const option = (c: Category) => el("option", { value: String(c.id), textContent: c.name, selected: c.id === t.categoryId })
      const choose = el("select", { title: "Category" },
        ...[...groups].map(([group, list]) => el("optgroup", { label: group || "Other" }, ...list.map(option))))
      choose.addEventListener("change", () => {
        const category = categories.find((c) => c.id === Number(choose.value))
        if (!category) return
        say(`Categorising as ${category.name}…`)
        data.categorizeTransactions([t.id], category.id).then(say, fail)
      })
      const dot = el("span", { className: "dot" })
      dot.style.background = t.categoryColor || "var(--overlay0)"
      return el("tr", {},
        el("td", { className: "date", textContent: t.dateISO }),
        el("td", { className: "desc", textContent: t.description }),
        el("td", { className: "account", textContent: t.accountName }),
        el("td", {}, el("span", { className: "cat" }, dot, choose)),
        el("td", { className: `amount${t.amount > 0 ? " in" : ""}`, textContent: formatMoney(t.amount) }),
      )
    }))
    more.textContent = all.length > SHOWN ? `Showing the first ${SHOWN} of ${all.length.toLocaleString("en-AU")} rows · narrow it with a filter` : `${all.length.toLocaleString("en-AU")} rows`
  })
})

accounts.addEventListener("change", () => data.setAccountSelection(accounts.value === "all" || accounts.value === "savers" ? accounts.value : Number(accounts.value)))
filter.addEventListener("input", () => data.setFilterLive(filter.value))
filter.addEventListener("keydown", (event) => {
  if (event.key === "Enter") data.commitFilter(filter.value)
  if (event.key === "Escape") { data.clearFilter(); filter.value = "" }
})
undoButton.addEventListener("click", () => { data.undo().then(say, fail) })
syncButton.addEventListener("click", () => { say("Syncing with Up…"); data.syncUp().then(say, fail) })
