import solidPlugin from "@opentui/solid/bun-plugin"

const pinned = (await Bun.file(new URL("../package.json", import.meta.url)).json()).engines.bun as string
if (Bun.semver.order(Bun.version, pinned) < 0) {
  console.error(`Jaskmoney builds with Bun ${pinned} or newer; this is ${Bun.version}. Run \`bun upgrade\`.`)
  process.exit(1)
}
if (Bun.version !== pinned) console.warn(`Building with Bun ${Bun.version}; ${pinned} is the tested version.`)

const args = process.argv.slice(2)
const install = args.includes("--install")
const outfile = args.find((a) => !a.startsWith("--")) ?? "dist/jaskmoney"
const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  target: "bun",
  conditions: ["browser"],
  plugins: [solidPlugin],
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
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
  copyFileSync(outfile, `${target}.new`)
  chmodSync(`${target}.new`, 0o755)
  renameSync(`${target}.new`, target)
  if (process.env.JASKMONEY_INSTALLER) process.exit(0)
  console.log(`Installed ${target}`)
  const onPath = (process.env.PATH ?? "").split(delimiter).includes(bin)
  console.log(onPath ? "Run: jaskmoney" : `${bin} isn't on your PATH: add it (e.g. echo 'export PATH="${bin}:$PATH"' >> ~/.zshrc), then run: jaskmoney`)
}
