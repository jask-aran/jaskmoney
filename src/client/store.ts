/**
 * A client's reactive layer over the core: a Solid store mirroring
 * `CoreState` from the core's patches, the view state that is this client's
 * alone (filter, sort, account selection, a tag review, `ask:` verdicts),
 * the rows derived from both, and the core's commands as methods.
 *
 * No database, file or model SDK here: the TUI runs it over an in-process
 * link (state/dataStore) and the web app over a WebSocket (web/main).
 */
import { createStore } from "solid-js/store"
import type { AccountSelection } from "../domain/accountTree"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { TAG_SHOW_AT, type TagCandidate, type TagTarget } from "../domain/tagSuggest"
import type { FilterNode, FilterNote } from "../domain/filter"
import type { SortColumn, Transaction } from "../domain/types"
import { emptyCoreState, type CoreState } from "../core/protocol"
import type { CoreLink } from "./link"
import { createMirror } from "./mirror"
import { createHistoryRows, createSuggestTracking, createRuleOffers } from "./derived"
import { createAskState, createAskCounts, createAskAction } from "./ask"
export { showNearMisses } from "./ask"
import { createTableRows, createViewControls } from "./view"
import { createTagReview } from "./tagReview"
import { createClientCommands, createTransactionCommands, createSettingsCommands, createDataCommands } from "./commands"

/** Finding transactions for a tag: its target and the candidates so far. */
export interface TagReview extends TagTarget {
  candidates: Record<number, TagCandidate>
  /** Jev is still answering. */
  asking: boolean
}

/** What an ask run judged, per `ask:` term: the rows it covered, how many
 * were sent to Jev (the rest were known), and how they came out. */
export interface AskResult {
  terms: Array<{ words: string; rows: number; asked: number; matched: number; near: number; skipped: number }>
  failures: string[]
  ms: number
  /** The filter limits dates (else only the last ASK_DEFAULT_DAYS were judged). */
  dated: boolean
}

/** What this client alone decides: how it looks at the core's rows. */
export interface ViewState {
  /** The Transactions table shows only ordinary uncategorised rows. */
  uncategorisedOnly: boolean
  /** Finding transactions for a tag: the table shows its candidates. */
  tagReview: TagReview | null
  /** `ask:` terms also pass near misses (NEAR_AT up to MATCH_AT): on, off,
   * or null to decide by the counts (`showNearMisses`). */
  askLoose: boolean | null
  /** Jev is judging rows for an `ask:` term. */
  asking: { words: string; judged: number; total: number } | null
  /** Which accounts the Transactions tab shows. Approved deviation from Go's per-account
   * on/off scope (2026-10-26): one selection from the accounts pane. */
  accountSelection: AccountSelection
  filterQuery: string
  filterExpr: FilterNode | null
  filterErr: string
  /** Beside the bar's dot: why it doesn't parse (error), what saving
   * would refuse (warn), or the full form a forgiven search reads as. */
  filterNote: FilterNote | null
  sortColumn: SortColumn
  sortAscending: boolean
}

export type DataState = CoreState & ViewState

const initialView = (): ViewState => ({
  uncategorisedOnly: false,
  tagReview: null,
  askLoose: null,
  asking: null,
  accountSelection: "all",
  filterQuery: "",
  filterExpr: null,
  filterErr: "",
  filterNote: null,
  sortColumn: "date",
  sortAscending: false, // date desc default like Go
})

export function createClientStore(initialLink: CoreLink) {
  const [state, setState] = createStore<DataState>({ ...emptyCoreState(), ...initialView() })
  const { core, connect, start } = createMirror(initialLink, state, setState, newSession)
  const history = createHistoryRows(state)
  const { transactions, accountScoped } = history
  const askState = createAskState(state, () => askCounts.nearMissesShown())
  const { askVerdicts, askRuns, setAskVersion, askScore } = askState
  /** The Uncategorised view's narrowing. */
  const inView = (t: Transaction) => (!state.uncategorisedOnly || (isOrdinaryFlow(t) && isUncategorised(t)))
    && (!state.tagReview || (state.tagReview.candidates[t.id]?.confidence ?? 0) >= TAG_SHOW_AT)

  const askCounts = createAskCounts(state, accountScoped, inView, askState)
  const table = createTableRows(state, accountScoped, inView, askState, askCounts.nearMissesShown)
  const view = createViewControls(state, setState, askRuns)
  const ask = createAskAction(state, setState, core, accountScoped, inView, askState)
  const transactionCommands = createTransactionCommands(core)
  const { stopTagReview, ...tagReview } = createTagReview(state, setState, core, transactions, transactionCommands.applyTagPatch)
  const { suggestTried, ...suggest } = createSuggestTracking(state, transactions)
  const offers = createRuleOffers(state, transactions)
  const clientCommands = createClientCommands(state, core, view.setAccountSelection)
  const settingsCommands = createSettingsCommands(core)
  const dataCommands = createDataCommands(state, core, view.setAccountSelection)

  /** The core opened another database: what this client knew of the last one goes. */
  function newSession() {
    // Verdicts are per row id, and a new database reuses ids.
    askVerdicts.clear()
    askRuns.stop()
    stopTagReview()
    suggestTried.clear()
    setState({
      tagReview: null,
      asking: null,
      ...(!state.uncategorisedOnly && state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}),
    })
  }

  /** Test isolation: the view as it starts (the core's state comes from the core). */
  function resetView() {
    newSession()
    setAskVersion(0)
    setState(initialView())
  }

  // Last: the first patch reaches everything above.
  start()

  return {
    state, setState, connect, resetView,
    ...history, ...table, askScore, ...askCounts, ...view,
    setAskLoose: (on: boolean | null) => setState({ askLoose: on }),
    /** The table's rows are all of them, the uncategorised ones, or a tag
     * review's candidates: never two at once, so each closes the other. */
    setUncategorisedOnly: (on: boolean) => {
      if (on) stopTagReview()
      setState(on
        ? { uncategorisedOnly: true, tagReview: null, sortColumn: "confidence", sortAscending: false }
        : { uncategorisedOnly: false, ...(state.sortColumn === "confidence" ? { sortColumn: "date" as const, sortAscending: false } : {}) })
    },
    ...ask, ...tagReview, ...suggest, ...offers,
    ...clientCommands, ...transactionCommands, ...settingsCommands, ...dataCommands,
  }
}

export type ClientStore = ReturnType<typeof createClientStore>
