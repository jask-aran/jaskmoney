/**
 * Hardcoded ANZ Australia CSV format (from Go defaultFormats).
 * date D/M/YYYY, amount (optional quotes/commas), description (rest of cols joined).
 */

export interface AnzRow {
  dateRaw: string
  dateISO: string
  amount: number
  description: string
}

export interface AnzParseError {
  line: number
  message: string
}

export interface AnzParseResult {
  rows: AnzRow[]
  errors: AnzParseError[]
}

/** Parse Go-style "2/01/2006" dates: d/m/yyyy with flexible day width. */
export function parseAnzDateToISO(raw: string): string | null {
  const s = raw.trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(year, month - 1, day)
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null
  }
  const mm = String(month).padStart(2, "0")
  const dd = String(day).padStart(2, "0")
  return `${year}-${mm}-${dd}`
}

export function parseAnzAmount(raw: string): number | null {
  let s = raw.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1)
  }
  s = s.replace(/,/g, "").trim()
  if (s === "" || s === "-") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Minimal CSV line split respecting double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

export function parseAnzCsv(text: string): AnzParseResult {
  const rows: AnzRow[] = []
  const errors: AnzParseError[] = []
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const line = lines[i]!.trim()
    if (line === "") continue

    const cols = splitCsvLine(line)
    if (cols.length < 3) {
      errors.push({ line: lineNo, message: `expected ≥3 columns, got ${cols.length}` })
      continue
    }

    const dateRaw = cols[0]!.trim()
    const amountRaw = cols[1]!.trim()
    const description = cols
      .slice(2)
      .map((c) => c.trim())
      .filter(Boolean)
      .join(",")

    if (!dateRaw || !amountRaw) {
      // blank row — skip quietly like Go empty-field skip
      continue
    }

    const dateISO = parseAnzDateToISO(dateRaw)
    if (!dateISO) {
      errors.push({ line: lineNo, message: `bad date ${JSON.stringify(dateRaw)}` })
      continue
    }
    const amount = parseAnzAmount(amountRaw)
    if (amount === null) {
      errors.push({ line: lineNo, message: `bad amount ${JSON.stringify(amountRaw)}` })
      continue
    }

    rows.push({ dateRaw, dateISO, amount, description })
  }

  return { rows, errors }
}
