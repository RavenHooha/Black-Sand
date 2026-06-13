type Props = {
  labels: string[]
  pattern: boolean[][]
  step: number // currently-sounding step, or -1
  gain: number
  onToggle: (voice: number, step: number) => void
  onClear: () => void
  onGain: (v: number) => void
}

/**
 * A 4-voice, 16-step drum machine. Synth kick / snare / hat / open-hat,
 * tempo-locked to the timeline BPM and run through the master bus — so the
 * Haze and Echo land on the drums too.
 */
export default function DrumMachine({ labels, pattern, step, gain, onToggle, onClear, onGain }: Props) {
  const steps = pattern[0]?.length ?? 16
  return (
    <div className="drums">
      <div className="drums-head">
        <h2>Drum Machine</h2>
        <label className="haze" title="Drum level">
          <span>Level</span>
          <input type="range" min={0} max={1.2} step={0.01} value={gain} onChange={(e) => onGain(Number(e.target.value))} />
        </label>
        <button className="tbtn" onClick={onClear} title="Clear the pattern">Clear</button>
      </div>
      <div className="drum-grid">
        {pattern.map((row, v) => (
          <div className="drum-row" key={v}>
            <span className="drum-label">{labels[v]}</span>
            <div className="drum-cells">
              {row.map((on, i) => (
                <button
                  key={i}
                  className={
                    'cell' +
                    (on ? ' on' : '') +
                    (i === step ? ' playing' : '') +
                    (Math.floor(i / 4) % 2 === 1 ? ' alt' : '')
                  }
                  onClick={() => onToggle(v, i)}
                  title={`${labels[v]} · step ${i + 1}`}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="beat-marks" style={{ ['--steps' as string]: steps }}>
          {Array.from({ length: steps / 4 }, (_, b) => (
            <span key={b}>{b + 1}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
