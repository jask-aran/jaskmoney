import { addDays } from "./days"

/** End-of-day balances, oldest first, reversing every amount after each day. */
export function reconstructHistory(
  balance: number,
  amounts: Iterable<readonly [dateISO: string, amount: number]>,
  endISO: string,
  days: number,
): Array<{ dateISO: string; value: number }> {
  let value = balance
  const amountsByDate = new Map<string, number>()
  for (const [dateISO, amount] of amounts) {
    // Preserve the caller's subtraction order for future amounts.
    if (dateISO > endISO) value -= amount
    else amountsByDate.set(dateISO, (amountsByDate.get(dateISO) ?? 0) + amount)
  }
  const history: Array<{ dateISO: string; value: number }> = []
  for (let i = 0; i < days; i++) {
    const dateISO = addDays(endISO, -i)
    history.push({ dateISO, value })
    value -= amountsByDate.get(dateISO) ?? 0
  }
  return history.reverse()
}
