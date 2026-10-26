import type { JSX } from "@opentui/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { theme } from "../../theme"
import { S } from "./S"

/**
 * The app's one overlay: a centred, bordered panel over the tab with a bold
 * title (and optional muted subtitle), the body, then a muted hint line.
 * `tone="error"` is for confirmations that destroy data.
 */
export function Modal(props: {
  title: string
  subtitle?: string
  width?: number
  tone?: "accent" | "error"
  hints?: string
  children?: JSX.Element
}) {
  const dims = useTerminalDimensions()
  const color = () => (props.tone === "error" ? theme.error : theme.accent)
  return (
    <box position="absolute" zIndex={20} left={0} top={0} width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        border
        borderStyle="rounded"
        borderColor={color()}
        backgroundColor={theme.mantle}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        width={Math.max(20, Math.min(props.width ?? 64, dims().width - 4))}
        maxHeight={dims().height - 2}
        flexDirection="column"
      >
        <text wrapMode="none">
          <S fg={color()} bold>{props.title}</S>
          <Show when={props.subtitle}>
            <S fg={theme.overlay1}>{` · ${props.subtitle}`}</S>
          </Show>
        </text>
        <text> </text>
        {props.children}
        <Show when={props.hints}>
          <text> </text>
          <text fg={theme.overlay1} wrapMode="none">{props.hints}</text>
        </Show>
      </box>
    </box>
  )
}
