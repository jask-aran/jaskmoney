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

export function swatches(def: ThemeDef, tight = false): Span[] {
  const p = paletteOf(def)
  return [p.pink, p.green, p.red, p.yellow, p.lavender, p.mauve, p.teal].flatMap((fg, i) => [...(i && !tight ? [{ text: " ", fg: ink.note }] : []), { text: "■", fg }])
}

export const themeDef = (id: string | undefined): ThemeDef => THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!

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
