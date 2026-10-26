import { theme } from "../theme"

/** Colours that say which way money went. Changes are shown in whole
 * dollars, so one that rounds to $0 is grey. */

/** A change in a balance or a net: up green, down red. */
export function changeColor(delta: number): string {
  return Math.abs(delta) < 0.5 ? theme.overlay1 : delta > 0 ? theme.success : theme.error
}

/** Spending against what it is compared with: more red, less green. */
export function spendChangeColor(delta: number): string {
  return Math.abs(delta) < 0.5 ? theme.overlay1 : delta > 0 ? theme.error : theme.success
}

/** A transaction amount or total: money out red, money in green. */
export function amountColor(amount: number): string {
  return amount < 0 ? theme.error : theme.success
}
