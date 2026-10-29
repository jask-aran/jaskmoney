import { activeLlmProvider, LLM_PROVIDERS, llmEffort, llmModelId, llmModelInfo, llmModels, type LlmProvider } from "../ai/llm"
import { credentialEnv, type CredentialName } from "../ai/credentials"
import type { DataStore } from "./dataStore"
import { isLlmRow, type AiRow, type KeyRow } from "../app/apiKeys"
import { MODEL_KINDS, QUERIES, queriesOf, type AiUse, type QueryId } from "../ai/catalog"
import { jevEndpoint, REQUEST_BUDGET } from "../ai/jev"
import { workersAiUrl } from "../ai/workersAi"

/**
 * Settings › AI models: the models, each with a dialog (enter) for how it's
 * connected (sign in with the browser, enter a key, change the model,
 * test, remove); then the uses, each with the model doing it and a dialog
 * to choose it and to see exactly what is sent. Pure: what the pane and
 * the dialogs show, from the stored keys, settings and sign-ins.
 */
export type AiAction = "signIn" | "key" | "accountId" | "model" | "test" | "remove"

export interface AiContext {
  keys: Record<CredentialName, { source: "saved" | "env" | null; mask: string }>
  signedIn: Record<LlmProvider, boolean>
  /** The general model's provider in use. */
  inUse: LlmProvider
  /** A provider's model id, and whether it's the default. */
  model: (provider: LlmProvider) => { id: string; isDefault: boolean; effort?: string }
  /** Smart search asks Clairic too, when it's connected. */
  searchClairic: boolean
}

export const AI_NAMES: Record<KeyRow, { name: string; by: string; uses: string }> = {
  jev: { name: "Jev", by: "TypeSafe", uses: "suggestions and search" },
  workersAi: { name: "Clairic", by: "Cloudflare Workers AI", uses: "search: the words and dates of a smart search" },
  openrouter: { name: "OpenRouter", by: "general model; also reaches Jev", uses: "rules, and Jev when there's no TypeSafe key" },
  openai: { name: "OpenAI", by: "general model", uses: "rules" },
  up: { name: "Up Bank", by: "Personal Access Token", uses: "syncing accounts and transactions; your categories and tags go back to Up" },
}

/** The context from the stores and settings (keys, sign-ins, provider in use, models). */
export function aiContext(data: Pick<DataStore, "state">): AiContext {
  const env = credentialEnv()
  return {
    keys: data.state.apiKeys,
    signedIn: data.state.signedIn,
    inUse: activeLlmProvider(env),
    searchClairic: env.JASKMONEY_SEARCH_CLAIRIC?.trim() !== "off",
    model: (provider) => {
      const id = llmModelId(env, provider)
      const model = llmModels().getModel(provider, id)
      const effort = model ? llmEffort(model) : undefined
      return { id, isDefault: id === LLM_PROVIDERS[provider].defaultModel, ...(effort ? { effort } : {}) }
    },
  }
}

/** The key a row's connection rests on (Workers AI needs its account id too). */
function keyOf(row: KeyRow, ctx: AiContext) {
  if (row === "up") return ctx.keys.JASKMONEY_UP_TOKEN
  if (row === "jev") return ctx.keys.JASKMONEY_JEV_TOKEN
  if (row === "workersAi") return ctx.keys.JASKMONEY_CF_TOKEN.source && ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source ? ctx.keys.JASKMONEY_CF_TOKEN : { source: null, mask: "" }
  return ctx.keys[LLM_PROVIDERS[row].keyName]
}

/** How a row is connected, in full and in short; null when it isn't. */
export function aiConnection(row: KeyRow, ctx: AiContext): { long: string; short: string } | null {
  const key = keyOf(row, ctx)
  if (key.source === "saved") return { long: `key saved here (${key.mask})`, short: "key · saved" }
  if (key.source === "env") return { long: `from the environment (${key.mask})`, short: "key · env" }
  if (isLlmRow(row) && ctx.signedIn[row]) return { long: "signed in with the browser", short: "signed in" }
  // Without its own key, Jev goes through OpenRouter when that's connected.
  if (row === "jev") {
    const openrouter = aiConnection("openrouter", ctx)
    if (openrouter) return { long: `through OpenRouter (${openrouter.long})`, short: "via OpenRouter" }
  }
  return null
}

export function aiInUse(row: KeyRow, ctx: AiContext): boolean {
  return isLlmRow(row) && ctx.inUse === row && aiConnection(row, ctx) !== null
}

/** The pane's row. */
export function aiRow(row: KeyRow, ctx: AiContext) {
  const connection = aiConnection(row, ctx)
  return { name: AI_NAMES[row].name, connected: !!connection, how: connection?.short ?? "not set" }
}

/** The dialog's status lines. */
export function aiStatus(row: KeyRow, ctx: AiContext): { label: string; value: string }[] {
  const lines = [{ label: "Connection", value: aiConnection(row, ctx)?.long ?? "not set" }]
  if (row === "workersAi" && ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source) lines.push({ label: "Account", value: ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source === "env" ? "from the environment" : "saved here" })
  if (row === "up") return [...lines, { label: "Used for", value: AI_NAMES.up.uses }]
  return [...lines, ...modelFacts(row, ctx)]
}

const thousands = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const names = (ids: QueryId[]) => ids.map((id) => QUERIES[id].name).join(", ")

/** What a model is: its model, address, how it's signed in to, what it
 * does, its limits and price, and the queries it answers now. Addresses
 * and limits from the clients and pi-ai's catalog. */
function modelFacts(row: AiRow, ctx: AiContext): { label: string; value: string }[] {
  const kind = row === "jev" ? "jev" : row === "workersAi" ? "clairic" : "general"
  const lines: { label: string; value: string }[] = []
  if (row === "jev") {
    const viaOpenRouter = jevVia(ctx) === "OpenRouter"
    const endpoint = jevEndpoint(viaOpenRouter ? "openrouter" : "typesafe")
    lines.push(
      { label: "Model", value: endpoint.model },
      { label: "Endpoint", value: `POST ${endpoint.url}` },
      { label: "Auth", value: "A TypeSafe API key, sent as a bearer token; without one, OpenRouter's key or browser sign-in (OpenRouter serves Jev too)" },
      { label: "Limits", value: `${thousands(endpoint.contextWindow)} tokens a request; the app fills each to about ${thousands(REQUEST_BUDGET)}` },
    )
  } else if (row === "workersAi") {
    lines.push(
      { label: "Model", value: "@cf/cloudflare/clairic" },
      { label: "Endpoint", value: `POST ${workersAiUrl("<account id>")}` },
      { label: "Auth", value: "A Cloudflare API token, sent as a bearer token, and your account ID (in the address)" },
    )
  } else {
    const model = ctx.model(row)
    const info = llmModelInfo(row, model.id)
    lines.push({ label: "Model", value: `${model.id}${model.isDefault ? " (default)" : ""}${model.effort ? ` · ${model.effort} effort` : ""}` })
    if (info) lines.push({ label: "Endpoint", value: `${info.baseUrl} (${info.api})` })
    lines.push({ label: "Auth", value: row === "openrouter" ? "An API key, or the browser sign-in (OAuth: it creates an API key on your OpenRouter account)" : "An API key, or Sign in with ChatGPT (OAuth: your ChatGPT plan, no key)" })
    if (info) lines.push(
      { label: "Limits", value: `${thousands(info.contextWindow)} tokens of context, ${thousands(info.maxTokens)} out` },
      { label: "Price", value: `$${info.cost.input} in, $${info.cost.output} out per million tokens (pi-ai's catalog)` },
    )
  }
  lines.push({ label: "Does", value: MODEL_KINDS[kind].does })
  if (MODEL_KINDS[kind].price) lines.push({ label: "Price", value: MODEL_KINDS[kind].price! })
  lines.push({ label: "Used by", value: usedBy(row, ctx) })
  return lines
}

/** The queries a model answers now. */
function usedBy(row: AiRow, ctx: AiContext): string {
  if (row === "jev") return names(queriesOf("jev"))
  if (row === "workersAi") return `${names(queriesOf("clairic"))}${ctx.searchClairic ? "" : " (switched off in Search)"}`
  const jev = row === "openrouter" && jevVia(ctx) === "OpenRouter" ? "Jev's queries (no TypeSafe key)" : ""
  const rules = ctx.inUse === row ? names(queriesOf("general")) : ""
  return [rules, jev].filter(Boolean).join("; ") || `nothing now (${LLM_PROVIDERS[ctx.inUse].label} writes rules)`
}

/** The dialog's actions, the likeliest first: a general model's browser sign-in. */
export function aiActions(row: KeyRow, ctx: AiContext): { id: AiAction; label: string }[] {
  const connected = aiConnection(row, ctx) !== null
  const actions: { id: AiAction; label: string }[] = []
  if (isLlmRow(row)) actions.push({ id: "signIn", label: ctx.signedIn[row] ? "Sign in again with the browser" : "Sign in with the browser" })
  actions.push({ id: "key", label: row === "up" ? "Enter the token" : row === "workersAi" ? "Enter an API token" : "Enter an API key" })
  if (row === "workersAi") actions.push({ id: "accountId", label: "Enter the account ID" })
  if (isLlmRow(row)) actions.push({ id: "model", label: "Change the model" })
  if (connected) actions.push({ id: "test", label: "Test" })
  if (removable(row, ctx)) actions.push({ id: "remove", label: isLlmRow(row) ? "Remove the saved key, model and sign-in" : "Remove the saved key" })
  return actions
}

/** What the action at the cursor does, when it needs saying. OpenRouter's
 * browser sign-in mints a permanent key on the account: signing in again
 * makes another, and removing only forgets this app's copy. */
export function aiActionHint(row: KeyRow, action: AiAction, ctx: AiContext): string | null {
  if (action === "signIn") {
    const again = isLlmRow(row) && ctx.signedIn[row]
    if (row === "openrouter") return `Opens OpenRouter in your browser. It creates an API key on your account${again ? " (another one: the last stays active until you delete it on openrouter.ai)" : ""}.`
    if (row === "openai") return "Opens Sign in with ChatGPT in your browser: uses your ChatGPT plan, no API key."
  }
  if (action === "key" && row === "up") return "A Personal Access Token from api.up.com.au. Saved only for you (~/.jaskmoney/credentials.json); used before the environment's."
  if (action === "key") return "Saved only for you (~/.jaskmoney/credentials.json); used before the environment's and a browser sign-in."
  if (action === "model" && isLlmRow(row)) return `An ${LLM_PROVIDERS[row].label} model id; empty means ${LLM_PROVIDERS[row].defaultModel}.`
  if (action === "remove") {
    if (row === "openrouter" && ctx.signedIn.openrouter) return "Forgets the sign-in here. Its key stays active on OpenRouter: delete it at openrouter.ai/settings/keys."
    if (row === "openai" && ctx.signedIn.openai) return "Forgets the sign-in here; you can also disconnect the app in ChatGPT's settings."
    return "A key set in the environment stays: unset it there."
  }
  return null
}

/** Something saved here to remove (a key from the environment stays: it isn't the app's). */
export function removable(row: KeyRow, ctx: AiContext): boolean {
  if (row === "up") return ctx.keys.JASKMONEY_UP_TOKEN.source === "saved"
  if (row === "jev") return ctx.keys.JASKMONEY_JEV_TOKEN.source === "saved"
  if (row === "workersAi") return ctx.keys.JASKMONEY_CF_TOKEN.source === "saved" || ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source === "saved"
  const { keyName, modelName } = LLM_PROVIDERS[row]
  return ctx.keys[keyName].source === "saved" || ctx.keys[modelName].source === "saved" || ctx.signedIn[row]
}

// ---------- Uses ----------

export { AI_USES, type AiUse } from "../ai/catalog"

/** How Jev is reached: TypeSafe (its key) wins over OpenRouter. */
function jevVia(ctx: AiContext): "TypeSafe" | "OpenRouter" | null {
  if (ctx.keys.JASKMONEY_JEV_TOKEN.source) return "TypeSafe"
  return aiConnection("openrouter", ctx) ? "OpenRouter" : null
}

/** The model doing a use, as the pane and the dialog name it; `ready` when it can run. */
export function useModel(use: AiUse, ctx: AiContext): { text: string; ready: boolean } {
  if (use === "rules") {
    const provider = ctx.inUse
    if (!aiConnection(provider, ctx)) return { text: `${LLM_PROVIDERS[provider].label}: not connected`, ready: false }
    return { text: `${LLM_PROVIDERS[provider].label} · ${ctx.model(provider).id}`, ready: true }
  }
  const via = jevVia(ctx)
  if (!via) return { text: "Jev: not connected", ready: false }
  const clairic = use === "search" && ctx.searchClairic && !!aiConnection("workersAi", ctx)
  return { text: `Jev (${via})${clairic ? " + Clairic" : ""}`, ready: true }
}

export type UseAction = { id: "clairic"; on: boolean } | { id: "provider"; provider: LlmProvider } | { id: "connect"; row: AiRow }

/** A use dialog's model actions: choose its model, connect one it needs. */
export function useActions(use: AiUse, ctx: AiContext): Array<UseAction & { label: string }> {
  const out: Array<UseAction & { label: string }> = []
  if (use === "rules") {
    for (const provider of ["openrouter", "openai"] as const) {
      if (provider === ctx.inUse) continue
      out.push(aiConnection(provider, ctx)
        ? { id: "provider", provider, label: `Use ${LLM_PROVIDERS[provider].label} instead` }
        : { id: "connect", row: provider, label: `Connect ${LLM_PROVIDERS[provider].label}…` })
    }
    if (!aiConnection(ctx.inUse, ctx)) out.unshift({ id: "connect", row: ctx.inUse, label: `Connect ${LLM_PROVIDERS[ctx.inUse].label}…` })
  } else if (!jevVia(ctx)) out.push({ id: "connect", row: "jev", label: "Connect Jev…" })
  if (use === "search") {
    out.push(aiConnection("workersAi", ctx)
      ? { id: "clairic", on: !ctx.searchClairic, label: ctx.searchClairic ? "Stop using Clairic (Jev picks the words; written dates are missed)" : "Use Clairic for the words and dates" }
      : { id: "connect", row: "workersAi", label: "Connect Clairic… (optional: reads words and dates)" })
  }
  return out
}
