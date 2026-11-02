import { Index, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { sources } from "../../app/welcome"
import type { Ticker } from "../../app/tickers"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { DEFAULT_BACKDROP, backdropLines, keepSameLines, type BackdropId } from "../welcome/backdrop"
import { BACKDROP_INK } from "../welcome/Welcome"

/** A frame of the backdrop: as the setup's (welcome/Welcome FRAME_MS). */
const FRAME_MS = 80

/**
 * The setup's backdrop (Settings › Appearance › Welcome backdrop) behind
 * Settings' panes: faint money marks drifting in the gaps between them and
 * the room below. It moves only while Settings is the tab in view and the
 * setup isn't open over it; otherwise its clock stops. The ticker tape asks
 * for real prices as the setup's does (app/welcome sources), every two
 * minutes while it shows.
 */
export function SettingsBackdrop() {
  const dims = useTerminalDimensions()
  const shown = () => ui.state.activeTab === "settings" && !ui.state.welcome
  const id = (): BackdropId => data.state.uiPrefs.backdrop ?? DEFAULT_BACKDROP
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!shown()) return
    const timer = setInterval(() => setNow(Date.now()), FRAME_MS)
    onCleanup(() => clearInterval(timer))
  })
  const [tickers, setTickers] = createSignal<Ticker[] | undefined>()
  createEffect(() => {
    if (!shown() || id() !== "ticker") return
    let stopped = false
    const ask = async () => { const got = await sources.tickers(); if (!stopped && got) setTickers(got) }
    void ask()
    const timer = setInterval(() => void ask(), 120_000)
    onCleanup(() => { stopped = true; clearInterval(timer) })
  })
  // Seconds since this backdrop began: a new one starts from its beginning.
  const since = createMemo(on(id, () => untrack(now) / 1000))
  const height = () => Math.max(1, dims().height - 4)
  // Lines as they were stay the same lines: only what moved is drawn again.
  let drawn: StyledSpan[][] = []
  const lines = createMemo(() => (drawn = keepSameLines(drawn, backdropLines(id(), dims().width, height(), now() / 1000 - since(), BACKDROP_INK, tickers()))))
  return (
    <box position="absolute" left={0} top={0} width="100%" height={height()} flexDirection="column">
      <Index each={lines()}>{(spans) => <StyledLine spans={spans()} bg={theme.canvas} />}</Index>
    </box>
  )
}
