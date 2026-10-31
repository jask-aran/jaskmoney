/**
 * Settings › Taxonomy: the categories (groups, and the ones in each under
 * it) and the tags, as the TUI's two lists; a row opens its editor (the
 * TUI's: name, colour, spending; a tag's categories and about), "+ New"
 * an empty one. A delete takes two presses.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { fuzzyScore } from "../../../domain/fuzzy"
import { scopeText, tagCovers } from "../../../domain/tagScope"
import type { Category, Tag } from "../../../domain/types"
import { theme } from "../../../theme"
import { Chips } from "../../ui"
import { data, fail, kept, say } from "../../store"
import { catColor } from "../../theme"
import { confirmTwice, disarm, isArmed } from "./confirm"
import { Group, Line, Switch } from "./lines"

type Kind = "category" | "tag"
type Editing = { kind: Kind; id: number | null }

/** The colours offered: the palette's accents. A category's or tag's colour is data. */
const SWATCHES = (["rosewater", "flamingo", "pink", "mauve", "red", "maroon", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender"] as const).map((name) => theme[name])
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
  const [list, setList] = kept<"categories" | "tags">("settings.list", "categories")
  const [editing, setEditing] = createSignal<Editing | null>(null)
  const rows = createMemo(() => categoryRows(data.state.categories))
  const edit = (kind: Kind, id: number | null) => { disarm(); setEditing({ kind, id }) }
  const close = () => { disarm(); setEditing(null) }
  // A phone shows one list at a time (the TUI's narrow layout): the chooser takes the title's place.
  const chooser = () => (
    <Chips class="st-narrow-only" value={list()} onChange={setList} options={[
      { value: "categories", label: "Categories" }, { value: "tags", label: "Tags" },
    ]} />
  )
  const add = (kind: Kind) => <button type="button" class="btn small ghost" onClick={() => edit(kind, null)}>+ New</button>
  return (
    <div class="st-tax" data-list={list()}>
      <Group class="st-cats" lead={chooser()} title="Categories" count={data.state.categories.length} aside={add("category")}>
        <div class="st-scroll">
          <For each={rows()} fallback={<div class="st-none">No categories.</div>}>{(row) => (
            <Line indent={row.child} strong={row.group} title={`Edit ${row.category.name}`} onClick={() => edit("category", row.category.id)}
              lead={<span class="dot" style={{ background: catColor(row.category.color) }} />}
              label={<span classList={{ label: row.child }}>{row.category.name}</span>} meta={row.note || undefined} />
          )}</For>
        </div>
      </Group>
      <Group class="st-tags" lead={chooser()} title="Tags" count={data.state.tags.length} aside={add("tag")}>
        <div class="st-scroll">
          <For each={data.state.tags} fallback={<div class="st-none">No tags.</div>}>{(tag) => (
            <Line title={tag.about ? `${tag.name}: ${tag.about}` : `Edit ${tag.name}`} onClick={() => edit("tag", tag.id)}
              lead={<span class="dot" style={{ background: catColor(tag.color) }} />}
              label={tag.name} meta={tagNote(tag, data.state.categories) || undefined} />
          )}</For>
        </div>
      </Group>
      <Show when={editing()} keyed>{(e) => (
        e.kind === "category"
          ? <CategoryEditor id={e.id} onClose={close} />
          : <TagEditor id={e.id} onClose={close} />
      )}</Show>
    </div>
  )
}

/** A dialog: owns the keyboard until it closes (esc closes). */
export function Dialog(props: { title: string; subtitle?: string; onClose: () => void; onSubmit: () => void; footer: JSX.Element; children: JSX.Element }) {
  let form!: HTMLFormElement
  onMount(() => (form.querySelector("input, textarea") as HTMLElement | null)?.focus())
  return (
    <Portal>
      <div class="st-scrim" onClick={props.onClose} />
      <form ref={form} class="st-dialog" role="dialog" aria-modal="true" aria-label={props.title}
        on:keydown={(event) => {
          event.stopPropagation()
          if (event.key === "Escape") { event.preventDefault(); props.onClose() }
        }}
        onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
        <header>
          <h3>{props.title}</h3>
          <Show when={props.subtitle}><span class="note small">{props.subtitle}</span></Show>
          <button type="button" class="btn small ghost st-close" aria-label="Close" onClick={props.onClose}>esc</button>
        </header>
        <div class="st-form">{props.children}</div>
        <footer>{props.footer}</footer>
      </form>
    </Portal>
  )
}

function ColourField(props: { value: string; onChange: (value: string) => void }) {
  return (
    <div class="st-field">
      <span class="st-field-label">Colour</span>
      <div class="st-swatches">
        <For each={SWATCHES}>{(colour) => (
          <button type="button" class="st-swatch" classList={{ on: colour.toLowerCase() === props.value.toLowerCase() }} style={{ background: colour }} title={colour} aria-label={colour} onClick={() => props.onChange(colour)} />
        )}</For>
        <span class="st-hex">
          <span class="dot" style={{ background: HEX.test(props.value) ? props.value : "transparent" }} />
          <input class="field mono" value={props.value} maxLength={7} spellcheck={false} aria-label="Colour, as #rrggbb" onInput={(e) => props.onChange(e.currentTarget.value.trim())} />
        </span>
      </div>
    </div>
  )
}

/** Save, cancel, and (an existing one) delete on a second press. */
function EditorFooter(props: { armKey: string | null; what: string; saving: boolean; canDelete?: boolean; deleteTitle?: string; onDelete: () => void; onClose: () => void }) {
  return (
    <>
      <Show when={props.armKey}>{(key) => (
        <button type="button" class="btn small st-delete" classList={{ armed: isArmed(key()) }} data-arm={key()} disabled={props.canDelete === false} title={props.deleteTitle}
          onClick={() => confirmTwice(key(), `delete ${props.what}`, props.onDelete)}>
          {isArmed(key()) ? "Press again to delete" : "Delete"}
        </button>
      )}</Show>
      <span class="grow" />
      <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
      <button type="submit" class="btn primary" disabled={props.saving}>{props.saving ? "Saving…" : "Save"}</button>
    </>
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
    <Dialog title={props.id == null ? "New category" : "Edit category"} subtitle={original?.isDefault ? "the default category" : undefined} onClose={props.onClose} onSubmit={submit}
      footer={<EditorFooter armKey={original ? `category:${original.id}` : null} what={original?.name ?? ""} saving={saving()} canDelete={!original?.isDefault}
        deleteTitle={original?.isDefault ? "The default category can't be deleted" : undefined} onDelete={remove} onClose={props.onClose} />}>
      <label class="st-field">
        <span class="st-field-label">Name</span>
        <input class="field" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Groceries" />
      </label>
      <ColourField value={color()} onChange={setColor} />
      <div class="st-field">
        <span class="st-field-label">Spending</span>
        <div class="row">
          <Switch on={!notSpending()} label="Counts as spending" onClick={() => setNotSpending(!notSpending())} />
          <span class={notSpending() ? "label" : "figure"}>{notSpending() ? "no, excluded from spending and income" : "yes"}</span>
        </div>
      </div>
    </Dialog>
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
  const named = createMemo(() => ids().map((id) => data.state.categories.find((c) => c.id === id)).filter((c): c is Category => !!c))
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
    <Dialog title={props.id == null ? "New tag" : "Edit tag"} onClose={props.onClose} onSubmit={submit}
      footer={<EditorFooter armKey={original ? `tag:${original.id}` : null} what={original?.name ?? ""} saving={saving()} onDelete={remove} onClose={props.onClose} />}>
      <label class="st-field">
        <span class="st-field-label">Name</span>
        <input class="field st-upper" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="HOLIDAY" />
      </label>
      <ColourField value={color()} onChange={setColor} />
      <div class="st-field">
        <span class="st-field-label">Categories <span class="note">· its own come first in the tag picker</span></span>
        <div class="st-picked">
          <For each={named()} fallback={<span class="note small">any</span>}>{(c) => (
            <button type="button" class="tagchip on" title={`Remove ${c.name}`} onClick={() => toggle(c.id)}>
              <span class="dot" style={{ background: catColor(c.color) }} />{c.name}<span class="note">×</span>
            </button>
          )}</For>
        </div>
        <input class="field" placeholder="Type to find a category" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="st-choices">
          <For each={choices()} fallback={<div class="note small st-none">No category matches</div>}>{(row) => (
            row.kind === "heading"
              ? <div class="st-choice-head">{row.label}</div>
              : (
                <button type="button" class="st-choice" classList={{ on: ids().includes(row.id) }} aria-pressed={ids().includes(row.id)} onClick={() => toggle(row.id)}>
                  <span class="dot" style={{ background: catColor(row.color) }} />
                  <span class="ellipsis">{row.label}</span>
                </button>
              )
          )}</For>
        </div>
      </div>
      <label class="st-field">
        <span class="st-field-label">About</span>
        <textarea class="field" rows={2} value={about()} onInput={(e) => setAbout(e.currentTarget.value)} placeholder="What it's for, in words: Jev reads it when finding its transactions" />
      </label>
      <div class="small" classList={{ good: ids().length > 0, note: !ids().length }}>{ids().length ? "● " : ""}{note()}</div>
    </Dialog>
  )
}
