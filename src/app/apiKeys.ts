import { JEV_MODEL, jevClient } from "../ai/jev"
import { createWorkersAiClient, readWorkersAiCredentials } from "../ai/workersAi"
import { createLlm, LLM_PROVIDERS, type LlmProvider } from "../ai/llm"
import { appToday } from "../domain/days"
import { createUpClient, readUpToken } from "../up/client"

/** The AI models pane's rows, in order: the general model's are its providers. */
export const AI_ROWS = ["jev", "workersAi", "openrouter", "openai"] as const
export type AiRow = (typeof AI_ROWS)[number]

/** What the key dialog opens for: the AI models pane's rows, and the Up
 * token (Settings › Up Bank's first row). */
export type KeyRow = AiRow | "up"

export const isLlmRow = (row: KeyRow): row is LlmProvider => row === "openrouter" || row === "openai"

export function aiRowLabel(row: KeyRow): string {
  return row === "up" ? "Up Bank" : row === "jev" ? "Jev" : row === "workersAi" ? "Workers AI" : LLM_PROVIDERS[row].label
}

/** Try a model with the smallest possible request (a few tokens): what to say, and whether it worked. */
export async function testAi(row: KeyRow): Promise<{ ok: boolean; text: string }> {
  let llmKey = ""
  try {
    if (row === "up") {
      llmKey = readUpToken()
      await createUpClient({ token: llmKey }).ping()
      return { ok: true, text: "Works (Up answered)" }
    }
    if (row === "jev") {
      const jev = jevClient({ timeoutMs: 15_000 })
      await jev.judge({ ok: { type: "noul", instructions: "Is `state` a greeting?" } }, "hello")
      return { ok: true, text: `Works (${JEV_MODEL}${jev.provider === "openrouter" ? " via OpenRouter" : ""})` }
    }
    if (row === "workersAi") {
      await createWorkersAiClient({ ...readWorkersAiCredentials(), timeoutMs: 15_000 }).clairic({ word: { type: "text" } }, "hello", appToday())
      return { ok: true, text: "Works (Clairic)" }
    }
    const llm = createLlm({ provider: row })
    llmKey = llm.apiKey ?? ""
    const reply = await llm.models.complete(llm.model, { messages: [{ role: "user", content: "Say ok.", timestamp: Date.now() }] }, { ...(llm.apiKey ? { apiKey: llm.apiKey } : {}), signal: AbortSignal.timeout(30_000) })
    if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage)
    return { ok: true, text: `Works (${llm.model.id}${llm.apiKey ? "" : ", signed in"})` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A provider's message can echo the request; never the key.
    return { ok: false, text: llmKey ? message.replaceAll(llmKey, "[redacted]") : message }
  }
}
