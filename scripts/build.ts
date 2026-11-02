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
// The tested Bun (package.json engines) or newer; newer builds with a note.
const pinned = (await Bun.file(new URL("../package.json", import.meta.url)).json()).engines.bun as string
if (Bun.semver.order(Bun.version, pinned) < 0) {
  console.error(`Jaskmoney builds with Bun ${pinned} or newer; this is ${Bun.version}. Run \`bun upgrade\`.`)
  process.exit(1)
}
if (Bun.version !== pinned) console.warn(`Building with Bun ${Bun.version}; ${pinned} is the tested version.`)

// `bun run build [outfile] [--install]`: --install also puts the binary on
// your PATH as ~/.local/bin/jaskmoney (or $JASKMONEY_BIN/jaskmoney).
const args = process.argv.slice(2)
const install = args.includes("--install")
const outfile = args.find((a) => !a.startsWith("--")) ?? "dist/jaskmoney"
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

if (install) {
  const { copyFileSync, chmodSync, mkdirSync, renameSync } = await import("node:fs")
  const { join, delimiter } = await import("node:path")
  const bin = process.env.JASKMONEY_BIN ?? join(process.env.HOME ?? "", ".local", "bin")
  const target = join(bin, "jaskmoney")
  mkdirSync(bin, { recursive: true })
  // Beside it, then renamed over it: a running jaskmoney keeps its file.
  copyFileSync(outfile, `${target}.new`)
  chmodSync(`${target}.new`, 0o755)
  renameSync(`${target}.new`, target)
  console.log(`Installed ${target}`)
  const onPath = (process.env.PATH ?? "").split(delimiter).includes(bin)
  console.log(onPath ? "Run: jaskmoney" : `${bin} isn't on your PATH: add it (e.g. echo 'export PATH="${bin}:$PATH"' >> ~/.zshrc), then run: jaskmoney`)
}
