import { MONTHS, MONTH_NAMES, addDays, addMonths, parseDay } from "./days"

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

function monthNumber(word: string): number | null {
  if (word.length < 3) return null
  const at = MONTH_NAMES.findIndex((name) => name.startsWith(word))
  return at < 0 ? null : at + 1
}

const year4 = (text: string | undefined, today: string) => (text ? (text.length === 2 ? `20${text}` : text) : today.slice(0, 4))

export function rangeDayFromText(text: string, today: string, side: "start" | "end"): string | null {
  const source = text.trim().toLowerCase()
  if (source === "" ) return side === "end" ? today : null
  if (source === "today") return today
  const ago = /^-(\d{1,4})$/.exec(source)
  if (ago) return addDays(today, -Number(ago[1]))
  const dayMonth = /^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2}|\d{4}))?$/.exec(source)
  if (dayMonth) {
    const month = monthNumber(dayMonth[2]!)
    return month ? parseDay(`${year4(dayMonth[3], today)}-${String(month).padStart(2, "0")}-${dayMonth[1]!.padStart(2, "0")}`) : null
  }
  const monthOnly = /^([a-z]+)(?:\s+(\d{2}|\d{4}))?$/.exec(source)
  if (monthOnly) {
    const month = monthNumber(monthOnly[1]!)
    if (!month) return null
    const first = parseDay(`${year4(monthOnly[2], today)}-${String(month).padStart(2, "0")}-01`)
    return first && side === "end" ? addDays(addMonths(first, 1), -1) : first
  }
  return dayFromText(text, today)
}

export function rangeDayText(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}
