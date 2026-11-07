/**
 * Size budgets: the app and its tests can't keep growing. Each limit is
 * about 20% over the size on 2026-11-08 (scripts/sizeBudget.ts); going
 * past one fails `bun run lint` (and with it `test` and `typecheck`).
 *
 * The limits are not to be raised to make room. Going past one means
 * cutting: say so to the owner and plan the cut.
 *
 *   bun run lint            check the budgets
 *   bun run lint --measure  print the sizes now (to set a new baseline)
 */
import { BUDGET, FILE_LINES, FROZEN_FILES, MAX_DEPENDENCIES } from "./sizeBudget"

const CODE = /\.(ts|tsx|js|jsx|css)$/
const TEST = /\.test\.(ts|tsx)$/
const TEST_CALL = /^\s*(test|it)(\.\w+)?\s*\(/gm

const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts"]).stdout.toString()
const files = listed.split("\n").filter((f) => CODE.test(f) && Bun.file(f).size >= 0)

interface Size { files: number; lines: number; chars: number }
const empty = (): Size => ({ files: 0, lines: 0, chars: 0 })
const source = empty(), tests = empty()
let testCount = 0
const lengths: Array<[string, number]> = []
for (const path of files) {
  const file = Bun.file(path)
  if (!(await file.exists())) continue
  const text = await file.text()
  // Lines of code: the non-blank ones; characters too, so the lines
  // can't be packed to dodge the count.
  const lines = text.split("\n").filter((l) => l.trim() !== "").length
  const into = TEST.test(path) ? tests : source
  into.files++
  into.lines += lines
  into.chars += text.replace(/\s+/g, "").length
  if (TEST.test(path)) testCount += text.match(TEST_CALL)?.length ?? 0
  lengths.push([path, lines])
}
const pkg = await Bun.file("package.json").json()
const dependencies = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length

if (process.argv.includes("--measure")) {
  console.log({ testCount, tests, source, dependencies })
  console.log(lengths.filter(([, n]) => n > FILE_LINES).sort((a, b) => b[1] - a[1]))
  process.exit(0)
}

const STOP = "STOP and tell the owner: the codebase is over its size budget, and we need to do work to cut it down before going on. Do not raise the limit in scripts/sizeBudget.ts to make room."
const errors: string[] = []
const over = (what: string, now: number, limit: number, cut: string) => {
  if (now > limit) errors.push(`${what}: ${now.toLocaleString()} is over the limit of ${limit.toLocaleString()}. ${cut}`)
}
over("Tests", testCount, BUDGET.testCount, "Cut tests: merge duplicates, drop layout, wording and timing tests.")
over("Test lines", tests.lines, BUDGET.testLines, "Cut tests.")
over("Test characters", tests.chars, BUDGET.testChars, "Cut tests.")
over("Source lines", source.lines, BUDGET.sourceLines, "Cut code: delete what's unused, fold duplication into shared pieces.")
over("Source characters", source.chars, BUDGET.sourceChars, "Cut code.")
over("Source files", source.files, BUDGET.sourceFiles, "Merge or delete files.")
over("Test files", tests.files, BUDGET.testFiles, "Merge or delete test files.")
over("Dependencies", dependencies, MAX_DEPENDENCIES, "Remove a dependency before adding one.")
// Any file: at most FILE_LINES lines; the files already past it may not grow.
for (const [path, lines] of lengths) {
  const limit = FROZEN_FILES[path] ?? FILE_LINES
  if (lines > limit) errors.push(`${path}: ${lines} lines is over its limit of ${limit}. Split it or cut it${FROZEN_FILES[path] ? " (it's already past the usual limit and may only shrink)" : ""}.`)
}

if (errors.length) {
  console.error(`Size budget exceeded:\n${errors.map((e) => `  - ${e}`).join("\n")}\n\n${STOP}`)
  process.exit(1)
}
console.log(`Size budget ok: ${testCount}/${BUDGET.testCount} tests, ${tests.lines}/${BUDGET.testLines} test lines, ${source.lines}/${BUDGET.sourceLines} source lines`)
