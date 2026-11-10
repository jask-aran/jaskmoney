/**
 * The size budget: the app and its tests can't keep growing. The limits
 * (scripts/sizeBudget.json) are about 20% over the sizes on 2026-11-08,
 * after the tests were cut to a third. Lines are non-blank lines;
 * characters non-whitespace ones (so lines can't be packed to dodge the
 * counts). `bun run lint` runs it (and `typecheck` and `test` first).
 *
 * The rules:
 *   1. Totals: tests (count, files, lines, characters), source (files,
 *      lines, characters), dependencies.
 *   2. Areas: each folder under src/ (and scripts/) has its own lines.
 *   3. Files: at most `fileLines` lines; the files past it then are held
 *      at about their size (frozenFiles) and may only shrink.
 *   4. Functions: at most `functionLines` lines; the same for the ones
 *      past it (frozenFunctions).
 *   5. Unused exports: an export nothing else names is dead (or should be
 *      local). At most `unusedExports` of them (the count then): it may
 *      only fall.
 *   6. Repeated code: runs of WINDOW lines that appear twice or more. At
 *      most `repeats` of them (the count then): it may only fall.
 *   7. Layout: no folder under src/ beyond `areas`'.
 *   8. Ratchet: a limit more than 30% above its size is lowered to 20%
 *      above it (the two counts: to what's left), and a held file or
 *      function to its size (`--ratchet` writes the file): what's cut
 *      stays cut. Until it's run, the lint fails.
 *
 * Over a limit: stop, and tell the owner the codebase needs cutting.
 * Never raise a limit to make room.
 *
 *   bun run lint             check
 *   bun run lint --report    the refactoring targets: biggest files and
 *                            functions, repeated code, unused exports
 *   bun run lint --ratchet   lower the limits that have room to spare
 */
import ts from "typescript"

const BUDGET_PATH = "scripts/sizeBudget.json"
interface Budget {
  tests: { count: number; files: number; lines: number; chars: number }
  source: { files: number; lines: number; chars: number }
  dependencies: number
  areas: Record<string, number>
  fileLines: number
  frozenFiles: Record<string, number>
  functionLines: number
  frozenFunctions: Record<string, number>
  unusedExports: number
  repeats: number
}
const budget: Budget = await Bun.file(BUDGET_PATH).json()

const CODE = /\.(ts|tsx|js|jsx|css)$/
const TEST = /\.test\.(ts|tsx)$/
const TS = /\.(ts|tsx)$/
const TEST_CALL = /^\s*(test|it)(\.\w+)?\s*\(/gm
/** Files run directly, not imported: their exports need no importer. */
const ENTRY = /^(scripts\/|src\/index\.tsx$|src\/cli\.ts$|src\/server\/main\.ts$|src\/bench\/|src\/eval\/(run|search)\.ts$|src\/testSetup\.ts$)/
/** Lines in a repeated run. */
const WINDOW = 8
const RATCHET_SLACK = 1.3
const HEADROOM = 1.2

const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts"]).stdout.toString()
const paths = listed.split("\n").filter((f) => CODE.test(f))
const texts = new Map<string, string>()
for (const path of paths) {
  const file = Bun.file(path)
  if (await file.exists()) texts.set(path, await file.text())
}

const nonBlank = (text: string) => text.split("\n").filter((l) => l.trim() !== "").length
const areaOf = (path: string) => (path.startsWith("scripts/") ? "scripts" : path.split("/").length > 2 ? `src/${path.split("/")[1]}` : "src")

// 1–3: totals, areas, files.
const tests = { count: 0, files: 0, lines: 0, chars: 0 }
const source = { files: 0, lines: 0, chars: 0 }
const areas: Record<string, number> = {}
const fileLines: Array<[string, number]> = []
for (const [path, text] of texts) {
  const lines = nonBlank(text)
  const chars = text.replace(/\s+/g, "").length
  if (TEST.test(path)) {
    tests.files++; tests.lines += lines; tests.chars += chars
    tests.count += text.match(TEST_CALL)?.length ?? 0
  } else {
    source.files++; source.lines += lines; source.chars += chars
    areas[areaOf(path)] = (areas[areaOf(path)] ?? 0) + lines
  }
  fileLines.push([path, lines])
}
const pkg = await Bun.file("package.json").json()
const dependencies = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length

// 4–5: functions and exports, from the syntax tree.
const functions: Array<[string, number]> = []
const exported = new Map<string, Set<string>>()
for (const [path, text] of texts) {
  if (!TS.test(path)) continue
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const names = new Set<string>()
  const nameOf = (node: ts.Node): string | undefined => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText(file)
    const parent = node.parent
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
    if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(file)
    return undefined
  }
  const visit = (node: ts.Node) => {
    if (!TEST.test(path) && (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) && node.body) {
      const name = nameOf(node)
      if (name) functions.push([`${path}:${name}`, nonBlank(node.getText(file))])
    }
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && !modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (ts.isVariableStatement(node)) for (const d of node.declarationList.declarations) { if (ts.isIdentifier(d.name)) names.add(d.name.text) }
      else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) names.add(node.name.text)
    }
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) for (const e of node.exportClause.elements) names.add(e.name.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  exported.set(path, names)
}
// An export is used when another file names it (an import, a re-export).
const words = new Map<string, number>()
for (const text of texts.values()) for (const w of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])) words.set(w, (words.get(w) ?? 0) + 1)
const unused: string[] = []
for (const [path, names] of exported) {
  if (ENTRY.test(path) || TEST.test(path)) continue
  const own = new Set(texts.get(path)!.match(/[A-Za-z_$][\w$]*/g) ?? [])
  for (const name of names) if ((words.get(name) ?? 0) - (own.has(name) ? 1 : 0) <= 0) unused.push(`${path}: ${name}`)
}

// 6: repeated code. Each run of WINDOW significant lines (trimmed, past
// imports, comments and closers), wherever it appears twice or more.
const runs = new Map<string, string[]>()
for (const [path, text] of texts) {
  if (TEST.test(path)) continue
  const lines = text.split("\n").map((l, i) => [l.trim().replace(/\s+/g, " "), i + 1] as const)
    .filter(([l]) => l.length >= 12 && !/^(import |export \{|\/\/|\*|\/\*)/.test(l))
  for (let i = 0; i + WINDOW <= lines.length; i++) {
    const key = lines.slice(i, i + WINDOW).map(([l]) => l).join("\n")
    const at = `${path}:${lines[i]![1]}`
    runs.set(key, [...(runs.get(key) ?? []), at])
  }
}
const repeated = [...runs.values()].filter((at) => at.length > 1)
const repeats = repeated.length

// 7: layout.
const folders = new Set(Object.keys(areas))

if (process.argv.includes("--measure")) {
  // The sizes now, as a budget would hold them (to set a baseline).
  console.log(JSON.stringify({ tests, source, dependencies, areas, unused: unused.length, repeats,
    files: Object.fromEntries(fileLines.filter(([, n]) => n > budget.fileLines)),
    functions: Object.fromEntries(functions.filter(([, n]) => n > budget.functionLines)) }))
  process.exit(0)
}
const report = process.argv.includes("--report")
const ratchet = process.argv.includes("--ratchet")
const errors: string[] = []
const lower: string[] = []
// `strict`: a count that may only fall (unused exports, repeats): it's
// lowered to what's left, not to 20% over it.
const check = (what: string, now: number, limit: number, cut: string, set?: (n: number) => void, strict = false) => {
  const to = strict ? now : Math.ceil(now * HEADROOM)
  if (now > limit) errors.push(`${what}: ${now.toLocaleString()} is over its limit of ${limit.toLocaleString()}. ${cut}`)
  else if (set && limit > (strict ? Math.ceil(now * 1.1) : Math.ceil(now * RATCHET_SLACK))) { lower.push(`${what}: ${limit.toLocaleString()} → ${to.toLocaleString()}`); if (ratchet) set(to) }
}
const CUT_TESTS = "Cut tests: merge duplicates, drop layout, wording and timing tests."
check("Tests", tests.count, budget.tests.count, CUT_TESTS, (n) => (budget.tests.count = n))
check("Test files", tests.files, budget.tests.files, CUT_TESTS, (n) => (budget.tests.files = n))
check("Test lines", tests.lines, budget.tests.lines, CUT_TESTS, (n) => (budget.tests.lines = n))
check("Test characters", tests.chars, budget.tests.chars, CUT_TESTS, (n) => (budget.tests.chars = n))
check("Source files", source.files, budget.source.files, "Merge or delete files.", (n) => (budget.source.files = n))
check("Source lines", source.lines, budget.source.lines, "Cut code: delete what's unused, fold repeats into shared pieces.", (n) => (budget.source.lines = n))
check("Source characters", source.chars, budget.source.chars, "Cut code.", (n) => (budget.source.chars = n))
check("Dependencies", dependencies, budget.dependencies, "Remove a dependency before adding one.")
for (const [area, lines] of Object.entries(areas)) {
  if (!(area in budget.areas)) { errors.push(`${area}: a new folder. The layout is fixed (sizeBudget.json areas): put the code in an existing folder.`); continue }
  check(`${area} lines`, lines, budget.areas[area]!, `Cut code in ${area}.`, (n) => (budget.areas[area] = n))
}
for (const area of Object.keys(budget.areas)) if (!folders.has(area) && ratchet) delete budget.areas[area]
// Files and functions past the usual limit are held where they were; one
// that's shrunk is held lower, and one back under it loses its entry.
const held = (kind: string, sizes: Array<[string, number]>, usual: number, frozen: Record<string, number>, cut: string) => {
  for (const [id, lines] of sizes) {
    const limit = frozen[id] ?? usual
    if (lines > limit) errors.push(`${id}: ${lines} lines is over its limit of ${limit}. ${cut}${frozen[id] ? ` (already past the usual ${usual}: it may only shrink)` : ""}`)
    else if (frozen[id] && lines <= usual) { lower.push(`${id}: back under ${usual}, its ${kind} entry goes`); if (ratchet) delete frozen[id] }
    else if (frozen[id] && frozen[id] > roundUp(lines) + 10) { lower.push(`${id}: ${frozen[id]} → ${roundUp(lines)}`); if (ratchet) frozen[id] = roundUp(lines) }
  }
  const present = new Set(sizes.map(([id]) => id))
  for (const id of Object.keys(frozen)) if (!present.has(id)) { lower.push(`${id}: gone, its ${kind} entry goes`); if (ratchet) delete frozen[id] }
}
held("file", fileLines, budget.fileLines, budget.frozenFiles, "Split it or cut it.")
held("function", functions, budget.functionLines, budget.frozenFunctions, "Split it into smaller pieces.")
check("Unused exports", unused.length, budget.unusedExports, "Delete them, or make them local.", (n) => (budget.unusedExports = n), true)
check("Repeated code", repeats, budget.repeats, "Fold the repeats (`bun run lint --report`) into shared pieces.", (n) => (budget.repeats = n), true)

if (report) {
  const top = <T,>(list: T[], n: number) => list.slice(0, n)
  console.log("Biggest files (lines):")
  for (const [p, n] of top([...fileLines].sort((a, b) => b[1] - a[1]), 20)) console.log(`  ${String(n).padStart(5)}  ${p}`)
  console.log("\nLongest functions (lines):")
  for (const [p, n] of top([...functions].sort((a, b) => b[1] - a[1]), 30)) console.log(`  ${String(n).padStart(5)}  ${p}`)
  console.log("\nLines by area:")
  for (const [a, n] of Object.entries(areas).sort((x, y) => y[1] - x[1])) console.log(`  ${String(n).padStart(6)}  ${a}`)
  // Repeats grouped by the files they join, the biggest groups first.
  const byFiles = new Map<string, { windows: number; at: string[] }>()
  for (const at of repeated) {
    const key = [...new Set(at.map((a) => a.replace(/:\d+$/, "")))].sort().join(" + ")
    const g = byFiles.get(key) ?? { windows: 0, at: [] }
    g.windows++
    if (g.at.length < 4) g.at.push(at.join(", "))
    byFiles.set(key, g)
  }
  console.log(`\nRepeated code: ${repeats} runs of ${WINDOW} lines, by the files they're in:`)
  for (const [files, g] of top([...byFiles].sort((a, b) => b[1].windows - a[1].windows), 25)) console.log(`  ${String(g.windows).padStart(4)}  ${files}\n          e.g. ${g.at[0]}`)
  console.log(`\nUnused exports (${unused.length}):`)
  for (const u of unused) console.log(`  ${u}`)
  console.log("")
}

if (ratchet && lower.length) {
  await Bun.write(BUDGET_PATH, JSON.stringify(budget, null, 2) + "\n")
  console.log(`Lowered:\n${lower.map((l) => `  - ${l}`).join("\n")}`)
}
if (errors.length) {
  console.error(`Size budget exceeded:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\nSTOP and tell the owner: the codebase is over its size budget, and we need to do work to cut it down before going on. Do not raise a limit in ${BUDGET_PATH} to make room.`)
  process.exit(1)
}
if (lower.length && !ratchet) {
  console.error(`Limits with room to spare (what was cut must stay cut):\n${lower.map((l) => `  - ${l}`).join("\n")}\n\nRun \`bun run lint --ratchet\` to lower them, and commit ${BUDGET_PATH}.`)
  process.exit(1)
}
console.log(`Size budget ok: ${tests.count}/${budget.tests.count} tests, ${tests.lines}/${budget.tests.lines} test lines, ${source.lines}/${budget.source.lines} source lines, ${unused.length}/${budget.unusedExports} unused exports, ${repeats}/${budget.repeats} repeats`)

function roundUp(n: number): number { return Math.ceil(n / 10) * 10 }
