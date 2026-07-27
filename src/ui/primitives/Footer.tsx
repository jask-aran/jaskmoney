import { For } from "solid-js"
import { theme } from "../../theme"

/** Go footerStyle: mantle bg; helpKeyStyle pink bold; helpDescStyle subtext0. */
export function Footer(props: { hints: { key: string; desc: string }[] }) {
  return (
    <box
      width="100%"
      height={1}
      backgroundColor={theme.mantle}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
      gap={2}
    >
      <For each={props.hints}>
        {(h) => (
          <box flexDirection="row" gap={1} backgroundColor={theme.mantle}>
            <text fg={theme.accent} bg={theme.mantle}>
              <b>{h.key}</b>
            </text>
            <text fg={theme.subtext0} bg={theme.mantle}>
              {h.desc}
            </text>
          </box>
        )}
      </For>
    </box>
  )
}
