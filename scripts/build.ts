/**
 * A standalone binary: `bun run build` → dist/jaskmoney (this machine's
 * platform). OpenTUI's Solid plugin compiles the JSX, as the dev preload
 * does; the native renderer (libopentui.so) is a file import Bun embeds.
 * The binary behaves the same wherever it's started: it doesn't read the
 * bunfig.toml or .env of its working directory (the repo's bunfig preloads
 * the dev JSX transform, which a binary can't load). Keys and data come from
 * ~/.jaskmoney.
 */
import solidPlugin from "@opentui/solid/bun-plugin"

const outfile = process.argv[2] ?? "dist/jaskmoney"
const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  // Solid's browser build: its server build has no reactivity.
  conditions: ["browser"],
  plugins: [solidPlugin],
  minify: true,
  sourcemap: "linked",
  compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`Built ${outfile}`)
