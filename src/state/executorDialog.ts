import { EXECUTOR_MCP, type ExecutorStatus } from "../ai/executor"

/**
 * Settings › AI models › Sources › Executor: what its dialog shows, from the
 * status as last read (ai/executor). Executor Cloud holds your accounts
 * (Gmail first); the app signs in to Executor and reaches them through it.
 */
type ExecutorAction = "signIn" | "test" | "site" | "recheck" | "signOut"

interface StatusLine { label: string; value: string }

/** Gmail is among what Executor reaches (its tools name it, or a program can). */
const gmailListed = (status: ExecutorStatus) => status.tools.some((t) => /gmail/i.test(t))

export function executorLines(status: ExecutorStatus | null): StatusLine[] {
  const lines: StatusLine[] = [{ label: "Service", value: `Executor Cloud · ${EXECUTOR_MCP.replace("https://", "")} · holds your accounts' sign-ins` }]
  if (!status) return [...lines, { label: "Account", value: "checking…" }]
  if (!status.signedIn) return [...lines, { label: "Account", value: "not signed in: sign in, or make an Executor account, in your browser" }, { label: "For", value: "finding the order emails behind Amazon and eBay rows (next to build)" }]
  return [
    ...lines,
    { label: "Account", value: status.error ? `signed in, but: ${status.error}` : "signed in" },
    { label: "Reaches", value: status.error ? "–" : `${status.tools.length} tool${status.tools.length === 1 ? "" : "s"} (${status.tools.slice(0, 4).join(", ")}${status.tools.length > 4 ? ", …" : ""}); your accounts are connected at executor.sh${gmailListed(status) ? "" : " (connect Gmail there)"}` },
    { label: "For", value: "finding the order emails behind Amazon and eBay rows (next to build)" },
  ]
}

export function executorActions(status: ExecutorStatus | null): Array<{ id: ExecutorAction; label: string }> {
  if (!status) return []
  if (!status.signedIn) return [{ id: "signIn", label: "Sign in to Executor (opens your browser; new here? make an account there)" }, { id: "site", label: "Open executor.sh" }]
  return [
    ...(status.error ? [{ id: "recheck" as const, label: "Check again" }, { id: "signIn" as const, label: "Sign in again" }] : [{ id: "test" as const, label: "Test: count order emails in Gmail (last 90 days)" }]),
    { id: "site", label: "Open executor.sh (connect Gmail, set what's allowed)" },
    { id: "signOut", label: "Sign out here" },
  ]
}

/** The Sources row in the AI pane. */
export function executorRow(status: ExecutorStatus | null, signedIn: boolean): { connected: boolean; how: string } {
  if (!status) return signedIn ? { connected: true, how: "signed in · Gmail and your other accounts" } : { connected: false, how: "not signed in · enter to connect" }
  if (!status.signedIn) return { connected: false, how: "not signed in · enter to connect" }
  if (status.error) return { connected: false, how: "signed in · not reachable" }
  return { connected: true, how: `signed in · ${status.tools.length} tools` }
}
