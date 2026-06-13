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

// Per-grain colour: pitch in semitones (down = murk), lowpass cutoff in Hz (down = dark).
export type GrainFX = { pitch: number; cutoff: number }
export const DEFAULT_FX: GrainFX = { pitch: 0, cutoff: 20000 }
export const CUTOFF_MAX = 20000

/** A pitch shift of n semitones is a playback-rate of 2^(n/12). */
export function rateOf(fx?: GrainFX): number {
  return Math.pow(2, (fx?.pitch ?? 0) / 12)
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
  master.connect(dry).connect(c.destination)
  master.connect(convolver).connect(wet).connect(c.destination)
  return master
}

/** 0..1 — how much reverb haze sits over everything. */
export function setHaze(amount: number): void {
  ensureMaster()
  wet!.gain.value = Math.max(0, Math.min(1, amount))
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
  colour(c, src, gain, fx).connect(ensureMaster())
  src.onended = () => oneShots.delete(src)
  oneShots.add(src)
  src.start()
  return src
}

const layers = new Set<Layer>()

/** A looping grain you stack into the atmosphere. Live volume / pitch / tone control. */
export class Layer {
  private src: AudioBufferSourceNode
  private g: GainNode
  private filter: BiquadFilterNode
  constructor(buffer: AudioBuffer, gain: number, fx?: GrainFX) {
    const c = audioCtx()
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
    this.src.start()
    layers.add(this)
  }
  stop(): void {
    try { this.src.stop() } catch { /* already stopped */ }
    layers.delete(this)
  }
  setGain(v: number): void {
    this.g.gain.value = Math.max(0, Math.min(1.4, v))
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
}

// --- timeline playback: schedule a pass of placed clips through the master bus ---
let tlSources: AudioBufferSourceNode[] = []

// startSec/offset/length are in buffer-seconds; wall-clock duration = length / rate.
export type TlClip = {
  buffer: AudioBuffer
  startSec: number
  offset?: number
  length?: number
  fx?: GrainFX
}

export function startTimeline(clips: TlClip[]): void {
  stopTimeline()
  const c = audioCtx()
  const m = ensureMaster()
  const t0 = c.currentTime + 0.08
  for (const clip of clips) {
    const src = c.createBufferSource()
    src.buffer = clip.buffer
    colour(c, src, 1, clip.fx).connect(m)
    const offset = Math.max(0, clip.offset ?? 0)
    const length = Math.max(0.01, clip.length ?? clip.buffer.duration - offset)
    try { src.start(t0 + Math.max(0, clip.startSec), offset, length) } catch { /* noop */ }
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
  durationSec: number
  tailSec?: number
}): Promise<AudioBuffer> {
  const sr = audioCtx().sampleRate
  const tail = opts.tailSec ?? 3.6
  const total = Math.max(0.1, opts.durationSec + tail)
  const oc = new OfflineAudioContext(2, Math.ceil(total * sr), sr)

  // mirror the live master bus: master -> dry -> out, master -> convolver -> wet -> out
  const m = oc.createGain()
  const d = oc.createGain(); d.gain.value = 1
  const w = oc.createGain(); w.gain.value = Math.max(0, Math.min(1, opts.haze))
  const conv = oc.createConvolver(); conv.buffer = makeImpulse(oc, 3.4, 2.6)
  m.connect(d).connect(oc.destination)
  m.connect(conv).connect(w).connect(oc.destination)

  for (const clip of opts.clips) {
    const src = oc.createBufferSource()
    src.buffer = clip.buffer
    colour(oc, src, 1, clip.fx).connect(m)
    const offset = Math.max(0, clip.offset ?? 0)
    const length = Math.max(0.01, clip.length ?? clip.buffer.duration - offset)
    try { src.start(Math.max(0, clip.startSec), offset, length) } catch { /* noop */ }
  }

  for (const l of opts.layers) {
    const src = oc.createBufferSource()
    src.buffer = l.buffer
    src.loop = true
    colour(oc, src, l.gain, l.fx).connect(m)
    try { src.start(0); src.stop(opts.durationSec) } catch { /* noop */ }
  }

  return await oc.startRendering()
}
