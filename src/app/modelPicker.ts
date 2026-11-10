import { LLM_PROVIDERS, llmModelId, llmModels, type LlmProvider } from "../ai/llm"
import { credentialEnv } from "../ai/credentials"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { modelPickerItems, type ModelEntry } from "../state/modelPicker"
import { pickerChoices } from "../state/settingsForm"
import { settleData } from "./actions"

function modelEntries(provider: LlmProvider): ModelEntry[] {
  return llmModels().getModels(provider).map((m) => ({ id: m.id, name: m.name, input: m.cost.input, output: m.cost.output, context: m.contextWindow }))
}

export function modelItems(provider: LlmProvider, query: string) {
  return modelPickerItems(modelEntries(provider), { current: llmModelId(credentialEnv(), provider), recommended: LLM_PROVIDERS[provider].defaultModel, query, maker: LLM_PROVIDERS[provider].label })
}

export function openModelPicker(ui: UiStore, provider: LlmProvider): void {
  const choices = pickerChoices(modelItems(provider, ""))
  ui.setState({ modelPicker: { provider, query: "", cursor: Math.max(0, choices.findIndex((c) => c.value === llmModelId(credentialEnv(), provider))) } })
}

export function chooseModel(ui: UiStore, data: DataStore, provider: LlmProvider, id: string): void {
  const { modelName, defaultModel } = LLM_PROVIDERS[provider]
  ui.setState({ modelPicker: null })
  settleData(ui, data.saveApiKeys({ [modelName]: id === defaultModel ? null : id, ...(provider === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) }), () => {
    const text = `${LLM_PROVIDERS[provider].label} model: ${id}`
    ui.setStatus(text)
    if (ui.state.aiDialog?.row === provider) ui.setState("aiDialog", { note: { text: `Model: ${id}`, ok: true } })
    if (ui.state.aiUse) ui.setState("aiUse", { note: { text, ok: true } })
  })
}
