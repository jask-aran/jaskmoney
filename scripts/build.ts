/**
 * A standalone binary: `bun run build` → dist/jaskmoney (this machine's
 * platform). OpenTUI's Solid plugin compiles the JSX, as the dev preload
 * does; the native renderer (libopentui.so) is a file import Bun embeds.
 * At run time the binary reads .env from the directory it's started in
 * (keys saved in Settings live beside settings.json and work anywhere).
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
  compile: { outfile },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`Built ${outfile}`)
