import { TextAttributes, type TextNodeRenderable } from "@opentui/core"
import { createEffect, type JSX } from "solid-js"

/**
 * Inline styled text.
 *
 * OpenTUI's Solid `style` reconciler ORs attributes into a node, so it cannot
 * clear a previous `bold` bit. Set the node's complete style directly instead;
 * this lets a former cursor row return to normal weight.
 */
export function S(props: {
  fg?: string
  bg?: string
  bold?: boolean
  children?: JSX.Element
}) {
  return (
    <span
      ref={(node: TextNodeRenderable) => {
        createEffect(() => {
          node.attributes = props.bold ? TextAttributes.BOLD : 0
          node.fg = props.fg
          node.bg = props.bg
        })
      }}
    >
      {props.children}
    </span>
  )
}
