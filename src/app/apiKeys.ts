import { createJevClient, JEV_MODEL, readJevToken } from "../ai/jev"
import { createWorkersAiClient, readWorkersAiCredentials } from "../ai/workersAi"
import { appToday } from "../domain/days"
import type { UiStore } from "../state/uiStore"

/** The AI models pane's rows, in order. */
export const AI_ROWS = ["jev", "workersAi"] as const
export type AiRow = (typeof AI_ROWS)[number]

/** Try a key with the smallest possible request (a few tokens) and report. */
export async function testApiKey(ui: UiStore, row: AiRow): Promise<void> {
  ui.setStatus(row === "jev" ? "Testing the Jev key…" : "Testing the Workers AI key…")
  try {
    if (row === "jev") {
      await createJevClient({ token: readJevToken(), timeoutMs: 15_000 }).judge({ ok: { type: "noul", instructions: "Is `state` a greeting?" } }, "hello")
      ui.setStatus(`Jev key works (${JEV_MODEL})`)
    } else {
      await createWorkersAiClient({ ...readWorkersAiCredentials(), timeoutMs: 15_000 }).clairic({ word: { type: "text" } }, "hello", appToday())
      ui.setStatus("Workers AI key works (Clairic)")
    }
  } catch (error) {
    ui.setStatus(error instanceof Error ? error.message : String(error), true)
  }
}
