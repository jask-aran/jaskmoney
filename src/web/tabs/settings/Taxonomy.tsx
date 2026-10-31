/**
 * Settings › Categories and Tags: the TUI's Taxonomy pane as two sections
 * of rows (a group, then the ones in it indented). A row opens its editor
 * (the TUI's: name, colour, spending; a tag's categories and about), "New"
 * an empty one; the editors are cards over the page. A delete takes two
 * presses. On a phone each list is a row opening it in a sheet, and the
 * editors are sheets: Cancel, the title and Save across the top.
 */
import { For, Show, createMemo, createSignal, createUniqueId, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { fuzzyScore } from "../../../domain/fuzzy"
import { scopeText, tagCovers } from "../../../domain/tagScope"
import type { Category, Tag } from "../../../domain/types"
import { theme } from "../../../theme"
import { ChevronRight } from "lucide-solid"
import { BottomSheet, Section } from "../../kit"
import { compact, data, fail, say } from "../../store"
import { catColor } from "../../theme"
import {
  Button, Card, CardForm, CardNote, DashEmpty, DashRow, Field, GroupAction, Icons, Input, Item, Scrim, SearchSection,
  Section as ListSection, SettingGroup, Swatch, Switch, TextArea, moveCursor,
} from "../../v2"
import { confirmTwice, disarm, isArmed } from "./confirm"

type Kind = "category" | "tag"
type Editing = { kind: Kind; id: number | null }

/** The colours offered: the palette's accents (a category's or tag's colour is data). */
const SWATCHES = (["rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender"] as const)
  .map((name) => ({ name: name[0]!.toUpperCase() + name.slice(1), colour: theme[name] }))
/** What a new one starts as (the TUI's). */
const NEW_COLOR: Record<Kind, string> = { category: "#94e2d5", tag: "#89b4fa" }
const HEX = /^#[0-9a-f]{6}$/i

/** Categories as the TUI draws them: a group, then the ones under it
 * indented; one listed away from its group names it instead. */
function categoryRows(categories: Category[]) {
  const groups = new Set(categories.map((c) => c.parentId).filter((id) => id != null))
  const under = new Set<number>()
  let group: number | null = null
  for (const c of categories) {
    if (c.parentId == null) group = c.id
    else if (c.parentId === group) under.add(c.id)
  }
  return categories.map((c) => {
    const parent = c.parentId != null && !under.has(c.id) ? categories.find((p) => p.id === c.parentId)?.name : null
    const note = c.isDefault ? "default" : parent ? `in ${parent}` : c.income ? "income" : c.notSpending ? "not spending" : ""
    return { category: c, child: under.has(c.id), group: groups.has(c.id), note }
  })
}

/** A tag's scope in words: "in Holidays & Travel", with "· about" when it says what it's for. */
const tagNote = (tag: Tag, categories: Category[]) => {
  const scope = scopeText(tag, categories)
  return [scope ? `in ${scope}` : "", tag.about ? "about" : ""].filter(Boolean).join(" · ")
}

export function Taxonomy() {
  const [editing, setEditing] = createSignal<Editing | null>(null)
  // A phone's list open in its sheet.
  const [sheet, setSheet] = createSignal<Kind | null>(null)
  const rows = createMemo(() => categoryRows(data.state.categories))
  const edit = (kind: Kind, id: number | null) => { disarm(); setEditing({ kind, id }) }
  const close = () => { disarm(); setEditing(null) }
  const categoryList = () => (
    <For each={rows()} fallback={<DashEmpty>No categories.</DashEmpty>}>{(row) => (
      <DashRow element="button" type="button" title={`Edit ${row.category.name}`} onClick={() => edit("category", row.category.id)}
        data-indent={row.child ? "" : undefined} data-group={row.group ? "" : undefined}
        lead={<Swatch colour={catColor(row.category.color)} />} primary={row.category.name} context={row.note || undefined} />
    )}</For>
  )
  const tagList = () => (
    <For each={data.state.tags} fallback={<DashEmpty>No tags.</DashEmpty>}>{(tag) => (
      <DashRow element="button" type="button" title={tag.about ? `${tag.name}: ${tag.about}` : `Edit ${tag.name}`} onClick={() => edit("tag", tag.id)}
        lead={<Swatch colour={catColor(tag.color)} />} primary={tag.name} context={tagNote(tag, data.state.categories) || undefined} />
    )}</For>
  )
  // A phone: a row for each list, opening it in a sheet with New at its head.
  const phone = () => (
    <>
      <SettingGroup title="Categories and tags">
        <button type="button" class="st-nav" onClick={() => setSheet("category")}>
          <span class="grow">Categories</span><span class="st-nav-count">{data.state.categories.length}</span><ChevronRight />
        </button>
        <button type="button" class="st-nav" onClick={() => setSheet("tag")}>
          <span class="grow">Tags</span><span class="st-nav-count">{data.state.tags.length}</span><ChevronRight />
        </button>
      </SettingGroup>
      <Show when={sheet()} keyed>{(kind) => (
        <BottomSheet full label={kind === "category" ? "Categories" : "Tags"} onClose={() => setSheet(null)}
          head={<>
            <span class="jm-drawer-title grow">{kind === "category" ? "Categories" : "Tags"} <span class="st-nav-count">{kind === "category" ? data.state.categories.length : data.state.tags.length}</span></span>
            <span class="st-sheet-acts"><Button variant="secondary" size="sm" onClick={() => edit(kind, null)}><Icons.Add />New</Button></span>
          </>}>
          <div class="st-sheet-list">{kind === "category" ? categoryList() : tagList()}</div>
        </BottomSheet>
      )}</Show>
    </>
  )
  return (
    <div class="st-tax">
      <Show when={!compact()} fallback={phone()}>
        <Section class="st-cats" title="Categories" count={data.state.categories.length} aside={<GroupAction onClick={() => edit("category", null)}><Icons.Add />New</GroupAction>}>
          {categoryList()}
        </Section>
        <Section class="st-tags" title="Tags" count={data.state.tags.length} aside={<GroupAction onClick={() => edit("tag", null)}><Icons.Add />New</GroupAction>}>
          {tagList()}
        </Section>
      </Show>
      <Show when={editing()} keyed>{(e) => (
        e.kind === "category"
          ? <CategoryEditor id={e.id} onClose={close} />
          : <TagEditor id={e.id} onClose={close} />
      )}</Show>
    </div>
  )
}

/** An editor: a card over the dimmed page, owning the keys until it closes (esc closes, enter saves). */
function Editor(props: {
  title: string; detail?: string; wide?: boolean; armKey: string | null; what: string; saving: boolean
  canDelete?: boolean; deleteTitle?: string; onDelete: () => void; onSubmit: () => void; onClose: () => void; children: JSX.Element
}) {
  const formId = createUniqueId()
  let card!: HTMLDivElement
  onMount(() => { if (!compact()) (card.querySelector("input, textarea") as HTMLElement | null)?.focus() })
  const deleteButton = (key: string) => (
    <span data-arm={key} class="st-arm">
      <Button variant="destructive" outline={!isArmed(key)} disabled={props.canDelete === false} title={props.deleteTitle}
        onClick={() => confirmTwice(key, `delete ${props.what}`, props.onDelete)}>
        {isArmed(key) ? "Press again" : "Delete"}
      </Button>
    </span>
  )
  // A phone: a sheet, Cancel and Save either side of the title (the grab area's drag left to the rest of the head).
  if (compact()) return (
    <BottomSheet full label={props.title} onClose={props.onClose}
      head={<div class="st-sheet-head">
        <Button variant="ghost" size="sm" onClick={props.onClose}>Cancel</Button>
        <span class="jm-drawer-title">{props.title}</span>
        <Button type="submit" size="sm" form={formId} disabled={props.saving}>{props.saving ? "Saving…" : "Save"}</Button>
      </div>}>
      <div class="st-sheet-form" ref={card}>
        <Show when={props.detail}><p class="st-sheet-detail">{props.detail}</p></Show>
        <CardForm id={formId} onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>{props.children}</CardForm>
        <Show when={props.armKey}>{(key) => <div class="st-sheet-delete">{deleteButton(key())}</div>}</Show>
      </div>
    </BottomSheet>
  )
  return (
    <Portal>
      <Scrim dialog placement="center" ref={card}
        onClick={(event) => { if (event.target === event.currentTarget) props.onClose() }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === "Escape") { event.preventDefault(); props.onClose() }
        }}>
        <Card title={props.title} detail={props.detail} size={props.wide ? "wide" : undefined} close={props.onClose}
          actions={<>
            <Show when={props.armKey}>{(key) => deleteButton(key())}</Show>
            <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
            <Button type="submit" form={formId} disabled={props.saving}>{props.saving ? "Saving…" : "Save"}</Button>
          </>}>
          <CardForm id={formId} onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>{props.children}</CardForm>
        </Card>
      </Scrim>
    </Portal>
  )
}

/** The colour: the palette's accents as swatches (one chosen), or any #rrggbb. */
function ColourField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <Field plain label="Colour">
      <div class="st-colours" role="radiogroup" aria-label="Colour">
        <For each={SWATCHES}>{(swatch) => (
          <Button variant="ghost" role="radio" aria-label={swatch.name} title={`${swatch.name} ${swatch.colour}`} aria-checked={swatch.colour.toLowerCase() === props.value.toLowerCase()}
            onClick={() => props.onChange(swatch.colour)}><Swatch colour={swatch.colour} fill /></Button>
        )}</For>
      </div>
      <div class="st-hex">
        <Swatch colour={HEX.test(props.value) ? props.value : undefined} hollow={!HEX.test(props.value)} />
        <Input aria-label="Colour, as #rrggbb" value={props.value} maxLength={7} spellcheck={false} onInput={(e) => props.onChange(e.currentTarget.value.trim())} />
      </div>
    </Field>
  )
}

/** Save through the core; the editor stays open until it answers (one save at a time). */
function saver(onClose: () => void) {
  const [saving, setSaving] = createSignal(false)
  const save = (write: () => Promise<unknown>, done = "Saved") => {
    if (saving()) return
    setSaving(true)
    write().then(() => { setSaving(false); say(done); onClose() }, (error) => { setSaving(false); fail(error) })
  }
  return { saving, save }
}

function CategoryEditor(props: { id: number | null; onClose: () => void }) {
  const original = data.state.categories.find((c) => c.id === props.id)
  const [name, setName] = createSignal(original?.name ?? "")
  const [color, setColor] = createSignal(original?.color ?? NEW_COLOR.category)
  const [notSpending, setNotSpending] = createSignal(original?.notSpending ?? false)
  const { saving, save } = saver(props.onClose)
  const submit = () => {
    if (!name().trim()) return say("A category needs a name", true)
    if (!HEX.test(color())) return say("Colour must be #rrggbb", true)
    const input = { name: name().trim(), color: color(), notSpending: notSpending() }
    save(() => (props.id == null ? data.createSettingsCategory(input) : data.updateSettingsCategory(props.id, input)))
  }
  const remove = () => save(() => data.deleteSettingsCategory(props.id!), `Deleted ${original?.name}`)
  return (
    <Editor title={props.id == null ? "New category" : "Edit category"} detail={original?.isDefault ? "The default category" : undefined}
      armKey={original ? `category:${original.id}` : null} what={original?.name ?? ""} saving={saving()} canDelete={!original?.isDefault}
      deleteTitle={original?.isDefault ? "The default category can't be deleted" : undefined} onDelete={remove} onSubmit={submit} onClose={props.onClose}>
      <Field label="Name"><Input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Groceries" /></Field>
      <ColourField value={color()} onChange={setColor} />
      <Field inline label={<>Spending <small class="st-say">{notSpending() ? "no, excluded from spending and income" : "yes"}</small></>}>
        <Switch label="Counts as spending" checked={!notSpending()} onChange={(on) => setNotSpending(!on)} />
      </Field>
    </Editor>
  )
}

type ScopeRow = { kind: "heading"; label: string } | { kind: "item"; label: string; id: number; color: string }

/** A tag's categories to choose from (the TUI's picker): each group under
 * its heading, the whole group first ("All of Food"), then the ones in it;
 * the rest under Other; never the default. Typing: the matches, best first. */
function scopeRows(categories: Category[], query: string): ScopeRow[] {
  const q = query.trim().toLowerCase()
  const groups = new Set(categories.map((c) => c.parentId).filter((id): id is number => id != null))
  const item = (c: Category, label = c.name): ScopeRow => ({ kind: "item", label, id: c.id, color: c.color })
  if (q) {
    return categories.filter((c) => !c.isDefault).flatMap((c) => {
      const score = fuzzyScore(q, c.name)
      return score === null ? [] : [{ score, row: item(c, groups.has(c.id) ? `All of ${c.name}` : c.name) }]
    }).sort((a, b) => b.score - a.score).map((m) => m.row)
  }
  const rows: ScopeRow[] = []
  for (const group of categories.filter((c) => groups.has(c.id))) {
    rows.push({ kind: "heading", label: group.name }, item(group, `All of ${group.name}`), ...categories.filter((c) => c.parentId === group.id).map((c) => item(c)))
  }
  const others = categories.filter((c) => c.parentId == null && !groups.has(c.id) && !c.isDefault)
  if (others.length) rows.push({ kind: "heading", label: "Other" }, ...others.map((c) => item(c)))
  return rows
}

function TagEditor(props: { id: number | null; onClose: () => void }) {
  const original = data.state.tags.find((t) => t.id === props.id)
  const [name, setName] = createSignal(original?.name ?? "")
  const [color, setColor] = createSignal(original?.color ?? NEW_COLOR.tag)
  const [ids, setIds] = createSignal<number[]>([...(original?.categoryIds ?? [])])
  const [about, setAbout] = createSignal(original?.about ?? "")
  const [query, setQuery] = createSignal("")
  const choices = createMemo(() => scopeRows(data.state.categories, query()))
  const named = createMemo(() => ids().map((id) => data.state.categories.find((c) => c.id === id)?.name).filter(Boolean).join(", "))
  // The TUI's note: how many rows its categories hold; About is what Jev reads finding its rows.
  const note = createMemo(() => {
    const reads = about().trim() ? " · Jev reads About" : ""
    if (!ids().length) return `any category${reads}`
    const n = data.transactions().filter(tagCovers({ categoryIds: ids() }, data.state.categories)).length
    return `${n.toLocaleString("en-AU")} txns in its categories${reads}`
  })
  const toggle = (id: number) => setIds((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))
  const { saving, save } = saver(props.onClose)
  const submit = () => {
    if (!name().trim()) return say("A tag needs a name", true)
    if (!HEX.test(color())) return say("Colour must be #rrggbb", true)
    const input = { name: name().trim(), color: color(), categoryIds: ids(), about: about().trim() || null }
    save(() => (props.id == null ? data.createSettingsTag(input) : data.updateSettingsTag(props.id, input)))
  }
  const remove = () => save(() => data.deleteSettingsTag(props.id!), `Deleted ${original?.name}`)
  return (
    <Editor wide title={props.id == null ? "New tag" : "Edit tag"} armKey={original ? `tag:${original.id}` : null} what={original?.name ?? ""}
      saving={saving()} onDelete={remove} onSubmit={submit} onClose={props.onClose}>
      <Field label="Name"><Input class="st-upper" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="HOLIDAY" /></Field>
      <ColourField value={color()} onChange={setColor} />
      {/* Its categories put it first in the tag picker for their rows. */}
      <Field plain label={<>Categories <small class="st-say">{named() || "any"}</small></>}>
        <div class="st-scope">
          <SearchSection placeholder="Find a category" value={query()} onInput={setQuery} />
          <ListSection scroll onPointerOver={moveCursor}>
            <For each={choices()} fallback={<p class="st-none">No category matches</p>}>{(row) => (
              row.kind === "heading"
                ? <div class="ui-title st-scope-group">{row.label}</div>
                : (
                  <Item picked={ids().includes(row.id)} onClick={() => toggle(row.id)} icon={<Swatch colour={catColor(row.color)} />}>{row.label}</Item>
                )
            )}</For>
          </ListSection>
        </div>
      </Field>
      <Field label="About">
        <TextArea rows={2} value={about()} onInput={(e) => setAbout(e.currentTarget.value)} placeholder="What it's for, in words: Jev reads it when finding its transactions" />
      </Field>
      <CardNote>{note()}</CardNote>
    </Editor>
  )
}
