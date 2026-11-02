/**
 * The README's screenshots: the built app's demo (`--demo`, made-up data)
 * in a real terminal (scripts/terminal.ts), one per tab, cropped to the
 * terminal.
 *
 *   bun run screenshots [binary]      (default: dist/jaskmoney, built first)
 *
 * Writes docs/screenshots/*.png.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { appBinary, openTerminal } from "./terminal"

/** Each shot: the key that brings it up, and its file. */
const SHOTS = [
  { file: "transactions.png", keys: "2" },
  { file: "budgets.png", keys: "3" },
  { file: "settings.png", keys: "4" },
]

const term = await openTerminal(appBinary(), ["--demo"])
try {
  // The app starts, loads the demo and draws its charts in.
  await Bun.sleep(6000)
  for (const shot of SHOTS) {
    await term.type(shot.keys)
    await Bun.sleep(2500)
    const box = await term.screen()
    const { data } = await term.send("Page.captureScreenshot", { format: "png", clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } })
    writeFileSync(join("docs/screenshots", shot.file), Buffer.from(data, "base64"))
    console.log(`docs/screenshots/${shot.file}`)
  }
} finally {
  await term.close()
}
