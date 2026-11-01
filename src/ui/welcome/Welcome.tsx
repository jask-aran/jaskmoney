import { useTerminalDimensions } from "@opentui/solid"
import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { wrapText } from "../../state/textLayout"
import { STEP_NAMES, WELCOME_STEPS, emailChecklist, stepMark, tokenShown, welcomeRows, type ItemState, type WelcomeRow, type WelcomeState } from "../../state/welcome"
import { AI_USES_TEXT, EMAIL_USES, UP_USES, type IntegrationUse } from "../../state/integrationUses"
import { followTickers, welcomeAct, welcomeContext, welcomeJump } from "../../app/welcome"
import { onPointer } from "../../app/pointer"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { SPINNER } from "../primitives/Spinner"
import { BACKDROP_LEVELS, DEFAULT_BACKDROP, backdropLines, type BackdropId, type BackdropInk } from "./backdrop"
import { DEMOS, DemoReel } from "./Demos"

/**
 * The first-run setup, full screen over the app (state/welcome is the
 * machine, app/welcome the effects). The title and the steps as a rail;
 * then either the tour (the app's own pieces playing on a made-up year,
 * ui/welcome/Demos) or a step's card: what to do on the left, and on the
 * right exactly what jaskmoney does with what you're connecting
 * (state/integrationUses).
 *
 * Text is drawn at full colour from the first frame. What moves (a
 * spinner, the token's caret, the title's light, the rail filling) runs on
 * one clock while the setup is open; nothing waits on it to be readable.
 */
const FRAME_MS = 80

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

type Line = { spans: StyledSpan[]; row?: number }
const blank: Line = { spans: [] }
const say = (text: string, fg: string = ink.label, bold = false): Line => ({ spans: [{ text, fg, bold }] })
const wrapped = (text: string, width: number, fg: string = ink.label): Line[] =>
  wrapText(text, Math.max(10, width)).map((t) => ({ spans: [{ text: t, fg }] }))

/** An integration's panel: what it's for, the promises, then what it does
 * (writes marked). Short labels ("Sees") sit in a column beside what they
 * say; long ones (an endpoint) take their own line, what it does beneath. */
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

  // ---- The clock, while the setup is open.
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((t) => t + 1), FRAME_MS)
  onCleanup(() => clearInterval(timer))
  let shownAt = 0
  createEffect(() => { void state().shown; shownAt = untrack(tick) })
  const since = () => tick() - shownAt
  const spinner = () => SPINNER[tick() % SPINNER.length]!

  // ---- Layout.
  const height = () => Math.max(12, dims().height - 2)
  const tour = () => state().step === "tour"
  // Side by side when there's room and a panel to show.
  const paneled = () => state().step === "up" || state().step === "ai" || state().step === "email"
  const wide = () => dims().width >= 112
  const cardWidth = () => Math.max(40, Math.min(dims().width - 4, wide() && paneled() ? 120 : 76))
  const inner = () => cardWidth() - 4
  const leftWidth = () => (wide() && paneled() ? Math.floor(inner() * 0.52) : inner())
  const rightWidth = () => (wide() ? inner() - leftWidth() - 3 : inner())
  const panelWidth = () => rightWidth() - (wide() ? 3 : 0)

  // ---- A row of the step: a button.
  const tokenField = () => {
    const shown = tokenShown(state().token.value)
    const caret = Math.floor(tick() / 6) % 2 === 0 ? "▌" : " "
    return shown ? `${shown}${caret}` : `${caret}paste it here`
  }
  const rowLine = (row: WelcomeRow, i: number): Line => {
    const at = state().cursor === i && !state().busy
    const bg = at ? theme.surface0 : undefined
    const label = row.action === "token" ? `Token  ${tokenField()}` : row.label
    return {
      row: i,
      spans: [
        { text: at ? " ›" : "  ", fg: tone.key, bold: true, bg },
        { text: row.done ? " ✓ " : "   ", fg: tone.good, bold: true, bg },
        { text: label, fg: row.primary ? tone.key : at ? ink.strong : ink.figure, bold: at || row.primary, bg },
        { text: row.detail ? `  ${row.detail} ` : " ", fg: row.done ? tone.good : ink.note, bg },
      ],
    }
  }
  const note = (width: number): Line[] => {
    const busy = state().busy
    if (busy) return [blank, { spans: [{ text: ` ${spinner()} `, fg: tone.ai, bold: true }, { text: busy, fg: ink.label }] }]
    const n = state().note
    if (!n) return []
    const fg = n.ok === true ? tone.good : n.ok === false ? tone.bad : ink.note
    return [blank, ...wrapText(n.text, width - 3).map((t, i) => ({ spans: [{ text: i === 0 ? (n.ok === true ? " ✓ " : n.ok === false ? " ✗ " : " · ") : "   ", fg, bold: true }, { text: t, fg }] }))]
  }
  const buttons = (): Line[] => [blank, ...rows().map(rowLine)]
  const numbered = (items: [string, string][], width: number): Line[] => items.flatMap(([n, text]) =>
    wrapText(text, width - 4).map((t, i) => ({ spans: [{ text: i === 0 ? ` ${n}  ` : "    ", fg: tone.key, bold: true }, { text: t, fg: ink.figure }] })))

  // ---- A step's left column, and the right panel.
  const left = createMemo((): Line[] => {
    const s = state(), w = leftWidth()
    switch (s.step) {
      case "hello": return [
        say("Welcome to jaskmoney", ink.strong, true),
        blank,
        ...wrapped("Setup connects Up Bank, an AI model and your email. Every step is optional; Settings › Up Bank › Setup runs it again.", w),
        blank,
        ...wrapped("Start shows a short tour first: the app's own screens, playing on made-up data.", w, ink.note),
        ...buttons(),
      ]
      case "tour": return tourCard()
      case "up": {
        const accounts = s.upAccounts
        const connected = ctx().up && !s.token.value
        return [
          say("Up Bank", ink.strong, true),
          blank,
          ...(connected ? [
            ...(accounts ? [say("Up answered. These accounts sync:", tone.good), ...accounts.map((a) => ({ spans: [{ text: "  ● ", fg: tone.good }, { text: a, fg: ink.figure }] }))] : [say("Connected.", tone.good)]),
            blank,
            ...wrapped(data.state.upSyncing ? "Syncing your transactions." : `${data.state.transactions.length} transactions so far.`, w, ink.note),
          ] : [
            ...wrapped("Up's API reads with a Personal Access Token. To make one, in the Up app:", w),
            blank,
            ...numbered([["1", "Swipe right"], ["2", "Data sharing › Personal Access Token"], ["3", "Generate a token, choose how long it lasts, copy it"], ["4", "Paste it here, press enter"]], w),
            blank,
            ...wrapped("Up shows a token once, and only the newest works: making a new one stops the old. api.up.com.au makes one too (ctrl+o).", w, ink.note),
          ]),
          ...buttons(), ...note(w),
        ]
      }
      case "ai": return [
        say("AI", ink.strong, true),
        blank,
        ...wrapped("Optional, by provider: each enables what it lists. OpenRouter alone covers suggestions, smart search and rules; Cloudflare adds Clairic for the dates in a search.", w),
        ...buttons(), ...note(w),
      ]
      case "email": {
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
          ...buttons(), ...note(w),
        ]
      }
      case "done": {
        const c = ctx()
        const line = (ok: boolean, name: string, how: string): Line => ({ spans: [{ text: ok ? " ✓ " : " – ", fg: ok ? tone.good : ink.faint, bold: true }, { text: name.padEnd(10), fg: ink.figure, bold: true }, { text: how, fg: ok ? ink.label : ink.note }] })
        return [
          say("Ready", ink.strong, true),
          blank,
          line(c.up, "Up Bank", c.up ? (data.state.upSyncing ? "syncing your transactions" : `${data.state.transactions.length} transactions`) : "not connected: Settings › Up Bank"),
          line(c.jev || c.openai, "AI", c.openrouter ? "OpenRouter: suggestions, search, rules" : c.openai ? "ChatGPT: rules" : c.jev ? "Jev: suggestions, search" : "off: Settings › AI models"),
          line(s.email.phase === "done" || c.executor, "Email", s.email.phase === "done" ? `Gmail through Executor${s.email.account ? ` (${s.email.account})` : ""}` : c.executor ? "Executor signed in" : "off: Settings › AI models › Sources"),
          blank,
          ...wrapped("Settings › Up Bank › Setup runs this again.", w, ink.note),
          ...buttons(),
        ]
      }
    }
  })
  const right = createMemo((): Line[] => {
    const s = state(), w = panelWidth()
    if (s.step === "up") return usesLines(UP_USES, w)
    if (s.step === "email") return usesLines(EMAIL_USES, w)
    if (s.step === "ai") {
      const at = rows()[s.cursor]?.action
      const lines = usesLines(AI_USES_TEXT[at === "openai" ? "openai" : at === "jevKey" ? "jev" : at === "clairic" ? "clairic" : "openrouter"], w)
      // As tall as the tallest provider's: the card keeps its size as the cursor moves.
      const tallest = Math.max(...Object.values(AI_USES_TEXT).map((u) => usesLines(u, w).length))
      return [...lines, ...Array.from({ length: tallest - lines.length }, () => blank)]
    }
    return []
  })

  // ---- The tour's card: where you are among the demos, what this one
  // shows, the rows. The demo itself plays below the card.
  function tourCard(): Line[] {
    const demo = DEMOS[state().demo]!
    return [
    say(`Tour · ${demo.name}`, ink.strong, true),
    blank,
    ...demo.caption.map(([k, text]): Line => ({ spans: [{ text: k.padEnd(4), fg: tone.key, bold: true }, { text: text, fg: ink.label }] })),
    // Two lines each, so the card (and the demo under it) stays put.
    ...(demo.caption.length < 2 ? [blank] : []),
    blank,
    { spans: DEMOS.flatMap((d, i): StyledSpan[] => [
      ...(i ? [{ text: "   " }] : []),
      { text: i === state().demo ? "● " : "○ ", fg: i === state().demo ? tone.key : ink.faint, bold: true },
      { text: d.name, fg: i === state().demo ? ink.strong : ink.faint, bold: i === state().demo },
    ]) },
    ...buttons(),
    ]
  }
  // Below the card, as wide as there's room for. Height: the title, the
  // rail and their gaps (5), the card and its border, a gap; at most about
  // the table's size in the app, and taller where there's room.
  const reelWidth = () => Math.max(40, Math.min(dims().width - 4, 124))
  const reelHeight = () => Math.max(8, Math.min(30, height() - 5 - (left().length + 2) - 1))

  const click = (row: number | undefined) => row === undefined ? undefined : onPointer("welcome", () => {
    const action = rows()[row]?.action
    if (!action) return
    ui.setState("welcome", { cursor: row })
    welcomeAct(ui, data, action)
  })

  // ---- The title: its gradient drifts, and every few seconds a slanted
  // sheen sweeps across it, a white-hot core in a wide glow.
  const SHEEN_EVERY = 40 // frames: a sweep, then a rest
  const SHEEN_FRAMES = 18
  const titleSpans = (r: 0 | 1): StyledSpan[] => {
    const text = TITLE[r], n = text.length
    const f = tick() % SHEEN_EVERY
    // The lower row trails: the sheen leans.
    const sweep = f < SHEEN_FRAMES ? (f / SHEEN_FRAMES) * (n + 24) - 12 - r * 2 : -99
    const drift = (Math.sin(tick() / 25) + 1) / 2
    return [...text].map((ch, x) => {
      const d = Math.abs(x - sweep)
      const core = Math.max(0, 1 - d / 2)
      const glow = Math.max(0, 1 - d / 9)
      const base = mix(tone.key, tone.focus, Math.min(1, Math.max(0, x / n * 0.8 + drift * 0.4 - 0.1)))
      return { text: ch, fg: mix(mix(base, tone.focus, glow * 0.6), ink.strong, Math.min(1, core * 1.2 + glow * 0.25)), bold: true }
    })
  }

  // ---- The setup's backdrop, behind every step: money marks drifting,
  // faint (backdrop); the cards and the demo are solid over it.
  const backdropInk: BackdropInk = {
    level: (level) => mix(theme.canvas, level >= BACKDROP_LEVELS - 1 ? tone.key : tone.focus, 0.06 + (level / (BACKDROP_LEVELS - 1)) * 0.38),
    up: mix(theme.canvas, tone.good, 0.4),
    down: mix(theme.canvas, tone.bad, 0.4),
  }
  // Settings › Appearance's choice; b on the welcome page tries the next.
  const backdropId = (): BackdropId => state().backdrop ?? data.state.uiPrefs.backdrop ?? DEFAULT_BACKDROP
  // Behind every step, on a clock of its own at 30 frames a second (the
  // setup's is slower): a tape moves in even steps.
  const [backdropT, setBackdropT] = createSignal(0)
  const backdropStart = performance.now()
  const backdropTimer = setInterval(() => setBackdropT((performance.now() - backdropStart) / 1000), 33)
  onCleanup(() => clearInterval(backdropTimer))
  // The tape's real prices, while it's the backdrop.
  createEffect(() => {
    if (backdropId() !== "ticker") return
    onCleanup(followTickers(ui))
  })
  const backdrop = createMemo(() => backdropLines(backdropId(), dims().width, height(), backdropT(), backdropInk, state().tickersAsked ? state().tickers : "waiting"))

  // ---- The rail: where you are among the steps; the way to here fills in.
  const railSpans = (): StyledSpan[] => {
    const at = WELCOME_STEPS.indexOf(state().step)
    const out: StyledSpan[] = []
    WELCOME_STEPS.forEach((step, i) => {
      if (i > 0) {
        const lit = i <= at ? (i === at ? Math.min(5, since()) : 5) : 0
        out.push({ text: " " + "━".repeat(lit), fg: tone.key }, { text: "─".repeat(5 - lit) + " ", fg: ink.rule })
      }
      const mark = stepMark(step, state(), ctx())
      out.push(
        // Ready: a star, hollow until you get there.
        { text: step === "done" ? (mark === "ahead" ? "☆ " : "★ ") : mark === "done" ? "✓ " : mark === "skipped" ? "– " : mark === "current" ? "● " : "○ ", fg: mark === "done" ? tone.good : mark === "current" ? tone.key : ink.faint, bold: true },
        { text: STEP_NAMES[step], fg: mark === "current" ? ink.strong : mark === "done" ? ink.label : ink.faint, bold: mark === "current" },
      )
    })
    return out
  }
  const railWidth = () => railSpans().reduce((n, s) => n + Bun.stringWidth(s.text), 0)

  const column = (lines: () => Line[], width: () => number) => (
    <box width={width()} flexDirection="column" flexShrink={0}>
      <For each={lines()}>{(line) => (
        <box height={1} width={width()} onMouseDown={click(line.row)}>
          <StyledLine spans={line.spans} bg={theme.canvas} />
        </box>
      )}</For>
    </box>
  )

  return (
    <box position="absolute" zIndex={15} left={0} top={0} width="100%" height={height()} backgroundColor={theme.canvas} flexDirection="column" alignItems="center" justifyContent="center">
      <Show when={backdrop().length}>
        <box position="absolute" left={0} top={0} width="100%" height={height()} flexDirection="column">
          <Index each={backdrop()}>{(spans) => <StyledLine spans={spans()} bg={theme.canvas} />}</Index>
        </box>
      </Show>
      {/* Over the backdrop: an absolute child paints after the flow, so the content takes a higher z. */}
      <box zIndex={1} flexDirection="column" alignItems="center">
      <box height={2} flexDirection="column" alignItems="center">
        <StyledLine spans={titleSpans(0)} bg={theme.canvas} />
        <StyledLine spans={titleSpans(1)} bg={theme.canvas} />
      </box>
      <box height={1} />
      <box height={1} width={railWidth()} onMouseDown={onPointer("welcome", (event) => {
        // A step on the rail: go there.
        let x = event.x - Math.floor((dims().width - railWidth()) / 2)
        for (const [i, step] of WELCOME_STEPS.entries()) {
          const w = (i > 0 ? 7 : 0) + 2 + STEP_NAMES[step].length
          if (x < w) { welcomeJump(ui, data, step); return }
          x -= w
        }
      })}>
        <StyledLine spans={railSpans()} bg={theme.canvas} />
      </box>
      <box height={1} />
      <box width={cardWidth()} border borderStyle="rounded" borderColor={tone.focus} backgroundColor={theme.canvas} paddingLeft={1} paddingRight={1} flexDirection={wide() ? "row" : "column"} gap={wide() ? 3 : 1} maxHeight={height() - 6} overflow="hidden" flexShrink={0}>
        {column(left, leftWidth)}
        <Show when={right().length}>
          <box width={rightWidth()} flexShrink={0} flexDirection="column" border={[wide() ? "left" : "top"]} borderColor={ink.rule} paddingLeft={wide() ? 2 : 0}>
            {column(right, panelWidth)}
          </box>
        </Show>
      </box>
      <Show when={tour()}>
        <box height={1} />
        {/* Solid: the backdrop goes round the demo, not through it. */}
        <box backgroundColor={theme.canvas}>
          <DemoReel scene={state().demo} startedAt={state().demoAt} trying={state().trying} width={reelWidth()} height={reelHeight()} />
        </box>
      </Show>
      </box>
    </box>
  )
}
