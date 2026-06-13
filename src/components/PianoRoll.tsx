import React, { useRef, useState } from 'react'

export type RollNote = {
  id: string
  sampleId: string
  semitones: number
  startSec: number
  durSec: number
  gain: number
}

const ROW_H = 15
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK = new Set([1, 3, 6, 8, 10])
const mod12 = (n: number) => ((n % 12) + 12) % 12
const isBlack = (semi: number) => BLACK.has(mod12(semi))
// semitone 0 = the grain's root; label it around C4 as a readable reference
const noteName = (semi: number) => `${NOTE[mod12(semi)]}${4 + Math.floor(semi / 12)}`

type Props = {
  notes: RollNote[]
  bpm: number
  gridBeats: number
  pxPerSec: number
  onMoveNote: (id: string, startSec: number, semitones: number) => void
  onTrimNote: (id: string, durSec: number) => void
  onAddNote: (startSec: number, semitones: number) => void
  onDeleteNote: (id: string) => void
  onPreview: (sampleId: string, semitones: number) => void
  onClose: () => void
}

type Drag = {
  id: string; mode: 'move' | 'trim'; px: number; py: number
  origStart: number; origSemi: number; origDur: number
}

/** A piano-roll over the recorded keyboard part: move / trim / add / delete notes. */
export default function PianoRoll(props: Props) {
  const { notes, bpm, gridBeats, pxPerSec } = props
  const spb = 60 / bpm
  const snapSec = gridBeats > 0 ? spb * gridBeats : 0
  const snap = (v: number) => (snapSec > 0 ? Math.round(v / snapSec) * snapSec : v)

  // pitch window: span the notes (padded), clamped, with a sane default when empty
  const semis = notes.map((n) => n.semitones)
  const semMax = Math.min(36, (semis.length ? Math.max(...semis) : 12) + 3)
  const semMin = Math.max(-36, (semis.length ? Math.min(...semis) : -7) - 3)
  const rows: number[] = []
  for (let s = semMax; s >= semMin; s--) rows.push(s)
  const rowOf = (semi: number) => semMax - semi

  const end = notes.reduce((m, n) => Math.max(m, n.startSec + n.durSec), 8)
  const span = Math.max(end + 2, 12)
  const width = span * pxPerSec
  const height = rows.length * ROW_H

  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [pos, setPos] = useState<{ id: string; startSec: number; semitones: number; durSec: number } | null>(null)
  const posRef = useRef<typeof pos>(null)
  posRef.current = pos

  function onNoteDown(e: React.MouseEvent, n: RollNote, mode: 'move' | 'trim') {
    if ((e.target as HTMLElement).closest('.pr-x')) return
    e.preventDefault(); e.stopPropagation()
    dragRef.current = { id: n.id, mode, px: e.clientX, py: e.clientY, origStart: n.startSec, origSemi: n.semitones, origDur: n.durSec }
    setPos({ id: n.id, startSec: n.startSec, semitones: n.semitones, durSec: n.durSec })
    if (mode === 'move') props.onPreview(n.sampleId, n.semitones)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  function onMove(e: MouseEvent) {
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'move') {
      const startSec = Math.max(0, snap(d.origStart + (e.clientX - d.px) / pxPerSec))
      const semitones = Math.max(semMin, Math.min(semMax, d.origSemi - Math.round((e.clientY - d.py) / ROW_H)))
      setPos({ id: d.id, startSec, semitones, durSec: d.origDur })
    } else {
      const durSec = Math.max(0.05, snap(d.origDur + (e.clientX - d.px) / pxPerSec) || d.origDur)
      setPos({ id: d.id, startSec: d.origStart, semitones: d.origSemi, durSec })
    }
  }
  function onUp() {
    const d = dragRef.current
    const p = posRef.current
    if (d && p) {
      if (d.mode === 'move') props.onMoveNote(d.id, p.startSec, p.semitones)
      else props.onTrimNote(d.id, p.durSec)
    }
    dragRef.current = null
    setPos(null)
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  function onGridDouble(e: React.MouseEvent) {
    const rect = gridRef.current!.getBoundingClientRect()
    const startSec = Math.max(0, snap((e.clientX - rect.left) / pxPerSec))
    const row = Math.floor((e.clientY - rect.top) / ROW_H)
    const semitones = semMax - Math.max(0, Math.min(rows.length - 1, row))
    props.onAddNote(startSec, semitones)
  }

  // grid lines
  const totalBeats = Math.ceil(span / spb)
  const lines: { x: number; bar: boolean }[] = []
  for (let b = 0; b <= totalBeats; b++) lines.push({ x: b * spb * pxPerSec, bar: b % 4 === 0 })

  const view = notes.map((n) => (pos && pos.id === n.id ? { ...n, startSec: pos.startSec, semitones: pos.semitones, durSec: pos.durSec } : n))

  return (
    <div className="pr-overlay" onMouseDown={props.onClose}>
      <div className="pr-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pr-head">
          <h2>Edit Part</h2>
          <span className="tcount">{notes.length} note{notes.length === 1 ? '' : 's'}</span>
          <span className="hint small">drag to move · drag right edge to trim · double-click to add · × to delete</span>
          <button className="tbtn" onClick={props.onClose}>Done</button>
        </div>
        <div className="pr-body">
          <div className="pr-keys" style={{ height }}>
            {rows.map((s) => (
              <div key={s} className={isBlack(s) ? 'pr-key black' : 'pr-key'} style={{ height: ROW_H }}>
                {mod12(s) === 0 && <span>{noteName(s)}</span>}
              </div>
            ))}
          </div>
          <div className="pr-scroll">
            <div className="pr-grid" ref={gridRef} style={{ width, height }} onDoubleClick={onGridDouble}>
              {rows.map((s, i) => (
                <div key={s} className={isBlack(s) ? 'pr-lane black' : 'pr-lane'} style={{ top: i * ROW_H, height: ROW_H }} />
              ))}
              {lines.map((l, i) => (
                <div key={`l${i}`} className={l.bar ? 'pr-line bar' : 'pr-line'} style={{ left: l.x }} />
              ))}
              {view.map((n) => (
                <div
                  key={n.id}
                  className={pos?.id === n.id ? 'pr-note dragging' : 'pr-note'}
                  style={{ left: n.startSec * pxPerSec, top: rowOf(n.semitones) * ROW_H + 1, width: Math.max(8, n.durSec * pxPerSec), height: ROW_H - 2 }}
                  title={`${noteName(n.semitones)} · ${n.durSec.toFixed(2)}s`}
                  onMouseDown={(e) => onNoteDown(e, n, 'move')}
                >
                  <button className="pr-x" onClick={() => props.onDeleteNote(n.id)} title="Delete">×</button>
                  <span className="pr-trim" onMouseDown={(e) => onNoteDown(e, n, 'trim')} title="Trim" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
