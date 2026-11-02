# The README's media

The README's GIFs and screenshots are made from the demo (`--demo`, made-up data) and the setup's tour (`--welcome`),
never from your history. Each run of the app gets an empty, throwaway `JASKMONEY_HOME`.

```bash
bun run recordings [binary] [--only=overview,filter,ask,suggest,chart]
bun run screenshots [binary]
```

Without `binary`, both build `dist/jaskmoney` first. The outputs:

- **GIFs:** `docs/screenshots/<scene>.gif`, the ones the README shows. GitHub plays a GIF from the repo.
- **MP4s:** `dist/recordings/<scene>.mp4`. GitHub plays an MP4 in a README only if it's uploaded through its web editor.
- **`.cast` files:** `dist/recordings/<scene>.cast`, each loop as an asciicast.
- **PNGs:** `docs/screenshots/{transactions,budgets,settings}.png`.

## How it works

Recording works the way `asciinema rec` does. Drawing is done by asciinema's GIF renderer, agg.

1. **Record.** `scripts/cast.ts` (`startApp`) runs the app in a 188×55 pseudo-terminal (Bun's `terminal` option to
   `Bun.spawn`). It keeps every write with its time and presses the scene's keys on time. A recording is exactly one
   loop:
   - **The hero (`overview`):** the Overview's top chart steps through every view with `l`, one every
     `CHART_VIEW_MS`, the tour's pace. The recording sets chart motion to "always" in its own `settings.json`. It
     starts one view back, so the loop ends on the same switch it begins with.
   - **The tour's demos:** each demo is restarted with →, or ← for Charts. The loop length is `demoLoopMs`
     (`src/state/tour.ts`), the demo's own script length.
2. **Make the cast.** `cast(from, to)` writes the loop as an asciicast. The first event at 0 holds everything written
   before the loop, then each write follows at its own time.
3. **Draw.** `draw` runs agg with MesloLGS Nerd Font Mono at 26 px, then crops the result with ffmpeg:
   - **Line height 1.262:** the font's own (hhea ascent+descent+gap). It's what Windows Terminal draws: the Up logo
     comes out equilateral, the way it looks there.
   - **`--fps-cap 100`:** agg keeps every frame the app drew, about one every 16 ms. agg's default of 30 drops about
     half of each chart's draw-in. GIF frames still last at least 20 ms, because browsers slow anything shorter to
     100 ms.
   - **Fallback fonts:** DejaVu Sans Mono supplies braille, which the line charts use and MesloLGS lacks. Emoji come
     from Windows' Segoe UI Emoji, as in Windows Terminal; MesloLGS has icons but no emoji.
   - **U+FE0F becomes a space:** agg draws the emoji variation selector as a box of its own. The app gives the emoji
     two cells, and the space keeps them.
   - **Demo panes:** the tour's demos are cropped to the pane below the tour's card. The pane is found from its box
     corners in `screenText`, a minimal screen model that is enough because the app places every run of text with a
     cursor move.
   - **Encoding:** each GIF uses a two-pass palette. agg and ffmpeg run two at a time.

You'll need agg (`cargo install --git https://github.com/asciinema/agg`), ffmpeg, MesloLGS Nerd Font Mono in
`~/.local/share/fonts/meslo`, and DejaVu Sans Mono.

## Known

- **Speed:** a full `recordings` run takes about 4 minutes. That's mostly agg drawing the tour's demos full screen:
  the tour's ticker-tape backdrop moves on every frame, though only the pane is kept. To fix it, crop the `.cast` to
  the pane before agg sees it. It's untried.
- **Not checked:** the agg pipeline has been run end to end, but its output hasn't been looked over or committed. The
  GIFs in `docs/screenshots` come from the earlier pipeline (below). `bun run screenshots` hasn't been run on agg yet.

## Tried and dropped

- **xterm.js in Chrome** (ttyd, Chrome's DevTools Protocol): Chrome screenshots were the previous GIFs. It can't
  photograph a terminal as fast as the app draws, even on a GPU. So it recorded the output, then replayed it a frame
  at a time, which made it slow and fiddly:
  - ttyd's listener had to be muted, or the live app wrote into the replay.
  - The renderer kept stale cells unless every row was repainted.
  - WSL's headless Chrome has no GPU and draws in software.

  Its cells came out slightly too tall, and it laid emoji with U+FE0F out a cell short.
- **VHS:** the same xterm.js-in-Chrome setup, filmed live, so it drops frames.
- **Screenshots of a real terminal pane (herdr):** they showed gaps between box-drawing characters, and nothing can be
  scripted to a frame.
- **One-pass GIF palettes in ffmpeg** (`split` and `palettegen`): every frame waits in memory for the palette. With
  several full-screen encodes at once, WSL ran out of memory (2026-11-02).
