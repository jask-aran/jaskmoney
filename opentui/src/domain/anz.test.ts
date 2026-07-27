import { describe, expect, test } from "bun:test"
import { parseAnzAmount, parseAnzCsv, parseAnzDateToISO } from "./anz"

describe("ANZ parser", () => {
  test("dates", () => {
    expect(parseAnzDateToISO("03/02/2026")).toBe("2026-02-03")
    expect(parseAnzDateToISO("3/2/2026")).toBe("2026-02-03")
    expect(parseAnzDateToISO("32/01/2026")).toBeNull()
  })

  test("amounts", () => {
    expect(parseAnzAmount('"203.92"')).toBe(203.92)
    expect(parseAnzAmount('"-20.00"')).toBe(-20)
    expect(parseAnzAmount("1,234.56")).toBe(1234.56)
  })

  test("sample lines", () => {
    const csv = [
      '03/02/2026,"203.92",PAYMENT THANKYOU 528417',
      '03/02/2026,"-20.00",DAN MURPHY\'S/580 MELBOURN SPOTSWOOD',
      '02/02/2026,"10.00",FOO,BAR EXTRA',
    ].join("\n")
    const r = parseAnzCsv(csv)
    expect(r.errors).toEqual([])
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]!.dateISO).toBe("2026-02-03")
    expect(r.rows[0]!.amount).toBe(203.92)
    expect(r.rows[2]!.description).toBe("FOO,BAR EXTRA")
  })
})
