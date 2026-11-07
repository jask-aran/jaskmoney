import { For } from "solid-js"
import { footerParts, type Hint } from "../../app/palette"
import { theme, ink, tone } from "../../theme"
import { S } from "./S"

/**
 * The footer: the focused pane's name, its keys, then (after a rule) the
 * tab's, each `key desc`, two spaces between, on one line (the hints
 * already fitted to it, `footerLine`). The pane's name in focus's colour,
 * as its border is; keys in the key tone, bold; words in labels'.
 */
export function Footer(props: { line: { pane: string | null; hints: Hint[] } }) {
  const color = { pane: tone.focus, key: tone.key, desc: ink.label, gap: ink.label, rule: ink.rule } as const
  return (
    <box width="100%" height={1} backgroundColor={theme.mantle} paddingLeft={1} paddingRight={1} overflow="hidden">
      <text bg={theme.mantle} wrapMode="none">
        <For each={footerParts(props.line.pane, props.line.hints)}>
          {(part) => <S fg={color[part.kind]} bg={theme.mantle} bold={part.kind === "key" || part.kind === "pane"}>{part.text}</S>}
        </For>
      </text>
    </box>
  )
}
