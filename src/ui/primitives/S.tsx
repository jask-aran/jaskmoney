import { TextAttributes, type TextNodeRenderable } from "@opentui/core"
import { createEffect, type JSX } from "solid-js"

/**
 * Inline styled text.
 *
 * Why not `<span fg bold>` or `style`: on a span, OpenTUI's Solid reconciler
 * reads only `href` and `style` (@opentui/solid 0.7, index.js setProperty);
 * plain `fg`/`bg`/`bold` props are dropped. `style` does clear the bits it
 * set before (`attributes & ~prev | next`; older versions only ORed them in),
 * but it writes fg and bg on every change, and each TextNode write parses the
 * colour again and asks for a render. Here each value is written only when it
 * changes: a table updates hundreds of spans per keystroke.
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
