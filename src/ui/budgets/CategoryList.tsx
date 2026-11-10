import { Index, Show, createMemo } from "solid-js"
import { budgetArmId, budgetSetupRows, overallAverage, type SetupRow } from "../../domain/budgetLines"
import { formatWholeMoney } from "../../domain/dashboard"
import { armedFor } from "../../state/armed"
import { data } from "../../state/dataStore"
import { cycleView, cycleViewsFor, ui } from "../../state/uiStore"
import { ink, theme, tone } from "../../theme"
import { viewPicker } from "../charts/ChartCard"
import { categoryMark } from "../icons"
import { ListRow, centredTop } from "../primitives/ListRow"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import { type Span } from "../primitives/spans"
import { regionRef } from "../regions"
import { fit } from "../text"
import { createBudgetInputs, createBudgetPlan, createBudgetProgress } from "./budgetsModel"
import { createPlanFlow, createPlanLines } from "./BudgetsPane"
import { CALENDAR_TALL, createBudgetLayout, panePointer } from "./BudgetsTab"

export function createCategoryRows(input: Pick<ReturnType<typeof createBudgetLayout>, "listInSide" | "rowWidth" | "categoriesWidth" | "cyclePaneWidth"> & Pick<ReturnType<typeof createBudgetProgress>, "ignored" | "progress" | "totalProgress" | "lines" | "split"> & Pick<ReturnType<typeof createBudgetInputs>, "budgets" | "label" | "ALL">) {
  const { listInSide, rowWidth, categoriesWidth, cyclePaneWidth, ignored, budgets, label, progress, ALL, totalProgress, lines, split } = input
  const NUM = 9
  const listWidth = () => (listInSide() ? rowWidth(categoriesWidth()) : Math.min(LIST_MAX, rowWidth(cyclePaneWidth(0))))
  const withAverage = (w = listWidth()) => w - NUM * 3 >= 14
  const nameWidth = (w = listWidth()) => w - NUM * (withAverage(w) ? 3 : 2)
  const lineSpans = (row: Extract<SetupRow, { kind: "line" }>, w = listWidth(), brief = false): Span[] => {
    const line = row.line
    const out = line.categoryId !== null && ignored().has(line.categoryId)
    const name = line.child ? ink.label : ink.figure
    const chevron = row.open === null || brief ? "  " : row.open ? "▾ " : "▸ "
    return [
      { text: line.child ? "    " : chevron, fg: ink.note },
      { text: `${line.categoryId === null ? "?" : categoryMark(line.categoryId)} `, fg: out ? ink.faint : line.color ?? ink.note },
      { text: fit(line.name, nameWidth(w) - (line.child ? 6 : 4)), fg: out ? ink.note : name, bold: !line.child },
      { text: formatWholeMoney(line.now).padStart(NUM), fg: out ? ink.note : line.budget && line.now > line.budget.amount ? tone.bad : name },
      ...(withAverage(w) ? [{ text: formatWholeMoney(line.average).padStart(NUM), fg: ink.note }] : []),
      line.budget ? { text: formatWholeMoney(line.budget.amount).padStart(NUM), fg: ink.figure }
        : out ? { text: "left out".padStart(NUM), fg: ink.faint }
        : row.open === false && row.budgeted ? { text: `${row.budgeted} set`.padStart(NUM), fg: ink.note }
        : { text: "".padStart(NUM), fg: ink.faint },
    ]
  }
  const overallBudget = () => budgets().find((b) => b.scope.kind === "overall") ?? null
  const figureRow = (name: string, nameFg: string, spentNow: number, average: number | null, budget: number | null, w = listWidth()): Span[] => [
    { text: "  ", fg: ink.note },
    { text: fit(name, nameWidth(w) - 2), fg: nameFg, bold: true },
    { text: formatWholeMoney(spentNow).padStart(NUM), fg: budget != null && spentNow > budget ? tone.bad : nameFg },
    ...(withAverage(w) ? [{ text: (average == null ? "" : formatWholeMoney(average)).padStart(NUM), fg: ink.note }] : []),
    { text: (budget == null ? "" : formatWholeMoney(budget)).padStart(NUM), fg: ink.figure },
  ]
  const rowSpans = (row: SetupRow, w = listWidth(), brief = false): Span[] => {
    if (row.kind === "line") return lineSpans(row, w, brief)
    if (row.kind === "account") return figureRow(label(row.budget), ink.figure, progress().get(row.budget.id)?.spent ?? 0, null, row.budget.amount, w)
    return figureRow(ALL, ink.strong, totalProgress().spent, overallAverage(lines(), ignored()), split().total || null, w)
  }
  const rowBudget = (row: SetupRow) => (row.kind === "line" ? row.line.budget : row.kind === "account" ? row.budget : overallBudget())
  return { NUM, overallBudget, nameWidth, withAverage, rowBudget, rowSpans }
}

export function createCategoryRoom(input: Pick<ReturnType<typeof createBudgetLayout>, "categoriesHeight" | "listInSide" | "cyclePaneHeight"> & Pick<ReturnType<typeof createPlanLines>, "topLines"> & Pick<ReturnType<typeof createPlanFlow>, "nextPayBlock" | "flowBlock"> & Pick<ReturnType<typeof createBudgetProgress>, "setup" | "lines" | "categoryCursor"> & Pick<ReturnType<typeof createBudgetInputs>, "budgets" | "view">) {
  const { categoriesHeight, topLines, nextPayBlock, flowBlock, listInSide, setup, cyclePaneHeight, lines, budgets, categoryCursor, view } = input
  const calendarRows = () => {
    const room = categoriesHeight() - 4 - topLines().length - nextPayBlock() - flowBlock() - 2 - Math.min((listInSide() ? setup() : briefRows()).length, BUDGETS_ROWS_MIN)
    return room >= CALENDAR_TALL ? CALENDAR_TALL : room >= CALENDAR_MIN ? CALENDAR_MIN : 0
  }
  const calendarBlock = () => (calendarRows() ? calendarRows() + 2 : 0)
  const categoryRoom = () => Math.max(1, listInSide() ? categoriesHeight() - 4 - topLines().length - calendarBlock() - nextPayBlock() - flowBlock() : cyclePaneHeight(0) - 3)
  const categoryLines = setup
  const briefRows = createMemo(() => budgetSetupRows(lines(), new Set(), budgets()))
  const briefRoom = () => Math.max(0, categoriesHeight() - 4 - topLines().length - calendarBlock() - nextPayBlock() - flowBlock() - 1)
  const categoryTop = createMemo(() => centredTop(categoryCursor(), categoryLines().length, categoryRoom()))
  const nothingSet = () => view().current && budgets().length === 0 && !data.state.uiPrefs.expectedPay

  return { categoryLines, categoryTop, categoryRoom, nothingSet, calendarRows, briefRows, briefRoom }
}

export function createCategoryList(input: Pick<ReturnType<typeof createCategoryRoom>, "categoryLines" | "categoryTop" | "categoryRoom"> & Pick<ReturnType<typeof createCategoryRows>, "nameWidth" | "NUM" | "withAverage" | "rowBudget" | "rowSpans"> & Pick<ReturnType<typeof createBudgetPlan>, "categoriesFocused"> & Pick<ReturnType<typeof createBudgetProgress>, "categoryCursor"> & Pick<ReturnType<typeof createBudgetInputs>, "cycle"> & Pick<ReturnType<typeof createBudgetLayout>, "cyclePaneWidth" | "cyclePaneHeight">) {
  const { categoryLines, nameWidth, NUM, withAverage, categoryTop, categoryRoom, categoriesFocused, categoryCursor, rowBudget, cycle, rowSpans, cyclePaneWidth, cyclePaneHeight } = input
  const CategoryList = (p: { heading: string }) => (
  <Show when={categoryLines().length} fallback={<text fg={ink.note}>{" No spending yet."}</text>}>
    <text wrapMode="none">
      <S fg={ink.note}>{" "}</S>
      <S fg={ink.heading} bold>{fit(p.heading, nameWidth())}</S>
      <S fg={ink.label}>{"Spent".padStart(NUM)}{withAverage() ? "Average".padStart(NUM) : ""}{"Budget".padStart(NUM)}</S>
    </text>
    <Index each={categoryLines().slice(categoryTop(), categoryTop() + categoryRoom())}>{(row, i) => (
      <ListRow cursor={categoriesFocused() && categoryTop() + i === categoryCursor()} bg={theme.canvas} armed={rowBudget(row()) ? armedFor(ui.state.armed, "budget", budgetArmId(rowBudget(row())!, cycle().start)) : undefined} spans={rowSpans(row())} />
    )}</Index>
  </Show>
  )
  const CategoriesPane = () => (
    <box ref={regionRef("bud.categories", "budgets")} width={cyclePaneWidth(0)} height={cyclePaneHeight(0)} flexShrink={0} onMouseDown={panePointer("bud.categories")}>
      <SectionCard title="Categories" titleRight={viewPicker(cycleViewsFor(0).map(cycleView), 0)} focused={categoriesFocused()} width={cyclePaneWidth(0)} height={cyclePaneHeight(0)}>
        <CategoryList heading="Category" />
      </SectionCard>
    </box>
  )
  return { CategoryList, CategoriesPane }
}

const CALENDAR_MIN = 8

const BUDGETS_ROWS_MIN = 5

const LIST_MAX = 72
