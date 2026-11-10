import { TextAttributes, type TextNodeRenderable } from "@opentui/core"
import { createEffect, type JSX } from "solid-js"

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
