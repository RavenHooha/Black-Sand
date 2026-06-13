# Black Sand

Chop grains of sound out of any track and build atmospheres from them.
Sample-based music making in the DJ Shadow / Phaeleh lineage — you don't play
notes, you sculpt found sound.

## Run it

```bash
npm install
npm run dev
```

Then open the URL it prints (usually http://localhost:5173).

## What works now (v0.6)

- **Import** a track (wav / mp3 / flac / etc.)
- **Waveform** view; **drag** across it to select a region
- **Chop → Grains** carves that region into a new sample
- **Layer mixer:** each grain can **▶ preview**, **↻ loop as a layer**, with its own **volume fader** — stack a few and they build an atmosphere
  - **Pitch** (±12 semitones) and **Tone** (a lowpass) per grain — drop them for the murky low end. Live while a layer loops.
  - **In / Out fades** per grain — soften the attack and tail so hard chops don't click
  - **⇄ Reverse** a grain — play it backwards
- **Haze** — a master reverb send over everything (the Phaeleh air)
- **Master limiter** — everything sums through a limiter, so a busy mix (clips + drums + notes + reverb + echo) won't clip, live or in the bounce
- **Echo** — a tempo-synced dub delay send with feedback, locked to a note division (1/8 · 1/8· · 1/4 · 1/4· · 1/2)
- **Drum machine:** a 4-voice (kick / snare / hat / open-hat), 16-step sequencer with **synthesized** drums, tempo-locked to the timeline BPM and run through the **same Haze + Echo** as everything else. Plays in sync with the transport; included in the bounce.
- **Keyboard:** load any grain onto the keys and **play it pitched** — sustained while held, click-free, through the Haze + Echo. Play it with the on-screen piano or the **A–K computer-key row**, with octave shift + level. **Arm Rec** and play while the transport rolls to **record a part** into the piece, then **Edit ▸** it in a **piano-roll** (drag to move, drag the edge to trim, double-click to add, × to delete).
- **Drum swing** pushes the off-beats late for a shuffle.
- **Per-track mixer:** each timeline track has a volume fader + mute/solo in the gutter on the left.
- **Timeline arranger:** drag grains onto **5 tracks**, scheduled in time
  - **Tempo (BPM)** + a **snap grid** (off / ¼ / ½ / 1 beat / 1 bar) so clips lock to the beat
  - **Drag clips** to move them across time/tracks; **drag a clip's edges** to trim its in/out points
  - **▶ Play** sweeps a playhead; **↻ Loop** cycles the whole arrangement; **×** removes a clip
- **Export** — bounce the whole arrangement (clips, held layers, haze tail) to a `.wav`
- **Undo / redo** — full-document history (Ctrl+Z / Ctrl+Shift+Z, or the ↶ ↷ buttons); rapid edits collapse into one step
- **Stop all** kills everything playing
- **Save / Open** — write the whole session (grains + arrangement + settings) to a portable `.blacksand` file and load it back

## Desktop app

Black Sand also runs as a native desktop app via **Tauri 2**, with real
file dialogs for Save / Open / Export (the web build falls back to browser
download + file-picker automatically).

```bash
npm install
npm run desktop        # dev: native window on the Vite dev server
npm run desktop:build  # build an installer in src-tauri/target/release/bundle
```

Needs the Rust toolchain (`rustup`) and, on Windows, the MSVC build tools +
WebView2 — same as the other RavenHooha desktop apps.

## Next (the roadmap)

- Multiple recorded parts / a clip-based arranger for keyboard takes
- Waveform thumbnails on grains + clips

## Stack

Vite + React + TypeScript + the Web Audio API, wrapped as a Tauri 2 desktop app.
