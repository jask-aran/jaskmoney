import type { KeyEvent } from "@opentui/core"
import { EXECUTOR_SITE, ORDER_EMAILS, executorSignedIn, gmailAccounts, runExecutor, signInExecutor } from "../ai/executor"
import { ExecutorPaused, ensureMailApp, gmailConnectLink, mailAccount, waitForMailAccount } from "../ai/executorSetup"
import { createUpClient } from "../up/client"
import { editText, isPrintable } from "../domain/textField"
import { aiConnection, aiContext } from "../state/aiDialog"
import type { DataStore } from "../state/dataStore"
import type { UiStore } from "../state/uiStore"
import { DEMO_COUNT, nextStep, previousStep, welcomeGo, welcomeRows, welcomeStart, type EmailPhase, type WelcomeAction, type WelcomeContext, type WelcomeState } from "../state/welcome"
import { openBrowser, startLlmSignIn } from "./llmSignIn"
import { runSync } from "./sync"

/**
 * The first-run setup's effects (state/welcome is the machine, ui/welcome
 * the screens): checking an Up token with Up before it's saved, the
 * models' sign-ins (their own dialogs open over the setup), and connecting
 * Gmail through Executor end to end, so the user only signs in and
 * approves in the browser. `sources` is replaced in tests.
 */
export const sources = {
  open: openBrowser as (url: string) => void,
  /** Up's accounts for a token, by name: Up answering is the check. */
  upAccounts: async (token: string) => (await createUpClient({ token }).listAccounts()).map((a) => a.attributes.displayName),
  executorSignedIn: () => executorSignedIn(),
  signInExecutor: (open: (url: string) => void, signal: AbortSignal) => signInExecutor(open, signal),
  ensureMailApp: () => ensureMailApp(),
  mailAccount: (app: Parameters<typeof mailAccount>[0]) => mailAccount(app),
  connectLink: (app: Parameters<typeof gmailConnectLink>[0]) => gmailConnectLink(app),
  waitForAccount: (app: Parameters<typeof waitForMailAccount>[0], signal: AbortSignal) => waitForMailAccount(app, { signal }),
  /** The order emails Gmail finds (read-only), through the first linked account. */
  countOrders: async (): Promise<number> => {
    const account = (await gmailAccounts())[0]
    if (!account) throw new Error("Executor reaches no Gmail account yet")
    const found = await runExecutor(`const list = await ${account.tools}.gmailUsersMessagesList({ accountId: ${JSON.stringify(account.accountId)}, input: { path: { userId: "me" }, query: { q: ${JSON.stringify(ORDER_EMAILS)}, maxResults: 50 } } });
return { count: (list.messages ?? []).length };`) as { count?: number }
    return found?.count ?? 0
  },
}

export const UP_TOKEN_PAGE = "https://api.up.com.au/getting_started"

/** What's connected now (the AI pane's view of it, and Executor's sign-in). */
export function welcomeContext(data: DataStore): WelcomeContext {
  const ctx = aiContext(data)
  return {
    up: data.state.upToken,
    openrouter: !!aiConnection("openrouter", ctx),
    openai: !!aiConnection("openai", ctx),
    jev: !!aiConnection("jev", ctx),
    jevKey: !!ctx.keys.JASKMONEY_JEV_TOKEN.source,
    clairic: !!aiConnection("workersAi", ctx),
    executor: sources.executorSignedIn(),
  }
}

/** At start: the setup opens itself the first time, until it's been through once. */
export function shouldWelcome(data: DataStore): boolean {
  return !data.state.welcomed && !data.state.upToken && !data.state.demo
}

export function openWelcome(ui: UiStore): void {
  ui.setState({ welcome: welcomeStart() })
}

/** Leave the setup, finished or skipped: it won't open by itself again. */
export function closeWelcome(ui: UiStore, data: DataStore): void {
  emailFlow?.abort()
  // A tab switch closes every dialog, the setup's own and any it opened.
  ui.switchTab("overview")
  void data.setWelcomed(true)
}

function go(ui: UiStore, step: WelcomeState["step"] | null, data: DataStore): void {
  const state = ui.state.welcome
  if (!state) return
  if (!step) { closeWelcome(ui, data); return }
  ui.setState("welcome", welcomeGo(state, step))
}

/** Keys while the setup is open (it owns them; a dialog it opened takes them first). */
export function handleWelcome(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const state = ui.state.welcome
  if (!state || !data) return
  const { name } = key
  const rows = welcomeRows(state, welcomeContext(data))
  // The Up screen is for typing the token: printable keys are the token's.
  const typing = rows.some((r) => r.action === "token") && !state.busy
  if (name === "escape") {
    if (state.busy && emailFlow) { emailFlow.abort(); return }
    if (state.busy) return
    if (state.step === "hello") { closeWelcome(ui, data); return }
    go(ui, previousStep(state.step), data)
    return
  }
  if (state.busy) return
  // The tour: ← and → between its demos.
  if (state.step === "hello" && (name === "left" || name === "right" || name === "h" || name === "l")) {
    const demo = Math.max(0, Math.min(DEMO_COUNT - 1, state.demo + (name === "left" || name === "h" ? -1 : 1)))
    ui.setState("welcome", { demo, cursor: 0 })
    return
  }
  if (name === "up" || (!typing && name === "k") || (key.shift && name === "tab")) { ui.setState("welcome", { cursor: Math.max(0, state.cursor - 1) }); return }
  if (name === "down" || (!typing && name === "j") || name === "tab") { ui.setState("welcome", { cursor: Math.min(rows.length - 1, state.cursor + 1) }); return }
  if (name === "return" || name === "enter") {
    // Typing a token, enter checks it wherever the cursor is.
    const row = typing && state.token.value.trim() ? rows.find((r) => r.action === "token")! : rows[Math.min(state.cursor, rows.length - 1)]
    if (row) welcomeAct(ui, data, row.action)
    return
  }
  if (typing) {
    if (key.ctrl && name === "o") { welcomeAct(ui, data, "openUp"); return }
    if (key.ctrl && name === "n") { welcomeAct(ui, data, "next"); return }
    if (isPrintable(key) || name === "backspace" || name === "delete" || name === "left" || name === "right" || name === "home" || name === "end" || (key.ctrl && (name === "u" || name === "w" || name === "a" || name === "e"))) {
      // Edits apply at the end: the token is never shown, so there's no caret to place.
      const next = editText({ value: state.token.value, caret: state.token.value.length }, key)
      if (next) ui.setState("welcome", { token: next, cursor: 0, note: null })
    }
    return
  }
  if (name === "s" && state.step !== "done") { go(ui, nextStep(state.step), data); return }
}

/** Do a row's action (enter on it, or a click). */
export function welcomeAct(ui: UiStore, data: DataStore, action: WelcomeAction): void {
  const state = ui.state.welcome
  if (!state || state.busy) return
  switch (action) {
    case "start": go(ui, "up", data); return
    case "demoNext": ui.setState("welcome", { demo: Math.min(DEMO_COUNT - 1, state.demo + 1), cursor: 0 }); return
    case "skipAll": case "finish": closeWelcome(ui, data); return
    case "next": go(ui, nextStep(state.step), data); return
    case "openUp":
      sources.open(UP_TOKEN_PAGE)
      ui.setState("welcome", { note: { text: "api.up.com.au should open in your browser", ok: null } })
      return
    case "replaceToken": ui.setState("welcome", { token: { value: "", caret: 0 }, upAccounts: null, cursor: 0, note: null }); return
    case "token": void checkUpToken(ui, data); return
    case "openrouter": case "openai": void signInModel(ui, data, action); return
    case "jevKey": ui.setState({ aiDialog: { row: "jev", cursor: 0, field: { action: "key", value: "", caret: 0 }, note: null, busy: false } }); return
    case "clairic": ui.setState({ aiDialog: { row: "workersAi", cursor: 0, field: null, note: null, busy: false } }); return
    case "openExecutor":
      sources.open(EXECUTOR_SITE)
      ui.setState("welcome", { note: { text: "executor.sh should open in your browser", ok: null } })
      return
    case "email": void connectEmail(ui, data); return
  }
}

/** Ask Up with the token as typed; only a token Up answers is saved. Then
 * the first sync starts, while the rest of the setup goes on. */
async function checkUpToken(ui: UiStore, data: DataStore): Promise<void> {
  const token = ui.state.welcome?.token.value.trim() ?? ""
  if (!token) { ui.setState("welcome", { note: { text: "Paste your token first (ctrl+v or your terminal's paste)", ok: false } }); return }
  const opened = ui.opening("welcome")
  opened.patch({ busy: "Asking Up…", note: null })
  try {
    const accounts = await sources.upAccounts(token)
    await data.saveApiKeys({ JASKMONEY_UP_TOKEN: token })
    opened.patch({ busy: null, upAccounts: accounts, token: { value: "", caret: 0 }, cursor: 0, note: { text: `Connected: ${accounts.length} account${accounts.length === 1 ? "" : "s"}. Your transactions are syncing now.`, ok: true } })
    void runSync(ui, data, { manual: false })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const hint = !token.startsWith("up:") ? " An Up token starts with up:yeah:" : ""
    opened.patch({ busy: null, note: { text: `Up didn't accept it: ${message.replaceAll(token, "[token]")}.${hint}`, ok: false } })
  }
}

async function signInModel(ui: UiStore, data: DataStore, provider: "openrouter" | "openai"): Promise<void> {
  const result = await startLlmSignIn(ui, data, provider)
  const opened = ui.state.welcome ? ui.opening("welcome") : null
  if (result && opened?.open) opened.patch({ note: { text: result.text, ok: result.ok && !/cancelled/.test(result.text) ? true : result.ok ? null : false } })
}

let emailFlow: AbortController | null = null

const BUSY: Partial<Record<EmailPhase, string>> = {
  signIn: "Waiting for you to sign in to Executor in your browser…",
  install: "Adding Gmail to your Executor…",
  approve: "Waiting for you to approve Gmail in your browser…",
  check: "Asking Gmail for your order emails…",
}

/**
 * Connect Gmail through Executor, each step only if it's needed: sign in
 * (or make an account) in the browser; add Executor's Gmail app; open
 * Google's approval and wait for the account to link; count the order
 * emails. esc stops waiting. A step Executor pauses for approval says so.
 */
async function connectEmail(ui: UiStore, data: DataStore): Promise<void> {
  if (emailFlow) return
  const flow = new AbortController()
  emailFlow = flow
  const opened = ui.opening("welcome")
  const email = () => ui.state.welcome?.email ?? welcomeStart().email
  let phase: EmailPhase = "signIn"
  const step = (next: EmailPhase, patch: Partial<WelcomeState["email"]> = {}) => {
    phase = next
    opened.patch({ busy: BUSY[next] ?? null, note: null, email: { ...email(), phase: next, failedAt: null, ...patch } })
  }
  try {
    if (!sources.executorSignedIn()) {
      step("signIn")
      await sources.signInExecutor((url) => { if (!flow.signal.aborted && opened.open) { opened.patch({ email: { ...email(), url } }); sources.open(url) } }, flow.signal)
    }
    step("install")
    const { app } = await sources.ensureMailApp()
    let account = await sources.mailAccount(app)
    if (!account?.ready) {
      const { url } = await sources.connectLink(app)
      step("approve", { url })
      sources.open(url)
      account = await sources.waitForAccount(app, flow.signal)
    }
    step("check", { account: account.email ?? account.label })
    const orders = await sources.countOrders()
    if (!opened.open) return
    opened.patch({ busy: null, cursor: 1, email: { ...email(), phase: "done", orders }, note: { text: `Gmail connected${account.email ? ` (${account.email})` : ""}`, ok: true } })
  } catch (error) {
    if (!opened.open) return
    const cancelled = flow.signal.aborted
    const text = cancelled ? "Stopped waiting. Try again when you're ready."
      : error instanceof ExecutorPaused ? `Executor is waiting for your approval: ${error.message}. Approve it at executor.sh, then try again.`
      : `${error instanceof Error ? error.message : String(error)}`
    opened.patch({ busy: null, cursor: 0, email: { ...email(), phase: cancelled ? "idle" : "failed", failedAt: cancelled ? null : phase }, note: { text, ok: cancelled ? null : false } })
  } finally {
    if (emailFlow === flow) emailFlow = null
  }
}
