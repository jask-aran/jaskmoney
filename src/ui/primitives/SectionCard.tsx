import type { JSX } from "@opentui/solid"
import { theme } from "../../theme"
import { S } from "./S"

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
  const borderColor = () => (props.focused ? theme.focus : theme.surface1)
  const titleColor = () => (props.focused ? theme.focus : theme.brand)
  const titleText = () =>
    ` ${props.title}${props.titleSuffix ? ` ${props.titleSuffix}` : ""}${
      props.active ? " *" : ""
    } `
  const nativeTitleGap = () => titleText().replace(/[^\n]/g, " ")

  return (
    <box
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
      <text position="absolute" top={-1} left={0} zIndex={1} width="100%" truncate>
        <S fg={titleColor()} bold>
          {` ${props.title}`}
        </S>
        {props.titleSuffix ? (
          <S fg={props.titleSuffixColor ?? titleColor()} bold>
            {` ${props.titleSuffix}`}
          </S>
        ) : null}
        <S fg={titleColor()} bold>
          {props.active ? " * " : " "}
        </S>
      </text>
      {props.children}
    </box>
  )
}
