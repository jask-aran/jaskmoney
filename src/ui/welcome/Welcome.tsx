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

const FRAME_MS = 80
const CLOCK_MS = FRAME_MS / 2

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

  const height = () => Math.max(12, dims().height - 2)
  const tour = () => state().step === "tour"
  const paneled = () => state().step === "up" || state().step === "ai" || state().step === "email"
  const wide = () => dims().width >= 112
  const cardWidth = () => Math.max(40, Math.min(dims().width - 4, wide() && paneled() ? 120 : 76))
  const inner = () => cardWidth() - 4
  const leftWidth = () => (wide() && paneled() ? Math.floor(inner() * 0.52) : inner())
  const rightWidth = () => (wide() ? inner() - leftWidth() - 3 : inner())
  const panelWidth = () => rightWidth() - (wide() ? 3 : 0)

  const card: CardInputs = { state, ctx, rows, spinner, caretOn }
  const left = createMemo((): Line[] => {
    const s = state(), w = leftWidth()
    return leftLines(card, s, w)
  })
  const right = createMemo((): Line[] => {
    const s = state(), w = panelWidth()
    return rightLines(card, s, w)
  })

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
      <box zIndex={1} flexDirection="column" alignItems="center">
      <WelcomeHeader tick={tick} state={state} ctx={ctx} since={since} />
      <box width={cardWidth()} border borderStyle="rounded" borderColor={tone.focus} backgroundColor={theme.canvas} paddingLeft={1} paddingRight={1} flexDirection={wide() ? "row" : "column"} gap={wide() ? 3 : 1} maxHeight={height() - 6} overflow="hidden" flexShrink={0}>
        <CardSides beside={wide()} leftWidth={leftWidth()} rightWidth={rightWidth()} panel={right()} bg={theme.canvas}>
          <CardColumn lines={left()} width={leftWidth()} bg={theme.canvas} click={click} />
        </CardSides>
      </box>
      <Show when={tour()}>
        <box height={1} />
        <box backgroundColor={theme.canvas}>
          <DemoReel scene={state().demo} startedAt={state().demoAt} now={now()} trying={state().trying} width={reelWidth()} height={reelHeight()} />
        </box>
      </Show>
      </box>
    </box>
  )
}

function useClock(state: () => WelcomeState) {
  const [clock, setClock] = createSignal({ step: 0, at: performance.now() })
  const timer = setInterval(() => setClock((c) => ({ step: c.step + 1, at: performance.now() })), CLOCK_MS)
  onCleanup(() => clearInterval(timer))
  const now = () => clock().at
  const tick = createMemo(() => clock().step >> 1)
  let shownAt = 0
  createEffect(() => { void state().shown; shownAt = untrack(tick) })
  const since = () => tick() - shownAt
  const spinner = () => SPINNER[tick() % SPINNER.length]!
  const caretOn = createMemo(() => Math.floor(tick() / 6) % 2 === 0)
  return { now, tick, since, spinner, caretOn }
}

function useBackdrop(state: () => WelcomeState, now: () => number, width: () => number, height: () => number) {
  const backdropId = (): BackdropId => welcomeBackdrop(state(), data.state.uiPrefs.backdrop)
  const backdropT = () => now() / 1000
  createEffect(() => {
    if (backdropId() !== "ticker") return
    onCleanup(followTickers(ui))
  })
  const backdropSince = createMemo(on(backdropId, () => untrack(backdropT)))
  let drawn: StyledSpan[][] = []
  return createMemo(() => (drawn = keepSameLines(drawn, backdropLines(backdropId(), width(), height(), backdropT() - backdropSince(), BACKDROP_INK, state().tickers))))
}

function WelcomeHeader(props: { tick: () => number; state: () => WelcomeState; ctx: () => WelcomeContext; since: () => number }) {
  return (
    <>
      <box height={2} flexDirection="column" alignItems="center">
        <StyledLine spans={titleSpans(props.tick, 0)} bg={theme.canvas} />
        <StyledLine spans={titleSpans(props.tick, 1)} bg={theme.canvas} />
      </box>
      <box height={1} />
      <box height={1} flexDirection="row">
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
