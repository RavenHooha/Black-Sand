// Black Sand — audio engine.
// One AudioContext and a master bus with a reverb send (the "haze"):
//
//   layers/one-shots -> master -> dry --------------> destination
//                                \-> convolver -> wet -> destination
//
// Grains can be previewed (one-shot) or started as looping Layers you stack.

let ctx: AudioContext | null = null
let master: GainNode | null = null
let dry: GainNode | null = null
let wet: GainNode | null = null
let convolver: ConvolverNode | null = null
let delay: DelayNode | null = null
let echoFb: GainNode | null = null
let echoWet: GainNode | null = null
let limiter: DynamicsCompressorNode | null = null

/** Configure a compressor as a transparent brickwall-ish limiter on the sum. */
function asLimiter(comp: DynamicsCompressorNode): DynamicsCompressorNode {
  comp.threshold.value = -3
  comp.knee.value = 0
  comp.ratio.value = 20
  comp.attack.value = 0.003
  comp.release.value = 0.25
  return comp
}

// Per-grain colour: pitch in semitones (down = murk), lowpass cutoff in Hz (down
// = dark), and fade-in/out in real seconds (so chops don't click at the edges).
export type GrainFX = { pitch: number; cutoff: number; fadeIn: number; fadeOut: number }
export const DEFAULT_FX: GrainFX = { pitch: 0, cutoff: 20000, fadeIn: 0, fadeOut: 0 }
export const CUTOFF_MAX = 20000

/** A pitch shift of n semitones is a playback-rate of 2^(n/12). */
export function rateOf(fx?: GrainFX): number {
  return Math.pow(2, (fx?.pitch ?? 0) / 12)
}

/**
 * Schedule a fade-in / fade-out envelope on a grain's gain node.
 * `realDur` is wall-clock seconds of the playback (Infinity for a held loop —
 * only the fade-in is scheduled then). Fades are clamped so they never overlap.
 */
export function applyFades(g: GainNode, startTime: number, realDur: number, base: number, fx?: GrainFX): void {
  const half = realDur / 2
  const fi = Math.min(fx?.fadeIn ?? 0, half)
  const fo = Math.min(fx?.fadeOut ?? 0, half)
  const p = g.gain
  if (fi > 0) {
    p.setValueAtTime(0, startTime)
    p.linearRampToValueAtTime(base, startTime + fi)
  } else {
    p.setValueAtTime(base, startTime)
  }
  if (fo > 0 && isFinite(realDur)) {
    p.setValueAtTime(base, startTime + realDur - fo)
    p.linearRampToValueAtTime(0, startTime + realDur)
  }
}

export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Synthetic reverb impulse: decaying noise. No IR file needed. */
function makeImpulse(c: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = c.sampleRate
  const len = Math.max(1, Math.floor(seconds * rate))
  const ir = c.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return ir
}

function ensureMaster(): GainNode {
  if (master) return master
  const c = audioCtx()
  master = c.createGain()
  dry = c.createGain()
  wet = c.createGain()
  dry.gain.value = 1
  wet.gain.value = 0.25
  convolver = c.createConvolver()
  convolver.buffer = makeImpulse(c, 3.4, 2.6) // long, soft tail

  // everything sums into a limiter before the speakers, so a busy mix
  // (clips + drums + notes + reverb + echo feedback) can't clip.
  limiter = asLimiter(c.createDynamicsCompressor())
  limiter.connect(c.destination)
  master.connect(dry).connect(limiter)
  master.connect(convolver).connect(wet).connect(limiter)

  // dub echo send: master -> delay -> (feedback) -> echoWet -> limiter
  delay = c.createDelay(2.0)
  delay.delayTime.value = 0.375
  echoFb = c.createGain()
  echoFb.gain.value = 0.35
  echoWet = c.createGain()
  echoWet.gain.value = 0 // off until dialed up
  master.connect(delay)
  delay.connect(echoFb).connect(delay) // feedback loop (legal — a DelayNode sits in it)
  delay.connect(echoWet).connect(limiter)
  return master
}

/** 0..1 — how much reverb haze sits over everything. */
export function setHaze(amount: number): void {
  ensureMaster()
  wet!.gain.value = Math.max(0, Math.min(1, amount))
}

/** 0..1 — how much tempo-synced dub echo sits over everything. */
export function setEcho(amount: number): void {
  ensureMaster()
  echoWet!.gain.value = Math.max(0, Math.min(1, amount))
}

/** Delay time in seconds (driven by tempo + note division). */
export function setEchoTime(seconds: number): void {
  ensureMaster()
  delay!.delayTime.value = Math.max(0.01, Math.min(2.0, seconds))
}

/** 0..0.9 — how much each echo feeds back into the next. */
export function setEchoFeedback(amount: number): void {
  ensureMaster()
  echoFb!.gain.value = Math.max(0, Math.min(0.9, amount))
}

export async function decodeFile(file: File): Promise<AudioBuffer> {
  const arr = await file.arrayBuffer()
  return await audioCtx().decodeAudioData(arr.slice(0))
}

/** Cut [startSec, endSec] out of a buffer into a fresh AudioBuffer — one grain. */
export function sliceBuffer(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const c = audioCtx()
  const sr = buffer.sampleRate
  const start = Math.max(0, Math.floor(startSec * sr))
  const end = Math.min(buffer.length, Math.floor(endSec * sr))
  const len = Math.max(1, end - start)
  const out = c.createBuffer(buffer.numberOfChannels, len, sr)
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.copyToChannel(buffer.getChannelData(ch).subarray(start, end), ch, 0)
  }
  return out
}

/** A reversed copy of a grain — play it backwards (the classic sample move). */
export function reverseBuffer(buffer: AudioBuffer): AudioBuffer {
  const c = audioCtx()
  const out = c.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
  const n = buffer.length
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const dst = out.getChannelData(ch)
    for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i]
  }
  return out
}

const oneShots = new Set<AudioBufferSourceNode>()

/** Build the per-grain colour chain: source -> lowpass -> gain. Returns the head gain. */
function colour(c: BaseAudioContext, src: AudioBufferSourceNode, gain: number, fx?: GrainFX): GainNode {
  src.playbackRate.value = rateOf(fx)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = fx?.cutoff ?? CUTOFF_MAX
  const g = c.createGain()
  g.gain.value = gain
  src.connect(filter).connect(g)
  return g
}

/** Preview a grain once, through its colour chain and the master bus. */
export function playBuffer(buffer: AudioBuffer, gain = 0.9, fx?: GrainFX): AudioBufferSourceNode {
  const c = audioCtx()
  const src = c.createBufferSource()
  src.buffer = buffer
  const g = colour(c, src, gain, fx)
  g.connect(ensureMaster())
  src.onended = () => oneShots.delete(src)
  oneShots.add(src)
  const t = c.currentTime
  src.start(t)
  applyFades(g, t, buffer.duration / rateOf(fx), gain, fx)
  return src
}

const layers = new Set<Layer>()

/** A looping grain you stack into the atmosphere. Live volume / pitch / tone control. */
export class Layer {
  private src: AudioBufferSourceNode
  private g: GainNode
  private filter: BiquadFilterNode
  private baseGain: number
  private fx?: GrainFX
  constructor(buffer: AudioBuffer, gain: number, fx?: GrainFX) {
    const c = audioCtx()
    this.baseGain = gain
    this.fx = fx
    this.g = c.createGain()
    this.g.gain.value = gain
    this.filter = c.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = fx?.cutoff ?? CUTOFF_MAX
    this.src = c.createBufferSource()
    this.src.buffer = buffer
    this.src.loop = true
    this.src.playbackRate.value = rateOf(fx)
    this.src.connect(this.filter).connect(this.g).connect(ensureMaster())
  }
  start(): void {
    const t = audioCtx().currentTime
    this.src.start(t)
    applyFades(this.g, t, Infinity, this.baseGain, this.fx) // fade-in only for a held loop
    layers.add(this)
  }
  stop(): void {
    try { this.src.stop() } catch { /* already stopped */ }
    layers.delete(this)
  }
  setGain(v: number): void {
    this.baseGain = Math.max(0, Math.min(1.4, v))
    this.g.gain.value = this.baseGain
  }
  setPitch(semitones: number): void {
    this.src.playbackRate.value = Math.pow(2, semitones / 12)
  }
  setCutoff(hz: number): void {
    this.filter.frequency.value = Math.max(40, Math.min(CUTOFF_MAX, hz))
  }
}

export function startLayer(buffer: AudioBuffer, gain = 0.8, fx?: GrainFX): Layer {
  const l = new Layer(buffer, gain, fx)
  l.start()
  return l
}

export function stopAll(): void {
  oneShots.forEach((s) => { try { s.stop() } catch { /* noop */ } })
  oneShots.clear()
  layers.forEach((l) => l.stop())
  layers.clear()
  stopTimeline()
  stopDrums()
  stopNotes()
}

// --- timeline playback: schedule a pass of placed clips through the master bus ---
let tlSources: AudioBufferSourceNode[] = []

// startSec/offset/length are in buffer-seconds; wall-clock duration = length / rate.
export type TlClip = {
  buffer: AudioBuffer
  startSec: number
  offset?: number
  length?: number
  gain?: number // per-track mixer gain (mute/solo folded in)
  fx?: GrainFX
}

export function startTimeline(clips: TlClip[], startTime?: number): void {
  stopTimeline()
  const c = audioCtx()
  const m = ensureMaster()
  const t0 = startTime ?? c.currentTime + 0.08
  for (const clip of clips) {
    const src = c.createBufferSource()
    src.buffer = clip.buffer
    const vol = clip.gain ?? 1
    const g = colour(c, src, vol, clip.fx)
    g.connect(m)
    const offset = Math.max(0, clip.offset ?? 0)
    const length = Math.max(0.01, clip.length ?? clip.buffer.duration - offset)
    const when = t0 + Math.max(0, clip.startSec)
    try { src.start(when, offset, length) } catch { /* noop */ }
    applyFades(g, when, length / rateOf(clip.fx), vol, clip.fx)
    tlSources.push(src)
  }
}

export function stopTimeline(): void {
  tlSources.forEach((s) => { try { s.stop() } catch { /* noop */ } })
  tlSources = []
}

// --- mixdown: render the arrangement offline to a single AudioBuffer ---
export type LayerRender = { buffer: AudioBuffer; gain: number; fx?: GrainFX }

/**
 * Render timeline clips + any held layers through a mirror of the master bus
 * (haze and all) into one buffer. A reverb tail is added so the haze rings out.
 */
export async function renderMixdown(opts: {
  clips: TlClip[]
  layers: LayerRender[]
  haze: number
  echo?: number
  echoTimeSec?: number
  echoFeedback?: number
  bpm?: number
  drums?: boolean[][]
  drumGain?: number
  drumSwing?: number
  drumVoiceGain?: number[]
  drumVoiceTune?: number[]
  drumVoiceDecay?: number[]
  notes?: ScheduledNote[]
  durationSec: number
  tailSec?: number
}): Promise<AudioBuffer> {
  const sr = audioCtx().sampleRate
  const echo = opts.echo ?? 0
  const echoTime = opts.echoTimeSec ?? 0.375
  const echoFeedback = opts.echoFeedback ?? 0.35
  // let the reverb (and any echoes) ring out past the arrangement
  let tail = opts.tailSec ?? 3.6
  if (echo > 0 && echoFeedback > 0 && echoTime > 0) {
    const repeats = Math.log(0.02) / Math.log(Math.min(0.95, echoFeedback)) // until ~2% level
    tail = Math.max(tail, Math.min(12, repeats * echoTime + 1))
  }
  const total = Math.max(0.1, opts.durationSec + tail)
  const oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr)

  // mirror the live master bus: dry + reverb (haze) + dub echo, into a limiter
  const m = oc.createGain()
  const lim = asLimiter(oc.createDynamicsCompressor())
  lim.connect(oc.destination)
  const d = oc.createGain(); d.gain.value = 1
  const w = oc.createGain(); w.gain.value = Math.max(0, Math.min(1, opts.haze))
  const conv = oc.createConvolver(); conv.buffer = makeImpulse(oc, 3.4, 2.6)
  m.connect(d).connect(lim)
  m.connect(conv).connect(w).connect(lim)

  const dl = oc.createDelay(2.0); dl.delayTime.value = Math.max(0.01, Math.min(2.0, echoTime))
  const fb = oc.createGain(); fb.gain.value = Math.max(0, Math.min(0.9, echoFeedback))
  const ew = oc.createGain(); ew.gain.value = Math.max(0, Math.min(1, echo))
  m.connect(dl); dl.connect(fb).connect(dl); dl.connect(ew).connect(lim)

  for (const clip of opts.clips) {
    const src = oc.createBufferSource()
    src.buffer = clip.buffer
    const vol = clip.gain ?? 1
    const g = colour(oc, src, vol, clip.fx)
    g.connect(m)
    const offset = Math.max(0, clip.offset ?? 0)
    const length = Math.max(0.01, clip.length ?? clip.buffer.duration - offset)
    const when = Math.max(0, clip.startSec)
    try { src.start(when, offset, length) } catch { /* noop */ }
    applyFades(g, when, length / rateOf(clip.fx), vol, clip.fx)
  }

  for (const l of opts.layers) {
    const src = oc.createBufferSource()
    src.buffer = l.buffer
    src.loop = true
    const g = colour(oc, src, l.gain, l.fx)
    g.connect(m)
    try { src.start(0); src.stop(opts.durationSec) } catch { /* noop */ }
    applyFades(g, 0, Infinity, l.gain, l.fx)
  }

  // recorded keyboard notes (grain or synth), rendered once at their positions
  if (opts.notes) {
    for (const n of opts.notes) scheduleNoteAt(oc, m, n, Math.max(0, n.startSec))
  }

  // drum pattern, looped across the whole arrangement
  if (opts.drums && opts.bpm) {
    const stepDur = (60 / opts.bpm) / 4
    const dgain = opts.drumGain ?? 0.9
    const swing = opts.drumSwing ?? 0
    const vGain = opts.drumVoiceGain ?? []
    const vTune = opts.drumVoiceTune ?? []
    const vDecay = opts.drumVoiceDecay ?? []
    const steps = opts.drums[0]?.length || DRUM_STEPS
    let step = 0
    for (let t = 0; t < opts.durationSec; t += stepDur) {
      const col = step % steps
      const when = t + (step % 2 === 1 ? swing * stepDur : 0)
      for (let v = 0; v < opts.drums.length; v++) {
        if (opts.drums[v]?.[col]) hitDrum(oc, when, DRUM_VOICES[v], m, dgain * (vGain[v] ?? 1), vTune[v] ?? 0, vDecay[v] ?? 1)
      }
      step++
    }
  }

  return await oc.startRendering()
}

// --- drum machine: synthesized voices + a lookahead step sequencer ---
// New voices are appended AFTER the original four so older saved patterns
// (which are positional) still line up with the right rows.
export type DrumVoice = 'kick' | 'snare' | 'hat' | 'openhat' | 'clap' | 'rim' | 'tom' | 'shaker'
export const DRUM_VOICES: DrumVoice[] = ['kick', 'snare', 'hat', 'openhat', 'clap', 'rim', 'tom', 'shaker']
export const DRUM_STEPS = 16 // default pattern length; actual length is the pattern width
const stepCount = (pattern: boolean[][]) => pattern[0]?.length || DRUM_STEPS

let noiseBuf: AudioBuffer | null = null
function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf
  const len = Math.floor(c.sampleRate)
  const b = c.createBuffer(1, len, c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  noiseBuf = b
  return b
}

// `r` scales the voice's characteristic frequencies (drum pitch, or the noise
// filter for cymbals) from the tune setting; `d` scales the decay tail length.
function hitKick(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.frequency.setValueAtTime(140 * r, when)
  osc.frequency.exponentialRampToValueAtTime(45 * r, when + 0.08)
  g.gain.setValueAtTime(Math.max(0.0001, gain), when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.32 * d)
  osc.connect(g).connect(out)
  osc.start(when); osc.stop(when + 0.34 * d)
}

function hitSnare(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c)
  const nf = c.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1500 * r
  const ng = c.createGain()
  ng.gain.setValueAtTime(Math.max(0.0001, gain * 0.8), when)
  ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.2 * d)
  n.connect(nf).connect(ng).connect(out)
  n.start(when); n.stop(when + 0.22 * d)
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 180 * r
  const og = c.createGain()
  og.gain.setValueAtTime(Math.max(0.0001, gain * 0.5), when)
  og.gain.exponentialRampToValueAtTime(0.0001, when + 0.12 * d)
  o.connect(og).connect(out); o.start(when); o.stop(when + 0.14 * d)
}

function hitHat(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number, open: boolean): void {
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c)
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000 * r
  const g = c.createGain()
  const dec = (open ? 0.3 : 0.05) * d
  g.gain.setValueAtTime(Math.max(0.0001, gain * 0.5), when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + dec)
  n.connect(hp).connect(g).connect(out)
  n.start(when); n.stop(when + dec + 0.02)
}

// Clap: a few tight noise bursts plus a short diffuse tail, all band-passed.
function hitClap(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'; bp.frequency.value = 1200 * r; bp.Q.value = 1.3
  bp.connect(out)
  for (const o of [0, 0.009, 0.018]) {
    const n = c.createBufferSource(); n.buffer = noiseBuffer(c)
    const ng = c.createGain()
    ng.gain.setValueAtTime(0.0001, when + o)
    ng.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * 0.7), when + o + 0.001)
    ng.gain.exponentialRampToValueAtTime(0.0001, when + o + 0.02)
    n.connect(ng).connect(bp)
    n.start(when + o); n.stop(when + o + 0.03)
  }
  const tail = c.createBufferSource(); tail.buffer = noiseBuffer(c)
  const tg = c.createGain()
  const tailEnd = when + 0.018 + 0.162 * d
  tg.gain.setValueAtTime(Math.max(0.0001, gain * 0.5), when + 0.018)
  tg.gain.exponentialRampToValueAtTime(0.0001, tailEnd)
  tail.connect(tg).connect(bp)
  tail.start(when + 0.018); tail.stop(tailEnd + 0.02)
}

// Rim / sidestick: a short, sharp band-passed tone.
function hitRim(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 1700 * r
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700 * r; bp.Q.value = 3
  const g = c.createGain()
  g.gain.setValueAtTime(Math.max(0.0001, gain * 0.7), when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.03 * d)
  o.connect(bp).connect(g).connect(out)
  o.start(when); o.stop(when + 0.04 * d)
}

// Low tom: a pitched sine that drops, longer decay than the kick.
function hitTom(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const o = c.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(180 * r, when)
  o.frequency.exponentialRampToValueAtTime(90 * r, when + 0.18)
  const g = c.createGain()
  g.gain.setValueAtTime(Math.max(0.0001, gain), when)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.4 * d)
  o.connect(g).connect(out)
  o.start(when); o.stop(when + 0.42 * d)
}

// Shaker: soft high-passed noise with a gentler transient than the hat.
function hitShaker(c: BaseAudioContext, when: number, out: AudioNode, gain: number, r: number, d: number): void {
  const n = c.createBufferSource(); n.buffer = noiseBuffer(c)
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000 * r
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(Math.max(0.0001, gain * 0.4), when + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06 * d)
  n.connect(hp).connect(g).connect(out)
  n.start(when); n.stop(when + 0.08 * d)
}

function hitDrum(c: BaseAudioContext, when: number, voice: DrumVoice, out: AudioNode, gain: number, tune = 0, decay = 1): void {
  const r = Math.pow(2, tune / 12)
  const d = decay
  switch (voice) {
    case 'kick': hitKick(c, when, out, gain, r, d); break
    case 'snare': hitSnare(c, when, out, gain, r, d); break
    case 'hat': hitHat(c, when, out, gain, r, d, false); break
    case 'openhat': hitHat(c, when, out, gain, r, d, true); break
    case 'clap': hitClap(c, when, out, gain, r, d); break
    case 'rim': hitRim(c, when, out, gain, r, d); break
    case 'tom': hitTom(c, when, out, gain, r, d); break
    case 'shaker': hitShaker(c, when, out, gain, r, d); break
  }
}

// lookahead scheduler — schedules drum hits on the audio clock a little ahead of time
let drumTimer: number | null = null
type DrumState = {
  pattern: boolean[][]; bpm: number; gain: number; swing: number
  voiceGain: number[]; voiceTune: number[]; voiceDecay: number[]
}
let drumState: DrumState | null = null
let drumNextTime = 0
let drumOrigin = 0
let drumStep = 0

export function startDrums(
  pattern: boolean[][], bpm: number, gain: number, swing = 0,
  voiceGain: number[] = [], voiceTune: number[] = [], voiceDecay: number[] = [], startTime?: number,
): void {
  stopDrums()
  const c = audioCtx()
  drumState = { pattern, bpm, gain, swing, voiceGain, voiceTune, voiceDecay }
  drumOrigin = startTime ?? c.currentTime + 0.1
  drumNextTime = drumOrigin
  drumStep = 0
  drumTimer = window.setInterval(drumScheduler, 25)
}

/** Swap in live-edited pattern / tempo / level / swing / per-voice mix without restarting the clock. */
export function updateDrums(
  pattern: boolean[][], bpm: number, gain: number, swing = 0,
  voiceGain: number[] = [], voiceTune: number[] = [], voiceDecay: number[] = [],
): void {
  if (drumState) drumState = { pattern, bpm, gain, swing, voiceGain, voiceTune, voiceDecay }
}

function drumScheduler(): void {
  if (!drumState) return
  const c = audioCtx()
  const out = ensureMaster()
  const stepDur = (60 / drumState.bpm) / 4
  const steps = stepCount(drumState.pattern)
  while (drumNextTime < c.currentTime + 0.1) {
    const col = drumStep % steps
    // swing nudges every odd 16th later, keeping the grid clock itself steady
    const when = drumNextTime + (drumStep % 2 === 1 ? drumState.swing * stepDur : 0)
    for (let v = 0; v < drumState.pattern.length; v++) {
      if (drumState.pattern[v]?.[col]) {
        const g = drumState.gain * (drumState.voiceGain[v] ?? 1)
        hitDrum(c, when, DRUM_VOICES[v], out, g, drumState.voiceTune[v] ?? 0, drumState.voiceDecay[v] ?? 1)
      }
    }
    drumStep++
    drumNextTime += stepDur
  }
}

export function stopDrums(): void {
  if (drumTimer != null) { clearInterval(drumTimer); drumTimer = null }
  drumState = null
}

/** The drum step currently sounding (for the moving highlight), or -1 when stopped. */
export function currentDrumStep(): number {
  if (!drumState) return -1
  const c = audioCtx()
  const stepDur = (60 / drumState.bpm) / 4
  const s = Math.floor((c.currentTime - drumOrigin) / stepDur)
  return s < 0 ? -1 : s % stepCount(drumState.pattern)
}

// --- playable keyboard: pitch a grain across the keys, sustain it while held ---
export type Note = { stop: () => void }

/**
 * Strike a grain at a semitone offset and hold it (looped) until stopped, through
 * the grain's tone + the master bus. Attack/release ramps keep it click-free.
 */
export function noteOn(buffer: AudioBuffer, semitones: number, gain = 0.9, fx?: GrainFX): Note {
  const c = audioCtx()
  const src = c.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.playbackRate.value = Math.pow(2, semitones / 12)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = fx?.cutoff ?? CUTOFF_MAX
  const g = c.createGain()
  const t = c.currentTime
  const attack = Math.max(0.005, fx?.fadeIn ?? 0.01)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(Math.max(0.0001, gain), t + attack)
  src.connect(filter).connect(g).connect(ensureMaster())
  src.start(t)
  let stopped = false
  return {
    stop() {
      if (stopped) return
      stopped = true
      const now = audioCtx().currentTime
      const rel = 0.14
      try {
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(0.0001, now + rel)
        src.stop(now + rel + 0.03)
      } catch { /* noop */ }
    },
  }
}

// --- synth voices: oscillator instruments playable from the keyboard ---
export type SynthPreset = {
  id: string; label: string
  wave: OscillatorType
  voices: number   // unison oscillator count
  detune: number   // cents spread across the unison
  cutoff: number   // lowpass Hz
  q: number
  attack: number
  release: number
  gain: number     // preset loudness scale
  sub?: boolean    // add a sine an octave below
  fm?: { ratio: number; index: number } // metallic FM on each carrier
}

export const SYNTHS: SynthPreset[] = [
  { id: 'synth:pad', label: 'Pad', wave: 'sawtooth', voices: 3, detune: 14, cutoff: 1300, q: 0.4, attack: 0.12, release: 0.5, gain: 0.5 },
  { id: 'synth:sub', label: 'Sub Bass', wave: 'sine', voices: 1, detune: 0, cutoff: 6000, q: 0, attack: 0.01, release: 0.18, gain: 0.95, sub: true },
  { id: 'synth:keys', label: 'Keys', wave: 'triangle', voices: 2, detune: 9, cutoff: 2400, q: 0.6, attack: 0.005, release: 0.3, gain: 0.6 },
  { id: 'synth:bell', label: 'Bell', wave: 'sine', voices: 1, detune: 0, cutoff: 5000, q: 0, attack: 0.002, release: 0.6, gain: 0.5, fm: { ratio: 2.0, index: 180 } },
]
export function getSynth(id: string): SynthPreset | undefined {
  return SYNTHS.find((s) => s.id === id)
}

// live shaping layered on top of any preset: cutoff is a multiplier, res adds Q,
// attack/release add seconds.
export type SynthMacros = {
  cutoff: number; res: number; attack: number; release: number
  lfoRate: number; lfoDepth: number // filter LFO: Hz, and 0..1 sweep depth
}
export const DEFAULT_MACROS: SynthMacros = { cutoff: 1, res: 0, attack: 0, release: 0, lfoRate: 1, lfoDepth: 0 }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// semitone 0 = middle C; the keyboard's octave shift moves it in 12s
const synthFreq = (semitones: number) => 261.63 * Math.pow(2, semitones / 12)

/** Build a preset's oscillator graph at a frequency; returns the amp node + all sources. */
function synthGraph(c: BaseAudioContext, preset: SynthPreset, freq: number, out: AudioNode, m: SynthMacros = DEFAULT_MACROS) {
  const amp = c.createGain()
  amp.gain.value = 0
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  const baseCutoff = clamp(preset.cutoff * m.cutoff, 60, 18000)
  filter.frequency.value = baseCutoff
  filter.Q.value = clamp(preset.q + m.res, 0, 24)
  filter.connect(amp).connect(out)

  const sources: AudioScheduledSourceNode[] = []

  // filter LFO: a sine swinging the cutoff around its base
  if (m.lfoDepth > 0) {
    const lfo = c.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = clamp(m.lfoRate, 0.02, 20)
    const lg = c.createGain()
    lg.gain.value = baseCutoff * Math.min(1, m.lfoDepth) * 0.9
    lfo.connect(lg).connect(filter.frequency)
    sources.push(lfo)
  }

  const n = Math.max(1, preset.voices)
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator()
    o.type = preset.wave
    o.frequency.value = freq
    o.detune.value = n > 1 ? (i - (n - 1) / 2) * preset.detune : 0
    const og = c.createGain(); og.gain.value = preset.gain / n
    o.connect(og).connect(filter)
    sources.push(o)
    if (preset.fm) {
      const mod = c.createOscillator(); mod.frequency.value = freq * preset.fm.ratio
      const mg = c.createGain(); mg.gain.value = preset.fm.index * freq / 261.63
      mod.connect(mg).connect(o.frequency)
      sources.push(mod)
    }
  }
  if (preset.sub) {
    const so = c.createOscillator(); so.type = 'sine'; so.frequency.value = freq / 2
    const sg = c.createGain(); sg.gain.value = preset.gain * 0.6
    so.connect(sg).connect(filter)
    sources.push(so)
  }
  return { amp, sources }
}

/** Play a synth voice and hold it until stopped (attack/release envelope). */
export function synthNoteOn(preset: SynthPreset, semitones: number, gain = 0.8, m: SynthMacros = DEFAULT_MACROS): Note {
  const c = audioCtx()
  const { amp, sources } = synthGraph(c, preset, synthFreq(semitones), ensureMaster(), m)
  const attack = preset.attack + m.attack
  const release = preset.release + m.release
  const t = c.currentTime
  amp.gain.setValueAtTime(0.0001, t)
  amp.gain.linearRampToValueAtTime(Math.max(0.0001, gain), t + attack)
  sources.forEach((s) => s.start(t))
  let stopped = false
  return {
    stop() {
      if (stopped) return
      stopped = true
      const now = audioCtx().currentTime
      try {
        amp.gain.cancelScheduledValues(now)
        amp.gain.setValueAtTime(amp.gain.value, now)
        amp.gain.linearRampToValueAtTime(0.0001, now + release)
        sources.forEach((s) => { try { s.stop(now + release + 0.03) } catch { /* noop */ } })
      } catch { /* noop */ }
    },
  }
}

// --- recorded keyboard notes: schedule fixed-length grain OR synth notes ---
export type ScheduledNote = {
  semitones: number
  startSec: number
  durSec: number
  gain: number
  buffer?: AudioBuffer // grain note
  synth?: SynthPreset  // synth note
  macros?: SynthMacros // live synth shaping
  fx?: GrainFX
}

/** One recorded grain note: a pitched, looped grain with an attack + a release at its end. */
function scheduleGrainNote(c: BaseAudioContext, out: AudioNode, n: ScheduledNote, when: number): AudioScheduledSourceNode[] {
  const src = c.createBufferSource()
  src.buffer = n.buffer!
  src.loop = true
  src.playbackRate.value = Math.pow(2, n.semitones / 12)
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = n.fx?.cutoff ?? CUTOFF_MAX
  const g = c.createGain()
  const dur = Math.max(0.05, n.durSec)
  const a = Math.min(Math.max(0.005, n.fx?.fadeIn ?? 0.01), dur * 0.5)
  const rel = 0.12
  const peak = Math.max(0.0001, n.gain)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(peak, when + a)
  g.gain.setValueAtTime(peak, when + dur)
  g.gain.linearRampToValueAtTime(0.0001, when + dur + rel)
  src.connect(filter).connect(g).connect(out)
  src.start(when)
  try { src.stop(when + dur + rel + 0.03) } catch { /* noop */ }
  return [src]
}

/** One recorded synth note: a preset voice with a fixed duration + release. */
function scheduleSynthNote(c: BaseAudioContext, out: AudioNode, n: ScheduledNote, when: number): AudioScheduledSourceNode[] {
  const preset = n.synth!
  const m = n.macros ?? DEFAULT_MACROS
  const { amp, sources } = synthGraph(c, preset, synthFreq(n.semitones), out, m)
  const dur = Math.max(0.05, n.durSec)
  const a = Math.min(preset.attack + m.attack, dur * 0.5)
  const rel = preset.release + m.release
  const peak = Math.max(0.0001, n.gain)
  amp.gain.setValueAtTime(0.0001, when)
  amp.gain.linearRampToValueAtTime(peak, when + a)
  amp.gain.setValueAtTime(peak, when + dur)
  amp.gain.linearRampToValueAtTime(0.0001, when + dur + rel)
  sources.forEach((s) => { s.start(when); try { s.stop(when + dur + rel + 0.03) } catch { /* noop */ } })
  return sources
}

/** Schedule one recorded note (grain or synth), returning its source nodes. */
function scheduleNoteAt(c: BaseAudioContext, out: AudioNode, n: ScheduledNote, when: number): AudioScheduledSourceNode[] {
  if (n.synth) return scheduleSynthNote(c, out, n, when)
  if (n.buffer) return scheduleGrainNote(c, out, n, when)
  return []
}

let noteSources: AudioScheduledSourceNode[] = []

/** Schedule a pass of recorded notes through the master bus. */
export function startNotes(notes: ScheduledNote[], startTime?: number): void {
  stopNotes()
  const c = audioCtx()
  const m = ensureMaster()
  const t0 = startTime ?? c.currentTime + 0.08
  for (const n of notes) noteSources.push(...scheduleNoteAt(c, m, n, t0 + Math.max(0, n.startSec)))
}

export function stopNotes(): void {
  noteSources.forEach((s) => { try { s.stop() } catch { /* noop */ } })
  noteSources = []
}
