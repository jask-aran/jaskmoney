import { ListPicker } from "./ListPicker"

const LABEL = 30

/** ctrl+k: every action of the pane it opened over, plus the global ones,
 * each with its key (app/palette). App computes the entries. */
export function CommandPalette(props: { entries: { label: string; key: string }[]; cursor: number; query: string; from: string }) {
  return (
    <ListPicker
      title="Commands"
      subtitle={props.from}
      // The keys in a column: the label padded (the picker puts the
      // detail straight after it).
      items={props.entries.map((entry, i) => ({ kind: "item", label: entry.label.padEnd(LABEL), value: i, detail: entry.key }))}
      cursor={props.cursor}
      query={props.query}
      width={56}
      hints="↑↓ ^j/k move · enter run · esc close · type filter"
    />
  )
}
