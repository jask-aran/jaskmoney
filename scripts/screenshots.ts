/**
 * The README's screenshots (scripts/cast.ts): the demo (`--demo`, made-up
 * data), one per tab, drawn as the recordings are.
 *
 *   bun run screenshots [binary]      (default: dist/jaskmoney, built first)
 *
 * Writes docs/screenshots/*.png.
 */
import { appBinary, draw, startApp } from "./cast"

/** Each shot: the key that brings it up, and its file. */
const SHOTS = [
  { file: "transactions.png", key: "2" },
  { file: "budgets.png", key: "3" },
  { file: "settings.png", key: "4" },
]

const app = startApp(appBinary(), ["--demo"])
const taken: number[] = []
try {
  // The app starts, loads the demo and draws its charts in.
  await app.waitFor("Demo mode")
  await Bun.sleep(2000)
  for (const shot of SHOTS) {
    app.press(shot.key)
    await Bun.sleep(2000)
    taken.push(app.now())
  }
} finally {
  app.close()
}
await Promise.all(SHOTS.map((shot, i) => draw(app.cast(taken[i]! - 1, taken[i]!), 20, { png: `docs/screenshots/${shot.file}` }).then(() => console.log(`docs/screenshots/${shot.file}`))))
