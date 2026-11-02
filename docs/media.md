# The README's media

The README's videos and screenshots are made from the demo (`--demo`, made-up data) and the setup's tour (`--welcome`),
never from your history. Each run of the app gets an empty, throwaway `JASKMONEY_HOME`.

```bash
bun run recordings [binary] [--only=overview,filter,ask,suggest,chart]
bun run screenshots [binary]
```

Without `binary`, both build `dist/jaskmoney` first. The outputs:

- **MP4s:** `dist/recordings/<scene>.mp4`, the README's videos.
- **`.cast` files:** `dist/recordings/<scene>.cast`, each loop as an asciicast.
- **PNGs:** `docs/screenshots/{transactions,budgets,settings}.png`, committed.

## Getting the videos into the README

GitHub plays a video in a README only if it was uploaded through github.com's editor. A video in the repo is stripped
from the page, even in a `<video>` tag. To replace one:

1. Edit README.md on github.com and drag the new MP4 in. GitHub puts its link (`https://github.com/user-attachments/assets/<id>`)
   where you drop it.
2. Move that link to the scene's place, and delete the old one.

A link on its own line renders as a player in a box with the file name and a collapse arrow. GitHub draws that box
for every uploaded video, and the README can't remove it. The links don't carry their file names; to tell which is
which, download each and compare its checksum or length with `dist/recordings`.

Where each scene goes:

| Scene | Place in the README |
| --- | --- |
| `overview` | the hero, under the intro |
| `filter` | In action › Filter |
| `ask` | In action › Smart search |
| `suggest` | In action › Suggestions |
| `chart` | In action › Charts |

GIFs were tried first. A GIF at this size and frame rate is more than a browser decodes smoothly, so they looked like
they dropped frames even though every frame was in the file.

## How it works

Recording works the way `asciinema rec` does. Drawing is done by asciinema's renderer, agg (it writes GIFs; ffmpeg
turns its frames into the MP4).

1. **Record.** `scripts/cast.ts` (`startApp`) runs the app in a 188×55 pseudo-terminal (Bun's `terminal` option to
   `Bun.spawn`). It keeps every write with its time and presses the scene's keys on time. A recording is exactly one
   loop:
   - **The hero (`overview`):** the Overview's top chart steps through every view with `l`, one every
     `CHART_VIEW_MS`, the tour's pace. The recording sets chart motion to "always" in its own `settings.json`. It
     starts one view back, so the loop ends on the same switch it begins with.
   - **The tour's demos:** each demo is restarted with →, or ← for Charts. The loop length is `demoLoopMs`
     (`src/state/tour.ts`), the demo's own script length.
2. **Make the cast.** `cast(from, to)` writes the loop as an asciicast. The first event at 0 holds everything written
   before the loop, then each write follows at its own time. The loop starts at the first write that changes the
   title row (the demo pane's top, or the Overview's top chart), not at the key press. The app's first writes after a
   key can land elsewhere, such as the tour's card, and a video's first frame is its preview.
3. **Draw.** `draw` runs agg with MesloLGS Nerd Font Mono at 26 px, then crops the result with ffmpeg:
   - **Line height 1.262:** the font's own (hhea ascent+descent+gap). It's what Windows Terminal draws: the Up logo
     comes out equilateral, the way it looks there.
   - **`--fps-cap 100`:** agg keeps every frame the app drew, about one every 16 ms. agg's default of 30 drops about
     half of each chart's draw-in. The MP4 is 50 fps, from agg's frames.
   - **Fallback fonts:** DejaVu Sans Mono supplies braille, which the line charts use and MesloLGS lacks. Emoji come
     from Windows' Segoe UI Emoji, as in Windows Terminal; MesloLGS has icons but no emoji.
   - **U+FE0F becomes a space:** agg draws the emoji variation selector as a box of its own. The app gives the emoji
     two cells, and the space keeps them.
   - **Demo panes:** the tour's demos are cropped to the pane below the tour's card. The pane is found from its box
     corners in `screenText`, a minimal screen model that is enough because the app places every run of text with a
     cursor move.
   - **Encoding:** agg and ffmpeg run two at a time.

You'll need agg (`cargo install --git https://github.com/asciinema/agg`), ffmpeg, MesloLGS Nerd Font Mono in
`~/.local/share/fonts/meslo`, and DejaVu Sans Mono.

## Known

- **Speed:** a full `recordings` run takes about 4 minutes. That's mostly agg drawing the tour's demos full screen:
  the tour's ticker-tape backdrop moves on every frame, though only the pane is kept. To fix it, crop the `.cast` to
  the pane before agg sees it. It's untried.
- **Videos uploaded so far:** the README's videos are from the agg pipeline's first run, with their stale first frame
  trimmed by hand. `bun run screenshots` hasn't been run on agg yet; the PNGs are from the earlier pipeline.

## Tried and dropped

- **GIFs in the repo:** see above; browsers don't play them smoothly at this size.
- **xterm.js in Chrome** (ttyd, Chrome's DevTools Protocol): Chrome screenshots made the first GIFs. It can't
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
