import { createSignal } from "solid-js"
import { openBrowser } from "./llmSignIn"

type Serving = { page: string; clients: number }
const [serving, setServing] = createSignal<Serving | null>(null)

/** Replace open in tests, as with executorSource.sources. */
export const web = { open: openBrowser as (url: string) => void, serving, setServing: (value: Serving | null) => { setServing(value) } }
export const webLabel = (value: Serving | null): string => value == null ? "" : value.clients >= 1 ? `${value.clients} web client${value.clients === 1 ? "" : "s"}` : "web app"
