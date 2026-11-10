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

const FRAME_MS = 80

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
  const since = createMemo(on(id, () => untrack(now) / 1000))
  const height = () => Math.max(1, dims().height - 4)
  let drawn: StyledSpan[][] = []
  const lines = createMemo(() => (drawn = keepSameLines(drawn, backdropLines(id(), dims().width, height(), now() / 1000 - since(), BACKDROP_INK, tickers()))))
  return (
    <box position="absolute" left={0} top={0} width="100%" height={height()} flexDirection="column">
      <Index each={lines()}>{(spans) => <StyledLine spans={spans()} bg={theme.canvas} />}</Index>
    </box>
  )
}
