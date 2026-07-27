import { theme } from "../../theme"

/** Go statusBarStyle: surface0 bg, subtext1 fg; error = red fg. */
export function StatusBar(props: { text: string; isErr?: boolean }) {
  return (
    <box
      width="100%"
      height={1}
      backgroundColor={theme.surface0}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.isErr ? theme.error : theme.subtext1} bg={theme.surface0}>
        {props.text || " "}
      </text>
    </box>
  )
}
