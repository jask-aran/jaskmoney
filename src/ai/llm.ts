import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai"
import { piAi, piModels, piProviders } from "./piAi"
import { credentialEnv } from "./credentials"
import { createFileCredentialStore, signedIn } from "./oauthStore"

export type LlmProvider = "openrouter" | "openai"

type Env = Record<string, string | undefined>

export const LLM_PROVIDERS: Record<LlmProvider, { label: string; keyName: "JASKMONEY_OPENROUTER_TOKEN" | "JASKMONEY_OPENAI_TOKEN"; modelName: "JASKMONEY_OPENROUTER_MODEL" | "JASKMONEY_OPENAI_MODEL"; defaultModel: string; signIn: string }> = {
  openrouter: { label: "OpenRouter", keyName: "JASKMONEY_OPENROUTER_TOKEN", modelName: "JASKMONEY_OPENROUTER_MODEL", defaultModel: "meta/muse-spark-1.3-contributor", signIn: "Sign in with OpenRouter" },
  openai: { label: "OpenAI", keyName: "JASKMONEY_OPENAI_TOKEN", modelName: "JASKMONEY_OPENAI_MODEL", defaultModel: "gpt-6.1-sol", signIn: "Sign in with ChatGPT" },
}

class LlmError extends Error {}

export function llmAuth(provider: LlmProvider, env: Env = credentialEnv()): "key" | "signed in" | null {
  if (env[LLM_PROVIDERS[provider].keyName]?.trim()) return "key"
  return signedIn(provider) ? "signed in" : null
}

export function activeLlmProvider(env: Env = credentialEnv()): LlmProvider {
  const chosen = env.JASKMONEY_LLM_PROVIDER?.trim()
  if ((chosen === "openrouter" || chosen === "openai") && llmAuth(chosen, env)) return chosen
  return (["openrouter", "openai"] as const).find((p) => llmAuth(p, env)) ?? "openrouter"
}

export function hasLlm(env: Env = credentialEnv()): boolean {
  return llmAuth(activeLlmProvider(env), env) !== null
}

export function llmModelId(env: Env = credentialEnv(), provider: LlmProvider = activeLlmProvider(env)): string {
  const saved = env[LLM_PROVIDERS[provider].modelName]?.trim() || (provider === "openrouter" ? env.JASKMONEY_LLM_MODEL?.trim() : "")
  return saved || LLM_PROVIDERS[provider].defaultModel
}

const LLM_EFFORT: readonly ThinkingLevel[] = ["xhigh", "high", "medium"]

export function llmEffort(model: Model<Api>): ThinkingLevel | undefined {
  if (!model.reasoning) return undefined
  const supported = piAi().getSupportedThinkingLevels(model)
  return LLM_EFFORT.find((level) => supported.includes(level))
}

export interface Llm {
  models: Models
  model: Model<Api>
  effort?: ThinkingLevel
  apiKey?: string
}

export function llmModels(): Models {
  const models = piModels().createModels({ credentials: createFileCredentialStore() })
  models.setProvider(piProviders.openrouter())
  models.setProvider(piProviders.openai())
  return models
}

export function llmModelInfo(provider: LlmProvider, id: string = llmModelId(credentialEnv(), provider)): Model<Api> | null {
  return llmModels().getModel(provider, id) ?? null
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
