// Black Sand — save / load a project to a portable .blacksand file.
// Grains are WAV-encoded + base64'd so they travel inside the file; the
// arrangement and settings ride along as JSON. (The source track isn't saved —
// re-import it if you want to chop more; your grains + arrangement are the work.)

import { audioCtx } from './audio'

export type SavedSample = {
  id: string; name: string; volume: number; wav: string
  pitch?: number // semitones (older sessions omit it)
  cutoff?: number // lowpass Hz
  fadeIn?: number // seconds
  fadeOut?: number // seconds
}
export type SavedClip = {
  id: string; sampleId: string; track: number; startSec: number
  offset?: number // trim in-point, buffer seconds
  length?: number // trimmed length, buffer seconds
}
export type SavedNote = {
  id: string; sampleId: string; semitones: number; startSec: number; durSec: number; gain: number
}

export type Session = {
  version: 1
  bpm: number
  gridBeats: number
  haze: number
  echo?: number // dub-echo send (older sessions omit it)
  echoBeats?: number // echo note division in beats
  drumPattern?: boolean[][] // drum-machine grid (voices x steps)
  drumGain?: number
  drumSwing?: number // 0..~0.6 — delay on the off-beat 16ths
  notes?: SavedNote[] // recorded keyboard part
  trackVol?: number[] // per-timeline-track mixer
  trackMute?: boolean[]
  trackSolo?: boolean[]
  loopTl: boolean
  samples: SavedSample[]
  clips: SavedClip[]
}

/** AudioBuffer -> 16-bit PCM WAV. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = buffer.numberOfChannels
  const sr = buffer.sampleRate
  const frames = buffer.length
  const blockAlign = numCh * 2
  const dataSize = frames * blockAlign
  const out = new ArrayBuffer(44 + dataSize)
  const view = new DataView(out)
  let p = 0
  const str = (s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)) }
  const u32 = (v: number) => { view.setUint32(p, v, true); p += 4 }
  const u16 = (v: number) => { view.setUint16(p, v, true); p += 2 }

  str('RIFF'); u32(36 + dataSize); str('WAVE')
  str('fmt '); u32(16); u16(1); u16(numCh); u32(sr); u32(sr * blockAlign); u16(blockAlign); u16(16)
  str('data'); u32(dataSize)

  const chans: Float32Array[] = []
  for (let ch = 0; ch < numCh; ch++) chans.push(buffer.getChannelData(ch))
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = Math.max(-1, Math.min(1, chans[ch][i]))
      s = s < 0 ? s * 0x8000 : s * 0x7fff
      view.setInt16(p, s, true)
      p += 2
    }
  }
  return out
}

export function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Serialize the current session and trigger a download. */
export function downloadSession(session: Session, filename: string): void {
  const blob = new Blob([JSON.stringify(session)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.blacksand') ? filename : `${filename}.blacksand`
  a.click()
  URL.revokeObjectURL(url)
}

/** Bounce an AudioBuffer to a .wav file download. */
export function downloadWav(buffer: AudioBuffer, filename: string): void {
  const blob = new Blob([encodeWav(buffer)], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.wav') ? filename : `${filename}.wav`
  a.click()
  URL.revokeObjectURL(url)
}

/** Parse + decode a .blacksand session from its raw JSON text. */
export async function readSessionText(text: string): Promise<{ session: Session; buffers: Map<string, AudioBuffer> }> {
  const session = JSON.parse(text) as Session
  if (!session || session.version !== 1 || !Array.isArray(session.samples)) {
    throw new Error('Not a valid Black Sand session.')
  }
  const buffers = new Map<string, AudioBuffer>()
  for (const s of session.samples) {
    const buf = await audioCtx().decodeAudioData(base64ToBuf(s.wav))
    buffers.set(s.id, buf)
  }
  return { session, buffers }
}

/** Read a .blacksand File (browser) and decode its grains back into AudioBuffers. */
export async function readSessionFile(file: File): Promise<{ session: Session; buffers: Map<string, AudioBuffer> }> {
  return readSessionText(await file.text())
}
