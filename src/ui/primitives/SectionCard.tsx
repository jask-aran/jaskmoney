import type { JSX } from "@opentui/solid"
import { theme } from "../../theme"

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
  flexGrow?: number
  height?: number | "auto" | `${number}%`
  children?: JSX.Element
}) {
  const borderColor = () => (props.focused ? theme.focus : theme.surface1)
  const titleColor = () => (props.focused ? theme.focus : theme.brand)
  const title = () => (props.active ? `${props.title} *` : props.title)

  return (
    <box
      border
      borderStyle="rounded"
      borderColor={borderColor()}
      title={title()}
      titleColor={titleColor()}
      titleAlignment="left"
      flexGrow={props.flexGrow ?? 0}
      height={props.height}
      width="100%"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.base}
    >
      {props.children}
    </box>
  )
}
