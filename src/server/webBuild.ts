/**
 * The web app, bundled by this process: Bun.build from src/web/index.html
 * with Solid's DOM JSX transform (babel-preset-solid), minified, held in
 * memory and served by server/serve. Nothing is printed: the TUI may be
 * drawing on this terminal (`--serve`).
 *
 * The bundle is made on the first request for the page and again on a
 * page request after any file it was made from changes, so working on the
 * web app needs only a reload (dev restarts the TUI for everything else).
 *
 * The bundle is also an installable app: a version (a hash of what it's made of), a manifest, its icons and
 * a service worker (web/sw.js, told the version and the files to keep). The installed app updates when told
 * to (web/pwa.ts); see sw.js.
 */
import { statSync } from "node:fs"
import { join, resolve } from "node:path"
import type { BunPlugin } from "bun"

const WEB = resolve(import.meta.dir, "../web")
const ENTRY = join(WEB, "index.html")
const WORKER = join(WEB, "sw.js")
const ICONS = join(WEB, "icons")

/** The app's .tsx under src/web, through Babel: Solid's DOM output, then TypeScript stripped. */
const solidDom: BunPlugin = {
  name: "jaskmoney-web-solid",
  setup(build) {
    build.onLoad({ filter: /\/src\/web\/.*\.tsx$/ }, async (args) => {
      const [{ transformAsync }, solid, ts] = await Promise.all([
        // @ts-expect-error untyped
        import("@babel/core") as Promise<{ transformAsync: (code: string, options: object) => Promise<{ code?: string } | null> }>,
        // @ts-expect-error untyped preset
        import("babel-preset-solid"),
        // @ts-expect-error untyped preset
        import("@babel/preset-typescript"),
      ])
      const source = await Bun.file(args.path).text()
      const out = await transformAsync(source, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        presets: [[solid.default, { generate: "dom" }], [ts.default, { isTSX: true, allExtensions: true }]],
      })
      return { contents: out?.code ?? source, loader: "js" }
    })
  },
}

/** The library's stylesheets name the phone and wide layouts as custom media
 * (src/web/v2/queries.ts has the queries); CSS has no such thing yet, so
 * they're written out, as Conduit's build does. */
const customMedia: BunPlugin = {
  name: "jaskmoney-web-custom-media",
  setup(build) {
    build.onLoad({ filter: /\/src\/web\/.*\.css$/ }, async (args) => {
      const { NON_PHONE_LAYOUT_QUERY, PHONE_LAYOUT_QUERY } = await import("../web/v2/queries")
      const source = await Bun.file(args.path).text()
      return {
        contents: source.replaceAll("@media (--conduit-phone-layout)", `@media ${PHONE_LAYOUT_QUERY}`).replaceAll("@media (--conduit-wide-layout)", `@media ${NON_PHONE_LAYOUT_QUERY}`),
        loader: "css",
      }
    })
  },
}

export interface WebFile { body: Uint8Array; type: string }
export interface WebBundle { files: Map<string, WebFile>; inputs: Map<string, number>; error: string | null; version?: string }

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
}

/** The app as a home screen app: its name, colours (the TUI's canvas), standalone, its icons. */
const MANIFEST = {
  name: "jaskmoney",
  short_name: "jaskmoney",
  // The installed app's address: its page is the one the worker keeps (web/sw.js).
  start_url: "/?app",
  scope: "/",
  display: "standalone",
  background_color: "#11111b",
  theme_color: "#11111b",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
}
const ICON_FILES = ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]

/** What the page's head says of the app: its build, the manifest, the icons. */
const head = (version: string, built: string) => [
  `<meta name="jaskmoney-build" content="${version}" data-built="${built}">`,
  `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">`,
  `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">`,
  `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`,
].join("")

/** Files the browser must ask for fresh each time (the rest are named by their hash). */
export const FRESH = new Set(["/", "/sw.js", "/manifest.webmanifest", ...ICON_FILES.map((name) => `/${name}`)])

/** Every source file the bundle was made from, with its modification time. */
async function inputsOf(metafile: { inputs: Record<string, unknown> } | undefined): Promise<Map<string, number>> {
  const inputs = new Map<string, number>()
  for (const path of Object.keys(metafile?.inputs ?? {})) {
    if (path.includes("node_modules")) continue
    const full = resolve(path)
    try { inputs.set(full, statSync(full).mtimeMs) } catch { /* virtual */ }
  }
  inputs.set(ENTRY, statSync(ENTRY).mtimeMs)
  return inputs
}

export async function buildWeb(): Promise<WebBundle> {
  try {
    const result = await Bun.build({
      entrypoints: [ENTRY],
      target: "browser",
      minify: true,
      metafile: true,
      plugins: [solidDom, customMedia],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      throw: false,
    } as Parameters<typeof Bun.build>[0])
    if (!result.success) {
      // No inputs: a failed build is made again on the next page request.
      return { files: new Map(), inputs: new Map(), error: result.logs.map((log) => String(log)).join("\n") }
    }
    const files = new Map<string, WebFile>()
    for (const output of result.outputs) {
      const path = "/" + output.path.replace(/^\.?\//, "")
      const ext = path.slice(path.lastIndexOf("."))
      files.set(path === "/index.html" ? "/" : path, { body: new Uint8Array(await output.arrayBuffer()), type: TYPES[ext] ?? output.type })
    }
    const encode = (text: string, type: string): WebFile => ({ body: new TextEncoder().encode(text), type })
    for (const name of ICON_FILES) files.set(`/${name}`, { body: new Uint8Array(await Bun.file(join(ICONS, name)).arrayBuffer()), type: TYPES[".png"]! })
    // The version: what the app is made of (the page as built, before it names its own version, and every file).
    const hasher = new Bun.CryptoHasher("sha256")
    for (const [path, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) { hasher.update(path); hasher.update(file.body) }
    const worker = await Bun.file(WORKER).text()
    hasher.update(worker)
    const version = hasher.digest("hex").slice(0, 10)
    const built = new Date().toISOString()
    const page = new TextDecoder().decode(files.get("/")!.body).replace("</head>", `${head(version, built)}</head>`)
    files.set("/", encode(page, TYPES[".html"]!))
    files.set("/manifest.webmanifest", encode(JSON.stringify(MANIFEST), TYPES[".webmanifest"]!))
    const keep = [...files.keys()].filter((path) => path !== "/sw.js" && path !== "/manifest.webmanifest" && !path.endsWith(".map"))
    files.set("/sw.js", encode(`const BUILD = ${JSON.stringify({ version, built, files: keep })};\n${worker}`, TYPES[".js"]!))
    const inputs = await inputsOf((result as unknown as { metafile?: { inputs: Record<string, unknown> } }).metafile)
    inputs.set(WORKER, statSync(WORKER).mtimeMs)
    for (const name of ICON_FILES) inputs.set(join(ICONS, name), statSync(join(ICONS, name)).mtimeMs)
    return { files, inputs, error: null, version }
  } catch (error) {
    return { files: new Map(), inputs: new Map(), error: error instanceof Error ? error.stack ?? error.message : String(error) }
  }
}

/** Whether a file the bundle was made from has changed since. */
export function stale(bundle: WebBundle): boolean {
  if (!bundle.inputs.size) return true
  for (const [path, mtime] of bundle.inputs) {
    try { if (statSync(path).mtimeMs !== mtime) return true } catch { return true }
  }
  return false
}

/** One bundle at a time, remade on a page request when stale. */
export function webBundler() {
  let current: Promise<WebBundle> | null = null
  return {
    get(page: boolean): Promise<WebBundle> {
      if (!current) current = buildWeb()
      else if (page) current = current.then((bundle) => (stale(bundle) ? buildWeb() : bundle))
      return current
    },
  }
}
