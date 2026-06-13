import React, { useRef, useState } from 'react'
import { Sample } from './SampleLibrary'
import { GrainFX, rateOf } from '../audio'

export type Clip = {
  id: string
  sampleId: string
  track: number
  startSec: number
  offset?: number // in-point within the grain (buffer seconds)
  length?: number // how much of the grain plays (buffer seconds)
}

const TRACK_H = 34
const MIN_LEN = 0.04 // shortest a clip can be trimmed to (buffer seconds)

type Props = {
  samples: Sample[]
  clips: Clip[]
  fx: Record<string, GrainFX>
  tracks: number
  pxPerSec: number
  lengthSec: number
  playheadSec: number
  playing: boolean
  loop: boolean
  bpm: number
  gridBeats: number
  onBpm: (v: number) => void
  onGrid: (v: number) => void
  onAddClip: (sampleId: string, track: number, startSec: number) => void
  onMoveClip: (clipId: string, track: number, startSec: number) => void
  onTrimClip: (clipId: string, startSec: number, offset: number, length: number) => void
  onRemoveClip: (clipId: string) => void
  onPlay: () => void
  onStop: () => void
  onToggleLoop: () => void
}

type TrimState = {
  clipId: string; edge: 'l' | 'r'; px: number; rate: number; bufDur: number
  origStart: number; origOffset: number; origLength: number
}
type TrimPos = { clipId: string; startSec: number; offset: number; length: number }

/** The arranger: drop grains onto tracks, drag clips to move, drag their edges to trim. */
export default function Timeline(props: Props) {
  const { samples, clips, fx, tracks, pxPerSec, lengthSec, playheadSec, playing, loop, bpm, gridBeats } = props
  const span = Math.max(lengthSec, 12)
  const width = span * pxPerSec
  const spb = 60 / bpm
  const snapSec = gridBeats > 0 ? spb * gridBeats : 0
  const sampleById = (id: string) => samples.find((s) => s.id === id)
  const rateById = (id: string) => rateOf(fx[id])

  // full play length of a grain (buffer seconds), and the slice a clip plays
  function dims(c: Clip, s: Sample) {
    const offset = c.offset ?? 0
    const length = c.length ?? s.buffer.duration - offset
    return { offset, length, realDur: length / rateById(c.sampleId) }
  }

  const tracksRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ clipId: string; px: number; origStart: number; track: number; startSec: number } | null>(null)
  const [dragPos, setDragPos] = useState<{ clipId: string; track: number; startSec: number } | null>(null)
  const trimRef = useRef<TrimState | null>(null)
  const [trimPos, setTrimPos] = useState<TrimPos | null>(null)
  // latest trim position, reachable from the (non-reactive) mouseup handler
  const trimPosRef = useRef<TrimPos | null>(null)
  trimPosRef.current = trimPos

  function snap(v: number) {
    return snapSec > 0 ? Math.round(v / snapSec) * snapSec : v
  }

  function onDrop(e: React.DragEvent, track: number) {
    e.preventDefault()
    const id = e.dataTransfer.getData('grain-id')
    if (!id) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    props.onAddClip(id, track, Math.max(0, snap((e.clientX - rect.left) / pxPerSec)))
  }

  // --- move a clip across time / tracks ---
  function onClipDown(e: React.MouseEvent, c: Clip) {
    const t = e.target as HTMLElement
    if (t.closest('.clip-x') || t.closest('.trim')) return // buttons / trim handles handle themselves
    e.preventDefault()
    dragRef.current = { clipId: c.id, px: e.clientX, origStart: c.startSec, track: c.track, startSec: c.startSec }
    setDragPos({ clipId: c.id, track: c.track, startSec: c.startSec })
    window.addEventListener('mousemove', onClipMove)
    window.addEventListener('mouseup', onClipUp)
  }
  function onClipMove(e: MouseEvent) {
    const d = dragRef.current
    if (!d) return
    const startSec = Math.max(0, snap(d.origStart + (e.clientX - d.px) / pxPerSec))
    let track = d.track
    const el = tracksRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      track = Math.max(0, Math.min(tracks - 1, Math.floor((e.clientY - rect.top) / TRACK_H)))
    }
    d.track = track
    d.startSec = startSec
    setDragPos({ clipId: d.clipId, track, startSec })
  }
  function onClipUp() {
    const d = dragRef.current
    if (d) props.onMoveClip(d.clipId, d.track, d.startSec)
    dragRef.current = null
    setDragPos(null)
    window.removeEventListener('mousemove', onClipMove)
    window.removeEventListener('mouseup', onClipUp)
  }

  // --- trim a clip's edges ---
  function onTrimDown(e: React.MouseEvent, c: Clip, s: Sample, edge: 'l' | 'r') {
    e.preventDefault()
    e.stopPropagation()
    const { offset, length } = dims(c, s)
    trimRef.current = {
      clipId: c.id, edge, px: e.clientX, rate: rateById(c.sampleId), bufDur: s.buffer.duration,
      origStart: c.startSec, origOffset: offset, origLength: length,
    }
    setTrimPos({ clipId: c.id, startSec: c.startSec, offset, length })
    window.addEventListener('mousemove', onTrimMove)
    window.addEventListener('mouseup', onTrimUp)
  }
  function onTrimMove(e: MouseEvent) {
    const t = trimRef.current
    if (!t) return
    // real movement at the dragged edge, snapped to the grid
    const realDelta = snap((e.clientX - t.px) / pxPerSec)
    if (t.edge === 'r') {
      // move the out-point: grow/shrink length only
      const maxLen = t.bufDur - t.origOffset
      const length = Math.max(MIN_LEN, Math.min(maxLen, t.origLength + realDelta * t.rate))
      setTrimPos({ clipId: t.clipId, startSec: t.origStart, offset: t.origOffset, length })
    } else {
      // move the in-point: slide start + offset together, shrink/grow length the other way
      const minShift = -t.origOffset / t.rate // can't pull the in-point before the grain start
      const maxShift = (t.origLength - MIN_LEN) / t.rate // can't cross the out-point
      const shift = Math.max(minShift, Math.min(maxShift, realDelta))
      const startSec = Math.max(0, t.origStart + shift)
      const applied = startSec - t.origStart
      setTrimPos({
        clipId: t.clipId, startSec,
        offset: t.origOffset + applied * t.rate,
        length: t.origLength - applied * t.rate,
      })
    }
  }
  function onTrimUp() {
    const p = trimPosRef.current
    if (p) props.onTrimClip(p.clipId, p.startSec, p.offset, p.length)
    trimRef.current = null
    setTrimPos(null)
    window.removeEventListener('mousemove', onTrimMove)
    window.removeEventListener('mouseup', onTrimUp)
  }

  // clips with the in-flight move / trim applied, for rendering
  const view = clips.map((c) => {
    if (dragPos && dragPos.clipId === c.id) return { ...c, track: dragPos.track, startSec: dragPos.startSec }
    if (trimPos && trimPos.clipId === c.id) {
      return { ...c, startSec: trimPos.startSec, offset: trimPos.offset, length: trimPos.length }
    }
    return c
  })

  // grid lines
  const totalBeats = Math.ceil(span / spb)
  const lines: { x: number; kind: 'bar' | 'beat' | 'sub' }[] = []
  for (let b = 0; b <= totalBeats; b++) lines.push({ x: b * spb * pxPerSec, kind: b % 4 === 0 ? 'bar' : 'beat' })
  if (snapSec > 0 && gridBeats < 1) {
    for (let t = snapSec; t <= span; t += snapSec) {
      const beats = t / spb
      if (Math.abs(Math.round(beats) - beats) > 1e-3) lines.push({ x: t * pxPerSec, kind: 'sub' })
    }
  }
  const bars: number[] = []
  for (let bar = 0; bar * 4 <= totalBeats; bar++) bars.push(bar)

  return (
    <div className="timeline">
      <div className="transport">
        <button className={playing ? 'tbtn play on' : 'tbtn play'} onClick={playing ? props.onStop : props.onPlay}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button className={loop ? 'tbtn looptl on' : 'tbtn looptl'} onClick={props.onToggleLoop} title="Loop the timeline">
          ↻ Loop
        </button>
        <label className="tfield">
          BPM
          <input
            type="number" min={40} max={200} value={bpm}
            onChange={(e) => props.onBpm(Math.max(40, Math.min(200, Number(e.target.value) || 90)))}
          />
        </label>
        <label className="tfield">
          Snap
          <select value={gridBeats} onChange={(e) => props.onGrid(Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={0.25}>1/4 beat</option>
            <option value={0.5}>1/2 beat</option>
            <option value={1}>1 beat</option>
            <option value={4}>1 bar</option>
          </select>
        </label>
        <span className="tcount">{clips.length} clip{clips.length === 1 ? '' : 's'}</span>
        <span className="hint small">drag to move · drag edges to trim</span>
      </div>

      <div className="tl-scroll">
        <div className="tl-inner" style={{ width }}>
          <div className="ruler">
            {bars.map((bar) => (
              <span key={bar} className="tick" style={{ left: bar * 4 * spb * pxPerSec }}>{bar + 1}</span>
            ))}
          </div>
          <div className="tracks" ref={tracksRef}>
            <div className="grid">
              {lines.map((l, i) => (
                <div key={i} className={`grid-line ${l.kind}`} style={{ left: l.x }} />
              ))}
            </div>
            {Array.from({ length: tracks }, (_, tr) => (
              <div
                key={tr}
                className="track"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
                onDrop={(e) => onDrop(e, tr)}
              >
                {view.filter((c) => c.track === tr).map((c) => {
                  const s = sampleById(c.sampleId)
                  if (!s) return null
                  const { realDur } = dims(c, s)
                  const dragging = dragPos?.clipId === c.id || trimPos?.clipId === c.id
                  return (
                    <div
                      key={c.id}
                      className={dragging ? 'clip dragging' : 'clip'}
                      style={{ left: c.startSec * pxPerSec, width: Math.max(10, realDur * pxPerSec) }}
                      title={`${s.name} @ ${c.startSec.toFixed(2)}s · ${realDur.toFixed(2)}s`}
                      onMouseDown={(e) => onClipDown(e, c)}
                    >
                      <span className="trim l" title="Trim start" onMouseDown={(e) => onTrimDown(e, c, s, 'l')} />
                      <span className="clip-name">{s.name}</span>
                      <button className="clip-x" onClick={() => props.onRemoveClip(c.id)} title="Remove">×</button>
                      <span className="trim r" title="Trim end" onMouseDown={(e) => onTrimDown(e, c, s, 'r')} />
                    </div>
                  )
                })}
              </div>
            ))}
            {playing && <div className="playhead" style={{ left: playheadSec * pxPerSec }} />}
          </div>
        </div>
      </div>
    </div>
  )
}
