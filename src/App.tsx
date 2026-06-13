import React, { useEffect, useRef, useState } from 'react'
import {
  audioCtx, decodeFile, sliceBuffer, stopAll, startLayer, setHaze as applyHaze,
  setEcho as applyEcho, setEchoTime, startTimeline, stopTimeline, renderMixdown,
  startDrums, stopDrums, updateDrums, currentDrumStep, DRUM_VOICES, DRUM_STEPS,
  noteOn, Note, Layer, GrainFX, DEFAULT_FX, rateOf,
} from './audio'
import Waveform from './components/Waveform'
import SampleLibrary, { Sample } from './components/SampleLibrary'
import Timeline, { Clip } from './components/Timeline'
import DrumMachine from './components/DrumMachine'
import Keyboard, { KEY_OFFSETS } from './components/Keyboard'
import { encodeWav, bufToBase64, downloadSession, downloadWav, readSessionFile, Session, SavedSample } from './session'

const TRACKS = 5
const PX_PER_SEC = 80
const DRUM_LABELS = ['Kick', 'Snare', 'Hat', 'Open']

function uid(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now() + Math.random())
}

function emptyDrums(): boolean[][] {
  return DRUM_VOICES.map(() => Array(DRUM_STEPS).fill(false))
}

// coerce a loaded pattern into the expected voices x steps shape (old sessions have none)
function normalizeDrums(saved?: boolean[][]): boolean[][] {
  return DRUM_VOICES.map((_, v) =>
    Array.from({ length: DRUM_STEPS }, (_, i) => Boolean(saved?.[v]?.[i]))
  )
}

export default function App() {
  // source + chopping
  const [source, setSource] = useState<AudioBuffer | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [busy, setBusy] = useState(false)

  // layering
  const layersRef = useRef<Map<string, Layer>>(new Map())
  const [looping, setLooping] = useState<Set<string>>(new Set())
  const [volumes, setVolumes] = useState<Record<string, number>>({})
  const [fx, setFx] = useState<Record<string, GrainFX>>({})
  const [haze, setHaze] = useState(0.25)
  const [echo, setEchoAmt] = useState(0)
  const [echoBeats, setEchoBeats] = useState(0.75) // dotted 1/8 — the classic dub division

  // drum machine
  const [drumPattern, setDrumPattern] = useState<boolean[][]>(emptyDrums)
  const [drumGain, setDrumGain] = useState(0.9)
  const [drumStep, setDrumStep] = useState(-1) // currently-sounding step for the highlight

  // keyboard
  const [keyInstrument, setKeyInstrument] = useState('')
  const [keyOctave, setKeyOctave] = useState(4)
  const [keyGain, setKeyGain] = useState(0.9)
  const [held, setHeld] = useState<Set<number>>(new Set()) // offsets currently sounding
  const notesRef = useRef<Map<number, Note>>(new Map())

  // timeline
  const [clips, setClips] = useState<Clip[]>([])
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [loopTl, setLoopTl] = useState(true)
  const [bpm, setBpm] = useState(90)
  const [gridBeats, setGridBeats] = useState(0.5) // snap step in beats; 0 = off
  const [rendering, setRendering] = useState(false)
  const rafRef = useRef<number | null>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const buf = await decodeFile(file)
      setSource(buf)
      setSourceName(file.name.replace(/\.[^.]+$/, ''))
      setPending(null)
    } catch (err) {
      alert('Could not decode that file. Try a wav / mp3 / flac.')
      console.error(err)
    } finally {
      setBusy(false)
      e.target.value = ''
    }
  }

  function chop() {
    if (!source || !pending) return
    const grain = sliceBuffer(source, pending.start, pending.end)
    const n = samples.filter((s) => s.name.startsWith(sourceName)).length + 1
    const id = uid()
    setSamples([{ id, name: `${sourceName} ·${n}`, buffer: grain }, ...samples])
    setKeyInstrument((cur) => cur || id) // first grain becomes the keyboard's voice
    setPending(null)
  }

  function toggleLoop(s: Sample) {
    const layers = layersRef.current
    const existing = layers.get(s.id)
    if (existing) {
      existing.stop()
      layers.delete(s.id)
      setLooping((prev) => { const next = new Set(prev); next.delete(s.id); return next })
    } else {
      layers.set(s.id, startLayer(s.buffer, volumes[s.id] ?? 0.8, fx[s.id]))
      setLooping((prev) => new Set(prev).add(s.id))
    }
  }

  function onVolume(s: Sample, v: number) {
    setVolumes((prev) => ({ ...prev, [s.id]: v }))
    layersRef.current.get(s.id)?.setGain(v)
  }

  function onPitch(s: Sample, semitones: number) {
    setFx((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? DEFAULT_FX), pitch: semitones } }))
    layersRef.current.get(s.id)?.setPitch(semitones)
  }

  function onCutoff(s: Sample, hz: number) {
    setFx((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? DEFAULT_FX), cutoff: hz } }))
    layersRef.current.get(s.id)?.setCutoff(hz)
  }

  // fades take effect on the next preview / timeline pass / bounce (not on a live loop)
  function onFadeIn(s: Sample, sec: number) {
    setFx((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? DEFAULT_FX), fadeIn: sec } }))
  }

  function onFadeOut(s: Sample, sec: number) {
    setFx((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? DEFAULT_FX), fadeOut: sec } }))
  }

  function onHaze(v: number) {
    setHaze(v)
    applyHaze(v)
  }

  function onEcho(v: number) {
    setEchoAmt(v)
    applyEcho(v)
  }

  // keep the dub-echo delay time locked to tempo + note division
  const echoTimeSec = echoBeats * (60 / bpm)
  useEffect(() => { setEchoTime(echoTimeSec) }, [echoTimeSec])

  // --- drums ---
  function hasDrumSteps(): boolean {
    return drumPattern.some((row) => row.some(Boolean))
  }
  function toggleDrum(voice: number, step: number) {
    setDrumPattern((prev) =>
      prev.map((row, v) => (v === voice ? row.map((on, i) => (i === step ? !on : on)) : row))
    )
  }
  function clearDrums() {
    setDrumPattern(emptyDrums())
  }

  // push live pattern / tempo / level edits to the running drum scheduler
  useEffect(() => {
    if (playing) updateDrums(drumPattern, bpm, drumGain)
  }, [drumPattern, bpm, drumGain, playing])

  // --- keyboard ---
  // stash live values so the global key listener can stay stable (no re-subscribe churn)
  const kbRef = useRef({ samples, fx, keyInstrument, keyOctave, keyGain })
  kbRef.current = { samples, fx, keyInstrument, keyOctave, keyGain }

  function triggerNote(offset: number) {
    if (notesRef.current.has(offset)) return // already held
    const { samples: ss, fx: ff, keyInstrument: ki, keyOctave: ko, keyGain: kg } = kbRef.current
    const inst = ss.find((s) => s.id === ki) ?? ss[0]
    if (!inst) return
    const note = noteOn(inst.buffer, offset + (ko - 4) * 12, kg, ff[inst.id])
    notesRef.current.set(offset, note)
    setHeld((prev) => new Set(prev).add(offset))
  }
  function releaseNote(offset: number) {
    const note = notesRef.current.get(offset)
    if (note) { note.stop(); notesRef.current.delete(offset) }
    setHeld((prev) => { const next = new Set(prev); next.delete(offset); return next })
  }

  // computer keys (A–K row) play the loaded grain, regardless of focus (unless typing)
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement
      return !!el && /^(input|select|textarea)$/i.test(el.tagName)
    }
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return
      const off = KEY_OFFSETS[e.key.toLowerCase()]
      if (off === undefined) return
      e.preventDefault()
      triggerNote(off)
    }
    const up = (e: KeyboardEvent) => {
      const off = KEY_OFFSETS[e.key.toLowerCase()]
      if (off !== undefined) releaseNote(off)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // --- timeline ---
  // wall-clock length of a placed clip: trimmed length / pitch rate
  function clipRealDur(c: Clip, s: Sample): number {
    const length = c.length ?? s.buffer.duration - (c.offset ?? 0)
    return length / rateOf(fx[c.sampleId])
  }

  function lengthSec(): number {
    let end = 8
    for (const c of clips) {
      const s = samples.find((x) => x.id === c.sampleId)
      if (s) end = Math.max(end, c.startSec + clipRealDur(c, s))
    }
    return Math.ceil(end + 0.5)
  }

  function play() {
    if (playing) return
    const buffers = clips
      .map((c) => {
        const s = samples.find((x) => x.id === c.sampleId)
        return s ? { buffer: s.buffer, startSec: c.startSec, offset: c.offset, length: c.length, fx: fx[c.sampleId] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    const drumsActive = hasDrumSteps()
    if (buffers.length === 0 && !drumsActive) return

    const len = lengthSec()
    const loop = loopTl
    const at = audioCtx().currentTime + 0.1 // shared start so clips + drums lock together
    if (buffers.length) startTimeline(buffers, at)
    startDrums(drumPattern, bpm, drumGain, at)
    setPlaying(true)

    const t0 = performance.now()
    let boundary = len
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000
      setDrumStep(currentDrumStep())
      if (loop) {
        if (elapsed >= boundary) { if (buffers.length) startTimeline(buffers); boundary += len }
        setPlayhead(elapsed % len)
      } else if (elapsed >= len) {
        stopTimeline(); stopDrums(); setDrumStep(-1)
        setPlaying(false); setPlayhead(0); rafRef.current = null
        return
      } else {
        setPlayhead(elapsed)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function stopTl() {
    stopTimeline()
    stopDrums()
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setPlaying(false)
    setPlayhead(0)
    setDrumStep(-1)
  }

  function addClip(sampleId: string, track: number, startSec: number) {
    setClips((prev) => [...prev, { id: uid(), sampleId, track, startSec }])
  }
  function removeClip(id: string) {
    setClips((prev) => prev.filter((c) => c.id !== id))
  }
  function moveClip(id: string, track: number, startSec: number) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, track, startSec } : c)))
  }
  function trimClip(id: string, startSec: number, offset: number, length: number) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, startSec, offset, length } : c)))
  }

  function stopEverything() {
    stopAll()
    layersRef.current.clear()
    setLooping(new Set())
    notesRef.current.forEach((n) => n.stop())
    notesRef.current.clear()
    setHeld(new Set())
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    setPlaying(false)
    setPlayhead(0)
    setDrumStep(-1)
  }

  // --- save / load ---
  function saveProject() {
    if (samples.length === 0) {
      alert('Nothing to save yet — chop a grain or two first.')
      return
    }
    const savedSamples: SavedSample[] = samples.map((s) => ({
      id: s.id,
      name: s.name,
      volume: volumes[s.id] ?? 0.8,
      pitch: fx[s.id]?.pitch ?? DEFAULT_FX.pitch,
      cutoff: fx[s.id]?.cutoff ?? DEFAULT_FX.cutoff,
      fadeIn: fx[s.id]?.fadeIn ?? DEFAULT_FX.fadeIn,
      fadeOut: fx[s.id]?.fadeOut ?? DEFAULT_FX.fadeOut,
      wav: bufToBase64(encodeWav(s.buffer)),
    }))
    const session: Session = {
      version: 1, bpm, gridBeats, haze, echo, echoBeats, loopTl,
      drumPattern, drumGain, samples: savedSamples, clips,
    }
    downloadSession(session, 'black-sand-session')
  }

  async function loadProject(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      stopEverything()
      const { session, buffers } = await readSessionFile(file)
      const restored: Sample[] = session.samples
        .filter((s) => buffers.has(s.id))
        .map((s) => ({ id: s.id, name: s.name, buffer: buffers.get(s.id)! }))
      setSamples(restored)
      setVolumes(Object.fromEntries(session.samples.map((s) => [s.id, s.volume] as [string, number])))
      setFx(Object.fromEntries(session.samples.map((s) => [
        s.id,
        {
          pitch: s.pitch ?? DEFAULT_FX.pitch,
          cutoff: s.cutoff ?? DEFAULT_FX.cutoff,
          fadeIn: s.fadeIn ?? DEFAULT_FX.fadeIn,
          fadeOut: s.fadeOut ?? DEFAULT_FX.fadeOut,
        },
      ] as [string, GrainFX])))
      setClips(session.clips)
      setBpm(session.bpm)
      setGridBeats(session.gridBeats)
      setLoopTl(session.loopTl)
      setHaze(session.haze)
      applyHaze(session.haze)
      setEchoAmt(session.echo ?? 0)
      applyEcho(session.echo ?? 0)
      setEchoBeats(session.echoBeats ?? 0.75)
      setDrumPattern(normalizeDrums(session.drumPattern))
      setDrumGain(session.drumGain ?? 0.9)
      setLooping(new Set())
    } catch (err) {
      alert('Could not open that file — is it a .blacksand session?')
      console.error(err)
    } finally {
      e.target.value = ''
    }
  }

  // --- export / bounce ---
  async function exportMix() {
    if (rendering) return
    const tlClips = clips
      .map((c) => {
        const s = samples.find((x) => x.id === c.sampleId)
        return s ? { buffer: s.buffer, startSec: c.startSec, offset: c.offset, length: c.length, fx: fx[c.sampleId] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    const activeLayers = [...looping]
      .map((id) => {
        const s = samples.find((x) => x.id === id)
        return s ? { buffer: s.buffer, gain: volumes[id] ?? 0.8, fx: fx[id] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)

    if (tlClips.length === 0 && activeLayers.length === 0 && !hasDrumSteps()) {
      alert('Nothing to bounce yet — arrange some clips, loop a layer, or program a beat first.')
      return
    }
    setRendering(true)
    try {
      const mix = await renderMixdown({
        clips: tlClips, layers: activeLayers, haze,
        echo, echoTimeSec, echoFeedback: 0.35,
        bpm, drums: drumPattern, drumGain,
        durationSec: lengthSec(),
      })
      downloadWav(mix, 'black-sand-mix')
    } catch (err) {
      alert('Render failed — see console.')
      console.error(err)
    } finally {
      setRendering(false)
    }
  }

  return (
    <div className="app">
      <header>
        <h1>BLACK SAND</h1>
        <div className="controls">
          <label className="haze" title="Reverb haze over everything">
            <span>Haze</span>
            <input type="range" min={0} max={1} step={0.01} value={haze} onChange={(e) => onHaze(Number(e.target.value))} />
          </label>
          <label className="haze" title="Tempo-synced dub echo over everything">
            <span>Echo</span>
            <input type="range" min={0} max={1} step={0.01} value={echo} onChange={(e) => onEcho(Number(e.target.value))} />
            <select className="echo-sync" value={echoBeats} onChange={(e) => setEchoBeats(Number(e.target.value))} title="Echo timing">
              <option value={0.5}>1/8</option>
              <option value={0.75}>1/8·</option>
              <option value={1}>1/4</option>
              <option value={1.5}>1/4·</option>
              <option value={2}>1/2</option>
            </select>
          </label>
          <label className="import">
            {busy ? 'Loading…' : 'Import track'}
            <input type="file" accept="audio/*" onChange={onFile} hidden disabled={busy} />
          </label>
          <label className="import" title="Open a .blacksand session">
            Open
            <input type="file" accept=".blacksand,application/json" onChange={loadProject} hidden />
          </label>
          <button onClick={saveProject} title="Save session to a .blacksand file">Save</button>
          <button onClick={exportMix} disabled={rendering} title="Bounce the arrangement to a .wav">
            {rendering ? 'Bouncing…' : 'Export'}
          </button>
          <button onClick={stopEverything}>Stop all</button>
        </div>
      </header>

      <main>
        <div className="top">
          <section className="stage">
            {source ? (
              <>
                <div className="track-name">{sourceName} · {source.duration.toFixed(1)}s</div>
                <Waveform buffer={source} onSelect={(start, end) => setPending({ start, end })} />
                <div className="chop-bar">
                  {pending ? (
                    <>
                      <span className="sel">
                        {pending.start.toFixed(2)}s → {pending.end.toFixed(2)}s
                        <em> ({(pending.end - pending.start).toFixed(2)}s)</em>
                      </span>
                      <button className="extract" onClick={chop}>Chop → Grains</button>
                    </>
                  ) : (
                    <span className="hint">Drag across the waveform to carve out a grain.</span>
                  )}
                </div>
              </>
            ) : (
              <div className="empty">Import a track to start sifting.</div>
            )}
          </section>
          <SampleLibrary
            samples={samples}
            looping={looping}
            volumes={volumes}
            fx={fx}
            onToggleLoop={toggleLoop}
            onVolume={onVolume}
            onPitch={onPitch}
            onCutoff={onCutoff}
            onFadeIn={onFadeIn}
            onFadeOut={onFadeOut}
          />
        </div>

        <Timeline
          samples={samples}
          clips={clips}
          fx={fx}
          tracks={TRACKS}
          pxPerSec={PX_PER_SEC}
          lengthSec={lengthSec()}
          playheadSec={playhead}
          playing={playing}
          loop={loopTl}
          bpm={bpm}
          gridBeats={gridBeats}
          onBpm={setBpm}
          onGrid={setGridBeats}
          onAddClip={addClip}
          onMoveClip={moveClip}
          onTrimClip={trimClip}
          onRemoveClip={removeClip}
          onPlay={play}
          onStop={stopTl}
          onToggleLoop={() => setLoopTl((v) => !v)}
        />

        <DrumMachine
          labels={DRUM_LABELS}
          pattern={drumPattern}
          step={drumStep}
          gain={drumGain}
          onToggle={toggleDrum}
          onClear={clearDrums}
          onGain={setDrumGain}
        />

        <Keyboard
          samples={samples}
          instrument={keyInstrument || samples[0]?.id || ''}
          octave={keyOctave}
          gain={keyGain}
          held={held}
          onInstrument={setKeyInstrument}
          onOctave={(d) => setKeyOctave((o) => Math.max(1, Math.min(7, o + d)))}
          onGain={setKeyGain}
          onNoteDown={triggerNote}
          onNoteUp={releaseNote}
        />
      </main>
    </div>
  )
}
