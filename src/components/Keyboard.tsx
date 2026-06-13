// Semitone offsets 0..15 laid out as just over an octave of piano keys.
const WHITES = [0, 2, 4, 5, 7, 9, 11, 12, 14]
const BLACK = new Set([1, 3, 6, 8, 10, 13, 15])
const CHAR: Record<number, string> = {
  0: 'a', 1: 'w', 2: 's', 3: 'e', 4: 'd', 5: 'f', 6: 't', 7: 'g',
  8: 'y', 9: 'h', 10: 'u', 11: 'j', 12: 'k', 13: 'o', 14: 'l', 15: 'p',
}
const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// the computer-key -> semitone-offset map, exported for App's global key listener
export const KEY_OFFSETS: Record<string, number> = Object.fromEntries(
  Object.entries(CHAR).map(([off, ch]) => [ch, Number(off)])
)

type Props = {
  samples: { id: string; name: string }[]
  instrument: string
  octave: number
  gain: number
  held: Set<number>
  onInstrument: (id: string) => void
  onOctave: (delta: number) => void
  onGain: (v: number) => void
  onNoteDown: (offset: number) => void
  onNoteUp: (offset: number) => void
}

/** A playable keyboard: pick a grain, play it pitched with the mouse or the A–K row. */
export default function Keyboard({
  samples, instrument, octave, gain, held, onInstrument, onOctave, onGain, onNoteDown, onNoteUp,
}: Props) {
  return (
    <div className="keyboard">
      <div className="kb-head">
        <h2>Keyboard</h2>
        <select className="echo-sync" value={instrument} onChange={(e) => onInstrument(e.target.value)} title="Grain to play">
          {samples.length === 0 && <option value="">— chop a grain first —</option>}
          {samples.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="kb-oct" title="Octave">
          <button className="tbtn" onClick={() => onOctave(-1)}>–</button>
          <span>Oct {octave}</span>
          <button className="tbtn" onClick={() => onOctave(1)}>+</button>
        </div>
        <label className="haze" title="Keyboard level">
          <span>Level</span>
          <input type="range" min={0} max={1.2} step={0.01} value={gain} onChange={(e) => onGain(Number(e.target.value))} />
        </label>
      </div>

      <div className="piano" onMouseLeave={() => held.forEach((o) => onNoteUp(o))}>
        {WHITES.map((off) => (
          <div
            key={off}
            className={'wkey' + (held.has(off) ? ' held' : '')}
            onMouseDown={() => onNoteDown(off)}
            onMouseUp={() => onNoteUp(off)}
            onMouseLeave={() => onNoteUp(off)}
            title={NOTE[off % 12]}
          >
            {BLACK.has(off + 1) && (
              <div
                className={'bkey' + (held.has(off + 1) ? ' held' : '')}
                onMouseDown={(e) => { e.stopPropagation(); onNoteDown(off + 1) }}
                onMouseUp={(e) => { e.stopPropagation(); onNoteUp(off + 1) }}
                onMouseLeave={() => onNoteUp(off + 1)}
                title={NOTE[(off + 1) % 12]}
              >
                <span className="kc">{CHAR[off + 1]}</span>
              </div>
            )}
            <span className="kc">{CHAR[off]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
