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
- `bun run server`: the core alone, serving the web app and clients on port 4417 (`JASKMONEY_DB`,
  `JASKMONEY_PORT`). It prints the web app's address and the `--connect` command.
- `bun start --serve[=port]` (`bun run dev -- --serve`): the TUI, also serving its core, so the web app shares
  it live. The status line shows the web app's address.
- `bun start --connect ws://127.0.0.1:4417/api`: the TUI as a client of a running server. What needs
  credentials (sync, smart search, `ask:`, rule writing) runs in the core, with the core's credentials.

Run one core per database. Two cores on one file each keep their own copy and won't see each other's writes.

### The web app installed on a phone

The page is an installable app (`server/webBuild.ts`): a manifest, icons, and a service worker (`src/web/sw.js`)
told the build's version (a hash of its files) and the files to keep. Only the app opened from a home screen
registers the worker (`src/web/pwa.ts`); a browser tab loads the newest build each visit. The installed app
opens on the build it keeps; a newer build downloads in the background and waits until Update (Settings › App,
or the toast). `/?network` loads the page from the server past the kept build (signing in again to whatever
stands in front of the core).

## Security

The server listens on 127.0.0.1 only, and `/api` answers:

- **A loopback host name** (`127.0.0.1`, `localhost`, `[::1]`): a DNS-rebound page reaches 127.0.0.1 under its
  own host name, and is refused (421).
- **No foreign origin**: a browser may connect only from the server's own page (WebSockets ignore CORS), so a
  site open in your browser can't reach for localhost (403).

There is no token: anything running as a user on this machine can connect, and the core can read files
(`previewImport`) and change credentials. Serving it beyond this machine (a tunnel, a proxy) is outside the
project: put a login in front, and present requests to it as local (loopback host, its own origin).

## The wire

A state message carries whole slices in `patch`, and only what changed for the big ones: `keyed` for the
suggestions, notes, merchant checks and purchase lookups (by entry), `rows` for the transactions (by row, with
their order when it changed). `client/wsLink` puts the slices back together, so a client store sees whole
slices either way. In-process, `client/localLink` copies everything but the transactions as JSON on each write,
so the TUI behaves as a socket client would (the key bench shows no cost).

## Adding a UI

1. `createClientStore(wsLink(url))`, then render from `data.state` and its memos. `src/web/main.ts` is ~100
   lines of DOM doing this.
2. A new behaviour that touches the database, files, credentials or a model goes in the core as a command; one
   that only changes how a client looks at rows goes in the client store.
3. A client asks the core whether a service is set up (`state.jev`, `clairic`, `llm`, `upToken`), never its
   own environment.
4. Not yet: the server doesn't sync with Up on a timer by itself (a connected TUI's sync runs there); UI prefs
   (range, chart views) are the core's, so clients share them; the TUI's AI settings dialog shows the values in
   its own environment while saving to the core's; `ai`/`llm`/`models` stand-ins in calls work in-process only (tests).
