import { watch } from "node:fs"

const start = () => Bun.spawn(["bun", "run", "src/index.tsx", ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"] })

let app = start()
let restarting = false
let timer: ReturnType<typeof setTimeout> | undefined

async function restart() {
  if (restarting) return
  restarting = true
  app.kill("SIGTERM")
  await app.exited
  app = start()
  restarting = false
  void follow(app)
}

async function follow(running: typeof app) {
  const code = await running.exited
  if (!restarting && running === app) process.exit(code)
}
void follow(app)

process.on("SIGINT", () => {})

watch("src", { recursive: true }, (_, name) => {
  if (!name || !/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return
  clearTimeout(timer)
  timer = setTimeout(() => void restart(), 150)
})
