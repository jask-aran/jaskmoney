

/** Let work a key started (a call to the core) finish before checking what it did. */
export async function settlePending(): Promise<void> { await Bun.sleep(0) }

export { keyEvent as key } from "../app/keyEvent"
