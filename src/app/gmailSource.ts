import { addGmail, countGmail, executorRunner, signedInUrl, gmailSetup, googleClientForm, nextGmailStep, ORDER_EMAILS, startGmailSignIn, type Run } from "../ai/executor"
import { gmailActions } from "../state/gmailDialog"
import type { UiStore } from "../state/uiStore"
import { openBrowser } from "./llmSignIn"

/**
 * Settings › AI models › Sources › Gmail: setting Gmail up through Executor
 * one step at a time (state/gmailDialog says which). The browser sign-in is
 * Executor's: this opens its address and waits for the account to appear.
 * `run` and `open` are replaced in tests.
 */
const SIGN_IN_WAIT_MS = 5 * 60_000
const SIGN_IN_POLL_MS = 2_000
let waitRun = 0

export const sources = { run: executorRunner() as Run, open: openBrowser as (url: string) => void, pollMs: SIGN_IN_POLL_MS }

export async function openGmailDialog(ui: UiStore): Promise<void> {
  ui.setState({ gmail: { setup: null, cursor: 0, busy: "Checking Executor…", waiting: null, note: null } })
  await recheck(ui)
}

/** Read the setup again (the dialog and the Sources row). */
export async function recheck(ui: UiStore): Promise<void> {
  const setup = await gmailSetup(sources.run)
  ui.setState({ gmailSetup: setup })
  if (ui.state.gmail) ui.setState("gmail", { setup, busy: null })
}

/** enter on an action. */
export async function runGmailAction(ui: UiStore): Promise<void> {
  const dialog = ui.state.gmail
  if (!dialog || dialog.busy || dialog.waiting) return
  const actions = gmailActions(dialog.setup)
  const action = actions[Math.min(dialog.cursor, actions.length - 1)]
  if (!action) return
  const note = (text: string, ok: boolean | null) => { if (ui.state.gmail) ui.setState("gmail", { note: { text, ok }, busy: null }) }
  const busy = (text: string) => ui.setState("gmail", { busy: text, note: null })
  switch (action.id) {
    case "recheck":
      busy("Checking Executor…")
      await recheck(ui)
      return
    case "open":
      sources.open(signedInUrl())
      note("Executor's web UI should open in your browser", null)
      return
    case "add": {
      busy("Adding Gmail to Executor…")
      const result = await addGmail(sources.run)
      await recheck(ui)
      note(result.kind === "done" ? "Gmail added, read-only. Next: your Google app" : result.kind === "error" ? `Couldn't add Gmail: ${result.message}` : `Executor is waiting on: ${result.title}`, result.kind === "done")
      return
    }
    case "client": {
      busy("Asking Executor for its form…")
      const result = await googleClientForm(sources.run)
      if (result.kind !== "done") { note(result.kind === "error" ? result.message : `Executor is waiting on: ${result.title}`, false); return }
      const url = (result.data as { url?: string }).url
      if (!url) { note("Executor gave no address for its form", false); return }
      sources.open(signedInUrl(url))
      note("Executor's form should open in your browser: paste the client ID and secret there, save, then Check again", null)
      return
    }
    case "signIn": {
      const client = dialog.setup?.client
      if (!client) return
      busy("Starting the Google sign-in…")
      const started = await startGmailSignIn(sources.run, client)
      if ("error" in started) { note(`Couldn't start the sign-in: ${started.error}`, false); return }
      if (!started.url) { await recheck(ui); note("Signed in", true); return }
      sources.open(started.url)
      await waitForSignIn(ui, started.url)
      return
    }
    case "test": {
      busy("Searching your mail for order emails…")
      const found = await countGmail(sources.run, ORDER_EMAILS)
      note("error" in found ? `Test failed: ${found.error}` : `${found.count}${found.more ? "+" : ""} order email${found.count === 1 ? "" : "s"} from Amazon and eBay in the last 90 days`, !("error" in found))
    }
  }
}

/** Wait for the account Executor mints when the browser sign-in finishes; esc stops waiting. */
async function waitForSignIn(ui: UiStore, url: string): Promise<void> {
  const run = ++waitRun
  ui.setState("gmail", { busy: null, waiting: url, note: null })
  const until = Date.now() + SIGN_IN_WAIT_MS
  while (run === waitRun && ui.state.gmail && Date.now() < until) {
    await new Promise((r) => setTimeout(r, sources.pollMs))
    if (run !== waitRun || !ui.state.gmail) return
    const setup = await gmailSetup(sources.run)
    if (run !== waitRun || !ui.state.gmail) return
    ui.setState({ gmailSetup: setup })
    ui.setState("gmail", { setup })
    if (nextGmailStep(setup) === "ready") {
      ui.setState("gmail", { waiting: null, cursor: 0, note: { text: `Signed in as ${setup.account?.identity ?? setup.account?.name}`, ok: true } })
      ui.setStatus("Gmail signed in through Executor")
      return
    }
  }
  if (run === waitRun && ui.state.gmail) ui.setState("gmail", { waiting: null, note: { text: "Stopped waiting for the sign-in; finish it in the browser, then Check again", ok: null } })
}

/** esc while waiting: stop waiting (the browser sign-in can still finish). */
export function stopWaiting(ui: UiStore): void {
  waitRun++
  if (ui.state.gmail) ui.setState("gmail", { waiting: null, note: { text: "Stopped waiting; if you finish in the browser, Check again", ok: null } })
}
