import { playBuffer, GrainFX, DEFAULT_FX, CUTOFF_MAX } from '../audio'

export type Sample = { id: string; name: string; buffer: AudioBuffer }

type Props = {
  samples: Sample[]
  looping: Set<string>
  volumes: Record<string, number>
  fx: Record<string, GrainFX>
  onToggleLoop: (s: Sample) => void
  onVolume: (s: Sample, v: number) => void
  onPitch: (s: Sample, semitones: number) => void
  onCutoff: (s: Sample, hz: number) => void
  onFadeIn: (s: Sample, sec: number) => void
  onFadeOut: (s: Sample, sec: number) => void
  onReverse: (s: Sample) => void
}

const fadeLabel = (sec: number) => (sec <= 0 ? '—' : sec < 1 ? `${Math.round(sec * 1000)}ms` : `${sec.toFixed(2)}s`)

// Tone slider runs 0..1 on a log scale so the action sits where the ear is.
const FMIN = 120
const toHz = (t: number) => FMIN * Math.pow(CUTOFF_MAX / FMIN, t)
const toPos = (hz: number) => Math.log(hz / FMIN) / Math.log(CUTOFF_MAX / FMIN)

/**
 * The Grains shelf — also the layer mixer.
 * Each grain: ▶ preview, ↻ loop as a layer, volume, and per-grain Pitch + Tone
 * (drop the pitch and close the tone for that murky low end).
 */
export default function SampleLibrary({
  samples, looping, volumes, fx, onToggleLoop, onVolume, onPitch, onCutoff, onFadeIn, onFadeOut, onReverse,
}: Props) {
  return (
    <aside className="library">
      <h2>Grains · Layers</h2>
      {samples.length === 0 && <p className="hint">Chopped grains land here. Loop a few to stack them.</p>}
      <ul>
        {samples.map((s) => {
          const isLoop = looping.has(s.id)
          const vol = volumes[s.id] ?? 0.8
          const f = fx[s.id] ?? DEFAULT_FX
          return (
            <li key={s.id} className={isLoop ? 'grain looping' : 'grain'}>
              <div className="grain-row">
                <span
                  className="drag"
                  draggable
                  title="Drag onto the timeline"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('grain-id', s.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  ⠿
                </span>
                <button className="icon" title="Preview" onClick={() => playBuffer(s.buffer, 0.9, f)}>▶</button>
                <button
                  className={isLoop ? 'icon loop on' : 'icon loop'}
                  title={isLoop ? 'Stop this layer' : 'Loop as a layer'}
                  onClick={() => onToggleLoop(s)}
                >
                  ↻
                </button>
                <button className="icon" title="Reverse this grain" onClick={() => onReverse(s)}>⇄</button>
                <span className="name" title={s.name}>{s.name}</span>
                <span className="dur">{s.buffer.duration.toFixed(2)}s</span>
              </div>
              <input
                className="vol"
                type="range"
                min={0}
                max={1.4}
                step={0.01}
                value={vol}
                onChange={(e) => onVolume(s, Number(e.target.value))}
                title="Layer volume"
              />
              <div className="fx-row">
                <label className="fx" title="Pitch in semitones — drop it for murk">
                  <span>Pitch</span>
                  <input
                    type="range" min={-12} max={12} step={1} value={f.pitch}
                    onChange={(e) => onPitch(s, Number(e.target.value))}
                  />
                  <em>{f.pitch > 0 ? `+${f.pitch}` : f.pitch}</em>
                </label>
                <label className="fx" title="Tone — close it down to darken the grain">
                  <span>Tone</span>
                  <input
                    type="range" min={0} max={1} step={0.001} value={toPos(f.cutoff)}
                    onChange={(e) => onCutoff(s, Math.round(toHz(Number(e.target.value))))}
                  />
                  <em>{f.cutoff >= CUTOFF_MAX ? 'open' : `${(f.cutoff / 1000).toFixed(1)}k`}</em>
                </label>
              </div>
              <div className="fx-row">
                <label className="fx" title="Fade in — soften the attack, kill the click">
                  <span>In</span>
                  <input
                    type="range" min={0} max={1} step={0.005} value={f.fadeIn}
                    onChange={(e) => onFadeIn(s, Number(e.target.value))}
                  />
                  <em>{fadeLabel(f.fadeIn)}</em>
                </label>
                <label className="fx" title="Fade out — taper the tail, kill the click">
                  <span>Out</span>
                  <input
                    type="range" min={0} max={1} step={0.005} value={f.fadeOut}
                    onChange={(e) => onFadeOut(s, Number(e.target.value))}
                  />
                  <em>{fadeLabel(f.fadeOut)}</em>
                </label>
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
