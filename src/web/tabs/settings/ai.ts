/**
 * Settings › AI models for the web: the TUI's pane (state/aiDialog: its
 * names, its words) worked out from the core's state alone. The TUI reads
 * its own environment; a browser asks the core (`apiKeys` masks, `signedIn`,
 * `jev`, `clairic`, `llm`), so this mirrors aiConnection, aiRow and useModel
 * without the parts that need the environment or a model catalogue.
 */
import type { ClientStore } from "../../../client/store"

type CoreState = ClientStore["state"]

export type ModelRow = "jev" | "workersAi" | "openrouter" | "openai"
type KeyRow = ModelRow | "up"
type Provider = "openrouter" | "openai"
type KeyName = keyof CoreState["apiKeys"]

/** The models, in the TUI's order (app/apiKeys AI_ROWS). */
export const MODEL_ROWS: readonly ModelRow[] = ["jev", "workersAi", "openrouter", "openai"]

/** As state/aiDialog's AI_NAMES. */
export const AI_NAMES: Record<KeyRow, { name: string; by: string; uses: string }> = {
  jev: { name: "Jev", by: "TypeSafe", uses: "suggestions and search" },
  workersAi: { name: "Clairic", by: "Cloudflare Workers AI", uses: "search: the words and dates of a smart search" },
  openrouter: { name: "OpenRouter", by: "general model; also reaches Jev", uses: "rules, and Jev when there's no TypeSafe key" },
  openai: { name: "OpenAI", by: "general model", uses: "rules" },
  up: { name: "Up Bank", by: "Personal Access Token", uses: "syncing accounts and transactions; your categories and tags go back to Up" },
}

/** As ai/llm's LLM_PROVIDERS (the parts the pane says). */
const PROVIDERS: Record<Provider, { label: string; keyName: KeyName }> = {
  openrouter: { label: "OpenRouter", keyName: "JASKMONEY_OPENROUTER_TOKEN" },
  openai: { label: "OpenAI", keyName: "JASKMONEY_OPENAI_TOKEN" },
}

/** The uses (ai/catalog USES), each with the model doing it. */
export const USES = [
  { id: "suggestions", name: "Suggestions" },
  { id: "search", name: "Search" },
  { id: "rules", name: "Rules" },
] as const
export type Use = (typeof USES)[number]["id"]

type State = Pick<CoreState, "apiKeys" | "signedIn" | "jev" | "clairic" | "llm">

const NONE = { source: null, mask: "" } as const
const keyOf = (state: State, name: KeyName) => state.apiKeys[name] ?? NONE
const isProvider = (row: KeyRow): row is Provider => row === "openrouter" || row === "openai"

/** The key a row's connection rests on (Workers AI needs its account id too). */
function rowKey(row: KeyRow, state: State) {
  if (row === "up") return keyOf(state, "JASKMONEY_UP_TOKEN")
  if (row === "jev") return keyOf(state, "JASKMONEY_JEV_TOKEN")
  if (row === "workersAi") return keyOf(state, "JASKMONEY_CF_TOKEN").source && keyOf(state, "JASKMONEY_CF_ACCOUNT_ID").source ? keyOf(state, "JASKMONEY_CF_TOKEN") : NONE
  return keyOf(state, PROVIDERS[row].keyName)
}

/** How a row is connected, in full and in short; null when it isn't (aiConnection). */
export function connection(row: KeyRow, state: State): { long: string; short: string } | null {
  const key = rowKey(row, state)
  if (key.source === "saved") return { long: "key saved here", short: "key · saved" }
  if (key.source === "env") return { long: "from the environment", short: "key · env" }
  if (isProvider(row) && state.signedIn[row]) return { long: "signed in with the browser", short: "signed in" }
  // Without its own key, Jev goes through OpenRouter when that's connected.
  if (row === "jev") {
    const openrouter = connection("openrouter", state)
    if (openrouter) return { long: `through OpenRouter (${openrouter.long})`, short: "via OpenRouter" }
  }
  return null
}

/** The general model's provider in use: the one chosen in the TUI when it's
 * reachable, else the first reachable one, else OpenRouter (activeLlmProvider). */
function inUse(state: State): Provider {
  const reachable = (p: Provider) => !!keyOf(state, PROVIDERS[p].keyName).source || state.signedIn[p]
  const chosen = keyOf(state, "JASKMONEY_LLM_PROVIDER").mask.trim()
  if ((chosen === "openrouter" || chosen === "openai") && reachable(chosen)) return chosen
  return (["openrouter", "openai"] as const).find(reachable) ?? "openrouter"
}

/** The model doing a use, as the TUI names it; `ready` when it can run (useModel). */
export function useModel(use: Use, state: State): { text: string; ready: boolean } {
  if (use === "rules") {
    const provider = inUse(state)
    const { label } = PROVIDERS[provider]
    if (!connection(provider, state) || !state.llm) return { text: `${label}: not connected`, ready: false }
    return { text: `${label} · ${state.llm}`, ready: true }
  }
  const via = state.jev === "typesafe" ? "TypeSafe" : state.jev === "openrouter" ? "OpenRouter" : null
  if (!via) return { text: "Jev: not connected", ready: false }
  return { text: `Jev (${via})${use === "search" && state.clairic ? " + Clairic" : ""}`, ready: true }
}
