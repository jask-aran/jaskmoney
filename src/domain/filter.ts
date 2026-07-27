/**
 * Port of Go filter.go — lexer + recursive-descent parser + eval.
 * Permissive parse for live `/` input; strict for committed/save surfaces.
 */

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
  categoryName: string
  accountName: string
  notes: string
  amount: number
  dateISO: string
  tagNames: string[]
}

export function parseFilter(input: string): { node: FilterNode | null; error?: string } {
  return parseFilterWithMode(input, false)
}

export function parseFilterStrict(input: string): { node: FilterNode | null; error?: string } {
  return parseFilterWithMode(input, true)
}

function parseFilterWithMode(
  input: string,
  strict: boolean,
): { node: FilterNode | null; error?: string } {
  if (!input.trim()) return { node: null }
  try {
    const tokens = lexFilter(input)
    const p = new Parser(tokens, strict)
    const node = p.parseExpr()
    if (p.peek().kind !== "eof") {
      const tok = p.peek()
      throw new Error(`unexpected token ${JSON.stringify(tok.text)} at ${tok.pos + 1}`)
    }
    if (strict) validateStrictGrouping(node)
    return { node }
  } catch (e) {
    return { node: null, error: e instanceof Error ? e.message : String(e) }
  }
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

/** Live reparse: permissive + metadata bare words + fallback. */
export function reparseFilterInput(input: string): {
  expr: FilterNode | null
  err: string
} {
  if (!input.trim()) return { expr: null, err: "" }
  const { node, error } = parseFilter(input)
  if (error || !node) {
    return { expr: fallbackPlainTextFilter(input), err: error ?? "parse error" }
  }
  if (!filterContainsFieldPredicate(node)) {
    return { expr: markTextNodesAsMetadata(node), err: "" }
  }
  return { expr: node, err: "" }
}

export function evalFilter(
  node: FilterNode | null,
  t: FilterTxn,
): boolean {
  if (!node) return true
  switch (node.kind) {
    case "text": {
      const needle = (node.value ?? "").trim().toLowerCase()
      if (!needle) return true
      if (t.description.toLowerCase().includes(needle)) return true
      if (node.op === "contains_meta") {
        if (t.categoryName.toLowerCase().includes(needle)) return true
        if (t.tagNames.some((tg) => tg.toLowerCase().includes(needle))) return true
      }
      return false
    }
    case "field":
      return evalField(node, t)
    case "and":
      return (node.children ?? []).every((c) => evalFilter(c, t))
    case "or":
      return (node.children ?? []).some((c) => evalFilter(c, t))
    case "not":
      if (!node.children?.length) return true
      return !evalFilter(node.children[0]!, t)
    default:
      return true
  }
}

function evalField(node: FilterNode, t: FilterTxn): boolean {
  const field = (node.field ?? "").toLowerCase()
  switch (field) {
    case "desc":
      return t.description.toLowerCase().includes((node.value ?? "").toLowerCase())
    case "note":
      return t.notes.toLowerCase().includes((node.value ?? "").toLowerCase())
    case "cat":
      return eqFold(t.categoryName, node.value ?? "")
    case "acc":
      return eqFold(t.accountName, node.value ?? "")
    case "tag":
      return t.tagNames.some((tg) => eqFold(tg, node.value ?? ""))
    case "type": {
      const want = (node.value ?? "").toLowerCase()
      if (want === "debit") return t.amount < 0
      if (want === "credit") return t.amount > 0
      return false
    }
    case "amt":
      return evalAmount(node, t.amount)
    case "date":
      return evalDate(node, t.dateISO)
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
  const txn = parseDay(dateISO)
  if (!txn) return false
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
  ) {}

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
    while (this.peek().kind === "or") {
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
      if (this.peek().kind !== "rparen") {
        throw new Error(`missing ')' at ${this.peek().pos + 1}`)
      }
      this.consume()
      n.grouped = true
      return n
    }
    if (tok.kind === "quoted") {
      const q = this.consume()
      return { kind: "text", op: "contains", value: q.text }
    }
    if (tok.kind === "word") {
      if (this.isFieldAt(this.idx)) return this.parseField()
      const w = this.consume()
      return { kind: "text", op: "contains", value: w.text }
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
      const n = parseAmountField(raw, fieldTok.pos)
      n.field = field
      return n
    }
    if (field === "date") {
      const raw = this.collectValue(field, false)
      const n = parseDateField(raw, fieldTok.pos)
      n.field = field
      return n
    }
    if (field === "type") {
      const raw = this.collectValue(field, false).toLowerCase().trim()
      if (raw !== "debit" && raw !== "credit") {
        throw new Error(`type expects debit|credit at ${fieldTok.pos + 1}`)
      }
      return { kind: "field", field, op: "=", value: raw }
    }
    if (field === "cat" || field === "tag" || field === "acc") {
      const raw = this.collectValue(field, true)
      return { kind: "field", field, op: "=", value: raw.trim() }
    }
    // desc, note
    const raw = this.collectValue(field, true)
    return { kind: "field", field, op: "contains", value: raw.trim() }
  }

  collectValue(field: string, allowMulti: boolean): string {
    if (this.peek().kind === "quoted") return this.consume().text
    const words: string[] = []
    for (;;) {
      const tok = this.peek()
      if (tok.kind !== "word") break
      if (words.length > 0 && this.isFieldAt(this.idx)) break
      words.push(tok.text)
      this.consume()
      if (!allowMulti) break
      const next = this.peek().kind
      if (next === "eof" || next === "rparen" || next === "and" || next === "or") break
    }
    if (words.length === 0) {
      const tok = this.peek()
      if (tok.kind === "eof" || tok.kind === "rparen") throw new Error(`${field}: missing value`)
      throw new Error(`${field}: invalid value near ${JSON.stringify(tok.text)}`)
    }
    return words.join(" ")
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

function isField(v: string): boolean {
  return ["desc", "cat", "tag", "acc", "amt", "type", "note", "date"].includes(v)
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

function parseAmountField(raw: string, pos: number): FilterNode {
  const v = raw.replace(/\s+/g, "").trim()
  if (!v) throw new Error(`amt: missing value at ${pos + 1}`)
  if (v.includes("..")) {
    const [a, b] = v.split("..")
    if (!a || !b) throw new Error(`amt: invalid range ${JSON.stringify(raw)}`)
    const lo = Number(a)
    const hi = Number(b)
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("amt: invalid range number")
    if (lo > hi) throw new Error("amt: range low > high")
    return { kind: "field", op: "..", valueLo: String(lo), valueHi: String(hi) }
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

function parseDateField(raw: string, pos: number): FilterNode {
  const v = raw.replace(/\s+/g, "").trim()
  if (!v) throw new Error(`date: missing value at ${pos + 1}`)
  if (v.includes("..")) {
    const [a, b] = v.split("..")
    if (!a || !b) throw new Error(`date: invalid range ${JSON.stringify(raw)}`)
    const lo = canonicalDateToken(a)
    const hi = canonicalDateToken(b)
    const [loStart] = dateTokenBounds(lo)
    const [, hiEnd] = dateTokenBounds(hi)
    if (hiEnd < loStart) throw new Error("date: range start is after end")
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
    const d = parseDay(v)!
    return [d, d]
  }
  const [ys, ms] = v.split("-")
  const y = Number(ys)
  const m = Number(ms)
  const start = Date.UTC(y, m - 1, 1)
  const end = Date.UTC(y, m, 0) // last day of month
  return [start, end]
}

function parseDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? t : null
}

function eqFold(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Canonical expression string for pills / preview (Go filterExprString). */
export function filterExprString(node: FilterNode | null): string {
  if (!node) return ""
  return renderNode(node, 0)
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

function renderField(node: FilterNode): string {
  const field = (node.field ?? "").toLowerCase()
  if (node.op === "..") return `${field}:${node.valueLo}..${node.valueHi}`
  if (field === "amt") {
    if (node.op === "=") return `amt:=${node.value}`
    return `amt:${node.op}${node.value}`
  }
  if (field === "desc" || field === "note") {
    return `${field}:${quoteIfNeeded(node.value ?? "")}`
  }
  return `${field}:${quoteIfNeeded(node.value ?? "")}`
}

function quoteIfNeeded(v: string): string {
  if (!v) return '""'
  if (/[\s():]/.test(v) || v === "AND" || v === "OR" || v === "NOT") {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return v
}
