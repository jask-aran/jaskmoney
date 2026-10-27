import { createModels, type Api, type Model, type Models } from "@earendil-works/pi-ai"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import { credentialEnv } from "./credentials"

/**
 * The general model: an OpenRouter chat model reached through pi-ai, for
 * work that needs writing rather than judging (rules). Jev (judging) and
 * Clairic (reading values) keep their own clients.
 */
export const DEFAULT_LLM_MODEL = "meta/muse-spark-1.3-contributor"

export class LlmError extends Error {}

export function readOpenRouterToken(env: Record<string, string | undefined> = credentialEnv()): string {
  const token = env.JASKMONEY_OPENROUTER_TOKEN?.trim()
  if (!token) throw new LlmError("Add an OpenRouter key in Settings › AI models")
  return token
}

export function hasLlm(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return !!env.JASKMONEY_OPENROUTER_TOKEN?.trim()
}

/** The model to use: Settings' choice, or the default. */
export function llmModelId(env: Record<string, string | undefined> = credentialEnv()): string {
  return env.JASKMONEY_LLM_MODEL?.trim() || DEFAULT_LLM_MODEL
}

export interface Llm {
  models: Models
  model: Model<Api>
  /** Passed with each request (pi-ai's own key lookup isn't used). */
  apiKey?: string
}

/** OpenRouter only: no other provider's catalog or SDK is loaded. */
export function createLlm(options: { apiKey?: string; modelId?: string } = {}): Llm {
  const models = createModels()
  models.setProvider(openrouterProvider())
  const id = options.modelId ?? llmModelId()
  const model = models.getModel("openrouter", id)
  if (!model) throw new LlmError(`OpenRouter has no model ${id}`)
  return { models, model, apiKey: options.apiKey ?? readOpenRouterToken() }
}
