import React, { useEffect, useRef, useState } from 'react'

type Props = {
  buffer: AudioBuffer
  onSelect: (startSec: number, endSec: number) => void
}

/** Renders the waveform on a canvas and lets you drag a selection (a grain). */
export default function Waveform({ buffer, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const w = cv.width
    const h = cv.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#0a0a0c'
    ctx.fillRect(0, 0, w, h)

    const data = buffer.getChannelData(0)
    const step = Math.max(1, Math.ceil(data.length / w))
    const amp = h / 2
    ctx.strokeStyle = '#c9b48a' // warm sand on black
    ctx.beginPath()
    for (let x = 0; x < w; x++) {
      let min = 1
      let max = -1
      for (let i = 0; i < step; i++) {
        const v = data[x * step + i] || 0
        if (v < min) min = v
        if (v > max) max = v
      }
      ctx.moveTo(x + 0.5, (1 + min) * amp)
      ctx.lineTo(x + 0.5, (1 + max) * amp)
    }
    ctx.stroke()

    if (drag) {
      const x1 = Math.min(drag.a, drag.b)
      const x2 = Math.max(drag.a, drag.b)

      // dim the waveform outside the selection so the chosen region pops
      ctx.fillStyle = 'rgba(5,5,8,0.6)'
      ctx.fillRect(0, 0, x1, h)
      ctx.fillRect(x2, 0, w - x2, h)

      // gentle tint inside
      ctx.fillStyle = 'rgba(233,201,122,0.12)'
      ctx.fillRect(x1, 0, x2 - x1, h)

      // bold, glowing boundary lines
      ctx.save()
      ctx.shadowColor = 'rgba(255,200,110,0.9)'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#ffe6ad'
      ctx.fillRect(x1 - 1, 0, 2, h)
      ctx.fillRect(x2 - 1, 0, 2, h)
      ctx.restore()

      // grab handles at top + bottom of each boundary
      ctx.fillStyle = '#ffe6ad'
      for (const x of [x1, x2]) {
        ctx.fillRect(x - 3, 0, 6, 5)
        ctx.fillRect(x - 3, h - 5, 6, 5)
      }
    }
  }, [buffer, drag])

  const relX = (e: React.MouseEvent) => {
    const cv = canvasRef.current!
    const r = cv.getBoundingClientRect()
    return Math.max(0, Math.min(cv.width, ((e.clientX - r.left) / r.width) * cv.width))
  }
  const xToSec = (x: number) => (x / canvasRef.current!.width) * buffer.duration

  return (
    <canvas
      ref={canvasRef}
      width={900}
      height={180}
      className="waveform"
      onMouseDown={(e) => setDrag({ a: relX(e), b: relX(e) })}
      onMouseMove={(e) => drag && setDrag({ ...drag, b: relX(e) })}
      onMouseUp={(e) => {
        if (!drag) return
        const b = relX(e)
        const x1 = Math.min(drag.a, b)
        const x2 = Math.max(drag.a, b)
        if (x2 - x1 > 3) onSelect(xToSec(x1), xToSec(x2))
      }}
    />
  )
}
