import { moveToHome } from "./storage/home"

/** Before anything else loads (index.tsx imports this first): user data
 * from the old places into ~/.jaskmoney, once. */
const moved = moveToHome()
if (moved.length) console.error(`Moved to ~/.jaskmoney: ${moved.join(", ")} (the old copies are kept)`)
