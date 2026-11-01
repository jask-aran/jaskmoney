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

// The binary embeds the Bun that builds it, and the pinned one matters:
// Bun 1.4 binds OpenTUI's ~300 native functions in ~1 ms where 1.3 took
// ~100 (first frame ~410 → ~180 ms).
const pinned = (await Bun.file(new URL("../package.json", import.meta.url)).json()).engines.bun as string
if (Bun.version !== pinned) {
  console.error(`Build with Bun ${pinned} (package.json engines), not ${Bun.version}.`)
  process.exit(1)
}

const outfile = process.argv[2] ?? "dist/jaskmoney"
const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  // Solid's browser build: its server build has no reactivity.
  conditions: ["browser"],
  plugins: [solidPlugin],
  // Production: without it, Bun.build resolves Solid's development build
  // (dist/dev.js, with its checks and warnings), as `bun run` doesn't.
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  // Precompiled to bytecode, as opencode ships: nothing is parsed at start
  // (first frame ~540 → ~400 ms; the binary grows ~40 MB).
  bytecode: true,
  format: "esm",
  sourcemap: "linked",
  compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`Built ${outfile}`)
