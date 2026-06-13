type Props = {
  labels: string[]
  pattern: boolean[][]
  step: number // currently-sounding step, or -1
  gain: number
  swing: number
  voiceGain: number[]
  voiceTune: number[]
  onToggle: (voice: number, step: number) => void
  onClear: () => void
  onGain: (v: number) => void
  onSwing: (v: number) => void
  onVoiceGain: (voice: number, v: number) => void
  onVoiceTune: (voice: number, v: number) => void
}

/**
 * A 4-voice, 16-step drum machine. Synth kick / snare / hat / open-hat,
 * tempo-locked to the timeline BPM and run through the master bus — so the
 * Haze and Echo land on the drums too.
 */
export default function DrumMachine({
  labels, pattern, step, gain, swing, voiceGain, voiceTune,
  onToggle, onClear, onGain, onSwing, onVoiceGain, onVoiceTune,
}: Props) {
  const steps = pattern[0]?.length ?? 16
  return (
    <div className="drums">
      <div className="drums-head">
        <h2>Drum Machine</h2>
        <label className="haze" title="Swing — push the off-beats late for a shuffle">
          <span>Swing</span>
          <input type="range" min={0} max={0.6} step={0.01} value={swing} onChange={(e) => onSwing(Number(e.target.value))} />
          <em className="swing-val">{Math.round((swing / 0.6) * 100)}%</em>
        </label>
        <label className="haze" title="Drum level">
          <span>Level</span>
          <input type="range" min={0} max={1.2} step={0.01} value={gain} onChange={(e) => onGain(Number(e.target.value))} />
        </label>
        <button className="tbtn" onClick={onClear} title="Clear the pattern">Clear</button>
      </div>
      <div className="drum-grid">
        {pattern.map((row, v) => (
          <div className="drum-row" key={v}>
            <div className="drum-ctl">
              <span className="drum-label">{labels[v]}</span>
              <input
                className="dv-gain" type="range" min={0} max={1.5} step={0.01}
                value={voiceGain[v] ?? 1} onChange={(e) => onVoiceGain(v, Number(e.target.value))}
                title={`${labels[v]} level`}
              />
              <input
                className="dv-tune" type="range" min={-12} max={12} step={1}
                value={voiceTune[v] ?? 0} onChange={(e) => onVoiceTune(v, Number(e.target.value))}
                title={`${labels[v]} tune (${(voiceTune[v] ?? 0) > 0 ? '+' : ''}${voiceTune[v] ?? 0} st)`}
              />
            </div>
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
