/**
 * How a client reaches the core: in the same process (localLink, the TUI)
 * or over a WebSocket (wsLink, the web app; the TUI with --connect). Both
 * keep core/protocol's promise: a call's state patches arrive before its
 * result.
 */
import type { Models } from "@earendil-works/pi-ai"
import type { JevClient } from "../ai/jev"
import type { Llm } from "../ai/llm"
import type { CoreMethod, CoreParams, CoreResult, CoreState, ProgressOf } from "../core/protocol"

export interface CallOptions<M extends CoreMethod> {
  onProgress?: (data: ProgressOf<M>) => void
  signal?: AbortSignal
  /** In-process links only (tests): stand-ins for Jev and the general model. */
  ai?: Pick<JevClient, "judge">
  llm?: Llm
  models?: Pick<Models, "login">
}

export interface CoreLink {
  call<M extends CoreMethod>(method: M, params: CoreParams<M>, options?: CallOptions<M>): Promise<CoreResult<M>>
  /** Hear every state patch, the first being the whole state. Returns the
   * unsubscribe. */
  subscribe(listener: (patch: Partial<CoreState>) => void): () => void
}
