import { COUNT_ORDER_EMAILS, EXECUTOR_SITE, executorStatus, runExecutor, signInExecutor, signOutExecutor } from "../ai/executor"
import { executorActions } from "../state/executorDialog"
import type { Opening, UiState, UiStore } from "../state/uiStore"
import { openBrowser } from "./llmSignIn"

/**
 * Settings › AI models › Sources › Executor: signing in to Executor Cloud in
 * the browser (or making an account there), then testing that Gmail answers
 * through it. `sources` is replaced in tests.
 */
export const sources = {
  open: openBrowser as (url: string) => void,
  status: () => executorStatus(),
  signIn: (open: (url: string) => void, signal: AbortSignal) => signInExecutor(open, signal),
  run: (code: string) => runExecutor(code),
  signOut: () => signOutExecutor(),
}

let signingIn: AbortController | null = null

export async function openExecutorDialog(ui: UiStore): Promise<void> {
  ui.setState({ executor: { status: null, cursor: 0, busy: "Checking Executor…", waiting: null, note: null } })
  const opened = ui.opening("executor")
  await recheck(ui, opened)
}

async function recheck(ui: UiStore, opened: Opening<NonNullable<UiState["executor"]>>): Promise<void> {
  try {
    const status = await sources.status()
    ui.setState({ executorStatus: status })
    opened.patch({ status, busy: null })
  } catch (error) {
    opened.patch({ busy: null })
    throw error
  }
}

export async function runExecutorAction(ui: UiStore): Promise<void> {
  const dialog = ui.state.executor
  if (!dialog || dialog.busy || dialog.waiting) return
  const opened = ui.opening("executor")
  const actions = executorActions(dialog.status)
  const action = actions[Math.min(dialog.cursor, actions.length - 1)]
  if (!action) return
  const note = (text: string, ok: boolean | null) => { opened.patch({ note: { text, ok }, busy: null, waiting: null }) }
  switch (action.id) {
    case "recheck":
      opened.patch({ busy: "Checking Executor…", note: null })
      await recheck(ui, opened)
      return
    case "site":
      sources.open(EXECUTOR_SITE)
      note("executor.sh should open in your browser", null)
      return
    case "signOut":
      sources.signOut()
      await recheck(ui, opened)
      note("Signed out here. Executor keeps your accounts; remove jaskmoney's access at executor.sh", null)
      return
    case "signIn": {
      const flow = new AbortController()
      signingIn = flow
      opened.patch({ busy: "Starting the sign-in…", note: null })
      try {
        await sources.signIn((url) => { if (flow.signal.aborted || !opened.open) return; opened.patch({ busy: null, waiting: url }); sources.open(url) }, flow.signal)
        if (flow.signal.aborted) return
        opened.patch({ waiting: null, busy: "Checking Executor…" })
        await recheck(ui, opened)
        opened.patch({ cursor: 0 })
        note("Signed in to Executor", true)
        ui.setStatus("Signed in to Executor")
      } catch (error) {
        note(flow.signal.aborted ? "Sign-in cancelled" : `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`, flow.signal.aborted ? null : false)
      } finally {
        if (signingIn === flow) signingIn = null
      }
      return
    }
    case "test": {
      opened.patch({ busy: "Asking Gmail, through Executor…", note: null })
      try {
        const found = await sources.run(COUNT_ORDER_EMAILS) as { count?: number; more?: boolean }
        const count = found?.count ?? 0
        note(`${count}${found?.more ? "+" : ""} order email${count === 1 ? "" : "s"} from Amazon and eBay in the last 90 days`, true)
      } catch (error) {
        note(`Test failed: ${error instanceof Error ? error.message : String(error)}`, false)
      }
    }
  }
}

/** esc while the browser sign-in is open: stop waiting for it. */
export function cancelExecutorSignIn(): void { signingIn?.abort() }
