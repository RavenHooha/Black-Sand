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

## What works now (v0.4)

- **Import** a track (wav / mp3 / flac / etc.)
- **Waveform** view; **drag** across it to select a region
- **Chop → Grains** carves that region into a new sample
- **Layer mixer:** each grain can **▶ preview**, **↻ loop as a layer**, with its own **volume fader** — stack a few and they build an atmosphere
- **Haze** — a master reverb send over everything (the Phaeleh air)
- **Timeline arranger:** drag grains onto **5 tracks**, scheduled in time
  - **Tempo (BPM)** + a **snap grid** (off / ¼ / ½ / 1 beat / 1 bar) so clips lock to the beat
  - **▶ Play** sweeps a playhead; **↻ Loop** cycles the whole arrangement; **×** removes a clip
- **Stop all** kills everything playing
- **Save / Open** — write the whole session (grains + arrangement + settings) to a portable `.blacksand` file and load it back

## Next (the roadmap)

- Per-grain fades, filter, pitch
- Drag-to-move and trim clips already on the timeline
- Export the mixdown to a file
- Wrap in Tauri for a real desktop build

## Stack

Vite + React + TypeScript + the Web Audio API. Tauri-ready.
