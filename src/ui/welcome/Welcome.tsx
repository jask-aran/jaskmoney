import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { wrapText } from "../../state/textLayout"
import { STEP_NAMES, WELCOME_STEPS, emailChecklist, stepMark, tokenShown, welcomeGo, welcomeRows, type ItemState, type WelcomeRow, type WelcomeState } from "../../state/welcome"
import { AI_USES_TEXT, EMAIL_USES, UP_USES, type IntegrationUse } from "../../state/integrationUses"
import { welcomeAct, welcomeContext } from "../../app/welcome"
import { onPointer } from "../../app/pointer"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"

/**
 * The first-run setup, full screen over the app (state/welcome is the
 * machine, app/welcome the effects). A title, the steps as a rail, then the
 * step's card: what to do on the left, and on the right exactly what
 * jaskmoney does with what you're connecting (state/integrationUses).
 *
 * Animated, all of it presentation: a clock runs while something moves
 * (a screen's entrance, a spinner, the title's shimmer, the token caret)
 * and stops when nothing does. Each screen's lines fade and slide in, one
 * after another, from the side the step came from.
 */
const FRAME_MS = 33
const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

/** The title, two rows of block letters. */
const LETTERS: Record<string, [string, string]> = {
  J: ["  █", "█▄█"], A: ["▄▀█", "█▀█"], S: ["█▀", "▄█"], K: ["█▄▀", "█ █"], M: ["█▀▄▀█", "█ ▀ █"],
  O: ["█▀█", "█▄█"], N: ["█▄ █", "█ ▀█"], E: ["█▀▀", "██▄"], Y: ["█▄█", " █ "],
}
const TITLE: [string, string] = [0, 1].map((r) => [..."JASKMONEY"].map((c) => LETTERS[c]![r]).join(" ")) as [string, string]

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
/** `a` → `b` by `t` (0–1). */
function mix(a: string, b: string, t: number): string {
  if (t >= 1) return b
  if (t <= 0) return a
  const [x, y] = [hex(a), hex(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`
}
const clamp = (t: number) => Math.max(0, Math.min(1, t))
const ease = (t: number) => 1 - (1 - t) ** 3

type Line = { spans: StyledSpan[]; row?: number }
const blank: Line = { spans: [] }
const say = (text: string, fg: string = ink.label, bold = false): Line => ({ spans: [{ text, fg, bold }] })
const wrapped = (text: string, width: number, fg: string = ink.label, indent = ""): Line[] =>
  wrapText(text, Math.max(10, width - indent.length)).map((t) => ({ spans: [{ text: indent }, { text: t, fg }] }))

/** An integration's panel: what it's for, what it does (writes marked), the
 * promises. Short labels ("Sees") sit in a column beside what they say;
 * long ones (an endpoint) take their own line, what it does beneath. */
function usesLines(use: IntegrationUse, width: number): Line[] {
  const out: Line[] = [say(use.title, ink.heading, true), ...wrapped(use.why, width, ink.note), blank]
  // The promises first: on a short screen the list below them is what's cut.
  for (const p of use.promises) wrapText(p, width - 2).forEach((t, i) => out.push({ spans: [{ text: i === 0 ? "✓ " : "  ", fg: tone.good }, { text: t, fg: ink.label }] }))
  out.push(blank)
  const short = use.uses.every((u) => u.what.length <= 10)
  for (const u of use.uses) {
    const fg = u.writes ? tone.caution : ink.figure
    if (short) {
      wrapText(u.effect, Math.max(10, width - 10)).forEach((t, i) => out.push({ spans: [{ text: (i === 0 ? u.what : "").padEnd(10), fg, bold: true }, { text: t, fg: ink.label }] }))
    } else {
      out.push({ spans: [{ text: u.what, fg, bold: true }] })
      wrapText(u.effect, Math.max(10, width - 2)).forEach((t) => out.push({ spans: [{ text: "  " }, { text: t, fg: ink.note }] }))
    }
  }
  return out
}

export function Welcome() {
  return <Show when={ui.state.welcome}><WelcomeScreen /></Show>
}

function WelcomeScreen() {
  const dims = useTerminalDimensions()
  const state = () => ui.state.welcome as WelcomeState
  const ctx = createMemo(() => { void data.state.apiKeys; void data.state.signedIn; void data.state.upToken; void state().email.phase; return welcomeContext(data) })
  const rows = createMemo(() => welcomeRows(state(), ctx()))

  // ---- The clock: frames while something moves.
  const [tick, setTick] = createSignal(0)
  let shownAt = 0
  createEffect(() => { void state().shown; shownAt = untrack(tick) })
  const since = () => tick() - shownAt
  const moving = createMemo(() => since() < 45 || !!state().busy || state().step === "hello" || rows().some((r) => r.action === "token"))
  createEffect(() => {
    if (!moving()) return
    const timer = setInterval(() => setTick((t) => t + 1), FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })
  const spinner = () => SPINNER[tick() % SPINNER.length]!

  // ---- Layout.
  const height = () => Math.max(10, dims().height - 2)
  // Side by side when there's room and a panel to show; the hello and
  // done screens have none and take a narrower card.
  const paneled = () => state().step !== "hello" && state().step !== "done"
  const wide = () => dims().width >= 112
  const cardWidth = () => Math.max(40, Math.min(dims().width - 4, wide() && paneled() ? 120 : 76))
  const inner = () => cardWidth() - 4
  const leftWidth = () => (wide() && paneled() ? Math.floor(inner() * 0.52) : inner())
  const rightWidth = () => (wide() ? inner() - leftWidth() - 3 : inner())

  // ---- A row of the step: a button.
  const rowLine = (row: WelcomeRow, i: number): Line => {
    const at = state().cursor === i && !state().busy
    const label = row.action === "token" ? `Token  ${tokenField()}` : row.label
    return {
      row: i,
      spans: [
        { text: at ? " ›" : "  ", fg: tone.key, bold: true, bg: at ? theme.surface0 : undefined },
        { text: row.done ? " ✓ " : "   ", fg: tone.good, bold: true, bg: at ? theme.surface0 : undefined },
        { text: label, fg: at || row.primary ? (row.primary ? tone.key : ink.strong) : ink.figure, bold: at || row.primary, bg: at ? theme.surface0 : undefined },
        { text: row.detail ? `  ${row.detail} ` : " ", fg: row.done ? tone.good : ink.note, bg: at ? theme.surface0 : undefined },
      ],
    }
  }
  const tokenField = () => {
    const shown = tokenShown(state().token.value)
    const caret = Math.floor(tick() / 15) % 2 === 0 ? "▌" : " "
    return shown ? `${shown}${caret}` : `${caret}paste it here`
  }
  const note = (): Line[] => {
    const busy = state().busy
    if (busy) return [blank, { spans: [{ text: ` ${spinner()} `, fg: tone.ai, bold: true }, { text: busy, fg: ink.label }] }]
    const n = state().note
    if (!n) return []
    const fg = n.ok === true ? tone.good : n.ok === false ? tone.bad : ink.note
    return [blank, ...wrapText(n.text, leftWidth() - 3).map((t, i) => ({ spans: [{ text: i === 0 ? (n.ok === true ? " ✓ " : n.ok === false ? " ✗ " : " · ") : "   ", fg, bold: true }, { text: t, fg }] }))]
  }
  const buttons = (): Line[] => [blank, ...rows().map(rowLine)]
  const numbered = (items: [string, string][]): Line[] => items.flatMap(([n, text]) =>
    wrapText(text, leftWidth() - 4).map((t, i) => ({ spans: [{ text: i === 0 ? ` ${n}  ` : "    ", fg: tone.key, bold: true }, { text: t, fg: ink.figure }] })))

  // ---- Each step's left column (and its rows), and the right panel.
  const left = createMemo((): Line[] => {
    const s = state(), w = leftWidth()
    switch (s.step) {
      case "hello": return [
        say("Welcome to jaskmoney", ink.strong, true),
        blank,
        ...wrapped("Your Up Bank money, in order: every transaction categorised, budgets that keep pace with your pay, and search that understands plain English. Three things to connect, each optional, each yours to undo:", w),
        blank,
        ...([["1", "Up Bank", "your accounts and transactions"], ["2", "AI models", "suggestions, smart search and rules"], ["3", "Email", "what you bought on Amazon and eBay"]] as const).map(([n, a, b]) => ({ spans: [{ text: ` ${n}  `, fg: tone.key, bold: true }, { text: a.padEnd(12), fg: ink.figure, bold: true }, { text: b, fg: ink.note }] })),
        ...buttons(), ...note(),
      ]
      case "up": {
        const accounts = s.upAccounts
        const connected = ctx().up && !s.token.value
        return [
          say("Connect Up Bank", ink.strong, true),
          blank,
          ...(connected ? [
            ...(accounts ? [say("Up answered. These accounts sync:", tone.good), ...accounts.map((a, i) => ({ spans: [{ text: "  ● ", fg: tone.good }, { text: a, fg: ink.figure, bold: i === 0 }] }))] : [say("Up is connected.", tone.good)]),
            blank,
            ...wrapped(data.state.upSyncing ? "Your transactions are syncing in the background. Carry on." : `${data.state.transactions.length} transactions here so far.`, w, ink.note),
          ] : [
            ...wrapped("jaskmoney reads your accounts with a Personal Access Token, a key Up makes for you. In the Up app:", w),
            blank,
            ...numbered([["1", "Open the Up app on your phone and swipe right"], ["2", "Tap Data sharing, then Personal Access Token"], ["3", "Tap Generate a token, choose how long it lasts, and copy it"], ["4", "Paste it below and press enter"]]),
            blank,
            ...wrapped("Made one before? Up shows a token only once and only one works at a time: generate a new one in the app (the old one stops). On a computer instead? api.up.com.au makes one too (ctrl+o).", w, ink.note),
          ]),
          ...buttons(), ...note(),
        ]
      }
      case "ai": return [
        say("Connect the AI", ink.strong, true),
        say("optional", ink.note),
        blank,
        ...wrapped("jaskmoney works without it. With it, new transactions get suggested categories, searches understand plain English, and your repeated choices become rules. One OpenRouter sign-in covers all three.", w),
        ...buttons(), ...note(),
      ]
      case "email": {
        const items = emailChecklist(s, ctx())
        const icon = (st: ItemState) => (st === "done" ? { text: " ✓ ", fg: tone.good } : st === "failed" ? { text: " ✗ ", fg: tone.bad } : st === "active" ? { text: ` ${spinner()} `, fg: tone.ai } : { text: " ○ ", fg: ink.faint })
        return [
          say("Connect your email", ink.strong, true),
          say("optional", ink.note),
          blank,
          ...wrapped("Amazon and eBay rows only say \"Amazon\". With Gmail connected, jaskmoney reads the order emails behind them and shows what you bought. It goes through Executor, which keeps your Google sign-in: you sign in and approve in your browser, jaskmoney does the rest.", w),
          blank,
          ...items.flatMap((it) => [
            { spans: [{ ...icon(it.state), bold: true }, { text: it.label, fg: it.state === "todo" ? ink.label : ink.figure, bold: it.state === "active" }] },
            ...wrapText(it.detail, w - 4).map((t) => ({ spans: [{ text: "    " }, { text: t, fg: it.state === "done" ? tone.good : ink.note }] })),
          ]),
          ...(s.busy && s.email.url ? [blank, ...wrapped(`Browser didn't open? ${s.email.url}`, w, ink.faint)] : []),
          ...buttons(), ...note(),
        ]
      }
      case "done": {
        const c = ctx()
        const line = (ok: boolean, name: string, how: string): Line => ({ spans: [{ text: ok ? " ✓ " : " – ", fg: ok ? tone.good : ink.faint, bold: true }, { text: name.padEnd(10), fg: ink.figure, bold: true }, { text: how, fg: ok ? ink.label : ink.note }] })
        return [
          say("You're set", ink.strong, true),
          blank,
          line(c.up, "Up Bank", c.up ? (data.state.upSyncing ? "connected · syncing your transactions…" : `connected · ${data.state.transactions.length} transactions`) : "not connected: Settings › Up Bank"),
          line(c.jev || c.openai, "AI", c.openrouter ? "OpenRouter: suggestions, search and rules" : c.openai ? "ChatGPT writes rules" : c.jev ? "Jev: suggestions and search" : "off: Settings › AI models"),
          line(s.email.phase === "done" || c.executor, "Email", s.email.phase === "done" ? `Gmail, through Executor${s.email.account ? ` (${s.email.account})` : ""}` : c.executor ? "Executor signed in" : "off: Settings › AI models › Sources"),
          blank,
          ...wrapped("Change any of this in Settings. Settings › Up Bank runs this setup again.", w, ink.note),
          ...buttons(),
        ]
      }
    }
  })
  // The panel draws inside its rule and padding (3 cells) when beside.
  const panelWidth = () => rightWidth() - (wide() ? 3 : 0)
  const right = createMemo((): Line[] => {
    const s = state(), w = panelWidth()
    if (s.step === "up") return usesLines(UP_USES, w)
    if (s.step === "email") return usesLines(EMAIL_USES, w)
    if (s.step === "ai") {
      const at = rows()[s.cursor]?.action
      return usesLines(AI_USES_TEXT[at === "openai" ? "openai" : at === "jevKey" ? "jev" : at === "clairic" ? "clairic" : "openrouter"], w)
    }
    return []
  })

  // ---- Entrance: line i fades and slides in after the one before it.
  const appear = (i: number) => ease(clamp((since() - i * 1.4) / 6))
  const faded = (line: Line, i: number, bg: string): StyledSpan[] => {
    const t = appear(i)
    const shift = Math.round((1 - t) * 4)
    const spans = t >= 1 ? line.spans : line.spans.map((sp) => ({ ...sp, fg: sp.fg ? mix(bg, sp.fg, t) : undefined, bg: sp.bg ? mix(bg, sp.bg, t) : undefined }))
    return shift && state().dir > 0 ? [{ text: " ".repeat(shift) }, ...spans] : spans
  }

  const click = (row: number | undefined) => row === undefined ? undefined : onPointer("welcome", () => {
    const action = rows()[row]?.action
    if (!action) return
    ui.setState("welcome", { cursor: row })
    welcomeAct(ui, data, action)
  })

  // ---- The title, with a band of light that sweeps across it.
  const titleSpans = (r: 0 | 1): StyledSpan[] => {
    const text = TITLE[r], n = text.length
    const sweep = ((tick() % 110) / 70) * (n + 16) - 8
    return [...text].map((ch, x) => {
      const base = mix(tone.key, tone.focus, x / n)
      const glow = state().step === "hello" ? Math.max(0, 1 - Math.abs(x - sweep) / 5) : 0
      return { text: ch, fg: mix(base, ink.strong, glow * 0.8), bold: true }
    })
  }

  // ---- The rail: where you are among the steps.
  const railSpans = (): StyledSpan[] => {
    const at = WELCOME_STEPS.indexOf(state().step)
    const out: StyledSpan[] = []
    WELCOME_STEPS.forEach((step, i) => {
      if (i > 0) {
        const lit = i <= at ? Math.min(5, Math.floor(i === at ? since() / 2 : 5)) : 0
        out.push({ text: " " + "━".repeat(lit), fg: tone.key }, { text: "─".repeat(5 - lit) + " ", fg: ink.rule })
      }
      const mark = stepMark(step, state(), ctx())
      out.push(
        { text: mark === "done" ? "✓ " : mark === "skipped" ? "– " : mark === "current" ? "● " : "○ ", fg: mark === "done" ? tone.good : mark === "current" ? tone.key : ink.faint, bold: true },
        { text: STEP_NAMES[step], fg: mark === "current" ? ink.strong : mark === "done" ? ink.label : ink.faint, bold: mark === "current" },
      )
    })
    return out
  }
  const railWidth = () => railSpans().reduce((n, s) => n + Bun.stringWidth(s.text), 0)

  const column = (lines: () => Line[], width: () => number, offset: () => number) => (
    <box width={width()} flexDirection="column" flexShrink={0}>
      <For each={lines()}>{(line, i) => (
        <box height={1} width={width()} onMouseDown={click(line.row)}>
          <StyledLine spans={faded(line, i() + offset(), theme.mantle)} bg={theme.mantle} />
        </box>
      )}</For>
    </box>
  )

  return (
    <box position="absolute" zIndex={15} left={0} top={0} width="100%" height={height()} backgroundColor={theme.canvas} flexDirection="column" alignItems="center" justifyContent="center">
      <box height={2} flexDirection="column" alignItems="center">
        <StyledLine spans={titleSpans(0)} bg={theme.canvas} />
        <StyledLine spans={titleSpans(1)} bg={theme.canvas} />
      </box>
      <text fg={ink.note} bg={theme.canvas}>your money, sorted</text>
      <box height={1} />
      <box height={1} width={railWidth()} onMouseDown={onPointer("welcome", (event) => {
        // A step on the rail: go there.
        let x = event.x - (Math.floor((dims().width - railWidth()) / 2))
        for (const [i, step] of WELCOME_STEPS.entries()) {
          const w = (i > 0 ? 7 : 0) + 2 + STEP_NAMES[step].length
          if (x < w) { if (step !== state().step && !state().busy) ui.setState("welcome", welcomeGo(state(), step)); return }
          x -= w
        }
      })}>
        <StyledLine spans={railSpans()} bg={theme.canvas} />
      </box>
      <box height={1} />
      <box width={cardWidth()} border borderStyle="rounded" borderColor={tone.focus} backgroundColor={theme.mantle} paddingLeft={1} paddingRight={1} flexDirection={wide() ? "row" : "column"} gap={wide() ? 3 : 1} maxHeight={height() - 8} overflow="hidden">
        {column(left, leftWidth, () => 0)}
        <Show when={right().length}>
          <box width={rightWidth()} flexShrink={0} flexDirection="column" border={[wide() ? "left" : "top"]} borderColor={ink.rule} paddingLeft={wide() ? 2 : 0}>
            {column(right, panelWidth, () => 3)}
          </box>
        </Show>
      </box>
    </box>
  )
}
