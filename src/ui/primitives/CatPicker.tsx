import { For, Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"

export function CatPicker() {
  const filtered = createMemo(() => {
    const q = ui.state.catPickerQuery.trim().toLowerCase()
    const cats = data.state.categories
    if (!q) return cats
    return cats.filter((c) => c.name.toLowerCase().includes(q))
  })

  return (
    <Show when={ui.state.catPickerOpen}>
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
      >
        <box
          border
          borderStyle="rounded"
          borderColor={theme.accent}
          backgroundColor={theme.mantle}
          padding={1}
          width={48}
          flexDirection="column"
        >
          <text fg={theme.accent}>
            <b>Quick Categorize</b>
          </text>
          <text fg={theme.overlay1}>
            Filter: {ui.state.catPickerQuery || "(type to filter)"}
          </text>
          <For each={filtered()}>
            {(c, i) => {
              const sel = () => i() === ui.state.catPickerCursor
              return (
                <text
                  fg={sel() ? theme.base : c.color}
                  bg={sel() ? theme.accent : undefined}
                >
                  {sel() ? "> " : "  "}
                  {c.name}
                </text>
              )
            }}
          </For>
          <text fg={theme.overlay1}>j/k move  enter apply  esc cancel</text>
        </box>
      </box>
    </Show>
  )
}
