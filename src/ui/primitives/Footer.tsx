import { For } from "solid-js"
import { theme } from "../../theme"
import { S } from "./S"

/**
 * Go renderFooter: one line of `key desc` hints joined by two spaces and
 * truncated to the terminal width, so hints are cut at the end rather than
 * squeezed individually. footerStyle: mantle bg; keys pink bold; desc subtext0.
 */
export function Footer(props: { hints: { key: string; desc: string }[] }) {
  return (
    <box width="100%" height={1} backgroundColor={theme.mantle} paddingLeft={1} paddingRight={1} overflow="hidden">
      <text bg={theme.mantle} wrapMode="none">
        <For each={props.hints}>
          {(h, i) => (
            <>
              {i() > 0 ? <S bg={theme.mantle}>{"  "}</S> : null}
              <S fg={theme.accent} bg={theme.mantle} bold>
                {h.key}
              </S>
              <S fg={theme.subtext0} bg={theme.mantle}>
                {` ${h.desc}`}
              </S>
            </>
          )}
        </For>
      </text>
    </box>
  )
}
