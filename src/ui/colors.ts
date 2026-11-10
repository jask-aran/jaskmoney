import { ink, tone } from "../theme"

export function changeColor(delta: number): string {
  return Math.abs(delta) < 0.5 ? ink.note : delta > 0 ? tone.good : tone.bad
}

export function spendChangeColor(delta: number): string {
  return Math.abs(delta) < 0.5 ? ink.note : delta > 0 ? tone.bad : tone.good
}

export function amountColor(amount: number): string {
  return amount < 0 ? tone.bad : tone.good
}
