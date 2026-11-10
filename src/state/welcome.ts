import type { TextField } from "../domain/textField"
import { DEMO_COUNT, triable, type DemoTry } from "./tour"
import { DEFAULT_BACKDROP, type BackdropId } from "../ui/welcome/backdrop"
import type { Ticker } from "../app/tickers"

type WelcomeStep = "hello" | "tour" | "up" | "ai" | "email" | "done"
export const WELCOME_STEPS: readonly WelcomeStep[] = ["hello", "tour", "up", "ai", "email", "done"]
export const STEP_NAMES: Record<WelcomeStep, string> = { hello: "Welcome", tour: "Tour", up: "Up Bank", ai: "AI", email: "Email", done: "Ready" }

export type EmailPhase = "idle" | "signIn" | "install" | "approve" | "check" | "done" | "failed"

export interface WelcomeState {
  step: WelcomeStep
  dir: 1 | -1
  shown: number
  demo: number
  demoAt: number
  trying: DemoTry | null
  backdrop?: BackdropId
  tickers?: Ticker[]
  cursor: number
  token: TextField
  busy: string | null
  note: { text: string; ok: boolean | null } | null
  upAccounts: UpChoice[] | null
  upSyncedOff?: string
  email: { phase: EmailPhase; failedAt: EmailPhase | null; url: string | null; account: string | null; orders: number | null }
}

export function welcomeStart(): WelcomeState {
  return {
    step: "hello", dir: 1, shown: 0, demo: 0, demoAt: 0, trying: null, cursor: 0, token: { value: "", caret: 0 }, busy: null, note: null, upAccounts: null,
    email: { phase: "idle", failedAt: null, url: null, account: null, orders: null },
  }
}

export function welcomeGo(state: WelcomeState, step: WelcomeStep): Partial<WelcomeState> {
  const from = WELCOME_STEPS.indexOf(state.step), to = WELCOME_STEPS.indexOf(step)
  return { step, dir: to >= from ? 1 : -1, shown: state.shown + 1, cursor: 0, note: null, busy: null, trying: null }
}

export const nextStep = (step: WelcomeStep): WelcomeStep | null => WELCOME_STEPS[WELCOME_STEPS.indexOf(step) + 1] ?? null
export const previousStep = (step: WelcomeStep): WelcomeStep | null => WELCOME_STEPS[WELCOME_STEPS.indexOf(step) - 1] ?? null

export interface WelcomeContext {
  up: boolean
  openrouter: boolean
  openai: boolean
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
  detail?: string
  done?: boolean
  primary?: boolean
  account?: string
  syncs?: boolean
  gapBefore?: boolean
}

export interface UpChoice { id: string; name: string; type: string; ownership: string; on: boolean }

function upAccountTree(accounts: UpChoice[]): Array<{ account: UpChoice; under: UpChoice | null }> {
  const heads = accounts.filter((a) => a.type !== "SAVER")
  const headOf = (saver: UpChoice) => heads.find((h) => h.ownership === saver.ownership) ?? null
  const savers = accounts.filter((a) => a.type === "SAVER")
  return [
    ...heads.flatMap((head) => [{ account: head, under: null }, ...savers.filter((s) => headOf(s) === head).map((s) => ({ account: s, under: head }))]),
    ...savers.filter((s) => !headOf(s)).map((s) => ({ account: s, under: null })),
  ]
}

export function toggleUpAccount(accounts: UpChoice[], id: string): UpChoice[] {
  const tree = upAccountTree(accounts)
  const at = tree.find((t) => t.account.id === id)
  if (!at) return accounts
  const on = !at.account.on
  const savers = new Set(tree.filter((t) => t.under?.id === id).map((t) => t.account.id))
  return accounts.map((a) => a.id === id || savers.has(a.id) ? { ...a, on } : on && a.id === at.under?.id ? { ...a, on: true } : a)
}

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
        ...upAccountTree(state.upAccounts ?? []).map(({ account, under }): WelcomeRow => ({
          action: "account", account: account.id, syncs: account.on,
          label: `${under ? "  " : ""}${account.name}`,
          detail: account.on ? "will sync" : "won't sync",
        })),
        { action: "next", label: "Continue", primary: true, gapBefore: !!state.upAccounts?.length },
        { action: "replaceToken", label: "Use a different token" },
      ]
      return [
        { action: "token", label: "Token", primary: true },
        { action: "openUp", label: "Open api.up.com.au", detail: "the same, on the web" },
        { action: "next", label: ctx.up ? "Keep the token I have" : "Skip: connect Up later", detail: ctx.up ? "" : "Settings › Up Bank" },
      ]
    case "ai":
      return [
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

export function stepMark(step: WelcomeStep, state: WelcomeState, ctx: WelcomeContext): "done" | "skipped" | "current" | "ahead" {
  const at = WELCOME_STEPS.indexOf(state.step), i = WELCOME_STEPS.indexOf(step)
  if (i === at) return "current"
  if (i > at) return "ahead"
  const connected = step === "hello" || step === "tour" || (step === "up" ? ctx.up : step === "ai" ? ctx.jev || ctx.openai : step === "email" ? state.email.phase === "done" || ctx.executor : true)
  return connected ? "done" : "skipped"
}

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

export function welcomeBackdrop(state: Pick<WelcomeState, "backdrop">, chosen: BackdropId | undefined): BackdropId {
  return state.backdrop ?? chosen ?? DEFAULT_BACKDROP
}

export function welcomeStatus(state: Pick<WelcomeState, "backdrop" | "tickers">, chosen: BackdropId | undefined): string {
  return welcomeBackdrop(state, chosen) === "ticker" && state.tickers?.length ? "These are real live tickers" : "Welcome to jaskmoney"
}

export function tokenShown(value: string): string {
  return "•".repeat(Math.min(24, value.length))
}
