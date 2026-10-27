import { createModels, getSupportedThinkingLevels, type Api, type Model, type Models, type ThinkingLevel } from "@earendil-works/pi-ai"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import { credentialEnv } from "./credentials"
import { createFileCredentialStore, signedIn } from "./oauthStore"

/**
 * The general model, for work that needs writing rather than judging
 * (rules), reached through pi-ai: OpenRouter or OpenAI, each by an API key
 * (Settings or .env) or a browser sign-in (OpenRouter's OAuth mints a key;
 * OpenAI's is Sign in with ChatGPT, on your ChatGPT plan). Jev (judging) and
 * Clairic (reading values) keep their own clients.
 */
export type LlmProvider = "openrouter" | "openai"

type Env = Record<string, string | undefined>

export const LLM_PROVIDERS: Record<LlmProvider, { label: string; keyName: "JASKMONEY_OPENROUTER_TOKEN" | "JASKMONEY_OPENAI_TOKEN"; modelName: "JASKMONEY_OPENROUTER_MODEL" | "JASKMONEY_OPENAI_MODEL"; defaultModel: string; signIn: string }> = {
  openrouter: { label: "OpenRouter", keyName: "JASKMONEY_OPENROUTER_TOKEN", modelName: "JASKMONEY_OPENROUTER_MODEL", defaultModel: "meta/muse-spark-1.3-contributor", signIn: "Sign in with OpenRouter" },
  openai: { label: "OpenAI", keyName: "JASKMONEY_OPENAI_TOKEN", modelName: "JASKMONEY_OPENAI_MODEL", defaultModel: "gpt-6.1-sol", signIn: "Sign in with ChatGPT" },
}

/** OpenRouter's default model (the first provider's). */
export const DEFAULT_LLM_MODEL = LLM_PROVIDERS.openrouter.defaultModel

export class LlmError extends Error {}

/** How a provider is reached: a key saved in Settings or in .env, a browser sign-in, or not at all. */
export function llmAuth(provider: LlmProvider, env: Env = credentialEnv()): "key" | "signed in" | null {
  if (env[LLM_PROVIDERS[provider].keyName]?.trim()) return "key"
  return signedIn(provider) ? "signed in" : null
}

/** The provider in use: the one chosen in Settings (u) when it's reachable,
 * else the first reachable one, else OpenRouter. */
export function activeLlmProvider(env: Env = credentialEnv()): LlmProvider {
  const chosen = env.JASKMONEY_LLM_PROVIDER?.trim()
  if ((chosen === "openrouter" || chosen === "openai") && llmAuth(chosen, env)) return chosen
  return (["openrouter", "openai"] as const).find((p) => llmAuth(p, env)) ?? "openrouter"
}

export function hasLlm(env: Env = credentialEnv()): boolean {
  return llmAuth(activeLlmProvider(env), env) !== null
}

/** A provider's model: Settings' choice, or its default. (JASKMONEY_LLM_MODEL was OpenRouter's, before OpenAI.) */
export function llmModelId(env: Env = credentialEnv(), provider: LlmProvider = activeLlmProvider(env)): string {
  const saved = env[LLM_PROVIDERS[provider].modelName]?.trim() || (provider === "openrouter" ? env.JASKMONEY_LLM_MODEL?.trim() : "")
  return saved || LLM_PROVIDERS[provider].defaultModel
}

/** How hard the model thinks: the highest of these it supports. */
export const LLM_EFFORT: readonly ThinkingLevel[] = ["xhigh", "high", "medium"]

export function llmEffort(model: Model<Api>): ThinkingLevel | undefined {
  if (!model.reasoning) return undefined
  const supported = getSupportedThinkingLevels(model)
  return LLM_EFFORT.find((level) => supported.includes(level))
}

export interface Llm {
  models: Models
  model: Model<Api>
  /** Reasoning effort for each request (llmEffort), when the model reasons. */
  effort?: ThinkingLevel
  /** A key passed with each request; without one, pi-ai uses the provider's sign-in. */
  apiKey?: string
}

/** pi-ai with the two providers and the sign-in store; nothing else is loaded. */
export function llmModels(): Models {
  const models = createModels({ credentials: createFileCredentialStore() })
  models.setProvider(openrouterProvider())
  models.setProvider(openaiProvider())
  return models
}

export function createLlm(options: { provider?: LlmProvider; apiKey?: string; modelId?: string } = {}): Llm {
  const env = credentialEnv()
  const provider = options.provider ?? activeLlmProvider(env)
  const models = llmModels()
  const id = options.modelId ?? llmModelId(env, provider)
  const model = models.getModel(provider, id)
  if (!model) throw new LlmError(`${LLM_PROVIDERS[provider].label} has no model ${id}`)
  const apiKey = options.apiKey ?? (env[LLM_PROVIDERS[provider].keyName]?.trim() || undefined)
  if (!apiKey && !signedIn(provider)) throw new LlmError(`Add a ${LLM_PROVIDERS[provider].label} key or sign in, in Settings › AI models`)
  const effort = llmEffort(model)
  return { models, model, ...(apiKey ? { apiKey } : {}), ...(effort ? { effort } : {}) }
}
