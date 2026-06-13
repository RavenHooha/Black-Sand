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
  synths: { id: string; label: string }[]
  instrument: string
  octave: number
  gain: number
  held: Set<number>
  recArmed: boolean
  recCount: number
  onInstrument: (id: string) => void
  onOctave: (delta: number) => void
  onGain: (v: number) => void
  onArm: () => void
  onClearRec: () => void
  onEdit: () => void
  onNoteDown: (offset: number) => void
  onNoteUp: (offset: number) => void
  // synth shaping (shown when a synth voice is selected)
  synthCutoff: number
  synthRes: number
  synthAttack: number
  synthRelease: number
  onSynthCutoff: (v: number) => void
  onSynthRes: (v: number) => void
  onSynthAttack: (v: number) => void
  onSynthRelease: (v: number) => void
}

const ms = (sec: number) => (sec < 1 ? `${Math.round(sec * 1000)}ms` : `${sec.toFixed(2)}s`)

/** A playable keyboard: pick a grain, play it pitched with the mouse or the A–K row. */
export default function Keyboard({
  samples, synths, instrument, octave, gain, held, recArmed, recCount,
  onInstrument, onOctave, onGain, onArm, onClearRec, onEdit, onNoteDown, onNoteUp,
  synthCutoff, synthRes, synthAttack, synthRelease,
  onSynthCutoff, onSynthRes, onSynthAttack, onSynthRelease,
}: Props) {
  const isSynth = instrument.startsWith('synth:')
  return (
    <div className="keyboard">
      <div className="kb-head">
        <h2>Keyboard</h2>
        <select className="echo-sync" value={instrument} onChange={(e) => onInstrument(e.target.value)} title="Voice to play">
          <optgroup label="Synths">
            {synths.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </optgroup>
          {samples.length > 0 && (
            <optgroup label="Grains">
              {samples.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          )}
        </select>
        <div className="kb-oct" title="Octave">
          <button className="tbtn" onClick={() => onOctave(-1)}>–</button>
          <span>Oct {octave}</span>
          <button className="tbtn" onClick={() => onOctave(1)}>+</button>
        </div>
        <button
          className={recArmed ? 'tbtn rec on' : 'tbtn rec'}
          onClick={onArm}
          title="Arm recording — played notes are captured while the transport rolls"
        >
          ● Rec
        </button>
        {recCount > 0 && (
          <span className="tcount">
            {recCount} note{recCount === 1 ? '' : 's'}
            <button className="clip-x" onClick={onClearRec} title="Clear the recorded part">×</button>
          </span>
        )}
        {recCount > 0 && <button className="tbtn" onClick={onEdit} title="Edit the recorded part in the piano-roll">Edit ▸</button>}
        <label className="haze" title="Keyboard level">
          <span>Level</span>
          <input type="range" min={0} max={1.2} step={0.01} value={gain} onChange={(e) => onGain(Number(e.target.value))} />
        </label>
      </div>

      {isSynth && (
        <div className="kb-synth">
          <label className="fx" title="Filter cutoff — brightness">
            <span>Cutoff</span>
            <input type="range" min={0.1} max={4} step={0.01} value={synthCutoff} onChange={(e) => onSynthCutoff(Number(e.target.value))} />
            <em>{synthCutoff.toFixed(2)}×</em>
          </label>
          <label className="fx" title="Resonance — filter emphasis">
            <span>Res</span>
            <input type="range" min={0} max={14} step={0.1} value={synthRes} onChange={(e) => onSynthRes(Number(e.target.value))} />
            <em>{synthRes.toFixed(1)}</em>
          </label>
          <label className="fx" title="Attack — fade-in time">
            <span>Att</span>
            <input type="range" min={0} max={1.2} step={0.005} value={synthAttack} onChange={(e) => onSynthAttack(Number(e.target.value))} />
            <em>{ms(synthAttack)}</em>
          </label>
          <label className="fx" title="Release — tail length after key-up">
            <span>Rel</span>
            <input type="range" min={0} max={1.5} step={0.005} value={synthRelease} onChange={(e) => onSynthRelease(Number(e.target.value))} />
            <em>{ms(synthRelease)}</em>
          </label>
        </div>
      )}

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
