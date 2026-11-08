import { createEffect, createMemo, createRoot, createSignal, on } from "solid-js"
import { unwrap } from "solid-js/store"
import { askTerms, evalFilter, hasDateTerm, undecided, type AskVerdict } from "../domain/filter"
import { MATCH_AT, NEAR_AT } from "../domain/questions"
import { askCandidates } from "../domain/ask"
import { appToday } from "../domain/days"
import type { Transaction } from "../domain/types"
import { JEV_SETUP } from "../ai/judge"
import type { JevClient } from "../ai/jev"
import type { AskResult } from "./store"
import type { createHistoryRows } from "./derived"
import type { createMirror } from "./mirror"
import { createLatestRun } from "./latestRun"
import type { SetStoreFunction } from "solid-js/store"
import type { DataState } from "./store"

/** Near misses show by themselves when they don't swamp the results: at
 * most as many as the matches, and a handful whatever the matches. */
export function showNearMisses(matches: number, near: number): boolean {
  return near <= Math.max(matches, 5)
}

export function createAskState(state: DataState, nearMissesShown: () => boolean) {
  /** Jev's probabilities for `ask:` terms this session: words (lower-cased)
   * → row id → how likely the row matches. Each new batch bumps `askVersion`. */
  const askVerdicts = new Map<string, Map<number, number>>()
  const [askVersion, setAskVersion] = createSignal(0)
  /** A row matches at MATCH_AT, or with near misses shown, at NEAR_AT. */
  const verdictAt = (at: number): AskVerdict<Transaction> => (words, t) => {
    const p = askVerdicts.get(words.toLowerCase())?.get(t.id)
    return p == null ? undefined : p >= at
  }
  const askVerdict: AskVerdict<Transaction> = (words, t) => verdictAt(nearMissesShown() ? NEAR_AT : MATCH_AT)(words, t)
  const askRuns = createLatestRun()

  // Map insertion order is recency. Active terms stay even if a filter
  // has more than eight; leaving that filter restores the limit.
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

  /** How likely a row matches the filter's `ask:` terms: the lowest of its
   * judged terms' probabilities (the one holding it back); undefined if none
   * is judged. */
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
  /** With `ask:` terms: rows that match, and near misses (rows that pass
   * only when near misses count). */
  const askCounts = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    if (!askTerms(expr).length) return null
    askVersion()
    const rows = accountScoped().filter(inView)
    const matches = rows.filter((t) => evalFilter(expr, t, verdictAt(MATCH_AT))).length
    const loose = rows.filter((t) => evalFilter(expr, t, verdictAt(NEAR_AT))).length
    return { matches, near: loose - matches }
  }))

  /** Whether near misses are in the table: as `n` last set it, else when
   * they don't outnumber the matches (a few are always worth a look). */
  const nearMissesShown = createRoot(() => createMemo(() => {
    if (state.askLoose != null) return state.askLoose
    const c = askCounts()
    return !!c && c.near > 0 && showNearMisses(c.matches, c.near)
  }))

  return { askCounts, nearMissesShown }
}

export function createAskAction(state: DataState, setState: SetStoreFunction<DataState>, core: ReturnType<typeof createMirror>["core"], accountScoped: ReturnType<typeof createHistoryRows>["accountScoped"], inView: (t: Transaction) => boolean, ask: ReturnType<typeof createAskState>) {
  const { askRuns, askVerdicts, trimAskVerdicts, askVerdict, setAskVersion } = ask
  /**
   * Have Jev judge the rows the current filter's `ask:` terms are waiting
   * on: those the rest of the filter leaves possible, not judged yet, from
   * the last ASK_DEFAULT_DAYS unless the filter limits dates, at most
   * ASK_LIMIT, newest first. Matches show as each batch lands. Returns what
   * was judged (app/searchReport words it), or null when a newer run or a
   * cleared filter took over.
   */
  async function askAbout(ai?: Pick<JevClient, "judge">): Promise<AskResult | null> {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const terms = askTerms(expr)
    if (!terms.length) return null
    if (!ai && !state.jev) throw new Error(`ask: needs Jev (${JEV_SETUP})`)
    const run = askRuns.start()
    const started = Date.now()
    const result: AskResult = { terms: [], failures: [], ms: 0, dated: hasDateTerm(expr) }
    try {
      // One term at a time: each verdict narrows the rows the next must judge.
      for (const words of terms) {
        const key = words.toLowerCase()
        const known = askVerdicts.get(key) ?? new Map<number, number>()
        askVerdicts.delete(key)
        askVerdicts.set(key, known)
        trimAskVerdicts()
        // Rows whose match turns on these words: not ruled out by the rest of
        // the filter, nor matched without them (a covered category's rows).
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
