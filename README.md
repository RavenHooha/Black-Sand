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
- **Haze** — a master reverb send over everything (the Phaeleh air)
- **Echo** — a tempo-synced dub delay send with feedback, locked to a note division (1/8 · 1/8· · 1/4 · 1/4· · 1/2)
- **Drum machine:** a 4-voice (kick / snare / hat / open-hat), 16-step sequencer with **synthesized** drums, tempo-locked to the timeline BPM and run through the **same Haze + Echo** as everything else. Plays in sync with the transport; included in the bounce.
- **Timeline arranger:** drag grains onto **5 tracks**, scheduled in time
  - **Tempo (BPM)** + a **snap grid** (off / ¼ / ½ / 1 beat / 1 bar) so clips lock to the beat
  - **Drag clips** to move them across time/tracks; **drag a clip's edges** to trim its in/out points
  - **▶ Play** sweeps a playhead; **↻ Loop** cycles the whole arrangement; **×** removes a clip
- **Export** — bounce the whole arrangement (clips, held layers, haze tail) to a `.wav`
- **Stop all** kills everything playing
- **Save / Open** — write the whole session (grains + arrangement + settings) to a portable `.blacksand` file and load it back

## Next (the roadmap)

- Wrap in Tauri for a real desktop build

## Stack

Vite + React + TypeScript + the Web Audio API. Tauri-ready.
