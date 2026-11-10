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
  const paletteCommands = createMemo(() => ui.state.palette ? paletteList(ui, data) : [])

  const remote = flagValue("--connect")
  const serving = remote == null ? flagValue("--serve") : null

  const bootstrap = bootstrapper(setBootstrapped)

  startCore(remote, serving, bootstrap)

  startupEffects(remote, bootstrapped, bootstrap)

  const syncLabel = syncClock()

  appInput(renderer)

  followEffects()

  return (
    <Show when={String(themeVersion())} keyed>{(_version: string) => (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <AppBar syncLabel={syncLabel} />
      <box height={1} width="100%" backgroundColor={theme.canvas} />
      <box flexGrow={1} width="100%" flexDirection="column" backgroundColor={theme.canvas}>
        <KeptTab id="overview">{(focused) => <OverviewTab focused={focused()} />}</KeptTab>
        <KeptTab id="manager">{(focused) => <ManagerTab focused={focused()} />}</KeptTab>
        <KeptTab id="budgets">{(focused) => <BudgetsTab focused={focused()} />}</KeptTab>
        <KeptTab id="settings">{(focused) => <SettingsTab focused={focused()} />}</KeptTab>
      </box>
      <StatusBar
        text={ui.state.jump != null ? "Jump mode · press target letter" : ui.state.welcome ? welcomeStatus(ui.state.welcome, data.state.uiPrefs.backdrop) : ui.state.status}
        isErr={ui.state.jump == null && !ui.state.welcome && ui.state.statusErr}
      />
      <Footer line={footerLine(ui.activeScope(), hintState(ui, data), terminal().width - 2)} />
      <Overlays paletteCommands={paletteCommands} />
    </box>
    )}</Show>
  )
}
