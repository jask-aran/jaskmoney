/**
 * `bun run dev`: the app, restarted whenever a source file changes.
 *
 * Bun's own --watch can't do this: .tsx files load through the Solid
 * transform plugin (src/jsxCache.ts), and Bun doesn't watch files a plugin
 * loads, so it only ever restarted for .ts edits. This watches src itself.
 * The app restores the terminal on SIGTERM (OpenTUI's exit signals), so a
 * restart is: stop it, wait for it to exit, start it again.
 */
import { watch } from "node:fs"

// Flags go through to the app (`bun run dev -- --serve`).
const start = () => Bun.spawn(["bun", "run", "src/index.tsx", ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"] })

let app = start()
let restarting = false
let timer: ReturnType<typeof setTimeout> | undefined

async function restart() {
  // A change while the app is stopping: the start below loads it anyway.
  if (restarting) return
  restarting = true
  app.kill("SIGTERM")
  await app.exited
  app = start()
  restarting = false
  void follow(app)
}

// Quitting the app (q, ctrl+c) ends dev too; a restart's exit doesn't.
async function follow(running: typeof app) {
  const code = await running.exited
  if (!restarting && running === app) process.exit(code)
}
void follow(app)

// Ctrl+C reaches the app as well (same process group); let it clean up and
// exit, and leave with it.
process.on("SIGINT", () => {})

watch("src", { recursive: true }, (_, name) => {
  if (!name || !/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return
  // The web app isn't the TUI: a reload rebuilds it (server/webBuild).
  if (name.startsWith("web/")) return
  // An editor's save can be several writes: restart once they settle.
  clearTimeout(timer)
  timer = setTimeout(() => void restart(), 150)
})
