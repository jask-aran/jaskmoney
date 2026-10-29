/**
 * Port of Go filter.go — lexer + recursive-descent parser + eval.
 * Permissive parse for live `/` input; strict for committed/save surfaces.
 */

import { addDays, addMonths, dayTime, parseDay } from "./days"
import { isIncome, isSpending } from "./moneyRules"

export type FilterNodeKind = "text" | "field" | "and" | "or" | "not"

export interface FilterNode {
  kind: FilterNodeKind
  field?: string
  op?: string
  value?: string
  valueLo?: string
  valueHi?: string
  children?: FilterNode[]
  grouped?: boolean
}

type TokKind =
  | "word"
  | "quoted"
  | "colon"
  | "lparen"
  | "rparen"
  | "and"
  | "or"
  | "not"
  | "eof"

interface Tok {
  kind: TokKind
  text: string
  pos: number
}

export interface FilterTxn {
  description: string
  categoryId: number | null
  categoryName: string
  categoryGroup?: string
  accountName: string
  notes: string
  amount: number
  dateISO: string
  excluded?: boolean
  income?: boolean
  tagNames: string[]
}

export interface FilterNames {
  cat: readonly string[]
  tag: readonly string[]
  acc: readonly string[]
}

interface FilterResult {
  node: FilterNode | null
  error?: string
  hints: string[]
}

// Approved deviations from legacy Go filter.go (2026-10-29): loose live
// input, full save form, name resolution and the unambiguous strict readings.
export function parseFilter(input: string, names?: FilterNames): FilterResult {
  return parseFilterWithMode(input, false, names)
}

export function parseFilterStrict(input: string): FilterResult {
  return parseFilterWithMode(input, true)
}

export function canonicalFilter(input: string, names?: FilterNames): FilterResult & { text: string } {
  const result = parseFilterWithMode(input, false, names, true)
  return { ...result, error: result.error, text: result.node ? renderCanonical(result.node) : "" }
}

function parseFilterWithMode(
  input: string,
  strict: boolean,
  names?: FilterNames,
  canonical = false,
): FilterResult {
  const hints: string[] = []
  const ambiguities: string[] = []
  if (!input.trim()) return { node: null, hints }
  try {
    const tokens = lexFilter(input)
    const p = new Parser(tokens, strict, input, hints, ambiguities)
    if (!strict) p.ignoreTrailingOperators()
    if (p.peek().kind === "eof") return { node: null, hints }
    let node = p.parseExpr()
    if (p.peek().kind !== "eof") {
      const tok = p.peek()
      throw new Error(`unexpected token ${JSON.stringify(tok.text)} at ${tok.pos + 1}`)
    }
    if (strict) validateStrictGrouping(node)
    if (names) node = resolveNames(node, names, hints, ambiguities)
    validateTop(node)
    if (canonical && ambiguities.length) throw new Error(ambiguities[0])
    return { node, hints }
  } catch (e) {
    return { node: null, error: e instanceof Error ? e.message : String(e), hints }
  }
}

function resolveNames(node: FilterNode, names: FilterNames, hints: string[], ambiguities: string[]): FilterNode {
  const field = node.field
  if (node.kind === "field" && (field === "cat" || field === "tag" || field === "acc")) {
    const value = node.value ?? ""
    const exact = names[field].find((name) => eqFold(name, value))
    if (exact !== undefined) return { ...node, value: exact }
    const needle = squash(value)
    let matches = names[field].filter((name) => squash(name).startsWith(needle))
    if (!matches.length) matches = names[field].filter((name) => squash(name).includes(needle))
    if (matches.length === 1) {
      hints.push(`${field}:${value} means ${matches[0]}`)
      return { ...node, value: matches[0] }
    }
    if (!matches.length) {
      const label = field === "cat" ? "category" : field === "acc" ? "account" : "tag"
      const message = `no ${label} matches ${value}`
      hints.push(message)
      ambiguities.push(message)
      return node
    }
    const list = `${matches.slice(0, -1).join(", ")} or ${matches.at(-1)}`
    const message = `${field}:${value} could be ${list}`
    hints.push(`${message}: finding either`)
    ambiguities.push(`${message}: write one in full`)
    return { kind: "or", grouped: node.grouped, children: matches.map((value) => ({ ...node, value })) }
  }
  return node.children ? { ...node, children: node.children.map((child) => resolveNames(child, names, hints, ambiguities)) } : node
}

export function fallbackPlainTextFilter(input: string): FilterNode | null {
  const text = input.trim()
  if (!text) return null
  return { kind: "text", op: "contains_meta", value: text }
}

export function markTextNodesAsMetadata(node: FilterNode | null): FilterNode | null {
  if (!node) return null
  if (node.kind === "text" && node.op === "contains") {
    return { ...node, op: "contains_meta" }
  }
  if (node.children) {
    return {
      ...node,
      children: node.children.map((c) => markTextNodesAsMetadata(c)!).filter(Boolean),
    }
  }
  return node
}

export function filterContainsFieldPredicate(node: FilterNode | null): boolean {
  if (!node) return false
  if (node.kind === "field") return true
  return (node.children ?? []).some(filterContainsFieldPredicate)
}

export interface FilterNote { text: string; tone: "error" | "warn" | "muted" }

/**
 * What the search bar says beside its dot: why the input doesn't parse
 * (searched as one phrase), else what saving it would refuse (with the
 * live reading of an ambiguous name: "finding either"), else, when
 * something was forgiven or guessed, the full form it reads as.
 */
export function filterNote(input: string, err: string, hints: string[], names?: FilterNames): FilterNote | null {
  if (!input.trim()) return null
  if (err) return { text: `${err}: searching it as one phrase`, tone: "error" }
  const full = canonicalFilter(input, names)
  if (full.error) {
    const live = hints.find((hint) => full.error!.startsWith(hint.replace(/: finding either$/, "")))
    return { text: live ?? full.error, tone: "warn" }
  }
  return hints.length && full.text ? { text: `→ ${full.text}`, tone: "muted" } : null
}

/** Live reparse: permissive + metadata bare words + fallback. */
export function reparseFilterInput(input: string, names?: FilterNames): {
  expr: FilterNode | null
  err: string
  hints: string[]
} {
  const { node, error, hints } = parseFilter(input, names)
  if (error) {
    return { expr: fallbackPlainTextFilter(input), err: error, hints }
  }
  if (!filterContainsFieldPredicate(node)) {
    return { expr: markTextNodesAsMetadata(node), err: "", hints }
  }
  return { expr: node, err: "", hints }
}

/** Jev's verdict on whether a row matches an `ask:` term's words; undefined
 * while it hasn't judged the row. */
export type AskVerdict<T> = (words: string, t: T) => boolean | undefined

/**
 * Whether a row passes the filter. `ask:` terms take Jev's verdicts from
 * `ask`; a row whose result hangs on a term not judged yet does not pass
 * (with no `ask` at all, as in rules, that is every such row).
 */
export function evalFilter<T extends FilterTxn>(
  node: FilterNode | null,
  t: T,
  ask?: AskVerdict<T>,
): boolean {
  return verdict3(node, t, ask ?? unjudged) === true
}

const unjudged = () => undefined

/**
 * Whether a row could pass once its unjudged `ask:` terms are judged: false
 * only when no verdict could make it pass. The rows worth asking about.
 */
export function mightMatch<T extends FilterTxn>(node: FilterNode | null, t: T, ask: AskVerdict<T>): boolean {
  return verdict3(node, t, ask) !== false
}

/** Whether the row's match waits on an unjudged `ask:` term (neither
 * matched nor ruled out without it). */
export function undecided<T extends FilterTxn>(node: FilterNode | null, t: T, ask: AskVerdict<T>): boolean {
  return verdict3(node, t, ask) === undefined
}

/** Three-valued evaluation: an unjudged `ask:` term is unknown (undefined),
 * and AND / OR / NOT carry the unknown through. */
function verdict3<T extends FilterTxn>(node: FilterNode | null, t: T, ask: AskVerdict<T>): boolean | undefined {
  if (!node) return true
  const children = node.children ?? []
  switch (node.kind) {
    case "text": {
      const needle = node.value ?? ""
      if (!needle.trim()) return true
      if (textContains(t.description, needle)) return true
      if (node.op === "contains_meta") {
        if (textContains(t.categoryName, needle)) return true
        if (t.tagNames.some((tg) => textContains(tg, needle))) return true
      }
      return false
    }
    case "field":
      return node.field === "ask" ? ask(node.value ?? "", t) : evalField(node, t)
    case "and": {
      let unknown = false
      for (const c of children) { const v = verdict3(c, t, ask); if (v === false) return false; if (v === undefined) unknown = true }
      return unknown ? undefined : true
    }
    case "or": {
      let unknown = false
      for (const c of children) { const v = verdict3(c, t, ask); if (v === true) return true; if (v === undefined) unknown = true }
      return unknown ? undefined : false
    }
    case "not": {
      if (!children.length) return true
      const v = verdict3(children[0]!, t, ask)
      return v === undefined ? undefined : !v
    }
    default:
      return true
  }
}

function isAsk(node: FilterNode): boolean {
  return node.kind === "field" && node.field === "ask"
}

/** The distinct words of every `ask:` term, in order. */
export function askTerms(node: FilterNode | null): string[] {
  if (!node) return []
  if (isAsk(node)) return [node.value ?? ""].filter(Boolean)
  return [...new Set((node.children ?? []).flatMap(askTerms))]
}

/** Whether the filter limits dates anywhere. */
export function hasDateTerm(node: FilterNode | null): boolean {
  if (!node) return false
  if (node.kind === "field" && node.field === "date") return true
  return (node.children ?? []).some(hasDateTerm)
}

/** Case, spacing and punctuation dropped; letters (any script) and digits kept. */
const squash = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
/** Squashed text by original, since the same descriptions are matched on every keystroke. */
const squashed = new Map<string, string>()
const squashCached = (s: string) => {
  let v = squashed.get(s)
  if (v === undefined) {
    if (squashed.size > 50_000) squashed.clear()
    v = squash(s)
    squashed.set(s, v)
  }
  return v
}

/**
 * Whether `text` contains `needle`, ignoring case, spacing and punctuation:
 * "mcdonalds", "Mc Donalds" and "mcdonald's" all find "McDonald's". The
 * letters must still appear in order (not scattered, as a picker's fuzzy
 * match allows): rules use this too, and must not catch stray rows.
 * Approved deviation from legacy (Go filter.go: case-insensitive substring
 * only), 2026-10-27; it matches everything legacy did, and more. A needle
 * with no letters or digits ("*") is matched as written.
 */
export function textContains(text: string, needle: string): boolean {
  const n = squash(needle)
  if (!n) return text.toLowerCase().includes(needle.trim().toLowerCase())
  return squashCached(text).includes(n)
}

function evalField(node: FilterNode, t: FilterTxn): boolean {
  const field = (node.field ?? "").toLowerCase()
  switch (field) {
    case "desc":
      return textContains(t.description, node.value ?? "")
    case "note":
      return textContains(t.notes, node.value ?? "")
    case "cat":
      return eqFold(t.categoryName, node.value ?? "") || (!!t.categoryGroup && eqFold(t.categoryGroup, node.value ?? ""))
    case "acc":
      return eqFold(t.accountName, node.value ?? "")
    case "tag":
      return t.tagNames.some((tg) => eqFold(tg, node.value ?? ""))
    case "type": {
      const want = (node.value ?? "").toLowerCase()
      if (want === "debit") return t.amount < 0
      if (want === "credit") return t.amount > 0
      if (want === "spending") return isSpending(t)
      if (want === "income") return isIncome(t)
      return false
    }
    case "amt":
      return evalAmount(node, t.amount)
    case "date":
      return evalDate(node, t.dateISO)
    // Each row passes; applyTop cuts the result.
    case "top":
      return true
    default:
      return false
  }
}

function evalAmount(node: FilterNode, amt: number): boolean {
  if (node.op === "..") {
    const lo = Number(node.valueLo)
    const hi = Number(node.valueHi)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    return amt >= lo && amt <= hi
  }
  const v = Number(node.value)
  if (!Number.isFinite(v)) return false
  switch (node.op) {
    case "=":
      return amt === v
    case ">":
      return amt > v
    case "<":
      return amt < v
    case ">=":
      return amt >= v
    case "<=":
      return amt <= v
    default:
      return false
  }
}

function evalDate(node: FilterNode, dateISO: string): boolean {
  if (!parseDay(dateISO)) return false
  const txn = dayTime(dateISO)
  if (node.op === "=") {
    const [lo, hi] = dateTokenBounds(node.value ?? "")
    return txn >= lo && txn <= hi
  }
  if (node.op === "..") {
    const [lo] = dateTokenBounds(node.valueLo ?? "")
    const [, hi] = dateTokenBounds(node.valueHi ?? "")
    return txn >= lo && txn <= hi
  }
  return false
}

// ── Lexer ─────────────────────────────────────────────────────────────

function lexFilter(input: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++
      continue
    }
    if (ch === "(") {
      out.push({ kind: "lparen", text: "(", pos: i })
      i++
      continue
    }
    if (ch === ")") {
      out.push({ kind: "rparen", text: ")", pos: i })
      i++
      continue
    }
    if (ch === ":") {
      out.push({ kind: "colon", text: ":", pos: i })
      i++
      continue
    }
    if (ch === '"') {
      const start = i
      i++
      let s = ""
      let closed = false
      while (i < input.length) {
        if (input[i] === '"') {
          i++
          closed = true
          break
        }
        if (input[i] === "\\") {
          if (i + 1 >= input.length) throw new Error(`unterminated escape at ${i + 1}`)
          const next = input[i + 1]!
          if (next === '"' || next === "\\") {
            s += next
            i += 2
          } else {
            throw new Error(`unsupported escape \\${next} at ${i + 1}`)
          }
          continue
        }
        s += input[i]
        i++
      }
      if (!closed) throw new Error(`unterminated quoted string at ${start + 1}`)
      out.push({ kind: "quoted", text: s, pos: start })
      continue
    }
    const start = i
    while (i < input.length) {
      const c = input[i]!
      if (
        c === " " ||
        c === "\t" ||
        c === "\n" ||
        c === "\r" ||
        c === "(" ||
        c === ")" ||
        c === ":" ||
        c === '"'
      )
        break
      i++
    }
    const word = input.slice(start, i)
    let kind: TokKind = "word"
    if (word === "AND") kind = "and"
    else if (word === "OR") kind = "or"
    else if (word === "NOT") kind = "not"
    out.push({ kind, text: word, pos: start })
  }
  out.push({ kind: "eof", text: "", pos: input.length })
  return out
}

// ── Parser ────────────────────────────────────────────────────────────

class Parser {
  idx = 0
  constructor(
    readonly tokens: Tok[],
    readonly strict: boolean,
    readonly input: string,
    readonly hints: string[],
    readonly ambiguities: string[],
  ) {}

  ignoreTrailingOperators(): void {
    while (this.tokens.length > 1) {
      const tok = this.tokens[this.tokens.length - 2]!
      if (tok.kind !== "and" && tok.kind !== "or" && tok.kind !== "not") break
      // A keyword glued to an unknown colon belongs to that text term.
      const before = this.tokens[this.tokens.length - 3]
      if (before?.kind === "colon" && before.pos + 1 === tok.pos) break
      this.tokens.splice(this.tokens.length - 2, 1)
      this.hints.unshift(`ignoring the ${tok.text} at the end`)
    }
  }

  isLooseOrAt(i: number): boolean {
    if (this.strict) return false
    const tok = this.tokens[i]
    const before = this.tokens[i - 1]
    const after = this.tokens[i + 1]
    return tok?.kind === "word" && tok.text.toLowerCase() === "or"
      && !!before && (before.kind === "word" || before.kind === "quoted" || before.kind === "rparen")
      && !!after && canStartTerm(after.kind)
  }

  isDashAt(i: number): boolean {
    const tok = this.tokens[i]
    const next = this.tokens[i + 1]
    return tok?.kind === "word" && (/^-\p{L}/u.test(tok.text)
      || (tok.text === "-" && next?.pos === tok.pos + 1 && (next.kind === "quoted" || next.kind === "lparen")))
  }

  collectTextWord(): string {
    const tok = this.consume()
    if (this.peek().kind !== "colon") return tok.text
    const suggestion = suggestField(tok.text)
    if (suggestion) {
      const message = `${tok.text}: isn't a field: did you mean ${suggestion}:?`
      if (!this.strict) this.hints.push(message)
      this.ambiguities.push(message)
    }
    // Keep a glued quoted token whole, including spaces inside its quotes.
    const glued = this.input.slice(this.peek().pos).match(/^(?:[^\s()"]|"(?:\\.|[^"\\])*")*/)?.[0] ?? ""
    const end = this.peek().pos + glued.length
    while (this.peek().kind !== "eof" && this.peek().pos < end) this.consume()
    return this.input.slice(tok.pos, end)
  }

  peek(): Tok {
    return this.tokens[this.idx] ?? { kind: "eof", text: "", pos: 0 }
  }
  consume(): Tok {
    const t = this.peek()
    if (this.idx < this.tokens.length) this.idx++
    return t
  }

  parseExpr(): FilterNode {
    return this.parseOrExpr()
  }

  parseOrExpr(): FilterNode {
    const children: FilterNode[] = [this.parseAndExpr()]
    while (this.peek().kind === "or" || this.isLooseOrAt(this.idx)) {
      if (this.isLooseOrAt(this.idx)) this.hints.push(`reading ${this.peek().text} as OR`)
      this.consume()
      children.push(this.parseAndExpr())
    }
    if (children.length === 1) return children[0]!
    return { kind: "or", children: flatten(children, "or") }
  }

  parseAndExpr(): FilterNode {
    const children: FilterNode[] = [this.parseUnary()]
    for (;;) {
      const tok = this.peek()
      if (this.isLooseOrAt(this.idx)) break
      if (tok.kind === "and") {
        this.consume()
        children.push(this.parseUnary())
        continue
      }
      if (canStartTerm(tok.kind)) {
        children.push(this.parseUnary())
        continue
      }
      break
    }
    if (children.length === 1) return children[0]!
    return { kind: "and", children: flatten(children, "and") }
  }

  parseUnary(): FilterNode {
    if (this.isDashAt(this.idx)) {
      const tok = this.peek()
      if (!this.strict) this.hints.push(`reading - at ${tok.pos + 1} as NOT`)
      if (tok.text === "-") this.consume()
      else this.tokens[this.idx] = { ...tok, text: tok.text.slice(1), pos: tok.pos + 1 }
      return { kind: "not", children: [this.parseUnary()] }
    }
    if (this.peek().kind === "not") {
      this.consume()
      return { kind: "not", children: [this.parseUnary()] }
    }
    return this.parseTerm()
  }

  parseTerm(): FilterNode {
    const tok = this.peek()
    if (tok.kind === "lparen") {
      this.consume()
      const n = this.parseExpr()
      if (!this.strict && this.peek().kind === "eof") {
        this.hints.push(`closing the ( at ${tok.pos + 1}`)
      } else {
        if (this.peek().kind !== "rparen") throw new Error(`missing ')' at ${this.peek().pos + 1}`)
        this.consume()
      }
      n.grouped = true
      return n
    }
    if (tok.kind === "quoted") {
      const q = this.consume()
      return { kind: "text", op: "contains", value: q.text }
    }
    if (tok.kind === "word") {
      if (this.isFieldAt(this.idx)) return this.parseField()
      return { kind: "text", op: "contains", value: this.collectTextWord() }
    }
    if (tok.kind === "eof") throw new Error("unexpected end of expression")
    throw new Error(`unexpected token ${JSON.stringify(tok.text)} at ${tok.pos + 1}`)
  }

  parseField(): FilterNode {
    const fieldTok = this.consume()
    const field = fieldTok.text.toLowerCase().trim()
    this.consume() // colon
    if (!isField(field)) throw new Error(`unknown field ${JSON.stringify(fieldTok.text)} at ${fieldTok.pos + 1}`)

    if (field === "amt") {
      const raw = this.collectValue(field, false)
      const n = parseAmountField(raw, fieldTok.pos, this.strict ? [] : this.hints)
      n.field = field
      return n
    }
    if (field === "date") {
      const raw = this.collectValue(field, false)
      const n = parseDateField(raw, fieldTok.pos, this.strict ? [] : this.hints)
      n.field = field
      return n
    }
    if (field === "top") {
      const raw = this.collectValue(field, false).trim()
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1) throw new Error(`top expects a number of rows, such as top:10, at ${fieldTok.pos + 1}`)
      return { kind: "field", field, op: "=", value: String(n) }
    }
    if (field === "type") {
      const raw = this.collectValue(field, false).toLowerCase().trim()
      if (raw !== "debit" && raw !== "credit" && raw !== "spending" && raw !== "income") {
        throw new Error(`type expects debit|credit|spending|income at ${fieldTok.pos + 1}`)
      }
      return { kind: "field", field, op: "=", value: raw }
    }
    if (field === "cat" || field === "tag" || field === "acc") {
      const raw = this.collectValue(field, true)
      return { kind: "field", field, op: "=", value: raw.trim() }
    }
    // desc, note, ask
    const raw = this.collectValue(field, true)
    return { kind: "field", field, op: "contains", value: raw.trim() }
  }

  collectValue(field: string, allowMulti: boolean): string {
    if (this.peek().kind === "quoted") return this.consume().text
    const words: string[] = []
    for (;;) {
      const tok = this.peek()
      if (tok.kind !== "word") break
      if (words.length > 0 && (this.isFieldAt(this.idx) || this.tokens[this.idx + 1]?.kind === "colon")) break
      if (allowMulti && (this.isDashAt(this.idx) || this.isLooseOrAt(this.idx))) break
      if (!allowMulti && words.length > 0) {
        const value = words.join("")
        if (!/^(<|>|<=|>=|=)$/.test(value) && !value.endsWith("..") && !tok.text.startsWith("..")) break
      }
      words.push(this.collectTextWord())
    }
    if (words.length === 0) {
      const tok = this.peek()
      if (tok.kind === "eof" || tok.kind === "rparen") throw new Error(`${field}: missing value`)
      throw new Error(`${field}: invalid value near ${JSON.stringify(tok.text)}`)
    }
    if (!this.strict && !allowMulti && words.length > 1) this.hints.push(`joining spaces in ${field}:${words.join(" ")}`)
    return words.join(allowMulti ? " " : "")
  }

  isFieldAt(i: number): boolean {
    if (i + 1 >= this.tokens.length) return false
    const a = this.tokens[i]!
    const b = this.tokens[i + 1]!
    if (a.kind !== "word" || b.kind !== "colon") return false
    return isField(a.text.toLowerCase().trim())
  }
}

function canStartTerm(k: TokKind): boolean {
  return k === "lparen" || k === "word" || k === "quoted" || k === "not"
}

/** Every field the parser knows (each described in domain/filterLanguage). */
export const FILTER_FIELDS = ["desc", "cat", "tag", "acc", "amt", "type", "note", "date", "ask", "top"] as const

function isField(v: string): boolean {
  return (FILTER_FIELDS as readonly string[]).includes(v)
}

function suggestField(word: string): string | undefined {
  const value = word.toLowerCase()
  // HTTP is ordinary colon text, though its edit distance from top is two.
  if (value === "http") return undefined
  const prefixes = FILTER_FIELDS.filter((field) => value.length >= 2 && field.startsWith(value))
  if (prefixes.length === 1) return prefixes[0]
  const distance = (field: string): number => {
    let row = Array.from({ length: field.length + 1 }, (_, i) => i)
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1]
      for (let j = 0; j < field.length; j++) {
        next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (value[i] === field[j] ? 0 : 1)))
      }
      row = next
    }
    return row[field.length]!
  }
  const ranked = FILTER_FIELDS.map((field) => ({ field, distance: distance(field) })).sort((a, b) => a.distance - b.distance)
  const best = ranked[0]!
  return best.distance <= (value.length >= 4 ? 2 : 1) ? best.field : undefined
}

function flatten(children: FilterNode[], kind: "and" | "or"): FilterNode[] {
  const out: FilterNode[] = []
  for (const c of children) {
    if (c.kind === kind && !c.grouped) {
      out.push(...(c.children ?? []))
    } else {
      out.push(c)
    }
  }
  return out
}

/** `top:` cuts the whole result, so it may only be ANDed with the rest at
 * the top level (not inside OR or NOT), once. */
function validateTop(node: FilterNode | null): void {
  if (!node) return
  const isTop = (n: FilterNode) => n.kind === "field" && n.field === "top"
  const level = isTop(node) ? [node] : node.kind === "and" ? (node.children ?? []) : []
  if (level.filter(isTop).length > 1) throw new Error("only one top: per filter")
  const nested = (n: FilterNode, top: boolean): boolean => (!top && isTop(n)) || (n.children ?? []).some((c) => nested(c, false))
  if ((node.kind === "and" ? level : [node]).some((c) => !isTop(c) && nested(c, false))) {
    throw new Error("top: applies to the whole filter: AND it with the rest, not inside OR, NOT or brackets")
  }
}

/** The filter's `top:` count, if it has one. */
export function topCount(node: FilterNode | null): number | null {
  if (!node) return null
  const level = node.kind === "and" ? (node.children ?? []) : [node]
  const top = level.find((n) => n.kind === "field" && n.field === "top")
  return top ? Number(top.value) : null
}

/** `rows` (already filtered) cut to the filter's `top:` count: the biggest
 * by amount either way (money out or in), ties the newest. Without top:,
 * `rows` as they are. */
export function applyTop<T extends { amount: number; dateISO: string; id: number }>(node: FilterNode | null, rows: T[]): T[] {
  const n = topCount(node)
  if (n == null) return rows
  const keep = new Set([...rows].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.dateISO.localeCompare(a.dateISO) || b.id - a.id).slice(0, n))
  return rows.filter((t) => keep.has(t))
}

/** For a filter of plain words that finds nothing because no row has them
 * all ("mcdonalds kfc"), though each finds some: the same words joined by
 * OR. Else null. */
export function eitherInstead<T extends FilterTxn>(node: FilterNode | null, rows: T[]): string | null {
  if (node?.kind !== "and") return null
  const words = node.children ?? []
  const plain = (n: FilterNode) => n.kind === "text" || (n.kind === "field" && n.field === "desc")
  if (words.length < 2 || !words.every(plain)) return null
  if (!words.every((w) => rows.some((t) => evalFilter(w, t)))) return null
  return filterExprString({ kind: "or", children: words })
}

/** Why a filter can't drive a rule (which decides each row on its own), or
 * null: ask: needs Jev, top: needs the whole set. */
export function notForRules(node: FilterNode | null): string | null {
  if (askTerms(node).length) return "ask: can't be used in a rule"
  if (topCount(node) != null) return "top: can't be used in a rule"
  return null
}

function validateStrictGrouping(node: FilterNode | null): void {
  if (!node) return
  if (hasMixed(node)) {
    throw new Error("strict mode requires parentheses when mixing AND/OR")
  }
}

function hasMixed(node: FilterNode): boolean {
  for (const child of node.children ?? []) {
    if (node.kind === "and" && child.kind === "or" && !child.grouped) return true
    if (node.kind === "or" && child.kind === "and" && !child.grouped) return true
    if (hasMixed(child)) return true
  }
  return false
}

function parseAmountField(raw: string, pos: number, hints: string[]): FilterNode {
  const v = raw.replace(/\s+/g, "").trim()
  if (!v) throw new Error(`amt: missing value at ${pos + 1}`)
  if (v.includes("..")) {
    const [a, b] = v.split("..")
    if (!a || !b) throw new Error(`amt: invalid range ${JSON.stringify(raw)}`)
    const lo = Number(a)
    const hi = Number(b)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("amt: invalid range number")
    if (lo > hi) hints.push(`ordering amt:${raw} low..high`)
    return { kind: "field", op: "..", valueLo: String(Math.min(lo, hi)), valueHi: String(Math.max(lo, hi)) }
  }
  for (const op of ["<=", ">=", "<", ">", "="] as const) {
    if (v.startsWith(op)) {
      const n = Number(v.slice(op.length))
      if (!Number.isFinite(n)) throw new Error(`amt: invalid number`)
      return { kind: "field", op, value: String(n) }
    }
  }
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`amt: invalid value ${JSON.stringify(raw)}`)
  return { kind: "field", op: "=", value: String(n) }
}

function parseDateField(raw: string, pos: number, hints: string[]): FilterNode {
  const v = raw.replace(/\s+/g, "").trim()
  if (!v) throw new Error(`date: missing value at ${pos + 1}`)
  if (v.includes("..")) {
    const [a, b] = v.split("..")
    if (!a || !b) throw new Error(`date: invalid range ${JSON.stringify(raw)}`)
    const lo = canonicalDateToken(a)
    const hi = canonicalDateToken(b)
    const [loStart] = dateTokenBounds(lo)
    const [, hiEnd] = dateTokenBounds(hi)
    if (hiEnd < loStart) {
      hints.push(`ordering date:${raw} low..high`)
      return { kind: "field", op: "..", valueLo: hi, valueHi: lo }
    }
    return { kind: "field", op: "..", valueLo: lo, valueHi: hi }
  }
  return { kind: "field", op: "=", value: canonicalDateToken(v) }
}

function canonicalDateToken(v: string): string {
  v = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!parseDay(v)) throw new Error("invalid date")
    return v
  }
  if (/^\d{4}-\d{2}$/.test(v)) {
    const [ys, ms] = v.split("-")
    const y = Number(ys)
    const m = Number(ms)
    if (m < 1 || m > 12) throw new Error("invalid month")
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`
  }
  if (/^\d{2}-\d{2}$/.test(v)) {
    const [ys, ms] = v.split("-")
    const y = 2000 + Number(ys)
    const m = Number(ms)
    if (m < 1 || m > 12) throw new Error("invalid month")
    return `${y}-${String(m).padStart(2, "0")}`
  }
  throw new Error(`invalid date token ${JSON.stringify(v)}`)
}

function dateTokenBounds(v: string): [number, number] {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = dayTime(v)
    return [d, d]
  }
  const first = v + "-01"
  return [dayTime(first), dayTime(addDays(addMonths(first, 1), -1))]
}

function eqFold(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Canonical expression string for pills / preview (Go filterExprString). */
/** One field term with its value quoted: `cat:"Pubs & Bars"`. */
export function filterTerm(field: string, value: string): string {
  return `${field}:"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** Terms joined with OR, bracketed when there are several. */
export function anyOf(terms: string[]): string {
  return terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0] ?? ""
}

export function filterExprString(node: FilterNode | null): string {
  if (!node) return ""
  return renderNode(node, 0)
}

function renderCanonical(node: FilterNode): string {
  if (node.kind === "text") return quoteIfNeeded(node.value ?? "", true)
  if (node.kind === "field") return renderField(node, true)
  if (node.kind === "not") {
    const child = node.children?.[0]
    if (!child) return ""
    const text = renderCanonical(child)
    return `NOT ${child.kind === "and" || child.kind === "or" ? `(${text})` : text}`
  }
  return (node.children ?? []).map((child) => {
    const text = renderCanonical(child)
    return (child.kind === "and" || child.kind === "or") && child.kind !== node.kind ? `(${text})` : text
  }).join(node.kind === "and" ? " AND " : " OR ")
}

function prec(kind: FilterNodeKind): number {
  if (kind === "or") return 1
  if (kind === "and") return 2
  if (kind === "not") return 3
  return 4
}

function renderNode(node: FilterNode, parentPrec: number): string {
  const p = prec(node.kind)
  let s = ""
  switch (node.kind) {
    case "text":
      s = quoteIfNeeded(node.value ?? "")
      break
    case "field":
      s = renderField(node)
      break
    case "not": {
      const child = node.children?.[0]
      let c = child ? renderNode(child, p) : ""
      if (child && prec(child.kind) < p) c = `(${c})`
      s = `NOT ${c}`
      break
    }
    case "and":
    case "or": {
      const join = node.kind === "and" ? " AND " : " OR "
      const parts = (node.children ?? []).map((ch) => {
        let part = renderNode(ch, p)
        if (prec(ch.kind) < p || (ch.kind !== node.kind && (ch.kind === "and" || ch.kind === "or") && !ch.grouped)) {
          if (prec(ch.kind) <= p && ch.kind !== node.kind) part = `(${part})`
        }
        return part
      })
      s = parts.join(join)
      break
    }
  }
  if (parentPrec > 0 && p > 0 && p < parentPrec) s = `(${s})`
  return s
}

function renderField(node: FilterNode, full = false): string {
  const field = (node.field ?? "").toLowerCase()
  if (node.op === "..") return `${field}:${node.valueLo}..${node.valueHi}`
  if (field === "amt") {
    if (node.op === "=") return `amt:=${node.value}`
    return `amt:${node.op}${node.value}`
  }
  if (field === "desc" || field === "note" || field === "ask") {
    return `${field}:${quoteIfNeeded(node.value ?? "", full)}`
  }
  return `${field}:${quoteIfNeeded(node.value ?? "", full)}`
}

function quoteIfNeeded(v: string, full = false): string {
  if (!v) return '""'
  if (/[\s():]/.test(v) || /^-\p{L}/u.test(v) || /^(and|or|not)$/i.test(v) || (full && /["\\]/.test(v))) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return v
}
