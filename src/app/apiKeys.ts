import { createJevClient, JEV_MODEL, readJevToken } from "../ai/jev"
import { createWorkersAiClient, readWorkersAiCredentials } from "../ai/workersAi"
import { createLlm, LLM_PROVIDERS, type LlmProvider } from "../ai/llm"
import { appToday } from "../domain/days"
import type { UiStore } from "../state/uiStore"

/** The AI models pane's rows, in order: the general model's are its providers. */
export const AI_ROWS = ["jev", "workersAi", "openrouter", "openai"] as const
export type AiRow = (typeof AI_ROWS)[number]

export const isLlmRow = (row: AiRow): row is LlmProvider => row === "openrouter" || row === "openai"

export function aiRowLabel(row: AiRow): string {
  return row === "jev" ? "Jev" : row === "workersAi" ? "Workers AI" : LLM_PROVIDERS[row].label
}

/** Try a key with the smallest possible request (a few tokens) and report. */
export async function testApiKey(ui: UiStore, row: AiRow): Promise<void> {
  ui.setStatus(`Testing ${aiRowLabel(row)}…`)
  let llmKey = ""
  try {
    if (row === "jev") {
      await createJevClient({ token: readJevToken(), timeoutMs: 15_000 }).judge({ ok: { type: "noul", instructions: "Is `state` a greeting?" } }, "hello")
      ui.setStatus(`Jev key works (${JEV_MODEL})`)
    } else if (row === "workersAi") {
      await createWorkersAiClient({ ...readWorkersAiCredentials(), timeoutMs: 15_000 }).clairic({ word: { type: "text" } }, "hello", appToday())
      ui.setStatus("Workers AI key works (Clairic)")
    } else {
      const llm = createLlm({ provider: row })
      llmKey = llm.apiKey ?? ""
      const reply = await llm.models.complete(llm.model, { messages: [{ role: "user", content: "Say ok.", timestamp: Date.now() }] }, { ...(llm.apiKey ? { apiKey: llm.apiKey } : {}), signal: AbortSignal.timeout(30_000) })
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage)
      ui.setStatus(`${LLM_PROVIDERS[row].label} works (${llm.model.id}${llm.apiKey ? "" : ", signed in"})`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ui.setStatus(llmKey ? message.replaceAll(llmKey, "[redacted]") : message, true)
  }
}
