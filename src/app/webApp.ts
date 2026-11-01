import { data } from "../state/dataStore"
import type { ConnectedClient } from "../core/protocol"
import { openBrowser } from "./llmSignIn"

type Serving = { page: string; clients: number }

/** The core's server and how many are connected, from the state the daemon
 * broadcasts (core server, clients): the same whether this TUI serves or
 * connects to a core that does. */
function serving(): Serving | null {
  const server = data.state.server
  return server ? { page: server.page, clients: data.state.clients.filter((c) => c.kind === "web").length } : null
}

/** Test seam: what the core would broadcast, with `clients` stand-in clients. */
function setServing(value: Serving | null): void {
  const clients: ConnectedClient[] = Array.from({ length: value?.clients ?? 0 }, (_, i) => ({
    id: i + 1, kind: "web", agent: "Browser", address: "127.0.0.1", via: "direct", since: 0,
  }))
  data.setState({ server: value ? { page: value.page, api: new URL("/api", value.page).href.replace(/^http/, "ws") } : null, clients })
}

/** Replace open in tests, as with executorSource.sources. */
export const web = { open: openBrowser as (url: string) => void, serving, setServing }
export const webLabel = (value: Serving | null): string => value == null ? "" : value.clients >= 1 ? `${value.clients} web client${value.clients === 1 ? "" : "s"}` : "web app"
