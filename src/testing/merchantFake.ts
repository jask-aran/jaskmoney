import type { JevClient } from "../ai/jev"

/** A Jev fake that answers the merchant-breadth questions itself (every
 * name `p`, single by default) and hands the rest to `jev`: tests of other
 * questions see only theirs. */
export function answeringMerchants(jev: Pick<JevClient, "judge">, p = 0.1): Pick<JevClient, "judge"> {
  return { async judge(questions, state) {
    const isMerchant = (q: (typeof questions)[string]) => typeof q.instructions === "object" && "merchant" in q.instructions
    const merchants = Object.entries(questions).filter(([, q]) => isMerchant(q))
    const rest = Object.fromEntries(Object.entries(questions).filter(([, q]) => !isMerchant(q)))
    const out: Awaited<ReturnType<JevClient["judge"]>> = Object.fromEntries(merchants.map(([id]) => [id, { type: "noul", noul: p }]))
    return Object.keys(rest).length ? { ...out, ...(await jev.judge(rest, state)) } : out
  } }
}
