import { spawn } from "node:child_process"
import type { Models } from "@earendil-works/pi-ai"
import { LLM_PROVIDERS, type LlmProvider } from "../ai/llm"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/**
 * Browser sign-in to the general model's provider (pi-ai's OAuth: OpenRouter
 * mints a key; OpenAI is Sign in with ChatGPT). The core runs pi-ai's login,
 * serves the callback on 127.0.0.1, and races it with a prompt to paste the
 * redirect URL (a browser on another machine, or one that can't reach the
 * callback). The client opens the browser, shows the URL and paste field in
 * the modal, and sends the paste to the core. esc cancels the core's login.
 * The core keeps the credential in its own oauth.json.
 */
let controller: AbortController | null = null
let sendPaste: ((value: string) => void) | null = null

/** Open `url` in the user's browser (on WSL, Windows'); failures are silent: the modal shows the URL. */
export function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.env.WSL_DISTRO_NAME ? "wslview" : "xdg-open"
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" })
    child.on("error", () => {})
    child.unref()
  } catch { /* the URL is on screen */ }
}

/** `open` and `models` are replaced in tests. */
export async function startLlmSignIn(ui: UiStore, data: DataStore, provider: LlmProvider, open: (url: string) => void = openBrowser, models?: Pick<Models, "login">): Promise<void> {
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
  try {
    let lastUrl: string | null = null
    await data.signInLlm(provider, (progress) => {
      const paste = ui.state.llmSignIn?.paste
      ui.setState("llmSignIn", {
        url: progress.url,
        message: progress.message,
        paste: progress.paste === null ? null : paste?.message === progress.paste ? paste : { message: progress.paste, value: "", caret: 0 },
      })
      if (progress.url && progress.url !== lastUrl) { lastUrl = progress.url; open(progress.url) }
    }, flow.signal, models)
    ui.setStatus(`Signed in to ${label}`)
  } catch (error) {
    const cancelled = flow.signal.aborted && pasteError === undefined
    const cause = pasteError ?? error
    ui.setStatus(cancelled ? `${label} sign-in cancelled` : `${label} sign-in failed: ${cause instanceof Error ? cause.message : String(cause)}`, !cancelled)
  } finally {
    if (controller === flow) { controller = null; sendPaste = null }
    ui.setState({ llmSignIn: null })
  }
}

/** enter in the paste field: hand pi-ai the code or redirect URL. */
export function submitSignInPaste(ui: UiStore): void {
  const value = ui.state.llmSignIn?.paste?.value.trim()
  if (!value || !sendPaste) return
  // The core reports "Checking…" only when it accepts the paste.
  sendPaste(value)
}

export function cancelLlmSignIn(): void {
  controller?.abort()
}

/** Forget a provider's browser sign-in. */
export async function signOutLlm(data: DataStore, provider: LlmProvider): Promise<void> {
  await data.signOutLlm(provider)
}
