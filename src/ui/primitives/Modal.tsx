import type { JSX } from "@opentui/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { Show } from "solid-js"
import { theme } from "../../theme"
import { BorderText } from "./BorderText"
import { fitSpans, spansWidth, type Span } from "./spans"

const TONE = { accent: theme.accent, error: theme.error, warning: theme.warning, focus: theme.focus } as const

/**
 * The app's one overlay, after the Go app's modals: a centred, bordered panel
 * over the tab with its title centred in the top border (bold, with an
 * optional muted subtitle), the body, then a muted hint line. `tone` colours
 * the border and title: "error" for confirmations that destroy data.
 */
export function Modal(props: {
  title: string
  subtitle?: string
  width?: number
  tone?: keyof typeof TONE
  hints?: string
  children?: JSX.Element
}) {
  const dims = useTerminalDimensions()
  const color = () => TONE[props.tone ?? "accent"]
  const width = () => Math.max(20, Math.min(props.width ?? 64, dims().width - 4))
  // Centred from the panel's known width.
  const title = () =>
    fitSpans(
      [
        { text: ` ${props.title}`, fg: color(), bold: true },
        ...(props.subtitle ? [{ text: ` · ${props.subtitle}`, fg: theme.overlay1 }] : []),
        { text: " ", fg: color() },
      ] satisfies Span[],
      width() - 4,
    )
  return (
    <box position="absolute" zIndex={20} left={0} top={0} width="100%" height="100%" justifyContent="center" alignItems="center">
      <box
        border
        borderStyle="rounded"
        borderColor={color()}
        backgroundColor={theme.mantle}
        paddingLeft={1}
        paddingRight={1}
        width={width()}
        maxHeight={dims().height - 2}
        flexDirection="column"
      >
        <BorderText spans={title()} top={-1} left={Math.floor((width() - spansWidth(title())) / 2) - 1} bg={theme.mantle} />
        {props.children}
        <Show when={props.hints}>
          <text> </text>
          <text fg={theme.overlay1} wrapMode="none">{props.hints}</text>
        </Show>
      </box>
    </box>
  )
}
