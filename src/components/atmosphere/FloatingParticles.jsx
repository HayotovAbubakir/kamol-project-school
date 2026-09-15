import { useEffect, useRef } from 'react'

export default function FloatingParticles() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return undefined

    const pointer = { x: -999, y: -999 }
    let motes = []
    let raf = 0

    function spawn() {
      motes = Array.from({ length: 36 }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: -0.2 + Math.random() * 0.4,
        vy: 0.25 + Math.random() * 0.55,
        size: 4 + Math.random() * 10,
        rot: Math.random() * Math.PI,
        vr: -0.015 + Math.random() * 0.03,
        alpha: 0.12 + Math.random() * 0.2,
      }))
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      spawn()
    }

    function onMove(e) {
      pointer.x = e.clientX
      pointer.y = e.clientY
    }

    function draw() {
      const w = window.innerWidth
      const h = window.innerHeight
      ctx.clearRect(0, 0, w, h)

      motes.forEach((m) => {
        const dx = m.x - pointer.x
        const dy = m.y - pointer.y
        const dist = Math.hypot(dx, dy) || 1
        if (dist < 120) {
          const force = (120 - dist) / 120
          m.vx += (dx / dist) * force * 0.4
          m.vy += (dy / dist) * force * 0.4
        }
        m.x += m.vx
        m.y += m.vy
        m.rot += m.vr
        m.vx *= 0.98
        m.vy = m.vy * 0.98 + 0.03
        if (m.y > h + 16) {
          m.y = -16
          m.x = Math.random() * w
        }
        ctx.save()
        ctx.translate(m.x, m.y)
        ctx.rotate(m.rot)
        ctx.fillStyle = `rgba(63, 107, 85, ${m.alpha})`
        ctx.fillRect(-m.size / 2, -m.size * 0.6, m.size, m.size * 1.2)
        ctx.restore()
      })
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="particles-canvas" aria-hidden="true" />
}
