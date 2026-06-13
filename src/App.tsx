import React, { useEffect, useRef, useState } from 'react'
import {
  audioCtx, decodeFile, sliceBuffer, reverseBuffer, stopAll, startLayer, setHaze as applyHaze,
  setEcho as applyEcho, setEchoTime, startTimeline, stopTimeline, renderMixdown,
  startDrums, stopDrums, updateDrums, currentDrumStep, DRUM_VOICES, DRUM_STEPS,
  noteOn, Note, startNotes, stopNotes, ScheduledNote, Layer, GrainFX, DEFAULT_FX, rateOf,
} from './audio'
import Waveform from './components/Waveform'
import SampleLibrary, { Sample } from './components/SampleLibrary'
import Timeline, { Clip } from './components/Timeline'
import DrumMachine from './components/DrumMachine'
import Keyboard, { KEY_OFFSETS } from './components/Keyboard'
import PianoRoll from './components/PianoRoll'
import { encodeWav, bufToBase64, downloadSession, downloadWav, readSessionText, Session, SavedSample } from './session'
import { isDesktop, saveTextNative, saveBytesNative, openTextNative } from './desktop'

const TRACKS = 5
const PX_PER_SEC = 80
const DRUM_LABELS = ['Kick', 'Snare', 'Hat', 'Open', 'Clap', 'Rim', 'Tom', 'Shaker']

function uid(): string {
  return (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ?? String(Date.now() + Math.random())
}

type RecordedNote = { id: string; sampleId: string; semitones: number; startSec: number; durSec: number; gain: number }

// A snapshot of the whole editable document, for undo/redo. Buffers are shared
// (immutable) refs; everything else is replaced immutably by handlers, so a
// shallow snapshot is safe to stash and restore.
type Snap = {
  samples: Sample[]; volumes: Record<string, number>; fx: Record<string, GrainFX>; clips: Clip[]
  bpm: number; gridBeats: number; loopTl: boolean; haze: number; echo: number; echoBeats: number
  drumPattern: boolean[][]; drumGain: number; drumSwing: number; recordedNotes: RecordedNote[]
  trackVol: number[]; trackMute: boolean[]; trackSolo: boolean[]; keyInstrument: string
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
  const [drumSwing, setDrumSwing] = useState(0) // 0..0.6 — delay on the off-beat 16ths
  const [drumStep, setDrumStep] = useState(-1) // currently-sounding step for the highlight

  // keyboard
  const [keyInstrument, setKeyInstrument] = useState('')
  const [keyOctave, setKeyOctave] = useState(4)
  const [keyGain, setKeyGain] = useState(0.9)
  const [held, setHeld] = useState<Set<number>>(new Set()) // offsets currently sounding
  const notesRef = useRef<Map<number, Note>>(new Map())

  // keyboard recording
  const [recArmed, setRecArmed] = useState(false)
  const [recordedNotes, setRecordedNotes] = useState<RecordedNote[]>([])
  const [showRoll, setShowRoll] = useState(false)
  const recHeldRef = useRef<Map<number, { startedAt: number; startSec: number; sampleId: string; semitones: number; gain: number }>>(new Map())
  const playOriginRef = useRef(0) // audio-clock time the current play pass started
  const playLenRef = useRef(0)

  // timeline
  const [clips, setClips] = useState<Clip[]>([])
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [loopTl, setLoopTl] = useState(true)
  const [bpm, setBpm] = useState(90)
  const [gridBeats, setGridBeats] = useState(0.5) // snap step in beats; 0 = off
  const [trackVol, setTrackVol] = useState<number[]>(() => Array(TRACKS).fill(1))
  const [trackMute, setTrackMute] = useState<boolean[]>(() => Array(TRACKS).fill(false))
  const [trackSolo, setTrackSolo] = useState<boolean[]>(() => Array(TRACKS).fill(false))
  const [rendering, setRendering] = useState(false)
  const rafRef = useRef<number | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)

  // undo / redo history
  const undoRef = useRef<Snap[]>([])
  const redoRef = useRef<Snap[]>([])
  const lastDocRef = useRef<Snap | null>(null)
  const applyingRef = useRef(false) // true while restoring a snapshot (skip the history push)
  const histMountRef = useRef(false)
  const [, setHistVer] = useState(0)

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

  function reverseGrain(s: Sample) {
    const rev = reverseBuffer(s.buffer)
    setSamples((prev) => prev.map((x) => (x.id === s.id ? { ...x, buffer: rev } : x)))
    // if it's looping live, restart the layer on the reversed buffer
    const layer = layersRef.current.get(s.id)
    if (layer) {
      layer.stop()
      layersRef.current.set(s.id, startLayer(rev, volumes[s.id] ?? 0.8, fx[s.id]))
    }
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

  // push live pattern / tempo / level / swing edits to the running drum scheduler
  useEffect(() => {
    if (playing) updateDrums(drumPattern, bpm, drumGain, drumSwing)
  }, [drumPattern, bpm, drumGain, drumSwing, playing])

  // --- keyboard ---
  // stash live values so the global key listener can stay stable (no re-subscribe churn)
  const kbRef = useRef({ samples, fx, keyInstrument, keyOctave, keyGain, recArmed, playing })
  kbRef.current = { samples, fx, keyInstrument, keyOctave, keyGain, recArmed, playing }
  const recordedNotesRef = useRef<RecordedNote[]>(recordedNotes)
  recordedNotesRef.current = recordedNotes

  // recorded notes resolved to playable form (buffer + tone/fade), for transport + bounce
  function resolveNotes(): ScheduledNote[] {
    return recordedNotesRef.current
      .map((n) => {
        const s = kbRef.current.samples.find((x) => x.id === n.sampleId)
        return s
          ? { buffer: s.buffer, semitones: n.semitones, startSec: n.startSec, durSec: n.durSec, gain: n.gain, fx: kbRef.current.fx[n.sampleId] }
          : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
  }

  function triggerNote(offset: number) {
    if (notesRef.current.has(offset)) return // already held
    const { samples: ss, fx: ff, keyInstrument: ki, keyOctave: ko, keyGain: kg } = kbRef.current
    const inst = ss.find((s) => s.id === ki) ?? ss[0]
    if (!inst) return
    const semis = offset + (ko - 4) * 12
    const note = noteOn(inst.buffer, semis, kg, ff[inst.id])
    notesRef.current.set(offset, note)
    setHeld((prev) => new Set(prev).add(offset))
    // capture the note start if armed + rolling
    if (kbRef.current.recArmed && kbRef.current.playing) {
      const now = audioCtx().currentTime
      const len = playLenRef.current || 1
      const startSec = (((now - playOriginRef.current) % len) + len) % len
      recHeldRef.current.set(offset, { startedAt: now, startSec, sampleId: inst.id, semitones: semis, gain: kg })
    }
  }
  function releaseNote(offset: number) {
    const note = notesRef.current.get(offset)
    if (note) { note.stop(); notesRef.current.delete(offset) }
    setHeld((prev) => { const next = new Set(prev); next.delete(offset); return next })
    const rec = recHeldRef.current.get(offset)
    if (rec) {
      recHeldRef.current.delete(offset)
      const durSec = Math.max(0.05, audioCtx().currentTime - rec.startedAt)
      setRecordedNotes((prev) => [
        ...prev,
        { id: uid(), sampleId: rec.sampleId, semitones: rec.semitones, startSec: rec.startSec, durSec, gain: rec.gain },
      ])
    }
  }
  function clearRecording() {
    setRecordedNotes([])
  }

  // --- piano-roll edits to the recorded part ---
  function moveNote(id: string, startSec: number, semitones: number) {
    setRecordedNotes((prev) => prev.map((n) => (n.id === id ? { ...n, startSec, semitones } : n)))
  }
  function trimNote(id: string, durSec: number) {
    setRecordedNotes((prev) => prev.map((n) => (n.id === id ? { ...n, durSec } : n)))
  }
  function deleteNote(id: string) {
    setRecordedNotes((prev) => prev.filter((n) => n.id !== id))
  }
  function addNote(startSec: number, semitones: number) {
    const sampleId = keyInstrument || samples[0]?.id
    if (!sampleId) return
    const durSec = Math.max(0.2, Math.min(1, 60 / bpm))
    setRecordedNotes((prev) => [...prev, { id: uid(), sampleId, semitones, startSec, durSec, gain: keyGain }])
    previewNote(sampleId, semitones)
  }
  function previewNote(sampleId: string, semitones: number) {
    const s = samples.find((x) => x.id === sampleId)
    if (!s) return
    const n = noteOn(s.buffer, semitones, keyGain, fx[sampleId])
    window.setTimeout(() => n.stop(), 450)
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

  // --- undo / redo ---
  function docSnapshot(): Snap {
    return {
      samples, volumes, fx, clips, bpm, gridBeats, loopTl, haze, echo, echoBeats,
      drumPattern, drumGain, drumSwing, recordedNotes, trackVol, trackMute, trackSolo, keyInstrument,
    }
  }
  if (lastDocRef.current === null) lastDocRef.current = docSnapshot()

  function applyDoc(s: Snap) {
    applyingRef.current = true
    setSamples(s.samples); setVolumes(s.volumes); setFx(s.fx); setClips(s.clips)
    setBpm(s.bpm); setGridBeats(s.gridBeats); setLoopTl(s.loopTl)
    setHaze(s.haze); applyHaze(s.haze)
    setEchoAmt(s.echo); applyEcho(s.echo); setEchoBeats(s.echoBeats)
    setDrumPattern(s.drumPattern); setDrumGain(s.drumGain); setDrumSwing(s.drumSwing)
    setRecordedNotes(s.recordedNotes)
    setTrackVol(s.trackVol); setTrackMute(s.trackMute); setTrackSolo(s.trackSolo)
    setKeyInstrument(s.keyInstrument)
  }
  function undo() {
    if (!undoRef.current.length) return
    const prev = undoRef.current.pop()!
    redoRef.current.push(lastDocRef.current!)
    lastDocRef.current = prev
    applyDoc(prev)
    setHistVer((v) => v + 1)
  }
  function redo() {
    if (!redoRef.current.length) return
    const next = redoRef.current.pop()!
    undoRef.current.push(lastDocRef.current!)
    lastDocRef.current = next
    applyDoc(next)
    setHistVer((v) => v + 1)
  }

  // capture history when the document settles (rapid edits collapse into one step)
  useEffect(() => {
    if (!histMountRef.current) { histMountRef.current = true; lastDocRef.current = docSnapshot(); return }
    if (applyingRef.current) { applyingRef.current = false; lastDocRef.current = docSnapshot(); return }
    const id = window.setTimeout(() => {
      undoRef.current.push(lastDocRef.current!)
      if (undoRef.current.length > 60) undoRef.current.shift()
      redoRef.current = []
      lastDocRef.current = docSnapshot()
      setHistVer((v) => v + 1)
    }, 450)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, volumes, fx, clips, bpm, gridBeats, loopTl, haze, echo, echoBeats,
      drumPattern, drumGain, drumSwing, recordedNotes, trackVol, trackMute, trackSolo, keyInstrument])

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- timeline ---
  // wall-clock length of a placed clip: trimmed length / pitch rate
  function clipRealDur(c: Clip, s: Sample): number {
    const length = c.length ?? s.buffer.duration - (c.offset ?? 0)
    return length / rateOf(fx[c.sampleId])
  }

  // effective gain for a track once mute + solo are folded in
  function trackGain(track: number): number {
    if (trackMute[track]) return 0
    const anySolo = trackSolo.some(Boolean)
    if (anySolo && !trackSolo[track]) return 0
    return trackVol[track] ?? 1
  }
  function onTrackVol(i: number, v: number) {
    setTrackVol((prev) => prev.map((x, idx) => (idx === i ? v : x)))
  }
  function onTrackMute(i: number) {
    setTrackMute((prev) => prev.map((x, idx) => (idx === i ? !x : x)))
  }
  function onTrackSolo(i: number) {
    setTrackSolo((prev) => prev.map((x, idx) => (idx === i ? !x : x)))
  }

  function lengthSec(): number {
    let end = 8
    for (const c of clips) {
      const s = samples.find((x) => x.id === c.sampleId)
      if (s) end = Math.max(end, c.startSec + clipRealDur(c, s))
    }
    for (const n of recordedNotes) end = Math.max(end, n.startSec + n.durSec)
    return Math.ceil(end + 0.5)
  }

  function play() {
    if (playing) return
    const buffers = clips
      .map((c) => {
        const s = samples.find((x) => x.id === c.sampleId)
        return s ? { buffer: s.buffer, startSec: c.startSec, offset: c.offset, length: c.length, gain: trackGain(c.track), fx: fx[c.sampleId] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    const drumsActive = hasDrumSteps()
    if (buffers.length === 0 && !drumsActive && recordedNotes.length === 0) return

    const len = lengthSec()
    const loop = loopTl
    const at = audioCtx().currentTime + 0.1 // shared start so clips + drums + notes lock together
    if (buffers.length) startTimeline(buffers, at)
    startDrums(drumPattern, bpm, drumGain, drumSwing, at)
    startNotes(resolveNotes(), at)
    playOriginRef.current = at
    playLenRef.current = len
    setPlaying(true)

    const t0 = performance.now()
    let boundary = len
    const tick = () => {
      const elapsed = (performance.now() - t0) / 1000
      setDrumStep(currentDrumStep())
      if (loop) {
        if (elapsed >= boundary) {
          if (buffers.length) startTimeline(buffers)
          startNotes(resolveNotes()) // re-arm notes (picks up anything just recorded)
          playOriginRef.current = audioCtx().currentTime + 0.08
          boundary += len
        }
        setPlayhead(elapsed % len)
      } else if (elapsed >= len) {
        stopTimeline(); stopDrums(); stopNotes(); setDrumStep(-1)
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
    stopNotes()
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
  async function saveProject() {
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
      drumPattern, drumGain, drumSwing, notes: recordedNotes,
      trackVol, trackMute, trackSolo, samples: savedSamples, clips,
    }
    if (await saveTextNative(JSON.stringify(session), 'black-sand-session.blacksand', 'blacksand', 'Black Sand')) return
    downloadSession(session, 'black-sand-session')
  }

  async function loadFromText(text: string) {
    try {
      stopEverything()
      const { session, buffers } = await readSessionText(text)
      const restored: Sample[] = session.samples
        .filter((s) => buffers.has(s.id))
        .map((s) => ({ id: s.id, name: s.name, buffer: buffers.get(s.id)! }))
      // a loaded project starts a fresh history (don't undo across the load)
      applyingRef.current = true
      undoRef.current = []
      redoRef.current = []
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
      setDrumSwing(session.drumSwing ?? 0)
      setRecordedNotes(session.notes ?? [])
      setTrackVol(Array.from({ length: TRACKS }, (_, i) => session.trackVol?.[i] ?? 1))
      setTrackMute(Array.from({ length: TRACKS }, (_, i) => session.trackMute?.[i] ?? false))
      setTrackSolo(Array.from({ length: TRACKS }, (_, i) => session.trackSolo?.[i] ?? false))
      setLooping(new Set())
    } catch (err) {
      alert('Could not open that file — is it a .blacksand session?')
      console.error(err)
    }
  }

  // Open: native dialog on desktop, hidden file input on the web
  async function openProject() {
    if (isDesktop) {
      const text = await openTextNative('blacksand', 'Black Sand')
      if (text !== null) await loadFromText(text)
    } else {
      openInputRef.current?.click()
    }
  }
  async function onOpenInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try { await loadFromText(await file.text()) } finally { e.target.value = '' }
  }

  // --- export / bounce ---
  async function exportMix() {
    if (rendering) return
    const tlClips = clips
      .map((c) => {
        const s = samples.find((x) => x.id === c.sampleId)
        return s ? { buffer: s.buffer, startSec: c.startSec, offset: c.offset, length: c.length, gain: trackGain(c.track), fx: fx[c.sampleId] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    const activeLayers = [...looping]
      .map((id) => {
        const s = samples.find((x) => x.id === id)
        return s ? { buffer: s.buffer, gain: volumes[id] ?? 0.8, fx: fx[id] } : null
      })
      .filter((x): x is NonNullable<typeof x> => !!x)

    if (tlClips.length === 0 && activeLayers.length === 0 && !hasDrumSteps() && recordedNotes.length === 0) {
      alert('Nothing to bounce yet — arrange some clips, loop a layer, record a part, or program a beat first.')
      return
    }
    setRendering(true)
    try {
      const mix = await renderMixdown({
        clips: tlClips, layers: activeLayers, haze,
        echo, echoTimeSec, echoFeedback: 0.35,
        bpm, drums: drumPattern, drumGain, drumSwing, notes: resolveNotes(),
        durationSec: lengthSec(),
      })
      const wav = new Uint8Array(encodeWav(mix))
      if (!(await saveBytesNative(wav, 'black-sand-mix.wav', 'wav', 'WAV audio'))) downloadWav(mix, 'black-sand-mix')
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
          <button onClick={undo} disabled={undoRef.current.length === 0} title="Undo (Ctrl+Z)">↶</button>
          <button onClick={redo} disabled={redoRef.current.length === 0} title="Redo (Ctrl+Shift+Z)">↷</button>
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
          <button className="import" onClick={openProject} title="Open a .blacksand session">Open</button>
          <input ref={openInputRef} type="file" accept=".blacksand,application/json" onChange={onOpenInput} hidden />
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
            onReverse={reverseGrain}
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
          trackVol={trackVol}
          trackMute={trackMute}
          trackSolo={trackSolo}
          onTrackVol={onTrackVol}
          onTrackMute={onTrackMute}
          onTrackSolo={onTrackSolo}
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
          swing={drumSwing}
          onToggle={toggleDrum}
          onClear={clearDrums}
          onGain={setDrumGain}
          onSwing={setDrumSwing}
        />

        <Keyboard
          samples={samples}
          instrument={keyInstrument || samples[0]?.id || ''}
          octave={keyOctave}
          gain={keyGain}
          held={held}
          recArmed={recArmed}
          recCount={recordedNotes.length}
          onInstrument={setKeyInstrument}
          onOctave={(d) => setKeyOctave((o) => Math.max(1, Math.min(7, o + d)))}
          onGain={setKeyGain}
          onArm={() => setRecArmed((v) => !v)}
          onClearRec={clearRecording}
          onEdit={() => setShowRoll(true)}
          onNoteDown={triggerNote}
          onNoteUp={releaseNote}
        />
      </main>

      {showRoll && (
        <PianoRoll
          notes={recordedNotes}
          bpm={bpm}
          gridBeats={gridBeats}
          pxPerSec={PX_PER_SEC}
          onMoveNote={moveNote}
          onTrimNote={trimNote}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onPreview={previewNote}
          onClose={() => setShowRoll(false)}
        />
      )}
    </div>
  )
}
