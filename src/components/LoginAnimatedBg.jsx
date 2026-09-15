export default function LoginAnimatedBg() {
  return (
    <div className="login-bg-anim" aria-hidden="true">
      <div className="login-neon-mesh" />
      <div className="login-neon-shape login-neon-shape-1" />
      <div className="login-neon-shape login-neon-shape-2" />
      <div className="login-neon-shape login-neon-shape-3" />
      <div className="login-neon-shape login-neon-shape-4" />
      <div className="login-neon-ring login-neon-ring-1" />
      <div className="login-neon-ring login-neon-ring-2" />
      <div className="login-neon-beam login-neon-beam-1" />
      <div className="login-neon-beam login-neon-beam-2" />
      {PARTICLES.map((p) => (
        <span
          key={p.id}
          className="login-particle"
          style={{
            left: p.left,
            top: p.top,
            animationDuration: p.duration,
            animationDelay: p.delay,
            width: p.size,
            height: p.size,
          }}
        />
      ))}
    </div>
  )
}

const PARTICLES = [
  { id: 1, left: '8%', top: '18%', duration: '14s', delay: '0s', size: 4 },
  { id: 2, left: '22%', top: '72%', duration: '18s', delay: '-3s', size: 3 },
  { id: 3, left: '78%', top: '24%', duration: '16s', delay: '-6s', size: 5 },
  { id: 4, left: '88%', top: '68%', duration: '20s', delay: '-2s', size: 3 },
  { id: 5, left: '52%', top: '8%', duration: '22s', delay: '-8s', size: 4 },
  { id: 6, left: '65%', top: '82%', duration: '17s', delay: '-5s', size: 3 },
  { id: 7, left: '35%', top: '42%', duration: '19s', delay: '-11s', size: 2 },
  { id: 8, left: '92%', top: '45%', duration: '15s', delay: '-4s', size: 4 },
  { id: 9, left: '12%', top: '48%', duration: '21s', delay: '-9s', size: 3 },
  { id: 10, left: '58%', top: '58%', duration: '13s', delay: '-7s', size: 2 },
  { id: 11, left: '44%', top: '78%', duration: '24s', delay: '-1s', size: 4 },
  { id: 12, left: '72%', top: '12%', duration: '16s', delay: '-10s', size: 3 },
]
