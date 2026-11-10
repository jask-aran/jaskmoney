import type { Models } from "@earendil-works/pi-ai"
import type { JevClient } from "../ai/jev"
import type { Llm } from "../ai/llm"
import type { CoreMethod, CoreParams, CoreResult, CoreState, ProgressOf } from "../core/protocol"

interface CallOptions<M extends CoreMethod> {
  onProgress?: (data: ProgressOf<M>) => void
  signal?: AbortSignal
  ai?: Pick<JevClient, "judge">
  llm?: Llm
  models?: Pick<Models, "login">
}

export interface CoreLink {
  call<M extends CoreMethod>(method: M, params: CoreParams<M>, options?: CallOptions<M>): Promise<CoreResult<M>>
  subscribe(listener: (patch: Partial<CoreState>) => void): () => void
}
