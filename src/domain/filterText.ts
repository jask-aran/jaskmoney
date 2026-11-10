import type { FilterNode, FilterNodeKind } from "./filterParse"

export const squash = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")
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

export function textContains(text: string, needle: string): boolean {
  const n = squash(needle)
  if (!n) return text.toLowerCase().includes(needle.trim().toLowerCase())
  return squashCached(text).includes(n)
}

export function eqFold(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function filterTerm(field: string, value: string): string {
  return `${field}:"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

export function anyOf(terms: string[]): string {
  return terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0] ?? ""
}

export function filterExprString(node: FilterNode | null): string {
  if (!node) return ""
  return renderNode(node, 0)
}

export function renderCanonical(node: FilterNode): string {
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
  return `${field}:${quoteIfNeeded(node.value ?? "", full)}`
}

function quoteIfNeeded(v: string, full = false): string {
  if (!v) return '""'
  if (/[\s():]/.test(v) || /^-\p{L}/u.test(v) || /^(and|or|not)$/i.test(v) || (full && /["\\]/.test(v))) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  }
  return v
}
