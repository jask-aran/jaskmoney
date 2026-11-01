/**
 * TypeSafe's Jev, a System One model: typed judgments about a state your code
 * supplies. A Noul is the probability a statement is true; a Choice is a
 * distribution over options. Requests go only to api.typesafe.ai.
 *
 * Jev reads one item per question best (the item inline in the question, not
 * looked up by id in a shared list), and answers every question in a request
 * in parallel, so a request of hundreds of questions takes about as long as
 * one: `judgeEach` packs items into as few requests as fit. (Clef, measured
 * on the same tasks, preferred the opposite: rows listed in the state.)
 */

import type { ClassifierAnswer, ClassifierContext, ClassifierQuestion, Models } from "@earendil-works/pi-ai"
import { piModels, piProviders } from "./piAi"
import { credentialEnv } from "./credentials"
import type { Fetch } from "./http"
import { createFileCredentialStore, signedIn } from "./oauthStore"
import { JEV_SETUP, type JevAnswer, type JevQuestion, type JevState } from "./judge"

export { JEV_SETUP, REQUEST_BUDGET, judgeEach, type JevAnswer, type JevQuestion, type JevState } from "./judge"

/** Pinned: the questions and thresholds here were tuned against this
 * version (it was `jev-latest` on 2026-10-27). */
export const JEV_MODEL = "jev-1.14.0"

export class JevError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "JevError"
  }
}

export function readJevToken(env: Record<string, string | undefined> = credentialEnv()): string {
  const token = env.JASKMONEY_JEV_TOKEN?.trim()
  if (!token) throw new Error("Set JASKMONEY_JEV_TOKEN (a TypeSafe API key) for Jev")
  return token
}

/** How Jev is reached now: a TypeSafe key first (the pinned version, at
 * TypeSafe's price), else OpenRouter's key or browser sign-in (the general
 * model's); null when neither is set up. */
export function jevRoute(env: Record<string, string | undefined> = credentialEnv(), openrouterSignedIn = signedIn("openrouter")): { provider: JevProvider; token?: string } | null {
  const typesafe = env.JASKMONEY_JEV_TOKEN?.trim()
  if (typesafe) return { provider: "typesafe", token: typesafe }
  const openrouter = env.JASKMONEY_OPENROUTER_TOKEN?.trim()
  if (openrouter) return { provider: "openrouter", token: openrouter }
  return openrouterSignedIn ? { provider: "openrouter" } : null
}

/** Whether Jev is set up, without throwing. */
export function hasJev(env: Record<string, string | undefined> = credentialEnv()): boolean {
  return jevRoute(env) != null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Retries after a rate limit or a server error, waiting as asked. */
const RETRIES = 3

/** Where Jev is reached, through pi-ai: TypeSafe itself (a TypeSafe key), or
 * OpenRouter (its key or browser sign-in, the general model's provider). */
export type JevProvider = "typesafe" | "openrouter"

/** The pinned version on each provider. TypeSafe's catalog in pi-ai lists
 * only jev-latest, so its entry is reused with the version's id. */
const JEV_MODELS: Record<JevProvider, { catalog: string; id: string }> = {
  typesafe: { catalog: "jev-latest", id: JEV_MODEL },
  openrouter: { catalog: "typesafe/jev-1.14", id: "typesafe/jev-1.14" },
}

/** pi-ai with Jev's two providers; OpenRouter's sign-in from oauth.json. */
function jevModels(): Models {
  const models = piModels().createModels({ credentials: createFileCredentialStore() })
  models.setProvider(piProviders.typesafe())
  models.setProvider(piProviders.openrouter())
  return models
}

/** Our question types on pi-ai's: a noul is its bool. The instructions
 * (text, or the question with its data) and the state pass through as
 * they are: pi-ai sends them unchanged. */
function piQuestion(question: JevQuestion): ClassifierQuestion {
  return (question.type === "noul" ? { ...question, type: "bool" } : question) as ClassifierQuestion
}

function fromPi(answer: ClassifierAnswer | undefined): JevAnswer | null {
  if (answer?.type === "bool") return { type: "noul", noul: answer.probability }
  if (answer?.type === "choice") return { type: "choice", choice: answer.choice, probabilities: answer.probabilities, confidence: answer.confidence }
  return null
}

/** pi-ai's "System One API error (422): {body}" as our "Jev: <detail>". */
function piError(message: string): { status: number; message: string } {
  const missing = /did not return an? (?:\w+ )?answer for (\S+)/.exec(message)
  if (missing) return { status: 200, message: `Jev: no usable answer for ${missing[1]}` }
  const match = /\((\d{3})\): ([\s\S]*)$/.exec(message)
  if (!match) return { status: 0, message: /timed? ?out|timeout/i.test(message) ? "Jev timed out" : `Jev request failed: ${message}` }
  let payload: unknown = null
  try { payload = JSON.parse(match[2]!) } catch { /* not JSON */ }
  const detail = object(payload) ? payload.detail ?? payload.error ?? payload.message : null
  const text = typeof detail === "string" ? detail
    : object(detail) && typeof detail.message === "string" ? detail.message
    : Array.isArray(detail) && object(detail[0]) && typeof detail[0].msg === "string" ? detail[0].msg
    : `HTTP ${match[1]}`
  return { status: Number(match[1]), message: `Jev: ${text}` }
}

/** Where Jev is reached on `provider`, as pi-ai sends it, and how much one request holds. */
export function jevEndpoint(provider: JevProvider): { url: string; model: string; contextWindow: number } {
  const entry = jevModels().getModelOfType("classifier", provider, JEV_MODELS[provider].catalog)
  return { url: `${(entry?.baseUrl ?? "").replace(/\/$/, "")}/systemone`, model: JEV_MODELS[provider].id, contextWindow: entry?.contextWindow ?? 0 }
}

/** `token`: the provider's key; without one, OpenRouter uses its sign-in. */
export function createJevClient({ token, provider = "typesafe", fetch, timeoutMs = 30_000 }: { token?: string; provider?: JevProvider; fetch?: Fetch; timeoutMs?: number }) {
  const redact = (message: string) => (token ? message.split(token).join("[redacted]") : message)
  const models = jevModels()
  const entry = models.getModelOfType("classifier", provider, JEV_MODELS[provider].catalog)
  if (!entry) throw new JevError(0, `pi-ai has no Jev model on ${provider}`)
  const model = { ...entry, id: JEV_MODELS[provider].id }

  return {
    provider,
    /** Jev's answer to each question about `state`; a missing or malformed answer is an error. */
    async judge(questions: Record<string, JevQuestion>, state: JevState): Promise<Record<string, JevAnswer>> {
      const result = await models.classify(model, {
        state: state as ClassifierContext["state"],
        questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, piQuestion(q)])),
      }, { ...(token ? { apiKey: token } : {}), ...(fetch ? { fetch: fetch as typeof globalThis.fetch } : {}), timeoutMs, maxRetries: RETRIES })
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

/** A Jev client by the route set up now (jevRoute). */
export function jevClient(options: { timeoutMs?: number } = {}): JevClient {
  const route = jevRoute()
  if (!route) throw new Error(`Jev is not set up (${JEV_SETUP})`)
  return createJevClient({ ...route, ...options })
}
