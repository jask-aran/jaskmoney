import { welcomeStatus } from "../state/welcome"
import { BudgetsTab } from "../ui/budgets/BudgetsTab"
import { Show, createMemo, createSignal, For } from "solid-js"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { footerLine, hintState, paletteList } from "./keys"
import { OverviewTab } from "../ui/overview/OverviewTab"
import { SettingsTab } from "../ui/settings/SettingsTab"
import { theme, themeVersion, ink, tone } from "../theme"
import { KeptTab } from "./KeptTab"
import { AppBar, Overlays } from "./AppChrome"
import { ManagerTab } from "../ui/manager/ManagerTables"
import { appInput, bootstrapper, followEffects, startCore, startupEffects, syncClock } from "./startup"
import { ALL, footerParts, type Hint } from "./palette"
import { S } from "../ui/primitives/S"

/**
 * The footer: the focused pane's name, its keys, then (after a rule) the
 * tab's, each `key desc`, two spaces between, on one line (the hints
 * already fitted to it, `footerLine`); "ctrl+k all" at the right wherever
 * the palette opens. The pane's name in focus's colour, as its border is;
 * keys in the key tone, bold; words in labels'.
 */
function Footer(props: { line: { pane: string | null; hints: Hint[]; palette: boolean } }) {
  const color = { pane: tone.focus, key: tone.key, desc: ink.label, gap: ink.label, rule: ink.rule } as const
  return (
    <box width="100%" height={1} flexDirection="row" justifyContent="space-between" backgroundColor={theme.mantle} paddingLeft={1} paddingRight={1} overflow="hidden">
      <text bg={theme.mantle} wrapMode="none" flexShrink={1}>
        <For each={footerParts(props.line.pane, props.line.hints)}>
          {(part) => <S fg={color[part.kind]} bg={theme.mantle} bold={part.kind === "key" || part.kind === "pane"}>{part.text}</S>}
        </For>
      </text>
      <Show when={props.line.palette}>
        <text bg={theme.mantle} wrapMode="none" flexShrink={0}>
          <S fg={tone.key} bg={theme.mantle} bold>{ALL.key}</S>
          <S fg={ink.label} bg={theme.mantle}>{` ${ALL.desc}`}</S>
        </text>
      </Show>
    </box>
  )
}

/** Go statusBarStyle: surface0 bg, subtext1 fg; error = red fg. */
function StatusBar(props: { text: string; isErr?: boolean }) {
  return (
    <box
      width="100%"
      height={1}
      backgroundColor={theme.surface0}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.isErr ? tone.bad : ink.label} bg={theme.surface0}>
        {props.text || " "}
      </text>
    </box>
  )
}

/** A flag's value: `--name=value` or `--name value`, "" when it has none, null when absent. */
function flagValue(name: string): string | null {
  const args = process.argv
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (i < 0) return null
  if (args[i]!.includes("=")) return args[i]!.slice(name.length + 1)
  const next = args[i + 1]
  return next && !next.startsWith("--") ? next : ""
}

export function App() {
  const renderer = useRenderer()
  const terminal = useTerminalDimensions()

  const [bootstrapped, setBootstrapped] = createSignal(false)
  // The same array until the palette reopens or its query changes (keys'
  // paletteList), so a cursor move leaves the palette's rows alone.
  const paletteCommands = createMemo(() => ui.state.palette ? paletteList(ui, data) : [])

  // `--connect <ws url>`: a core elsewhere (bun run server, or a TUI's
  // --serve). Otherwise the core is this process's; `--serve[=port]` serves
  // it to other clients (a TUI's --connect) too.
  const remote = flagValue("--connect")
  const serving = remote == null ? flagValue("--serve") : null

  const bootstrap = bootstrapper(setBootstrapped)

  // Before the tree below is built, so it is built once, with the data,
  // rather than empty and then again (~80 ms of every start).
  startCore(remote, serving, bootstrap)

  startupEffects(remote, bootstrapped, bootstrap)

  const syncLabel = syncClock()

  appInput(renderer)

  followEffects()

  return (
    // The child takes the version: Show calls a child function with its
    // value (remounting on each new one) only when it declares a parameter.
    <Show when={String(themeVersion())} keyed>{(_version: string) => (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      {/* The Up mark sits in the Overview's top-right corner, over the tab
          bar, the gap and the Date Range, which end short of it. */}
      <AppBar syncLabel={syncLabel} />
      <box height={1} width="100%" backgroundColor={theme.canvas} />
      <box flexGrow={1} width="100%" flexDirection="column" backgroundColor={theme.canvas}>
        {/* Each tab mounts on its first visit and then stays, hidden while
            another is shown: switching tabs shows it rather than building it
            again (~30ms on a full database). A rendering error stays inside
            its tab, so the rest of the app (tab switching, quit) works;
            switching tabs retries. */}
        <KeptTab id="overview">{(focused) => <OverviewTab focused={focused()} />}</KeptTab>
        <KeptTab id="manager">{(focused) => <ManagerTab focused={focused()} />}</KeptTab>
        <KeptTab id="budgets">{(focused) => <BudgetsTab focused={focused()} />}</KeptTab>
        <KeptTab id="settings">{(focused) => <SettingsTab focused={focused()} />}</KeptTab>
      </box>
      {/* Jump mode and the setup borrow the status line while open; the log's
          latest status returns unchanged when they close. */}
      <StatusBar
        text={ui.state.jump != null ? "Jump mode · press target letter" : ui.state.welcome ? welcomeStatus(ui.state.welcome, data.state.uiPrefs.backdrop) : ui.state.status}
        isErr={ui.state.jump == null && !ui.state.welcome && ui.state.statusErr}
      />
      {/* The footer's line, less its padding either side. */}
      <Footer line={footerLine(ui.activeScope(), hintState(ui, data), terminal().width - 2)} />
      <Overlays paletteCommands={paletteCommands} />
    </box>
    )}</Show>
  )
}
