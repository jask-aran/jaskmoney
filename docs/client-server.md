# Core, clients and the server

jaskmoney is one **core** and any number of **clients**. The TUI is a client like any other.

```
            ┌──────────────────────── core (src/core) ────────────────────────┐
            │ database · settings.json · credentials · Up · Jev · LLM · undo │
            │ state: CoreState            commands: core.commands            │
            └───────────────┬───────────────────────────────┬────────────────┘
               localLink (in-process)            server/serve (WebSocket /api)
                            │                               │
                 client store (src/client/store)   client store (same code)
                            │                               │
                 TUI (state/dataStore, app, ui)    web app (src/web) · future UIs
```

## The contract (`src/core/protocol.ts`)

- **State.** The core owns `CoreState`: the rows, categories, tags, rules, budgets, suggestions, settings, what
  undo would undo, and activity flags (`upSyncing`, `suggesting`…). A client gets the whole state when it
  connects, then patches (only the slices that changed). It never writes this state itself.
- **Commands.** Everything else is a call: `{ t: "call", id, method, params }` → `{ t: "result", id, value | error }`.
  The methods are `core.commands` in `src/core/core.ts`; their params and results are the protocol's types
  (`CoreParams<M>`, `CoreResult<M>`). Long ones report `{ t: "progress" }` (`CoreProgress`), and a client can
  `{ t: "cancel", id }`.
- **Ordering.** A command's state patches arrive before its result: when a call resolves, the client's mirror
  already shows what it did.

## The client store (`src/client/store.ts`)

The reactive layer every UI shares (Solid stores and memos, no DOM, no terminal, no Node): the mirror of
`CoreState`, the client's own **view state** (filter, sort, account selection, a tag review, `ask:` verdicts),
the rows derived from both (`scopedTransactions`, `askCounts`, `allRuleOffers`…), and the commands as methods.
View state is per client: the web app's filter doesn't change the TUI's.

## Running it

- `bun start` / `bun run dev`: the TUI with its core in-process (as before).
- `bun run server`: the core alone, serving the web app at `http://127.0.0.1:4417/` and clients at `/api`
  (`JASKMONEY_DB`, `JASKMONEY_PORT`).
- `bun start --serve[=port]`: the TUI, also serving its core, so the web app shares it live.
- `bun start --connect ws://host:port/api`: the TUI as a client of a running server.

Run one core per database. Two cores on one file each keep their own copy and won't see each other's writes.

## Security

The server listens on 127.0.0.1. Browsers can open WebSockets to any localhost port whatever page they're on, so
`/api` refuses a browser whose origin isn't the server's own page. Set `JASKMONEY_SERVER_TOKEN` to require
`/api?token=…` too (the web app passes its own `?token=` through) before listening anywhere else.

## Adding a UI

1. `createClientStore(wsLink(url))`, then render from `data.state` and its memos. `src/web/main.ts` is ~100
   lines of DOM doing this.
2. A new behaviour that touches the database, files, credentials or a model goes in the core as a command; one
   that only changes how a client looks at rows goes in the client store.
3. Not yet: the server doesn't sync with Up on a timer by itself (a connected TUI's sync runs there), and
   `ai`/`llm` stand-ins in calls work in-process only (tests).
