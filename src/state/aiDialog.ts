import { activeLlmProvider, LLM_PROVIDERS, llmEffort, llmModelId, llmModels, type LlmProvider } from "../ai/llm"
import { credentialEnv, type CredentialName } from "../ai/credentials"
import type { DataStore } from "./dataStore"
import { isLlmRow, type KeyRow } from "../app/apiKeys"

/**
 * Settings › AI models: one row per model, and one dialog (enter) for
 * everything about it: how it's connected, its model, what it's used for,
 * and the actions (sign in with the browser, enter a key, change the
 * model, test, use for rules, remove). Pure: what the pane and the dialog
 * show, from the stored keys and sign-ins.
 */
export type AiAction = "signIn" | "key" | "accountId" | "model" | "test" | "use" | "remove"

export interface AiContext {
  keys: Record<CredentialName, { source: "saved" | "env" | null; mask: string }>
  signedIn: Record<LlmProvider, boolean>
  /** The general model's provider in use. */
  inUse: LlmProvider
  /** A provider's model id, and whether it's the default. */
  model: (provider: LlmProvider) => { id: string; isDefault: boolean; effort?: string }
}

export const AI_NAMES: Record<KeyRow, { name: string; by: string; uses: string; usesShort: string }> = {
  jev: { name: "Jev", by: "TypeSafe", uses: "category suggestions, ask: searches, smart search", usesShort: "suggestions · ask:" },
  workersAi: { name: "Clairic", by: "Cloudflare Workers AI", uses: "smart search's words and dates", usesShort: "smart search" },
  openrouter: { name: "OpenRouter", by: "general model", uses: "writing rules (R, then a)", usesShort: "rules" },
  openai: { name: "OpenAI", by: "general model", uses: "writing rules (R, then a)", usesShort: "rules" },
  up: { name: "Up Bank", by: "Personal Access Token", uses: "syncing accounts and transactions; your categories and tags go back to Up", usesShort: "sync" },
}

/** The context from the stores and settings (keys, sign-ins, provider in use, models). */
export function aiContext(data: Pick<DataStore, "state">): AiContext {
  const env = credentialEnv()
  return {
    keys: data.state.apiKeys,
    signedIn: data.state.signedIn,
    inUse: activeLlmProvider(env),
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
  return { name: AI_NAMES[row].name, connected: !!connection, how: connection?.short ?? "not set", uses: `${AI_NAMES[row].usesShort}${aiInUse(row, ctx) ? " · in use" : ""}` }
}

/** The dialog's status lines. */
export function aiStatus(row: KeyRow, ctx: AiContext): { label: string; value: string }[] {
  const lines = [{ label: "Connection", value: aiConnection(row, ctx)?.long ?? "not set" }]
  if (row === "workersAi" && ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source) lines.push({ label: "Account", value: ctx.keys.JASKMONEY_CF_ACCOUNT_ID.source === "env" ? "from the environment" : "saved here" })
  if (isLlmRow(row)) {
    const model = ctx.model(row)
    lines.push({ label: "Model", value: `${model.id}${model.isDefault ? " (default)" : ""}${model.effort ? ` · ${model.effort} effort` : ""}` })
  }
  lines.push({ label: "Used for", value: `${AI_NAMES[row].uses}${aiInUse(row, ctx) ? " · in use" : isLlmRow(row) ? ` · ${LLM_PROVIDERS[ctx.inUse].label} is in use` : ""}` })
  return lines
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
  if (isLlmRow(row) && connected && ctx.inUse !== row) actions.push({ id: "use", label: "Use for writing rules" })
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
