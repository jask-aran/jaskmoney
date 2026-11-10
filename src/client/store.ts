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

export interface TagReview extends TagTarget {
  candidates: Record<number, TagCandidate>
  asking: boolean
}

export interface AskResult {
  terms: Array<{ words: string; rows: number; asked: number; matched: number; near: number; skipped: number }>
  failures: string[]
  ms: number
  dated: boolean
}

interface ViewState {
  uncategorisedOnly: boolean
  tagReview: TagReview | null
  askLoose: boolean | null
  asking: { words: string; judged: number; total: number } | null
  accountSelection: AccountSelection
  filterQuery: string
  filterExpr: FilterNode | null
  filterErr: string
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
  sortAscending: false,
})

export function createClientStore(initialLink: CoreLink) {
  const [state, setState] = createStore<DataState>({ ...emptyCoreState(), ...initialView() })
  const { core, connect, start } = createMirror(initialLink, state, setState, newSession)
  const history = createHistoryRows(state)
  const { transactions, accountScoped } = history
  const askState = createAskState(state, () => askCounts.nearMissesShown())
  const { askVerdicts, askRuns, setAskVersion, askScore } = askState
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

  function newSession() {
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

  function resetView() {
    newSession()
    setAskVersion(0)
    setState(initialView())
  }

  start()

  return {
    state, setState, connect, resetView,
    ...history, ...table, askScore, ...askCounts, ...view,
    setAskLoose: (on: boolean | null) => setState({ askLoose: on }),
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
