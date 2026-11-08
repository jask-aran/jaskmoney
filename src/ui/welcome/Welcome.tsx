import { useTerminalDimensions } from "@opentui/solid"
import { Index, Show, on, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { mix, theme, tone, whenThemeChanges } from "../../theme"
import { welcomeBackdrop, welcomeRows, type WelcomeContext, type WelcomeState } from "../../state/welcome"
import { CardColumn, CardSides, type CardLine } from "../primitives/cardLines"
import { followTickers, welcomeAct, welcomeContext, welcomeJump } from "../../app/welcome"
import { onPointer } from "../../app/pointer"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { SPINNER } from "../primitives/Spinner"
import { BACKDROP_LEVELS, backdropLines, keepSameLines, type BackdropId, type BackdropInk } from "./backdrop"
import { DemoReel } from "./Demos"
import { leftLines, rightLines, type CardInputs } from "./card"
import { railSegments, titleSpans } from "./header"

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
/** The clock's step: half a FRAME_MS, so the title's light keeps its beat
 * exactly. 25 a second: the fastest tape (11 columns a second) moves under
 * half a column a step, so it still moves in even steps. */
const CLOCK_MS = FRAME_MS / 2

/** The backdrop's colours, faint over the canvas: its levels mixed once,
 * not per cell per frame. */
const BACKDROP_LEVEL_INK: string[] = []
export const BACKDROP_INK: BackdropInk = { level: (level) => BACKDROP_LEVEL_INK[level]!, up: "", down: "" }
whenThemeChanges(() => {
  BACKDROP_LEVEL_INK.splice(0, BACKDROP_LEVEL_INK.length, ...Array.from({ length: BACKDROP_LEVELS }, (_, level) =>
    mix(theme.canvas, level >= BACKDROP_LEVELS - 1 ? tone.key : tone.focus, 0.06 + (level / (BACKDROP_LEVELS - 1)) * 0.38)))
  BACKDROP_INK.up = mix(theme.canvas, tone.good, 0.4)
  BACKDROP_INK.down = mix(theme.canvas, tone.bad, 0.4)
})

type Line = CardLine

export function Welcome() {
  return <Show when={ui.state.welcome}><WelcomeScreen /></Show>
}

function WelcomeScreen() {
  const dims = useTerminalDimensions()
  const state = () => ui.state.welcome as WelcomeState
  const ctx = createMemo(() => { void data.state.apiKeys; void data.state.signedIn; void data.state.upToken; void state().email.phase; return welcomeContext(data) })
  const rows = createMemo(() => welcomeRows(state(), ctx()))
  const { now, tick, since, spinner, caretOn } = useClock(state)

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

  // ---- A step's left column, and the right panel (ui/welcome/card).
  const card: CardInputs = { state, ctx, rows, spinner, caretOn }
  const left = createMemo((): Line[] => {
    const s = state(), w = leftWidth()
    return leftLines(card, s, w)
  })
  const right = createMemo((): Line[] => {
    const s = state(), w = panelWidth()
    return rightLines(card, s, w)
  })

  // Below the card, as wide as there's room for. Height: the title, the
  // rail and their gaps (5), the card and its border, a gap; at most about
  // the table's size in the app, and taller where there's room.
  const reelWidth = () => Math.max(40, Math.min(dims().width - 4, 124))
  const reelHeight = () => Math.max(8, Math.min(30, height() - 5 - (left().length + 2) - 1))

  const click = (row: number | undefined) => row === undefined ? undefined : onPointer("welcome", () => {
    const at = rows()[row]
    if (!at) return
    ui.setState("welcome", { cursor: row })
    welcomeAct(ui, data, at.action, at)
  })

  const backdrop = useBackdrop(state, now, () => dims().width, height)

  return (
    <box position="absolute" zIndex={15} left={0} top={0} width="100%" height={height()} backgroundColor={theme.canvas} flexDirection="column" alignItems="center" justifyContent="center">
      <Show when={backdrop().length}>
        <box position="absolute" left={0} top={0} width="100%" height={height()} flexDirection="column">
          <Index each={backdrop()}>{(spans) => <StyledLine spans={spans()} bg={theme.canvas} />}</Index>
        </box>
      </Show>
      {/* Over the backdrop: an absolute child paints after the flow, so the content takes a higher z. */}
      <box zIndex={1} flexDirection="column" alignItems="center">
      <WelcomeHeader tick={tick} state={state} ctx={ctx} since={since} />
      <box width={cardWidth()} border borderStyle="rounded" borderColor={tone.focus} backgroundColor={theme.canvas} paddingLeft={1} paddingRight={1} flexDirection={wide() ? "row" : "column"} gap={wide() ? 3 : 1} maxHeight={height() - 6} overflow="hidden" flexShrink={0}>
        <CardSides beside={wide()} leftWidth={leftWidth()} rightWidth={rightWidth()} panel={right()} bg={theme.canvas}>
          <CardColumn lines={left()} width={leftWidth()} bg={theme.canvas} click={click} />
        </CardSides>
      </box>
      <Show when={tour()}>
        <box height={1} />
        {/* Solid: the backdrop goes round the demo, not through it. */}
        <box backgroundColor={theme.canvas}>
          <DemoReel scene={state().demo} startedAt={state().demoAt} now={now()} trying={state().trying} width={reelWidth()} height={reelHeight()} />
        </box>
      </Show>
      </box>
    </box>
  )
}

// ---- The clock, while the setup is open: one for everything that moves
// on it (the backdrop, the title's light, the rail, a spinner, the caret,
// the tour's demo), so each of its steps is one frame drawn; clocks of
// their own would each ask for frames of their own. The backdrop moves
// on every step; the rest on every other one (`tick`, FRAME_MS).
function useClock(state: () => WelcomeState) {
  // A step: how many there have been, and when it came.
  const [clock, setClock] = createSignal({ step: 0, at: performance.now() })
  const timer = setInterval(() => setClock((c) => ({ step: c.step + 1, at: performance.now() })), CLOCK_MS)
  onCleanup(() => clearInterval(timer))
  const now = () => clock().at
  const tick = createMemo(() => clock().step >> 1)
  let shownAt = 0
  createEffect(() => { void state().shown; shownAt = untrack(tick) })
  const since = () => tick() - shownAt
  const spinner = () => SPINNER[tick() % SPINNER.length]!
  // The token's caret blinks: on for six ticks, off for six. The card is
  // rebuilt when it blinks, not on every tick.
  const caretOn = createMemo(() => Math.floor(tick() / 6) % 2 === 0)
  return { now, tick, since, spinner, caretOn }
}

// ---- The setup's backdrop, behind every step: money marks drifting,
// faint (BACKDROP_INK); the cards and the demo are solid over it.
// Settings › Appearance's choice; b on the welcome page tries the next.
function useBackdrop(state: () => WelcomeState, now: () => number, width: () => number, height: () => number) {
  const backdropId = (): BackdropId => welcomeBackdrop(state(), data.state.uiPrefs.backdrop)
  // Behind every step, moving on each step of the clock.
  const backdropT = () => now() / 1000
  // The tape's real prices, while it's the backdrop.
  createEffect(() => {
    if (backdropId() !== "ticker") return
    onCleanup(followTickers(ui))
  })
  // Seconds since this backdrop began: a new one starts from its beginning
  // (a ticker tape from empty, streaming in).
  const backdropSince = createMemo(on(backdropId, () => untrack(backdropT)))
  // A frame's lines that are as they were stay the same lines (and a frame
  // that changes nothing, the same frame): only what moved is drawn again.
  let drawn: StyledSpan[][] = []
  return createMemo(() => (drawn = keepSameLines(drawn, backdropLines(backdropId(), width(), height(), backdropT() - backdropSince(), BACKDROP_INK, state().tickers))))
}

/** The title (ui/welcome/header), a gap, the rail, a gap. */
function WelcomeHeader(props: { tick: () => number; state: () => WelcomeState; ctx: () => WelcomeContext; since: () => number }) {
  return (
    <>
      <box height={2} flexDirection="column" alignItems="center">
        <StyledLine spans={titleSpans(props.tick, 0)} bg={theme.canvas} />
        <StyledLine spans={titleSpans(props.tick, 1)} bg={theme.canvas} />
      </box>
      <box height={1} />
      <box height={1} flexDirection="row">
        {/* A step on the rail: a click goes there. */}
        <Index each={railSegments(props.state, props.ctx, props.since)}>{(segment) => (
          <box height={1} width={segment().width} flexShrink={0} onMouseDown={onPointer("welcome", () => welcomeJump(ui, data, segment().step))}>
            <StyledLine spans={segment().spans} bg={theme.canvas} />
          </box>
        )}</Index>
      </box>
      <box height={1} />
    </>
  )
}
