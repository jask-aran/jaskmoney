import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { wrapText } from "../../state/textLayout"
import { emailChecklist, tokenShown, type ItemState, type WelcomeContext, type WelcomeRow, type WelcomeState } from "../../state/welcome"
import { AI_USES_TEXT, EMAIL_USES, UP_TOKEN_STEPS, UP_USES } from "../../state/integrationUses"
import { blank, noteLines, numbered, say, usesLines, wrapped, type CardLine } from "../primitives/cardLines"
import type { StyledSpan } from "../primitives/StyledLine"
import { DEMOS } from "./Demos"

type Line = CardLine

export interface CardInputs {
  state: () => WelcomeState
  ctx: () => WelcomeContext
  rows: () => WelcomeRow[]
  spinner: () => string
  caretOn: () => boolean
}

function tokenField(c: CardInputs): { text: string; hint: string } {
  const { state, caretOn } = c
  const shown = tokenShown(state().token.value)
  const caret = caretOn() ? "▌" : " "
  return shown ? { text: `${shown}${caret}`, hint: "" } : { text: caret, hint: "paste it here" }
}
function rowLine(c: CardInputs, row: WelcomeRow, i: number): Line {
  const { state } = c
  const at = state().cursor === i && !state().busy
  const bg = at ? theme.surface0 : undefined
  const field = row.action === "token" ? tokenField(c) : null
  const label = field ? `Token  ${field.text}` : row.label
  return {
    row: i,
    spans: [
      { text: at ? " ›" : "  ", fg: tone.key, bold: true, bg },
      { text: row.done ? " ✓ " : "   ", fg: tone.good, bold: true, bg },
      ...(row.account ? [{ text: `${label.match(/^ */)![0]}● `, fg: row.syncs ? tone.good : ink.faint, bg }] : []),
      { text: row.account ? label.trimStart() : label, fg: row.primary ? tone.key : row.account && !row.syncs ? ink.faint : at ? ink.strong : ink.figure, bold: at || row.primary, bg },
      ...(field?.hint ? [{ text: field.hint, fg: ink.faint, bg }] : []),
      { text: row.detail ? `  ${row.detail} ` : " ", fg: row.done || row.syncs ? tone.good : ink.note, bg },
    ],
  }
}
function note(c: CardInputs, width: number): Line[] {
  const { state, spinner } = c
  const busy = state().busy
  if (busy) return [blank, { spans: [{ text: ` ${spinner()} `, fg: tone.ai, bold: true }, { text: busy, fg: ink.label }] }]
  const n = state().note
  return n ? [blank, ...noteLines(n, width)] : []
}
const buttons = (c: CardInputs): Line[] => [blank, ...c.rows().flatMap((row, i) => row.gapBefore ? [blank, rowLine(c, row, i)] : [rowLine(c, row, i)])]

export function leftLines(c: CardInputs, s: WelcomeState, w: number): Line[] {
  switch (s.step) {
    case "hello": return [
      ...wrapped("Setup connects Up Bank, an AI model and your email. Every step is optional; Settings › Up Bank › Setup runs it again.", w),
      blank,
      ...wrapped("Start shows a short tour first: the app's own screens, playing on made-up data.", w, ink.note),
      ...buttons(c),
    ]
    case "tour": return tourCard(c)
    case "up": return upLines(c, s, w)
    case "ai": return [
      say("AI", ink.strong, true),
      blank,
      ...wrapped("Optional, by provider: each enables what it lists. OpenRouter alone covers suggestions, smart search and rules; Cloudflare adds Clairic for the dates in a search.", w),
      ...buttons(c), ...note(c, w),
    ]
    case "email": return emailLines(c, s, w)
    case "done": return doneLines(c, s, w)
  }
}
function upLines(c: CardInputs, s: WelcomeState, w: number): Line[] {
  const { ctx } = c
  const accounts = s.upAccounts
  const connected = ctx().up && !s.token.value
  return [
    say("Up Bank", ink.strong, true),
    blank,
    ...(connected ? [
      ...(accounts
        ? [say("Up answered. Choose the accounts to sync:", tone.good), ...wrapped("A saver is part of its spending account and comes with it. Settings › Up Bank changes this any time.", w, ink.note)]
        : [say("Connected.", tone.good), blank, ...wrapped(data.state.upSyncing ? "Syncing your transactions." : `${data.state.transactions.length} transactions so far.`, w, ink.note)]),
    ] : [
      ...wrapped("Up's API reads with a Personal Access Token. To make one, in the Up app:", w),
      blank,
      ...numbered(UP_TOKEN_STEPS, w),
      blank,
      ...wrapped("Up shows a token once, and only the newest works: making a new one stops the old. api.up.com.au makes one too (ctrl+o).", w, ink.note),
    ]),
    ...buttons(c), ...note(c, w),
  ]
}
function emailLines(c: CardInputs, s: WelcomeState, w: number): Line[] {
  const { ctx, spinner } = c
  const items = emailChecklist(s, ctx())
  const icon = (st: ItemState) => (st === "done" ? { text: " ✓ ", fg: tone.good } : st === "failed" ? { text: " ✗ ", fg: tone.bad } : st === "active" ? { text: ` ${spinner()} `, fg: tone.ai } : { text: " ○ ", fg: ink.faint })
  return [
    say("Email", ink.strong, true),
    blank,
    ...wrapped("Optional. Amazon and eBay rows say only \"Amazon\"; the order emails say what you bought. Executor reads Gmail for jaskmoney and keeps your Google sign-in. You sign in and approve in the browser; the rest happens here.", w),
    blank,
    ...items.flatMap((it) => [
      { spans: [{ ...icon(it.state), bold: true }, { text: it.label, fg: it.state === "todo" ? ink.label : ink.figure, bold: it.state === "active" }] },
      ...wrapText(it.detail, w - 4).map((t) => ({ spans: [{ text: "    " }, { text: t, fg: it.state === "done" ? tone.good : ink.note }] })),
    ]),
    ...(s.busy && s.email.url ? [blank, ...wrapped(`Browser didn't open? ${s.email.url}`, w, ink.faint)] : []),
    ...buttons(c), ...note(c, w),
  ]
}
function doneLines(card: CardInputs, s: WelcomeState, w: number): Line[] {
  const c = card.ctx()
  const line = (ok: boolean, name: string, how: string): Line => ({ spans: [{ text: ok ? " ✓ " : " – ", fg: ok ? tone.good : ink.faint, bold: true }, { text: name.padEnd(10), fg: ink.figure, bold: true }, { text: how, fg: ok ? ink.label : ink.note }] })
  return [
    say("Ready", ink.strong, true),
    blank,
    line(c.up, "Up Bank", c.up ? (data.state.upSyncing ? "syncing your transactions" : `${data.state.transactions.length} transactions`) : "not connected: Settings › Up Bank"),
    line(c.jev || c.openai, "AI", c.openrouter ? "OpenRouter: suggestions, search, rules" : c.openai ? "ChatGPT: rules" : c.jev ? "Jev: suggestions, search" : "off: Settings › AI models"),
    line(s.email.phase === "done" || c.executor, "Email", s.email.phase === "done" ? `Gmail through Executor${s.email.account ? ` (${s.email.account})` : ""}` : c.executor ? "Executor signed in" : "off: Settings › AI models › Sources"),
    blank,
    ...wrapped("Settings › Up Bank › Setup runs this again.", w, ink.note),
    ...buttons(card),
  ]
}
export function rightLines(c: CardInputs, s: WelcomeState, w: number): Line[] {
  if (s.step === "up") return usesLines(UP_USES, w)
  if (s.step === "email") return usesLines(EMAIL_USES, w)
  if (s.step === "ai") {
    const { rows } = c
    const at = rows()[s.cursor]?.action
    const lines = usesLines(AI_USES_TEXT[at === "openai" ? "openai" : at === "jevKey" ? "jev" : at === "clairic" ? "clairic" : "openrouter"], w)
    const tallest = Math.max(...Object.values(AI_USES_TEXT).map((u) => usesLines(u, w).length))
    return [...lines, ...Array.from({ length: tallest - lines.length }, () => blank)]
  }
  return []
}

function tourCard(c: CardInputs): Line[] {
  const { state } = c
  const demo = DEMOS[state().demo]!
  return [
  say(`Tour · ${demo.name}`, ink.strong, true),
  blank,
  ...demo.caption.map(([k, text]): Line => ({ spans: [{ text: k.padEnd(4), fg: tone.key, bold: true }, { text: text, fg: ink.label }] })),
  ...(demo.caption.length < 2 ? [blank] : []),
  blank,
  { spans: DEMOS.flatMap((d, i): StyledSpan[] => [
    ...(i ? [{ text: "   " }] : []),
    { text: i === state().demo ? "● " : "○ ", fg: i === state().demo ? tone.key : ink.faint, bold: true },
    { text: d.name, fg: i === state().demo ? ink.strong : ink.faint, bold: i === state().demo },
  ]) },
  ...buttons(c),
  ]
}
