import { plugin, type PluginBuilder } from "bun"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const VERSION = [
  JSON.parse(readFileSync(require.resolve("@opentui/solid/package.json"), "utf8")).version,
  JSON.parse(readFileSync(require.resolve("babel-preset-solid/package.json"), "utf8")).version,
].join("+")
const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "jaskmoney", "jsx")
mkdirSync(dir, { recursive: true })

const inner = createSolidTransformPlugin()
plugin({
  name: "jaskmoney-solid-cache",
  setup(build) {
    inner.setup({
      ...build,
      onLoad: (options, load) => build.onLoad(options, async (args) => {
        if (args.path.includes("/node_modules/")) return load(args)
        let source: string
        try { source = readFileSync(args.path.replace(/[?#].*$/, ""), "utf8") } catch { return load(args) }
        const file = join(dir, `${Bun.hash(`${VERSION}\0${args.path}\0${source}`).toString(36)}.js`)
        try { return { contents: readFileSync(file, "utf8"), loader: "js" } } catch {}
        const result = await load(args)
        if (result && "contents" in result && typeof result.contents === "string") {
          try {
            const temp = `${file}.${process.pid}.tmp`
            writeFileSync(temp, result.contents)
            renameSync(temp, file)
          } catch {}
        }
        return result
      }),
    } as PluginBuilder)
  },
})
