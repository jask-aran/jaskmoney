import { spawn } from "node:child_process"
import type { Models } from "@earendil-works/pi-ai"
import { LLM_PROVIDERS, type LlmProvider } from "../ai/llm"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

let controller: AbortController | null = null
let sendPaste: ((value: string) => void) | null = null

export function safeToOpen(url: string): boolean {
  let parsed: URL
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol === "https:") return true
  return parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
}

export function openBrowser(url: string): void {
  if (!safeToOpen(url)) return
  const command = process.platform === "darwin" ? "open" : process.env.WSL_DISTRO_NAME ? "wslview" : "xdg-open"
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" })
    child.on("error", () => {})
    child.unref()
  } catch {}
}

export async function startLlmSignIn(ui: UiStore, data: DataStore, provider: LlmProvider, open: (url: string) => void = openBrowser, models?: Pick<Models, "login">): Promise<{ text: string; ok: boolean } | undefined> {
  if (ui.state.llmSignIn) return
  const { label, signIn } = LLM_PROVIDERS[provider]
  const flow = new AbortController()
  controller = flow
  let pasteError: Error | undefined
  sendPaste = (value) => {
    void data.signInPaste(provider, value).catch((error: unknown) => {
      if (controller !== flow) return
      pasteError = error instanceof Error ? error : new Error(String(error))
      flow.abort()
    })
  }
  ui.setState({ llmSignIn: { provider, url: null, message: `${signIn}…`, paste: null } })
  const opened = ui.opening("llmSignIn")
  try {
    let lastUrl: string | null = null
    await data.signInLlm(provider, (progress) => {
      if (!opened.open || flow.signal.aborted) return
      const paste = ui.state.llmSignIn?.paste
      opened.patch({
        url: progress.url,
        message: progress.message,
        paste: progress.paste === null ? null : paste?.message === progress.paste ? paste : { message: progress.paste, value: "", caret: 0 },
      })
      if (progress.url && progress.url !== lastUrl) { lastUrl = progress.url; open(progress.url) }
    }, flow.signal, models)
    const text = `Signed in to ${label}`
    ui.setStatus(text)
    return { text, ok: true }
  } catch (error) {
    const cancelled = flow.signal.aborted && pasteError === undefined
    const cause = pasteError ?? error
    const text = cancelled ? `${label} sign-in cancelled` : `${label} sign-in failed: ${cause instanceof Error ? cause.message : String(cause)}`
    ui.setStatus(text, !cancelled)
    return { text, ok: cancelled }
  } finally {
    if (controller === flow) { controller = null; sendPaste = null }
    opened.close()
  }
}

export function submitSignInPaste(ui: UiStore): void {
  const value = ui.state.llmSignIn?.paste?.value.trim()
  if (!value || !sendPaste) return
  sendPaste(value)
}

export function cancelLlmSignIn(): void {
  controller?.abort()
}

export async function signOutLlm(data: DataStore, provider: LlmProvider): Promise<void> {
  await data.signOutLlm(provider)
}
