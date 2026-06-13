import { useEffect, useRef } from 'react'

type Props = {
  buffer: AudioBuffer
  width: number
  height: number
  color?: string
  offset?: number // seconds into the buffer (for trimmed clips)
  length?: number // seconds to draw
  className?: string
}

/** A tiny peak-drawn waveform of a buffer (or a trimmed slice of it). */
export default function MiniWave({ buffer, width, height, color = '#c9b48a', offset = 0, length, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || width < 1) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.max(1, Math.floor(width * dpr))
    cv.height = Math.max(1, Math.floor(height * dpr))
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const data = buffer.getChannelData(0)
    const sr = buffer.sampleRate
    const start = Math.max(0, Math.floor(offset * sr))
    const end = length ? Math.min(buffer.length, Math.floor((offset + length) * sr)) : buffer.length
    const total = Math.max(1, end - start)
    const step = Math.max(1, Math.floor(total / width))
    const mid = height / 2

    ctx.fillStyle = color
    for (let x = 0; x < width; x++) {
      let min = 1, max = -1
      const i0 = start + x * step
      for (let j = 0; j < step; j++) {
        const v = data[i0 + j] || 0
        if (v < min) min = v
        if (v > max) max = v
      }
      const y1 = mid - max * mid
      const y2 = mid - min * mid
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1))
    }
  }, [buffer, width, height, color, offset, length])

  return <canvas ref={ref} className={className} style={{ width, height, display: 'block' }} />
}
