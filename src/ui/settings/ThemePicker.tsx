import { For, Show } from "solid-js"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { ink, paletteOf, theme } from "../../theme"
import { DEFAULT_THEME, THEMES, type ThemeDef } from "../../themes"
import { Modal } from "../primitives/Modal"
import { ListRow } from "../primitives/ListRow"
import { fit } from "../text"
import type { Span } from "../primitives/spans"

const NAME = 20

/** A theme's colours as a strip, each in its own colour: keys, money in
 * and out, caution, focus, spending, suggestions. */
function swatches(def: ThemeDef): Span[] {
  const p = paletteOf(def)
  return [p.pink, p.green, p.red, p.yellow, p.lavender, p.mauve, p.teal].flatMap((fg, i) => [...(i ? [{ text: " ", fg: ink.note }] : []), { text: "■", fg }])
}

/**
 * Settings › Appearance › Theme (and the palette's Theme…): every theme
 * with its colours. The theme at the cursor is shown across the app while
 * the picker is open; enter keeps it, esc puts the saved one back.
 */
export function ThemePicker() {
  const saved = () => data.state.uiPrefs.theme ?? DEFAULT_THEME
  return (
    <Show when={ui.state.themePicker}>
      {(picker: () => NonNullable<typeof ui.state.themePicker>) => (
        <Modal title="Theme" width={48} hints="↑↓ preview · enter keep · esc put back">
          <For each={THEMES}>{(def, i) => (
            <ListRow cursor={picker().cursor === i()} bg={theme.mantle} spans={[
              { text: fit(def.name, NAME), fg: ink.figure },
              ...swatches(def),
              { text: def.id === saved() ? "  in use" : "", fg: ink.note },
            ]} />
          )}</For>
        </Modal>
      )}
    </Show>
  )
}
