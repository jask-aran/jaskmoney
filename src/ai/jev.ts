import type { ClassifierAnswer, ClassifierContext, ClassifierQuestion, Models } from "@earendil-works/pi-ai"
import { piModels, piProviders } from "./piAi"
import { credentialEnv } from "./credentials"
import type { Fetch } from "./workersAi"
import { createFileCredentialStore, signedIn } from "./oauthStore"
import { JEV_SETUP, type JevAnswer, type JevQuestion, type JevState } from "./judge"

export { JEV_SETUP, REQUEST_BUDGET, judgeEach, type JevAnswer, type JevQuestion, type JevState } from "./judge"

export const JEV_MODEL = "jev-1.14.0"

export class JevError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "JevError"
  }
}

export function jevRoute(env: Record<string, string | undefined> = credentialEnv(), openrouterSignedIn = signedIn("openrouter")): { provider: JevProvider; token?: string } | null {
  const typesafe = env.JASKMONEY_JEV_TOKEN?.trim()
  if (typesafe) return { provider: "typesafe", token: typesafe }
  const openrouter = env.JASKMONEY_OPENROUTER_TOKEN?.trim()
  if (openrouter) return { provider: "openrouter", token: openrouter }
  return openrouterSignedIn ? { provider: "openrouter" } : null
}

export function hasJev(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return jevRoute(env) != null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const RETRIES = 3

export type JevProvider = "typesafe" | "openrouter"

const JEV_MODELS: Record<JevProvider, { catalog: string; id: string }> = {
  typesafe: { catalog: "jev-latest", id: JEV_MODEL },
  openrouter: { catalog: "typesafe/jev-1.14", id: "typesafe/jev-1.14" },
}

function jevModels(): Models {
  const models = piModels().createModels({ credentials: createFileCredentialStore() })
  models.setProvider(piProviders.typesafe())
  models.setProvider(piProviders.openrouter())
  return models
}

function piQuestion(question: JevQuestion): ClassifierQuestion {
  return (question.type === "noul" ? { ...question, type: "bool" } : question) as ClassifierQuestion
}

function fromPi(answer: ClassifierAnswer | undefined): JevAnswer | null {
  if (answer?.type === "bool") return { type: "noul", noul: answer.probability }
  if (answer?.type === "choice") return { type: "choice", choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence }
  return null
}

function piError(message: string): { status: number; message: string } {
  const missing = /did not return an? (?:\w+ )?answer for (\S+)/.exec(message)
  if (missing) return { status: 200, message: `Jev: no usable answer for ${missing[1]}` }
  const match = /\((\d{3})\): ([\s\S]*)$/.exec(message)
  if (!match) return { status: 0, message: /timed? ?out|timeout/i.test(message) ? "Jev timed out" : `Jev request failed: ${message}` }
  let payload: unknown = null
  try { payload = JSON.parse(match[2]!) } catch {}
  const detail = object(payload) ? payload.detail ?? payload.error ?? payload.message : null
  const text = typeof detail === "string" ? detail
    : object(detail) && typeof detail.message === "string" ? detail.message
    : Array.isArray(detail) && object(detail[0]) && typeof detail[0].msg === "string" ? detail[0].msg
    : `HTTP ${match[1]}`
  return { status: Number(match[1]), message: `Jev: ${text}` }
}

export function jevEndpoint(provider: JevProvider): { url: string; model: string; contextWindow: number } {
  const entry = jevModels().getModelOfType("classifier", provider, JEV_MODELS[provider].catalog)
  return { url: `${(entry?.baseUrl ?? "").replace(/\/$/, "")}/systemone`, model: JEV_MODELS[provider].id, contextWindow: entry?.contextWindow ?? 0 }
}

export function createJevClient({ token, provider = "typesafe", fetch, timeoutMs = 30_000, retries = RETRIES }: { token?: string; provider?: JevProvider; fetch?: Fetch; timeoutMs?: number; retries?: number }) {
  const redact = (message: string) => (token ? message.split(token).join("[redacted]") : message)
  const models = jevModels()
  const entry = models.getModelOfType("classifier", provider, JEV_MODELS[provider].catalog)
  if (!entry) throw new JevError(0, `pi-ai has no Jev model on ${provider}`)
  const model = { ...entry, id: JEV_MODELS[provider].id }

  return {
    provider,
    async judge(questions: Record<string, JevQuestion>, state: JevState): Promise<Record<string, JevAnswer>> {
      const result = await models.classify(model, {
        state: state as ClassifierContext["state"],
        questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, piQuestion(q)])),
      }, { ...(token ? { apiKey: token } : {}), ...(fetch ? { fetch: fetch as typeof globalThis.fetch } : {}), timeoutMs, maxRetries: retries })
      if (result.stopReason !== "stop") {
        const error = piError(result.errorMessage ?? "no answer")
        throw new JevError(error.status, redact(error.message === "Jev timed out" ? `Jev timed out after ${timeoutMs / 1000}s` : error.message))
      }
      const out: Record<string, JevAnswer> = {}
      for (const id of Object.keys(questions)) {
        const answer = fromPi(result.answers[id])
        if (!answer) throw new JevError(200, `Jev: no usable answer for ${id}`)
        out[id] = answer
      }
      return out
    },
  }
}

export type JevClient = ReturnType<typeof createJevClient>

export function jevClient(options: { timeoutMs?: number } = {}): JevClient {
  const route = jevRoute()
  if (!route) throw new Error(`Jev is not set up (${JEV_SETUP})`)
  return createJevClient({ ...route, ...options })
}
