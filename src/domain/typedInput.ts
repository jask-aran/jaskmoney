import { parseDay } from "./days"

/** Parse money with arithmetic, brackets (up to 128 levels) and unary minus; ignore $, commas and spaces, round to cents or return null. */
export function amountFromText(text: string): number | null {
  const source = text.replace(/[$,\s]/g, "")
  let at = 0
  let depth = 0

  function factor(): number {
    let sign = 1
    while (source[at] === "-") {
      at++
      sign = -sign
    }
    if (source[at] === "(") {
      if (depth === 128) return NaN
      depth++
      at++
      const value = expression()
      depth--
      if (source[at] !== ")") return NaN
      at++
      return sign * value
    }
    const token = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(at))
    if (!token) return NaN
    at += token[0].length
    const value = parseFloat(token[0])
    return Number.isFinite(value) ? sign * value : NaN
  }

  function term(): number {
    let value = factor()
    while (source[at] === "*" || source[at] === "/") {
      const operator = source[at++]
      const right = factor()
      value = operator === "*" ? value * right : right === 0 ? NaN : value / right
      if (!Number.isFinite(value)) return NaN
    }
    return value
  }

  function expression(): number {
    let value = term()
    while (source[at] === "+" || source[at] === "-") {
      const operator = source[at++]
      const right = term()
      value = operator === "+" ? value + right : value - right
    }
    return value
  }

  const value = Math.round(expression() * 100) / 100
  return at === source.length && Number.isFinite(value) ? value === 0 ? 0 : value : null
}

/** Parse ISO or D/M calendar dates, using today's month and year for short forms and 20xx for two-digit years; return null for invalid days. */
export function dayFromText(text: string, today: string): string | null {
  const source = text.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) return parseDay(source)
  const match = /^(\d{1,2})(?:([/.-])(\d{1,2})(?:\2(\d{2}|\d{4}))?)?$/.exec(source)
  if (!match) return null
  const day = match[1]
  if (!day) return null
  const month = match[3] ?? today.slice(5, 7)
  const year = match[4] ? match[4].length === 2 ? `20${match[4]}` : match[4] : today.slice(0, 4)
  return parseDay(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`)
}
