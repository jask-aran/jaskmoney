import { TextAttributes, type TextNodeRenderable } from "@opentui/core"
import { createEffect, type JSX } from "solid-js"

/**
 * Inline styled text.
 *
 * OpenTUI's Solid `style` reconciler ORs attributes into a node, so it cannot
 * clear a previous `bold` bit. Set the node's complete style directly instead;
 * this lets a former cursor row return to normal weight. Each value is
 * written only when it changes: a colour write parses it again and marks the
 * text for re-layout, and a table updates hundreds of spans per keystroke.
 */
export function S(props: {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  children?: JSX.Element
}) {
  return (
    <span
      ref={(node: TextNodeRenderable) => {
        createEffect(() => {
          const attributes =
            (props.bold ? TextAttributes.BOLD : 0) |
            (props.dim ? TextAttributes.DIM : 0) |
            (props.italic ? TextAttributes.ITALIC : 0)
          if (node.attributes !== attributes) node.attributes = attributes
        })
        let fg: string | undefined
        let bg: string | undefined
        let first = true
        createEffect(() => {
          if (first || props.fg !== fg) node.fg = fg = props.fg
          if (first || props.bg !== bg) node.bg = bg = props.bg
          first = false
        })
      }}
    >
      {props.children}
    </span>
  )
}
