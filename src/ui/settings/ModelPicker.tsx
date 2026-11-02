import { Show } from "solid-js"
import { LLM_PROVIDERS } from "../../ai/llm"
import { modelItems } from "../../app/modelPicker"
import { ui } from "../../state/uiStore"
import { ListPicker } from "../primitives/ListPicker"

/** Choosing the general model (app/modelPicker): the provider's models from
 * pi-ai's catalog, recommended and in use marked, each with its price and context. */
export function ModelPicker() {
  return (
    <Show when={ui.state.modelPicker}>
      {(picker: () => NonNullable<typeof ui.state.modelPicker>) => (
        <ListPicker
          title="Model"
          subtitle={`${LLM_PROVIDERS[picker().provider].label} · writes rules`}
          items={modelItems(picker().provider, picker().query)}
          cursor={picker().cursor}
          query={picker().query}
          width={96}
          hints="type to filter · ↑↓ move · enter use it · esc leave it"
        />
      )}
    </Show>
  )
}
