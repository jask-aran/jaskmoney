import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { unwrap, type SetStoreFunction } from "solid-js/store"
import { askTerms, evalFilter, hasDateTerm, undecided, type AskVerdict } from "../domain/filter"
import { MATCH_AT, NEAR_AT } from "../domain/questions"
import { askCandidates } from "../domain/ask"
import { appToday } from "../domain/days"
import type { Transaction } from "../domain/types"
import { JEV_SETUP } from "../ai/judge"
import type { JevClient } from "../ai/jev"
import type { AskResult, DataState } from "./store"
import type { createHistoryRows } from "./derived"
import type { createMirror } from "./mirror"

export function createLatestRun(): { start(): { signal: AbortSignal; isCurrent(): boolean }; stop(): void } {
  let active: AbortController | null = null

  function stop(): void {
    const previous = active
    active = null
    previous?.abort()
  }

  return {
    start() {
      stop()
      const current = new AbortController()
      active = current
      return { signal: current.signal, isCurrent: () => active === current }
    },
    stop,
  }
}

export function showNearMisses(matches: number, near: number): boolean {
  return near <= Math.max(matches, 5)
}

export function createAskState(state: DataState, nearMissesShown: () => boolean) {
  const askVerdicts = new Map<string, Map<number, number>>()
  const [askVersion, setAskVersion] = createSignal(0)
  const verdictAt = (at: number): AskVerdict<Transaction> => (words, t) => {
    const p = askVerdicts.get(words.toLowerCase())?.get(t.id)
    return p == null ? undefined : p >= at
  }
  const askVerdict: AskVerdict<Transaction> = (words, t) => verdictAt(nearMissesShown() ? NEAR_AT : MATCH_AT)(words, t)
  const askRuns = createLatestRun()

  function trimAskVerdicts() {
    const active = new Set(askTerms(state.filterExpr ? unwrap(state.filterExpr) : null).map((words) => words.toLowerCase()))
    for (const key of askVerdicts.keys()) {
      if (askVerdicts.size <= 8) break
      if (!active.has(key)) askVerdicts.delete(key)
    }
  }
  createRoot(() => createEffect(on(() => state.filterExpr, () => {
    for (const words of askTerms(state.filterExpr ? unwrap(state.filterExpr) : null)) {
      const key = words.toLowerCase(), known = askVerdicts.get(key)
      if (known) { askVerdicts.delete(key); askVerdicts.set(key, known) }
    }
    trimAskVerdicts()
  })))

  function askScore(id: number): number | undefined {
    askVersion()
    let low: number | undefined
    for (const words of askTerms(state.filterExpr ? unwrap(state.filterExpr) : null)) {
      const p = askVerdicts.get(words.toLowerCase())?.get(id)
      if (p != null) low = low == null ? p : Math.min(low, p)
    }
    return low
  }

  return { askVerdicts, askVersion, setAskVersion, verdictAt, askVerdict, askRuns, trimAskVerdicts, askScore }
}

export function createAskCounts(state: DataState, accountScoped: ReturnType<typeof createHistoryRows>["accountScoped"], inView: (t: Transaction) => boolean, ask: ReturnType<typeof createAskState>) {
  const { askVersion, verdictAt } = ask
  const askCounts = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    if (!askTerms(expr).length) return null
    askVersion()
    const rows = accountScoped().filter(inView)
    const matches = rows.filter((t) => evalFilter(expr, t, verdictAt(MATCH_AT))).length
    const loose = rows.filter((t) => evalFilter(expr, t, verdictAt(NEAR_AT))).length
    return { matches, near: loose - matches }
  }))

  const nearMissesShown = createRoot(() => createMemo(() => {
    if (state.askLoose != null) return state.askLoose
    const c = askCounts()
    return !!c && c.near > 0 && showNearMisses(c.matches, c.near)
  }))

  return { askCounts, nearMissesShown }
}

export function createAskAction(state: DataState, setState: SetStoreFunction<DataState>, core: ReturnType<typeof createMirror>["core"], accountScoped: ReturnType<typeof createHistoryRows>["accountScoped"], inView: (t: Transaction) => boolean, ask: ReturnType<typeof createAskState>) {
  const { askRuns, askVerdicts, trimAskVerdicts, askVerdict, setAskVersion } = ask
  async function askAbout(ai?: Pick<JevClient, "judge">): Promise<AskResult | null> {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const terms = askTerms(expr)
    if (!terms.length) return null
    if (!ai && !state.jev) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const run = askRuns.start()
    const started = Date.now()
    const result: AskResult = { terms: [], failures: [], ms: 0, dated: hasDateTerm(expr) }
    try {
      for (const words of terms) {
        const key = words.toLowerCase()
        const known = askVerdicts.get(key) ?? new Map<number, number>()
        askVerdicts.delete(key)
        askVerdicts.set(key, known)
        trimAskVerdicts()
        const others: AskVerdict<Transaction> = (w, t) => w.toLowerCase() === key ? undefined : askVerdict(w, t)
        const possible = accountScoped().filter((t) => inView(t) && undecided(expr, t, others))
        const { rows, skipped } = askCandidates(possible, appToday(), hasDateTerm(expr))
        const todo = rows.filter((t) => !known.has(t.id))
        setState({ asking: { words, judged: 0, total: todo.length } })
        if (todo.length) result.failures.push(...await core.link.call("judgeAsk", { words, ids: todo.map((t) => t.id) }, {
          ai,
          signal: run.signal,
          onProgress: (scores) => {
            if (!run.isCurrent()) return
            for (const [id, p] of scores) known.set(id, p)
            setAskVersion((v) => v + 1)
            setState("asking", (a) => a && { ...a, judged: a.judged + scores.length })
          },
        }))
        if (!run.isCurrent()) return null
        const matched = rows.filter((t) => (known.get(t.id) ?? 0) >= MATCH_AT).length
        const near = rows.filter((t) => { const p = known.get(t.id) ?? 0; return p >= NEAR_AT && p < MATCH_AT }).length
        result.terms.push({ words, rows: rows.length, asked: todo.length, matched, near, skipped })
      }
    } catch (error) {
      if (!run.isCurrent()) return null
      throw error
    } finally {
      if (run.isCurrent()) setState({ asking: null })
    }
    result.ms = Date.now() - started
    return result
  }

  return { askAbout }
}
