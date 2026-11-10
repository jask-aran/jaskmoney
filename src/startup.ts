import { moveToHome } from "./storage/home"

const moved = moveToHome()
if (moved.length) console.error(`Moved to ~/.jaskmoney: ${moved.join(", ")} (the old copies are kept)`)
