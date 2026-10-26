import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createSignal } from "solid-js"
import { theme } from "../../theme"
import { S } from "./S"

/** Fit title segments into `budget` cells, cutting the overflowing segment
 * with an ellipsis and dropping the rest (Go: title truncated to innerWidth). */
export function fitTitle(segments: string[], budget: number): string[] {
  const out: string[] = []
  let left = budget
  for (const seg of segments) {
    if (seg.length <= left) {
      out.push(seg)
      left -= seg.length
      continue
    }
    out.push(left > 1 ? `${seg.slice(0, left - 1)}…` : "")
    left = 0
  }
  while (out.length < segments.length) out.push("")
  return out
}

/**
 * Matches Go renderManagerSectionBox:
 * - default title = brand pink bold; border = surface1
 * - focused = lavender title + border
 * - active adds " *" suffix (Go isActive)
 */
export function SectionCard(props: {
  title: string
  focused?: boolean
  active?: boolean
  titleSuffix?: string
  titleSuffixColor?: string
  flexGrow?: number
  height?: number | "auto" | `${number}%`
  width?: number | "auto" | `${number}%`
  bottomTitle?: string
  children?: JSX.Element
}) {
  const [width, setWidth] = createSignal(0)
  const borderColor = () => (props.focused ? theme.focus : theme.surface1)
  const titleColor = () => (props.focused ? theme.focus : theme.brand)
  // `╭─` before the title and `─╮` after it leave width - 4 cells, one of
  // which is the closing space. Until the first layout reports a width,
  // render the full title.
  const parts = () => {
    const segments = [
      ` ${props.title}`,
      props.titleSuffix ? ` ${props.titleSuffix}` : "",
      props.active ? " *" : "",
    ]
    const fitted = width() > 0 ? fitTitle(segments, Math.max(0, width() - 5)) : segments
    return [fitted[0]!, fitted[1]!, `${fitted[2]!} `]
  }
  const nativeTitleGap = () => parts().join("").replace(/[^\n]/g, " ")

  return (
    <box
      ref={(box: BoxRenderable) => {
        box.onSizeChange = () => setWidth(box.width)
      }}
      border
      borderStyle="rounded"
      borderColor={borderColor()}
      // The native title reserves the correct gap in the border, but cannot
      // apply attributes. A bold overlay below is the app-wide title treatment.
      title={nativeTitleGap()}
      titleColor={titleColor()}
      titleAlignment="left"
      bottomTitle={props.bottomTitle}
      bottomTitleAlignment="left"
      flexGrow={props.flexGrow ?? 0}
      height={props.height}
      width={props.width ?? "100%"}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.canvas}
    >
      {/* left=1: absolute children are placed from the border's inner edge
          (column 1), but the native title gap starts at column 2. */}
      <text position="absolute" top={-1} left={1} zIndex={1} height={1} wrapMode="none">
        <S fg={titleColor()} bold>
          {parts()[0]}
        </S>
        <S fg={props.titleSuffixColor ?? titleColor()} bold>
          {parts()[1]}
        </S>
        <S fg={titleColor()} bold>
          {parts()[2]}
        </S>
      </text>
      {props.children}
    </box>
  )
}
