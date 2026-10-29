import { EXECUTOR_URL, GOOGLE_REDIRECT, nextGmailStep, type GmailSetup } from "../ai/executor"

/**
 * Settings › AI models › Sources › Gmail: what its dialog shows, from the
 * setup as Executor reports it (ai/executor). Each step's action appears
 * once the steps before it are done; reading the mail is for matching
 * Amazon and eBay rows to their order emails.
 */
export type GmailAction = "add" | "client" | "signIn" | "test" | "recheck" | "open"

export interface StatusLine { label: string; value: string }

export function gmailLines(setup: GmailSetup | null): StatusLine[] {
  if (!setup) return [{ label: "Executor", value: "checking…" }]
  if (setup.error) return [{ label: "Executor", value: setup.error }]
  const account = setup.account
  return [
    { label: "Executor", value: `v${setup.version ?? "?"} · ${EXECUTOR_URL.replace("http://", "")} · holds the sign-in; analytics off` },
    { label: "Gmail", value: setup.gmail ? "added, read-only (gmail.readonly)" : "not added yet" },
    { label: "Google app", value: setup.client ? `registered (${setup.client.slug})` : "none yet: Executor signs in to Google with your own OAuth client" },
    { label: "Account", value: account ? `${account.identity ?? account.name} · ${account.health}` : "not signed in" },
    { label: "For", value: "finding the order emails behind Amazon and eBay rows (next to build)" },
  ]
}

/** How to make the Google OAuth client (shown while that's the next step). */
export const GOOGLE_CLIENT_STEPS = [
  "In Google Cloud Console (console.cloud.google.com), in a project of your own:",
  "1. APIs & Services › Library: enable the Gmail API.",
  "2. Google Auth Platform › Audience: External, and add your Gmail address as a test user.",
  `3. Clients › Create client › Web application, with the authorised redirect URI ${GOOGLE_REDIRECT}`,
  "4. Register Google app (below) opens Executor's form: paste the client ID and secret there, not here.",
]

export function gmailActions(setup: GmailSetup | null): Array<{ id: GmailAction; label: string }> {
  if (!setup) return []
  const step = nextGmailStep(setup)
  const out: Array<{ id: GmailAction; label: string }> = []
  if (step === "install") return [{ id: "recheck", label: "Check again" }]
  if (step === "add") out.push({ id: "add", label: "Add Gmail to Executor (read-only)" })
  if (step === "client") out.push({ id: "client", label: "Register Google app in Executor… (opens your browser)" }, { id: "recheck", label: "Check again" })
  if (step === "signIn") out.push({ id: "signIn", label: "Sign in with Google (opens your browser)" })
  if (step === "ready") out.push({ id: "test", label: "Test: count order emails (last 90 days)" }, { id: "signIn", label: "Sign in again" })
  out.push({ id: "open", label: "Open Executor (its policies, connections, log)" })
  return out
}

/** The Sources row in the AI pane: Gmail's state in a few words. */
export function gmailRow(setup: GmailSetup | null): { connected: boolean; how: string } {
  if (!setup) return { connected: false, how: "via Executor · enter to set up" }
  if (setup.error) return { connected: false, how: "Executor not reachable" }
  const step = nextGmailStep(setup)
  if (step === "ready") return { connected: true, how: `signed in · ${setup.account?.identity ?? "Gmail"}` }
  return { connected: false, how: { install: "Executor missing", add: "not added", client: "needs your Google app", signIn: "not signed in", ready: "" }[step] }
}
