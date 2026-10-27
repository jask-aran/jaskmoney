import { spawn } from "node:child_process"
import type { Models } from "@earendil-works/pi-ai"
import { LLM_PROVIDERS, llmModels, type LlmProvider } from "../ai/llm"
import { createFileCredentialStore } from "../ai/oauthStore"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"

/**
 * Browser sign-in to the general model's provider (pi-ai's OAuth: OpenRouter
 * mints a key; OpenAI is Sign in with ChatGPT). pi-ai serves the callback on
 * 127.0.0.1 and races it with a prompt to paste the redirect URL (a browser
 * on another machine, or one that can't reach the callback); the modal shows
 * the URL and takes the paste. esc cancels. The credential goes to oauth.json.
 */
let controller: AbortController | null = null
let pending: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null

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
export async function startLlmSignIn(ui: UiStore, data: DataStore, provider: LlmProvider, open: (url: string) => void = openBrowser, models: Pick<Models, "login"> = llmModels()): Promise<void> {
  if (ui.state.llmSignIn) return
  const { label, signIn } = LLM_PROVIDERS[provider]
  const flow = new AbortController()
  controller = flow
  ui.setState({ llmSignIn: { provider, url: null, message: `${signIn}…`, paste: null } })
  try {
    await models.login(provider, "oauth", {
      signal: flow.signal,
      notify: (event) => {
        if (event.type === "auth_url") {
          ui.setState("llmSignIn", { url: event.url, message: "Your browser should open; finish signing in there." })
          open(event.url)
        } else if (event.type === "device_code") {
          ui.setState("llmSignIn", { url: event.verificationUri, message: `Enter the code ${event.userCode} at the address below.` })
          open(event.verificationUri)
        } else ui.setState("llmSignIn", "message", event.message)
      },
      prompt: (prompt) => new Promise<string>((resolve, reject) => {
        if (prompt.type === "select") { reject(new Error(`${label} asked a question this app can't show: ${prompt.message}`)); return }
        const entry = { resolve, reject }
        pending = entry
        ui.setState("llmSignIn", "paste", { message: prompt.message, value: "", caret: 0 })
        // The callback won the race: the paste field goes.
        prompt.signal?.addEventListener("abort", () => {
          if (pending === entry) { pending = null; ui.setState("llmSignIn", "paste", null) }
          reject(new Error("callback received"))
        }, { once: true })
      }),
    })
    data.refreshApiKeys()
    ui.setStatus(`Signed in to ${label}`)
  } catch (error) {
    ui.setStatus(flow.signal.aborted ? `${label} sign-in cancelled` : `${label} sign-in failed: ${error instanceof Error ? error.message : String(error)}`, !flow.signal.aborted)
  } finally {
    if (controller === flow) { controller = null; pending = null }
    ui.setState({ llmSignIn: null })
  }
}

/** enter in the paste field: hand pi-ai the code or redirect URL. */
export function submitSignInPaste(ui: UiStore): void {
  const value = ui.state.llmSignIn?.paste?.value.trim()
  if (!value || !pending) return
  const entry = pending
  pending = null
  ui.setState("llmSignIn", { paste: null, message: "Checking…" })
  entry.resolve(value)
}

export function cancelLlmSignIn(): void {
  pending?.reject(new Error("cancelled"))
  pending = null
  controller?.abort()
}

/** Forget a provider's browser sign-in. */
export async function signOutLlm(data: DataStore, provider: LlmProvider): Promise<void> {
  await createFileCredentialStore().delete(provider)
  data.refreshApiKeys()
}
