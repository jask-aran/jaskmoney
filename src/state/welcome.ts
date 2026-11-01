import type { TextField } from "../domain/textField"
import { DEMO_COUNT, triable, type DemoTry } from "./tour"
import { DEFAULT_BACKDROP, type BackdropId } from "../ui/welcome/backdrop"
import type { Ticker } from "../app/tickers"

/**
 * The first-run setup: a full-screen walk through connecting Up, the AI
 * models and your email (through Executor), any of it skippable. Pure:
 * the steps, each step's rows, and the email checklist, from the state
 * and what's connected. The effects are app/welcome; the screens
 * ui/welcome.
 *
 * Its own state machine, one modal (uiStore MODALS "welcome"):
 *
 *   hello → tour → up → ai → email → done → (closed)
 *
 * hello says what this is. The tour is the app's own pieces playing on
 * demo mode's made-up years (ui/welcome/Demos), ←/→ between them; enter
 * goes to the next, and from the last on to Up. Either can skip to Up.
 * Try it (t) freezes the demo where it is and hands you its keys (tour).
 *
 * enter on a row does it; "Continue" (or skip, s) goes on; esc goes back a
 * step (on hello it closes, as skipping does). Leaving any way marks the
 * setup as seen (core welcomed): it doesn't open by itself again.
 */
export type WelcomeStep = "hello" | "tour" | "up" | "ai" | "email" | "done"
export const WELCOME_STEPS: readonly WelcomeStep[] = ["hello", "tour", "up", "ai", "email", "done"]
export const STEP_NAMES: Record<WelcomeStep, string> = { hello: "Welcome", tour: "Tour", up: "Up Bank", ai: "AI", email: "Email", done: "Ready" }

/** Where connecting your email through Executor has got to. */
export type EmailPhase = "idle" | "signIn" | "install" | "approve" | "check" | "done" | "failed"

export interface WelcomeState {
  step: WelcomeStep
  /** Which way the last move went (the next screen slides in from there). */
  dir: 1 | -1
  /** Counts screens shown: each new one starts its entrance again. */
  shown: number
  /** The tour's demo shown, and when it started (performance.now(): its
   * script runs from there). */
  demo: number
  demoAt: number
  /** Trying the demo yourself: its state, frozen from the script. */
  trying: DemoTry | null
  /** The welcome page's backdrop, as b last chose it (else Settings'). */
  backdrop?: BackdropId
  /** Real market prices for the ticker tape, once fetched (app/tickers). */
  tickers?: Ticker[]
  cursor: number
  /** The Up token as typed: never drawn, only dots. */
  token: TextField
  /** Something running (a check, a sign-in): its words, with a spinner. */
  busy: string | null
  note: { text: string; ok: boolean | null } | null
  /** Up answered this token: its accounts, each to sync or not. */
  upAccounts: UpChoice[] | null
  /** The choice the last sync from this step had (the switched-off ids), so
   * leaving again unchanged doesn't sync again. */
  upSyncedOff?: string
  email: { phase: EmailPhase; failedAt: EmailPhase | null; url: string | null; account: string | null; orders: number | null }
}

export function welcomeStart(): WelcomeState {
  return {
    step: "hello", dir: 1, shown: 0, demo: 0, demoAt: 0, trying: null, cursor: 0, token: { value: "", caret: 0 }, busy: null, note: null, upAccounts: null,
    email: { phase: "idle", failedAt: null, url: null, account: null, orders: null },
  }
}

/** Move to `step`: a fresh screen (cursor at its top, no note). */
export function welcomeGo(state: WelcomeState, step: WelcomeStep): Partial<WelcomeState> {
  const from = WELCOME_STEPS.indexOf(state.step), to = WELCOME_STEPS.indexOf(step)
  return { step, dir: to >= from ? 1 : -1, shown: state.shown + 1, cursor: 0, note: null, busy: null, trying: null }
}

export const nextStep = (step: WelcomeStep): WelcomeStep | null => WELCOME_STEPS[WELCOME_STEPS.indexOf(step) + 1] ?? null
export const previousStep = (step: WelcomeStep): WelcomeStep | null => WELCOME_STEPS[WELCOME_STEPS.indexOf(step) - 1] ?? null

/** What's connected now, as the screens need it. */
export interface WelcomeContext {
  up: boolean
  openrouter: boolean
  openai: boolean
  /** Jev reachable (its own key, or through OpenRouter). */
  jev: boolean
  jevKey: boolean
  clairic: boolean
  executor: boolean
}

export type WelcomeAction =
  | "tour" | "demoNext" | "try" | "stopTry" | "start" | "skipAll"
  | "token" | "openUp" | "replaceToken" | "account"
  | "openrouter" | "openai" | "jevKey" | "clairic"
  | "email" | "openExecutor"
  | "next" | "finish"

export interface WelcomeRow {
  action: WelcomeAction
  label: string
  /** Beside the label: how it stands (connected, optional, …). */
  detail?: string
  /** It's done: drawn with a tick. */
  done?: boolean
  /** The one to press: drawn as the screen's main button. */
  primary?: boolean
  /** An Up account's row: its id (Up's), toggled by enter. */
  account?: string
  /** Off: drawn faint (an account not to sync). */
  off?: boolean
}

/** An Up account in the setup's choice: Up's id, name, type (TRANSACTIONAL,
 * SAVER, …) and ownership (INDIVIDUAL, JOINT), and whether it syncs. */
export interface UpChoice { id: string; name: string; type: string; ownership: string; on: boolean }

/**
 * Up's accounts as the app sees them: each spending account, with the
 * savers of the same ownership under it (yours under Spending, joint ones
 * under 2Up Spending): a saver is part of its spending account, not an
 * account of its own. A saver with no spending account to go under comes
 * last, on its own. In order, with each one's spending account (null for
 * a spending account itself).
 */
export function upAccountTree(accounts: UpChoice[]): Array<{ account: UpChoice; under: UpChoice | null }> {
  const heads = accounts.filter((a) => a.type !== "SAVER")
  const headOf = (saver: UpChoice) => heads.find((h) => h.ownership === saver.ownership) ?? null
  const savers = accounts.filter((a) => a.type === "SAVER")
  return [
    ...heads.flatMap((head) => [{ account: head, under: null }, ...savers.filter((s) => headOf(s) === head).map((s) => ({ account: s, under: head }))]),
    ...savers.filter((s) => !headOf(s)).map((s) => ({ account: s, under: null })),
  ]
}

/** Toggle one account: a spending account takes its savers with it; a
 * saver turned on brings its spending account on (it's part of it). */
export function toggleUpAccount(accounts: UpChoice[], id: string): UpChoice[] {
  const tree = upAccountTree(accounts)
  const at = tree.find((t) => t.account.id === id)
  if (!at) return accounts
  const on = !at.account.on
  const savers = new Set(tree.filter((t) => t.under?.id === id).map((t) => t.account.id))
  return accounts.map((a) => a.id === id || savers.has(a.id) ? { ...a, on } : on && a.id === at.under?.id ? { ...a, on: true } : a)
}

/** The rows of the screen, top to bottom; the cursor moves over them. */
export function welcomeRows(state: WelcomeState, ctx: WelcomeContext): WelcomeRow[] {
  switch (state.step) {
    case "hello":
      return [
        { action: "tour", label: "Start", primary: true },
        { action: "start", label: "Skip the tour", detail: "straight to Up Bank" },
        { action: "skipAll", label: "Skip setup, open the app" },
      ]
    case "tour": {
      if (state.trying) return [{ action: "stopTry", label: "Back to the demo", detail: "esc", primary: true }]
      const last = state.demo >= DEMO_COUNT - 1
      return [
        last ? { action: "start", label: "Connect Up Bank", primary: true } : { action: "demoNext", label: "Next", primary: true },
        ...(triable(state.demo) ? [{ action: "try" as const, label: "Try it yourself", detail: "t · stops it here" }] : []),
        ...(last ? [] : [{ action: "start" as const, label: "Skip the tour" }]),
        { action: "skipAll", label: "Skip setup, open the app" },
      ]
    }
    case "up":
      if (ctx.up && state.token.value === "") return [
        // Which accounts sync: each spending account, its savers under it.
        ...upAccountTree(state.upAccounts ?? []).map(({ account, under }): WelcomeRow => ({
          action: "account", account: account.id, off: !account.on,
          label: `${under ? "  " : ""}${account.on ? "●" : "○"} ${account.name}`,
          detail: account.on ? "" : "won't sync",
        })),
        { action: "next", label: "Continue", primary: true },
        { action: "replaceToken", label: "Use a different token" },
      ]
      return [
        { action: "token", label: "Token", primary: true },
        { action: "openUp", label: "Open api.up.com.au", detail: "the same, on the web" },
        { action: "next", label: ctx.up ? "Keep the token I have" : "Skip: connect Up later", detail: ctx.up ? "" : "Settings › Up Bank" },
      ]
    case "ai":
      return [
        // By provider: what each one enables.
        { action: "clairic", label: "Cloudflare", detail: ctx.clairic ? "connected · Clairic" : "Clairic: smart search's words and dates", done: ctx.clairic },
        { action: "jevKey", label: "TypeSafe", detail: ctx.jevKey ? "saved · Jev" : "Jev: suggestions, smart search, ask:", done: ctx.jevKey },
        { action: "openai", label: "ChatGPT", detail: ctx.openai ? "connected · rules" : "a general model for rules, on your plan", done: ctx.openai },
        { action: "openrouter", label: "OpenRouter", detail: ctx.openrouter ? "connected · Jev and rules" : "Jev and a general model: all but Clairic", done: ctx.openrouter, primary: !ctx.openrouter && !ctx.openai && !ctx.jevKey },
        { action: "next", label: ctx.jev || ctx.openai ? "Continue" : "Skip: no AI for now", primary: ctx.openrouter || ctx.openai },
      ]
    case "email": {
      const running = !!state.busy
      return [
        ...(state.email.phase === "done" ? [] : [{ action: "email" as const, label: state.email.phase === "failed" ? "Try again" : ctx.executor ? "Connect Gmail" : "Connect Gmail through Executor", detail: running ? "" : "opens your browser", primary: true }]),
        { action: "openExecutor", label: "Open executor.sh", detail: "your account, what's connected" },
        { action: "next", label: state.email.phase === "done" ? "Continue" : "Skip: no email for now", primary: state.email.phase === "done" },
      ]
    }
    case "done":
      return [{ action: "finish", label: "Open jaskmoney", primary: true }]
  }
}

/** Each step's mark on the rail: a step whose integration is connected is
 * done; one passed without connecting it is skipped. */
export function stepMark(step: WelcomeStep, state: WelcomeState, ctx: WelcomeContext): "done" | "skipped" | "current" | "ahead" {
  const at = WELCOME_STEPS.indexOf(state.step), i = WELCOME_STEPS.indexOf(step)
  if (i === at) return "current"
  if (i > at) return "ahead"
  const connected = step === "hello" || step === "tour" || (step === "up" ? ctx.up : step === "ai" ? ctx.jev || ctx.openai : step === "email" ? state.email.phase === "done" || ctx.executor : true)
  return connected ? "done" : "skipped"
}

/** The email checklist: each step's words and how it stands. */
export type ItemState = "todo" | "active" | "done" | "failed"

const EMAIL_ORDER: EmailPhase[] = ["signIn", "install", "approve", "check"]

export function emailChecklist(state: WelcomeState, ctx: WelcomeContext): { label: string; detail: string; state: ItemState }[] {
  const { phase, failedAt, account, orders } = state.email
  const at = phase === "failed" ? EMAIL_ORDER.indexOf(failedAt ?? "signIn") : phase === "done" ? EMAIL_ORDER.length : EMAIL_ORDER.indexOf(phase)
  const stateOf = (i: number): ItemState => {
    if (i === 0 && ctx.executor && phase === "idle") return "done"
    if (phase === "idle") return "todo"
    if (i < at) return "done"
    if (i === at) return phase === "failed" ? "failed" : phase === "done" ? "done" : "active"
    return "todo"
  }
  return [
    { label: "Sign in to Executor", detail: "in your browser; new to Executor? make an account there", state: stateOf(0) },
    { label: "Add Gmail to your Executor", detail: "done for you", state: stateOf(1) },
    { label: "Approve Gmail", detail: account ? `${account}` : "Google asks you to allow it: read-only, your order emails", state: stateOf(2) },
    { label: "Check it works", detail: orders != null ? `${orders} order email${orders === 1 ? "" : "s"} from Amazon and eBay (90 days)` : "counts your order emails", state: stateOf(3) },
  ]
}

/** The setup's backdrop: tried with b, else Settings › Appearance's, else the default. */
export function welcomeBackdrop(state: Pick<WelcomeState, "backdrop">, chosen: BackdropId | undefined): BackdropId {
  return state.backdrop ?? chosen ?? DEFAULT_BACKDROP
}

/** The status line while the setup is open, in place of the status log's
 * latest (which goes on being written, and shows again once it closes):
 * the setup's own cards say how each step went. */
export function welcomeStatus(state: Pick<WelcomeState, "backdrop" | "tickers">, chosen: BackdropId | undefined): string {
  return welcomeBackdrop(state, chosen) === "ticker" && state.tickers?.length ? "These are real live tickers" : "Welcome to jaskmoney"
}

/** "up:yeah:…" → "••••••••": that a token is there, never any of it (not
 * even its last few characters). */
export function tokenShown(value: string): string {
  return "•".repeat(Math.min(24, value.length))
}
